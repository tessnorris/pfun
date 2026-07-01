// src/foreignlib.ts
// JavaScript FFI for Pfun.
// Register with: loader.registerBuiltin('foreign', foreignlibFunctions, foreignlibTypes)
// Use with:      import * from "foreign";
//
// ─── Overview ────────────────────────────────────────────────────────────────
//
// This module provides a two-layer FFI:
//
//   Layer 1 — Effect ops (all proc-only, all returning ForeignResult):
//     foreignRequire(path)               load a Node module by path
//     foreignGlobal(name)                access a JS global (Math, Buffer, …)
//     foreignGet(handle, prop)           property read
//     foreignSet(handle, prop, value)    property write  → ForeignResult<unit>
//     foreignCall(handle, method, args)  method call     → ForeignResult<Foreign>
//     foreignInvoke(fn, args)            function call   → ForeignResult<Foreign>
//     foreignNew(ctor, args)             constructor     → ForeignResult<Foreign>
//     foreignDelete(handle, prop)        property delete → ForeignResult<unit>
//     foreignTypeof(handle)              typeof          → ForeignResult<Str>
//     foreignAwait(handle)               await a Promise → ForeignResult<Foreign>
//     foreignCallback(proc, argsDecoder) wrap a Pfun proc as a JS function
//
//   Layer 2 — Decoders (pure values, composable):
//     dForeign   identity — never fails, keeps the raw handle
//     dUnit      accept any JS value and return unit (ignore the payload)
//     dBool      JS boolean  → Pfun Bool
//     dInt       JS number (must be integer) or bigint → Pfun Int
//     dFloat     JS number → Pfun Float
//     dStr       JS string  → Pfun Str
//     dList(d)   JS Array, elementwise via d
//     dOption(d) null/undefined → None; otherwise Some via d
//     dDict(d)   plain JS object, values via d
//     dField(k,d) pull property k, decode via d
//     dMap(f,d)  transform a successful decode
//     dAndThen(f,d) decode, then decode again
//     dOneOf(ds) try decoders left to right, return first success
//     dApply(handle, dec) apply a decoder to an already-fetched Foreign
//
// ─── Materialization boundary ─────────────────────────────────────────────────
//
// Numbers, strings, booleans, null, undefined, and plain JS Arrays/objects
// are MATERIALIZED at the boundary: the effect op returns their Pfun
// equivalent directly, and decoders run over inert Pfun values. This keeps
// decoders pure.
//
// Everything else (class instances, DOM nodes, functions, Promises, objects
// with prototypes other than Object.prototype, Symbols) stays as a live
// PfunForeign handle. Decoders applied to a live handle fail with a
// marshaling error unless `dForeign` (which always succeeds) is used.
//
// ─── Error model ─────────────────────────────────────────────────────────────
//
// ForeignResult = { | FOk : value | FErr : kind message }
//
//   kind = "js_exception"  — the JS side threw
//          "marshal_error"  — materialization or decoder type mismatch
//          "type_error"     — wrong argument type passed to an FFI op
//
// ─── Purity ──────────────────────────────────────────────────────────────────
//
// All effect ops (foreignGet, foreignCall, etc.) are proc-only: they check
// inPureContext and throw if called from a pure function. Decoders are
// NativeFunction values registered as nullary (non-curriable) globals and
// combinators — they contain no effects, are composed with pure fn lambdas,
// and may be called from pure code.

import {
  Interpreter,
  RegistryFunction,
  RegistryType,
  PfunFunction,
  NativeFunction,
  PfunDict,
} from './interpreter';

// ─── PfunForeign ─────────────────────────────────────────────────────────────

/**
 * A live JS value that cannot be materialized into a Pfun scalar.
 * Held opaquely; interacted with only through the foreign* ops.
 *
 * The handle table gives each PfunForeign a stable JS-side wrapper
 * identity — required for addEventListener/removeEventListener pairs and
 * any other API that compares function identity.
 */
export class PfunForeign {
  constructor(public readonly value: any) {}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FOK_UNION = 'ForeignResult';

function fok(value: any): any {
  return { __type: 'FOk', __union: FOK_UNION, value };
}

function ferr(kind: string, message: string): any {
  return { __type: 'FErr', __union: FOK_UNION, kind, message };
}

function ferrJs(e: unknown): any {
  const msg = e instanceof Error ? e.message : String(e);
  return ferr('js_exception', msg);
}

function ferrMarshal(msg: string): any {
  return ferr('marshal_error', msg);
}

function ferrType(msg: string): any {
  return ferr('type_error', msg);
}

/**
 * Materialize a JS value into a Pfun value.
 *
 * Scalars are converted to their Pfun equivalents.
 * Arrays are materialized elementwise (shallow recursion).
 * Plain objects (prototype === Object.prototype or null) are left as
 * PfunForeign — use dField/dDict to decode them.
 * Everything else (class instances, functions, Promises, …) is PfunForeign.
 *
 * We keep plain-object materialization as PfunForeign intentionally: a raw
 * object from a JS library may have non-enumerable properties, symbols, or
 * getters, so safe access is through foreignGet rather than field extraction.
 */
function materialize(v: any): any {
  if (v === null || v === undefined) return null; // Pfun nil
  if (typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return v; // stays as JS number (Float)
  if (typeof v === 'string') return v;
  // Arrays: materialize elementwise
  if (Array.isArray(v)) return v.map(materialize);
  // Everything else (including plain objects) stays as a live handle
  return new PfunForeign(v);
}

/** Unwrap a Pfun value to a JS value suitable for passing to JS code. */
function toJs(v: any, interp: Interpreter): any {
  v = interp.force(v);
  if (v instanceof PfunForeign) return v.value;
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'boolean' || typeof v === 'string' ||
      typeof v === 'number' || typeof v === 'bigint') return v;
  // List → JS Array
  if (Array.isArray(v)) return v.map(x => toJs(x, interp));
  // Anything else: pass as-is (records, dicts, etc.)
  return v;
}

/** Like toJs, but converts bigint to Number for JS APIs that don't accept bigint
 *  (Date constructors, Math functions, setter methods, etc.). Used for call args. */
function toJsArg(v: any, interp: Interpreter): any {
  const raw = toJs(v, interp);
  if (typeof raw === 'bigint') return Number(raw);
  if (Array.isArray(raw)) return raw.map(x => (typeof x === 'bigint' ? Number(x) : x));
  return raw;
}

function pureGuard(name: string, interp: Interpreter): void {
  if (interp.inPureContext) {
    throw new Error(
      `Functions cannot use '${name}': FFI calls are not allowed in pure functions.`
    );
  }
}

/** Unwrap a PfunForeign or materialized handle. */
function unwrapHandle(v: any, opName: string): any {
  if (v instanceof PfunForeign) return v.value;
  // Materialized scalars (string, number, boolean, bigint) are valid targets
  // for typeof/get on primitives that have properties in JS (e.g. strings).
  return v;
}

// ─── Decoder type (runtime representation) ───────────────────────────────────
//
// A Decoder is a NativeFunction of arity 1: it takes a Pfun value (which
// may be a PfunForeign or a materialized scalar) and returns a ForeignResult.
// Combinators like dList/dOption are NativeFunctions of arity 1 that take an
// inner decoder and return a new decoder (a NativeFunction of arity 1).
//
// This representation lets decoders be first-class Pfun values, passed to
// foreignCall/etc. as the trailing argument, composed with dMap/dAndThen,
// and called from pure code (they contain no effects — they only inspect their
// argument).

function makeDecoder(fn: (v: any) => any): NativeFunction {
  return new NativeFunction((args) => fn(args[0]), 1);
}

// ─── Leaf decoders ───────────────────────────────────────────────────────────

const dForeignDecoder = makeDecoder((v) => {
  // Always succeeds — wraps a non-Foreign in a PfunForeign if needed
  if (v instanceof PfunForeign) return fok(v);
  return fok(new PfunForeign(v));
});

const dUnitDecoder = makeDecoder((_v) => fok(null));

const dBoolDecoder = makeDecoder((v) => {
  if (typeof v === 'boolean') return fok(v);
  if (v instanceof PfunForeign) return ferrMarshal(`Expected boolean, got live handle`);
  return ferrMarshal(`Expected boolean, got ${typeof v}`);
});

const dIntDecoder = makeDecoder((v) => {
  if (typeof v === 'bigint') return fok(v);
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) return ferrMarshal(`Expected integer, got non-integer float ${v}`);
    return fok(BigInt(v));
  }
  if (v instanceof PfunForeign) return ferrMarshal(`Expected integer, got live handle`);
  return ferrMarshal(`Expected integer, got ${typeof v}`);
});

const dFloatDecoder = makeDecoder((v) => {
  if (typeof v === 'number') return fok(v);
  if (typeof v === 'bigint') return fok(Number(v));
  if (v instanceof PfunForeign) return ferrMarshal(`Expected number, got live handle`);
  return ferrMarshal(`Expected number, got ${typeof v}`);
});

const dStrDecoder = makeDecoder((v) => {
  if (typeof v === 'string') return fok(v);
  if (v instanceof PfunForeign) return ferrMarshal(`Expected string, got live handle`);
  return ferrMarshal(`Expected string, got ${typeof v}`);
});

// ─── Combinator decoders ─────────────────────────────────────────────────────

/** dList(elemDecoder) — JS Array → Pfun list, applying elemDecoder to each element. */
function makeDList(elemDecoder: NativeFunction): NativeFunction {
  return makeDecoder((v) => {
    if (!Array.isArray(v)) {
      return ferrMarshal(`dList: expected array, got ${v instanceof PfunForeign ? 'live handle' : typeof v}`);
    }
    const result: any[] = [];
    for (let i = 0; i < v.length; i++) {
      const decoded = elemDecoder.execute([v[i]], null as any);
      if (decoded.__type === 'FErr') return decoded; // propagate first error
      result.push(decoded.value);
    }
    return fok(result);
  });
}

/** dOption(innerDecoder) — null/undefined → None; otherwise Some(decoded). */
function makeDOption(innerDecoder: NativeFunction): NativeFunction {
  return makeDecoder((v) => {
    if (v === null || v === undefined) {
      return fok({ __type: 'None', __union: 'Option' });
    }
    const decoded = innerDecoder.execute([v], null as any);
    if (decoded.__type === 'FErr') return decoded;
    return fok({ __type: 'Some', __union: 'Option', value: decoded.value });
  });
}

/** dDict(valueDecoder) — plain JS object → Pfun dict, values decoded individually. */
function makeDDict(valueDecoder: NativeFunction): NativeFunction {
  return makeDecoder((v) => {
    const raw = v instanceof PfunForeign ? v.value : v;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return ferrMarshal(`dDict: expected plain object, got ${raw === null ? 'null' : typeof raw}`);
    }
    const map = new Map<string, any>();
    for (const [k, val] of Object.entries(raw)) {
      const decoded = valueDecoder.execute([val], null as any);
      if (decoded.__type === 'FErr') return decoded;
      map.set(`s:${k}`, decoded.value);
    }
    return fok(new PfunDict(map));
  });
}

/** dField(key, innerDecoder) — read property key from a live handle or plain object, then decode. */
function makeDField(key: string, innerDecoder: NativeFunction): NativeFunction {
  return makeDecoder((v) => {
    try {
      const raw = v instanceof PfunForeign ? v.value : v;
      if (raw === null || raw === undefined) {
        return ferrMarshal(`dField("${key}"): cannot read property of null/undefined`);
      }
      const prop = (raw as any)[key];
      return innerDecoder.execute([prop], null as any);
    } catch (e) {
      return ferrJs(e);
    }
  });
}

/** dMap(f, innerDecoder) — apply a pure Pfun function to a successful decoded value. */
function makeDMap(f: PfunFunction, innerDecoder: NativeFunction, interp: Interpreter): NativeFunction {
  return makeDecoder((v) => {
    const decoded = innerDecoder.execute([v], interp);
    if (decoded.__type === 'FErr') return decoded;
    try {
      const mapped = f.execute([decoded.value], interp);
      return fok(mapped);
    } catch (e) {
      return ferrJs(e);
    }
  });
}

/**
 * dAndThen(f, innerDecoder) — decode with innerDecoder, then call f with the
 * result to get a second decoder, then run that decoder on the same value.
 * f : a -> Decoder b  (a pure Pfun function returning a NativeFunction decoder).
 */
function makeDAndThen(f: PfunFunction, innerDecoder: NativeFunction, interp: Interpreter): NativeFunction {
  return makeDecoder((v) => {
    const decoded = innerDecoder.execute([v], interp);
    if (decoded.__type === 'FErr') return decoded;
    try {
      const nextDecoder = f.execute([decoded.value], interp) as NativeFunction;
      if (!(nextDecoder instanceof NativeFunction)) {
        return ferrType('dAndThen: the function must return a decoder');
      }
      return nextDecoder.execute([v], interp);
    } catch (e) {
      return ferrJs(e);
    }
  });
}

/** dOneOf(decoders) — try each decoder in order, return first success. */
function makeDOneOf(decoders: NativeFunction[]): NativeFunction {
  return makeDecoder((v) => {
    const errors: string[] = [];
    for (const d of decoders) {
      const result = d.execute([v], null as any);
      if (result.__type === 'FOk') return result;
      errors.push(result.message);
    }
    return ferrMarshal(`dOneOf: all decoders failed: ${errors.join('; ')}`);
  });
}

// ─── Apply a decoder to a Foreign handle already in hand ─────────────────────

function applyDecoder(handle: any, decoder: NativeFunction, interp: Interpreter): any {
  // Materialize scalars / arrays that came through as PfunForeign
  const raw = handle instanceof PfunForeign ? handle.value : handle;
  const materialized = materialize(raw);
  return decoder.execute([materialized], interp);
}

// ─── Effect ops ──────────────────────────────────────────────────────────────

export const foreignlibFunctions: RegistryFunction[] = [

  // ── foreignRequire(path) ────────────────────────────────────────────────
  // Load a Node module. The returned ForeignResult<Foreign> wraps the module
  // exports object. Only available in Node; throws in browser contexts where
  // `require` is not defined.
  {
    name: 'foreignRequire',
    arity: 1,
    fn: (args, interp) => {
      pureGuard('foreignRequire', interp);
      const path = interp.force(args[0]);
      if (typeof path !== 'string') return ferrType('foreignRequire() requires a string path');
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(path);
        return fok(new PfunForeign(mod));
      } catch (e) {
        return ferrJs(e);
      }
    },
  },

  // ── foreignGlobal(name) ─────────────────────────────────────────────────
  // Read a global by name (Math, Buffer, Date, globalThis, window, etc.).
  {
    name: 'foreignGlobal',
    arity: 1,
    fn: (args, interp) => {
      pureGuard('foreignGlobal', interp);
      const name = interp.force(args[0]);
      if (typeof name !== 'string') return ferrType('foreignGlobal() requires a string name');
      try {
        const g = (globalThis as any)[name];
        if (g === undefined) return ferrMarshal(`foreignGlobal: global '${name}' is undefined`);
        return fok(materialize(g));
      } catch (e) {
        return ferrJs(e);
      }
    },
  },

  // ── foreignGet(handle, prop) ─────────────────────────────────────────────
  // Read a property from a JS object. Returns ForeignResult<Foreign>.
  // The result is materialized: scalars come back as Pfun values; objects
  // come back as PfunForeign handles.
  {
    name: 'foreignGet',
    arity: 2,
    fn: (args, interp) => {
      pureGuard('foreignGet', interp);
      const handle = interp.force(args[0]);
      const prop   = interp.force(args[1]);
      if (typeof prop !== 'string') return ferrType('foreignGet() property name must be a string');
      try {
        const obj = unwrapHandle(handle, 'foreignGet');
        const val = (obj as any)[prop];
        return fok(materialize(val));
      } catch (e) {
        return ferrJs(e);
      }
    },
  },

  // ── foreignSet(handle, prop, value) ─────────────────────────────────────
  // Set a property on a JS object. Returns ForeignResult<unit>.
  {
    name: 'foreignSet',
    arity: 3,
    fn: (args, interp) => {
      pureGuard('foreignSet', interp);
      const handle = interp.force(args[0]);
      const prop   = interp.force(args[1]);
      const value  = toJs(interp.force(args[2]), interp);
      if (typeof prop !== 'string') return ferrType('foreignSet() property name must be a string');
      try {
        const obj = unwrapHandle(handle, 'foreignSet');
        (obj as any)[prop] = value;
        return fok(null);
      } catch (e) {
        return ferrJs(e);
      }
    },
  },

  // ── foreignCall(handle, method, args) ───────────────────────────────────
  // Call a method on a JS object: handle[method](...args).
  // Returns ForeignResult<Foreign> (result is materialized).
  {
    name: 'foreignCall',
    arity: 3,
    fn: (args, interp) => {
      pureGuard('foreignCall', interp);
      const handle     = interp.force(args[0]);
      const methodName = interp.force(args[1]);
      const pfunArgs   = interp.force(args[2]);
      if (typeof methodName !== 'string') return ferrType('foreignCall() method name must be a string');
      if (!Array.isArray(pfunArgs)) return ferrType('foreignCall() args must be a list');
      try {
        const obj    = unwrapHandle(handle, 'foreignCall');
        const method = (obj as any)[methodName];
        if (typeof method !== 'function') {
          return ferrType(`foreignCall: '${methodName}' is not a function on the target object`);
        }
        const jsArgs = pfunArgs.map(a => toJsArg(a, interp));
        const result = method.apply(obj, jsArgs);
        return fok(materialize(result));
      } catch (e) {
        return ferrJs(e);
      }
    },
  },

  // ── foreignInvoke(fn, args) ─────────────────────────────────────────────
  // Call a JS function directly (not as a method): fn(...args).
  // Returns ForeignResult<Foreign>.
  {
    name: 'foreignInvoke',
    arity: 2,
    fn: (args, interp) => {
      pureGuard('foreignInvoke', interp);
      const fnHandle = interp.force(args[0]);
      const pfunArgs = interp.force(args[1]);
      if (!Array.isArray(pfunArgs)) return ferrType('foreignInvoke() args must be a list');
      try {
        const fn = unwrapHandle(fnHandle, 'foreignInvoke');
        if (typeof fn !== 'function') return ferrType('foreignInvoke: first argument must be a function');
        const jsArgs = pfunArgs.map(a => toJsArg(a, interp));
        const result = fn(...jsArgs);
        return fok(materialize(result));
      } catch (e) {
        return ferrJs(e);
      }
    },
  },

  // ── foreignNew(ctor, args) ───────────────────────────────────────────────
  // Invoke a constructor: new ctor(...args). Returns ForeignResult<Foreign>.
  {
    name: 'foreignNew',
    arity: 2,
    fn: (args, interp) => {
      pureGuard('foreignNew', interp);
      const ctorHandle = interp.force(args[0]);
      const pfunArgs   = interp.force(args[1]);
      if (!Array.isArray(pfunArgs)) return ferrType('foreignNew() args must be a list');
      try {
        const Ctor = unwrapHandle(ctorHandle, 'foreignNew');
        if (typeof Ctor !== 'function') return ferrType('foreignNew: first argument must be a constructor');
        const jsArgs = pfunArgs.map(a => toJsArg(a, interp));
        const instance = new Ctor(...jsArgs);
        return fok(new PfunForeign(instance));
      } catch (e) {
        return ferrJs(e);
      }
    },
  },

  // ── foreignDelete(handle, prop) ─────────────────────────────────────────
  // Delete a property from a JS object. Returns ForeignResult<unit>.
  {
    name: 'foreignDelete',
    arity: 2,
    fn: (args, interp) => {
      pureGuard('foreignDelete', interp);
      const handle = interp.force(args[0]);
      const prop   = interp.force(args[1]);
      if (typeof prop !== 'string') return ferrType('foreignDelete() property name must be a string');
      try {
        const obj = unwrapHandle(handle, 'foreignDelete');
        delete (obj as any)[prop];
        return fok(null);
      } catch (e) {
        return ferrJs(e);
      }
    },
  },

  // ── foreignTypeof(handle) ───────────────────────────────────────────────
  // Returns ForeignResult<Str> where the string is the JS typeof result.
  {
    name: 'foreignTypeof',
    arity: 1,
    fn: (args, interp) => {
      pureGuard('foreignTypeof', interp);
      const handle = interp.force(args[0]);
      try {
        const raw = handle instanceof PfunForeign ? handle.value : handle;
        return fok(typeof raw);
      } catch (e) {
        return ferrJs(e);
      }
    },
  },

  // ── foreignAwait(handle) ────────────────────────────────────────────────
  // Await a JS Promise held as a Foreign handle.
  // Must be used with `await` in an `async proc`.
  // Returns a Promise<ForeignResult<Foreign>>.
  {
    name: 'foreignAwait',
    arity: 1,
    fn: (args, interp) => {
      pureGuard('foreignAwait', interp);
      const handle = interp.force(args[0]);
      const raw = handle instanceof PfunForeign ? handle.value : handle;
      if (raw === null || raw === undefined || typeof (raw as any).then !== 'function') {
        return ferrType('foreignAwait: argument is not a Promise');
      }
      return Promise.resolve(raw)
        .then((resolved: any) => fok(materialize(resolved)))
        .catch((e: unknown) => ferrJs(e));
    },
  },

  // ── foreignCallback(proc, argsDecoder) ──────────────────────────────────
  // Wrap a Pfun procedure as a JS function suitable for passing to JS APIs.
  //
  // When JS calls the wrapper, each JS argument is decoded using argsDecoder
  // (a Decoder<List<a>> — typically dList(dForeign) to receive raw handles,
  // or a custom decoder for well-typed callbacks). The decoded argument list
  // is then applied to proc.
  //
  // The wrapper runs proc via spawnPfunCallback (fire-and-forget, async-safe).
  // It always returns `undefined` to JS — event-handler style. If proc must
  // produce a synchronous return value for JS (rare; most JS callbacks are
  // one-way), you cannot use this wrapper: that case requires a synchronous
  // proc with no `await`, and direct NativeFunction construction.
  //
  // proc must be a procedure (kind === 'procedure'). Pure functions are
  // rejected because callbacks typically perform effects.
  {
    name: 'foreignCallback',
    arity: 2,
    fn: (args, interp) => {
      pureGuard('foreignCallback', interp);
      const pfunProc   = interp.force(args[0]);
      const argsDecoder = interp.force(args[1]);
      if (!(pfunProc instanceof PfunFunction)) {
        return ferrType('foreignCallback: first argument must be a procedure');
      }
      if (pfunProc.kind !== 'procedure') {
        return ferrType('foreignCallback: first argument must be a procedure, not a function — callbacks perform effects');
      }
      if (!(argsDecoder instanceof NativeFunction)) {
        return ferrType('foreignCallback: second argument must be a decoder');
      }
      const wrapper = (...jsArgs: any[]) => {
        // Materialize each JS argument
        const materialized = jsArgs.map(materialize);
        // Decode the argument list
        const decoded = argsDecoder.execute([materialized], interp);
        let pfunArgs: any[];
        if (decoded.__type === 'FOk') {
          // Expect a list of arguments
          pfunArgs = Array.isArray(decoded.value) ? decoded.value : [decoded.value];
        } else {
          // Decode failed — log and bail
          // eslint-disable-next-line no-console
          console.error(`[foreignCallback] argument decode failed (${decoded.kind}): ${decoded.message}`);
          return undefined;
        }
        interp.spawnPfunCallback(pfunProc, pfunArgs, (e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          // eslint-disable-next-line no-console
          console.error(`[foreignCallback] proc error: ${msg}`);
        });
        return undefined;
      };
      return fok(new PfunForeign(wrapper));
    },
  },

  // ── foreignApply(handle, decoder) ───────────────────────────────────────
  // Apply a decoder to an already-fetched Foreign value.
  // Useful when you have a handle and want to decode it outside of a call site.
  {
    name: 'foreignApply',
    arity: 2,
    fn: (args, interp) => {
      pureGuard('foreignApply', interp);
      const handle  = interp.force(args[0]);
      const decoder = interp.force(args[1]);
      if (!(decoder instanceof NativeFunction)) {
        return ferrType('foreignApply: second argument must be a decoder');
      }
      return applyDecoder(handle, decoder, interp);
    },
  },

  // ── Decoder leaf values (registered as arity-0 NativeFunctions) ──────────
  // These are resolved at import time and bound as globals.
  {
    name: 'dForeign',
    fn: (_args, _interp) => dForeignDecoder,
  },
  {
    name: 'dUnit',
    fn: (_args, _interp) => dUnitDecoder,
  },
  {
    name: 'dBool',
    fn: (_args, _interp) => dBoolDecoder,
  },
  {
    name: 'dInt',
    fn: (_args, _interp) => dIntDecoder,
  },
  {
    name: 'dFloat',
    fn: (_args, _interp) => dFloatDecoder,
  },
  {
    name: 'dStr',
    fn: (_args, _interp) => dStrDecoder,
  },

  // ── Decoder combinators (arity-1 or arity-2, curriable) ──────────────────

  {
    name: 'dList',
    arity: 1,
    fn: (args, interp) => {
      const inner = interp.force(args[0]);
      if (!(inner instanceof NativeFunction)) {
        throw new Error('dList() requires a decoder as its argument');
      }
      return makeDList(inner);
    },
  },

  {
    name: 'dOption',
    arity: 1,
    fn: (args, interp) => {
      const inner = interp.force(args[0]);
      if (!(inner instanceof NativeFunction)) {
        throw new Error('dOption() requires a decoder as its argument');
      }
      return makeDOption(inner);
    },
  },

  {
    name: 'dDict',
    arity: 1,
    fn: (args, interp) => {
      const inner = interp.force(args[0]);
      if (!(inner instanceof NativeFunction)) {
        throw new Error('dDict() requires a decoder as its argument');
      }
      return makeDDict(inner);
    },
  },

  {
    name: 'dField',
    arity: 2,
    fn: (args, interp) => {
      const key   = interp.force(args[0]);
      const inner = interp.force(args[1]);
      if (typeof key !== 'string') throw new Error('dField() first argument must be a string property name');
      if (!(inner instanceof NativeFunction)) throw new Error('dField() second argument must be a decoder');
      return makeDField(key, inner);
    },
  },

  {
    name: 'dMap',
    arity: 2,
    fn: (args, interp) => {
      const f     = interp.force(args[0]);
      const inner = interp.force(args[1]);
      if (!(f instanceof PfunFunction)) throw new Error('dMap() first argument must be a function');
      if (!(inner instanceof NativeFunction)) throw new Error('dMap() second argument must be a decoder');
      return makeDMap(f, inner, interp);
    },
  },

  {
    name: 'dAndThen',
    arity: 2,
    fn: (args, interp) => {
      const f     = interp.force(args[0]);
      const inner = interp.force(args[1]);
      if (!(f instanceof PfunFunction)) throw new Error('dAndThen() first argument must be a function');
      if (!(inner instanceof NativeFunction)) throw new Error('dAndThen() second argument must be a decoder');
      return makeDAndThen(f, inner, interp);
    },
  },

  {
    name: 'dOneOf',
    arity: 1,
    fn: (args, interp) => {
      const list = interp.force(args[0]);
      if (!Array.isArray(list)) throw new Error('dOneOf() requires a list of decoders');
      const decoders = list.map((d: any) => {
        const fd = interp.force(d);
        if (!(fd instanceof NativeFunction)) throw new Error('dOneOf() list elements must all be decoders');
        return fd;
      });
      return makeDOneOf(decoders);
    },
  },

];

// ─── Types ───────────────────────────────────────────────────────────────────

export const foreignlibTypes: RegistryType[] = [
  {
    kind: 'union',
    name: 'ForeignResult',
    generic: true,
    variants: [
      { name: 'FOk',  fields: ['value'] },
      { name: 'FErr', fields: ['kind', 'message'] },
    ],
  },
];
