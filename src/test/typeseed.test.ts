// src/test/typeseed.test.ts
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Interpreter, ModuleLoader, TypeRegistry, pfunTypeToRuntimeType } from '../interpreter';
import { inferTypes } from '../typechecker';
import { PfunType } from '../ast';
import { stdlibFunctions, stdlibTypes } from '../library';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInterpreter() {
  const loader = new ModuleLoader('/tmp', (interp) => {
    interp.registerLibrary(stdlibFunctions, stdlibTypes);
  });
  const interp = new Interpreter('/tmp', loader);
  interp.registerLibrary(stdlibFunctions, stdlibTypes);
  return interp;
}

function run(src: string) {
  const stmts = new Parser(new Lexer(src).lex()).parse();
  inferTypes(stmts);
  const interp = makeInterpreter();
  interp.interpret(stmts, src);
  return interp;
}

function runExpectError(src: string): string {
  try {
    run(src);
    throw new Error('Expected an error but none was thrown');
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ─── pfunTypeToRuntimeType ────────────────────────────────────────────────────

describe('pfunTypeToRuntimeType', () => {
  const cases: Array<[PfunType, string | null]> = [
    [{ kind: 'Int' },                                   'bigint'],
    [{ kind: 'Float' },                                 'number'],
    [{ kind: 'Bool' },                                  'boolean'],
    [{ kind: 'Str' },                                   'string'],
    [{ kind: 'Char' },                                  'char'],
    [{ kind: 'Nil' },                                   'nil'],
    [{ kind: 'List', element: { kind: 'Int' } },        'list<bigint>'],
    [{ kind: 'List', element: { kind: 'Str' } },        'list<string>'],
    [{ kind: 'List', element: { kind: 'Unknown' } },    'list'],
    [{ kind: 'Named', name: 'Point' },                  'Point'],
    [{ kind: 'Named', name: 'Square', unionName: 'Shape' }, 'Shape'],
    [{ kind: 'Unknown' },                               null],
    [{ kind: 'Fn', params: [], ret: { kind: 'Int' } },  null],
  ];

  for (const [input, expected] of cases) {
    it(`maps ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(pfunTypeToRuntimeType(input)).toBe(expected);
    });
  }
});

// ─── TypeRegistry.seedTypes ───────────────────────────────────────────────────

describe('TypeRegistry.seedTypes', () => {
  it('seeds inferredTypes on a plain record schema', () => {
    const reg = new TypeRegistry();
    reg.registerPlain('Point', ['x', 'y']);
    reg.seedTypes('Point', ['bigint', 'bigint']);
    expect(() => reg.instantiate('Point', ['hello', 42n])).toThrow('Type mismatch');
  });

  it('does not seed if any field type is null', () => {
    const reg = new TypeRegistry();
    reg.registerPlain('Point', ['x', 'y']);
    reg.seedTypes('Point', ['bigint', null]);
    expect(() => reg.instantiate('Point', [1n, 'hello'])).not.toThrow();
  });

  it('does not overwrite already-seeded types', () => {
    const reg = new TypeRegistry();
    reg.registerPlain('Point', ['x', 'y']);
    reg.seedTypes('Point', ['bigint', 'bigint']);
    reg.seedTypes('Point', ['string', 'string']);
    expect(() => reg.instantiate('Point', ['x', 'y'])).toThrow('Type mismatch');
  });

  it('does not overwrite runtime-discovered types', () => {
    const reg = new TypeRegistry();
    reg.registerPlain('Point', ['x', 'y']);
    reg.instantiate('Point', [1n, 2n]);
    reg.seedTypes('Point', ['string', 'string']);
    expect(() => reg.instantiate('Point', ['x', 'y'])).toThrow('Type mismatch');
  });

  it('skips generic schemas', () => {
    const reg = new TypeRegistry();
    reg.registerPlain('Box', ['value'], true);
    reg.seedTypes('Box', ['bigint']);
    expect(() => reg.instantiate('Box', [1n])).not.toThrow();
    expect(() => reg.instantiate('Box', ['hello'])).not.toThrow();
  });

  it('seeds union variant schemas', () => {
    const reg = new TypeRegistry();
    reg.registerUnion('Shape', [
      { name: 'Square', fields: ['side'] },
      { name: 'Circle', fields: ['radius'] },
    ]);
    reg.seedTypes('Square', ['bigint']);
    expect(() => reg.instantiate('Square', ['not a number'])).toThrow('Type mismatch');
  });
});

// ─── Full pipeline: static seeding ───────────────────────────────────────────
//
// Note: 'var' is used throughout because 'let' creates lazy thunks that are
// only forced when the value is read.  'var' forces evaluation immediately,
// which is necessary to trigger the type mismatch error at construction time.

describe('Static type seeding via evaluateRecord', () => {
  it('seeds from inferred field types on positional construction', () => {
    const msg = runExpectError(`
      type Point = { x, y };
      var p1 = Point { 1, 2 };
      var p2 = Point { "hello", 2 };
    `);
    expect(msg).toMatch(/Type mismatch in Point/);
  });

  it('seeds from inferred field types on named-field construction', () => {
    const msg = runExpectError(`
      type Point = { x, y };
      var p1 = Point { x = 1, y = 2 };
      var p2 = Point { x = "hello", y = 2 };
    `);
    expect(msg).toMatch(/Type mismatch in Point/);
  });

  it('seeds union variant field types', () => {
    const msg = runExpectError(`
      type Shape = { | Square: side | Circle: radius }
      var s1 = Square { 10 };
      var s2 = Square { "ten" };
    `);
    expect(msg).toMatch(/Type mismatch in Square/);
  });

  it('catches mismatch on second construction via seeded schema', () => {
    // p1 seeds the schema as Int. p2 is the first runtime construction but
    // finds the schema already seeded — so it's caught.
    const msg = runExpectError(`
      type Wrapper = { value };
      var p1 = Wrapper { 42 };
      var p2 = Wrapper { "oops" };
    `);
    expect(msg).toMatch(/Type mismatch in Wrapper/);
  });

  it('does not seed partial types — falls through to runtime discovery', () => {
    // identity returns Unknown — seeding is skipped, runtime discovers types.
    expect(() => run(`
      type Box = { value };
      function identity(x) { return x; }
      var b1 = Box { identity(1) };
      var b2 = Box { identity(2) };
    `)).not.toThrow();
  });

  it('does not flag valid heterogeneous use of different variants', () => {
    expect(() => run(`
      type Shape = { | Square: side | Circle: radius }
      var s = Square { 10 };
      var c = Circle { "big" };
    `)).not.toThrow();
  });

  it('seeding works correctly for Str fields', () => {
    const msg = runExpectError(`
      type Named = { name };
      var n1 = Named { "alice" };
      var n2 = Named { 42 };
    `);
    expect(msg).toMatch(/Type mismatch in Named/);
  });

  it('seeding works correctly for Bool fields', () => {
    const msg = runExpectError(`
      type Flag = { value };
      var f1 = Flag { true };
      var f2 = Flag { 42 };
    `);
    expect(msg).toMatch(/Type mismatch in Flag/);
  });

  it('seeding works correctly for List fields', () => {
    const msg = runExpectError(`
      type Container = { items };
      var c1 = Container { [1, 2, 3] };
      var c2 = Container { ["a", "b"] };
    `);
    expect(msg).toMatch(/Type mismatch in Container/);
  });

  it('does NOT flag a valid Float field as a mismatch (regression test: getValueType used to return \'float\' for a JS number while pfunTypeToRuntimeType returned \'number\' for the same conceptual Float type — the vocabulary mismatch made the FIRST construction of any Float-field record via a forced let/var binding spuriously fail)', () => {
    expect(() => run(`
      type Box = { value };
      var b1 = Box { 5.5 };
      var b2 = Box { 7.5 };
    `)).not.toThrow();
  });

  it('seeding works correctly for Float fields (genuine mismatch is still caught)', () => {
    const msg = runExpectError(`
      type Box = { value };
      var b1 = Box { 5.5 };
      var b2 = Box { "oops" };
    `);
    expect(msg).toMatch(/Type mismatch in Box/);
  });

  it('does not seed when field type is Unknown — no false positives', () => {
    expect(() => run(`
      type Box = { value };
      function wrap(x) { return Box { x }; }
      var a = wrap(1);
      var b = wrap(2);
    `)).not.toThrow();
  });

  it('seeding works for the second construction even without the first being forced', () => {
    // p1 is a lazy let — never forced. But seedTypesFromAST pre-seeds from
    // p1's static annotations before any evaluation. p2 is var (eager) and
    // should be caught.
    const msg = runExpectError(`
      type Point = { x, y };
      let p1 = Point { 1, 2 };
      var p2 = Point { "hello", 2 };
    `);
    expect(msg).toMatch(/Type mismatch in Point/);
  });
});
