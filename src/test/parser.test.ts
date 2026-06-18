// src/parser.test.ts
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Stmt, Expr } from '../ast';

const parse = (input: string): Stmt[] => {
  return new Parser(new Lexer(input).lex()).parse();
};

describe('Parser Unit Tests', () => {
  describe('Mutability & Types', () => {
    it('should parse var statements', () => {
      const ast = parse('var x = 10;');
      expect(ast[0].type).toBe('VarStmt');
    });

    it('should parse plain type definitions', () => {
      const ast = parse('type Point = { x, y };');
      const stmt = ast[0] as any;
      expect(stmt.type).toBe('TypeStmt');
      expect(stmt.name).toBe('Point');
      expect(stmt.fields).toEqual(['x', 'y']);
    });
  });

  describe('Ternary & Equality', () => {
    it('should parse ternary expressions', () => {
      const ast = parse('let x = true ? 1 : 0;');
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('TernaryExpr');
      expect(expr.thenBranch.value).toBe(1n);
      expect(expr.elseBranch.value).toBe(0n);
    });

    it('should parse equality tests', () => {
      const ast = parse('1 == 1;');
      expect((ast[0] as any).expression.operator).toBe('EqualToken');
    });
  });

  describe('Lists & Records', () => {
    it('should parse list literals', () => {
      const ast = parse('let l = [1, 2, 3];');
      expect((ast[0] as any).initializer.type).toBe('ListExpr');
    });

    it('should parse positional record constructors', () => {
      const ast = parse('let p = Point { 1, 2 };');
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('RecordExpr');
      expect(expr.name).toBe('Point');
    });

    it('should parse named record constructors via ()', () => {
      const ast = parse('let p = Point(x=1, y=2);');
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('RecordExpr');
      expect(expr.fields[0].key).toBe('x');
    });

    it('should parse named record constructors via {}', () => {
      const ast = parse('let p = Point { x=1, y=2 };');
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('RecordExpr');
      expect(expr.fields[0].key).toBe('x');
      expect(expr.fields[1].key).toBe('y');
    });

    it('should parse property access', () => {
      const ast = parse('p.x;');
      expect((ast[0] as any).expression.type).toBe('GetExpr');
    });
  });

  describe('Discriminated Union Type Definitions', () => {
    it('should parse a union with two variants', () => {
      const ast = parse(`
        type Shape = {
          | Square: side
          | Circle: radius
        }
      `);
      const stmt = ast[0] as any;
      expect(stmt.type).toBe('UnionTypeStmt');
      expect(stmt.name).toBe('Shape');
      expect(stmt.variants).toHaveLength(2);
      expect(stmt.variants[0]).toEqual({ name: 'Square', fields: ['side'] });
      expect(stmt.variants[1]).toEqual({ name: 'Circle', fields: ['radius'] });
    });

    it('should parse a variant with multiple fields', () => {
      const ast = parse(`
        type Shape = {
          | Rectangle: x, y
        }
      `);
      const stmt = ast[0] as any;
      expect(stmt.variants[0]).toEqual({ name: 'Rectangle', fields: ['x', 'y'] });
    });

    it('should parse a union with three variants', () => {
      const ast = parse(`
        type Shape = {
          | Square: side
          | Circle: radius
          | Rectangle: x, y
        }
      `);
      const stmt = ast[0] as any;
      expect(stmt.variants).toHaveLength(3);
    });
  });

  describe('Match Expressions', () => {
    it('should parse a basic match with variant arms and wildcard', () => {
      const ast = parse(`
        let result = match sq with
          | Square s -> s.side
          | _ -> 0;
      `);
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('MatchExpr');
      expect(expr.arms).toHaveLength(2);
    });

    it('should parse a match arm with a named binding', () => {
      const ast = parse(`
        let result = match sq with
          | Square s -> s.side
          | _ -> 0;
      `);
      const expr = (ast[0] as any).initializer;
      const firstArm = expr.arms[0];
      expect(firstArm.variant).toBe('Square');
      expect(firstArm.binding).toBe('s');
      expect(firstArm.body.type).toBe('GetExpr');
    });

    it('should parse a wildcard arm', () => {
      const ast = parse(`
        let result = match sq with
          | Square s -> s.side
          | _ -> 0;
      `);
      const expr = (ast[0] as any).initializer;
      const wildcard = expr.arms[1];
      expect(wildcard.variant).toBeNull();
      expect(wildcard.binding).toBeNull();
      expect(wildcard.body).toEqual(expect.objectContaining({ type: 'IntExpr', value: 0n }));
    });

    it('should parse a match arm with a wildcard binding _', () => {
      const ast = parse(`
        let result = match sq with
          | Circle _ -> 1
          | _ -> 0;
      `);
      const expr = (ast[0] as any).initializer;
      const arm = expr.arms[0];
      expect(arm.variant).toBe('Circle');
      expect(arm.binding).toBeNull(); // '_' binding is represented as null
    });

    it('should parse a match arm with a where guard', () => {
      const ast = parse(`
        let result = match shape with
          | Circle c where c.radius > 3 -> c.radius
          | _ -> 0;
      `);
      const expr = (ast[0] as any).initializer;
      const arm = expr.arms[0];
      expect(arm.variant).toBe('Circle');
      expect(arm.binding).toBe('c');
      expect(arm.guard).toBeDefined();
      expect(arm.guard.type).toBe('BinaryExpr');
      expect(arm.guard.operator).toBe('GreaterToken');
    });

    it('should parse multiple arms for the same variant (guarded then fallback)', () => {
      const ast = parse(`
        let result = match shape with
          | Circle c where c.radius > 3 -> c.radius
          | Circle _ -> 1
          | _ -> 0;
      `);
      const expr = (ast[0] as any).initializer;
      expect(expr.arms).toHaveLength(3);
      expect(expr.arms[0].variant).toBe('Circle');
      expect(expr.arms[0].guard).toBeDefined();
      expect(expr.arms[1].variant).toBe('Circle');
      expect(expr.arms[1].guard).toBeUndefined();
    });

    it('should parse a match as an expression statement', () => {
      const ast = parse(`
        match sq with
          | Square s -> s.side
          | _ -> 0
      `);
      expect((ast[0] as any).type).toBe('ExprStmt');
      expect((ast[0] as any).expression.type).toBe('MatchExpr');
    });

    describe('Nested match as an arm body (bare vs. braced)', () => {
      // A bare (non-block) match used as an arm's body is genuinely
      // ambiguous: arms are delimited only by a leading '|' (no closing
      // token), so the inner match's own arm-consuming loop has no way
      // to know where its own arms end and the OUTER match's remaining
      // arms begin — it just keeps consuming every subsequent
      // '|'-prefixed arm. This was a real, silent bug (confirmed via
      // examples/example.pf's copyFile function, fixed alongside this
      // parser change) where the outer match's last arm got silently
      // mis-attached to the inner match instead. Braces give the inner
      // match an unambiguous boundary, so they're now REQUIRED rather
      // than merely supported.

      it('rejects a bare nested match as an arm body with a clear, actionable error', () => {
        expect(() => parse(`
          match readResult with
          | Ok o  -> match writeResult with
          | Ok _  -> 0
          | Err e -> 1
          | Err e -> 2
        `)).toThrow(/must be wrapped in braces/i);
      });

      it('accepts a BRACED nested match as an arm body, with arms correctly attached to the right match (outer keeps its Err, inner keeps its own two arms)', () => {
        const ast = parse(`
          match readResult with
          | Ok o  -> {
              match writeResult with
              | Ok _  -> 0
              | Err e -> 1;
            }
          | Err e -> 2;
        `);
        const expr = (ast[0] as any).expression;
        expect(expr.type).toBe('MatchExpr');
        // Outer match: exactly two arms (Ok, Err) — NOT one, which is
        // what the old bug would have produced.
        expect(expr.arms).toHaveLength(2);
        expect(expr.arms[0].variant).toBe('Ok');
        expect(expr.arms[1].variant).toBe('Err');
        // The outer Ok arm's body is a BlockExpr (the braces), whose
        // single statement is the inner match.
        const okBody = expr.arms[0].body;
        expect(okBody.type).toBe('BlockExpr');
        const innerMatch = okBody.statements[0].expression;
        expect(innerMatch.type).toBe('MatchExpr');
        // Inner match: exactly its own two arms — the outer Err did NOT
        // leak into it.
        expect(innerMatch.arms).toHaveLength(2);
        expect(innerMatch.arms[0].variant).toBe('Ok');
        expect(innerMatch.arms[1].variant).toBe('Err');
      });

      it('rejects a bare nested match in a WILDCARD arm body too (same ambiguity, same fix)', () => {
        expect(() => parse(`
          match readResult with
          | _ -> match writeResult with
          | Ok _  -> 0
          | Err e -> 1
        `)).toThrow(/must be wrapped in braces/i);
      });
    });
  });

  describe('Procedures', () => {
    it('should parse a procedure statement', () => {
      const ast = parse('proc greet(name) { println(name); }');
      const stmt = ast[0] as any;
      expect(stmt.type).toBe('ProcedureStmt');
      expect(stmt.name).toBe('greet');
      expect(stmt.params).toEqual(['name']);
    });
  });

  describe('Char Literals', () => {
    it('should parse a char literal as CharExpr', () => {
      const ast = parse("let c = 'a';");
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('CharExpr');
      expect(expr.value).toBe('a');
    });

    it('should parse escape sequences in char literals', () => {
      const ast = parse("let nl = '\\n';");
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('CharExpr');
      expect(expr.value).toBe('\n');
    });
  });

  describe('Dict & Index', () => {
    it('should parse a dict literal', () => {
      const ast = parse('var d = dict { "x" -> 1 };');
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('DictExpr');
      expect(expr.entries[0].key).toEqual(expect.objectContaining({ type: 'StrExpr', value: 'x' }));
    });

    it('should parse an empty dict literal', () => {
      const ast = parse('var d = dict {};');
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('DictExpr');
      expect(expr.entries).toHaveLength(0);
    });

    it('should parse index access', () => {
      const ast = parse('d["key"];');
      const expr = (ast[0] as any).expression;
      expect(expr.type).toBe('IndexExpr');
      expect(expr.index).toEqual(expect.objectContaining({ type: 'StrExpr', value: 'key' }));
    });

    it('should parse index assignment', () => {
      const ast = parse('d["key"] = 99;');
      const expr = (ast[0] as any).expression;
      expect(expr.type).toBe('IndexAssignExpr');
      expect(expr.value).toEqual(expect.objectContaining({ type: 'IntExpr', value: 99n }));
    });
  });

  describe('List Comprehensions', () => {
    it('should parse a basic comprehension', () => {
      const ast = parse('let c = [ x * 2 for x <- nums ];');
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('ComprehensionExpr');
      expect(expr.generators[0].variable).toBe('x');
      expect(expr.guard).toBeUndefined();
    });

    it('should parse a comprehension with a where guard', () => {
      const ast = parse('let c = [ x for x <- nums where x > 0 ];');
      const expr = (ast[0] as any).initializer;
      expect(expr.guard).toBeDefined();
    });

    it('should parse a comprehension with two generators', () => {
      const ast = parse('let c = [ x + y for x <- xs for y <- ys ];');
      const expr = (ast[0] as any).initializer;
      expect(expr.generators).toHaveLength(2);
    });
  });

  describe('Zero-field Union Variants', () => {
    it('should parse a union with a zero-field variant', () => {
      const ast = parse(`
        type Option = {
          | Some: value
          | None
        }
      `);
      const stmt = ast[0] as any;
      expect(stmt.variants[0]).toEqual({ name: 'Some', fields: ['value'] });
      expect(stmt.variants[1]).toEqual({ name: 'None', fields: [] });
    });
  });

  describe('$ format strings', () => {
    it('should desugar $"..." into a string concatenation expression', () => {
      const ast = parse('let s = $"hello {name}";');
      const expr = (ast[0] as any).initializer;
      // Should be a BinaryExpr (concatenation) at the top level, not a CallExpr
      expect(expr.type).toBe('BinaryExpr');
      expect(expr.operator).toBe('PlusToken');
    });

    it('should produce a StrExpr for a literal-only $ string', () => {
      const ast = parse('let s = $"no interpolation here";');
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('StrExpr');
      expect(expr.value).toBe('no interpolation here');
    });

    it('should desugar {name.field} interpolation into a GetExpr', () => {
      const ast = parse('let s = $"x is {pt.x}";');
      const expr = (ast[0] as any).initializer;
      const findGetExpr = (e: any): boolean => {
        if (!e || typeof e !== 'object') return false;
        if (e.type === 'GetExpr' && e.name === 'x') return true;
        return findGetExpr(e.left) || findGetExpr(e.right) || findGetExpr(e.callee) || findGetExpr(e.args?.[0]);
      };
      expect(findGetExpr(expr)).toBe(true);
    });

    it('should wrap interpolated values in __str__ coercion calls', () => {
      const ast = parse('let s = $"n = {n}";');
      const expr = (ast[0] as any).initializer;
      const findStrCall = (e: any): boolean => {
        if (!e || typeof e !== 'object') return false;
        if (e.type === 'CallExpr' && e.callee?.name === '__str__') return true;
        return findStrCall(e.left) || findStrCall(e.right) || findStrCall(e.callee);
      };
      expect(findStrCall(expr)).toBe(true);
    });

    it('should produce a pure expression usable in a let binding', () => {
      // $ string in a let (pure context) — no CallExpr to print
      const ast = parse('let s = $"value: {x}";');
      const stmt = ast[0] as any;
      expect(stmt.type).toBe('LetStmt');
      const findPrintCall = (e: any): boolean => {
        if (!e || typeof e !== 'object') return false;
        if (e.type === 'CallExpr' && (e.callee?.name === 'print' || e.callee?.name === 'println')) return true;
        return findPrintCall(e.left) || findPrintCall(e.right) || findPrintCall(e.callee);
      };
      expect(findPrintCall(stmt.initializer)).toBe(false);
    });
  });

  describe('Star imports', () => {
    it('should parse import * from "path" as kind star', () => {
      const ast = parse(`import * from "io";`);
      const stmt = ast[0] as any;
      expect(stmt.type).toBe('ImportStmt');
      expect(stmt.kind).toBe('star');
      expect(stmt.path).toBe('io');
    });

    it('should parse import * as X from "path" as kind namespace', () => {
      const ast = parse(`import * as IO from "io";`);
      const stmt = ast[0] as any;
      expect(stmt.type).toBe('ImportStmt');
      expect(stmt.kind).toBe('namespace');
      expect(stmt.alias).toBe('IO');
      expect(stmt.path).toBe('io');
    });
  });

  // ── Async/await (phase 1) ────────────────────────────────────────────────
  // These tests only check that 'async'/'await' parse into the expected AST
  // shapes (FunctionStmt.async / ProcedureStmt.async / AwaitExpr). No
  // evaluation or effect-checking exists yet (steps 4-5).
  describe('Async/await (phase 1 - parsing only)', () => {
    it('should parse "async function" with async: true', () => {
      const ast = parse('async function f(x) { return x; }');
      const stmt = ast[0] as any;
      expect(stmt.type).toBe('FunctionStmt');
      expect(stmt.name).toBe('f');
      expect(stmt.async).toBe(true);
      expect(stmt.memo).toBe(false);
    });

    it('should parse "async memo function" with async: true and memo: true', () => {
      const ast = parse('async memo function f(x) { return x; }');
      const stmt = ast[0] as any;
      expect(stmt.type).toBe('FunctionStmt');
      expect(stmt.async).toBe(true);
      expect(stmt.memo).toBe(true);
    });

    it('should parse "async proc" with async: true', () => {
      const ast = parse('async proc p(x) { return x; }');
      const stmt = ast[0] as any;
      expect(stmt.type).toBe('ProcedureStmt');
      expect(stmt.name).toBe('p');
      expect(stmt.async).toBe(true);
    });

    it('plain "function"/"proc" should not have async set to true', () => {
      const fnAst = parse('function f(x) { return x; }');
      const procAst = parse('proc p(x) { return x; }');
      expect((fnAst[0] as any).async).toBeFalsy();
      expect((procAst[0] as any).async).toBeFalsy();
    });

    it('should parse "await <expr>" as AwaitExpr at unary precedence (binds tighter than +)', () => {
      const ast = parse('async function f() { return 1 + await g(); }');
      const stmt = ast[0] as any;
      const ret = stmt.body[0]; // ReturnStmt
      expect(ret.type).toBe('ReturnStmt');
      expect(ret.value).toMatchObject({
        type: 'BinaryExpr',
        operator: 'PlusToken',
        left: { type: 'IntExpr', value: 1n },
        right: { type: 'AwaitExpr', value: { type: 'CallExpr' } },
      });
    });

    it('should parse "await <expr>" in statement position', () => {
      const ast = parse('async proc p() { await foo(); }');
      const stmt = ast[0] as any;
      expect(stmt.body[0]).toMatchObject({
        type: 'ExprStmt',
        expression: { type: 'AwaitExpr', value: { type: 'CallExpr' } },
      });
    });

    it('should parse nested "await" (await of an await-producing call argument)', () => {
      const ast = parse('async function f() { return await g(await h()); }');
      const stmt = ast[0] as any;
      const ret = stmt.body[0];
      expect(ret.value.type).toBe('AwaitExpr');
      expect(ret.value.value.type).toBe('CallExpr');
      expect(ret.value.value.args[0].type).toBe('AwaitExpr');
    });

    it('should parse consecutive async and non-async declarations correctly (non-block bodies terminate)', () => {
      // Non-block function body followed by another declaration: ensure the
      // 'async' keyword on the next declaration isn't swallowed into the
      // previous function's expression body.
      const ast = parse('function f(x) x + 1\nasync function g(y) { return y; }');
      expect(ast).toHaveLength(2);
      expect((ast[0] as any).type).toBe('FunctionStmt');
      expect((ast[0] as any).async).toBeFalsy();
      expect((ast[1] as any).type).toBe('FunctionStmt');
      expect((ast[1] as any).async).toBe(true);
    });
  });
});
