// src/foreignlib_test.ts
// Tests for the JavaScript FFI (foreignlib.ts).
//
// Covers:
//   - PfunForeign boxing / materialization
//   - All effect ops: foreignRequire, foreignGlobal, foreignGet, foreignSet,
//     foreignCall, foreignInvoke, foreignNew, foreignDelete, foreignTypeof,
//     foreignAwait
//   - foreignCallback: wrapping a Pfun proc as a JS function
//   - foreignApply: applying a decoder to a live handle
//   - All leaf decoders: dForeign, dUnit, dBool, dInt, dFloat, dStr
//   - All combinators: dList, dOption, dDict, dField, dMap, dAndThen, dOneOf
//   - Purity gate: effect ops rejected in pure context
//   - Error model: js_exception, marshal_error, type_error

import { Interpreter, ModuleLoader, PfunFunction, PfunDict, NativeFunction, Environment } from '../interpreter';
import { stdlibFunctions, stdlibTypes } from '../library';
import { mutStructuresFunctions, mutStructuresTypes } from '../mutStructures';
import { iolibFunctions } from '../iolib';
import { foreignlibFunctions, foreignlibTypes, PfunForeign } from '../foreignlib';

// ─── Harness ─────────────────────────────────────────────────────────────────

function makeInterp(): Interpreter {
  const loader = new ModuleLoader('.');
  const interp = new Interpreter(loader, '.');
  interp.registerLibrary(stdlibFunctions, stdlibTypes);
  interp.registerLibrary(mutStructuresFunctions, mutStructuresTypes);
  loader.registerBuiltin('io',      iolibFunctions);
  loader.registerBuiltin('foreign', foreignlibFunctions, foreignlibTypes);
  return interp;
}

/** Run a Pfun program string, returning the interpreter for inspection. */
async function run(src: string): Promise<Interpreter> {
  const interp = makeInterp();
  await interp.interpretAsync([
    // Parse just the statements
    ...require('./parser').new_Parser(src).parseProgram().statements
  ]);
  return interp;
}

/** Evaluate a Pfun expression via `let __result = <expr>;` and return the value. */
async function evalExpr(src: string): Promise<any> {
  const interp = makeInterp();
  const stmts = parseStmts(`import * from "foreign";\nlet __result = ${src};`);
  await interp.interpretAsync(stmts);
  return interp['env'].get('__result');  // access via private env — acceptable in tests
}

function parseStmts(src: string): any[] {
  const { Lexer }  = require('./lexer');
  const { Parser } = require('./parser');
  const lexer  = new Lexer(src);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens, src);
  return parser.parse();
}

function makeProcInterp(body: string): { proc: PfunFunction; interp: Interpreter } {
  const interp = makeInterp();
  // Build a minimal procedure manually for callback tests
  const stmts = parseStmts(`import * from "foreign";`);
  // We use a pure env; effect tests pass a non-pure interp
  const proc = new PfunFunction('testProc', ['x'], parseStmts(body), interp['env'], 'procedure');
  return { proc, interp };
}

/** Directly call a named foreign function with a non-pure interpreter. */
function callForeign(name: string, args: any[], interp?: Interpreter): any {
  const i = interp ?? makeInterp();
  i.inPureContext = false;
  const fn = foreignlibFunctions.find(f => f.name === name)!;
  expect(fn).toBeDefined();
  return fn.fn(args.map(a => a), i);
}

function fok(value: any) { return expect.objectContaining({ __type: 'FOk', value }); }
function ferr(kind: string) { return expect.objectContaining({ __type: 'FErr', kind }); }

// ─── PfunForeign class ────────────────────────────────────────────────────────

describe('PfunForeign', () => {
  it('boxes a JS value', () => {
    const obj = { x: 1 };
    const f = new PfunForeign(obj);
    expect(f.value).toBe(obj);
  });

  it('is distinct from plain JS objects', () => {
    const f = new PfunForeign({ x: 1 });
    expect(f instanceof PfunForeign).toBe(true);
    expect(Array.isArray(f)).toBe(false);
  });
});

// ─── Purity gate ─────────────────────────────────────────────────────────────

describe('purity gate', () => {
  const pureEffectOps = [
    'foreignRequire', 'foreignGlobal', 'foreignGet', 'foreignSet',
    'foreignCall', 'foreignInvoke', 'foreignNew', 'foreignDelete',
    'foreignTypeof', 'foreignAwait', 'foreignCallback', 'foreignApply',
  ];

  for (const name of pureEffectOps) {
    it(`${name} throws inside a pure function`, () => {
      const interp = makeInterp();
      interp.inPureContext = true;
      const fn = foreignlibFunctions.find(f => f.name === name)!;
      expect(() => fn.fn([], interp)).toThrow('FFI calls are not allowed in pure functions');
    });
  }
});

// ─── foreignRequire ───────────────────────────────────────────────────────────

describe('foreignRequire', () => {
  it('loads a built-in Node module', () => {
    const result = callForeign('foreignRequire', ['path']);
    expect(result.__type).toBe('FOk');
    expect(result.value).toBeInstanceOf(PfunForeign);
    expect(typeof result.value.value.join).toBe('function');
  });

  it('returns FErr for an unknown module', () => {
    const result = callForeign('foreignRequire', ['__no_such_module__']);
    expect(result.__type).toBe('FErr');
    expect(result.kind).toBe('js_exception');
  });

  it('returns type_error for a non-string argument', () => {
    const result = callForeign('foreignRequire', [42n]);
    expect(result.__type).toBe('FErr');
    expect(result.kind).toBe('type_error');
  });
});

// ─── foreignGlobal ────────────────────────────────────────────────────────────

describe('foreignGlobal', () => {
  it('accesses Math', () => {
    const result = callForeign('foreignGlobal', ['Math']);
    expect(result.__type).toBe('FOk');
    expect(result.value).toBeInstanceOf(PfunForeign);
    expect(result.value.value).toBe(Math);
  });

  it('returns marshal_error for undefined global', () => {
    const result = callForeign('foreignGlobal', ['__definitely_undefined__']);
    expect(result.__type).toBe('FErr');
    expect(result.kind).toBe('marshal_error');
  });

  it('materializes a number global directly', () => {
    (globalThis as any).__pfun_test_num = 42;
    const result = callForeign('foreignGlobal', ['__pfun_test_num']);
    expect(result.__type).toBe('FOk');
    expect(result.value).toBe(42);
    delete (globalThis as any).__pfun_test_num;
  });
});

// ─── foreignGet ───────────────────────────────────────────────────────────────

describe('foreignGet', () => {
  it('reads a string property from a handle', () => {
    const obj = new PfunForeign({ name: 'Alice' });
    const result = callForeign('foreignGet', [obj, 'name']);
    expect(result).toEqual(fok('Alice'));
  });

  it('reads a number property (materialized as JS number)', () => {
    const obj = new PfunForeign({ count: 7 });
    const result = callForeign('foreignGet', [obj, 'count']);
    expect(result).toEqual(fok(7));
  });

  it('reads a nested object as a PfunForeign handle', () => {
    const inner = { x: 1 };
    const obj = new PfunForeign({ nested: inner });
    const result = callForeign('foreignGet', [obj, 'nested']);
    expect(result.__type).toBe('FOk');
    expect(result.value).toBeInstanceOf(PfunForeign);
    expect(result.value.value).toBe(inner);
  });

  it('reads undefined property as null (Pfun nil)', () => {
    const obj = new PfunForeign({});
    const result = callForeign('foreignGet', [obj, 'missing']);
    expect(result).toEqual(fok(null));
  });

  it('returns type_error for non-string prop', () => {
    const obj = new PfunForeign({ x: 1 });
    const result = callForeign('foreignGet', [obj, 42n]);
    expect(result.__type).toBe('FErr');
    expect(result.kind).toBe('type_error');
  });
});

// ─── foreignSet ───────────────────────────────────────────────────────────────

describe('foreignSet', () => {
  it('sets a property on a JS object', () => {
    const target: any = {};
    const handle = new PfunForeign(target);
    const result = callForeign('foreignSet', [handle, 'x', 99n]);
    expect(result).toEqual(fok(null));
    expect(target.x).toBe(99n);
  });

  it('overwrites an existing property', () => {
    const target: any = { x: 1 };
    const handle = new PfunForeign(target);
    callForeign('foreignSet', [handle, 'x', 'hello']);
    expect(target.x).toBe('hello');
  });
});

// ─── foreignCall ─────────────────────────────────────────────────────────────

describe('foreignCall', () => {
  it('calls a method and materializes a string result', () => {
    const obj = new PfunForeign({ greet: (name: string) => `Hello, ${name}!` });
    const result = callForeign('foreignCall', [obj, 'greet', ['World']]);
    expect(result).toEqual(fok('Hello, World!'));
  });

  it('calls a method with no args', () => {
    const obj = new PfunForeign({ getValue: () => 42 });
    const result = callForeign('foreignCall', [obj, 'getValue', []]);
    expect(result).toEqual(fok(42));
  });

  it('returns js_exception when method throws', () => {
    const obj = new PfunForeign({ boom: () => { throw new Error('kapow'); } });
    const result = callForeign('foreignCall', [obj, 'boom', []]);
    expect(result.__type).toBe('FErr');
    expect(result.kind).toBe('js_exception');
    expect(result.message).toContain('kapow');
  });

  it('returns type_error when method does not exist', () => {
    const obj = new PfunForeign({});
    const result = callForeign('foreignCall', [obj, 'nonexistent', []]);
    expect(result.__type).toBe('FErr');
    expect(result.kind).toBe('type_error');
  });

  it('passes PfunForeign args as their .value', () => {
    let received: any;
    const obj = new PfunForeign({ capture: (x: any) => { received = x; return null; } });
    const inner = new PfunForeign({ id: 'token' });
    callForeign('foreignCall', [obj, 'capture', [inner]]);
    expect(received).toEqual({ id: 'token' });
  });
});

// ─── foreignInvoke ───────────────────────────────────────────────────────────

describe('foreignInvoke', () => {
  it('calls a function handle directly', () => {
    const fn = new PfunForeign((a: number, b: number) => a + b);
    const result = callForeign('foreignInvoke', [fn, [3, 4]]);
    expect(result).toEqual(fok(7));
  });

  it('returns js_exception on throw', () => {
    const fn = new PfunForeign(() => { throw new TypeError('oops'); });
    const result = callForeign('foreignInvoke', [fn, []]);
    expect(result.__type).toBe('FErr');
    expect(result.kind).toBe('js_exception');
  });

  it('returns type_error when handle is not a function', () => {
    const obj = new PfunForeign({ x: 1 });
    const result = callForeign('foreignInvoke', [obj, []]);
    expect(result.__type).toBe('FErr');
    expect(result.kind).toBe('type_error');
  });
});

// ─── foreignNew ───────────────────────────────────────────────────────────────

describe('foreignNew', () => {
  it('constructs a Date', () => {
    const dateCtor = new PfunForeign(Date);
    const result = callForeign('foreignNew', [dateCtor, ['2024-01-01']]);
    expect(result.__type).toBe('FOk');
    expect(result.value).toBeInstanceOf(PfunForeign);
    expect(result.value.value).toBeInstanceOf(Date);
  });

  it('returns js_exception when constructor throws', () => {
    class Exploding { constructor() { throw new Error('boom'); } }
    const ctor = new PfunForeign(Exploding);
    const result = callForeign('foreignNew', [ctor, []]);
    expect(result.__type).toBe('FErr');
    expect(result.kind).toBe('js_exception');
  });
});

// ─── foreignDelete ────────────────────────────────────────────────────────────

describe('foreignDelete', () => {
  it('removes a property', () => {
    const target: any = { x: 1, y: 2 };
    const handle = new PfunForeign(target);
    const result = callForeign('foreignDelete', [handle, 'x']);
    expect(result).toEqual(fok(null));
    expect('x' in target).toBe(false);
    expect(target.y).toBe(2);
  });
});

// ─── foreignTypeof ────────────────────────────────────────────────────────────

describe('foreignTypeof', () => {
  const cases: [any, string, string][] = [
    [new PfunForeign({ x: 1 }),   'object',    'object handle'],
    [new PfunForeign(() => {}),   'function',  'function handle'],
    ['hello',                      'string',    'string'],
    [42n,                          'bigint',    'bigint'],
    [true,                         'boolean',   'boolean'],
    [3.14,                         'number',    'number'],
    [null,                         'object',    'null'],
  ];

  for (const [input, expected, label] of cases) {
    it(`typeof ${label} => "${expected}"`, () => {
      const result = callForeign('foreignTypeof', [input]);
      expect(result).toEqual(fok(expected));
    });
  }
});

// ─── foreignAwait ─────────────────────────────────────────────────────────────

describe('foreignAwait', () => {
  it('resolves a Promise to its value', async () => {
    const promise = Promise.resolve(42);
    const handle = new PfunForeign(promise);
    const resultPromise = callForeign('foreignAwait', [handle]);
    const result = await resultPromise;
    expect(result).toEqual(fok(42));
  });

  it('returns FErr when Promise rejects', async () => {
    const promise = Promise.reject(new Error('async fail'));
    const handle = new PfunForeign(promise);
    const result = await callForeign('foreignAwait', [handle]);
    expect(result.__type).toBe('FErr');
    expect(result.kind).toBe('js_exception');
    expect(result.message).toContain('async fail');
  });

  it('returns type_error for a non-Promise handle', () => {
    const handle = new PfunForeign({ x: 1 });
    const result = callForeign('foreignAwait', [handle]);
    expect(result.__type).toBe('FErr');
    expect(result.kind).toBe('type_error');
  });
});

// ─── Decoder: dForeign ───────────────────────────────────────────────────────

describe('dForeign', () => {
  function getDForeign(): NativeFunction {
    const interp = makeInterp();
    interp.inPureContext = false;
    return foreignlibFunctions.find(f => f.name === 'dForeign')!.fn([], interp) as NativeFunction;
  }

  it('wraps a plain value in PfunForeign', () => {
    const d = getDForeign();
    const result = d.execute([42], null as any);
    expect(result.__type).toBe('FOk');
    expect(result.value).toBeInstanceOf(PfunForeign);
    expect(result.value.value).toBe(42);
  });

  it('keeps an existing PfunForeign as-is', () => {
    const d = getDForeign();
    const handle = new PfunForeign({ x: 1 });
    const result = d.execute([handle], null as any);
    expect(result.__type).toBe('FOk');
    expect(result.value).toBe(handle); // same object
  });

  it('never fails', () => {
    const d = getDForeign();
    for (const v of [null, undefined, 'str', 42n, true, new PfunForeign({})]) {
      expect(d.execute([v], null as any).__type).toBe('FOk');
    }
  });
});

// ─── Decoder: dUnit ──────────────────────────────────────────────────────────

describe('dUnit', () => {
  function getDUnit(): NativeFunction {
    const interp = makeInterp();
    interp.inPureContext = false;
    return foreignlibFunctions.find(f => f.name === 'dUnit')!.fn([], interp) as NativeFunction;
  }

  it('succeeds and returns null for any input', () => {
    const d = getDUnit();
    for (const v of [null, 'anything', 42, new PfunForeign({})]) {
      const r = d.execute([v], null as any);
      expect(r).toEqual(fok(null));
    }
  });
});

// ─── Decoder: dBool ──────────────────────────────────────────────────────────

describe('dBool', () => {
  function getD(): NativeFunction {
    const interp = makeInterp();
    interp.inPureContext = false;
    return foreignlibFunctions.find(f => f.name === 'dBool')!.fn([], interp) as NativeFunction;
  }

  it('decodes true', () => expect(getD().execute([true], null as any)).toEqual(fok(true)));
  it('decodes false', () => expect(getD().execute([false], null as any)).toEqual(fok(false)));
  it('fails on string', () => expect(getD().execute(['true'], null as any).__type).toBe('FErr'));
  it('fails on number', () => expect(getD().execute([1], null as any).__type).toBe('FErr'));
  it('fails on handle', () => expect(getD().execute([new PfunForeign({})], null as any).__type).toBe('FErr'));
});

// ─── Decoder: dInt ───────────────────────────────────────────────────────────

describe('dInt', () => {
  function getD(): NativeFunction {
    const interp = makeInterp();
    interp.inPureContext = false;
    return foreignlibFunctions.find(f => f.name === 'dInt')!.fn([], interp) as NativeFunction;
  }

  it('accepts bigint', () => expect(getD().execute([42n], null as any)).toEqual(fok(42n)));
  it('converts integer number to bigint', () => {
    const r = getD().execute([7], null as any);
    expect(r).toEqual(fok(7n));
  });
  it('rejects non-integer float', () => {
    expect(getD().execute([3.14], null as any).__type).toBe('FErr');
  });
  it('rejects string', () => expect(getD().execute(['7'], null as any).__type).toBe('FErr'));
});

// ─── Decoder: dFloat ─────────────────────────────────────────────────────────

describe('dFloat', () => {
  function getD(): NativeFunction {
    const interp = makeInterp();
    interp.inPureContext = false;
    return foreignlibFunctions.find(f => f.name === 'dFloat')!.fn([], interp) as NativeFunction;
  }

  it('accepts number', () => expect(getD().execute([3.14], null as any)).toEqual(fok(3.14)));
  it('converts bigint to number', () => expect(getD().execute([7n], null as any)).toEqual(fok(7)));
  it('rejects string', () => expect(getD().execute(['3.14'], null as any).__type).toBe('FErr'));
});

// ─── Decoder: dStr ───────────────────────────────────────────────────────────

describe('dStr', () => {
  function getD(): NativeFunction {
    const interp = makeInterp();
    interp.inPureContext = false;
    return foreignlibFunctions.find(f => f.name === 'dStr')!.fn([], interp) as NativeFunction;
  }

  it('accepts string', () => expect(getD().execute(['hello'], null as any)).toEqual(fok('hello')));
  it('rejects number', () => expect(getD().execute([42], null as any).__type).toBe('FErr'));
  it('rejects handle', () => expect(getD().execute([new PfunForeign({})], null as any).__type).toBe('FErr'));
});

// ─── Decoder: dList ──────────────────────────────────────────────────────────

describe('dList', () => {
  function makeDList(innerName: string): NativeFunction {
    const interp = makeInterp();
    interp.inPureContext = false;
    const innerFn = foreignlibFunctions.find(f => f.name === innerName)!;
    const inner   = innerFn.fn([], interp) as NativeFunction;
    return foreignlibFunctions.find(f => f.name === 'dList')!.fn([inner], interp) as NativeFunction;
  }

  it('decodes an array of strings', () => {
    const d = makeDList('dStr');
    const r = d.execute([['a', 'b', 'c']], null as any);
    expect(r).toEqual(fok(['a', 'b', 'c']));
  });

  it('decodes an array of integers', () => {
    const d = makeDList('dInt');
    const r = d.execute([[1, 2, 3]], null as any);
    expect(r).toEqual(fok([1n, 2n, 3n]));
  });

  it('fails if any element fails', () => {
    const d = makeDList('dInt');
    const r = d.execute([[1, 'oops', 3]], null as any);
    expect(r.__type).toBe('FErr');
    expect(r.kind).toBe('marshal_error');
  });

  it('fails on non-array', () => {
    const d = makeDList('dStr');
    expect(d.execute(['not an array'], null as any).__type).toBe('FErr');
  });

  it('handles empty array', () => {
    const d = makeDList('dStr');
    expect(d.execute([[]], null as any)).toEqual(fok([]));
  });
});

// ─── Decoder: dOption ────────────────────────────────────────────────────────

describe('dOption', () => {
  function makeDOpt(innerName: string): NativeFunction {
    const interp = makeInterp();
    interp.inPureContext = false;
    const inner = foreignlibFunctions.find(f => f.name === innerName)!.fn([], interp) as NativeFunction;
    return foreignlibFunctions.find(f => f.name === 'dOption')!.fn([inner], interp) as NativeFunction;
  }

  it('null → None', () => {
    const d = makeDOpt('dStr');
    const r = d.execute([null], null as any);
    expect(r).toEqual(fok({ __type: 'None', __union: 'Option' }));
  });

  it('undefined → None', () => {
    const d = makeDOpt('dStr');
    const r = d.execute([undefined], null as any);
    expect(r).toEqual(fok({ __type: 'None', __union: 'Option' }));
  });

  it('present value → Some(decoded)', () => {
    const d = makeDOpt('dStr');
    const r = d.execute(['hello'], null as any);
    expect(r).toEqual(fok({ __type: 'Some', __union: 'Option', value: 'hello' }));
  });

  it('propagates inner decode failure', () => {
    const d = makeDOpt('dInt');
    const r = d.execute(['not a number'], null as any);
    expect(r.__type).toBe('FErr');
  });
});

// ─── Decoder: dDict ──────────────────────────────────────────────────────────

describe('dDict', () => {
  function makeDDict(innerName: string): NativeFunction {
    const interp = makeInterp();
    interp.inPureContext = false;
    const inner = foreignlibFunctions.find(f => f.name === innerName)!.fn([], interp) as NativeFunction;
    return foreignlibFunctions.find(f => f.name === 'dDict')!.fn([inner], interp) as NativeFunction;
  }

  it('decodes a plain object with string values', () => {
    const d = makeDDict('dStr');
    const r = d.execute([{ a: 'x', b: 'y' }], null as any);
    expect(r.__type).toBe('FOk');
    expect(r.value).toBeInstanceOf(PfunDict);
    expect(r.value.entries.get('s:a')).toBe('x');
    expect(r.value.entries.get('s:b')).toBe('y');
  });

  it('fails on non-object', () => {
    const d = makeDDict('dStr');
    expect(d.execute(['not an object'], null as any).__type).toBe('FErr');
  });

  it('propagates inner decode failure', () => {
    const d = makeDDict('dInt');
    expect(d.execute([{ a: 'not a number' }], null as any).__type).toBe('FErr');
  });

  it('unwraps PfunForeign holding a plain object', () => {
    const d = makeDDict('dStr');
    const r = d.execute([new PfunForeign({ k: 'v' })], null as any);
    expect(r.__type).toBe('FOk');
    expect(r.value).toBeInstanceOf(PfunDict);
  });
});

// ─── Decoder: dField ─────────────────────────────────────────────────────────

describe('dField', () => {
  function makeDField(key: string, innerName: string): NativeFunction {
    const interp = makeInterp();
    interp.inPureContext = false;
    const inner = foreignlibFunctions.find(f => f.name === innerName)!.fn([], interp) as NativeFunction;
    return foreignlibFunctions.find(f => f.name === 'dField')!.fn([key, inner], interp) as NativeFunction;
  }

  it('reads a specific property and decodes it', () => {
    const d = makeDField('name', 'dStr');
    const r = d.execute([{ name: 'Alice', age: 30 }], null as any);
    expect(r).toEqual(fok('Alice'));
  });

  it('reads through a PfunForeign handle', () => {
    const d = makeDField('x', 'dInt');
    const r = d.execute([new PfunForeign({ x: 7 })], null as any);
    expect(r).toEqual(fok(7n));
  });

  it('fails if the property has the wrong type', () => {
    const d = makeDField('count', 'dInt');
    const r = d.execute([{ count: 'not a number' }], null as any);
    expect(r.__type).toBe('FErr');
  });

  it('fails on null object', () => {
    const d = makeDField('x', 'dStr');
    expect(d.execute([null], null as any).__type).toBe('FErr');
  });
});

// ─── Decoder: dMap ───────────────────────────────────────────────────────────

describe('dMap', () => {
  it('transforms a successful decode', () => {
    const interp = makeInterp();
    interp.inPureContext = false;
    const dStrDec = foreignlibFunctions.find(f => f.name === 'dStr')!.fn([], interp) as NativeFunction;
    // A PfunFunction that appends "!" — built from a NativeFunction wrapper via PfunFunction
    // Use a NativeFunction directly as a stand-in for the mapping fn via a PfunFunction shell
    const addBang = new NativeFunction((args: any[]) => args[0] + '!', 1);
    // dMap requires a PfunFunction, so we test the inner makeDMap logic indirectly:
    // wrap addBang as a PfunFunction body expression by constructing a native proc shell
    const pfunAddBang = new PfunFunction(
      'addBang', ['s'],
      // body: a single native call expression evaluated by having the native fn in closure
      [] as any,   // empty body — we override execute
      interp['env'], 'function'
    );
    // Override execute to call our native directly
    pfunAddBang.execute = (args: any[], _interp: Interpreter) => args[0] + '!';

    const dMapped = foreignlibFunctions.find(f => f.name === 'dMap')!
      .fn([pfunAddBang, dStrDec], interp) as NativeFunction;
    const r = dMapped.execute(['hello'], interp);
    expect(r).toEqual(fok('hello!'));
  });

  it('propagates inner decode failure without calling f', () => {
    const interp = makeInterp();
    interp.inPureContext = false;
    const dIntDec = foreignlibFunctions.find(f => f.name === 'dInt')!.fn([], interp) as NativeFunction;
    let fCalled = false;
    const f = new PfunFunction(null, ['x'], [] as any, interp['env'], 'function');
    f.execute = (_args: any[], _i: Interpreter) => { fCalled = true; return _args[0]; };
    const dMapped = foreignlibFunctions.find(f => f.name === 'dMap')!.fn([f, dIntDec], interp) as NativeFunction;
    const r = dMapped.execute(['not a number'], interp);
    expect(r.__type).toBe('FErr');
    expect(fCalled).toBe(false);
  });
});

// ─── Decoder: dOneOf ─────────────────────────────────────────────────────────

describe('dOneOf', () => {
  it('returns first successful decoder', () => {
    const interp = makeInterp();
    interp.inPureContext = false;
    const dBool  = foreignlibFunctions.find(f => f.name === 'dBool')!.fn([], interp) as NativeFunction;
    const dStr   = foreignlibFunctions.find(f => f.name === 'dStr')!.fn([], interp) as NativeFunction;
    const d = foreignlibFunctions.find(f => f.name === 'dOneOf')!
      .fn([[dBool, dStr]], interp) as NativeFunction;
    expect(d.execute([true], interp)).toEqual(fok(true));
    expect(d.execute(['hello'], interp)).toEqual(fok('hello'));
  });

  it('fails if all decoders fail', () => {
    const interp = makeInterp();
    interp.inPureContext = false;
    const dBool  = foreignlibFunctions.find(f => f.name === 'dBool')!.fn([], interp) as NativeFunction;
    const dInt   = foreignlibFunctions.find(f => f.name === 'dInt')!.fn([], interp) as NativeFunction;
    const d = foreignlibFunctions.find(f => f.name === 'dOneOf')!
      .fn([[dBool, dInt]], interp) as NativeFunction;
    expect(d.execute(['not bool or int'], interp).__type).toBe('FErr');
  });
});

// ─── foreignCallback ─────────────────────────────────────────────────────────

describe('foreignCallback', () => {
  it('returns a ForeignResult<Foreign> wrapping a JS function', () => {
    const interp = makeInterp();
    interp.inPureContext = false;
    const proc = new PfunFunction(null, ['x'], [] as any, interp['env'], 'procedure');
    const dListForeign = (() => {
      const dForeignDec = foreignlibFunctions.find(f => f.name === 'dForeign')!.fn([], interp) as NativeFunction;
      return foreignlibFunctions.find(f => f.name === 'dList')!.fn([dForeignDec], interp) as NativeFunction;
    })();
    const result = foreignlibFunctions.find(f => f.name === 'foreignCallback')!
      .fn([proc, dListForeign], interp);
    expect(result.__type).toBe('FOk');
    expect(result.value).toBeInstanceOf(PfunForeign);
    expect(typeof result.value.value).toBe('function');
  });

  it('rejects a pure function (not a procedure)', () => {
    const interp = makeInterp();
    interp.inPureContext = false;
    const fn = new PfunFunction(null, ['x'], [] as any, interp['env'], 'function');
    const d  = foreignlibFunctions.find(f => f.name === 'dForeign')!.fn([], interp) as NativeFunction;
    const result = foreignlibFunctions.find(f => f.name === 'foreignCallback')!.fn([fn, d], interp);
    expect(result.__type).toBe('FErr');
    expect(result.kind).toBe('type_error');
    expect(result.message).toContain('procedure');
  });
});

// ─── foreignApply ────────────────────────────────────────────────────────────

describe('foreignApply', () => {
  it('applies dStr to a materialized string handle', () => {
    const interp = makeInterp();
    interp.inPureContext = false;
    const dStr  = foreignlibFunctions.find(f => f.name === 'dStr')!.fn([], interp) as NativeFunction;
    // foreignApply receives handle + decoder
    const result = foreignlibFunctions.find(f => f.name === 'foreignApply')!
      .fn(['hello', dStr], interp);
    expect(result).toEqual(fok('hello'));
  });

  it('materializes a PfunForeign string before decoding', () => {
    const interp = makeInterp();
    interp.inPureContext = false;
    const dStr   = foreignlibFunctions.find(f => f.name === 'dStr')!.fn([], interp) as NativeFunction;
    const handle = new PfunForeign('world');
    const result = foreignlibFunctions.find(f => f.name === 'foreignApply')!
      .fn([handle, dStr], interp);
    expect(result).toEqual(fok('world'));
  });

  it('fails cleanly when decoder mismatches', () => {
    const interp = makeInterp();
    interp.inPureContext = false;
    const dInt   = foreignlibFunctions.find(f => f.name === 'dInt')!.fn([], interp) as NativeFunction;
    const handle = new PfunForeign('not a number');
    const result = foreignlibFunctions.find(f => f.name === 'foreignApply')!
      .fn([handle, dInt], interp);
    expect(result.__type).toBe('FErr');
    expect(result.kind).toBe('marshal_error');
  });
});

// ─── ForeignResult type registration ─────────────────────────────────────────

describe('foreignlibTypes', () => {
  it('registers ForeignResult as a generic union', () => {
    const ft = foreignlibTypes.find(t => t.kind === 'union' && t.name === 'ForeignResult');
    expect(ft).toBeDefined();
    expect((ft as any).generic).toBe(true);
    const variants = (ft as any).variants.map((v: any) => v.name);
    expect(variants).toContain('FOk');
    expect(variants).toContain('FErr');
  });

  it('FErr has kind and message fields', () => {
    const ft = foreignlibTypes.find(t => t.kind === 'union' && t.name === 'ForeignResult') as any;
    const ferr = ft.variants.find((v: any) => v.name === 'FErr');
    expect(ferr.fields).toEqual(['kind', 'message']);
  });
});

// ─── Integration: path module via foreignRequire ──────────────────────────────

describe('integration: Node path module', () => {
  it('calls path.join via foreignCall', () => {
    const interp = makeInterp();
    interp.inPureContext = false;
    const callFn = (name: string, args: any[]) =>
      foreignlibFunctions.find(f => f.name === name)!.fn(args, interp);

    const pathMod = callFn('foreignRequire', ['path']);
    expect(pathMod.__type).toBe('FOk');

    const joined = callFn('foreignCall', [pathMod.value, 'join', ['usr', 'local', 'bin']]);
    expect(joined.__type).toBe('FOk');
    // path.join result is a string
    expect(typeof joined.value).toBe('string');
    expect(joined.value).toContain('usr');
    expect(joined.value).toContain('local');
    expect(joined.value).toContain('bin');
  });

  it('reads path.sep as a string property', () => {
    const interp = makeInterp();
    interp.inPureContext = false;
    const callFn = (name: string, args: any[]) =>
      foreignlibFunctions.find(f => f.name === name)!.fn(args, interp);

    const pathMod = callFn('foreignRequire', ['path']);
    const sep = callFn('foreignGet', [pathMod.value, 'sep']);
    expect(sep.__type).toBe('FOk');
    expect(typeof sep.value).toBe('string');
    expect(sep.value === '/' || sep.value === '\\').toBe(true);
  });
});

// ─── Integration: Math global ─────────────────────────────────────────────────

describe('integration: Math global', () => {
  it('calls Math.max via foreignCall', () => {
    const interp = makeInterp();
    interp.inPureContext = false;
    const callFn = (name: string, args: any[]) =>
      foreignlibFunctions.find(f => f.name === name)!.fn(args, interp);

    const math = callFn('foreignGlobal', ['Math']);
    expect(math.__type).toBe('FOk');
    const result = callFn('foreignCall', [math.value, 'max', [3, 7, 2]]);
    expect(result).toEqual(fok(7));
  });
});
