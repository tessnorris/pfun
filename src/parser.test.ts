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
});
