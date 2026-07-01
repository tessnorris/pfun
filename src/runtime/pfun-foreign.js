// pfun-foreign.js
// Runtime shim for `import * from "foreign"` in transpiled Pfun programs.
//
// In the interpreter, FFI functions are implemented as RegistryFunction entries
// in foreignlib.ts.  In compiled output there is no interpreter, so this file
// re-implements the same surface as plain JS:
//
//   - Effect ops: foreignRequire, foreignGlobal, foreignGet, foreignSet,
//     foreignCall, foreignInvoke, foreignNew, foreignDelete, foreignTypeof,
//     foreignAwait, foreignCallback, foreignApply
//   - Leaf decoders: dForeign, dUnit, dBool, dInt, dFloat, dStr
//   - Combinator decoders: dList, dOption, dDict, dField, dMap, dAndThen, dOneOf
//
// Differences from the interpreter implementation:
//   - No purity guard (compiled code has no purity context).
//   - No interp.force() calls (compiled code has no lazy thunks).
//   - PfunForeign is a plain JS class defined locally.
//   - Decoders are plain JS functions/closures, not NativeFunction instances.
//   - FOk/FErr objects are built directly as plain JS objects to avoid a
//     circular dependency on pfun-runtime's $record/$schema machinery.
//     The shape { __type, __union, ...fields } matches what $record produces,
//     so $match and field access work identically on them.
//
// ─── ForeignResult union ─────────────────────────────────────────────────────
//
// ForeignResult is declared `generic` in foreignlib.ts, so each use site may
// have a different payload type.  In compiled output $registerType is called
// for every user-declared type, but builtin union types like ForeignResult
// come through the BUILTIN_UNION_TABLE path in main.ts and are NOT emitted as
// $registerType calls.  We therefore seed the $schema table ourselves if it is
// accessible, and also export raw object constructors as a fallback so that
// $record('FOk', [...]) works whether or not we can reach $schema.
//
// In practice, compiled files that use this module will have $registerType in
// scope from pfun-runtime.js, so we call it at require() time.

'use strict';

// ─── PfunForeign ─────────────────────────────────────────────────────────────

class PfunForeign {
  constructor(value) { this.value = value; }
}

// ─── ForeignResult helpers ────────────────────────────────────────────────────

function fok(value) {
  return { __type: 'FOk', __union: 'ForeignResult', value };
}

function ferr(kind, message) {
  return { __type: 'FErr', __union: 'ForeignResult', kind, message };
}

function ferrJs(e) {
  return ferr('js_exception', e instanceof Error ? e.message : String(e));
}

function ferrMarshal(msg) {
  return ferr('marshal_error', msg);
}

function ferrType(msg) {
  return ferr('type_error', msg);
}

// ─── Materialization ──────────────────────────────────────────────────────────
//
// Scalars, booleans, bigints, strings, and arrays are materialized into their
// Pfun equivalents.  Everything else (class instances, DOM nodes, functions,
// Promises, plain objects) stays as a PfunForeign handle.

function materialize(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'bigint')  return v;
  if (typeof v === 'number')  return v;
  if (typeof v === 'string')  return v;
  if (Array.isArray(v))       return v.map(materialize);
  return new PfunForeign(v);
}

// Unwrap a Pfun value to a raw JS value for passing into JS APIs.
function toJs(v) {
  if (v instanceof PfunForeign) return v.value;
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) return v.map(toJs);
  return v;
}

// Like toJs, but converts bigint to Number for JS APIs that don't accept bigint
// (Date constructors, Math functions, setter methods, etc.). Used for call args.
function toJsArg(v) {
  const raw = toJs(v);
  if (typeof raw === 'bigint') return Number(raw);
  if (Array.isArray(raw)) return raw.map(x => (typeof x === 'bigint' ? Number(x) : x));
  return raw;
}

// Unwrap a handle to its raw JS value (scalars pass through as-is).
function unwrap(v) {
  return v instanceof PfunForeign ? v.value : v;
}

// ─── Effect ops ──────────────────────────────────────────────────────────────

function foreignRequire(path) {
  if (typeof path !== 'string') return ferrType('foreignRequire() requires a string path');
  try {
    return fok(new PfunForeign(require(path)));
  } catch (e) {
    return ferrJs(e);
  }
}

function foreignGlobal(name) {
  if (typeof name !== 'string') return ferrType('foreignGlobal() requires a string name');
  try {
    const g = (typeof globalThis !== 'undefined' ? globalThis : global)[name];
    if (g === undefined) return ferrMarshal(`foreignGlobal: global '${name}' is undefined`);
    return fok(materialize(g));
  } catch (e) {
    return ferrJs(e);
  }
}

function foreignGet(handle, prop) {
  if (typeof prop !== 'string') return ferrType('foreignGet() property name must be a string');
  try {
    return fok(materialize(unwrap(handle)[prop]));
  } catch (e) {
    return ferrJs(e);
  }
}

function foreignSet(handle, prop, value) {
  if (typeof prop !== 'string') return ferrType('foreignSet() property name must be a string');
  try {
    unwrap(handle)[prop] = toJs(value);
    return fok(null);
  } catch (e) {
    return ferrJs(e);
  }
}

function foreignCall(handle, method, args) {
  if (typeof method !== 'string') return ferrType('foreignCall() method name must be a string');
  if (!Array.isArray(args)) return ferrType('foreignCall() args must be a list');
  try {
    const obj = unwrap(handle);
    const fn  = obj[method];
    if (typeof fn !== 'function')
      return ferrType(`foreignCall: '${method}' is not a function on the target object`);
    return fok(materialize(fn.apply(obj, args.map(toJsArg))));
  } catch (e) {
    return ferrJs(e);
  }
}

function foreignInvoke(fnHandle, args) {
  if (!Array.isArray(args)) return ferrType('foreignInvoke() args must be a list');
  try {
    const fn = unwrap(fnHandle);
    if (typeof fn !== 'function') return ferrType('foreignInvoke: first argument must be a function');
    return fok(materialize(fn(...args.map(toJsArg))));
  } catch (e) {
    return ferrJs(e);
  }
}

function foreignNew(ctorHandle, args) {
  if (!Array.isArray(args)) return ferrType('foreignNew() args must be a list');
  try {
    const Ctor = unwrap(ctorHandle);
    if (typeof Ctor !== 'function') return ferrType('foreignNew: first argument must be a constructor');
    return fok(new PfunForeign(new Ctor(...args.map(toJsArg))));
  } catch (e) {
    return ferrJs(e);
  }
}

function foreignDelete(handle, prop) {
  if (typeof prop !== 'string') return ferrType('foreignDelete() property name must be a string');
  try {
    delete unwrap(handle)[prop];
    return fok(null);
  } catch (e) {
    return ferrJs(e);
  }
}

function foreignTypeof(handle) {
  try {
    return fok(typeof unwrap(handle));
  } catch (e) {
    return ferrJs(e);
  }
}

function foreignAwait(handle) {
  const raw = unwrap(handle);
  if (raw === null || raw === undefined || typeof raw.then !== 'function')
    return ferrType('foreignAwait: argument is not a Promise');
  return Promise.resolve(raw)
    .then(v  => fok(materialize(v)))
    .catch(e => ferrJs(e));
}

// foreignCallback(proc, argsDecoder)
// In compiled output a Pfun procedure is a plain JS function (possibly curried
// via $curry).  We call it directly with the decoded argument list.
function foreignCallback(proc, argsDecoder) {
  if (typeof proc !== 'function')
    return ferrType('foreignCallback: first argument must be a procedure');
  if (typeof argsDecoder !== 'function')
    return ferrType('foreignCallback: second argument must be a decoder');
  const wrapper = (...jsArgs) => {
    const materialized = jsArgs.map(materialize);
    const decoded = argsDecoder(materialized);
    let pfunArgs;
    if (decoded.__type === 'FOk') {
      pfunArgs = Array.isArray(decoded.value) ? decoded.value : [decoded.value];
    } else {
      console.error(`[foreignCallback] argument decode failed (${decoded.kind}): ${decoded.message}`);
      return undefined;
    }
    try {
      // Apply the proc to each argument in sequence (handles currying).
      let result = proc;
      for (const arg of pfunArgs) result = result(arg);
    } catch (e) {
      console.error(`[foreignCallback] proc error: ${e instanceof Error ? e.message : e}`);
    }
    return undefined;
  };
  return fok(new PfunForeign(wrapper));
}

// foreignApply(handle, decoder)
// Apply a decoder to an already-fetched Foreign value.
function foreignApply(handle, decoder) {
  if (typeof decoder !== 'function')
    return ferrType('foreignApply: second argument must be a decoder');
  const raw         = handle instanceof PfunForeign ? handle.value : handle;
  const materialized = materialize(raw);
  return decoder(materialized);
}

// ─── Leaf decoders ───────────────────────────────────────────────────────────
//
// In the interpreter these are arity-0 builtins that return a NativeFunction.
// In compiled output, `dInt()` is called to get the decoder, so each leaf
// is a zero-argument function returning a decoder function (v) => ForeignResult.

function dForeign() {
  return function(v) {
    return fok(v instanceof PfunForeign ? v : new PfunForeign(v));
  };
}

function dUnit() {
  return function(_v) { return fok(null); };
}

function dBool() {
  return function(v) {
    if (typeof v === 'boolean') return fok(v);
    if (v instanceof PfunForeign) return ferrMarshal('Expected boolean, got live handle');
    return ferrMarshal(`Expected boolean, got ${typeof v}`);
  };
}

function dInt() {
  return function(v) {
    if (typeof v === 'bigint') return fok(v);
    if (typeof v === 'number') {
      if (!Number.isInteger(v)) return ferrMarshal(`Expected integer, got non-integer float ${v}`);
      return fok(BigInt(v));
    }
    if (v instanceof PfunForeign) return ferrMarshal('Expected integer, got live handle');
    return ferrMarshal(`Expected integer, got ${typeof v}`);
  };
}

function dFloat() {
  return function(v) {
    if (typeof v === 'number') return fok(v);
    if (typeof v === 'bigint') return fok(Number(v));
    if (v instanceof PfunForeign) return ferrMarshal('Expected number, got live handle');
    return ferrMarshal(`Expected number, got ${typeof v}`);
  };
}

function dStr() {
  return function(v) {
    if (typeof v === 'string') return fok(v);
    if (v instanceof PfunForeign) return ferrMarshal('Expected string, got live handle');
    return ferrMarshal(`Expected string, got ${typeof v}`);
  };
}

// ─── Combinator decoders ─────────────────────────────────────────────────────
//
// Each combinator takes one or more decoders (already invoked, i.e. functions)
// and returns a new decoder function.  This mirrors the interpreter exactly.

function dList(elemDecoder) {
  return function(v) {
    if (!Array.isArray(v))
      return ferrMarshal(`dList: expected array, got ${v instanceof PfunForeign ? 'live handle' : typeof v}`);
    const result = [];
    for (let i = 0; i < v.length; i++) {
      const decoded = elemDecoder(v[i]);
      if (decoded.__type === 'FErr') return decoded;
      result.push(decoded.value);
    }
    return fok(result);
  };
}

function dOption(innerDecoder) {
  return function(v) {
    if (v === null || v === undefined)
      return fok({ __type: 'None', __union: 'Option' });
    const decoded = innerDecoder(v);
    if (decoded.__type === 'FErr') return decoded;
    return fok({ __type: 'Some', __union: 'Option', value: decoded.value });
  };
}

function dDict(valueDecoder) {
  return function(v) {
    const raw = v instanceof PfunForeign ? v.value : v;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
      return ferrMarshal(`dDict: expected plain object, got ${raw === null ? 'null' : typeof raw}`);
    // Build a PfunDict using the same key-encoding convention as pfun-runtime.js
    const { PfunDict } = require('./pfun-runtime');
    const map = new Map();
    for (const [k, val] of Object.entries(raw)) {
      const decoded = valueDecoder(val);
      if (decoded.__type === 'FErr') return decoded;
      map.set(`s:${k}`, decoded.value);
    }
    return fok(new PfunDict(map));
  };
}

function dField(key, innerDecoder) {
  return function(v) {
    try {
      const raw = v instanceof PfunForeign ? v.value : v;
      if (raw === null || raw === undefined)
        return ferrMarshal(`dField("${key}"): cannot read property of null/undefined`);
      return innerDecoder(raw[key]);
    } catch (e) {
      return ferrJs(e);
    }
  };
}

// dMap(f, innerDecoder) — f is a compiled Pfun function (plain JS function).
function dMap(f, innerDecoder) {
  return function(v) {
    const decoded = innerDecoder(v);
    if (decoded.__type === 'FErr') return decoded;
    try {
      return fok(f(decoded.value));
    } catch (e) {
      return ferrJs(e);
    }
  };
}

// dAndThen(f, innerDecoder) — f : a -> decoder.
function dAndThen(f, innerDecoder) {
  return function(v) {
    const decoded = innerDecoder(v);
    if (decoded.__type === 'FErr') return decoded;
    try {
      const nextDecoder = f(decoded.value);
      if (typeof nextDecoder !== 'function')
        return ferrType('dAndThen: the function must return a decoder');
      return nextDecoder(v);
    } catch (e) {
      return ferrJs(e);
    }
  };
}

function dOneOf(decoders) {
  return function(v) {
    const errors = [];
    for (const d of decoders) {
      const result = d(v);
      if (result.__type === 'FOk') return result;
      errors.push(result.message);
    }
    return ferrMarshal(`dOneOf: all decoders failed: ${errors.join('; ')}`);
  };
}

// ─── Schema registration ──────────────────────────────────────────────────────
//
// Seed FOk/FErr into $schema so that $record('FOk', [...]) works in compiled
// output that uses these constructors.  We reach into pfun-runtime at require()
// time; if it hasn't been loaded yet the try/catch lets us proceed anyway —
// compiled files that use $record will have already required pfun-runtime before
// this module's exports are used.

try {
  const rt = require('./pfun-runtime');
  if (typeof rt.$registerType === 'function') {
    rt.$registerType('FOk',  ['value'],          'ForeignResult');
    rt.$registerType('FErr', ['kind', 'message'], 'ForeignResult');
  }
} catch (_) {
  // pfun-runtime not yet available; schema will be populated when it loads.
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  // Type constructors (for $registerType compatibility)
  FOk:  (value)           => fok(value),
  FErr: (kind, message)   => ferr(kind, message),

  // Effect ops
  foreignRequire,
  foreignGlobal,
  foreignGet,
  foreignSet,
  foreignCall,
  foreignInvoke,
  foreignNew,
  foreignDelete,
  foreignTypeof,
  foreignAwait,
  foreignCallback,
  foreignApply,

  // Leaf decoders (arity-0 functions that return decoder functions)
  dForeign,
  dUnit,
  dBool,
  dInt,
  dFloat,
  dStr,

  // Combinator decoders
  dList,
  dOption,
  dDict,
  dField,
  dMap,
  dAndThen,
  dOneOf,
};
