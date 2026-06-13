// src/typechecker.ts
// First-pass type inference for Pfun.
//
// This pass annotates AST nodes with `inferredType` where the type can be
// determined without a full constraint-solving inferencer.  Anything that
// cannot be resolved is left as UNKNOWN — the pass never fails or throws.
//
// What is inferred:
//   - Literals                  (Int, Bool, Str, Char, Nil)
//   - Variable references       (when the binding is already in scope)
//   - Unary / binary operators  (when operand types are known)
//   - Grouped expressions       (delegates to inner)
//   - Ternary expressions       (when both branches agree)
//   - List literals             (when all elements share a type → List<T>)
//   - Let / var bindings        (propagated from the initializer)
//   - Record constructors       (Named type from the constructor name)
//   - Lambda expressions        (Fn<Unknown…, R> where R is the body type)
//   - Function / proc stmts     (Fn<Unknown…, R> via two-pass return inference)
//
// What is left as UNKNOWN:
//   - Function calls            (return-type inference deferred)
//   - Field access (GetExpr)    (record field types deferred)
//   - Match expressions         (arm unification deferred)
//   - Cross-module names        (not visible at this stage)
//
// Usage:
//   import { inferTypes } from './typechecker';
//   inferTypes(ast);   // mutates nodes in place

import { Expr, Stmt, PfunType, UNKNOWN } from './ast';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function typesEqual(a: PfunType, b: PfunType): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'List':    return typesEqual(a.element, (b as any).element);
    case 'Array':   return typesEqual(a.element, (b as any).element);
    case 'Option':  return typesEqual(a.inner,   (b as any).inner);
    case 'Named':   return a.name === (b as any).name;
    case 'Generic': return a.name === (b as any).name &&
                           a.params.length === (b as any).params.length &&
                           a.params.every((p, i) => typesEqual(p, (b as any).params[i]));
    case 'Fn':      return typesEqual(a.ret, (b as any).ret) &&
                           a.params.length === (b as any).params.length &&
                           a.params.every((p, i) => typesEqual(p, (b as any).params[i]));
    case 'Dict':    return typesEqual(a.key, (b as any).key) &&
                           typesEqual(a.value, (b as any).value);
    default:        return true; // primitives matched by kind already
  }
}

function isUnknown(t: PfunType): boolean {
  return t.kind === 'Unknown';
}

/**
 * Unify a list of types: if all are equal and none is Unknown, return that
 * type.  Otherwise return UNKNOWN.
 */
function unify(types: PfunType[]): PfunType {
  if (types.length === 0) return UNKNOWN;
  const first = types[0];
  if (isUnknown(first)) return UNKNOWN;
  return types.every(t => typesEqual(t, first)) ? first : UNKNOWN;
}

// ─── Type Environment ─────────────────────────────────────────────────────────

class TypeEnv {
  private bindings = new Map<string, PfunType>();
  constructor(public parent?: TypeEnv) {}

  define(name: string, type: PfunType): void {
    this.bindings.set(name, type);
  }

  /** Overwrite an existing binding in this frame (used for the second pass). */
  redefine(name: string, type: PfunType): void {
    this.bindings.set(name, type);
  }

  lookup(name: string): PfunType {
    if (this.bindings.has(name)) return this.bindings.get(name)!;
    return this.parent?.lookup(name) ?? UNKNOWN;
  }

  child(): TypeEnv {
    return new TypeEnv(this);
  }
}

// ─── Type Registry ───────────────────────────────────────────────────────────
//
// Tracks which names are plain records and which are union variants, so that
// RecordExpr construction can attach the correct unionName to the Named type.

class TypeRegistry {
  // Maps a constructor name (record or variant) → union name if it's a variant,
  // or undefined if it's a plain record.
  private constructors = new Map<string, string | undefined>();
  private unions       = new Map<string, Set<string>>();
  // Zero-field variants are singletons — they appear as bare IdentExpr, not
  // RecordExpr, so they need a separate lookup path.
  private singletons   = new Map<string, string>(); // variantName → unionName

  registerPlain(name: string): void {
    this.constructors.set(name, undefined);
  }

  registerUnion(unionName: string, variants: { name: string; fields: string[] }[]): void {
    const variantNames = variants.map(v => v.name);
    for (const v of variants) {
      this.constructors.set(v.name, unionName);
      if (v.fields.length === 0) this.singletons.set(v.name, unionName);
    }
    this.unions.set(unionName, new Set(variantNames));
  }

  /** Returns the full set of variant names for a union, or null if unknown. */
  variantsOf(unionName: string): Set<string> | null {
    return this.unions.get(unionName) ?? null;
  }

  /** Returns { name, unionName? } for a record/variant constructor, or null. */
  lookup(name: string): { name: string; unionName?: string } | null {
    if (!this.constructors.has(name)) return null;
    return { name, unionName: this.constructors.get(name) };
  }

  /**
   * Returns the Named type for a zero-field singleton variant (e.g. None, Red),
   * or null if the name is not a known singleton.
   */
  lookupSingleton(name: string): { name: string; unionName: string } | null {
    const unionName = this.singletons.get(name);
    return unionName ? { name, unionName } : null;
  }
}

//
// Only builtins whose return type is always the same regardless of arguments
// are listed here — these are the ones that let IdentExpr resolution work for
// common stdlib calls.  Polymorphic builtins (map, filter, etc.) are left as
// UNKNOWN since their return type depends on their arguments.

const INT:  PfunType = { kind: 'Int' };
const BOOL: PfunType = { kind: 'Bool' };
const STR:  PfunType = { kind: 'Str' };
const CHAR: PfunType = { kind: 'Char' };
const NIL:  PfunType = { kind: 'Nil' };

function buildBuiltinEnv(): TypeEnv {
  const env = new TypeEnv();

  // ── Stdlib functions with fixed return types ─────────────────────────────
  const fixed: Array<[string, PfunType]> = [
    ['length',      INT],
    ['asc',         INT],
    ['chr',         CHAR],
    ['isInfinite',  BOOL],
    ['has',         BOOL],
    ['join',        STR],
    ['split',       { kind: 'List', element: STR }],
    ['__str__',     STR],
    // IO
    ['print',       UNKNOWN],
    ['println',     UNKNOWN],
    ['readln',      { kind: 'Option', inner: STR }],
    ['flushStdout', BOOL],
    // File
    ['readFile',    UNKNOWN],   // Result<Str> — leave for now
    ['writeFile',   UNKNOWN],
    ['fileExists',  BOOL],
  ];

  for (const [name, type] of fixed) {
    env.define(name, { kind: 'Fn', params: [], ret: type });
  }

  // ── Constants ────────────────────────────────────────────────────────────
  env.define('true',  BOOL);
  env.define('false', BOOL);
  env.define('None',  { kind: 'Named', name: 'None' });

  return env;
}

// ─── Return type harvesting ───────────────────────────────────────────────────

/**
 * Collect the inferred types of all ReturnStmt values in a function body.
 * Does not recurse into nested function/proc definitions — those have their
 * own return types.  Recurses into if/block/other control flow.
 *
 * Called after inferStmt has already walked the body, so ReturnStmt values
 * already carry inferredType on their expressions.
 */
function collectReturnTypes(body: Stmt[]): PfunType[] {
  const types: PfunType[] = [];

  function walkStmt(stmt: Stmt): void {
    switch (stmt.type) {
      case 'ReturnStmt':
        types.push(stmt.value?.inferredType ?? NIL);
        break;
      case 'IfStmt':
        walkStmt(stmt.thenBranch);
        if (stmt.elseBranch) walkStmt(stmt.elseBranch);
        break;
      case 'BlockStmt':
        for (const s of stmt.statements) walkStmt(s);
        break;
      case 'ExprStmt':
      case 'EvalStmt':
      case 'LetStmt':
      case 'VarStmt':
        break;
      // Do NOT recurse into nested FunctionStmt / ProcedureStmt
      default:
        break;
    }
  }

  for (const s of body) walkStmt(s);
  return types;
}

// ─── Function return-type inference ──────────────────────────────────────────

/**
 * Infer the return type of a function or procedure body using a two-pass
 * approach to handle recursion cleanly:
 *
 *   Pass 1 — pre-register the name as UNKNOWN, walk the body.  Collect return
 *             types from all non-recursive paths (recursive call sites resolve
 *             to UNKNOWN and are filtered out).
 *   Pass 2 — if pass 1 produced a concrete type, re-register the name with
 *             that Fn type and re-walk so recursive call sites can now resolve.
 *             Otherwise leave as UNKNOWN.
 *
 * Returns the inferred Fn type (params all UNKNOWN, ret inferred or UNKNOWN).
 */
function inferFnType(
  name: string,
  params: string[],
  body: Stmt[],
  env: TypeEnv,
  registry: TypeRegistry
): PfunType {
  const paramTypes: PfunType[] = params.map(() => UNKNOWN);
  const fnUnknown: PfunType = { kind: 'Fn', params: paramTypes, ret: UNKNOWN };

  // ── Pass 1: pre-register as fully-unknown Fn, walk body ─────────────────
  env.define(name, fnUnknown);
  const bodyEnv1 = env.child();
  for (const p of params) bodyEnv1.define(p, UNKNOWN);
  for (const s of body) inferStmt(s, bodyEnv1, registry);

  const pass1Returns = collectReturnTypes(body).filter(t => !isUnknown(t));
  const pass1Ret = unify(pass1Returns.length > 0 ? pass1Returns : [UNKNOWN]);

  if (isUnknown(pass1Ret)) {
    // Nothing to gain from a second pass
    return fnUnknown;
  }

  // ── Pass 2: re-register with concrete return type, re-walk ───────────────
  const fnConcrete: PfunType = { kind: 'Fn', params: paramTypes, ret: pass1Ret };
  env.redefine(name, fnConcrete);
  const bodyEnv2 = env.child();
  for (const p of params) bodyEnv2.define(p, UNKNOWN);
  for (const s of body) inferStmt(s, bodyEnv2, registry);

  // Collect again — recursive paths can now contribute
  const pass2Returns = collectReturnTypes(body).filter(t => !isUnknown(t));
  const pass2Ret = unify(pass2Returns.length > 0 ? pass2Returns : [UNKNOWN]);

  const finalRet = !isUnknown(pass2Ret) ? pass2Ret : pass1Ret;
  const finalFn: PfunType = { kind: 'Fn', params: paramTypes, ret: finalRet };
  env.redefine(name, finalFn);
  return finalFn;
}

// ─── Expression inference ─────────────────────────────────────────────────────

function inferExpr(expr: Expr, env: TypeEnv, registry: TypeRegistry): PfunType {
  let t: PfunType;

  switch (expr.type) {

    // ── Literals ────────────────────────────────────────────────────────────
    case 'IntExpr':  t = INT;  break;
    case 'BoolExpr': t = BOOL; break;
    case 'StrExpr':  t = STR;  break;
    case 'CharExpr': t = CHAR; break;

    // ── Identifiers ─────────────────────────────────────────────────────────
    case 'IdentExpr': {
      const envType = env.lookup(expr.name);
      if (!isUnknown(envType)) {
        t = envType;
      } else {
        // Zero-field union variants are bare identifiers, not RecordExprs.
        // Check the registry so `let c = Red` resolves to Named<Red, Color>.
        const singleton = registry.lookupSingleton(expr.name);
        t = singleton
          ? { kind: 'Named', name: singleton.name, unionName: singleton.unionName }
          : UNKNOWN;
      }
      break;
    }

    // ── Grouping ────────────────────────────────────────────────────────────
    case 'GroupExpr':
      t = inferExpr(expr.expression, env, registry);
      break;

    // ── Unary operators ─────────────────────────────────────────────────────
    case 'UnaryExpr': {
      const rt = inferExpr(expr.right, env, registry);
      if (expr.operator === 'BooleanNot') {
        t = BOOL;
      } else if (expr.operator === 'MinusToken' && rt.kind === 'Int') {
        t = INT;
      } else {
        t = UNKNOWN;
      }
      break;
    }

    // ── Binary operators ────────────────────────────────────────────────────
    case 'BinaryExpr': {
      const lt = inferExpr(expr.left,  env, registry);
      const rt = inferExpr(expr.right, env, registry);
      t = inferBinary(expr.operator, lt, rt);
      break;
    }

    // ── Ternary ─────────────────────────────────────────────────────────────
    case 'TernaryExpr': {
      inferExpr(expr.condition, env, registry);
      const tt = inferExpr(expr.thenBranch, env, registry);
      const et = inferExpr(expr.elseBranch, env, registry);
      t = (!isUnknown(tt) && !isUnknown(et) && typesEqual(tt, et)) ? tt : UNKNOWN;
      break;
    }

    // ── List literals ────────────────────────────────────────────────────────
    case 'ListExpr': {
      if (expr.elements.length === 0) {
        t = { kind: 'List', element: UNKNOWN };
      } else {
        const elemTypes = expr.elements.map(e => inferExpr(e, env, registry));
        const first = elemTypes[0];
        const homogeneous = !isUnknown(first) &&
          elemTypes.every(et => typesEqual(et, first));
        t = homogeneous
          ? { kind: 'List', element: first }
          : { kind: 'List', element: UNKNOWN };
      }
      break;
    }

    // ── Record / union variant constructors ─────────────────────────────────
    case 'RecordExpr': {
      for (const f of expr.fields) inferExpr(f.value, env, registry);
      const entry = registry.lookup(expr.name);
      t = entry
        ? { kind: 'Named', name: entry.name, unionName: entry.unionName }
        : { kind: 'Named', name: expr.name };
      break;
    }

    // ── Assignment — type of the assigned value ──────────────────────────────
    case 'AssignExpr':
      t = inferExpr(expr.value, env, registry);
      break;

    // ── Lambda — infer body type in a child scope, build Fn type ────────────
    case 'LambdaExpr': {
      const lambdaEnv = env.child();
      for (const p of expr.params) lambdaEnv.define(p, UNKNOWN);
      const retType = inferExpr(expr.body, lambdaEnv, registry);
      const paramTypes: PfunType[] = expr.params.map(() => UNKNOWN);
      t = { kind: 'Fn', params: paramTypes, ret: retType };
      break;
    }

    // ── Call — recurse into args; return type is the Fn's ret if known ───────
    case 'CallExpr': {
      const callee = inferExpr(expr.callee, env, registry);
      for (const a of expr.args) inferExpr(a, env, registry);
      t = (callee.kind === 'Fn' && !isUnknown(callee.ret))
        ? callee.ret
        : UNKNOWN;
      break;
    }

    // ── Everything else — recurse into children, leave type Unknown ──────────
    case 'GetExpr':
      inferExpr(expr.object, env, registry);
      t = UNKNOWN;
      break;
    case 'MatchExpr': {
      const subjectType = inferExpr(expr.subject, env, registry);
      for (const arm of expr.arms) inferExpr(arm.body, env, registry);
      // Exhaustiveness check — only possible when subject resolves to a
      // Named union type and no wildcard arm is present.
      const hasWildcard = expr.arms.some(a => a.variant === null);
      if (!hasWildcard &&
          subjectType.kind === 'Named' &&
          subjectType.unionName !== undefined) {
        const variants = registry.variantsOf(subjectType.unionName);
        if (variants) {
          const covered = new Set(
            expr.arms.map(a => a.variant).filter((v): v is string => v !== null)
          );
          const missing = [...variants].filter(v => !covered.has(v));
          if (missing.length > 0) expr.missingVariants = missing;
        }
      }
      t = UNKNOWN;
      break;
    }
    case 'ComprehensionExpr': {
      const compEnv = env.child();
      for (const g of expr.generators) {
        inferExpr(g.source, compEnv, registry);
        compEnv.define(g.variable, UNKNOWN);
      }
      if (expr.guard) inferExpr(expr.guard, compEnv, registry);
      inferExpr(expr.body, compEnv, registry);
      t = { kind: 'List', element: UNKNOWN };
      break;
    }
    case 'DictExpr':
      for (const e of expr.entries) {
        inferExpr(e.key, env, registry);
        inferExpr(e.value, env, registry);
      }
      t = UNKNOWN;
      break;
    case 'ArrayExpr':
      for (const e of expr.elements) inferExpr(e, env, registry);
      t = UNKNOWN;
      break;
    case 'IndexExpr':
      inferExpr(expr.object, env, registry);
      inferExpr(expr.index, env, registry);
      t = UNKNOWN;
      break;
    case 'IndexAssignExpr':
      inferExpr(expr.object, env, registry);
      inferExpr(expr.index, env, registry);
      inferExpr(expr.value, env, registry);
      t = UNKNOWN;
      break;
    case 'BlockExpr': {
      const blockEnv = env.child();
      for (const s of expr.statements) inferStmt(s, blockEnv, registry);
      t = UNKNOWN;
      break;
    }
    default:
      t = UNKNOWN;
  }

  expr.inferredType = t;
  return t;
}

// ─── Binary operator type rules ───────────────────────────────────────────────

function inferBinary(op: string, lt: PfunType, rt: PfunType): PfunType {
  // Comparison operators always produce Bool
  switch (op) {
    case 'EqualToken':
    case 'NotEqualToken':
    case 'LessToken':
    case 'GreaterToken':
    case 'LessEqualToken':
    case 'GreaterEqualToken':
      return BOOL;
    case 'BooleanAnd':
    case 'BooleanOr':
      return BOOL;
  }

  // Arithmetic and concatenation — only when both sides are known and agree
  if (isUnknown(lt) || isUnknown(rt)) return UNKNOWN;

  switch (op) {
    case 'PlusToken':
      if (lt.kind === 'Int'  && rt.kind === 'Int')  return INT;
      if (lt.kind === 'Str'  && rt.kind === 'Str')  return STR;
      if (lt.kind === 'List' && rt.kind === 'List')
        return { kind: 'List', element: typesEqual(lt.element, rt.element) ? lt.element : UNKNOWN };
      return UNKNOWN;
    case 'MinusToken':
    case 'StarToken':
    case 'SlashToken':
    case 'PercentToken':
      return (lt.kind === 'Int' && rt.kind === 'Int') ? INT : UNKNOWN;
  }

  return UNKNOWN;
}

// ─── Statement inference ──────────────────────────────────────────────────────

function inferStmt(stmt: Stmt, env: TypeEnv, registry: TypeRegistry): void {
  switch (stmt.type) {

    case 'LetStmt': {
      const t = inferExpr(stmt.initializer, env, registry);
      stmt.inferredType = t;
      env.define(stmt.name, t);
      break;
    }

    case 'VarStmt': {
      const t = inferExpr(stmt.initializer, env, registry);
      stmt.inferredType = t;
      env.define(stmt.name, t);
      break;
    }

    case 'FunctionStmt':
      inferFnType(stmt.name, stmt.params, stmt.body, env, registry);
      break;

    case 'ProcedureStmt':
      inferFnType(stmt.name, stmt.params, stmt.body, env, registry);
      break;

    case 'ReturnStmt':
      if (stmt.value) inferExpr(stmt.value, env, registry);
      break;

    case 'ExprStmt':
      inferExpr(stmt.expression, env, registry);
      break;

    case 'EvalStmt':
      inferExpr(stmt.expression, env, registry);
      break;

    case 'BlockStmt': {
      const blockEnv = env.child();
      for (const s of stmt.statements) inferStmt(s, blockEnv, registry);
      break;
    }

    case 'IfStmt':
      inferExpr(stmt.condition, env, registry);
      inferStmt(stmt.thenBranch, env, registry);
      if (stmt.elseBranch) inferStmt(stmt.elseBranch, env, registry);
      break;

    case 'ExportStmt':
      inferStmt(stmt.declaration, env, registry);
      break;

    // Register type declarations so RecordExpr construction can attach
    // union context.  No value bindings are produced.
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

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Walk an AST and annotate every node with `inferredType` where resolvable.
 * Mutates nodes in place.  Never throws.
 */
export function inferTypes(stmts: Stmt[]): void {
  const env      = buildBuiltinEnv();
  const registry = new TypeRegistry();
  for (const stmt of stmts) inferStmt(stmt, env, registry);
}

// Re-export for tests
export { TypeEnv, TypeRegistry };
