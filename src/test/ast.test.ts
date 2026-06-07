import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Stmt, Expr } from '../ast';

const parse = (input: string): Stmt[] => {
  return new Parser(new Lexer(input).lex()).parse();
};

describe('AST Construction Tests', () => {

  // 1. Literals & Identifiers
  describe('Primary Expressions', () => {
    it('should build IntExpr', () => {
      const ast = parse('123;');
      expect((ast[0] as any).expression).toEqual(expect.objectContaining({ type: 'IntExpr', value: 123n }));

    });

    it('should build BoolExpr', () => {
      const ast = parse('true;');
      expect((ast[0] as any).expression).toEqual(expect.objectContaining({ type: 'BoolExpr', value: true }));

    });

    it('should build StrExpr', () => {
      const ast = parse('"hello";');
      expect((ast[0] as any).expression).toEqual(expect.objectContaining({ type: 'StrExpr', value: 'hello' }));

    });

    it('should build CharExpr', () => {
      const ast = parse("'a';");
      expect((ast[0] as any).expression).toEqual(expect.objectContaining({ type: 'CharExpr', value: 'a' }));

    });

    it('should build CharExpr for escape sequences', () => {
      const ast = parse("'\\n';");
      expect((ast[0] as any).expression).toEqual(expect.objectContaining({ type: 'CharExpr', value: '\n' }));

    });

    it('should build IdentExpr', () => {
      const ast = parse('myVar;');
      expect((ast[0] as any).expression).toEqual(expect.objectContaining({ type: 'IdentExpr', name: 'myVar' }));

    });

    it('should build GroupExpr', () => {
      const ast = parse('(42);');
      expect((ast[0] as any).expression).toEqual(expect.objectContaining({
        type: 'GroupExpr',
        expression: expect.objectContaining({ type: 'IntExpr', value: 42n  })
      }));
    });
  });

  // 2. Unary & Binary Operators
  describe('Operator Expressions', () => {
    it('should build UnaryExpr for boolean not', () => {
      const ast = parse('!true;');
      expect((ast[0] as any).expression).toEqual(expect.objectContaining({
        type: 'UnaryExpr',
        operator: 'BooleanNot',
        right: expect.objectContaining({ type: 'BoolExpr', value: true  })
      }));
    });

    it('should build UnaryExpr for negation', () => {
      const ast = parse('-5;');
      expect((ast[0] as any).expression).toEqual(expect.objectContaining({
        type: 'UnaryExpr',
        operator: 'MinusToken',
        right: expect.objectContaining({ type: 'IntExpr', value: 5n  })
      }));
    });

    it('should build BinaryExpr with correct precedence (* before +)', () => {
      const ast = parse('1 + 2 * 3;');
      // Should be 1 + (2 * 3), not (1 + 2) * 3
      const expr = (ast[0] as any).expression;
      expect(expr.operator).toBe('PlusToken');
      expect(expr.left).toEqual(expect.objectContaining({ type: 'IntExpr', value: 1n }));

      expect(expr.right.operator).toBe('StarToken');
      expect(expr.right.left).toEqual(expect.objectContaining({ type: 'IntExpr', value: 2n }));

      expect(expr.right.right).toEqual(expect.objectContaining({ type: 'IntExpr', value: 3n }));

    });

    it('should build BinaryExpr for equality', () => {
      const ast = parse('1 == 1;');
      const expr = (ast[0] as any).expression;
      expect(expr.type).toBe('BinaryExpr');
      expect(expr.operator).toBe('EqualToken');
    });

    it('should build BinaryExpr for string concatenation', () => {
      const ast = parse('"foo" + "bar";');
      const expr = (ast[0] as any).expression;
      expect(expr.type).toBe('BinaryExpr');
      expect(expr.operator).toBe('PlusToken');
      expect(expr.left).toEqual(expect.objectContaining({ type: 'StrExpr', value: 'foo' }));

      expect(expr.right).toEqual(expect.objectContaining({ type: 'StrExpr', value: 'bar' }));

    });

    it('should build TernaryExpr', () => {
      const ast = parse('let x = true ? 1 : 0;');
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('TernaryExpr');
      expect(expr.condition).toEqual(expect.objectContaining({ type: 'BoolExpr', value: true }));

      expect(expr.thenBranch).toEqual(expect.objectContaining({ type: 'IntExpr', value: 1n }));

      expect(expr.elseBranch).toEqual(expect.objectContaining({ type: 'IntExpr', value: 0n }));

    });
  });

  // 3. Control Flow
  describe('Statements', () => {
    it('should build IfStmt without else', () => {
      const ast = parse('if true then println(1);');
      const stmt = ast[0] as any;
      expect(stmt.type).toBe('IfStmt');
      expect(stmt.condition).toEqual(expect.objectContaining({ type: 'BoolExpr', value: true }));

      expect(stmt.thenBranch.type).toBe('ExprStmt');
      expect(stmt.elseBranch).toBeUndefined();
    });

    it('should build IfStmt with else', () => {
      const ast = parse('if true then println(1) else println(2);');
      const stmt = ast[0] as any;
      expect(stmt.type).toBe('IfStmt');
      expect(stmt.thenBranch).toBeDefined();
      expect(stmt.elseBranch).toBeDefined();
      expect(stmt.elseBranch.type).toBe('ExprStmt');
    });

    it('should build BlockStmt', () => {
      const ast = parse('{ let x = 1; println(x); }');
      const stmt = ast[0] as any;
      expect(stmt.type).toBe('BlockStmt');
      expect(stmt.statements).toHaveLength(2);
      expect(stmt.statements[0].type).toBe('LetStmt');
      expect(stmt.statements[1].type).toBe('ExprStmt');
    });

    it('should build EvalStmt', () => {
      const ast = parse('eval x;');
      expect((ast[0] as any).type).toBe('EvalStmt');
      expect((ast[0] as any).expression).toEqual(expect.objectContaining({ type: 'IdentExpr', name: 'x' }));

    });
  });

  // 4. Functions & Lambdas
  describe('Functions', () => {
    it('should build FunctionStmt', () => {
      const ast = parse('function add(x, y) { return x + y; }');
      const stmt = ast[0] as any;
      expect(stmt.type).toBe('FunctionStmt');
      expect(stmt.name).toBe('add');
      expect(stmt.params).toEqual(['x', 'y']);
      expect(stmt.body).toHaveLength(1);
      expect(stmt.body[0].type).toBe('ReturnStmt');
    });

    it('should build ProcedureStmt', () => {
      const ast = parse('proc greet(name) { println(name); }');
      const stmt = ast[0] as any;
      expect(stmt.type).toBe('ProcedureStmt');
      expect(stmt.name).toBe('greet');
      expect(stmt.params).toEqual(['name']);
    });

    it('should build LambdaExpr with single param', () => {
      const ast = parse('let f = fn x => x * 2;');
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('LambdaExpr');
      expect(expr.params).toEqual(['x']);
      expect(expr.body.operator).toBe('StarToken');
    });

    it('should build LambdaExpr with multiple params', () => {
      const ast = parse('let f = fn x, y => x + y;');
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('LambdaExpr');
      expect(expr.params).toEqual(['x', 'y']);
    });

    it('should build CallExpr', () => {
      const ast = parse('add(1, 2);');
      const expr = (ast[0] as any).expression;
      expect(expr.type).toBe('CallExpr');
      expect(expr.callee).toEqual(expect.objectContaining({ type: 'IdentExpr', name: 'add' }));

      expect(expr.args).toHaveLength(2);
    });

    it('should build ReturnStmt with value', () => {
      const ast = parse('function f() { return 42; }');
      const ret = (ast[0] as any).body[0];
      expect(ret.type).toBe('ReturnStmt');
      expect(ret.value).toEqual(expect.objectContaining({ type: 'IntExpr', value: 42n }));

    });
  });

  // 5. Variables
  describe('Variable Declarations', () => {
    it('should build LetStmt', () => {
      const ast = parse('let x = 10;');
      const stmt = ast[0] as any;
      expect(stmt.type).toBe('LetStmt');
      expect(stmt.name).toBe('x');
      expect(stmt.initializer).toEqual(expect.objectContaining({ type: 'IntExpr', value: 10n }));

    });

    it('should build VarStmt', () => {
      const ast = parse('var x = 10;');
      const stmt = ast[0] as any;
      expect(stmt.type).toBe('VarStmt');
      expect(stmt.name).toBe('x');
      expect(stmt.initializer).toEqual(expect.objectContaining({ type: 'IntExpr', value: 10n }));

    });

    it('should build AssignExpr', () => {
      const ast = parse('x = 20;');
      const stmt = ast[0] as any;
      expect(stmt.type).toBe('ExprStmt');
      expect(stmt.expression.type).toBe('AssignExpr');
      expect(stmt.expression.name).toBe('x');
      expect(stmt.expression.value).toEqual(expect.objectContaining({ type: 'IntExpr', value: 20n }));

    });
  });

  // 6. Lists & Records
  describe('Lists & Records', () => {
    it('should build ListExpr', () => {
      const ast = parse('let l = [1, 2, 3];');
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('ListExpr');
      expect(expr.elements).toHaveLength(3);
      expect(expr.elements[0]).toEqual(expect.objectContaining({ type: 'IntExpr', value: 1n }));

    });

    it('should build TypeStmt', () => {
      const ast = parse('type Point = { x, y };');
      const stmt = ast[0] as any;
      expect(stmt.type).toBe('TypeStmt');
      expect(stmt.name).toBe('Point');
      expect(stmt.fields).toEqual(['x', 'y']);
    });

    it('should build positional RecordExpr', () => {
      const ast = parse('let p = Point { 1, 2 };');
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('RecordExpr');
      expect(expr.name).toBe('Point');
      expect(expr.fields[0].key).toBeNull();
      expect(expr.fields[0].value).toEqual(expect.objectContaining({ type: 'IntExpr', value: 1n }));

    });

    it('should build named RecordExpr', () => {
      const ast = parse('let p = Point(x=1, y=2);');
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('RecordExpr');
      expect(expr.name).toBe('Point');
      expect(expr.fields[0].key).toBe('x');
      expect(expr.fields[1].key).toBe('y');
    });

    it('should build GetExpr for property access', () => {
      const ast = parse('p.x;');
      const expr = (ast[0] as any).expression;
      expect(expr.type).toBe('GetExpr');
      expect(expr.object).toEqual(expect.objectContaining({ type: 'IdentExpr', name: 'p' }));

      expect(expr.name).toBe('x');
    });

    it('should build DictExpr', () => {
      const ast = parse('var d = dict { "a" -> 1, "b" -> 2 };');
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('DictExpr');
      expect(expr.entries).toHaveLength(2);
      expect(expr.entries[0].key).toEqual(expect.objectContaining({ type: 'StrExpr', value: 'a' }));

    });

    it('should build IndexExpr for dict/list access', () => {
      const ast = parse('d["key"];');
      const expr = (ast[0] as any).expression;
      expect(expr.type).toBe('IndexExpr');
      expect(expr.object).toEqual(expect.objectContaining({ type: 'IdentExpr', name: 'd' }));

      expect(expr.index).toEqual(expect.objectContaining({ type: 'StrExpr', value: 'key' }));

    });

    it('should build IndexAssignExpr for dict assignment', () => {
      const ast = parse('d["key"] = 42;');
      const expr = (ast[0] as any).expression;
      expect(expr.type).toBe('IndexAssignExpr');
      expect(expr.index).toEqual(expect.objectContaining({ type: 'StrExpr', value: 'key' }));

      expect(expr.value).toEqual(expect.objectContaining({ type: 'IntExpr', value: 42n }));

    });

    it('should build ComprehensionExpr', () => {
      const ast = parse('let c = [ x * 2 for x <- nums where x > 0 ];');
      const expr = (ast[0] as any).initializer;
      expect(expr.type).toBe('ComprehensionExpr');
      expect(expr.generators).toHaveLength(1);
      expect(expr.generators[0].variable).toBe('x');
      expect(expr.guard).toBeDefined();
    });
  });
});
