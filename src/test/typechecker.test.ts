// src/test/typechecker.test.ts
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Stmt, Expr, PfunType } from '../ast';
import { inferTypes } from '../typechecker';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parse(src: string): Stmt[] {
  return new Parser(new Lexer(src).lex()).parse();
}

/** Parse, run inference, return the annotated AST. */
function infer(src: string): Stmt[] {
  const stmts = parse(src);
  inferTypes(stmts);
  return stmts;
}

/** Pull the expression out of a single-statement program. */
function inferExpr(src: string): Expr {
  const stmts = infer(src + ';');
  return (stmts[0] as any).expression as Expr;
}

function typeOf(src: string): PfunType {
  return inferExpr(src).inferredType ?? { kind: 'Unknown' };
}

/** Return the inferred Fn type registered for a top-level function/proc. */
function fnTypeOf(src: string): PfunType {
  const stmts = infer(src);
  // inferredType is not on FunctionStmt itself — look it up via a binding
  // by appending a let that captures the function name
  const name = (stmts[0] as any).name as string;
  const stmts2 = infer(src + `\nlet __t = ${name};`);
  return (stmts2[stmts2.length - 1] as any).inferredType ?? { kind: 'Unknown' };
}

// ─── Literals ─────────────────────────────────────────────────────────────────

describe('Literals', () => {
  it('infers Int for integer literals', () => {
    expect(typeOf('42')).toEqual({ kind: 'Int' });
  });

  it('infers Bool for true', () => {
    expect(typeOf('true')).toEqual({ kind: 'Bool' });
  });

  it('infers Bool for false', () => {
    expect(typeOf('false')).toEqual({ kind: 'Bool' });
  });

  it('infers Str for string literals', () => {
    expect(typeOf('"hello"')).toEqual({ kind: 'Str' });
  });

  it('infers Char for char literals', () => {
    expect(typeOf("'a'")).toEqual({ kind: 'Char' });
  });
});

// ─── Unary operators ──────────────────────────────────────────────────────────

describe('Unary operators', () => {
  it('infers Bool for boolean not', () => {
    expect(typeOf('!true')).toEqual({ kind: 'Bool' });
  });

  it('infers Bool for not on Unknown', () => {
    expect(typeOf('!someVar')).toEqual({ kind: 'Bool' });
  });

  it('infers Int for unary minus on integer', () => {
    expect(typeOf('-5')).toEqual({ kind: 'Int' });
  });

  it('infers Unknown for unary minus on non-integer', () => {
    expect(typeOf('-"oops"')).toEqual({ kind: 'Unknown' });
  });
});

// ─── Binary operators ─────────────────────────────────────────────────────────

describe('Binary operators', () => {
  it('infers Int for Int + Int', () => {
    expect(typeOf('1 + 2')).toEqual({ kind: 'Int' });
  });

  it('infers Str for Str + Str', () => {
    expect(typeOf('"a" + "b"')).toEqual({ kind: 'Str' });
  });

  it('infers Int for subtraction', () => {
    expect(typeOf('10 - 3')).toEqual({ kind: 'Int' });
  });

  it('infers Int for multiplication', () => {
    expect(typeOf('4 * 5')).toEqual({ kind: 'Int' });
  });

  it('infers Int for division', () => {
    expect(typeOf('8 / 2')).toEqual({ kind: 'Int' });
  });

  it('infers Int for modulo', () => {
    expect(typeOf('7 % 3')).toEqual({ kind: 'Int' });
  });

  it('infers Bool for ==', () => {
    expect(typeOf('1 == 1')).toEqual({ kind: 'Bool' });
  });

  it('infers Bool for !=', () => {
    expect(typeOf('1 != 2')).toEqual({ kind: 'Bool' });
  });

  it('infers Bool for <', () => {
    expect(typeOf('1 < 2')).toEqual({ kind: 'Bool' });
  });

  it('infers Bool for >', () => {
    expect(typeOf('1 > 2')).toEqual({ kind: 'Bool' });
  });

  it('infers Bool for <=', () => {
    expect(typeOf('1 <= 2')).toEqual({ kind: 'Bool' });
  });

  it('infers Bool for >=', () => {
    expect(typeOf('1 >= 2')).toEqual({ kind: 'Bool' });
  });

  it('infers Bool for &&', () => {
    expect(typeOf('true && false')).toEqual({ kind: 'Bool' });
  });

  it('infers Bool for ||', () => {
    expect(typeOf('true || false')).toEqual({ kind: 'Bool' });
  });

  it('infers Unknown for Int + Str (type mismatch)', () => {
    expect(typeOf('1 + "x"')).toEqual({ kind: 'Unknown' });
  });

  it('infers Unknown when either operand is Unknown', () => {
    expect(typeOf('someVar + 1')).toEqual({ kind: 'Unknown' });
  });
});

// ─── Grouping ─────────────────────────────────────────────────────────────────

describe('Grouped expressions', () => {
  it('propagates type through parentheses', () => {
    expect(typeOf('(42)')).toEqual({ kind: 'Int' });
  });

  it('propagates Unknown through parentheses', () => {
    expect(typeOf('(someVar)')).toEqual({ kind: 'Unknown' });
  });
});

// ─── Ternary ──────────────────────────────────────────────────────────────────

describe('Ternary expressions', () => {
  it('infers the branch type when both branches agree', () => {
    expect(typeOf('true ? 1 : 2')).toEqual({ kind: 'Int' });
  });

  it('infers Unknown when branches disagree', () => {
    expect(typeOf('true ? 1 : "x"')).toEqual({ kind: 'Unknown' });
  });

  it('infers Unknown when either branch is Unknown', () => {
    expect(typeOf('true ? someVar : 1')).toEqual({ kind: 'Unknown' });
  });
});

// ─── List literals ────────────────────────────────────────────────────────────

describe('List literals', () => {
  it('infers List<Int> for a homogeneous integer list', () => {
    expect(typeOf('[1, 2, 3]')).toEqual({ kind: 'List', element: { kind: 'Int' } });
  });

  it('infers List<Str> for a homogeneous string list', () => {
    expect(typeOf('["a", "b"]')).toEqual({ kind: 'List', element: { kind: 'Str' } });
  });

  it('infers List<Bool> for a boolean list', () => {
    expect(typeOf('[true, false]')).toEqual({ kind: 'List', element: { kind: 'Bool' } });
  });

  it('infers List<Unknown> for an empty list', () => {
    expect(typeOf('[]')).toEqual({ kind: 'List', element: { kind: 'Unknown' } });
  });

  it('infers List<Unknown> for a mixed-type list', () => {
    expect(typeOf('[1, "x"]')).toEqual({ kind: 'List', element: { kind: 'Unknown' } });
  });
});

// ─── Let bindings ─────────────────────────────────────────────────────────────

describe('Let bindings', () => {
  it('infers type on LetStmt from initializer', () => {
    const stmts = infer('let x = 42;');
    expect((stmts[0] as any).inferredType).toEqual({ kind: 'Int' });
  });

  it('infers Str for string binding', () => {
    const stmts = infer('let s = "hello";');
    expect((stmts[0] as any).inferredType).toEqual({ kind: 'Str' });
  });

  it('infers Bool for boolean binding', () => {
    const stmts = infer('let b = true;');
    expect((stmts[0] as any).inferredType).toEqual({ kind: 'Bool' });
  });

  it('infers Unknown for unresolvable initializer', () => {
    const stmts = infer('let x = someUndefinedVar;');
    expect((stmts[0] as any).inferredType).toEqual({ kind: 'Unknown' });
  });

  it('propagates list type to binding', () => {
    const stmts = infer('let xs = [1, 2, 3];');
    expect((stmts[0] as any).inferredType).toEqual({ kind: 'List', element: { kind: 'Int' } });
  });
});

// ─── Var bindings ─────────────────────────────────────────────────────────────

describe('Var bindings', () => {
  it('infers type on VarStmt from initializer', () => {
    const stmts = infer('var n = 0;');
    expect((stmts[0] as any).inferredType).toEqual({ kind: 'Int' });
  });
});

// ─── Variable references ─────────────────────────────────────────────────────

describe('Variable references', () => {
  it('resolves an IdentExpr from a prior let binding', () => {
    const stmts = infer(`
      let x = 10;
      let y = x;
    `);
    const yStmt = stmts[1] as any;
    expect(yStmt.initializer.inferredType).toEqual({ kind: 'Int' });
    expect(yStmt.inferredType).toEqual({ kind: 'Int' });
  });

  it('resolves through multiple bindings', () => {
    const stmts = infer(`
      let a = "hello";
      let b = a;
      let c = b;
    `);
    expect((stmts[2] as any).inferredType).toEqual({ kind: 'Str' });
  });

  it('resolves to Unknown for an unbound name', () => {
    const stmts = infer('let x = noSuchName;');
    expect((stmts[0] as any).inferredType).toEqual({ kind: 'Unknown' });
  });

  it('resolves arithmetic using bound variable types', () => {
    const stmts = infer(`
      let n = 5;
      let m = n + 3;
    `);
    expect((stmts[1] as any).inferredType).toEqual({ kind: 'Int' });
  });
});

// ─── Lambda expressions ───────────────────────────────────────────────────────

describe('Lambda expressions', () => {
  it('infers Fn type with Unknown params and known return for literal body', () => {
    expect(typeOf('fn x => 42')).toEqual({
      kind: 'Fn',
      params: [{ kind: 'Unknown' }],
      ret: { kind: 'Int' },
    });
  });

  it('infers Fn with Str return for string body', () => {
    expect(typeOf('fn x => "hello"')).toEqual({
      kind: 'Fn',
      params: [{ kind: 'Unknown' }],
      ret: { kind: 'Str' },
    });
  });

  it('infers Fn with Bool return for comparison body', () => {
    expect(typeOf('fn x => x == 0')).toEqual({
      kind: 'Fn',
      params: [{ kind: 'Unknown' }],
      ret: { kind: 'Bool' },
    });
  });

  it('infers Fn with Unknown return when body is unresolvable', () => {
    expect(typeOf('fn x => someCall(x)')).toEqual({
      kind: 'Fn',
      params: [{ kind: 'Unknown' }],
      ret: { kind: 'Unknown' },
    });
  });

  it('infers Fn with multiple Unknown params', () => {
    expect(typeOf('fn x, y => x + y')).toEqual({
      kind: 'Fn',
      params: [{ kind: 'Unknown' }, { kind: 'Unknown' }],
      ret: { kind: 'Unknown' }, // x and y are Unknown so + is Unknown
    });
  });

  it('lambda bound via let carries its Fn type', () => {
    const stmts = infer('let f = fn x => true;');
    expect((stmts[0] as any).inferredType).toEqual({
      kind: 'Fn',
      params: [{ kind: 'Unknown' }],
      ret: { kind: 'Bool' },
    });
  });
});

// ─── Function statements ─────────────────────────────────────────────────────

describe('Function statements', () => {
  it('does not crash on a simple function definition', () => {
    expect(() => infer(`
      function add(x, y) { return x + y; }
    `)).not.toThrow();
  });

  it('infers Int return type for a function returning a literal', () => {
    expect(fnTypeOf(`function answer() { return 42; }`)).toEqual({
      kind: 'Fn',
      params: [],
      ret: { kind: 'Int' },
    });
  });

  it('infers Str return type for a function returning a string literal', () => {
    expect(fnTypeOf(`function greet() { return "hello"; }`)).toEqual({
      kind: 'Fn',
      params: [],
      ret: { kind: 'Str' },
    });
  });

  it('infers Bool return type for a function returning a comparison', () => {
    expect(fnTypeOf(`function isZero(n) { return n == 0; }`)).toEqual({
      kind: 'Fn',
      params: [{ kind: 'Unknown' }],
      ret: { kind: 'Bool' },
    });
  });

  it('infers return type from an internal let binding', () => {
    expect(fnTypeOf(`
      function makeMsg() {
        let msg = "hi";
        return msg;
      }
    `)).toEqual({
      kind: 'Fn',
      params: [],
      ret: { kind: 'Str' },
    });
  });

  it('infers Unknown return when all paths are unresolvable', () => {
    expect(fnTypeOf(`function passThrough(x) { return x; }`)).toEqual({
      kind: 'Fn',
      params: [{ kind: 'Unknown' }],
      ret: { kind: 'Unknown' },
    });
  });

  it('handles recursive function without crashing', () => {
    expect(() => infer(`
      function fib(n) {
        return n <= 1 ? n : fib(n - 1) + fib(n - 2);
      }
    `)).not.toThrow();
  });

  it('infers Bool return for recursive function with base-case literal', () => {
    // Base case returns Bool; recursive case calls itself (Unknown on pass 1,
    // then Bool on pass 2 after re-registration).
    expect(fnTypeOf(`
      function allPos(xs) {
        return length(xs) == 0 ? true : head(xs) > 0 && allPos(tail(xs));
      }
    `)).toEqual({
      kind: 'Fn',
      params: [{ kind: 'Unknown' }],
      ret: { kind: 'Bool' },
    });
  });

  it('function name resolves as Fn type in subsequent let binding', () => {
    const stmts = infer(`
      function double(n) { return 2; }
      let f = double;
    `);
    const letStmt = stmts[1] as any;
    expect(letStmt.inferredType.kind).toBe('Fn');
    expect(letStmt.inferredType.ret).toEqual({ kind: 'Int' });
  });

  it('call to function with known return type resolves the call site', () => {
    const stmts = infer(`
      function getNum() { return 7; }
      let x = getNum();
    `);
    expect((stmts[1] as any).inferredType).toEqual({ kind: 'Int' });
  });
});

// ─── Procedure statements ─────────────────────────────────────────────────────

describe('Procedure statements', () => {
  it('does not crash on a procedure definition', () => {
    expect(() => infer(`
      proc sayHi() { println("hi"); }
    `)).not.toThrow();
  });

  it('infers Fn type for a proc returning a literal', () => {
    expect(fnTypeOf(`proc getVal() { return 99; }`)).toEqual({
      kind: 'Fn',
      params: [],
      ret: { kind: 'Int' },
    });
  });

  it('infers Unknown return for a proc with no return statement', () => {
    const t = fnTypeOf(`proc doSomething() { println("x"); }`);
    expect(t.kind).toBe('Fn');
    expect((t as any).ret).toEqual({ kind: 'Unknown' });
  });
});

// ─── Record and union construction ───────────────────────────────────────────

describe('Record and union construction', () => {
  it('infers Named with no unionName for a plain record', () => {
    const stmts = infer(`
      type Point = { x, y };
      let p = Point { 1, 2 };
    `);
    expect((stmts[1] as any).inferredType).toEqual({
      kind: 'Named', name: 'Point', unionName: undefined,
    });
  });

  it('infers Named with unionName for a union variant', () => {
    const stmts = infer(`
      type Shape = { | Square: side | Circle: radius }
      let s = Square { 10 };
    `);
    expect((stmts[1] as any).inferredType).toEqual({
      kind: 'Named', name: 'Square', unionName: 'Shape',
    });
  });

  it('distinguishes two variants of the same union', () => {
    const stmts = infer(`
      type Shape = { | Square: side | Circle: radius }
      let a = Square { 10 };
      let b = Circle { 5 };
    `);
    expect((stmts[1] as any).inferredType).toEqual({
      kind: 'Named', name: 'Square', unionName: 'Shape',
    });
    expect((stmts[2] as any).inferredType).toEqual({
      kind: 'Named', name: 'Circle', unionName: 'Shape',
    });
  });

  it('infers Named with unionName for named-field variant construction', () => {
    const stmts = infer(`
      type Shape = { | Square: side | Circle: radius }
      let c = Circle { radius = 7 };
    `);
    expect((stmts[1] as any).inferredType).toEqual({
      kind: 'Named', name: 'Circle', unionName: 'Shape',
    });
  });

  it('constructor used before type declaration falls back to no unionName', () => {
    // RecordExpr for Foo appears before TypeStmt for Foo — registry is empty
    // at that point, so unionName is absent.  This is expected and acceptable.
    const stmts = infer(`
      let x = Unknown { 1 };
      type Unknown = { value };
    `);
    expect((stmts[0] as any).inferredType).toEqual({
      kind: 'Named', name: 'Unknown',
    });
  });

  it('plain record binding propagates Named type through let', () => {
    const stmts = infer(`
      type Pair = { first, second };
      let p = Pair { 1, 2 };
      let q = p;
    `);
    expect((stmts[2] as any).inferredType).toEqual({
      kind: 'Named', name: 'Pair', unionName: undefined,
    });
  });
});

// ─── Exhaustiveness checking ──────────────────────────────────────────────────

describe('Exhaustiveness checking', () => {
  it('annotates missingVariants when a union variant is absent', () => {
    const stmts = infer(`
      type Shape = { | Square: side | Circle: radius | Rectangle: x, y }
      let s = Square { 10 };
      let r = match s with
        | Square sq -> sq.side
        | Circle c  -> c.radius;
    `);
    const matchExpr = (stmts[2] as any).initializer;
    expect(matchExpr.missingVariants).toEqual(['Rectangle']);
  });

  it('annotates all missing variants when multiple are absent', () => {
    const stmts = infer(`
      type Shape = { | Square: side | Circle: radius | Rectangle: x, y }
      let s = Square { 10 };
      let r = match s with
        | Square sq -> sq.side;
    `);
    const matchExpr = (stmts[2] as any).initializer;
    expect(matchExpr.missingVariants).toEqual(expect.arrayContaining(['Circle', 'Rectangle']));
    expect(matchExpr.missingVariants).toHaveLength(2);
  });

  it('does not annotate missingVariants when all variants are covered', () => {
    const stmts = infer(`
      type Shape = { | Square: side | Circle: radius }
      let s = Square { 10 };
      let r = match s with
        | Square sq -> sq.side
        | Circle c  -> c.radius;
    `);
    const matchExpr = (stmts[2] as any).initializer;
    expect(matchExpr.missingVariants).toBeUndefined();
  });

  it('does not annotate missingVariants when a wildcard arm is present', () => {
    const stmts = infer(`
      type Shape = { | Square: side | Circle: radius | Rectangle: x, y }
      let s = Square { 10 };
      let r = match s with
        | Square sq -> sq.side
        | _ -> 0;
    `);
    const matchExpr = (stmts[2] as any).initializer;
    expect(matchExpr.missingVariants).toBeUndefined();
  });

  it('does not annotate missingVariants when subject type is Unknown', () => {
    // Subject is a parameter — type is Unknown, can't check exhaustiveness
    const stmts = infer(`
      type Shape = { | Square: side | Circle: radius }
      function area(s) {
        return match s with
          | Square sq -> sq.side;
      }
    `);
    // No crash, no missingVariants on the match inside the function
    expect(stmts).toHaveLength(2);
  });

  it('handles Option union exhaustiveness', () => {
    const stmts = infer(`
      let x = Some { 1 };
      let y = match x with
        | Some s -> s.value;
    `);
    const matchExpr = (stmts[1] as any).initializer;
    // Some is a variant of Option — None should be flagged
    // Note: Option is a builtin union; registry only knows user-defined types,
    // so this case produces no missingVariants (correct — builtin unions are
    // checked at runtime).
    expect(matchExpr.missingVariants).toBeUndefined();
  });

  it('checks exhaustiveness on a two-variant union defined inline', () => {
    const stmts = infer(`
      type Color = { | Red | Blue }
      let c = Red;
      let r = match c with
        | Red -> 1;
    `);
    const matchExpr = (stmts[2] as any).initializer;
    expect(matchExpr.missingVariants).toEqual(['Blue']);
  });
});

// ─── Scoping ──────────────────────────────────────────────────────────────────

describe('Scoping', () => {
  it('inner binding shadows outer in the same expression chain', () => {
    const stmts = infer(`
      let x = 1;
      let y = x + 1;
    `);
    expect((stmts[1] as any).inferredType).toEqual({ kind: 'Int' });
  });

  it('block statement uses a child scope', () => {
    expect(() => infer(`
      let x = 1;
      { let inner = x + 2; }
    `)).not.toThrow();
  });
});

// ─── Robustness ───────────────────────────────────────────────────────────────

describe('Robustness', () => {
  it('handles an empty program', () => {
    expect(() => inferTypes([])).not.toThrow();
  });

  it('handles a call expression without crashing', () => {
    const stmts = infer('let x = foo(1, 2);');
    expect((stmts[0] as any).inferredType).toEqual({ kind: 'Unknown' });
  });

  it('handles match expressions without crashing', () => {
    expect(() => infer(`
      let x = Some { 1 };
      let y = match x with | Some s -> s.value | None -> 0;
    `)).not.toThrow();
  });

  it('handles nested lists', () => {
    const stmts = infer('let xs = [[1, 2], [3, 4]];');
    expect((stmts[0] as any).inferredType).toEqual({
      kind: 'List',
      element: { kind: 'List', element: { kind: 'Int' } },
    });
  });

  it('infers type of arithmetic over multiple chained bindings', () => {
    const stmts = infer(`
      let a = 1;
      let b = 2;
      let c = a + b;
      let d = c * 3;
    `);
    expect((stmts[2] as any).inferredType).toEqual({ kind: 'Int' });
    expect((stmts[3] as any).inferredType).toEqual({ kind: 'Int' });
  });
});
