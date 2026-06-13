// src/test/exhaustiveness.test.ts
//
// Tests that the compile-time exhaustiveness pass (inferTypes → collectMatchExprs
// in main.ts) correctly identifies non-exhaustive matches before the interpreter
// runs, and that exhaustive matches (or those with wildcards) pass through cleanly.
//
// These tests exercise the inference + collection logic directly — they do not
// invoke main.ts (which calls process.exit).  Instead they replicate the same
// pipeline: parse → inferTypes → walk AST for missingVariants.

import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Stmt, Expr } from '../ast';
import { inferTypes } from '../typechecker';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parse(src: string): Stmt[] {
  return new Parser(new Lexer(src).lex()).parse();
}

function pipeline(src: string): Stmt[] {
  const stmts = parse(src);
  inferTypes(stmts);
  return stmts;
}

/** Collect every MatchExpr node in the AST, depth-first. */
function collectMatchExprs(stmts: Stmt[]): any[] {
  const results: any[] = [];

  function walkExpr(e: Expr): void {
    if (!e) return;
    switch (e.type) {
      case 'MatchExpr':
        results.push(e);
        walkExpr(e.subject);
        for (const arm of e.arms) walkExpr(arm.body);
        break;
      case 'BinaryExpr':   walkExpr(e.left); walkExpr(e.right); break;
      case 'UnaryExpr':    walkExpr(e.right); break;
      case 'GroupExpr':    walkExpr(e.expression); break;
      case 'TernaryExpr':  walkExpr(e.condition); walkExpr(e.thenBranch); walkExpr(e.elseBranch); break;
      case 'CallExpr':     walkExpr(e.callee); e.args.forEach(walkExpr); break;
      case 'LambdaExpr':   walkExpr(e.body); break;
      case 'ListExpr':     e.elements.forEach(walkExpr); break;
      case 'RecordExpr':   e.fields.forEach(f => walkExpr(f.value)); break;
      case 'GetExpr':      walkExpr(e.object); break;
      case 'AssignExpr':   walkExpr(e.value); break;
      case 'IndexExpr':    walkExpr(e.object); walkExpr(e.index); break;
      case 'IndexAssignExpr': walkExpr(e.object); walkExpr(e.index); walkExpr(e.value); break;
      case 'ComprehensionExpr':
        e.generators.forEach(g => walkExpr(g.source));
        if (e.guard) walkExpr(e.guard);
        walkExpr(e.body);
        break;
      case 'BlockExpr':    e.statements.forEach(walkStmt); break;
      case 'DictExpr':     e.entries.forEach(en => { walkExpr(en.key); walkExpr(en.value); }); break;
      case 'ArrayExpr':    e.elements.forEach(walkExpr); break;
    }
  }

  function walkStmt(s: Stmt): void {
    if (!s) return;
    switch (s.type) {
      case 'ExprStmt':
      case 'EvalStmt':      walkExpr(s.expression); break;
      case 'LetStmt':
      case 'VarStmt':       walkExpr(s.initializer); break;
      case 'ReturnStmt':    if (s.value) walkExpr(s.value); break;
      case 'IfStmt':        walkExpr(s.condition); walkStmt(s.thenBranch); if (s.elseBranch) walkStmt(s.elseBranch); break;
      case 'BlockStmt':     s.statements.forEach(walkStmt); break;
      case 'FunctionStmt':
      case 'ProcedureStmt': s.body.forEach(walkStmt); break;
      case 'ExportStmt':    walkStmt(s.declaration); break;
    }
  }

  for (const s of stmts) walkStmt(s);
  return results;
}

/** Returns the list of compile-time exhaustiveness violations in a program. */
function violations(src: string): Array<{ unionName: string; missing: string[] }> {
  const stmts = pipeline(src);
  const matches = collectMatchExprs(stmts);
  return matches
    .filter(m => m.missingVariants && m.missingVariants.length > 0)
    .map(m => ({
      unionName: m.subject?.inferredType?.unionName ?? m.subject?.inferredType?.name ?? 'unknown',
      missing:   m.missingVariants as string[],
    }));
}

// ─── No violations — clean programs ──────────────────────────────────────────

describe('Exhaustive matches — no violations', () => {
  it('covers all variants of a two-variant union', () => {
    expect(violations(`
      type Toggle = { | On | Off }
      let t = On;
      let r = match t with | On -> 1 | Off -> 0;
    `)).toHaveLength(0);
  });

  it('covers all variants of a three-variant union', () => {
    expect(violations(`
      type Shape = { | Square: side | Circle: radius | Rectangle: x, y }
      let s = Square { 5 };
      let r = match s with
        | Square sq -> sq.side
        | Circle c  -> c.radius
        | Rectangle r -> r.x;
    `)).toHaveLength(0);
  });

  it('wildcard arm satisfies exhaustiveness regardless of covered variants', () => {
    expect(violations(`
      type Shape = { | Square: side | Circle: radius | Rectangle: x, y }
      let s = Square { 5 };
      let r = match s with | Square sq -> sq.side | _ -> 0;
    `)).toHaveLength(0);
  });

  it('does not flag a match on an Unknown-typed subject', () => {
    // subject is a function param — Unknown type, skipped
    expect(violations(`
      type Shape = { | Square: side | Circle: radius }
      function area(s) {
        return match s with | Square sq -> sq.side;
      }
    `)).toHaveLength(0);
  });

  it('does not flag a match on a plain record (no unionName)', () => {
    expect(violations(`
      type Point = { x, y }
      let p = Point { 1, 2 };
      let r = match p with | Point pt -> pt.x;
    `)).toHaveLength(0);
  });
});

// ─── Violations — non-exhaustive matches ─────────────────────────────────────

describe('Non-exhaustive matches — violations detected', () => {
  it('flags one missing variant', () => {
    const v = violations(`
      type Shape = { | Square: side | Circle: radius | Rectangle: x, y }
      let s = Square { 5 };
      let r = match s with
        | Square sq -> sq.side
        | Circle c  -> c.radius;
    `);
    expect(v).toHaveLength(1);
    expect(v[0].unionName).toBe('Shape');
    expect(v[0].missing).toEqual(['Rectangle']);
  });

  it('flags two missing variants', () => {
    const v = violations(`
      type Shape = { | Square: side | Circle: radius | Rectangle: x, y }
      let s = Square { 5 };
      let r = match s with | Square sq -> sq.side;
    `);
    expect(v).toHaveLength(1);
    expect(v[0].missing).toEqual(expect.arrayContaining(['Circle', 'Rectangle']));
    expect(v[0].missing).toHaveLength(2);
  });

  it('flags the correct union name', () => {
    const v = violations(`
      type Color = { | Red | Green | Blue }
      let c = Red;
      let r = match c with | Red -> "red" | Green -> "green";
    `);
    expect(v[0].unionName).toBe('Color');
    expect(v[0].missing).toEqual(['Blue']);
  });

  it('reports multiple violations when multiple match expressions are non-exhaustive', () => {
    const v = violations(`
      type Color = { | Red | Green | Blue }
      let c = Red;
      let r1 = match c with | Red -> 1 | Green -> 2;
      let r2 = match c with | Red -> 1;
    `);
    expect(v).toHaveLength(2);
    expect(v[0].missing).toEqual(['Blue']);
    expect(v[1].missing).toEqual(expect.arrayContaining(['Green', 'Blue']));
  });

  it('flags a match inside a procedure body', () => {
    const v = violations(`
      type Toggle = { | On | Off }
      proc check(t) {
        let r = match t with | On -> 1;
      }
    `);
    // subject is a param (Unknown) so no violation — correct
    expect(v).toHaveLength(0);
  });

  it('flags a match on a let-bound union value inside a proc', () => {
    const v = violations(`
      type Toggle = { | On | Off }
      proc check() {
        let t = On;
        let r = match t with | On -> 1;
      }
    `);
    expect(v).toHaveLength(1);
    expect(v[0].missing).toEqual(['Off']);
  });

  it('flags a non-exhaustive match nested inside a ternary', () => {
    const v = violations(`
      type Toggle = { | On | Off }
      let t = On;
      let r = true ? (match t with | On -> 1) : 0;
    `);
    expect(v).toHaveLength(1);
    expect(v[0].missing).toEqual(['Off']);
  });
});

// ─── Variant ordering ─────────────────────────────────────────────────────────

describe('Missing variant ordering', () => {
  it('reports missing variants in declaration order', () => {
    const v = violations(`
      type ABC = { | A | B | C }
      let x = A;
      let r = match x with | A -> 1;
    `);
    expect(v[0].missing).toEqual(['B', 'C']);
  });

  it('reports only the variants not appearing in any arm', () => {
    const v = violations(`
      type ABC = { | A | B | C }
      let x = A;
      let r = match x with | B -> 2 | C -> 3;
    `);
    expect(v[0].missing).toEqual(['A']);
  });
});
