// src/parser.test.ts
import { Lexer } from './lexer';
import { Parser } from './parser';
import { Stmt, Expr } from './ast';

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
        let result = match sq {
          | Square s -> s.side
          | _ -> 0
        };
      `);
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('MatchExpr');
      expect(expr.arms).toHaveLength(2);
    });

    it('should parse a match arm with a named binding', () => {
      const ast = parse(`
        let result = match sq {
          | Square s -> s.side
          | _ -> 0
        };
      `);
      const expr = (ast[0] as any).initializer;
      const firstArm = expr.arms[0];
      expect(firstArm.variant).toBe('Square');
      expect(firstArm.binding).toBe('s');
      expect(firstArm.body.type).toBe('GetExpr');
    });

    it('should parse a wildcard arm', () => {
      const ast = parse(`
        let result = match sq {
          | Square s -> s.side
          | _ -> 0
        };
      `);
      const expr = (ast[0] as any).initializer;
      const wildcard = expr.arms[1];
      expect(wildcard.variant).toBeNull();
      expect(wildcard.binding).toBeNull();
      expect(wildcard.body).toEqual({ type: 'IntExpr', value: 0n });
    });

    it('should parse a match arm with a wildcard binding _', () => {
      const ast = parse(`
        let result = match sq {
          | Circle _ -> 1
          | _ -> 0
        };
      `);
      const expr = (ast[0] as any).initializer;
      const arm = expr.arms[0];
      expect(arm.variant).toBe('Circle');
      expect(arm.binding).toBeNull(); // '_' binding is represented as null
    });

    it('should parse a match arm with a where guard', () => {
      const ast = parse(`
        let result = match shape {
          | Circle c where c.radius > 3 -> c.radius
          | _ -> 0
        };
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
        let result = match shape {
          | Circle c where c.radius > 3 -> c.radius
          | Circle _ -> 1
          | _ -> 0
        };
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
        match sq {
          | Square s -> s.side
          | _ -> 0
        };
      `);
      expect((ast[0] as any).type).toBe('ExprStmt');
      expect((ast[0] as any).expression.type).toBe('MatchExpr');
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
      expect(expr.entries[0].key).toEqual({ type: 'StrExpr', value: 'x' });
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
      expect(expr.index).toEqual({ type: 'StrExpr', value: 'key' });
    });

    it('should parse index assignment', () => {
      const ast = parse('d["key"] = 99;');
      const expr = (ast[0] as any).expression;
      expect(expr.type).toBe('IndexAssignExpr');
      expect(expr.value).toEqual({ type: 'IntExpr', value: 99n });
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

  describe('printf', () => {
    it('should desugar printf into a print CallExpr', () => {
      const ast = parse('printf("hello {name}\\n");');
      const expr = (ast[0] as any).expression;
      expect(expr.type).toBe('CallExpr');
      expect(expr.callee).toEqual({ type: 'IdentExpr', name: 'print' });
    });

    it('should desugar {name.field} into a GetExpr', () => {
      const ast = parse('printf("x is {pt.x}\\n");');
      const expr = (ast[0] as any).expression;
      const findGetExpr = (e: any): boolean => {
        if (!e || typeof e !== 'object') return false;
        if (e.type === 'GetExpr' && e.name === 'x') return true;
        return findGetExpr(e.left) || findGetExpr(e.right) || findGetExpr(e.args?.[0]);
      };
      expect(findGetExpr(expr)).toBe(true);
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
});
