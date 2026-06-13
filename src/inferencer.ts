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
//
// Later phases (constraint generation, let-generalisation, the full inference
// pass) will be added here as the implementation grows.
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
    case 'Nil':     return 'Nil';
    case 'Unknown': return '?';
    case 'TyVar':   return `α${t.id}`;
    case 'List':    return `List<${formatType(t.element)}>`;
    case 'Array':   return `Array<${formatType(t.element)}>`;
    case 'Option':  return `Option<${formatType(t.inner)}>`;
    case 'Dict':    return `Dict<${formatType(t.key)}, ${formatType(t.value)}>`;
    case 'Named':   return t.unionName ? `${t.unionName}.${t.name}` : t.name;
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
      if (ta.name !== tb_.name) throw new UnificationError(ta, tb);
      return subst;
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

class CGenEnv {
  private bindings = new Map<string, PfunType>();
  constructor(public parent?: CGenEnv) {}

  define(name: string, type: PfunType): void { this.bindings.set(name, type); }

  lookup(name: string): PfunType | undefined {
    if (this.bindings.has(name)) return this.bindings.get(name)!;
    return this.parent?.lookup(name);
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

const _INT:  PfunType = { kind: 'Int'  };
const _BOOL: PfunType = { kind: 'Bool' };
const _STR:  PfunType = { kind: 'Str'  };
const _CHAR: PfunType = { kind: 'Char' };

function buildCGenBuiltinEnv(): CGenEnv {
  const env = new CGenEnv();

  // Functions with fully-known signatures use concrete Fn types.
  const fixed: Array<[string, PfunType]> = [
    ['length',      _INT ],
    ['asc',         _INT ],
    ['chr',         _CHAR],
    ['isInfinite',  _BOOL],
    ['has',         _BOOL],
    ['join',        _STR ],
    ['split',       { kind: 'List', element: _STR }],
    ['__str__',     _STR ],
    ['flushStdout', _BOOL],
    ['fileExists',  _BOOL],
  ];
  for (const [name, ret] of fixed) {
    env.define(name, { kind: 'Fn', params: [], ret });
  }

  // Polymorphic builtins get fresh TyVars for their param/return types.
  // These will be further constrained when call sites are visited.
  env.define('print',   freshVar());
  env.define('println', freshVar());
  env.define('readln',  { kind: 'Option', inner: _STR });

  env.define('true',  _BOOL);
  env.define('false', _BOOL);
  env.define('None',  { kind: 'Named', name: 'None' });

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
    case 'IntExpr':  t = _INT;  break;
    case 'BoolExpr': t = _BOOL; break;
    case 'StrExpr':  t = _STR;  break;
    case 'CharExpr': t = _CHAR; break;

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
        cs.push(constraint(rt, _INT, pos));
        t = _INT;
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
      for (const el of expr.elements) {
        const et = cgenExpr(el, env, registry, cs);
        cs.push(constraint(et, elemVar, el.pos));
      }
      t = { kind: 'List', element: elemVar };
      break;
    }

    // ── Record / union variant constructors ──────────────────────────────────
    case 'RecordExpr': {
      for (const f of expr.fields) cgenExpr(f.value, env, registry, cs);
      const entry = registry.lookupConstructor(expr.name);
      t = entry
        ? { kind: 'Named', name: entry.name, unionName: entry.unionName }
        : { kind: 'Named', name: expr.name };
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
      // Constrain callee to be a function from the actual arg types to retVar
      cs.push(constraint(calleeType, { kind: 'Fn', params: argTypes, ret: retVar }, pos));
      t = retVar;
      break;
    }

    // ── Match ─────────────────────────────────────────────────────────────────
    case 'MatchExpr': {
      cgenExpr(expr.subject, env, registry, cs);
      const resultVar = freshVar();
      for (const arm of expr.arms) {
        const armEnv = env.child();
        if (arm.binding !== null) armEnv.define(arm.binding, freshVar());
        if (arm.guard) cgenExpr(arm.guard, armEnv, registry, cs);
        const armType = cgenExpr(arm.body, armEnv, registry, cs);
        cs.push(constraint(armType, resultVar, arm.body.pos));
      }
      t = resultVar;
      break;
    }

    // ── Get (field access) ────────────────────────────────────────────────────
    case 'GetExpr': {
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

    // Arithmetic — all operands and result are Int
    case 'MinusToken':
    case 'StarToken':
    case 'SlashToken':
    case 'PercentToken':
      cs.push(constraint(lt, _INT, pos));
      cs.push(constraint(rt, _INT, pos));
      return _INT;

    // Plus — default to Int arithmetic.
    // String/list concatenation is resolved by the first-pass inferencer;
    // the constraint generator conservatively assumes Int for now.
    case 'PlusToken':
      cs.push(constraint(lt, _INT, pos));
      cs.push(constraint(rt, _INT, pos));
      return _INT;

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
      const paramTypes = stmt.params.map(() => freshVar() as PfunType);
      const retVar     = freshVar() as PfunType;
      const fnType: PfunType = { kind: 'Fn', params: paramTypes, ret: retVar };
      // Pre-register so recursive calls can reference the function.
      env.define(stmt.name, fnType);
      // Walk body in a child scope with params bound to their vars.
      const bodyEnv = env.child();
      stmt.params.forEach((p, i) => bodyEnv.define(p, paramTypes[i]));
      for (const s of stmt.body) cgenStmt(s, bodyEnv, registry, cs);
      // Constrain the return var against all return expressions in the body.
      collectReturnExprs(stmt.body).forEach(expr => {
        if (expr.inferredType) cs.push(constraint(expr.inferredType, retVar, expr.pos));
      });
      break;
    }

    case 'ProcedureStmt': {
      const paramTypes = stmt.params.map(() => freshVar() as PfunType);
      const retVar     = freshVar() as PfunType;
      const fnType: PfunType = { kind: 'Fn', params: paramTypes, ret: retVar };
      env.define(stmt.name, fnType);
      const bodyEnv = env.child();
      stmt.params.forEach((p, i) => bodyEnv.define(p, paramTypes[i]));
      for (const s of stmt.body) cgenStmt(s, bodyEnv, registry, cs);
      collectReturnExprs(stmt.body).forEach(expr => {
        if (expr.inferredType) cs.push(constraint(expr.inferredType, retVar, expr.pos));
      });
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
 * Walk `stmts`, assign fresh TyVars to every expression, and return the
 * full constraint set.  Annotates `inferredType` on every expression node
 * (may overwrite UNKNOWN from the first-pass inferencer with a TyVar).
 *
 * Does not solve constraints — call the Phase 4 solver on the returned
 * ConstraintSet to produce a final Substitution.
 */
export function generateConstraints(stmts: Stmt[]): ConstraintSet {
  const env      = buildCGenBuiltinEnv();
  const registry = new CGenRegistry();
  const cs: ConstraintSet = [];
  for (const stmt of stmts) cgenStmt(stmt, env, registry, cs);
  return cs;
}
