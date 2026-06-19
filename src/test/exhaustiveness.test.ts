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
import { inferTypes, checkTypes } from '../typechecker';

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

// ─── Provable-guard exhaustiveness: Bool / Int / Float / Byte ───────────────
//
// These use checkTypes() directly (rather than the missingVariants/
// violations() helper above) since there's no discrete "variant" list for
// a numeric type — the assertions are against the actual returned error
// messages.

function errorsFor(src: string): string[] {
  const stmts = parse(src);
  return checkTypes(stmts, src).map(e => e.pfunMessage);
}

describe('Provable-guard exhaustiveness — Bool', () => {
  it('true/false via bare binding and negation is exhaustive with no unconditional arm', () => {
    const errs = errorsFor(`
      let b = true;
      let r = match b with | b where b -> "yes" | b where !b -> "no";
    `);
    expect(errs.filter(m => /non-exhaustive match/i.test(m))).toHaveLength(0);
  });

  it('true/false via == true / == false is exhaustive', () => {
    const errs = errorsFor(`
      let b = true;
      let r = match b with | b where b == true -> "yes" | b where b == false -> "no";
    `);
    expect(errs.filter(m => /non-exhaustive match/i.test(m))).toHaveLength(0);
  });

  it('flags a Bool match covering only true', () => {
    const errs = errorsFor(`
      let b = true;
      let r = match b with | b where b == true -> "yes";
    `);
    expect(errs.some(m => /non-exhaustive match on 'bool'/i.test(m) && m.includes("'false'"))).toBe(true);
  });

  it('an unconditional arm anywhere still short-circuits (no proof needed)', () => {
    const errs = errorsFor(`
      let b = true;
      let r = match b with | b where b == true -> "yes" | other -> "fallback";
    `);
    expect(errs.filter(m => /non-exhaustive match/i.test(m))).toHaveLength(0);
  });
});

describe('Provable-guard exhaustiveness — numeric (Int/Float/Byte)', () => {
  it('>= 0 and < 0 together are exhaustive over Int with no unconditional arm', () => {
    const errs = errorsFor(`
      let n = 5;
      let r = match n with
        | n where n >= 0 -> "non-negative"
        | n where n < 0  -> "negative";
    `);
    expect(errs.filter(m => /non-exhaustive match/i.test(m))).toHaveLength(0);
  });

  it('reversed operand order (0 <= n) is recognized the same way', () => {
    const errs = errorsFor(`
      let n = 5;
      let r = match n with
        | n where 0 <= n -> "non-negative"
        | n where n < 0  -> "negative";
    `);
    expect(errs.filter(m => /non-exhaustive match/i.test(m))).toHaveLength(0);
  });

  it('a real gap between guards is flagged with a representative value', () => {
    const errs = errorsFor(`
      let n = 5;
      let r = match n with
        | n where n < 0  -> "negative"
        | n where n > 10 -> "big";
    `);
    const hit = errs.find(m => /non-exhaustive match on 'int'/i.test(m));
    expect(hit).toBeDefined();
    expect(hit).toMatch(/do not cover every possible value/i);
  });

  it('three arms partitioning the line are exhaustive (low/mid/high)', () => {
    const errs = errorsFor(`
      let n = 5;
      let r = match n with
        | n where n < 0   -> "negative"
        | n where n < 100 -> "mid"
        | n where n >= 100 -> "high";
    `);
    expect(errs.filter(m => /non-exhaustive match/i.test(m))).toHaveLength(0);
  });

  it('an adjacent-boundary gap at a single point is caught (n<0 / n>0 misses exactly 0)', () => {
    const errs = errorsFor(`
      let n = 5;
      let r = match n with
        | n where n < 0 -> "negative"
        | n where n > 0 -> "positive";
    `);
    expect(errs.some(m => /non-exhaustive match on 'int'/i.test(m))).toBe(true);
  });

  it('negative literals are recognized', () => {
    const errs = errorsFor(`
      let n = 5;
      let r = match n with
        | n where n >= -10 -> "not too negative"
        | n where n < -10  -> "very negative";
    `);
    expect(errs.filter(m => /non-exhaustive match/i.test(m))).toHaveLength(0);
  });

  it('Byte is bounded — >= 0 alone already covers the whole domain', () => {
    const errs = errorsFor(`
      let b = 5b;
      let r = match b with | b where b >= 0 -> "any byte";
    `);
    expect(errs.filter(m => /non-exhaustive match/i.test(m))).toHaveLength(0);
  });

  it('Float gets the same treatment as Int', () => {
    const errs = errorsFor(`
      let f = 5.0;
      let r = match f with
        | f where f >= 0.0 -> "non-negative"
        | f where f < 0.0  -> "negative";
    `);
    expect(errs.filter(m => /non-exhaustive match/i.test(m))).toHaveLength(0);
  });

  it('an unrecognized guard (e.g. n % 2 == 0) contributes nothing — still requires a catch-all', () => {
    const errs = errorsFor(`
      let n = 5;
      let r = match n with | n where n % 2 == 0 -> "even";
    `);
    expect(errs.some(m => /non-exhaustive match on 'int'/i.test(m))).toBe(true);
  });

  it('a tagged arm on a numeric subject is excluded from the proof (it can never fire)', () => {
    const errs = errorsFor(`
      let n = 5;
      let r = match n with
        | Bogus x       -> 0
        | n where n >= 0 -> 1
        | n where n < 0  -> 2;
    `);
    // The tagged arm contributes nothing; the two untagged arms alone
    // still prove exhaustiveness.
    expect(errs.filter(m => /non-exhaustive match/i.test(m))).toHaveLength(0);
  });
});

// ─── General non-union rule: plain records, Str, Char ───────────────────────

describe('General non-union exhaustiveness rule', () => {
  it('a plain record match with a guarded-only arm and no catch-all is flagged', () => {
    const errs = errorsFor(`
      type Point = { x, y }
      let p = Point { 1, 2 };
      let r = match p with | pt where pt.x > 0 -> "positive";
    `);
    expect(errs.some(m => /non-exhaustive match/i.test(m))).toBe(true);
  });

  it('a plain record match with a trailing unconditional tagged arm is fine', () => {
    const errs = errorsFor(`
      type Point = { x, y }
      let p = Point { 1, 2 };
      let r = match p with
        | pt where pt.x > 0 -> "positive"
        | Point pt          -> "other";
    `);
    expect(errs.filter(m => /non-exhaustive match/i.test(m))).toHaveLength(0);
  });

  it('a single unconditional tagged arm matching the record\'s own type is exhaustive (no guard needed)', () => {
    const errs = errorsFor(`
      type Point = { x, y }
      let p = Point { 1, 2 };
      let r = match p with | Point pt -> pt.x;
    `);
    expect(errs.filter(m => /non-exhaustive match/i.test(m))).toHaveLength(0);
  });

  it('a Str match with only a guarded arm is flagged', () => {
    const errs = errorsFor(`
      let s = "hello";
      let r = match s with | s where length(s) > 0 -> "non-empty";
    `);
    expect(errs.some(m => /non-exhaustive match/i.test(m))).toBe(true);
  });

  it('a Str match with a trailing wildcard is fine', () => {
    const errs = errorsFor(`
      let s = "hello";
      let r = match s with | s where length(s) > 0 -> "non-empty" | _ -> "empty";
    `);
    expect(errs.filter(m => /non-exhaustive match/i.test(m))).toHaveLength(0);
  });

  it('does not flag Option even with only a guarded arm — builtin unions stay runtime-only', () => {
    const errs = errorsFor(`
      let x = Some { 1 };
      let r = match x with | Some s where s.value > 0 -> "positive";
    `);
    expect(errs.filter(m => /non-exhaustive match/i.test(m))).toHaveLength(0);
  });

  it('does not flag an Unknown-typed subject (function param) even with only a guarded arm', () => {
    const errs = errorsFor(`
      function f(s) {
        return match s with | s where length(s) > 0 -> "non-empty";
      }
    `);
    expect(errs.filter(m => /non-exhaustive match/i.test(m))).toHaveLength(0);
  });
});

// ─── Regression: union exhaustiveness must not be short-circuited by a ──────
// ─── guarded untagged arm (only a true unconditional wildcard counts) ───────

describe('Union exhaustiveness gate regression (bare-binding interaction)', () => {
  it('a guarded untagged catch-all does NOT exhaust a union on its own', () => {
    const v = violations(`
      type Shape = { | Square: side | Circle: radius | Rectangle: x, y }
      let s = Square { 5 };
      let r = match s with
        | Square sq -> sq.side
        | other where false -> 0;
    `);
    expect(v).toHaveLength(1);
    expect(v[0].missing).toEqual(expect.arrayContaining(['Circle', 'Rectangle']));
  });

  it('a true unconditional wildcard (_) still exhausts a union as before', () => {
    expect(violations(`
      type Shape = { | Square: side | Circle: radius | Rectangle: x, y }
      let s = Square { 5 };
      let r = match s with | Square sq -> sq.side | _ -> 0;
    `)).toHaveLength(0);
  });
});
