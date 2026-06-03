// src/errors.test.ts
// Tests for the Pfun error reporting system.
//
// Each test verifies one or more of:
//   - The correct ErrorKind prefix appears in the message
//   - The line number and column are correct
//   - The failing source line is reproduced
//   - Relevant identifier bindings are shown with correct formatted values
//   - The original error detail message is present

import { Lexer } from './lexer';
import { Parser } from './parser';
import { Interpreter } from './interpreter';
import { ModuleLoader } from './interpreter';
import { stdlibFunctions, stdlibTypes } from './library';
import { iolibFunctions } from './iolib';
import { PfunError, classifyError, formatValue, buildPfunError } from './errors';
import * as os from 'os';
import * as nodePath from 'path';
import * as nodeFs from 'fs';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Run source and return the thrown PfunError.
 * Fails the test if no error is thrown or if a non-PfunError is thrown.
 */
const runExpectError = (source: string): PfunError => {
  const ast = new Parser(new Lexer(source).lex()).parse();
  const interpreter = new Interpreter();
  interpreter.registerLibrary(stdlibFunctions, stdlibTypes);
  interpreter.registerLibrary(iolibFunctions, []);
  try {
    interpreter.interpret(ast, source);
  } catch (e) {
    if (e instanceof PfunError) return e;
    throw new Error(`Expected PfunError but got ${(e as any)?.constructor?.name}: ${e}`);
  }
  throw new Error('Expected an error to be thrown but none was');
};

/**
 * Run source through lex+parse only, expecting a PfunError from a lex/syntax error.
 * main.ts wraps these; here we call buildPfunError directly to replicate that.
 */
const runExpectParseError = (source: string): PfunError => {
  try {
    new Parser(new Lexer(source).lex()).parse();
  } catch (e) {
    const raw = e instanceof Error ? e : new Error(String(e));
    // Replicate what main.ts does for lex/parse errors
    return buildPfunError(raw, source, (raw as any).pos, null, () => undefined, { stringify: String });
  }
  throw new Error('Expected a parse/lex error but none was thrown');
};

/** Assert that an error message contains a substring. */
const assertContains = (err: PfunError, substring: string) => {
  if (!err.pfunMessage.includes(substring)) {
    throw new Error(
      `Expected error message to contain: "${substring}"\nActual message:\n${err.pfunMessage}`
    );
  }
};

/** Assert that an error message does NOT contain a substring. */
const assertNotContains = (err: PfunError, substring: string) => {
  if (err.pfunMessage.includes(substring)) {
    throw new Error(
      `Expected error message NOT to contain: "${substring}"\nActual message:\n${err.pfunMessage}`
    );
  }
};

// ─── Unit tests: classifyError ─────────────────────────────────────────────────

describe('classifyError()', () => {
  it('classifies divide by zero', () => {
    expect(classifyError('Divide by zero.')).toBe('DivideByZero');
    expect(classifyError('division by zero error')).toBe('DivideByZero');
  });

  it('classifies non-exhaustive match as Exhaustiveness', () => {
    expect(classifyError("Non-exhaustive match on 'Shape': missing arm(s) for 'Rectangle'.")).toBe('Exhaustiveness');
    expect(classifyError("Non-exhaustive match: no arm matched value of type 'Circle'.")).toBe('Exhaustiveness');
  });

  it('classifies purity violations', () => {
    expect(classifyError("Functions cannot use 'println': side effects are not allowed in pure functions.")).toBe('Purity');
    expect(classifyError("Functions cannot use 'var': side-effectful mutation is not allowed in pure functions.")).toBe('Purity');
    expect(classifyError("Functions cannot call procedures: 'foo' is a procedure.")).toBe('Purity');
    expect(classifyError("Functions cannot mutate dicts: side-effectful mutation is not allowed.")).toBe('Purity');
  });

  it('classifies lexical errors', () => {
    expect(classifyError("Unexpected character '@'")).toBe('Lexical');
    expect(classifyError("Unterminated string.")).toBe('Lexical');
    expect(classifyError("Unknown escape sequence: \\q")).toBe('Lexical');
    expect(classifyError("Char literal must contain exactly one character.")).toBe('Lexical');
  });

  it('classifies syntax errors', () => {
    expect(classifyError("Expected ')' after expression.")).toBe('Syntax');
    expect(classifyError("Expected 'then' after if condition.")).toBe('Syntax');
    expect(classifyError("Expected '->' after match pattern.")).toBe('Syntax');
  });

  it('classifies name errors', () => {
    expect(classifyError("Undefined variable 'x'.")).toBe('Name');
    expect(classifyError("Unknown type 'Triangle'.")).toBe('Name');
    expect(classifyError("Cannot assign to immutable variable 'x'.")).toBe('Name');
    expect(classifyError("Property 'foo' not found.")).toBe('Name');
  });

  it('classifies type errors', () => {
    expect(classifyError("Type mismatch in Square: field 'side' expected bigint, got string.")).toBe('Type');
    expect(classifyError("Type mismatch in list: expected bigint, got string.")).toBe('Type');
    expect(classifyError("asc() requires a char argument.")).toBe('Type');
    expect(classifyError("Dictionary keys must be strings, integers, or booleans.")).toBe('Type');
  });

  it('classifies key errors', () => {
    expect(classifyError("Key not found in dict: \"foo\"")).toBe('Key');
    expect(classifyError("Missing field 'x' in Point.")).toBe('Key');
    expect(classifyError("List index 5 out of bounds (length 3).")).toBe('Key');
  });

  it('classifies arity errors', () => {
    expect(classifyError("'Rectangle' expects 2 field(s), got 1.")).toBe('Arity');
  });

  it('classifies import errors', () => {
    expect(classifyError("Module not found: ./missing.pf")).toBe('Import');
    expect(classifyError("Circular import detected: ./a.pf")).toBe('Import');
    expect(classifyError("Module 'utils' does not export 'secret'.")).toBe('Import');
  });

  it('classifies divide-by-zero before type', () => {
    // Ensure DivideByZero wins over Type for ambiguous messages
    expect(classifyError("divide by zero")).toBe('DivideByZero');
  });

  it('falls back to Runtime for unrecognized messages', () => {
    expect(classifyError("Something very weird happened")).toBe('Runtime');
    expect(classifyError("Can only call functions.")).toBe('Runtime');
  });
});

// ─── Unit tests: formatValue ───────────────────────────────────────────────────

describe('formatValue()', () => {
  const mockInterp = {
    stringify(v: any): string {
      if (typeof v === 'bigint') return v.toString();
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      if (typeof v === 'string') return v;
      return String(v);
    }
  };

  it('formats undefined/null as <Undef>', () => {
    expect(formatValue(undefined, mockInterp)).toBe('<Undef>');
    expect(formatValue(null, mockInterp)).toBe('<Undef>');
  });

  it('formats bigint primitives', () => {
    expect(formatValue(42n, mockInterp)).toBe('42');
  });

  it('formats boolean primitives', () => {
    expect(formatValue(true, mockInterp)).toBe('true');
    expect(formatValue(false, mockInterp)).toBe('false');
  });

  it('formats strings', () => {
    expect(formatValue('hello', mockInterp)).toBe('hello');
  });

  it('formats long strings with truncation', () => {
    const long = 'a'.repeat(80);
    const result = formatValue(long, mockInterp);
    expect(result.length).toBeLessThanOrEqual(63); // 60 + '...'
    expect(result.endsWith('...')).toBe(true);
  });

  it('formats empty list', () => {
    expect(formatValue([], mockInterp)).toBe('List (empty)');
  });

  it('formats non-empty list with first item', () => {
    const result = formatValue([42n, 10n, 5n], mockInterp);
    expect(result).toMatch(/^List \(42/);
  });

  it('formats a named PfunFunction as "fun name"', () => {
    const { PfunFunction, Environment } = require('./interpreter');
    const fn = new PfunFunction('myFunc', ['x'], [], new Environment(), 'function');
    expect(formatValue(fn, mockInterp)).toBe('fun myFunc');
  });

  it('formats a named PfunFunction procedure as "proc name"', () => {
    const { PfunFunction, Environment } = require('./interpreter');
    const fn = new PfunFunction('myProc', ['x'], [], new Environment(), 'procedure');
    expect(formatValue(fn, mockInterp)).toBe('proc myProc');
  });

  it('formats a simple lambda as "fn params => body"', () => {
    const { PfunFunction, Environment } = require('./interpreter');
    // Lambda: fn x => x * 2
    const body = { type: 'BinaryExpr', left: { type: 'IdentExpr', name: 'x' }, operator: 'StarToken', right: { type: 'IntExpr', value: 2n } };
    const fn = new PfunFunction(null, ['x'], body, new Environment(), 'function');
    const result = formatValue(fn, mockInterp);
    expect(result).toBe('fn x => x * 2');
  });

  it('formats a multi-param lambda', () => {
    const { PfunFunction, Environment } = require('./interpreter');
    const body = { type: 'BinaryExpr', left: { type: 'IdentExpr', name: 'x' }, operator: 'PlusToken', right: { type: 'IdentExpr', name: 'y' } };
    const fn = new PfunFunction(null, ['x', 'y'], body, new Environment(), 'function');
    expect(formatValue(fn, mockInterp)).toBe('fn x, y => x + y');
  });

  it('formats a record value as "TypeName record"', () => {
    const val = { __type: 'Point', __union: undefined, x: 1n, y: 2n };
    expect(formatValue(val, mockInterp)).toBe('Point record');
  });

  it('formats a zero-field record/singleton as just the type name', () => {
    const val = { __type: 'None', __union: 'Option' };
    expect(formatValue(val, mockInterp)).toBe('Option: None');
  });

  it('formats a union variant as "UnionName: VariantName"', () => {
    const val = { __type: 'Some', __union: 'Option', value: 42n };
    expect(formatValue(val, mockInterp)).toBe('Option: Some');
  });

  it('formats PfunChar', () => {
    const { PfunChar } = require('./interpreter');
    expect(formatValue(new PfunChar('A'), mockInterp)).toBe("'A'");
  });

  it('formats LazyList', () => {
    const { LazyList } = require('./interpreter');
    expect(formatValue(new LazyList({ kind: 'repeat', value: 1n }), mockInterp)).toBe('<lazylist>');
  });

  it('formats PfunDict', () => {
    const { PfunDict } = require('./interpreter');
    expect(formatValue(new PfunDict(new Map()), mockInterp)).toBe('dict { ... }');
  });
});

// ─── Integration tests: error format ──────────────────────────────────────────

describe('PfunError format', () => {
  it('includes [Kind] prefix', () => {
    const err = runExpectError(`
      let x = 10;
      x = 20;
    `);
    expect(err.pfunMessage).toMatch(/^\[Name\] Error/);
  });

  it('includes line number', () => {
    const err = runExpectError(`
      let x = 10;
      x = 20;
    `);
    expect(err.pfunMessage).toMatch(/line \d+\/ch\d+/);
  });

  it('includes the failing source line text', () => {
    const err = runExpectError(`
      let x = 10;
      x = 20;
    `);
    expect(err.pfunMessage).toContain('x = 20');
  });

  it('includes the original error message', () => {
    const err = runExpectError(`
      let x = 10;
      x = 20;
    `);
    expect(err.pfunMessage).toContain("Cannot assign to immutable variable 'x'");
  });

  it('is itself an Error subclass that toThrow() can match on substrings', () => {
    // Existing tests use .toThrow("substring") — this verifies they still work
    expect(() => runExpectError(`
      let x = 10;
      x = 20;
    `)).toThrow("Cannot assign to immutable variable 'x'");
  });
});

// ─── Name errors ──────────────────────────────────────────────────────────────

describe('[Name] errors', () => {
  it('undefined variable', () => {
    const err = runExpectError(`
      let x = 10;
      println(y);
    `);
    expect(err.kind).toBe('Name');
    assertContains(err, "[Name]");
    assertContains(err, "Undefined variable 'y'");
    assertContains(err, 'println(y)');
  });

  it('unknown type in record construction', () => {
    const err = runExpectError(`
      var p = Triangle { 3, 4, 5 };
    `);
    expect(err.kind).toBe('Name');
    assertContains(err, "[Name]");
    assertContains(err, "Unknown type 'Triangle'");
  });

  it('immutable let reassignment', () => {
    const err = runExpectError(`
      let x = 10;
      x = 20;
    `);
    expect(err.kind).toBe('Name');
    assertContains(err, "[Name]");
    assertContains(err, "Cannot assign to immutable variable 'x'");
  });

  it('property not found on record', () => {
    const err = runExpectError(`
      type Point = { x, y }
      let p = Point { 1, 2 };
      eval p.z;
    `);
    expect(err.kind).toBe('Name');
    assertContains(err, "[Name]");
    assertContains(err, "Property 'z' not found");
  });

  it('shows binding value for the referenced variable', () => {
    const err = runExpectError(`
      let x = 10;
      x = 20;
    `);
    // x should appear in the bindings section
    assertContains(err, 'x = 10');
  });
});

// ─── Type errors ──────────────────────────────────────────────────────────────

describe('[Type] errors', () => {
  it('type mismatch in record field', () => {
    const err = runExpectError(`
      type Point = { x, y }
      var p1 = Point { 1, 2 };
      var p2 = Point { "a", "b" };
    `);
    expect(err.kind).toBe('Type');
    assertContains(err, "[Type]");
    assertContains(err, "Type mismatch in Point");
  });

  it('type mismatch in list', () => {
    const err = runExpectError(`
      let l = [1, "two", 3];
      eval l;
    `);
    expect(err.kind).toBe('Type');
    assertContains(err, "[Type]");
    assertContains(err, "Type mismatch in list");
  });

  it('wrong argument type for builtin', () => {
    const err = runExpectError(`
      asc("not a char");
    `);
    expect(err.kind).toBe('Type');
    assertContains(err, "[Type]");
    assertContains(err, "requires a char");
  });

  it('type mismatch in union variant field', () => {
    const err = runExpectError(`
      type Shape = { | Square: side | Circle: radius }
      var s1 = Square { 10 };
      var s2 = Square { "ten" };
    `);
    expect(err.kind).toBe('Type');
    assertContains(err, "[Type]");
    assertContains(err, "Type mismatch in Square");
  });
});

// ─── Key errors ───────────────────────────────────────────────────────────────

describe('[Key] errors', () => {
  it('missing dict key', () => {
    const err = runExpectError(`
      var d = dict { "a" -> 1 };
      eval d["b"];
    `);
    expect(err.kind).toBe('Key');
    assertContains(err, "[Key]");
    assertContains(err, "Key not found in dict");
  });

  it('list index out of bounds', () => {
    const err = runExpectError(`
      let l = [1, 2, 3];
      eval l[10];
    `);
    expect(err.kind).toBe('Key');
    assertContains(err, "[Key]");
    assertContains(err, "out of bounds");
  });

  it('missing named field in record constructor', () => {
    const err = runExpectError(`
      type Point = { x, y }
      var p = Point(x=1);
    `);
    expect(err.kind).toBe('Key');
    assertContains(err, "[Key]");
    assertContains(err, "Missing field 'y'");
  });
});

// ─── DivideByZero errors ──────────────────────────────────────────────────────

describe('[DivideByZero] errors', () => {
  it('integer division by zero', () => {
    const err = runExpectError(`
      let x = 10;
      let y = 0;
      eval x / y;
    `);
    expect(err.kind).toBe('DivideByZero');
    assertContains(err, "[DivideByZero]");
    assertContains(err, "Divide by zero");
    // Should show x and y values
    assertContains(err, 'x = 10');
    assertContains(err, 'y = 0');
  });

  it('modulo by zero', () => {
    const err = runExpectError(`
      let n = 7;
      eval n % 0;
    `);
    expect(err.kind).toBe('DivideByZero');
    assertContains(err, "[DivideByZero]");
    assertContains(err, "zero");
  });
});

// ─── Purity errors ────────────────────────────────────────────────────────────

describe('[Purity] errors', () => {
  it('println in pure function', () => {
    const err = runExpectError(`
      function bad(x) {
        println(x);
      }
      bad(1);
    `);
    expect(err.kind).toBe('Purity');
    assertContains(err, "[Purity]");
    assertContains(err, "Functions cannot use 'println'");
  });

  it('var declaration in pure function', () => {
    const err = runExpectError(`
      function bad(x) {
        var y = x + 1;
        return y;
      }
      bad(1);
    `);
    expect(err.kind).toBe('Purity');
    assertContains(err, "[Purity]");
    assertContains(err, "Functions cannot use 'var'");
  });

  it('calling a procedure from a pure function', () => {
    const err = runExpectError(`
      proc effect() { println("side effect"); }
      function bad(x) {
        return effect();
      }
      bad(1);
    `);
    expect(err.kind).toBe('Purity');
    assertContains(err, "[Purity]");
    assertContains(err, "Functions cannot call procedures");
  });

  it('mutating a dict in a pure function', () => {
    const err = runExpectError(`
      function bad(d) {
        d["x"] = 1;
        return d;
      }
      var d = dict {};
      bad(d);
    `);
    expect(err.kind).toBe('Purity');
    assertContains(err, "[Purity]");
    assertContains(err, "Functions cannot mutate dicts");
  });
});

// ─── Exhaustiveness errors ────────────────────────────────────────────────────

describe('[Exhaustiveness] errors', () => {
  it('missing variant arm in match', () => {
    const err = runExpectError(`
      type Shape = { | Square: side | Circle: radius | Rectangle: x, y }
      var sq = Square { 4 };
      match sq {
        | Square s -> s.side
        | Circle c -> c.radius
      };
    `);
    expect(err.kind).toBe('Exhaustiveness');
    assertContains(err, "[Exhaustiveness]");
    assertContains(err, "missing arm(s) for 'Rectangle'");
  });

  it('all guards fail with no wildcard', () => {
    const err = runExpectError(`
      type Shape = { | Square: side | Circle: radius | Rectangle: x, y }
      var ci = Circle { 1 };
      match ci {
        | Circle c where c.radius > 10 -> c.radius
        | Square s -> s.side
        | Rectangle r -> r.x
      };
    `);
    expect(err.kind).toBe('Exhaustiveness');
    assertContains(err, "[Exhaustiveness]");
    assertContains(err, "no arm matched value of type 'Circle'");
  });

  it('non-exhaustive Option match', () => {
    const err = runExpectError(`
      let x = Some { 1 };
      match x { | Some s -> s.value };
    `);
    expect(err.kind).toBe('Exhaustiveness');
    assertContains(err, "[Exhaustiveness]");
    assertContains(err, "missing arm(s) for 'None'");
  });
});

// ─── Arity errors ─────────────────────────────────────────────────────────────

describe('[Arity] errors', () => {
  it('wrong number of fields in record constructor', () => {
    const err = runExpectError(`
      type Point = { x, y }
      var p = Point { 1 };
    `);
    expect(err.kind).toBe('Arity');
    assertContains(err, "[Arity]");
    assertContains(err, "expects 2 field(s), got 1");
  });

  it('too many fields in record constructor', () => {
    const err = runExpectError(`
      type Point = { x, y }
      var p = Point { 1, 2, 3 };
    `);
    expect(err.kind).toBe('Arity');
    assertContains(err, "[Arity]");
    assertContains(err, "expects 2 field(s), got 3");
  });
});

// ─── Binding display in error output ─────────────────────────────────────────

describe('Identifier bindings in error output', () => {
  it('shows integer variable value', () => {
    const err = runExpectError(`
      var count = 42;
      count = count + undefined_var;
    `);
    assertContains(err, 'count = 42');
  });

  it('shows string variable value', () => {
    const err = runExpectError(`
      let name = "Alice";
      eval name + undefined_thing;
    `);
    assertContains(err, 'name = Alice');
  });

  it('shows boolean variable value', () => {
    const err = runExpectError(`
      let flag = true;
      eval flag + undefined_thing;
    `);
    assertContains(err, 'flag = true');
  });

  it('shows record type as "TypeName record"', () => {
    const err = runExpectError(`
      type Point = { x, y }
      let p = Point { 3, 4 };
      eval p.z;
    `);
    assertContains(err, 'p = Point record');
  });

  it('shows union variant as "UnionName: VariantName"', () => {
    const err = runExpectError(`
      let x = Some { 99 };
      eval x / 0;
    `);
    assertContains(err, 'x = Option: Some');
  });

  it('shows named function as "fun name"', () => {
    const err = runExpectError(`
      function double(n) { return n * 2; }
      let f = double;
      eval f / 0;
    `);
    assertContains(err, 'f = fun double');
  });

  it('shows named procedure as "proc name"', () => {
    const err = runExpectError(`
      proc greet(n) { println(n); }
      let p = greet;
      eval p / 0;
    `);
    assertContains(err, 'p = proc greet');
  });

  it('shows simple lambda as "fn params => body"', () => {
    const err = runExpectError(`
      let f = fn x => x * 2;
      eval f / 0;
    `);
    assertContains(err, 'f = fn x => x * 2');
  });

  it('shows list with first element', () => {
    const err = runExpectError(`
      let items = [10, 20, 30];
      eval items + undefined_thing;
    `);
    assertContains(err, 'items = List (10 ...)');
  });

  it('shows empty list', () => {
    const err = runExpectError(`
      let empty = [];
      eval empty + undefined_thing;
    `);
    assertContains(err, 'empty = List (empty)');
  });

  it('shows <Undef> for unrecognized identifiers', () => {
    const err = runExpectError(`
      eval undefined_var;
    `);
    assertContains(err, 'undefined_var = <Undef>');
  });

  it('does not show direct call callee names as bindings', () => {
    // println is called directly — should not appear as a binding
    const err = runExpectError(`
      var x = 5;
      function bad(n) { println(n); }
      bad(x);
    `);
    // println is a direct callee, should not be in bindings
    assertNotContains(err, 'println =');
  });

  it('does not show builtin function names as bindings', () => {
    const err = runExpectError(`
      let nums = [1, 2, 3];
      let result = map(fn x => x, nums);
      eval result + undefined_thing;
    `);
    assertNotContains(err, 'map =');
  });

  it('shows multiple bindings for multi-variable expressions', () => {
    const err = runExpectError(`
      let a = 10;
      let b = 20;
      eval a / b / 0;
    `);
    assertContains(err, 'a = 10');
    assertContains(err, 'b = 20');
  });
});

// ─── Line number accuracy ──────────────────────────────────────────────────────

describe('Line number accuracy', () => {
  it('reports correct line for error on line 1', () => {
    const err = runExpectError(`eval undefined_x;`);
    assertContains(err, 'line 1/');
  });

  it('reports correct line for error on line 3', () => {
    const source = `let a = 1;\nlet b = 2;\neval undefined_x;\n`;
    const err = runExpectError(source);
    assertContains(err, 'line 3/');
  });

  it('reports correct line for error inside a multi-line function', () => {
    const err = runExpectError(`
      function bad() {
        return undefined_xyz;
      }
      bad();
    `);
    assertContains(err, 'undefined_xyz');
    expect(err.pfunMessage).toMatch(/line \d+/);
  });

  it('reports the source text of the failing line', () => {
    const source = `let x = 10;\neval x / 0;\n`;
    const err = runExpectError(source);
    assertContains(err, 'eval x / 0');
  });
});

// ─── Runtime errors ──────────────────────────────────────────────────────────

describe('[Runtime] errors', () => {
  it('head on empty list', () => {
    const err = runExpectError(`
      let l = [];
      eval head(l);
    `);
    // "head requires a non-empty list" — classifies as Runtime
    expect(err.kind).toBe('Runtime');
    assertContains(err, "[Runtime]");
    assertContains(err, "non-empty");
  });

  it('reduce on infinite list', () => {
    const err = runExpectError(`
      let nats = iterate(fn x => x + 1, 1);
      eval reduce(fn acc, x => acc + x, 0, nats);
    `);
    expect(err.kind).toBe('Runtime');
    assertContains(err, "[Runtime]");
    assertContains(err, "reduce cannot be used on an infinite list");
  });

  it('calling a non-function', () => {
    const err = runExpectError(`
      let x = 42;
      eval x(1);
    `);
    expect(err.kind).toBe('Runtime');
    assertContains(err, "[Runtime]");
    assertContains(err, "Can only call functions");
  });
});

// ─── Lexical errors (via buildPfunError directly) ─────────────────────────────

describe('[Lexical] errors', () => {
  it('unexpected character', () => {
    let threw = false;
    try {
      new Lexer('let x = @;').lex();
    } catch (e) {
      threw = true;
      const raw = e instanceof Error ? e : new Error(String(e));
      const pfunErr = buildPfunError(raw, 'let x = @;', undefined, null, () => undefined, { stringify: String });
      expect(pfunErr.kind).toBe('Lexical');
      assertContains(pfunErr, "[Lexical]");
      assertContains(pfunErr, "Unexpected character");
    }
    expect(threw).toBe(true);
  });

  it('unterminated string literal', () => {
    let threw = false;
    try {
      new Lexer('"unterminated').lex();
    } catch (e) {
      threw = true;
      const raw = e instanceof Error ? e : new Error(String(e));
      const pfunErr = buildPfunError(raw, '"unterminated', undefined, null, () => undefined, { stringify: String });
      expect(pfunErr.kind).toBe('Lexical');
      assertContains(pfunErr, "[Lexical]");
      assertContains(pfunErr, "Unterminated string");
    }
    expect(threw).toBe(true);
  });

  it('unknown escape sequence in string', () => {
    let threw = false;
    try {
      new Lexer('"bad \\q escape"').lex();
    } catch (e) {
      threw = true;
      const raw = e instanceof Error ? e : new Error(String(e));
      const pfunErr = buildPfunError(raw, '"bad \\q escape"', undefined, null, () => undefined, { stringify: String });
      expect(pfunErr.kind).toBe('Lexical');
      assertContains(pfunErr, "[Lexical]");
    }
    expect(threw).toBe(true);
  });
});

// ─── Syntax errors ────────────────────────────────────────────────────────────

describe('[Syntax] errors', () => {
  it('missing then in if statement', () => {
    let threw = false;
    try {
      new Parser(new Lexer('if x { println(1); }').lex()).parse();
    } catch (e) {
      threw = true;
      const raw = e instanceof Error ? e : new Error(String(e));
      const pfunErr = buildPfunError(raw, 'if x { println(1); }', undefined, null, () => undefined, { stringify: String });
      expect(pfunErr.kind).toBe('Syntax');
      assertContains(pfunErr, "[Syntax]");
      assertContains(pfunErr, "'then'");
    }
    expect(threw).toBe(true);
  });

  it('missing closing paren', () => {
    let threw = false;
    try {
      new Parser(new Lexer('println(1;').lex()).parse();
    } catch (e) {
      threw = true;
      const raw = e instanceof Error ? e : new Error(String(e));
      const pfunErr = buildPfunError(raw, 'println(1;', undefined, null, () => undefined, { stringify: String });
      expect(pfunErr.kind).toBe('Syntax');
      assertContains(pfunErr, "[Syntax]");
    }
    expect(threw).toBe(true);
  });
});

// ─── PfunError is re-thrown unchanged (innermost position preserved) ──────────

describe('PfunError pass-through', () => {
  it('nested errors preserve the innermost error kind and location', () => {
    // Error happens deep inside a called function — kind should still be correct
    const err = runExpectError(`
      function inner(x) {
        return x / 0;
      }
      function outer(x) {
        return inner(x);
      }
      eval outer(5);
    `);
    expect(err.kind).toBe('DivideByZero');
    assertContains(err, "[DivideByZero]");
  });

  it('error through a procedure call chain preserves kind', () => {
    const err = runExpectError(`
      proc step1() { eval 1 / 0; }
      proc step2() { step1(); }
      step2();
    `);
    expect(err.kind).toBe('DivideByZero');
    assertContains(err, "[DivideByZero]");
  });
});

// ─── Import errors ────────────────────────────────────────────────────────────

describe('[Import] errors', () => {
  const runWithModules = (mainSrc: string, modules: Record<string, string>): PfunError => {
    const dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'pfun-err-test-'));
    for (const [name, src] of Object.entries(modules)) {
      nodeFs.writeFileSync(nodePath.join(dir, name), src);
    }
    const setup = (i: Interpreter) => {
      i.registerLibrary(stdlibFunctions, stdlibTypes);
      i.registerLibrary(iolibFunctions, []);
    };
    const loader = new ModuleLoader(nodePath.join(dir, 'lib'), setup);
    loader.registerBuiltin('io', iolibFunctions);
    const ast = new Parser(new Lexer(mainSrc).lex()).parse();
    const interp = new Interpreter(dir, loader);
    setup(interp);
    try {
      interp.interpret(ast, mainSrc);
      nodeFs.rmSync(dir, { recursive: true });
      throw new Error('Expected an error but none was thrown');
    } catch (e) {
      nodeFs.rmSync(dir, { recursive: true });
      if (e instanceof PfunError) return e;
      throw new Error(`Expected PfunError but got: ${e}`);
    }
  };

  it('missing named export', () => {
    const err = runWithModules(
      `import { secret } from "./mod";`,
      { 'mod.pf': `let secret = 99;` }
    );
    expect(err.kind).toBe('Import');
    assertContains(err, "[Import]");
    assertContains(err, "does not export 'secret'");
  });

  it('circular import', () => {
    const err = runWithModules(
      `import { a } from "./a";`,
      {
        'a.pf': `import { b } from "./b"; export let a = 1;`,
        'b.pf': `import { a } from "./a"; export let b = 2;`,
      }
    );
    expect(err.kind).toBe('Import');
    assertContains(err, "[Import]");
    assertContains(err, "Circular import");
  });
});
