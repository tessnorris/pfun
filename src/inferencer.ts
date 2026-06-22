// src/inferencer.ts
//
// Hindley-Milner type inference for Pfun.
//
// Organised in layers, each building on the previous:
//
//   § 1  Fresh variable counter
//   § 2  Substitution — maps TyVar ids to PfunTypes
//   § 3  Free variable collection
//   § 4  Type formatting
//   § 5  Unification — extends a substitution to make two types equal
//   § 6  Constraint generation — walks AST, assigns TyVars, emits constraints
//   § 7  Type schemes — let-generalisation and instantiation
//
// Design notes
// ────────────
// TyVar vs Unknown: TyVar means "not yet solved — unification will narrow
// this".  Unknown means "the first-pass inferencer gave up".  Unification
// treats Unknown as a wildcard (compatible with anything) so first-pass
// annotations coexist with HM inference without causing spurious failures.
//
// Immutability: Substitution is immutable — every operation returns a new
// instance.  This makes it safe to pass substitutions into recursive calls
// without defensive copying.
//
// Occurs check: bindVar applies the current substitution to the candidate
// type before checking for free occurrences of the variable, so chains like
// α1→α0 followed by α0→List<α1> are correctly rejected.
//
// Let-generalisation: only `let` bindings are generalised (value restriction
// — mutable `var` bindings cannot safely be polymorphic).  Generalisation
// quantifies over type variables free in the inferred type but not free in
// the ambient type environment.  instantiate() creates fresh copies of those
// variables at each use site, enabling parametric polymorphism.

import { PfunType, Expr, Stmt } from './ast';
import { SourcePos } from './lexer';

// ─── § 1  Fresh variable counter ─────────────────────────────────────────────

let _nextId = 0;

/**
 * Allocate a fresh type variable with a unique numeric id.
 * Ids are monotonically increasing and globally unique within a compilation
 * unit.
 */
export function freshVar(): PfunType & { kind: 'TyVar' } {
  return { kind: 'TyVar', id: _nextId++ };
}

/**
 * Reset the counter.  Call only in tests — production code must never reset
 * mid-flight since ids must remain globally unique.
 */
export function resetFreshVarCounter(): void {
  _nextId = 0;
}

/** Peek at the next id that would be allocated, without allocating. */
export function peekNextId(): number {
  return _nextId;
}

// ─── § 2  Substitution ───────────────────────────────────────────────────────

/**
 * A finite map from TyVar ids to PfunTypes.
 *
 * Invariant: idempotent — no id in the domain appears free in any of the
 * range types.  compose() maintains this automatically.
 *
 * Immutable by convention: all operations return new instances.
 */
export class Substitution {
  private readonly map: ReadonlyMap<number, PfunType>;

  constructor(map?: ReadonlyMap<number, PfunType>) {
    this.map = map ?? new Map();
  }

  static empty(): Substitution {
    return new Substitution();
  }

  static of(id: number, type: PfunType): Substitution {
    return new Substitution(new Map([[id, type]]));
  }

  has(id: number): boolean {
    return this.map.has(id);
  }

  get(id: number): PfunType | undefined {
    return this.map.get(id);
  }

  /**
   * Return a new substitution that additionally maps `id` to `type`.
   * Does not compose — use when you know `id` is not already in the domain.
   */
  extend(id: number, type: PfunType): Substitution {
    const next = new Map(this.map);
    next.set(id, type);
    return new Substitution(next);
  }

  /**
   * Apply this substitution to a type, chasing TyVar chains to their
   * terminal type and recursing into compound types.
   */
  apply(t: PfunType): PfunType {
    switch (t.kind) {
      case 'TyVar': {
        const mapped = this.map.get(t.id);
        if (mapped === undefined) return t;
        return this.apply(mapped); // chase the chain
      }
      case 'List':    return { kind: 'List',    element: this.apply(t.element) };
      case 'Array':   return { kind: 'Array',   element: this.apply(t.element) };
      case 'Option':  return { kind: 'Option',  inner:   this.apply(t.inner)   };
      case 'Dict':    return { kind: 'Dict',    key:     this.apply(t.key),
                                                value:   this.apply(t.value)   };
      case 'Fn':      return { kind: 'Fn',
                               params: t.params.map(p => this.apply(p)),
                               ret:    this.apply(t.ret)                        };
      case 'Generic': return { kind: 'Generic',
                               name:   t.name,
                               params: t.params.map(p => this.apply(p))         };
      case 'Named':
        return t.fieldTypes
          ? { ...t, fieldTypes: t.fieldTypes.map(ft => this.apply(ft)) }
          : t;
      default:        return t;
    }
  }

  /**
   * Compose two substitutions: (this).compose(other).
   *
   * Semantics: compose(s1, s2).apply(t) === s2.apply(s1.apply(t))
   *
   * Apply `other` to every type in `this`'s range, then include bindings
   * from `other` not already in `this`'s domain.
   */
  compose(other: Substitution): Substitution {
    if (other.map.size === 0) return this;
    if (this.map.size  === 0) return other;

    const result = new Map<number, PfunType>();
    for (const [id, type] of this.map)  result.set(id, other.apply(type));
    for (const [id, type] of other.map) if (!result.has(id)) result.set(id, type);
    return new Substitution(result);
  }

  /**
   * Collect free type variable ids in `t` after applying this substitution.
   * Shorthand for freeVarsIn(this.apply(t)).
   */
  freeVars(t: PfunType): Set<number> {
    return freeVarsIn(this.apply(t));
  }

  get size(): number { return this.map.size; }

  entries(): IterableIterator<[number, PfunType]> { return this.map.entries(); }

  toString(): string {
    const pairs = [...this.map.entries()]
      .map(([id, t]) => `α${id} ↦ ${formatType(t)}`)
      .join(', ');
    return `{${pairs}}`;
  }
}

// ─── § 3  Free variable collection ───────────────────────────────────────────

/**
 * Collect all TyVar ids appearing free in a type (without applying any
 * substitution first).
 */
export function freeVarsIn(t: PfunType): Set<number> {
  const result = new Set<number>();
  collectFree(t, result);
  return result;
}

function collectFree(t: PfunType, acc: Set<number>): void {
  switch (t.kind) {
    case 'TyVar':    acc.add(t.id); break;
    case 'List':     collectFree(t.element, acc); break;
    case 'Array':    collectFree(t.element, acc); break;
    case 'Option':   collectFree(t.inner,   acc); break;
    case 'Dict':     collectFree(t.key, acc); collectFree(t.value, acc); break;
    case 'Fn':       t.params.forEach(p => collectFree(p, acc)); collectFree(t.ret, acc); break;
    case 'Generic':  t.params.forEach(p => collectFree(p, acc)); break;
    case 'Named':    if (t.fieldTypes) t.fieldTypes.forEach(ft => collectFree(ft, acc)); break;
  }
}

// ─── § 4  Type formatting ─────────────────────────────────────────────────────

/**
 * Format a PfunType as a human-readable string.
 * TyVars render as α0, α1, … for readability in error messages.
 */
export function formatType(t: PfunType): string {
  switch (t.kind) {
    case 'Int':     return 'Int';
    case 'Float':   return 'Float';
    case 'Bool':    return 'Bool';
    case 'Str':     return 'Str';
    case 'Char':    return 'Char';
    case 'Byte':    return 'Byte';
    case 'Nil':     return 'Nil';
    case 'Unknown': return '?';
    case 'TyVar':   return `α${t.id}`;
    case 'List':    return `List<${formatType(t.element)}>`;
    case 'Array':   return `Array<${formatType(t.element)}>`;
    case 'Option':  return `Option<${formatType(t.inner)}>`;
    case 'Dict':    return `Dict<${formatType(t.key)}, ${formatType(t.value)}>`;
    case 'Named':
      // unionName === name represents "a value of this union, specific
      // variant not statically known" (e.g. a builtin function's
      // Fn.ret — readFile() returns SOME Result, but which variant,
      // Ok or Err, is only known at runtime) — as opposed to a truly
      // known specific variant (e.g. Shape.Square), where name and
      // unionName genuinely differ. Showing "Result.Result" in an error
      // message would be confusing redundancy for the former case, so
      // suppress the prefix exactly when they match; "Shape.Square"
      // still renders normally since its name/unionName genuinely
      // differ.
      return (t.unionName && t.unionName !== t.name) ? `${t.unionName}.${t.name}` : t.name;
    case 'Generic': return `${t.name}<${t.params.map(formatType).join(', ')}>`;
    case 'Fn': {
      const ps = t.params.map(formatType).join(', ');
      return `(${ps}) -> ${formatType(t.ret)}`;
    }
  }
}

// ─── § 5  Unification ────────────────────────────────────────────────────────

export class UnificationError extends Error {
  constructor(
    public readonly a: PfunType,
    public readonly b: PfunType,
    message?: string,
  ) {
    super(message ?? `Cannot unify ${formatType(a)} with ${formatType(b)}`);
    this.name = 'UnificationError';
  }
}

export class OccursCheckError extends UnificationError {
  constructor(id: number, t: PfunType) {
    super(
      { kind: 'TyVar', id },
      t,
      `Occurs check failed: α${id} occurs in ${formatType(t)}`,
    );
    this.name = 'OccursCheckError';
  }
}

/**
 * Unify types `a` and `b` under substitution `subst`.
 *
 * Returns a new substitution (extending `subst`) that makes `a` and `b`
 * equal under application, or throws UnificationError / OccursCheckError.
 */
export function unify(
  a: PfunType,
  b: PfunType,
  subst: Substitution = Substitution.empty(),
): Substitution {
  const ta = subst.apply(a);
  const tb = subst.apply(b);

  // Same TyVar on both sides — trivial
  if (ta.kind === 'TyVar' && tb.kind === 'TyVar' && ta.id === tb.id) return subst;

  if (ta.kind === 'TyVar') return bindVar(ta.id, tb, subst);
  if (tb.kind === 'TyVar') return bindVar(tb.id, ta, subst);

  // Unknown is a wildcard — compatible with anything
  if (ta.kind === 'Unknown' || tb.kind === 'Unknown') return subst;

  if (ta.kind !== tb.kind) throw new UnificationError(ta, tb);

  switch (ta.kind) {
    case 'Int':
    case 'Float':
    case 'Bool':
    case 'Str':
    case 'Char':
    case 'Byte':
    case 'Nil':
      return subst;

    case 'List':    return unify(ta.element, (tb as typeof ta).element, subst);
    case 'Array':   return unify(ta.element, (tb as typeof ta).element, subst);
    case 'Option':  return unify(ta.inner,   (tb as typeof ta).inner,   subst);

    case 'Dict': {
      const tb_ = tb as typeof ta;
      return unify(ta.value, tb_.value, unify(ta.key, tb_.key, subst));
    }

    case 'Named': {
      const tb_ = tb as typeof ta;
      // Same constructor name — trivially equal.
      if (ta.name === tb_.name) return subst;
      // Same union — variants of the same union are compatible in a list or
      // ternary.  [Square { 5 }, Circle { 3 }] is a valid List<Shape>.
      if (ta.unionName !== undefined && ta.unionName === tb_.unionName) return subst;
      throw new UnificationError(ta, tb);
    }

    case 'Generic': {
      const tb_ = tb as typeof ta;
      if (ta.name !== tb_.name || ta.params.length !== tb_.params.length)
        throw new UnificationError(ta, tb);
      return unifyMany(ta.params, tb_.params, subst);
    }

    case 'Fn': {
      const tb_ = tb as typeof ta;
      if (ta.params.length !== tb_.params.length) throw new UnificationError(ta, tb);
      return unify(ta.ret, tb_.ret, unifyMany(ta.params, tb_.params, subst));
    }

    default: throw new UnificationError(ta, tb);
  }
}

function unifyMany(as: PfunType[], bs: PfunType[], subst: Substitution): Substitution {
  let s = subst;
  for (let i = 0; i < as.length; i++) s = unify(as[i], bs[i], s);
  return s;
}

function bindVar(id: number, t: PfunType, subst: Substitution): Substitution {
  if (t.kind === 'TyVar' && t.id === id) return subst;
  const tResolved = subst.apply(t);
  if (freeVarsIn(tResolved).has(id)) throw new OccursCheckError(id, tResolved);
  return subst.extend(id, tResolved);
}

// ─── § 6  Constraint generation ──────────────────────────────────────────────
//
// Walks the AST and produces a set of equality constraints between PfunTypes.
// Every expression node is assigned a fresh TyVar, and constraints are emitted
// wherever the language rules require two types to be equal.
//
// This pass does NOT solve constraints — that is left to Phase 4 (the full
// inference pass).  It only annotates each expression with its assigned TyVar
// and accumulates the constraint list.
//
// Relation to the first-pass inferencer (typechecker.ts):
//   - The first pass uses simple top-down propagation and leaves UNKNOWN where
//     it cannot resolve.  It never fails.
//   - This pass assigns TyVars to every unknown site and emits constraints that
//     capture what the types MUST be.  Solving those constraints (Phase 4) may
//     produce errors.
//   - Both passes write to `inferredType` on AST nodes.  Running this pass
//     after the first pass overwrites UNKNOWN annotations with TyVars, while
//     leaving already-resolved types (Int, Str, …) in place.
//
// Operator constraints:
//   - Comparisons always produce Bool — no constraint on operands needed for
//     the result type, but we emit constraints to unify operands with each other
//     for consistency.
//   - Arithmetic (+, -, *, /, %) constrains both operands and the result to Int.
//     String concatenation is handled by the first pass; here we default to Int
//     for +. Full overload resolution is deferred to a later phase.
//   - Boolean operators (&&, ||) constrain operands to Bool and produce Bool.

// ─── Constraint types ─────────────────────────────────────────────────────────

/**
 * An equality constraint: the two types must be unified.
 * pos is optional source location for error reporting.
 */
export type Constraint = {
  a:   PfunType;
  b:   PfunType;
  pos: SourcePos | undefined;
};

export type ConstraintSet = Constraint[];

/** Convenience constructor. */
function constraint(a: PfunType, b: PfunType, pos?: SourcePos): Constraint {
  return { a, b, pos };
}

// ─── Type environment for constraint generation ───────────────────────────────
//
// Reuses the same scoped-chain shape as the first-pass TypeEnv, but lives
// here so the constraint generator can be used independently.

/**
 * A module's exported names and their resolved types, as extracted by the
 * whole-program driver (wholeProgramCheck.ts) after running
 * generateConstraints + solveConstraints over that module and reading off
 * each exported name's final (substituted) type. Mirrors
 * procedureCheck.ts's ImportTable (which does the analogous thing for
 * purity *kinds*) — kept as a separate type since the value domain differs
 * (PfunType here, NameKind there), but the role is identical: turn an
 * imported name from "completely opaque to this pass" into "as precisely
 * known as if it had been declared locally."
 *
 * Absent entirely (the default), this module's behavior is unchanged from
 * before cross-module type support existed: every imported name gets a
 * fresh, unconstrained TyVar (IdentExpr's "unbound name" branch), exactly
 * as today.
 */
export type TypeImportTable = Map<string, PfunType>;

/**
 * Resolves an import to that module's TypeImportTable. Supplied by the
 * whole-program driver, which has already run generateConstraints +
 * solveConstraints over every module in the import graph, in dependency
 * order, before this pass runs on a module that imports from them — see
 * wholeProgramCheck.ts for the full design. Mirrors
 * procedureCheck.ts's ModuleImportResolver exactly (same null-means-
 * "fall back to permissive treatment of this one import" contract).
 */
export type TypeImportResolver = (importPath: string, pos: SourcePos | undefined) => TypeImportTable | null;

/**
 * One union's variant descriptors. Mirrors typechecker.ts's
 * UnionVariants exactly (same shape; redeclared rather than imported to
 * avoid a circular dependency — typechecker.ts already imports FROM this
 * file, see its own header comment).
 */
export type UnionVariants = { name: string; fields: string[] }[];

/**
 * A module's exported unions, keyed by union name. Needed for a DIFFERENT
 * reason than TypeImportTable: importing a union's VARIANT CONSTRUCTOR
 * name (e.g. `import { Square } from "./shapes"`, then constructing
 * `Square { 5 }`) does not go through env.lookup at all —
 * RecordExpr's own handling (cgenExpr's 'RecordExpr' case) looks up
 * `registry.lookupConstructor(expr.name)` on the CGenRegistry directly, a
 * completely separate lookup path from IdentExpr's env-based one. Without
 * registering the imported union into THIS module's own CGenRegistry too,
 * an imported constructor's RecordExpr would get `{ kind: 'Named', name:
 * expr.name }` with no `unionName` at all (registry.lookupConstructor
 * returns null for an unregistered name) — silently breaking both the
 * type itself and, downstream, cross-module exhaustiveness checking
 * (typechecker.ts's checkExhaustiveness reads inferredType.unionName off
 * exactly this RecordExpr-derived type for the match subject).
 */
export type UnionImportTable = Map<string, UnionVariants>;

/** Resolves an import to that module's exported unions, for CGenRegistry
 *  seeding. Mirrors TypeImportResolver's contract exactly. */
export type UnionImportResolver = (importPath: string, pos: SourcePos | undefined) => UnionImportTable | null;

/**
 * Set once at the start of each generateConstraints() call, read only by
 * ImportStmt's handling in cgenStmt and by GetExpr's namespace-member
 * lookup in cgenExpr — never mutated mid-walk. Module-level rather than
 * threaded as an explicit parameter through cgenStmt/cgenExpr (~44 call
 * sites) for the identical reason procedureCheck.ts's
 * currentImportResolver is module-level: it is genuinely constant for the
 * whole walk, unlike `env`/`registry`/`cs` which change per-call, so a
 * parameter would be passed unchanged at every single call site. Safe as
 * module state because generateConstraints is fully synchronous (no
 * async/await/yield anywhere in this file) and has no concurrent/
 * worker-thread callers.
 */
let currentTypeImportResolver: TypeImportResolver | null = null;

/** Sibling to currentTypeImportResolver above, same rationale — read only
 *  by registerAllUnions's ImportStmt handling (CGenRegistry seeding for
 *  imported union constructors — see UnionImportTable's docblock). */
let currentUnionImportResolver: UnionImportResolver | null = null;

/** What a single name in env actually refers to: either a plain resolved
 *  (or in-progress, pre-substitution) type, or — for a namespace import
 *  (`import * as X from "..."`) — the whole imported module's type table,
 *  so a later `X.foo` GetExpr can be resolved against it. Mirrors
 *  procedureCheck.ts's ScopeEntry. */
type CGenEnvEntry = { tag: 'type'; type: PfunType } | { tag: 'namespace'; table: TypeImportTable };

class CGenEnv {
  private bindings = new Map<string, CGenEnvEntry>();
  constructor(public parent?: CGenEnv) {}

  define(name: string, type: PfunType): void { this.bindings.set(name, { tag: 'type', type }); }

  /** Bind `name` as a namespace import standing for an entire module's
   *  type table (`import * as X from "..."` → defineNamespace('X', ...)). */
  defineNamespace(name: string, table: TypeImportTable): void {
    this.bindings.set(name, { tag: 'namespace', table });
  }

  private resolveEntry(name: string): CGenEnvEntry | undefined {
    const found = this.bindings.get(name);
    if (found !== undefined) return found;
    return this.parent?.resolveEntry(name);
  }

  lookup(name: string): PfunType | undefined {
    const entry = this.resolveEntry(name);
    if (!entry || entry.tag === 'namespace') return undefined;
    return entry.type;
  }

  /** Resolve `name.member`'s type when `name` is bound to a namespace
   *  import. Returns undefined if `name` is not (in scope) a namespace
   *  binding — the caller should fall back to ordinary GetExpr handling
   *  in that case. A namespace binding whose table doesn't contain
   *  `member` resolves to a fresh var, not undefined — same permissive
   *  "don't invent a false error over something this pass can't fully
   *  resolve" policy as everywhere else in this file (e.g. IdentExpr's
   *  unbound-name branch). */
  lookupMember(name: string, member: string): PfunType | undefined | null {
    const entry = this.resolveEntry(name);
    if (!entry || entry.tag !== 'namespace') return null;
    return entry.table.get(member); // undefined here means "namespace known, member not found" — distinct from null ("not a namespace at all")
  }

  child(): CGenEnv { return new CGenEnv(this); }
}

// ─── Type registry for constraint generation ──────────────────────────────────
//
// Tracks union/record type names so RecordExpr nodes can produce Named types.
// Mirrors the TypeRegistry in typechecker.ts; kept separate so this module
// has no dependency on typechecker.ts.

class CGenRegistry {
  private constructors = new Map<string, string | undefined>();
  private singletons   = new Map<string, string>();

  registerPlain(name: string): void { this.constructors.set(name, undefined); }

  registerUnion(unionName: string, variants: { name: string; fields: string[] }[]): void {
    for (const v of variants) {
      this.constructors.set(v.name, unionName);
      if (v.fields.length === 0) this.singletons.set(v.name, unionName);
    }
  }

  lookupConstructor(name: string): { name: string; unionName?: string } | null {
    if (!this.constructors.has(name)) return null;
    return { name, unionName: this.constructors.get(name) };
  }

  lookupSingleton(name: string): { name: string; unionName: string } | null {
    const u = this.singletons.get(name);
    return u ? { name, unionName: u } : null;
  }
}

// ─── Built-in environment ────────────────────────────────────────────────────

const _INT:   PfunType = { kind: 'Int'   };
const _FLOAT: PfunType = { kind: 'Float' };
const _BOOL:  PfunType = { kind: 'Bool'  };
const _STR:   PfunType = { kind: 'Str'   };
const _CHAR:  PfunType = { kind: 'Char'  };
const _BYTE:  PfunType = { kind: 'Byte'  };
const _UNK:   PfunType = { kind: 'Unknown' };

/** Shorthand for a plain Named type with no unionName — an opaque builtin
 *  value (e.g. a DB Connection) that has no Pfun-visible variant tag. */
function named(name: string): PfunType { return { kind: 'Named', name }; }

/** Shorthand for a Named type that IS a union variant — carries unionName
 *  so exhaustiveness checking (typechecker.ts's checkExhaustiveness) can
 *  find it, exactly like a user-declared union's variants. */
function variant(name: string, unionName: string): PfunType {
  return { kind: 'Named', name, unionName };
}

/**
 * Shorthand for "this returns SOME value of union `unionName`, but which
 * specific variant is determined only at runtime, not statically" — e.g.
 * readFile(path) -> Result: it's definitely a Result, but whether it's
 * Ok or Err depends on whether the file actually exists when the program
 * runs, which static checking cannot know. Sets BOTH name and unionName
 * to the union's own name (Result/Result, HttpResult/HttpResult, ...)
 * rather than to any specific variant — this is what makes
 * checkExhaustiveness's `registry.variantsOf(subjectType.unionName)`
 * lookup succeed for a builtin's return value the same way it would for
 * a value built via a known variant constructor, while name===unionName
 * specifically signals formatType (above) to suppress the otherwise-
 * redundant "Result.Result" prefix in unrelated error messages (e.g.
 * misusing the Result value itself in arithmetic) — see formatType's own
 * Named case for that exact suppression logic, and this function's call
 * sites in BUILTIN_FUNCTION_TYPES below for which builtins need this
 * (vs. `named()`, for genuinely tag-less opaque values like a DB
 * Connection, which has no variants to ever exhaustiveness-check).
 */
function unionOfUnknownVariant(unionName: string): PfunType {
  return { kind: 'Named', name: unionName, unionName };
}

function fn(params: PfunType[], ret: PfunType): PfunType {
  return { kind: 'Fn', params, ret };
}

const _STR_LIST:  PfunType = { kind: 'List', element: _STR  };
const _BYTE_LIST: PfunType = { kind: 'List', element: _BYTE };
const _STR_DICT:  PfunType = { kind: 'Dict', key: _STR, value: _STR };

/**
 * Real `Fn` (and constant) signatures for every builtin this project ships
 * — both the always-in-scope globals (length, print, ...; previously
 * hardcoded directly into buildCGenBuiltinEnv below) AND every statically
 * typeable export of the `import`-able builtin modules (io, file, json,
 * math, async, http, db/postgresql, db/mariadb) — checkProgram
 * (wholeProgramCheck.ts) looks up THIS SAME table for a builtin module's
 * exports, so a function's signature is identical whether it's reached
 * via the always-in-scope path or via an explicit `import`, by
 * construction (one shared source, not two tables that could drift).
 *
 * DELIBERATELY ABSENT (left for the resolver's UNKNOWN fallback — see
 * wholeProgramCheck.ts's builtin-module branch): any function whose real
 * behavior is GENUINELY polymorphic in a way this type system cannot
 * express without becoming WRONG for half its legitimate uses. Concretely:
 *   - mathlib's abs/sign/min/max/clamp: accept EITHER Int or Float and
 *     return the SAME kind they received (confirmed via interpreter.ts's
 *     own runtime logic and cgenBinary's parallel Int/Float-mixing
 *     special-casing for arithmetic operators) — there is no
 *     generics/let-polymorphism mechanism in this type system (every
 *     TypeImportTable entry is exactly one fixed PfunType), so a
 *     monomorphic Fn signature for these would silently reject a
 *     perfectly valid `abs(-5.0)` (or `abs(-5)`, whichever kind wasn't
 *     chosen) as a static type error. Unknown — which unifies with
 *     anything, see ast.ts's UNKNOWN docs — is the honest answer here,
 *     not a placeholder to fill in later.
 *   - jsonDeserialize's resolved value: its real shape depends entirely on
 *     the JSON text at runtime, which is unknowable statically by
 *     definition — Unknown for the Option's inner type is correct, not a
 *     gap.
 *
 * Builtin union variant types use `variant()` (carries unionName, so
 * checkExhaustiveness's registry.variantsOf lookup succeeds — see
 * wholeProgramCheck.ts's builtin-module branch for the matching
 * UnionImportTable entries that make this resolvable at all) rather than
 * `named()` (no unionName — used only for genuinely tag-less opaque
 * values like a DB Connection, which has no Pfun-visible variant to match
 * on in the first place).
 *
 * NAME COLLISION NOTE: filelib's readChar(handle) -> ReadResult and
 * iolib's readChar() -> Option<Char> are DIFFERENT functions that happen
 * to share a name. Map keys here are by name only, so only one can occupy
 * 'readChar' — iolib's wins below (it's the one a typical
 * `import * from "io"` program actually uses), and filelib's import path
 * gets Unknown instead of a wrong, misleading signature. This is no worse
 * than the runtime's own behavior: importing BOTH `io` and `file` star-
 * style already throws "'readChar' is already defined" at import time
 * (interpreter.ts's bindExport, pre-existing, unrelated to this table) —
 * there is no real program where both meanings are simultaneously valid
 * to disambiguate between in the first place.
 */
export const BUILTIN_FUNCTION_TYPES: Map<string, PfunType> = new Map<string, PfunType>([

  // ── Always-in-scope polymorphic builtins (single-argument) ───────────────
  // Unknown param: any argument accepted without constraint. Concrete
  // return: callers can still resolve e.g. `length(xs)`'s result type.
  ['length',     fn([_UNK], _INT) ],
  ['asc',        fn([_UNK], _INT) ],
  ['chr',        fn([_UNK], _CHAR)],
  ['isInfinite', fn([_UNK], _BOOL)],
  ['__str__',    fn([_UNK], _STR) ],

  // ── Always-in-scope polymorphic builtins (two-argument) ──────────────────
  ['has',   fn([_UNK, _UNK], _BOOL)],
  ['join',  fn([_UNK, _STR], _STR) ],
  ['split', fn([_STR, _STR], _STR_LIST)],

  // ── Constants ──────────────────────────────────────────────────────────
  ['true',  _BOOL],
  ['false', _BOOL],
  ['None',  variant('None', 'Option')],

  // ── io ─────────────────────────────────────────────────────────────────
  // print/println accept any type and return it unchanged (see
  // iolib.ts) — Unknown for both is correct, not a gap: the return value
  // IS whatever was passed in, which Unknown represents exactly as well
  // as a (fictional) generic `T -> T` would, without needing generics.
  ['print',       fn([_UNK], _UNK)],
  ['println',     fn([_UNK], _UNK)],
  ['flushStdout', fn([], _BOOL)],
  ['readChar',    fn([], { kind: 'Option', inner: _CHAR })], // see this table's header's NAME COLLISION NOTE
  ['readln',      fn([], { kind: 'Option', inner: _STR })],
  ['scriptArgs',  fn([], _STR_LIST)],
  ['getEnv',      fn([_STR], { kind: 'Option', inner: _STR })],
  ['envVars',     fn([], _STR_DICT)],

  // ── json ───────────────────────────────────────────────────────────────
  ['jsonSerialize',   fn([_UNK], { kind: 'Option', inner: _STR })],
  // The deserialized value's shape is unknowable statically (see this
  // table's header) — Unknown for Option's inner is deliberate, not a gap.
  ['jsonDeserialize', fn([_STR], { kind: 'Option', inner: _UNK })],

  // ── math ───────────────────────────────────────────────────────────────
  // abs/sign/min/max/clamp deliberately ABSENT — see this table's header.
  ['sqrt',  fn([_FLOAT], _FLOAT)],
  ['cbrt',  fn([_FLOAT], _FLOAT)],
  ['exp',   fn([_FLOAT], _FLOAT)],
  ['log',   fn([_FLOAT], _FLOAT)],
  ['log2',  fn([_FLOAT], _FLOAT)],
  ['log10', fn([_FLOAT], _FLOAT)],
  ['pow',   fn([_FLOAT, _FLOAT], _FLOAT)],
  ['hypot', fn([_FLOAT, _FLOAT], _FLOAT)],
  ['fmod',  fn([_FLOAT, _FLOAT], _FLOAT)],
  ['lerp',  fn([_FLOAT, _FLOAT, _FLOAT], _FLOAT)],
  ['sin',   fn([_FLOAT], _FLOAT)],
  ['cos',   fn([_FLOAT], _FLOAT)],
  ['tan',   fn([_FLOAT], _FLOAT)],
  ['asin',  fn([_FLOAT], _FLOAT)],
  ['acos',  fn([_FLOAT], _FLOAT)],
  ['atan',  fn([_FLOAT], _FLOAT)],
  ['atan2', fn([_FLOAT, _FLOAT], _FLOAT)],
  ['sinh',  fn([_FLOAT], _FLOAT)],
  ['cosh',  fn([_FLOAT], _FLOAT)],
  ['tanh',  fn([_FLOAT], _FLOAT)],
  ['pi',  _FLOAT],
  ['e',   _FLOAT],
  ['tau', _FLOAT],
  ['inf', _FLOAT],
  ['nan', _FLOAT],

  // ── async ──────────────────────────────────────────────────────────────
  // ret is the POST-AWAIT resolved type (Nil) — see AwaitExpr's case in
  // cgenExpr for why that convention is what makes this signature useful
  // at every realistic call site (`await sleep(ms)`), not just in theory.
  ['sleep', fn([_INT], { kind: 'Nil' })],

  // ── http ───────────────────────────────────────────────────────────────
  // httpGet/httpGetBytes's ret is likewise the post-await resolved type
  // (HttpResult), same convention as sleep above.
  ['httpGet',      fn([_STR], unionOfUnknownVariant('HttpResult'))],
  ['httpGetBytes', fn([_STR], unionOfUnknownVariant('HttpResult'))],
  // handler's required shape (async proc(req, res) with Request/Response's
  // own nested native-function fields) isn't expressible as a parameter
  // Fn type without modeling those nested shapes too — Unknown for that
  // one parameter; port and the overall return (Nil) are still real.
  ['httpListen', fn([_INT, _UNK], { kind: 'Nil' })],

  // ── file ───────────────────────────────────────────────────────────────
  ['fileExists', fn([_STR], _BOOL)],
  ['removeFile', fn([_STR], unionOfUnknownVariant('Result'))],
  ['touchFile',  fn([_STR], unionOfUnknownVariant('Result'))],
  ['fileOpen',   fn([_STR, _UNK], unionOfUnknownVariant('Result'))], // mode: Read|Write|Append — a 3-variant union argument, same "no param-side union typing" gap as httpListen's handler
  ['fileClose',  fn([_UNK], unionOfUnknownVariant('Result'))],
  ['readLine',   fn([_UNK], unionOfUnknownVariant('ReadResult'))],
  ['readFile',   fn([_STR], unionOfUnknownVariant('Result'))],
  ['writeChar',  fn([_UNK, _CHAR], unionOfUnknownVariant('Result'))],
  ['writeLine',  fn([_UNK, _STR], unionOfUnknownVariant('Result'))],
  ['writeFile',  fn([_STR, _STR], unionOfUnknownVariant('Result'))],
  ['readByte',   fn([_UNK], unionOfUnknownVariant('ReadResult'))],
  ['writeByte',  fn([_UNK, _BYTE], unionOfUnknownVariant('Result'))],
  ['readBytes',  fn([_UNK, _INT], unionOfUnknownVariant('ReadResult'))],
  ['writeBytes', fn([_UNK, _BYTE_LIST], unionOfUnknownVariant('Result'))],
  ['makeBuffer',     fn([_UNK], _UNK)],
  ['readBuffer',     fn([_UNK, _INT, _UNK], unionOfUnknownVariant('Result'))],
  ['writeBuffer',    fn([_UNK, _UNK], unionOfUnknownVariant('Result'))],
  ['bufferToBytes',  fn([_UNK], _BYTE_LIST)],
  ['bufferToString', fn([_UNK], _STR)],
  ['bufferLength',   fn([_UNK], _INT)],

  // ── db/postgresql, db/mariadb ──────────────────────────────────────────
  // Identical signatures across both modules (same function names, same
  // contract — see dblib.ts) — one shared entry serves both imports
  // correctly; ret is the post-await resolved type, same convention as
  // sleep/httpGet above.
  ['dbConnect', fn([_STR], unionOfUnknownVariant('DbResult'))],
  ['dbQuery',   fn([_UNK, _STR, _UNK], unionOfUnknownVariant('DbResult'))],
  ['dbClose',   fn([_UNK], unionOfUnknownVariant('DbResult'))],
]);

/**
 * Build the constraint-generation environment pre-populated with builtin
 * signatures, for the ALWAYS-IN-SCOPE subset of BUILTIN_FUNCTION_TYPES —
 * the names a Pfun program can use without any `import` at all. Builtin
 * MODULE exports (io, file, math, ...) are deliberately NOT seeded here:
 * those only become available via an explicit `import`, resolved through
 * wholeProgramCheck.ts's checkProgram (which looks up the very same
 * BUILTIN_FUNCTION_TYPES table for a builtin module's actual exports) —
 * seeding them here too would make them incorrectly available WITHOUT an
 * import, which isn't how the runtime actually behaves (confirmed: e.g.
 * `fileExists` without `import * from "file"` fails at runtime with
 * "Undefined variable", a separate, pre-existing, harmless inconsistency
 * this function used to have for fileExists specifically before this
 * table existed — not reintroduced here).
 */
function buildCGenBuiltinEnv(): CGenEnv {
  const env = new CGenEnv();
  const alwaysInScope = [
    'length', 'asc', 'chr', 'isInfinite', '__str__',
    'has', 'join', 'split',
    'true', 'false', 'None',
    'print', 'println', 'flushStdout', 'readln',
  ];
  for (const name of alwaysInScope) {
    const ty = BUILTIN_FUNCTION_TYPES.get(name);
    if (ty) env.define(name, ty);
  }
  return env;
}

// ─── Constraint generator ─────────────────────────────────────────────────────

/**
 * Walk `expr`, assign a fresh TyVar to each sub-expression (stored as
 * `inferredType`), and append equality constraints to `cs`.
 *
 * Returns the type assigned to this expression (always a TyVar or a
 * concrete type for literals and known identifiers).
 */
function cgenExpr(
  expr: Expr,
  env:      CGenEnv,
  registry: CGenRegistry,
  cs:       ConstraintSet,
): PfunType {
  const pos = expr.pos;
  let t: PfunType;

  switch (expr.type) {

    // ── Literals — concrete types, no constraints needed ────────────────────
    case 'IntExpr':   t = _INT;   break;
    case 'FloatExpr': t = _FLOAT; break;
    case 'BoolExpr':  t = _BOOL;  break;
    case 'StrExpr':   t = _STR;   break;
    case 'CharExpr':  t = _CHAR;  break;
    case 'ByteExpr':  t = _BYTE;  break;

    // ── Identifiers — look up or assign a fresh var ──────────────────────────
    case 'IdentExpr': {
      const bound = env.lookup(expr.name);
      if (bound !== undefined) {
        t = bound;
      } else {
        const singleton = registry.lookupSingleton(expr.name);
        if (singleton) {
          t = { kind: 'Named', name: singleton.name, unionName: singleton.unionName };
        } else {
          // Unbound name — assign a fresh var; unification will constrain it
          // if the name is later resolved (e.g. from a module import).
          t = freshVar();
        }
      }
      break;
    }

    // ── Grouping ─────────────────────────────────────────────────────────────
    case 'GroupExpr':
      t = cgenExpr(expr.expression, env, registry, cs);
      break;

    // ── Unary operators ──────────────────────────────────────────────────────
    case 'UnaryExpr': {
      const rt = cgenExpr(expr.right, env, registry, cs);
      if (expr.operator === 'BooleanNot') {
        cs.push(constraint(rt, _BOOL, pos));
        t = _BOOL;
      } else if (expr.operator === 'MinusToken') {
        // Mirrors cgenBinary's arithmetic-operator treatment of Int/Float
        // mixing (see that function's own docblock for the full
        // rationale): unary minus preserves whichever numeric kind the
        // operand actually is — interpreter.ts's own UnaryExpr evaluation
        // does `return -val`, and JS's unary minus on a bigint (Int)
        // produces a bigint, on a number (Float) produces a number, so
        // -5 stays Int and -5.5 stays Float at runtime; the type checker
        // must agree, not force every negation through Int. Byte is
        // deliberately NOT included here (a genuine type error, not an
        // oversight): PfunByte has no valueOf/operator overload, so
        // `-someByteValue` at the interpreter level coerces through JS's
        // default object-to-primitive conversion and produces nonsense
        // (NaN-ish), not a meaningful negated byte — there is no runtime
        // behavior worth a type checker greenlighting here.
        if (rt.kind === 'Float') {
          t = _FLOAT;
        } else {
          // Int, Unknown, or an unresolved TyVar: constrain to Int (the
          // common case, and the safe default for an as-yet-undetermined
          // numeric kind) — mirrors cgenBinary's own arithmetic-operator
          // fallback, which constrains both operands to Int rather than
          // leaving them unconstrained whenever neither side is already
          // known to be Float.
          cs.push(constraint(rt, _INT, pos));
          t = _INT;
        }
      } else {
        t = freshVar();
      }
      break;
    }

    // ── Binary operators ─────────────────────────────────────────────────────
    case 'BinaryExpr': {
      const lt = cgenExpr(expr.left,  env, registry, cs);
      const rt = cgenExpr(expr.right, env, registry, cs);
      t = cgenBinary(expr.operator, lt, rt, cs, pos);
      break;
    }

    // ── Ternary ──────────────────────────────────────────────────────────────
    case 'TernaryExpr': {
      const ct = cgenExpr(expr.condition,  env, registry, cs);
      const tt = cgenExpr(expr.thenBranch, env, registry, cs);
      const et = cgenExpr(expr.elseBranch, env, registry, cs);
      cs.push(constraint(ct, _BOOL, pos));  // condition must be Bool
      cs.push(constraint(tt, et,    pos));  // branches must agree
      t = tt;
      break;
    }

    // ── List literals ────────────────────────────────────────────────────────
    case 'ListExpr': {
      const elemVar = freshVar();
      // For record elements: track the first occurrence's fieldTypes per
      // record name so we can push field-by-field constraints on each
      // subsequent occurrence with the same name. This is what catches
      // [Pair{"k1","v1"}, Pair{1,2}] — the name-level elemVar constraint
      // (below) would trivially succeed (both are Named{Pair}), but the
      // field constraints catch the Str-vs-Int disagreement.
      // Only applied to plain records (no unionName) — union variants with
      // the same union are deliberately allowed to coexist in a list (see
      // Named case in unify(): [Square{5}, Circle{3}] is valid List<Shape>).
      const firstFieldTypes = new Map<string, PfunType[]>();

      for (const el of expr.elements) {
        const et = cgenExpr(el, env, registry, cs);
        cs.push(constraint(et, elemVar, el.pos));

        // Field-by-field cross-element constraint for plain records
        if (et.kind === 'Named' && et.unionName === undefined && et.fieldTypes && et.fieldTypes.length > 0) {
          const seen = firstFieldTypes.get(et.name);
          if (seen === undefined) {
            firstFieldTypes.set(et.name, et.fieldTypes);
          } else if (seen.length === et.fieldTypes.length) {
            // Same record name seen before — constrain field-by-field against
            // the first occurrence. The solver reports each mismatch
            // independently, naming the position just like any other type error.
            for (let i = 0; i < seen.length; i++) {
              cs.push(constraint(seen[i], et.fieldTypes[i], el.pos));
            }
          }
          // Field-count mismatch (seen.length !== et.fieldTypes.length) is
          // left to the existing name-level elemVar unification — both are
          // Named{Pair} and unify fine there, but the interpreter will catch
          // the wrong-arity construction at runtime, same as today.
        }
      }
      t = { kind: 'List', element: elemVar };
      break;
    }

    // ── Record / union variant constructors ──────────────────────────────────
    case 'RecordExpr': {
      // Collect each field's inferred type — previously discarded, now kept
      // so that ListExpr can do field-by-field cross-element comparison for
      // records in the same list literal (see ListExpr case below).
      // Only attached for plain (non-union) records; union variants carry a
      // unionName that already participates in unification via the Named case,
      // and their field-type consistency is enforced separately at runtime.
      const fieldTypes = expr.fields.map(f => cgenExpr(f.value, env, registry, cs));
      const entry = registry.lookupConstructor(expr.name);
      if (entry) {
        t = { kind: 'Named', name: entry.name, unionName: entry.unionName };
      } else {
        // Unknown constructor (e.g. cross-module import not yet resolved) —
        // still attach fieldTypes so the list check below can use them if
        // other elements in the same list do have full type info.
        t = { kind: 'Named', name: expr.name, fieldTypes };
      }
      if (!entry || entry.unionName === undefined) {
        // Plain record (not a union variant): attach field types.
        (t as any).fieldTypes = fieldTypes;
      }
      break;
    }

    // ── Assignment ───────────────────────────────────────────────────────────
    case 'AssignExpr': {
      const vt = cgenExpr(expr.value, env, registry, cs);
      const bound = env.lookup(expr.name);
      if (bound !== undefined) cs.push(constraint(bound, vt, pos));
      t = vt;
      break;
    }

    // ── Lambda ───────────────────────────────────────────────────────────────
    case 'LambdaExpr': {
      const lambdaEnv = env.child();
      const paramTypes = expr.params.map(p => {
        const v = freshVar();
        lambdaEnv.define(p, v);
        return v;
      });
      const retType = cgenExpr(expr.body, lambdaEnv, registry, cs);
      t = { kind: 'Fn', params: paramTypes, ret: retType };
      break;
    }

    // ── Function call ─────────────────────────────────────────────────────────
    case 'CallExpr': {
      const calleeType = cgenExpr(expr.callee, env, registry, cs);
      const argTypes   = expr.args.map(a => cgenExpr(a, env, registry, cs));
      const retVar     = freshVar();

      // Currying: if callee is a known Fn with more params than args supplied,
      // return a partially-applied Fn for the remaining params rather than
      // constraining the full arity.
      if (calleeType.kind === 'Fn' &&
          calleeType.params.length > argTypes.length &&
          argTypes.length > 0) {
        // Constrain each supplied arg against its corresponding param
        argTypes.forEach((at, i) => {
          cs.push(constraint(at, calleeType.params[i], pos));
        });
        // Return type is a Fn over the remaining params
        t = {
          kind: 'Fn',
          params: calleeType.params.slice(argTypes.length),
          ret: calleeType.ret,
        };
        break;
      }

      // Normal call — constrain callee to be a function from arg types to retVar
      cs.push(constraint(calleeType, { kind: 'Fn', params: argTypes, ret: retVar }, pos));
      t = retVar;
      break;
    }

    // ── Match ─────────────────────────────────────────────────────────────────
    case 'MatchExpr': {
      const subjectType = cgenExpr(expr.subject, env, registry, cs);
      const resultVar = freshVar();
      for (const arm of expr.arms) {
        const armEnv = env.child();
        if (arm.binding !== null) {
          const bindingVar = freshVar();
          armEnv.define(arm.binding, bindingVar);
          // A TAGGED arm's binding (`Circle c -> ...`) is really the
          // variant's own record type, not the subject's union type —
          // this pass doesn't track per-variant record types for
          // bindings (same pre-existing Unknown gap as GetExpr's "field
          // type is unknown without a record schema"), so leave it an
          // unconstrained fresh var, same as before this case existed.
          // An UNTAGGED arm (`n -> ...` / `n where n > 0 -> ...`) binds
          // the subject's value directly with no check at all — so its
          // type genuinely IS the subject's type, and unifying them here
          // is what lets a guard like `n + "oops"` get flagged as a real
          // type error instead of silently passing against an
          // unconstrained var.
          if (arm.variant === null) cs.push(constraint(bindingVar, subjectType, arm.guard?.pos ?? arm.body.pos));
        }
        if (arm.guard) cgenExpr(arm.guard, armEnv, registry, cs);
        const armType = cgenExpr(arm.body, armEnv, registry, cs);
        cs.push(constraint(armType, resultVar, arm.body.pos));
      }
      t = resultVar;
      break;
    }

    // ── Get (field access) ────────────────────────────────────────────────────
    case 'GetExpr': {
      // Namespace-qualified access: `X.foo` where X is bound via `import
      // * as X from "..."`. If X resolves to a namespace binding, look up
      // foo's real type in that module's table instead of falling
      // through to the generic "field type unknown" fresh var below —
      // this is the one case where this pass *can* know a GetExpr's type
      // precisely, since X.foo is a top-level module export, not an
      // arbitrary record field with no known schema.
      if (expr.object.type === 'IdentExpr') {
        const memberType = env.lookupMember(expr.object.name, expr.name);
        if (memberType !== null) {
          // X IS a namespace binding (memberType is undefined only if
          // `foo` isn't in its table, in which case fall through to a
          // fresh var just below, same permissive policy as elsewhere).
          cgenExpr(expr.object, env, registry, cs);
          t = memberType ?? freshVar();
          break;
        }
      }
      cgenExpr(expr.object, env, registry, cs);
      // Field type is unknown without a record schema — fresh var
      t = freshVar();
      break;
    }

    // ── Everything else — recurse, assign fresh var ───────────────────────────
    case 'ComprehensionExpr': {
      const compEnv = env.child();
      for (const g of expr.generators) {
        cgenExpr(g.source, compEnv, registry, cs);
        compEnv.define(g.variable, freshVar());
      }
      if (expr.guard) cgenExpr(expr.guard, compEnv, registry, cs);
      const bodyType = cgenExpr(expr.body, compEnv, registry, cs);
      t = { kind: 'List', element: bodyType };
      break;
    }
    case 'DictExpr': {
      for (const e of expr.entries) {
        cgenExpr(e.key,   env, registry, cs);
        cgenExpr(e.value, env, registry, cs);
      }
      t = freshVar();
      break;
    }
    case 'ArrayExpr': {
      for (const e of expr.elements) cgenExpr(e, env, registry, cs);
      t = freshVar();
      break;
    }
    case 'IndexExpr': {
      cgenExpr(expr.object, env, registry, cs);
      cgenExpr(expr.index,  env, registry, cs);
      t = freshVar();
      break;
    }
    case 'IndexAssignExpr': {
      cgenExpr(expr.object, env, registry, cs);
      cgenExpr(expr.index,  env, registry, cs);
      cgenExpr(expr.value,  env, registry, cs);
      t = freshVar();
      break;
    }
    case 'BlockExpr': {
      const blockEnv = env.child();
      for (const s of expr.statements) cgenStmt(s, blockEnv, registry, cs);
      t = freshVar();
      break;
    }
    // ── Await ─────────────────────────────────────────────────────────────
    // `await expr` is type-transparent: its type IS expr's type, unchanged.
    // This relies on a deliberate convention for every async-returning
    // builtin's Fn signature in BUILTIN_FUNCTION_TYPES below: `ret`
    // describes the value AFTER resolution (e.g. sleep: Int -> Nil, not
    // Int -> Promise<Nil> — PfunType has no Promise representation at
    // all), so `await sleep(ms)` types as Nil directly through this case,
    // with zero special-casing needed for "the type of a promise's inner
    // value" beyond passing the operand's own type straight through. The
    // cost: a raw, un-awaited call like `let p = sleep(ms);` (legal but
    // unusual — p is actually a JS Promise object at runtime, not a Nil)
    // gets the SAME Nil type as the awaited form, which is technically
    // inaccurate for that one un-awaited case. Accepted: every realistic
    // use of these natives is behind `await`, and the alternative (no
    // AwaitExpr case at all, the prior behavior — see the default case
    // below) meant `await sleep(100) + 5` only failed at RUNTIME, never
    // statically, regardless of how precisely sleep() were typed — this
    // case is what makes a real Fn signature for any async builtin worth
    // writing at all.
    case 'AwaitExpr': {
      t = cgenExpr(expr.value, env, registry, cs);
      break;
    }
    default:
      t = freshVar();
  }

  expr.inferredType = t;
  return t;
}

// ─── Binary operator constraint rules ────────────────────────────────────────

function cgenBinary(
  op:  string,
  lt:  PfunType,
  rt:  PfunType,
  cs:  ConstraintSet,
  pos: SourcePos | undefined,
): PfunType {
  switch (op) {
    // Comparisons — operands must agree, result is Bool
    case 'EqualToken':
    case 'NotEqualToken':
      cs.push(constraint(lt, rt, pos));
      return _BOOL;

    case 'LessToken':
    case 'GreaterToken':
    case 'LessEqualToken':
    case 'GreaterEqualToken':
      cs.push(constraint(lt, rt, pos));
      cs.push(constraint(lt, _INT, pos)); // Pfun ordering is defined on Int
      return _BOOL;

    // Boolean operators
    case 'BooleanAnd':
    case 'BooleanOr':
      cs.push(constraint(lt, _BOOL, pos));
      cs.push(constraint(rt, _BOOL, pos));
      return _BOOL;

    // Bitwise operators — operands must agree (both Byte or both Int);
    // result is the same type. Shifts additionally accept a Byte shift amount.
    case 'BitAndToken':
    case 'BitOrToken':
      cs.push(constraint(lt, rt, pos));
      return lt;

    case 'ShiftLeftToken':
    case 'ShiftRightToken':
      // Left operand determines result type; shift amount may be Int or Byte.
      return lt;

    // Arithmetic (-, *, /, %) — mirrors the interpreter's real semantics
    // (see evaluateBinaryGen in interpreter.ts):
    //   - Byte op Byte -> Byte (no mixing with Int/Float at all — the
    //     interpreter's Byte arithmetic branch requires BOTH operands to be
    //     PfunByte; a Byte mixed with an Int/Float is not supported).
    //   - Int op Int -> Int; Int/Float mixed (in either order) -> Float
    //     (the interpreter promotes bigint to number whenever either side
    //     is already a float). Float op Float -> Float.
    // A Byte mixed with an Int/Float, or any other kind, is a genuine type
    // error — unify() will report it once neither numeric special case
    // below applies.
    case 'MinusToken':
    case 'StarToken':
    case 'SlashToken':
    case 'PercentToken': {
      if (lt.kind === 'Byte' || rt.kind === 'Byte') {
        cs.push(constraint(lt, _BYTE, pos));
        cs.push(constraint(rt, _BYTE, pos));
        return _BYTE;
      }
      if (lt.kind === 'Float' || rt.kind === 'Float') {
        // Int/Float mixing is allowed; constrain each operand individually
        // to Int-or-Float rather than to each other, so e.g. `1 - 2.5` and
        // `2.5 - 1` both type-check without forcing the Int side to Float
        // syntactically. Unification has no "numeric" type class, so this
        // is expressed as two independent soft checks instead of a single
        // unify(lt, rt) — matching PlusToken's existing Str special case
        // immediately below, which takes the same approach for the same
        // reason.
        if (lt.kind !== 'Int' && lt.kind !== 'Float' && lt.kind !== 'Unknown' && lt.kind !== 'TyVar')
          cs.push(constraint(lt, _FLOAT, pos));
        if (rt.kind !== 'Int' && rt.kind !== 'Float' && rt.kind !== 'Unknown' && rt.kind !== 'TyVar')
          cs.push(constraint(rt, _FLOAT, pos));
        return _FLOAT;
      }
      cs.push(constraint(lt, _INT, pos));
      cs.push(constraint(rt, _INT, pos));
      return _INT;
    }

    // Plus — polymorphic with string coercion awareness.
    // If either operand is already Str, the result is Str and we don't
    // constrain the other operand (runtime stringifies it).
    // Byte/numeric mixing rules mirror the other arithmetic operators above.
    case 'PlusToken': {
      if (lt.kind === 'Str' || rt.kind === 'Str') return _STR;
      if (lt.kind === 'Byte' || rt.kind === 'Byte') {
        cs.push(constraint(lt, _BYTE, pos));
        cs.push(constraint(rt, _BYTE, pos));
        return _BYTE;
      }
      if (lt.kind === 'Float' || rt.kind === 'Float') {
        if (lt.kind !== 'Int' && lt.kind !== 'Float' && lt.kind !== 'Unknown' && lt.kind !== 'TyVar')
          cs.push(constraint(lt, _FLOAT, pos));
        if (rt.kind !== 'Int' && rt.kind !== 'Float' && rt.kind !== 'Unknown' && rt.kind !== 'TyVar')
          cs.push(constraint(rt, _FLOAT, pos));
        return _FLOAT;
      }
      cs.push(constraint(lt, rt, pos));
      return lt;
    }

    default: {
      const result = freshVar();
      return result;
    }
  }
}

// ─── Statement constraint generator ──────────────────────────────────────────

function cgenStmt(
  stmt:     Stmt,
  env:      CGenEnv,
  registry: CGenRegistry,
  cs:       ConstraintSet,
): void {
  switch (stmt.type) {

    case 'LetStmt': {
      const t = cgenExpr(stmt.initializer, env, registry, cs);
      stmt.inferredType = t;
      env.define(stmt.name, t);
      break;
    }

    case 'VarStmt': {
      const t = cgenExpr(stmt.initializer, env, registry, cs);
      stmt.inferredType = t;
      env.define(stmt.name, t);
      break;
    }

    case 'FunctionStmt': {
      // Assign fresh vars to all params and a fresh var to the return type.
      const paramVars = stmt.params.map(() => freshVar() as PfunType);
      const retVar    = freshVar() as PfunType;
      // Pre-register with TyVar params so recursive calls type-check.
      env.define(stmt.name, { kind: 'Fn', params: paramVars, ret: retVar });
      // Walk body in a child scope with params bound to their vars.
      const bodyEnv = env.child();
      stmt.params.forEach((p, i) => bodyEnv.define(p, paramVars[i]));
      const bodyCs: ConstraintSet = [];
      for (const s of stmt.body) cgenStmt(s, bodyEnv, registry, bodyCs);
      collectReturnExprs(stmt.body).forEach(e => {
        if (e.inferredType) bodyCs.push(constraint(e.inferredType, retVar, e.pos));
      });
      // Solve body constraints locally and apply to get concrete param/ret types.
      // Params that remain as TyVars are generalised to Unknown so each call
      // site is independent (prevents cross-call-site type pollution).
      const { subst: bodySubst } = solveConstraints(bodyCs);
      const resolvedParams = paramVars.map(p => {
        const r = bodySubst.apply(p);
        return r.kind === 'TyVar' ? { kind: 'Unknown' } as PfunType : r;
      });
      const resolvedRet = (() => {
        const r = bodySubst.apply(retVar);
        return r.kind === 'TyVar' ? { kind: 'Unknown' } as PfunType : r;
      })();
      // Re-register with resolved types; also push body constraints to global set.
      env.define(stmt.name, { kind: 'Fn', params: resolvedParams, ret: resolvedRet });
      cs.push(...bodyCs);
      break;
    }

    case 'ProcedureStmt': {
      const paramVars = stmt.params.map(() => freshVar() as PfunType);
      const retVar    = freshVar() as PfunType;
      env.define(stmt.name, { kind: 'Fn', params: paramVars, ret: retVar });
      const bodyEnv = env.child();
      stmt.params.forEach((p, i) => bodyEnv.define(p, paramVars[i]));
      const bodyCs: ConstraintSet = [];
      for (const s of stmt.body) cgenStmt(s, bodyEnv, registry, bodyCs);
      collectReturnExprs(stmt.body).forEach(e => {
        if (e.inferredType) bodyCs.push(constraint(e.inferredType, retVar, e.pos));
      });
      const { subst: bodySubst } = solveConstraints(bodyCs);
      const resolvedParams = paramVars.map(p => {
        const r = bodySubst.apply(p);
        return r.kind === 'TyVar' ? { kind: 'Unknown' } as PfunType : r;
      });
      const resolvedRet = (() => {
        const r = bodySubst.apply(retVar);
        return r.kind === 'TyVar' ? { kind: 'Unknown' } as PfunType : r;
      })();
      env.define(stmt.name, { kind: 'Fn', params: resolvedParams, ret: resolvedRet });
      cs.push(...bodyCs);
      break;
    }

    case 'ReturnStmt':
      if (stmt.value) cgenExpr(stmt.value, env, registry, cs);
      break;

    case 'ExprStmt':
      cgenExpr(stmt.expression, env, registry, cs);
      break;

    case 'EvalStmt':
      cgenExpr(stmt.expression, env, registry, cs);
      break;

    case 'BlockStmt': {
      const blockEnv = env.child();
      for (const s of stmt.statements) cgenStmt(s, blockEnv, registry, cs);
      break;
    }

    case 'IfStmt':
      cgenExpr(stmt.condition, env, registry, cs);
      cgenStmt(stmt.thenBranch, env, registry, cs);
      if (stmt.elseBranch) cgenStmt(stmt.elseBranch, env, registry, cs);
      break;

    case 'ExportStmt':
      cgenStmt(stmt.declaration, env, registry, cs);
      break;

    case 'TypeStmt':
      registry.registerPlain(stmt.name);
      break;

    case 'UnionTypeStmt':
      registry.registerUnion(stmt.name, stmt.variants);
      break;

    case 'ImportStmt':
      // Re-bind here too (not just in seedAllImports's pre-pass) so a
      // *nested* import (e.g. inside a function body, reached only when
      // cgenStmt's walk actually gets there) is still bound in the
      // correct (possibly inner, function-body) env, not just the
      // top-level one the pre-pass seeded. See bindImport's docblock.
      bindImport(stmt, env);
      break;
  }
}

// ─── Return expression harvesting ────────────────────────────────────────────

/**
 * Collect all return expression nodes in a function body (shallow —
 * does not recurse into nested function/proc definitions).
 */
function collectReturnExprs(body: Stmt[]): Expr[] {
  const result: Expr[] = [];
  function walk(s: Stmt): void {
    switch (s.type) {
      case 'ReturnStmt': if (s.value) result.push(s.value); break;
      case 'IfStmt':     walk(s.thenBranch); if (s.elseBranch) walk(s.elseBranch); break;
      case 'BlockStmt':  s.statements.forEach(walk); break;
      // Do not recurse into nested function/proc
    }
  }
  body.forEach(walk);
  return result;
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Registers every UnionTypeStmt in the program into `registry`, regardless
 * of where in the statement tree it appears (top level, inside a function
 * body, inside a block, etc.) — run as its own complete pass BEFORE the
 * main constraint-generation walk below, so that a union type referenced
 * earlier in the file than its own declaration still gets its variants'
 * unionName attached correctly (e.g. `Square { 5 }`'s Named type needs
 * `unionName: 'Shape'` even if `type Shape = { | Square: ... }` appears
 * later in the file). Without this, registerUnion only ran when cgenStmt's
 * own top-to-bottom walk reached the UnionTypeStmt itself, so any
 * RecordExpr/IdentExpr referencing an earlier-used variant got a Named
 * type with no unionName at all — silently breaking static exhaustiveness
 * checking (typechecker.ts's checkExhaustiveness) for forward-referenced
 * unions, since it depends on this unionName being present.
 * UnionTypeStmt only ever appears at a statement position, never nested
 * inside an expression, so this only needs to walk statements.
 */
function registerAllUnions(stmts: Stmt[], registry: CGenRegistry): void {
  function walk(s: Stmt): void {
    if (!s) return;
    switch (s.type) {
      case 'UnionTypeStmt':  registry.registerUnion(s.name, s.variants); break;
      case 'IfStmt':         walk(s.thenBranch); if (s.elseBranch) walk(s.elseBranch); break;
      case 'BlockStmt':      s.statements.forEach(walk); break;
      case 'FunctionStmt':
      case 'ProcedureStmt':  s.body.forEach(walk); break;
      case 'ExportStmt':     walk(s.declaration); break;
      case 'ImportStmt': {
        // Register unions reachable via this import into THIS module's
        // own CGenRegistry too — needed so RecordExpr construction of an
        // imported variant constructor (e.g. `Square { 5 }` after
        // `import { Square } from "./shapes"`) resolves to a Named type
        // WITH unionName, not just `{ kind: 'Named', name: 'Square' }` —
        // see UnionImportTable's docblock for the full reasoning. Same
        // permissive no-op when no resolver is supplied (the default) or
        // resolution fails for this particular import.
        if (!currentUnionImportResolver) break;
        const table = currentUnionImportResolver(s.path, s.pos);
        if (!table) break;
        for (const [unionName, variants] of table) registry.registerUnion(unionName, variants);
        break;
      }
      // Every other statement type cannot contain a UnionTypeStmt.
    }
  }
  for (const s of stmts) walk(s);
}

/**
 * Bind one ImportStmt's names into `env`, using `currentTypeImportResolver`
 * (if set) to seed real resolved types. Shared between seedAllImports's
 * pre-pass (forward-reference safety — see its docblock) and cgenStmt's
 * own ImportStmt case (so a *nested* import, e.g. inside a function body,
 * still gets (re-)bound at the point cgenStmt actually reaches it; the
 * pre-pass alone only exists to make forward references resolve and
 * doesn't change cgenStmt's own per-node walk or its env.child() scoping
 * for nested imports specifically).
 */
function bindImport(stmt: Stmt & { type: 'ImportStmt' }, env: CGenEnv): void {
  const table = currentTypeImportResolver ? currentTypeImportResolver(stmt.path, stmt.pos) : null;
  if (stmt.kind === 'named') {
    for (const n of stmt.names) {
      const bindName = n.alias ?? n.name;
      const ty = table?.get(n.name);
      if (ty) env.define(bindName, ty);
      // No table, or name absent from it: leave unbound — IdentExpr's
      // unbound-name branch will assign a fresh var when it's used, same
      // permissive fallback as everywhere else in this pass.
    }
  } else if (stmt.kind === 'namespace') {
    if (table) env.defineNamespace(stmt.alias, table);
    // No table: leave the alias unbound. A later `X.foo` GetExpr will
    // find X unbound (not a namespace binding) and fall through to
    // ordinary GetExpr handling (a fresh var for the field), same as
    // before namespace type support existed.
  } else {
    // 'star' — every export of the resolved module binds directly into
    // this env, same as the runtime's own star-import binding
    // (interpreter.ts) and procedureCheck.ts's analogous star-import
    // handling.
    if (table) for (const [name, ty] of table) env.define(name, ty);
  }
}

/**
 * Seed every ImportStmt's names into `env`, regardless of where in the
 * statement tree the import appears — run as its own complete pre-pass
 * BEFORE the main cgenStmt walk, mirroring registerAllUnions's rationale
 * exactly: a name used before its own `import` statement appears later in
 * the same file (confirmed legal — pfun's closures/function bodies
 * resolve names lazily, not at declaration-textual-order time, the same
 * hoisting-like behavior already established for forward-referenced
 * unions and functions) must still resolve correctly. Without this,
 * env.define for an imported name would only happen when cgenStmt's own
 * top-to-bottom walk reached that ImportStmt, so any earlier use of the
 * name would see it as unbound and get a fresh, unconstrained var instead
 * of its real type.
 */
function seedAllImports(stmts: Stmt[], env: CGenEnv): void {
  function walk(s: Stmt): void {
    if (!s) return;
    switch (s.type) {
      case 'ImportStmt':     bindImport(s, env); break;
      case 'IfStmt':         walk(s.thenBranch); if (s.elseBranch) walk(s.elseBranch); break;
      case 'BlockStmt':      s.statements.forEach(walk); break;
      case 'FunctionStmt':
      case 'ProcedureStmt':  s.body.forEach(walk); break;
      case 'ExportStmt':     walk(s.declaration); break;
      // Every other statement type cannot contain an ImportStmt.
    }
  }
  for (const s of stmts) walk(s);
}

/**
 * Walk `stmts`, assign fresh TyVars to every expression, and return the
 * full constraint set.  Annotates `inferredType` on every expression node
 * (may overwrite UNKNOWN from the first-pass inferencer with a TyVar).
 *
 * Does not solve constraints — call the Phase 4 solver on the returned
 * ConstraintSet to produce a final Substitution.
 *
 * @param stmts            The parsed AST to generate constraints for.
 * @param resolver         Optional. Resolves an import path to that
 *   module's TypeImportTable, enabling real cross-module type checks
 *   (including through namespace imports). Omitted (the default), every
 *   import is treated exactly as before cross-module type support
 *   existed — every imported name is unbound, getting a fresh,
 *   unconstrained TyVar wherever it's used. Supplied by the whole-program
 *   driver (wholeProgramCheck.ts).
 * @param exportTypesOut   Optional. If supplied, populated (as a side
 *   effect) with this module's own top-level bindings' PRE-substitution
 *   types — i.e. the raw TyVars/types env held right after this walk, not
 *   yet resolved by the solver. The caller (wholeProgramCheck.ts) applies
 *   the Substitution from solveConstraints() to each entry afterward to
 *   get the final, resolved type — generateConstraints alone never solves
 *   anything, so it cannot populate already-resolved types itself.
 *   Existing callers (checkTypes/inferTypes in typechecker.ts, and every
 *   test in inferencer.test.ts) omit this and are completely unaffected —
 *   it is purely additive output, never required, never changes anything
 *   else this function does.
 * @param unionResolver    Optional. Resolves an import path to that
 *   module's exported unions (UnionImportTable), so an imported union
 *   variant constructor can be constructed (RecordExpr) with its
 *   unionName correctly attached — see UnionImportTable's docblock for
 *   why this needs a SEPARATE table from `resolver`/TypeImportTable
 *   (RecordExpr's type comes from CGenRegistry, not env).
 */
export function generateConstraints(
  stmts: Stmt[],
  resolver?: TypeImportResolver,
  exportTypesOut?: Map<string, PfunType>,
  unionResolver?: UnionImportResolver,
): ConstraintSet {
  const env      = buildCGenBuiltinEnv();
  const registry = new CGenRegistry();
  // Pre-register builtin union types so their variants get unionName attached.
  registry.registerUnion('Option', [
    { name: 'Some', fields: ['value'] },
    { name: 'None', fields: [] },
  ]);

  currentTypeImportResolver  = resolver ?? null;
  currentUnionImportResolver = unionResolver ?? null;
  try {
    // Pre-register every user-defined AND imported union, before the main
    // walk, so forward references resolve correctly — see
    // registerAllUnions's docblock above. Must run AFTER the resolver
    // assignments just above, since registerAllUnions's own ImportStmt
    // handling reads currentUnionImportResolver.
    registerAllUnions(stmts, registry);
    // Pre-seed every import too, before the main walk, for the identical
    // forward-reference reason as unions above — see seedAllImports's
    // docblock.
    seedAllImports(stmts, env);
    const cs: ConstraintSet = [];
    for (const stmt of stmts) cgenStmt(stmt, env, registry, cs);

    if (exportTypesOut) {
      for (const name of collectExportNames(stmts)) {
        const ty = env.lookup(name);
        if (ty) exportTypesOut.set(name, ty);
        // A name genuinely absent from env (shouldn't normally happen —
        // every ExportStmt's declaration also defines its own name via
        // cgenStmt) is simply omitted, not an error here; the caller
        // treats a missing entry the same as "unresolvable", same
        // permissive policy as everywhere else.
      }
    }

    return cs;
  } finally {
    // Always clear, success or failure — mirrors
    // procedureCheck.ts's identical try/finally around its own
    // currentImportResolver.
    currentTypeImportResolver  = null;
    currentUnionImportResolver = null;
  }
}

/**
 * Collect the names exported by a module's own ExportStmts — used to know
 * which env bindings to read back out for exportTypesOut. Mirrors
 * wholeProgramCheck.ts's extractExportKinds (the purity-table analogue)
 * exactly in shape, but only needs NAMES here (the type itself comes from
 * env, already computed by the walk) — not kind classification.
 */
function collectExportNames(stmts: Stmt[]): string[] {
  const names: string[] = [];
  function classify(decl: Stmt): void {
    switch (decl.type) {
      case 'LetStmt':
      case 'VarStmt':
      case 'FunctionStmt':
      case 'ProcedureStmt':
        names.push(decl.name);
        break;
      case 'UnionTypeStmt':
        for (const v of decl.variants) if (v.fields.length === 0) names.push(v.name);
        break;
      // TypeStmt: type-only, no value binding in env to read back.
    }
  }
  function walk(s: Stmt): void {
    if (!s) return;
    switch (s.type) {
      case 'ExportStmt':      classify(s.declaration); break;
      case 'IfStmt':          walk(s.thenBranch); if (s.elseBranch) walk(s.elseBranch); break;
      case 'BlockStmt':       s.statements.forEach(walk); break;
      case 'FunctionStmt':
      case 'ProcedureStmt':   s.body.forEach(walk); break;
      // Every other statement type cannot contain an ExportStmt.
    }
  }
  for (const s of stmts) walk(s);
  return names;
}

// ─── § 7  Type schemes — let-generalisation and instantiation ────────────────
//
// A TypeScheme represents a polymorphic type: ∀ α0 α1 … . T
// The `vars` array lists the universally-quantified variable ids.
// The `type` field is the body type, which may contain those variables.
//
// Monomorphic types are represented as schemes with an empty `vars` array.

/**
 * A polymorphic type scheme: ∀ vars . type
 *
 * vars — ids of quantified type variables (empty for monomorphic types)
 * type — the body, potentially containing TyVars with ids in vars
 */
export type TypeScheme = {
  vars: number[];
  type: PfunType;
};

/**
 * Lift a monomorphic type into a trivial scheme (no quantified variables).
 * Useful when a type must be stored as a scheme but is not yet generalised.
 */
export function mono(type: PfunType): TypeScheme {
  return { vars: [], type };
}

/**
 * Generalise a type with respect to a set of type variable ids that are
 * free in the ambient type environment.
 *
 * The quantified variables are those free in `type` (after applying `subst`)
 * minus those free in the environment.  Variables free in the environment
 * cannot be generalised — they are shared with an outer scope and must remain
 * monomorphic.
 *
 * @param envFreeVars  TyVar ids free in the current type environment.
 *                     Compute this with collectEnvFreeVars() before calling.
 * @param type         The type to generalise.
 * @param subst        Current substitution — applied to `type` first so we
 *                     generalise the most-resolved form.
 * @returns            A TypeScheme quantifying over the generalisable vars.
 *
 * Example:
 *   env  = {}  (no free vars)
 *   type = Fn<α0, α0>  (identity function)
 *   → TypeScheme { vars: [0], type: Fn<α0, α0> }
 *
 *   env  = { x: α0 }  (α0 is free in env)
 *   type = Fn<α0, Bool>
 *   → TypeScheme { vars: [], type: Fn<α0, Bool> }  (α0 not generalisable)
 */
export function generalize(
  envFreeVars: Set<number>,
  type:        PfunType,
  subst:       Substitution = Substitution.empty(),
): TypeScheme {
  const resolved = subst.apply(type);
  const typeFree = freeVarsIn(resolved);
  const quantified = [...typeFree].filter(id => !envFreeVars.has(id));
  return { vars: quantified, type: resolved };
}

/**
 * Instantiate a type scheme by replacing each quantified variable with a
 * fresh type variable.
 *
 * Each call to instantiate() produces an independent copy — call sites for
 * a polymorphic function get different fresh variables, allowing the same
 * function to be used at different types in the same expression.
 *
 * @param scheme  The scheme to instantiate.
 * @returns       A monomorphic PfunType with fresh variables substituted in.
 *
 * Example:
 *   scheme = { vars: [0], type: Fn<α0, α0> }
 *   → Fn<α3, α3>  (fresh id, say 3, allocated for the first call)
 *   → Fn<α4, α4>  (fresh id 4 for the second call)
 */
/**
 * Apply a plain id→type map to a type — used by instantiate() to avoid
 * the Substitution chain-chasing that would loop if a fresh var happened
 * to share an id with a quantified var (possible when the counter is reset
 * in tests).  This map never chains: every key maps to a concrete fresh var
 * that is guaranteed not to be in the map's domain.
 */
function applyMap(t: PfunType, map: Map<number, PfunType>): PfunType {
  switch (t.kind) {
    case 'TyVar': return map.get(t.id) ?? t;
    case 'List':    return { kind: 'List',    element: applyMap(t.element, map) };
    case 'Array':   return { kind: 'Array',   element: applyMap(t.element, map) };
    case 'Option':  return { kind: 'Option',  inner:   applyMap(t.inner,   map) };
    case 'Dict':    return { kind: 'Dict',    key: applyMap(t.key, map), value: applyMap(t.value, map) };
    case 'Fn':      return { kind: 'Fn', params: t.params.map(p => applyMap(p, map)), ret: applyMap(t.ret, map) };
    case 'Generic': return { kind: 'Generic', name: t.name, params: t.params.map(p => applyMap(p, map)) };
    case 'Named':   return t.fieldTypes
      ? { ...t, fieldTypes: t.fieldTypes.map(ft => applyMap(ft, map)) }
      : t;
    default:        return t;
  }
}

export function instantiate(scheme: TypeScheme): PfunType {
  if (scheme.vars.length === 0) return scheme.type;

  // Build a substitution mapping each quantified var to a fresh one.
  // freshVar() always allocates a strictly increasing id, so as long as
  // the scheme's vars were created before this call there is no collision —
  // the new ids are always higher than any existing id in the scheme.
  const subst = new Map<number, PfunType>();
  for (const id of scheme.vars) {
    subst.set(id, freshVar());
  }
  return applyMap(scheme.type, subst);
}

// ─── Environment of type schemes ─────────────────────────────────────────────

/**
 * A scoped environment mapping names to TypeSchemes.
 * Used by the full inference pass (Phase 5) to track the types of all
 * bindings in scope, including polymorphic ones.
 */
export class SchemeEnv {
  private bindings = new Map<string, TypeScheme>();
  constructor(public parent?: SchemeEnv) {}

  define(name: string, scheme: TypeScheme): void {
    this.bindings.set(name, scheme);
  }

  lookup(name: string): TypeScheme | undefined {
    if (this.bindings.has(name)) return this.bindings.get(name)!;
    return this.parent?.lookup(name);
  }

  child(): SchemeEnv { return new SchemeEnv(this); }

  /**
   * Collect all type variable ids free in this environment frame and all
   * parent frames.  Used by generalize() to determine which variables are
   * ambient and must not be quantified.
   */
  freeVars(): Set<number> {
    const result = new Set<number>();
    this.collectFreeVars(result);
    return result;
  }

  private collectFreeVars(acc: Set<number>): void {
    for (const scheme of this.bindings.values()) {
      // Free vars of a scheme are those in type that are NOT quantified
      const schemeTypeFree = freeVarsIn(scheme.type);
      for (const id of schemeTypeFree) {
        if (!scheme.vars.includes(id)) acc.add(id);
      }
    }
    this.parent?.collectFreeVars(acc);
  }
}

/**
 * Collect the free type variable ids across all schemes in a SchemeEnv.
 * Convenience wrapper around SchemeEnv.freeVars() for callers that have
 * a raw env rather than wanting to call the method directly.
 */
export function collectEnvFreeVars(env: SchemeEnv): Set<number> {
  return env.freeVars();
}
// ─── § 8  Constraint solving and AST annotation ──────────────────────────────
//
// Phase 5: wire together constraint generation, unification, and substitution
// application to produce a fully-annotated AST.
//
// solveConstraints() folds unify() over the constraint set, collecting type
// errors rather than throwing on the first failure.
//
// applySubstitutionToAST() walks every Expr and Stmt node and replaces
// TyVar inferredType annotations with their resolved types.

export type TypeError = {
  message: string;
  pos:     SourcePos | undefined;
};

/**
 * Solve a constraint set by folding unify() over every constraint.
 *
 * Returns the final substitution and any type errors encountered.
 * Does not throw — errors are collected so all failures are reported.
 *
 * Unknown types on either side of a constraint are treated as wildcards
 * (unification passes through them), so first-pass annotations coexist
 * with HM inference without causing spurious failures.
 */
export function solveConstraints(cs: ConstraintSet): {
  subst:  Substitution;
  errors: TypeError[];
} {
  let subst = Substitution.empty();
  const errors: TypeError[] = [];

  for (const c of cs) {
    try {
      subst = unify(c.a, c.b, subst);
    } catch (e) {
      errors.push({
        message: e instanceof Error ? e.message : String(e),
        pos:     c.pos,
      });
    }
  }

  return { subst, errors };
}

/**
 * Walk every Expr and Stmt node in `stmts` and apply `subst` to each
 * `inferredType` field, replacing TyVars with their resolved types.
 *
 * After this pass:
 *   - TyVars that were unified with concrete types become those concrete types.
 *   - TyVars that remain unsolved stay as TyVars (the type is genuinely
 *     polymorphic or was never constrained).
 *   - Unknown annotations are left unchanged (the first-pass result).
 *
 * Mutates nodes in place.
 */
export function applySubstitutionToAST(stmts: Stmt[], subst: Substitution): void {
  function applyExpr(e: Expr): void {
    if (!e) return;
    if (e.inferredType) e.inferredType = subst.apply(e.inferredType);

    switch (e.type) {
      case 'BinaryExpr':
        applyExpr(e.left); applyExpr(e.right); break;
      case 'UnaryExpr':
        applyExpr(e.right); break;
      case 'GroupExpr':
        applyExpr(e.expression); break;
      case 'TernaryExpr':
        applyExpr(e.condition); applyExpr(e.thenBranch); applyExpr(e.elseBranch); break;
      case 'CallExpr':
        applyExpr(e.callee); e.args.forEach(applyExpr); break;
      case 'LambdaExpr':
        applyExpr(e.body); break;
      case 'ListExpr':
        e.elements.forEach(applyExpr); break;
      case 'RecordExpr':
        e.fields.forEach(f => applyExpr(f.value));
        // Also resolve fieldTypes TyVars — they may be constrained by the
        // solver after RecordExpr cgenExpr ran.
        if (e.inferredType && e.inferredType.kind === 'Named' && e.inferredType.fieldTypes) {
          e.inferredType.fieldTypes = e.inferredType.fieldTypes.map(ft => subst.apply(ft));
        }
        break;
      case 'GetExpr':
        applyExpr(e.object); break;
      case 'AssignExpr':
        applyExpr(e.value); break;
      case 'IndexExpr':
        applyExpr(e.object); applyExpr(e.index); break;
      case 'IndexAssignExpr':
        applyExpr(e.object); applyExpr(e.index); applyExpr(e.value); break;
      case 'MatchExpr':
        applyExpr(e.subject);
        e.arms.forEach(a => { if (a.guard) applyExpr(a.guard); applyExpr(a.body); });
        break;
      case 'ComprehensionExpr':
        e.generators.forEach(g => applyExpr(g.source));
        if (e.guard) applyExpr(e.guard);
        applyExpr(e.body);
        break;
      case 'DictExpr':
        e.entries.forEach(en => { applyExpr(en.key); applyExpr(en.value); }); break;
      case 'ArrayExpr':
        e.elements.forEach(applyExpr); break;
      case 'BlockExpr':
        e.statements.forEach(applyStmt); break;
    }
  }

  function applyStmt(s: Stmt): void {
    if (!s) return;
    switch (s.type) {
      case 'LetStmt':
      case 'VarStmt':
        if (s.inferredType) s.inferredType = subst.apply(s.inferredType);
        applyExpr(s.initializer);
        break;
      case 'ExprStmt':
      case 'EvalStmt':
        applyExpr(s.expression); break;
      case 'ReturnStmt':
        if (s.value) applyExpr(s.value); break;
      case 'IfStmt':
        applyExpr(s.condition);
        applyStmt(s.thenBranch);
        if (s.elseBranch) applyStmt(s.elseBranch);
        break;
      case 'BlockStmt':
        s.statements.forEach(applyStmt); break;
      case 'FunctionStmt':
      case 'ProcedureStmt':
        s.body.forEach(applyStmt); break;
      case 'ExportStmt':
        applyStmt(s.declaration); break;
    }
  }

  stmts.forEach(applyStmt);
}
