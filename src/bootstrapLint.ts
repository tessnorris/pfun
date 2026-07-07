// src/bootstrapLint.ts
//
// The "subtraction" half of the V1 bootstrap dialect. The lexer/parser were
// extended additively to ACCEPT V2 syntax; this pass runs after parse and
// REJECTS the constructs that are valid V1 but forbidden in the V2
// bootstrap-safe subset (see the V2 architecture doc, Phase J checklist).
//
// It is a pure rejecter: it never transforms the AST, so it cannot change
// runtime behavior. Enabled only when compiling V2 compiler sources with the
// V1-extended toolchain (`--dialect=bootstrap`); ordinary V1 code is unaffected.
//
// Checklist items enforced here (numbers match the doc):
//   3  no `lazy` in compiler sources
//   6  `++` for strings, never `+` for strings (syntactic slice; full check is
//      a type property left to V2 stage2)
//   7  only `fn` lambdas; assignment only as a statement; no `export var`
//   11 no Float literals / float arithmetic in compiler sources
//
// Items needing type/name information (full string-`+`, proc-as-value beyond
// proc lambdas, exhaustiveness, groundedness) are intentionally deferred to V2
// stage2, which checks the sources under real V2 rules.

import { Expr, Stmt, MatchArm } from './ast';
import { SourcePos } from './lexer';

export interface LintDiag {
  code: 'BootstrapD';
  message: string;
  pos?: SourcePos;
}

export function bootstrapLint(program: Stmt[]): LintDiag[] {
  const diags: LintDiag[] = [];
  const err = (message: string, pos?: SourcePos) =>
    diags.push({ code: 'BootstrapD', message, pos });

  // `inExprPosition` is true when the expression is nested inside a larger
  // expression (not the direct statement expression). Used to reject assignment
  // in expression position while allowing it as a statement.
  function walkExpr(e: Expr | undefined, inExprPosition: boolean): void {
    if (!e) return;
    switch (e.type) {
      case 'FloatExpr':
        err('Float literals are not allowed in bootstrap compiler sources (checklist 11); keep floats as source text until emission.', e.pos);
        return;

      case 'AssignExpr':
        if (inExprPosition)
          err('Assignment is a statement in V2, not an expression (checklist 7). Move it to its own statement.', e.pos);
        walkExpr(e.value, true);
        return;

      case 'IndexAssignExpr':
        if (inExprPosition)
          err('Assignment is a statement in V2, not an expression (checklist 7). Move it to its own statement.', e.pos);
        walkExpr(e.object, true);
        walkExpr(e.index, true);
        walkExpr(e.value, true);
        return;

      case 'LambdaExpr':
        if (e.isProc)
          err('Proc lambdas are not allowed in V2 (checklist 7); procs are second-class. Use a named proc.', e.pos);
        walkExpr(e.body, false);
        return;

      case 'BinaryExpr': {
        // Cheap, sound slice of checklist 6: raw '+' on a literal string/char
        // operand. (Full "+ never on strings" is a type property for stage2.)
        // Only a real '+' (not a desugared '++') on a string/char literal is a
        // violation. `srcOp === '++'` marks the allowed string-concat form.
        if (e.operator === 'PlusToken' && (e as any).srcOp !== '++') {
          const lit = (x: Expr) => x.type === 'StrExpr' || x.type === 'CharExpr';
          if (lit(e.left) || lit(e.right))
            err("Use '++' for string concatenation, not '+' (checklist 6). '+' is numeric-only in V2.", e.pos);
        }
        walkExpr(e.left, true);
        walkExpr(e.right, true);
        return;
      }

      case 'ListExpr':
        if ((e as any).isLazy)
          err("'lazy' is not allowed in bootstrap compiler sources (checklist 3); V1 evaluates it strictly while V2 is lazy.", e.pos);
        e.elements.forEach(x => walkExpr(x, true));
        return;

      case 'ComprehensionExpr':
        if ((e as any).isLazy)
          err("'lazy' is not allowed in bootstrap compiler sources (checklist 3); V1 evaluates it strictly while V2 is lazy.", e.pos);
        walkExpr(e.body, true);
        e.generators.forEach(g => walkExpr(g.source, true));
        walkExpr(e.guard, true);
        return;

      case 'UnaryExpr':   walkExpr(e.right, true); return;
      case 'GroupExpr':   walkExpr(e.expression, true); return;
      case 'CallExpr':    walkExpr(e.callee, true); e.args.forEach(a => walkExpr(a, true)); return;
      case 'TernaryExpr': walkExpr(e.condition, true); walkExpr(e.thenBranch, true); walkExpr(e.elseBranch, true); return;
      case 'ArrayExpr':   e.elements.forEach(x => walkExpr(x, true)); return;
      case 'RecordExpr':  e.fields.forEach(f => walkExpr(f.value, true)); return;
      case 'GetExpr':     walkExpr(e.object, true); return;
      case 'IndexExpr':   walkExpr(e.object, true); walkExpr(e.index, true); return;
      case 'MatchExpr':   walkExpr(e.subject, true); e.arms.forEach(walkArm); return;
      case 'DictExpr':    e.entries.forEach(en => { walkExpr(en.key, true); walkExpr(en.value, true); }); return;
      case 'BlockExpr':   e.statements.forEach(walkStmt); return;
      case 'AwaitExpr':   walkExpr(e.value, true); return;
      default: return; // literals, ident
    }
  }

  function walkArm(a: MatchArm): void {
    walkExpr(a.guard, true);
    walkExpr(a.body, false);
  }

  function walkStmt(s: Stmt): void {
    switch (s.type) {
      case 'ExportStmt':
        if (s.declaration.type === 'VarStmt')
          err("'export var' is not allowed in V2 (checklist 7); module mutable state is private.", s.pos ?? s.declaration.pos);
        walkStmt(s.declaration);
        return;

      case 'LetStmt':       walkExpr(s.initializer, true); return;
      case 'VarStmt':       walkExpr(s.initializer, true); return;
      case 'ExprStmt':      walkExpr(s.expression, false); return; // statement position
      case 'EvalStmt':      walkExpr(s.expression, false); return;
      case 'ReturnStmt':    walkExpr(s.value, true); return;
      case 'IfStmt':        walkExpr(s.condition, true); walkStmt(s.thenBranch); if (s.elseBranch) walkStmt(s.elseBranch); return;
      case 'WhileStmt':     walkExpr(s.condition, true); s.body.forEach(walkStmt); return;
      case 'BlockStmt':     s.statements.forEach(walkStmt); return;
      case 'FunctionStmt':  s.body.forEach(walkStmt); return;
      case 'ProcedureStmt': s.body.forEach(walkStmt); return;
      default: return; // type decls, imports
    }
  }

  program.forEach(walkStmt);
  return diags;
}
