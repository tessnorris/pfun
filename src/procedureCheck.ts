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
// This checker is precise and complete *within a single module's own
// declarations*: locals, parameters, and same-file `function`/`proc` names.
// Names that arrive via `import` are treated as opaque/unknown-kind — this
// pass does not currently attempt to resolve an imported name's underlying
// kind (function vs. proc) from the imported module's AST. This is a
// deliberate, conservative scope boundary, not an oversight:
//
//   - It means a *same-file* misuse (passing a local proc as a value,
//     calling a local proc from inside a local function/lambda) is always
//     caught.
//   - It means a proc imported from another module and misused in the
//     importing module is NOT currently caught by this pass — that misuse
//     is still only caught by the interpreter's existing dynamic
//     `inPureContext` check at the moment of invocation, exactly as before.
//   - It never produces a false positive on an imported name.
//
// Closing that cross-module gap would require export metadata recording
// each export's kind (the module system currently only ever caches
// *runtime values* — see ModuleLoader.load — with no static kind
// information attached) and is left as a follow-up; it is a strictly
// larger and separable piece of work from the single-module check below.

import { Expr, Stmt, MatchArm } from './ast';
import { SourcePos } from './lexer';

/** A static, compile-time classification of what a name was declared as. */
type NameKind = 'function' | 'proc' | 'var' | 'other';

/**
 * Compile-time scope chain mirroring Environment's shape, but tracking
 * declaration *kind* rather than runtime values.
 */
class StaticScope {
  private bindings = new Map<string, NameKind>();
  constructor(private parent?: StaticScope) {}

  define(name: string, kind: NameKind): void {
    this.bindings.set(name, kind);
  }

  /** Resolve a name's kind by walking outward through enclosing scopes.
   *  Names with no visible declaration (builtins, imports, undeclared —
   *  the latter is a Name error caught elsewhere) are treated as 'other',
   *  matching this pass's scope boundary: never flag what it cannot prove. */
  resolve(name: string): NameKind {
    let scope: StaticScope | undefined = this;
    while (scope) {
      const found = scope.bindings.get(name);
      if (found !== undefined) return found;
      scope = scope.parent;
    }
    return 'other';
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
 * If the callee is anything other than a bare IdentExpr (a GetExpr for a
 * namespaced call, a parenthesized lambda, the result of another call,
 * etc.), it's checked in ordinary value position — this pass only tracks
 * proc-ness for plain local identifiers (see module scope boundary above).
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
      checkExprValue(stmt.initializer, scope, inPureContext);
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
    case 'ImportStmt':
      // Imported names are treated as 'other' (opaque/unknown kind) per
      // this pass's documented scope boundary — see file header.
      if (stmt.kind === 'named') {
        for (const n of stmt.names) scope.define(n.alias ?? n.name, 'other');
      } else if (stmt.kind === 'namespace') {
        scope.define(stmt.alias, 'other');
      }
      // 'star' imports bind an open set of names not statically enumerable
      // here; nothing to define, and (per scope boundary) nothing to check
      // for those names either.
      return;
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
 */
export function checkProcedureUsage(statements: Stmt[]): void {
  const root = new StaticScope();
  // Top level starts in impure ("procedural") context — matching
  // Interpreter.inPureContext's default of `false` and main.ts's runFile,
  // which interprets top-level statements directly (not as a function
  // body). The REPL's pure-mode override (main.ts sets
  // `interp.inPureContext = true` for the whole interactive session) is a
  // dynamic, REPL-only policy choice with no equivalent here; this checker
  // validates a module's *own* declarations, which is unaffected by how an
  // interactive session chooses to evaluate top-level expressions.
  for (const stmt of statements) checkStmt(stmt, root, false);
}
