// src/procedureCheck.ts
//
// Static procedure-usage checker.
//
// Pfun's purity guarantee — "a function can never have a side effect" — used
// to be enforced *only* at runtime, via `Interpreter.inPureContext` checked
// at the moment a procedure is actually invoked (see `trampolineGen` /
// `evaluateExprGen`'s 'CallExpr' case in interpreter.ts). That meant a
// procedure smuggled into pure code as a plain value (passed to a
// higher-order function, stored in a `let`, returned from a function, etc.)
// was only ever caught *if and when* it was actually called — a classic
// dynamic-dispatch gap.
//
// `proc` values never need that dynamic check in the first place, because
// Pfun's `Fn` values (lambdas, `function` declarations) are *categorically*
// pure — there is no such thing as an impure `Fn`. The fix is therefore not
// a general effect-inference system: it is a single, purely syntactic rule,
// checkable without any type information at all:
//
//   A name declared with `proc`/`async proc` may never be read as a value
//   — passed as an argument, stored in a let/var, returned, placed in a
//   list/array/record/dict, matched on, etc. — from within a `function` or
//   lambda body (pure context). It may freely be used as a value from
//   procedural (impure) context — e.g. passed as a callback to a native
//   impure API like `httpListen(port, handleRequest)` — since nothing in
//   impure context can smuggle it into a pure call site; that path is
//   already closed by rule 2 wherever it would matter. And even in
//   procedural context, calling a procedure is only ever a problem when
//   the call itself happens from pure code — rule 2, below.
//
// In other words: rule 1 mirrors rule 2's existing `inPureContext` gating.
// Both rules ask the same underlying question — "could this expression be
// evaluated as part of a function/lambda body?" — for two different
// operations on a `proc` name (reading it as a value vs. calling it).
//
// This single AST walk subsumes the old runtime check entirely: once a
// `proc` name provably can never reach a `Fn`-typed slot (rule 1) and can
// never be invoked from inside pure code (rule 2), nothing impure can ever
// flow into — or be invoked from — pure code, including through
// higher-order functions like `map`/`filter`/`reduce`. The runtime
// `inPureContext` check at the call-invocation site becomes dead code for
// any program that passes this checker; it is retained in the interpreter
// only as a defense-in-depth safety net (see interpreter.ts), never as the
// primary enforcement mechanism going forward.
//
// ─── Rule 3: mutation from pure context ────────────────────────────────────
//
// Mutating a `var` binding (AssignExpr) or an array/dict element
// (IndexAssignExpr) from within a function/lambda body is also a side
// effect, and forbidden by the same guarantee — this was a real gap, found
// and fixed: the interpreter's runtime check already covered
// IndexAssignExpr unconditionally and VarStmt's own declaration, but had
// NO check at all for reassigning an already-declared `var` via AssignExpr
// (e.g. `function f() { counter = counter + 1; }` where `counter` is an
// outer `var` — this ran successfully with no error at all before the
// fix). Both the runtime gap (interpreter.ts's AssignExpr evaluation) and
// the corresponding static check below were fixed together.
//
//   - AssignExpr: flagged only when the assignment target resolves (via
//     the same same-module-only StaticScope used for rules 1/2) to a name
//     declared with `var` in this module. An imported name being mutated
//     is not flagged here, same conservative same-module scope boundary
//     as rules 1/2 — see "Scope of this pass" below; the interpreter's
//     runtime check (rule 3's new AssignExpr guard) is the safety net for
//     that case as for all cross-module cases.
//   - IndexAssignExpr: flagged unconditionally whenever inPureContext is
//     true, regardless of what expr.object resolves to (a var, a
//     function-call result, a field, etc.) — this exactly mirrors the
//     interpreter's own existing unconditional runtime check for this
//     expression kind, which makes no attempt to inspect expr.object
//     either.
//
// ─── Scope of this pass ────────────────────────────────────────────────────
//
// Within a single module's own declarations — locals, parameters, and
// same-file `function`/`proc` names — this checker is precise and complete
// regardless of whether a resolver is supplied.
//
// Cross-module names (anything arriving via `import`) depend on whether
// checkProcedureUsage() is called with a ModuleImportResolver:
//
//   - WITHOUT one (the default — e.g. existing tests, and any caller from
//     before cross-module support existed): imported names are treated as
//     opaque 'other'. A proc imported from another module and misused in
//     the importing module is NOT caught by this pass in that case — only
//     by the interpreter's existing dynamic `inPureContext` check at the
//     moment of invocation. This never produces a false positive.
//   - WITH one (supplied by the whole-program driver,
//     wholeProgramCheck.ts): named, namespace (`import * as X`, including
//     `X.foo` member access/calls), and star imports are all resolved
//     against the imported module's real export-kind table, and rules
//     1/2/3 apply across the module boundary exactly as within one module.
//     This is what makes the static checker viable as the SOLE enforcement
//     mechanism (no runtime `inPureContext` net) for a transpiled program —
//     see wholeProgramCheck.ts for the full graph-resolution design.
//
// A resolver can only ever narrow what's flagged as 'other' into something
// more precise ('function'/'proc'/'var') for names it successfully
// resolves; it never changes same-module behavior, and an unresolvable
// import (the resolver returns null) falls back to the no-resolver
// behavior for exactly that import, not the whole module.
//
// ─── Unrelated concern, same file: let/var for mutable-structure constructors ──
//
// checkMutableLetUsage (below) is NOT part of the purity guarantee above —
// it has nothing to do with `inPureContext` and fires identically in pure
// or impure code. It enforces a different, narrower correctness property:
// a `let` binding may never construct a mutable structure (dict/array/
// buffer), whether via literal syntax (`dict { }` / `array { }`) or a
// builtin constructor call (`toDict`/`listToDict`/`makeBuffer`/
// `makeStringBuffer`).
//
// Why: Pfun's `let` is call-by-name, not memoized (see interpreter.ts's
// Thunk/forceGen — force() re-evaluates the initializer expression on
// every access, it never caches the result). That's invisible for pure
// expressions, but silently wrong for anything mutable: a later statement
// that mutates the binding mutates a fresh, throwaway instance that
// nothing else ever sees, and any subsequent read re-constructs yet
// another fresh, unmutated instance — `bufferToString`/`arrayLength`/etc.
// silently report stale/empty results instead of erroring. `var` evaluates
// its initializer eagerly, once, and stores the actual value, so it
// doesn't have this problem — see VarStmt's handling in interpreter.ts.
//
// interpreter.ts's own LetStmt evaluation has the same guard at runtime
// (and imports the constructor-name lists/helper below from here, rather
// than keeping a duplicate copy, since interpreter.ts already depends on
// this module for checkProcedureUsage — adding a couple more named
// imports from the same module introduces no new dependency or cycle).
// This static copy exists because the runtime guard only fires for code
// that's actually interpreted: a transpiled program has no runtime LetStmt
// evaluation to fall back on at all, and even within the interpreter, a
// violation inside a branch or function that's never executed would stay
// latent forever. Running this at check time, over the whole module
// (including dead code and uncalled functions), closes both gaps.

import { Expr, Stmt, MatchArm } from './ast';
import { SourcePos } from './lexer';

/** A static, compile-time classification of what a name was declared as. */
type NameKind = 'function' | 'proc' | 'var' | 'other';

/**
 * Resolves an import to that module's ImportTable, for cross-module kind
 * lookups. Supplied by the whole-program driver (wholeProgramCheck.ts),
 * which has already parsed and checked every module in the import graph in
 * dependency order before this pass runs on any module that imports from
 * them — see that file for the full design.
 *
 * Returns null if the import can't be resolved to a known table (e.g. the
 * whole-program driver isn't in use at all, or — defensively — a path this
 * resolver doesn't recognize). A null result is NOT a hard error here: this
 * pass falls back to its original, permissive 'other' treatment for that
 * import's names, exactly as if no resolver were supplied at all. Resolution
 * failures that SHOULD be hard errors (a genuinely missing file) are the
 * whole-program driver's responsibility to detect and report — this pass
 * never throws over an import it merely can't resolve, only over an actual
 * rule violation.
 */
export type ModuleImportResolver = (importPath: string, pos: SourcePos | undefined) => ImportTable | null;

/**
 * Set once at the start of each checkProcedureUsage() call, read only by
 * ImportStmt's handling in checkStmt — never mutated mid-walk. Module-level
 * rather than threaded as an explicit parameter through all five mutually
 * recursive check* functions (~50 call sites) because it is genuinely
 * constant for the whole walk, unlike `scope`/`inPureContext` which change
 * per-call; a parameter would be passed unchanged at every single call site.
 * Safe as module state because checkProcedureUsage is fully synchronous
 * (no await, no generators — confirmed by its plain recursive-descent
 * structure) and Node/this codebase has no concurrent/worker-thread calls
 * into it; both real call sites (main.ts, interpreter.ts's ModuleLoader.load)
 * call it once, synchronously, to completion, before anything else runs.
 */
let currentImportResolver: ModuleImportResolver | null = null;

/**
 * A module's exported names and their kinds, as resolved by the
 * whole-program driver (wholeProgramCheck.ts) from that module's own
 * ExportStmts (or, for a built-in module, from ModuleLoader.builtinExportNames
 * — always kind 'other', since natives are never proc-typed; see
 * ModuleLoader.builtinExportNames's docblock in interpreter.ts).
 *
 * Absent here entirely, this checker's behavior is unchanged from before
 * cross-module support existed: checkProcedureUsage() called with no
 * import table (the default) treats every import as opaque 'other',
 * exactly as today.
 */
export type ImportTable = Map<string, NameKind>;

/** What a single name in scope actually refers to: either a plain
 *  declaration kind, or — for a namespace import (`import * as X from
 *  "..."`) — the whole imported module's export table, so a later
 *  `X.foo` can be resolved against it (see StaticScope.resolveMember). */
type ScopeEntry = { tag: 'kind'; kind: NameKind } | { tag: 'namespace'; table: ImportTable };

/**
 * Compile-time scope chain mirroring Environment's shape, but tracking
 * declaration *kind* (or, for namespace imports, an entire module's export
 * table) rather than runtime values.
 */
class StaticScope {
  private bindings = new Map<string, ScopeEntry>();
  constructor(private parent?: StaticScope) {}

  define(name: string, kind: NameKind): void {
    this.bindings.set(name, { tag: 'kind', kind });
  }

  /** Bind `name` as a namespace import standing for an entire module's
   *  export table (`import * as X from "..."` → defineNamespace('X', ...)). */
  defineNamespace(name: string, table: ImportTable): void {
    this.bindings.set(name, { tag: 'namespace', table });
  }

  private resolveEntry(name: string): ScopeEntry | undefined {
    let scope: StaticScope | undefined = this;
    while (scope) {
      const found = scope.bindings.get(name);
      if (found !== undefined) return found;
      scope = scope.parent;
    }
    return undefined;
  }

  /** Resolve a name's kind by walking outward through enclosing scopes.
   *  Names with no visible declaration (builtins with no static table,
   *  undeclared — the latter is a Name error caught elsewhere) are treated
   *  as 'other', matching this pass's policy: never flag what it cannot
   *  prove. A namespace binding itself (the bare name `X`, not `X.foo`)
   *  also resolves as 'other' — it is not a function/proc/var value in
   *  its own right; only `X.foo` (via resolveMember) carries real kind
   *  information. */
  resolve(name: string): NameKind {
    const entry = this.resolveEntry(name);
    if (!entry || entry.tag === 'namespace') return 'other';
    return entry.kind;
  }

  /** Resolve `name.member`'s kind when `name` is bound to a namespace
   *  import — used for GetExpr/namespaced-call handling (rule 1/2 across
   *  a `import * as X from "..."` boundary). Returns null if `name` is not
   *  a namespace binding in scope (the caller should fall back to treating
   *  the GetExpr as an ordinary value read in that case). */
  resolveMember(name: string, member: string): NameKind | null {
    const entry = this.resolveEntry(name);
    if (!entry || entry.tag !== 'namespace') return null;
    return entry.table.get(member) ?? 'other';
  }

  child(): StaticScope {
    return new StaticScope(this);
  }
}

/** Throws a plain Error with `.pos` set, matching the convention used by the
 *  lexer/parser (see main.ts's `(raw as any).pos` handling) so these errors
 *  flow through the existing buildPfunError pipeline unchanged. */
function procError(message: string, pos: SourcePos | undefined): never {
  const err = new Error(message);
  (err as any).pos = pos;
  throw err;
}

// ─── Mutable-structure constructor detection (let/var check, see file header) ──
//
// `dict { }` and `array { }` have dedicated literal AST node types
// (DictExpr/ArrayExpr), checked structurally below. Buffers have no
// literal syntax at all — they're only ever constructed by calling a
// builtin (makeBuffer/makeStringBuffer) — and dictionaries can ALSO be
// built via a builtin call (toDict/listToDict) rather than the dict { }
// literal. Those paths are plain CallExprs, so they're caught here by
// callee name instead.
//
// Exported so interpreter.ts can import this single source of truth for
// its own runtime LetStmt guard rather than keeping a duplicate copy.
//
// Safe against shadowing: these names are core builtins, and the
// interpreter's checkNameAvailable forbids ever redefining a native
// function anywhere in a program, so a CallExpr whose callee is one of
// these names can only ever refer to the real builtin — never a user
// override.
//
// NOTE: toArray() has the same gap for PfunArray (a `let`-bound array
// built via toArray() rather than the array { } literal silently loses
// mutations across statements) but is not covered here.

export const DICT_CONSTRUCTOR_CALLS   = new Set(['toDict', 'listToDict']);
export const BUFFER_CONSTRUCTOR_CALLS = new Set(['makeBuffer', 'makeStringBuffer']);

/** Unwraps GroupExpr wrappers, e.g. `let d = (toDict(x));`. */
export function unwrapGroup(expr: Expr): Expr {
  while (expr.type === 'GroupExpr') expr = expr.expression;
  return expr;
}

/**
 * If `expr` (after unwrapping any parens) is a direct call to one of
 * `names`, returns the callee name; otherwise returns null. Only matches
 * direct identifier calls (`toDict(x)`), not namespace-qualified or
 * computed callees — core builtins are never called any other way.
 */
export function matchedConstructorCall(expr: Expr, names: Set<string>): string | null {
  const e = unwrapGroup(expr);
  if (e.type === 'CallExpr' && e.callee.type === 'IdentExpr' && names.has(e.callee.name)) {
    return e.callee.name;
  }
  return null;
}

/**
 * Checks a single LetStmt's initializer for the mutable-structure-
 * construction rule described in this file's header. Throws via
 * procError on a violation; otherwise returns normally. Purely syntactic
 * — no scope, no resolver, no cross-module awareness needed, since the
 * rule only ever looks at the shape of the initializer expression itself.
 */
function checkMutableLetUsage(name: string, initializer: Expr, pos: SourcePos | undefined): void {
  if (initializer.type === 'DictExpr') {
    procError(`Dictionaries must be declared with 'var', not 'let'. Use: var ${name} = dict { ... }`, pos);
  }
  if (initializer.type === 'ArrayExpr') {
    procError(`Arrays must be declared with 'var', not 'let'. Use: var ${name} = array { ... }`, pos);
  }
  const dictCall = matchedConstructorCall(initializer, DICT_CONSTRUCTOR_CALLS);
  if (dictCall) {
    procError(`Dictionaries must be declared with 'var', not 'let'. Use: var ${name} = ${dictCall}(...)`, pos);
  }
  const bufferCall = matchedConstructorCall(initializer, BUFFER_CONSTRUCTOR_CALLS);
  if (bufferCall) {
    procError(`Buffers must be declared with 'var', not 'let'. Use: var ${name} = ${bufferCall}(...)`, pos);
  }
}

/**
 * Walk an expression in VALUE position: the result of evaluating this
 * expression is meant to be used as a first-class value (assigned, passed,
 * stored, returned, matched on, etc.) — *not* immediately called.
 *
 * `inPureContext` is true while walking the body of a `function` statement
 * or a lambda (which can only ever be a function, never a procedure — see
 * the 'function'-only kind given to LambdaExpr in interpreter.ts).
 */
function checkExprValue(expr: Expr, scope: StaticScope, inPureContext: boolean): void {
  switch (expr.type) {
    case 'IdentExpr': {
      const kind = scope.resolve(expr.name);
      if (kind === 'proc' && inPureContext) {
        procError(
          `Functions cannot use '${expr.name}' as a value: '${expr.name}' is a procedure. ` +
          `Procedures may only be called directly, e.g. '${expr.name}(...)'.`,
          expr.pos
        );
      }
      return;
    }
    case 'IntExpr': case 'FloatExpr': case 'BoolExpr': case 'StrExpr':
    case 'CharExpr': case 'ByteExpr':
      return;
    case 'UnaryExpr':
      checkExprValue(expr.right, scope, inPureContext);
      return;
    case 'BinaryExpr':
      checkExprValue(expr.left, scope, inPureContext);
      checkExprValue(expr.right, scope, inPureContext);
      return;
    case 'GroupExpr':
      checkExprValue(expr.expression, scope, inPureContext);
      return;
    case 'AssignExpr':
      // expr.value (rule 1 — proc-as-value) is checked before expr.name
      // (rule 3 — var mutation) so that a program violating both at once
      // (e.g. `g = sideEffect;` where g is a var AND sideEffect is a
      // proc) reports the rule-1 violation first, matching this checker's
      // pre-existing error-priority ordering and test expectations.
      // expr.name is the assignment target, not a read — checked as a
      // mutation target below, not via checkExprValue (which would treat
      // it as a read).
      checkExprValue(expr.value, scope, inPureContext);
      if (inPureContext && scope.resolve(expr.name) === 'var') {
        procError(
          `Functions cannot mutate '${expr.name}': '${expr.name}' is a 'var' binding and side-effectful ` +
          `mutation is not allowed in pure functions. Use a procedure instead.`,
          expr.pos
        );
      }
      return;
    case 'CallExpr': {
      checkCallExpr(expr, scope, inPureContext);
      return;
    }
    case 'LambdaExpr': {
      // A lambda body is itself function-kind code: always pure context,
      // regardless of the context it's written in.
      const inner = scope.child();
      for (const p of expr.params) inner.define(p, 'other');
      checkExprValue(expr.body, inner, true);
      return;
    }
    case 'TernaryExpr':
      checkExprValue(expr.condition, scope, inPureContext);
      checkExprValue(expr.thenBranch, scope, inPureContext);
      checkExprValue(expr.elseBranch, scope, inPureContext);
      return;
    case 'ListExpr':
      for (const el of expr.elements) checkExprValue(el, scope, inPureContext);
      return;
    case 'RecordExpr':
      for (const f of expr.fields) checkExprValue(f.value, scope, inPureContext);
      return;
    case 'GetExpr':
      // Namespace-qualified value use: `X.foo` where X is bound via
      // `import * as X from "..."`. If X resolves to a namespace binding
      // and `foo` is a proc in that module's export table, this is rule 1
      // across the module boundary — otherwise (X isn't a namespace
      // binding, or foo isn't a proc) fall through to checking expr.object
      // as an ordinary value read, same as before namespace support
      // existed.
      if (expr.object.type === 'IdentExpr') {
        const memberKind = scope.resolveMember(expr.object.name, expr.name);
        if (memberKind === 'proc' && inPureContext) {
          procError(
            `Functions cannot use '${expr.object.name}.${expr.name}' as a value: ` +
            `'${expr.name}' is a procedure in module '${expr.object.name}'. ` +
            `Procedures may only be called directly, e.g. '${expr.object.name}.${expr.name}(...)'.`,
            expr.pos
          );
        }
        if (memberKind !== null) return; // X is a namespace binding — handled above, nothing else to recurse into.
      }
      checkExprValue(expr.object, scope, inPureContext);
      return;
    case 'MatchExpr':
      checkExprValue(expr.subject, scope, inPureContext);
      for (const arm of expr.arms) checkMatchArm(arm, scope, inPureContext);
      return;
    case 'ComprehensionExpr': {
      let cur = scope;
      for (const gen of expr.generators) {
        checkExprValue(gen.source, cur, inPureContext);
        cur = cur.child();
        cur.define(gen.variable, 'other');
      }
      if (expr.guard) checkExprValue(expr.guard, cur, inPureContext);
      checkExprValue(expr.body, cur, inPureContext);
      return;
    }
    case 'DictExpr':
      for (const e of expr.entries) {
        checkExprValue(e.key, scope, inPureContext);
        checkExprValue(e.value, scope, inPureContext);
      }
      return;
    case 'ArrayExpr':
      for (const el of expr.elements) checkExprValue(el, scope, inPureContext);
      return;
    case 'IndexExpr':
      checkExprValue(expr.object, scope, inPureContext);
      checkExprValue(expr.index, scope, inPureContext);
      return;
    case 'IndexAssignExpr':
      // Array/dict element mutation is unconditionally forbidden in pure
      // context, regardless of how the array/dict reference was obtained
      // (a var, a function-call result, a field, etc.) — matching the
      // interpreter's own existing unconditional runtime check for this
      // expression kind (see evaluateExprGen's 'IndexAssignExpr' case in
      // interpreter.ts, which throws whenever inPureContext is true with
      // no further inspection of expr.object at all).
      if (inPureContext) {
        procError(
          'Functions cannot mutate arrays or dicts: side-effectful mutation is not allowed in pure functions. ' +
          'Use a procedure instead.',
          expr.pos
        );
      }
      checkExprValue(expr.object, scope, inPureContext);
      checkExprValue(expr.index, scope, inPureContext);
      checkExprValue(expr.value, scope, inPureContext);
      return;
    case 'BlockExpr': {
      const inner = scope.child();
      for (const s of expr.statements) checkStmt(s, inner, inPureContext);
      return;
    }
    case 'AwaitExpr':
      checkExprValue(expr.value, scope, inPureContext);
      return;
  }
}

/**
 * Walk a CallExpr. The callee is checked specially: if it is a bare
 * IdentExpr, it is in direct callee position (rule 1 doesn't apply to it),
 * but if it resolves to a procedure AND we're in pure context, that's rule
 * 2 — calling a procedure from a function/lambda is itself the side effect.
 *
 * A namespaced callee (`X.foo(...)` where X is a namespace import) gets the
 * same treatment: direct callee position, but checked against X's export
 * table for rule 2.
 *
 * Any other callee shape (a parenthesized lambda, the result of another
 * call, a GetExpr where the object isn't a namespace binding, etc.) is
 * checked in ordinary value position.
 */
function checkCallExpr(expr: Expr & { type: 'CallExpr' }, scope: StaticScope, inPureContext: boolean): void {
  if (expr.callee.type === 'IdentExpr') {
    const kind = scope.resolve(expr.callee.name);
    if (kind === 'proc' && inPureContext) {
      procError(
        `Functions cannot call procedures: '${expr.callee.name}' is a procedure. ` +
        `Move the call to a procedure, or convert '${expr.callee.name}' to a function.`,
        expr.pos
      );
    }
    // Direct callee position — not a value use, so no rule-1 check here
    // even if kind === 'proc' and we're in impure context.
  } else if (expr.callee.type === 'GetExpr' && expr.callee.object.type === 'IdentExpr') {
    const memberKind = scope.resolveMember(expr.callee.object.name, expr.callee.name);
    if (memberKind === 'proc' && inPureContext) {
      procError(
        `Functions cannot call procedures: '${expr.callee.object.name}.${expr.callee.name}' is a procedure in ` +
        `module '${expr.callee.object.name}'. Move the call to a procedure, or convert ` +
        `'${expr.callee.name}' to a function.`,
        expr.pos
      );
    }
    if (memberKind === null) {
      // expr.callee.object isn't a namespace binding — fall back to
      // ordinary value-position checking for the whole GetExpr (handles
      // e.g. a record field that happens to hold a function value).
      checkExprValue(expr.callee, scope, inPureContext);
    }
    // Direct (namespaced) callee position otherwise — same rationale as
    // the bare-IdentExpr branch above: no rule-1 check here even if
    // memberKind === 'proc' and we're in impure context.
  } else {
    checkExprValue(expr.callee, scope, inPureContext);
  }
  for (const a of expr.args) checkExprValue(a, scope, inPureContext);
}

function checkMatchArm(arm: MatchArm, scope: StaticScope, inPureContext: boolean): void {
  const inner = scope.child();
  if (arm.binding) inner.define(arm.binding, 'other');
  if (arm.guard) checkExprValue(arm.guard, inner, inPureContext);
  checkExprValue(arm.body, inner, inPureContext);
}

/**
 * Walk a statement. `inPureContext` is true while inside a `function`
 * statement's own body (and propagates into any nested lambda bodies,
 * which are unconditionally pure regardless of where they're written).
 */
function checkStmt(stmt: Stmt, scope: StaticScope, inPureContext: boolean): void {
  switch (stmt.type) {
    case 'LetStmt':
      // checkExprValue (rule 1 — proc-as-value) runs before
      // checkMutableLetUsage so that a statement violating both at once
      // (e.g. `let a = array { sideEffect };` — a proc embedded in an
      // array literal that also needs 'var') reports the rule-1 violation
      // first, matching this checker's existing error-priority convention
      // (see AssignExpr's handling below for the same ordering rationale).
      checkExprValue(stmt.initializer, scope, inPureContext);
      checkMutableLetUsage(stmt.name, stmt.initializer, stmt.pos);
      scope.define(stmt.name, 'other');
      return;
    case 'VarStmt':
      checkExprValue(stmt.initializer, scope, inPureContext);
      scope.define(stmt.name, 'var');
      return;
    case 'TypeStmt':
    case 'UnionTypeStmt':
      return;
    case 'ExprStmt':
      checkExprValue(stmt.expression, scope, inPureContext);
      return;
    case 'BlockStmt': {
      const inner = scope.child();
      for (const s of stmt.statements) checkStmt(s, inner, inPureContext);
      return;
    }
    case 'IfStmt':
      checkExprValue(stmt.condition, scope, inPureContext);
      checkStmt(stmt.thenBranch, scope, inPureContext);
      if (stmt.elseBranch) checkStmt(stmt.elseBranch, scope, inPureContext);
      return;
    case 'FunctionStmt': {
      // Bind the function's own name *before* walking its body, mirroring
      // interpreter.ts's env.define-then-close-over-env order, so direct
      // and mutual recursion resolve correctly.
      scope.define(stmt.name, 'function');
      const inner = scope.child();
      for (const p of stmt.params) inner.define(p, 'other');
      // A function body is always pure context, regardless of the context
      // the FunctionStmt itself appears in.
      for (const s of stmt.body) checkStmt(s, inner, true);
      return;
    }
    case 'ProcedureStmt': {
      scope.define(stmt.name, 'proc');
      const inner = scope.child();
      for (const p of stmt.params) inner.define(p, 'other');
      // A procedure body is impure context, UNLESS this ProcedureStmt
      // itself is nested inside a function/lambda body (a proc declared
      // textually inside a function is still just a value/declaration
      // until called — but Pfun's grammar declares functions/procs only
      // at block level, and a ProcedureStmt nested inside an in-progress
      // function body would itself need to be reached via a call from
      // that function, which rule 2 already forbids at the point of
      // definition-call, not definition-declare). We conservatively keep
      // the body's own context impure (procedures may always call other
      // procedures), since the *declaration* of a proc is not itself an
      // effect — only a function's later *call* to it would be, and that
      // is caught at the call site by rule 2 regardless of how the proc
      // was declared or where.
      for (const s of stmt.body) checkStmt(s, inner, false);
      return;
    }
    case 'ReturnStmt':
      if (stmt.value) checkExprValue(stmt.value, scope, inPureContext);
      return;
    case 'EvalStmt':
      checkExprValue(stmt.expression, scope, inPureContext);
      return;
    case 'ImportStmt': {
      // Without a resolver (the default — preserves this pass's original,
      // pre-cross-module behavior exactly), every imported name is opaque
      // 'other', same as before cross-module support existed. With one
      // (supplied by the whole-program driver, wholeProgramCheck.ts), look
      // up each imported name's real kind in the resolved module's export
      // table; a name absent from that table (e.g. it doesn't actually
      // exist — a different error the driver/interpreter will catch
      // elsewhere) falls back to 'other' rather than crashing this pass.
      const table = currentImportResolver ? currentImportResolver(stmt.path, stmt.pos) : null;
      if (stmt.kind === 'named') {
        for (const n of stmt.names) {
          const bindName = n.alias ?? n.name;
          scope.define(bindName, table?.get(n.name) ?? 'other');
        }
      } else if (stmt.kind === 'namespace') {
        if (table) scope.defineNamespace(stmt.alias, table);
        else scope.define(stmt.alias, 'other');
      } else {
        // 'star' — every export of the resolved module binds directly
        // into this scope, same as the runtime's own star-import binding
        // (interpreter.ts's ImportStmt evaluation, 'star' branch).
        if (table) for (const [name, kind] of table) scope.define(name, kind);
        // No table (no resolver, or resolution failed): nothing to define
        // here, matching the pre-cross-module behavior exactly — an open,
        // unenumerable set of names, none of them checkable.
      }
      return;
    }
    case 'ExportStmt':
      checkStmt(stmt.declaration, scope, inPureContext);
      return;
  }
}

/**
 * Run the static procedure-usage checker over a parsed module's top-level
 * statements. Throws a plain Error (with `.pos` set) on the first violation
 * found, matching the lexer/parser's error convention — see main.ts.
 *
 * Call this once per module, immediately after parsing and before
 * interpretation (or, eventually, before code generation) — it requires no
 * type information and is independent of the inferencer/typechecker passes.
 *
 * @param statements  The module's parsed top-level statements.
 * @param resolver    Optional. Resolves an import path to that module's
 *   ImportTable, enabling real cross-module kind checks (rule 1/2/3 across
 *   a module boundary, including through namespace imports). Omitted (the
 *   default), every import is treated as opaque 'other', exactly as before
 *   cross-module support existed — so all pre-existing callers/tests are
 *   unaffected. Supplied by the whole-program driver
 *   (wholeProgramCheck.ts), which has already checked every module in the
 *   import graph in dependency order before calling this on a module that
 *   imports from them.
 */
export function checkProcedureUsage(statements: Stmt[], resolver?: ModuleImportResolver): void {
  const root = new StaticScope();
  // Top level starts in impure ("procedural") context — matching
  // Interpreter.inPureContext's default of `false` and main.ts's runFile,
  // which interprets top-level statements directly (not as a function
  // body). The REPL's pure-mode override (main.ts sets
  // `interp.inPureContext = true` for the whole interactive session) is a
  // dynamic, REPL-only policy choice with no equivalent here; this checker
  // validates a module's *own* declarations, which is unaffected by how an
  // interactive session chooses to evaluate top-level expressions.
  currentImportResolver = resolver ?? null;
  try {
    for (const stmt of statements) checkStmt(stmt, root, false);
  } finally {
    // Always clear, even if a rule violation threw — mirrors
    // ModuleLoader.load's try/finally around its own `loading` Set cleanup
    // (interpreter.ts), same rationale: never leave shared state stuck
    // after an error.
    currentImportResolver = null;
  }
}
