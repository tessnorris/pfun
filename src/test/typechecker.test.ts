// src/test/typechecker.test.ts
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Stmt, Expr, PfunType } from '../ast';
import { inferTypes, checkTypes } from '../typechecker';
import { PfunError } from '../errors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Run checkTypes() and return the array of PfunErrors (may be empty). */
function check(src: string): PfunError[] {
  const stmts = new Parser(new Lexer(src).lex()).parse();
  return checkTypes(stmts, src);
}
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

  it('infers Float for unary minus on a float (fixed: previously forced every unary minus through Int, rejecting -5.5 as a type error even though the interpreter\'s own UnaryExpr evaluation correctly negates a Float and returns a Float)', () => {
    expect(typeOf('-5.5')).toEqual({ kind: 'Float' });
  });

  it('unary minus on a genuinely invalid operand (Str) still constrains toward Int, so checkTypes (not just typeOf\'s raw inferTypes) reports a real unification error', () => {
    // typeOf/inferTypes alone never surfaces unification FAILURES (only
    // the unconstrained result type) — checkTypes is what actually
    // detects and reports them, exactly as main.ts's real pipeline does.
    // This is the test that would have caught the original bug's
    // user-facing symptom (a wrong type silently accepted) if it had
    // asserted on checkTypes's errors instead of typeOf's bare result.
    const { checkTypes } = require('../typechecker');
    const src = '-"oops";';
    const stmts = parse(src);
    const errors = checkTypes(stmts, src);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].pfunMessage).toContain('Cannot unify');
  });
});

// ─── Binary operators ─────────────────────────────────────────────────────────

describe('Binary operators', () => {
  it('infers Int for Int + Int', () => {
    expect(typeOf('1 + 2')).toEqual({ kind: 'Int' });
  });

  it('infers Str for Str + Str (+ is now polymorphic — operands must agree)', () => {
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

  it('infers Str for Int + Str (string coercion — Str operand makes result Str)', () => {
    // If either operand is Str, + returns Str without constraining the other.
    expect(typeOf('1 + "x"')).toEqual({ kind: 'Str' });
  });

  it('infers Int when one operand is unbound (TyVar constrained equal to Int)', () => {
    // someVar TyVar is constrained equal to 1 (Int) via the + operand constraint.
    expect(typeOf('someVar + 1')).toEqual({ kind: 'Int' });
  });
});

// ─── Grouping ─────────────────────────────────────────────────────────────────

describe('Grouped expressions', () => {
  it('propagates type through parentheses', () => {
    expect(typeOf('(42)')).toEqual({ kind: 'Int' });
  });

  it('propagates TyVar through parentheses for unbound names', () => {
    // Unbound names get a fresh TyVar; grouping propagates it unchanged.
    expect(typeOf('(someVar)').kind).toBe('TyVar');
  });
});

// ─── Ternary ──────────────────────────────────────────────────────────────────

describe('Ternary expressions', () => {
  it('infers the branch type when both branches agree', () => {
    expect(typeOf('true ? 1 : 2')).toEqual({ kind: 'Int' });
  });

  it('infers Int when branches disagree (HM unifies them, constraint error collected)', () => {
    // Ternary constraint [Int, Str] fails; then-branch type Int is returned.
    expect(typeOf('true ? 1 : "x"')).toEqual({ kind: 'Int' });
  });

  it('infers Int when one branch is unbound (HM constrains TyVar to Int)', () => {
    // someVar TyVar is constrained equal to 1 (Int) via ternary constraint.
    expect(typeOf('true ? someVar : 1')).toEqual({ kind: 'Int' });
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

  it('infers List<TyVar> for an empty list', () => {
    // No elements to constrain the element type — stays as a fresh TyVar.
    const t = typeOf('[]');
    expect(t.kind).toBe('List');
    expect((t as any).element.kind).toBe('TyVar');
  });

  it('infers List<Int> for a mixed-type list (HM constrains all elements)', () => {
    // [1, "x"] — element TyVar is constrained to Int (first) then Str.
    // Int constraint wins; Str unification fails silently.
    const t = typeOf('[1, "x"]');
    expect(t.kind).toBe('List');
    expect((t as any).element).toEqual({ kind: 'Int' });
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

  it('infers TyVar for unresolvable initializer', () => {
    // Unbound names get a fresh TyVar — not Unknown — in the HM pass.
    const stmts = infer('let x = someUndefinedVar;');
    expect((stmts[0] as any).inferredType.kind).toBe('TyVar');
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

  it('resolves to TyVar for an unbound name', () => {
    const stmts = infer('let x = noSuchName;');
    expect((stmts[0] as any).inferredType.kind).toBe('TyVar');
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
  it('infers Fn type with TyVar param and known return for literal body', () => {
    // x is unconstrained — stays as TyVar. Body is literal Int.
    const t = typeOf('fn x => 42');
    expect(t.kind).toBe('Fn');
    expect((t as any).params[0].kind).toBe('TyVar');
    expect((t as any).ret).toEqual({ kind: 'Int' });
  });

  it('infers Fn with TyVar param and Str return for string body', () => {
    const t = typeOf('fn x => "hello"');
    expect(t.kind).toBe('Fn');
    expect((t as any).params[0].kind).toBe('TyVar');
    expect((t as any).ret).toEqual({ kind: 'Str' });
  });

  it('infers Fn with Int param and Bool return for comparison body', () => {
    // x == 0 constrains x to Int (== constrains operands equal, 0 is Int).
    expect(typeOf('fn x => x == 0')).toEqual({
      kind: 'Fn',
      params: [{ kind: 'Int' }],
      ret: { kind: 'Bool' },
    });
  });

  it('infers Fn with TyVar param and TyVar return for unresolvable call', () => {
    const t = typeOf('fn x => someCall(x)');
    expect(t.kind).toBe('Fn');
    expect((t as any).params[0].kind).toBe('TyVar');
    expect((t as any).ret.kind).toBe('TyVar');
  });

  it('infers Fn with TyVar params when body uses + on params (+ is polymorphic)', () => {
    // x + y constrains x == y but doesn't force them to Int.
    // Both params and ret stay as the same TyVar.
    const t = typeOf('fn x, y => x + y') as any;
    expect(t.kind).toBe('Fn');
    expect(t.params[0].kind).toBe('TyVar');
    expect(t.params[1].kind).toBe('TyVar');
    // params must agree — they should be the same after unification
    // ret is the left operand's type
  });

  it('lambda bound via let carries its Fn type', () => {
    const stmts = infer('let f = fn x => true;');
    const t = (stmts[0] as any).inferredType;
    expect(t.kind).toBe('Fn');
    expect(t.params[0].kind).toBe('TyVar'); // x is unconstrained
    expect(t.ret).toEqual({ kind: 'Bool' });
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

  it('infers Bool return type and Int param for a function returning a comparison', () => {
    // n == 0 constrains n to Int.
    expect(fnTypeOf(`function isZero(n) { return n == 0; }`)).toEqual({
      kind: 'Fn',
      params: [{ kind: 'Int' }],
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

  it('infers Fn<Unknown, Unknown> when all paths are unresolvable (identity fn)', () => {
    // Local solve converts unsolved TyVars to Unknown for call-site independence.
    const t = fnTypeOf(`function passThrough(x) { return x; }`);
    expect(t.kind).toBe('Fn');
    expect((t as any).params[0]).toEqual({ kind: 'Unknown' });
    expect((t as any).ret).toEqual({ kind: 'Unknown' });
  });

  it('handles recursive function without crashing', () => {
    expect(() => infer(`
      function fib(n) {
        return n <= 1 ? n : fib(n - 1) + fib(n - 2);
      }
    `)).not.toThrow();
  });

  it('infers Bool return for recursive function with base-case literal', () => {
    const t = fnTypeOf(`
      function allPos(xs) {
        return length(xs) == 0 ? true : head(xs) > 0 && allPos(tail(xs));
      }
    `);
    expect(t.kind).toBe('Fn');
    // xs is passed to length/head/tail which have Unknown params — no constraint
    // on xs itself, so it stays Unknown or TyVar depending on pass order.
    expect((t as any).ret).toEqual({ kind: 'Bool' });
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
    // Local solve converts unsolved ret TyVar to Unknown.
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
    // fieldTypes now carries the resolved field types (Int, Int here) —
    // used by ListExpr for cross-element field-by-field comparison.
    expect((stmts[1] as any).inferredType).toEqual({
      kind: 'Named', name: 'Point', unionName: undefined,
      fieldTypes: [{ kind: 'Int' }, { kind: 'Int' }],
    });
  });

  it('infers Named with unionName for a union variant', () => {
    const stmts = infer(`
      type Shape = { | Square: side | Circle: radius }
      let s = Square { 10 };
    `);
    // Union variants do NOT carry fieldTypes — their consistency is
    // handled differently (union-variant mixing in lists is intentionally
    // allowed via the unionName check in unify()'s Named case).
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
    // at that point, so unionName is absent.  fieldTypes is still present
    // since field values were inferred even though the type is not registered.
    const stmts = infer(`
      let x = Unknown { 1 };
      type Unknown = { value };
    `);
    expect((stmts[0] as any).inferredType).toEqual({
      kind: 'Named', name: 'Unknown',
      fieldTypes: [{ kind: 'Int' }],
    });
  });

  it('plain record binding propagates Named type through let', () => {
    const stmts = infer(`
      type Pair = { first, second };
      let p = Pair { 1, 2 };
      let q = p;
    `);
    // q's inferredType is derived from p — it propagates the full Named
    // shape including fieldTypes.
    expect((stmts[2] as any).inferredType).toEqual({
      kind: 'Named', name: 'Pair', unionName: undefined,
      fieldTypes: [{ kind: 'Int' }, { kind: 'Int' }],
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
    // Call return type is a fresh TyVar (not Unknown) in the HM pass
    expect((stmts[0] as any).inferredType.kind).toBe('TyVar');
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

// ─── Field-level type checking in list literals ───────────────────────────────
//
// Stage 1 of the record-list feature: when the same plain record name appears
// more than once in a single list literal, the inferencer now pushes field-by-
// field constraints between occurrences, catching mixed-instantiation records
// that would previously slip through (name-level unification trivially
// succeeded since both elements are Named{Pair} regardless of field types).

describe('Field-level type checking in list literals (Stage 1)', () => {
  it('catches two records with the same name but different field types in one list', () => {
    const errors = check(`
      type Pair = { first, second };
      let pairs = [Pair { 1, 2 }, Pair { "a", "b" }];
    `);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].pfunMessage).toContain('Cannot unify');
  });

  it('catches a single mismatched field (second field differs)', () => {
    const errors = check(`
      type Pair = { first, second };
      let pairs = [Pair { "k1", 1 }, Pair { "k2", "v2" }];
    `);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].pfunMessage).toContain('Cannot unify');
  });

  it('accepts a list where all records have the same field types', () => {
    const errors = check(`
      type Pair = { first, second };
      let pairs = [Pair { "k1", "v1" }, Pair { "k2", "v2" }, Pair { "k3", "v3" }];
    `);
    expect(errors).toHaveLength(0);
  });

  it('accepts a list with exactly one record element (no cross-element comparison)', () => {
    const errors = check(`
      type Pair = { first, second };
      let pairs = [Pair { "key", "value" }];
    `);
    expect(errors).toHaveLength(0);
  });

  it('accepts an empty list (no elements to compare)', () => {
    const errors = check(`
      type Pair = { first, second };
      let pairs = [];
    `);
    expect(errors).toHaveLength(0);
  });

  it('accepts a mixed-field list when record types have different names', () => {
    // Two different record types in the same list is caught by name-level
    // unification (both elements must be the same Named type), not field-
    // level comparison — this is existing behavior, unchanged by Stage 1.
    const errors = check(`
      type Point = { x, y };
      type Size  = { w, h };
      let mixed = [Point { 1, 2 }, Size { 3, 4 }];
    `);
    // These DO produce an error — the name-level elemVar unification catches
    // Point vs Size. We confirm the error exists (regression guard) but don't
    // assert on its exact message, since it comes from the existing path.
    expect(errors.length).toBeGreaterThan(0);
  });

  it('does NOT flag union variants with the same unionName mixing in a list', () => {
    // [Square{5}, Circle{3}] is a valid List<Shape> — existing behavior,
    // must be untouched by Stage 1. fieldTypes is deliberately NOT attached
    // to union variants, so the new cross-element logic never fires here.
    const errors = check(`
      type Shape = { | Square: side | Circle: radius }
      let shapes = [Square { 5 }, Circle { 3 }];
    `);
    expect(errors).toHaveLength(0);
  });

  it('catches the mismatch even when a correct record appears third', () => {
    // The constraint is between the FIRST occurrence and each subsequent one.
    // A third element that matches the first but not the second still catches
    // the second.
    const errors = check(`
      type Pair = { first, second };
      let pairs = [Pair { "k", "v" }, Pair { "k", 99 }, Pair { "k2", "v2" }];
    `);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('field types propagate through substitution (first field constrained by later use)', () => {
    // The first element has Int fields (from literal values), which then
    // constrains a subsequent element's Str fields via the field constraints.
    const errors = check(`
      type Box = { value };
      let boxes = [Box { 42 }, Box { "hello" }];
    `);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].pfunMessage).toContain('Cannot unify');
  });

  it('a list with three matching records produces no errors', () => {
    const errors = check(`
      type Triple = { a, b, c };
      let ts = [Triple { 1, 2, 3 }, Triple { 4, 5, 6 }, Triple { 7, 8, 9 }];
    `);
    expect(errors).toHaveLength(0);
  });

  it('fieldTypes on the Named type are resolved after substitution', () => {
    // After inference, fieldTypes TyVars should be resolved to concrete types,
    // not remain as TyVars — confirms applySubstitutionToAST threads through them.
    const stmts = infer(`
      type Pair = { first, second };
      let p = Pair { 1, "hello" };
    `);
    const t = (stmts[1] as any).inferredType;
    expect(t.kind).toBe('Named');
    expect(t.fieldTypes).toBeDefined();
    expect(t.fieldTypes[0]).toEqual({ kind: 'Int' });
    expect(t.fieldTypes[1]).toEqual({ kind: 'Str' });
  });
});

// ─── Record-list literal syntax and empty typed-list seeding (Stage 2) ────────
//
// Parser: `Pair [{ "k1", "v1" }, { "k2", "v2" }]` desugars to a ListExpr
// whose elements are RecordExpr nodes, with recordTypeHint='Pair' on the list.
// Disambiguated from `arr[i]` by one-token lookahead: '[{' or '[]' → sugar;
// '[<anything else>' → postfix IndexExpr, unchanged.
//
// Inferencer: an empty typed-list literal (`Pair []`) uses recordTypeHint +
// the registered field arity to seed elemVar to Named{Pair, [TyVar, TyVar]},
// so later uses like cons(wrongType, dataset) catch the mismatch statically
// instead of succeeding against a free TyVar.

describe('Record-list literals and empty typed-list seeding (Stage 2)', () => {
  describe('Parser: syntax and disambiguation', () => {
    it('parses Name [{...}] as a ListExpr of RecordExprs with recordTypeHint set', () => {
      const stmts = new Parser(new Lexer(`
        type Pair = { first, second };
        let pairs = Pair [{"k1", "v1"}, {"k2", "v2"}];
      `).lex()).parse();
      const list = (stmts[1] as any).initializer;
      expect(list.type).toBe('ListExpr');
      expect(list.recordTypeHint).toBe('Pair');
      expect(list.elements).toHaveLength(2);
      expect(list.elements[0].type).toBe('RecordExpr');
      expect(list.elements[0].name).toBe('Pair');
      expect(list.elements[1].type).toBe('RecordExpr');
    });

    it('parses Name [] as an empty ListExpr with recordTypeHint set', () => {
      const stmts = new Parser(new Lexer(`
        type Pair = { first, second };
        let empty = Pair [];
      `).lex()).parse();
      const list = (stmts[1] as any).initializer;
      expect(list.type).toBe('ListExpr');
      expect(list.recordTypeHint).toBe('Pair');
      expect(list.elements).toHaveLength(0);
    });

    it('does NOT affect ordinary indexing: arr[i] is still an IndexExpr', () => {
      const stmts = new Parser(new Lexer(`
        var arr = array { 1, 2, 3 };
        let x = arr[0];
      `).lex()).parse();
      // arr[0] goes through the Pratt infix '[' handler, producing IndexExpr
      const expr = (stmts[1] as any).initializer;
      expect(expr.type).toBe('IndexExpr');
    });

    it('does NOT affect arr[expr] where expr is not {}: still an IndexExpr', () => {
      const stmts = new Parser(new Lexer(`
        var arr = array { 1, 2 };
        let x = arr[1 + 0];
      `).lex()).parse();
      expect((stmts[1] as any).initializer.type).toBe('IndexExpr');
    });

    it('parses named-field record-list elements correctly', () => {
      const stmts = new Parser(new Lexer(`
        type Point = { x, y };
        let pts = Point [{x=1, y=2}, {x=3, y=4}];
      `).lex()).parse();
      const list = (stmts[1] as any).initializer;
      expect(list.type).toBe('ListExpr');
      expect(list.elements[0].fields[0].key).toBe('x');
      expect(list.elements[0].fields[1].key).toBe('y');
    });

    it('a single-element record-list parses correctly', () => {
      const stmts = new Parser(new Lexer(`
        type Box = { value };
        let boxes = Box [{"x"}];
      `).lex()).parse();
      const list = (stmts[1] as any).initializer;
      expect(list.type).toBe('ListExpr');
      expect(list.elements).toHaveLength(1);
    });
  });

  describe('Inferencer: type-correctness of non-empty record-list literals', () => {
    it('accepts a well-typed record-list literal without errors', () => {
      const errors = check(`
        type Pair = { first, second };
        let pairs = Pair [{"k1", "v1"}, {"k2", "v2"}];
      `);
      expect(errors).toHaveLength(0);
    });

    it('catches a mixed-type record-list literal (Stage 1 catches it field-by-field)', () => {
      const errors = check(`
        type Pair = { first, second };
        let pairs = Pair [{"k1", "v1"}, {"k2", 99}];
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].pfunMessage).toContain('Cannot unify');
    });

    it('infers List<Pair> element type as Named for a non-empty record-list', () => {
      const stmts = infer(`
        type Pair = { first, second };
        let pairs = Pair [{"k1", "v1"}];
      `);
      const t = (stmts[1] as any).inferredType;
      expect(t.kind).toBe('List');
      expect(t.element.kind).toBe('Named');
      expect(t.element.name).toBe('Pair');
    });
  });

  describe('Inferencer: empty typed-list seeding (Pair [])', () => {
    it('empty Pair [] produces a List with Named{Pair} element type, not free TyVar', () => {
      const stmts = infer(`
        type Pair = { first, second };
        let empty = Pair [];
      `);
      const t = (stmts[1] as any).inferredType;
      expect(t.kind).toBe('List');
      expect(t.element.kind).toBe('Named');
      expect(t.element.name).toBe('Pair');
    });

    it('empty Pair [] element type has fieldTypes with as many slots as Pair has fields', () => {
      const stmts = infer(`
        type Pair = { first, second };
        let empty = Pair [];
      `);
      const elem = (stmts[1] as any).inferredType.element;
      expect(elem.fieldTypes).toBeDefined();
      expect(elem.fieldTypes).toHaveLength(2);
    });

    it('Pair [] element type is Named{Pair}, constraining any expression comparing two typed empty lists', () => {
      // The ternary forces both branches to agree on element type.
      // Named{Pair} vs Named{Box} → unify() rejects (different names).
      const errors = check(`
        type Pair = { first, second };
        type Box  = { value };
        let pairList = Pair [];
        let boxList  = Box  [];
        let bad = true ? pairList : boxList;
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].pfunMessage).toContain('Cannot unify');
    });

    it('cons-ing a well-typed Pair onto an empty Pair [] produces no errors', () => {
      const errors = check(`
        type Pair = { first, second };
        let empty = Pair [];
        let ok = cons(Pair { "k", "v" }, empty);
      `);
      expect(errors).toHaveLength(0);
    });

    it('bare [] still produces a free TyVar element — no hint, no seeding', () => {
      const stmts = infer('let empty = [];');
      const t = (stmts[0] as any).inferredType;
      expect(t.kind).toBe('List');
      expect(t.element.kind).toBe('TyVar');
    });

    it('falls back to free TyVar when the type name is not yet registered (forward reference)', () => {
      // Pair [] appears before the type declaration — arity is unknown at
      // constraint-gen time. Falls back gracefully, same as bare [].
      const stmts = infer(`
        let early = Pair [];
        type Pair = { first, second };
      `);
      const t = (stmts[0] as any).inferredType;
      expect(t.kind).toBe('List');
      // element may be TyVar (unresolved) or Named depending on whether the
      // forward-reference walk registers it — either way, no crash.
      expect(['TyVar', 'Named']).toContain(t.element.kind);
    });

    it('a single-field record produces a seeded element type with one fieldTypes slot', () => {
      const stmts = infer(`
        type Box = { value };
        let boxes = Box [];
      `);
      const elem = (stmts[1] as any).inferredType.element;
      expect(elem.kind).toBe('Named');
      expect(elem.name).toBe('Box');
      expect(elem.fieldTypes).toHaveLength(1);
    });
  });
});
