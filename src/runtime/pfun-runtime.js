'use strict';
// pfun-runtime.js — runtime support library for Pfun transpiler output.
//
// All semantics here are direct ports of interpreter.ts behaviour so that
// the differential harness (interpreter output === transpiled output) can
// hold without special-casing any operator or value class.  When in doubt,
// this file's behaviour is defined by interpreter.ts, not the other way round.

// ─── Value classes ──────────────────────────────────────────────────────────
// Same shapes as interpreter.ts so that $stringify produces identical output.

class PfunChar {
  constructor(value) { this.value = value; }
}

class PfunByte {
  constructor(value) { this.value = value; }  // always 0–255
}

class PfunArray {
  constructor(elements) {
    this.elements   = elements;
    this.elementType = null;
  }
}

class PfunDict {
  constructor(entries) { this.entries = entries; }  // Map<encodedKey, value>
  static keyOf(k) {
    if (typeof k === 'string')  return `s:${k}`;
    if (typeof k === 'bigint')  return `i:${k}`;
    if (typeof k === 'boolean') return `b:${k}`;
    throw new Error(`Dictionary keys must be strings, integers, or booleans, got ${typeof k}.`);
  }
}

// ─── Currying support ─────────────────────────────────────────────────────────
// $curry(fn, arity) wraps a function so partial application returns a closure
// expecting the remaining arguments, matching Pfun's interpreter behaviour.
// Single-argument functions are returned as-is (no overhead).

function $curry(fn, arity) {
  if (arity <= 1) return fn;
  function curried(...args) {
    if (args.length >= arity) return fn(...args);
    return $curry((...more) => curried(...args, ...more), arity - args.length);
  }
  return curried;
}

// $memoize(fn) — wraps fn with a Map-based cache keyed by a JSON
// serialisation of the arguments (matching the interpreter's getCacheKey).
// Applied after $curry so partial applications don't bypass the cache.
function $memoize(fn) {
  const cache = new Map();
  function memoized(...args) {
    const key = JSON.stringify(args, (_, v) => {
      if (typeof v === 'bigint') return v.toString() + 'n';
      if (typeof v === 'number') return 'f:' + v.toString();
      return v;
    });
    if (cache.has(key)) return cache.get(key);
    const result = fn(...args);
    cache.set(key, result);
    return result;
  }
  return memoized;
}

// ─── Value constructors ──────────────────────────────────────────────────────

function $char(s)  { return new PfunChar(String(s)); }
function $byte(n) {
  if (n < 0 || n > 255) throw new Error(`Byte out of range: ${n} (must be 0–255).`);
  return new PfunByte(n);
}

// Positional record/union constructor.  `fields` is a plain object of
// fieldName→value pairs. We accept both the ordered-array form (used by the
// transpiler for positional RecordExprs) and the key-value form (used for
// named-field literals) via an explicit fields map.
//
// The schema table ($schema, below) provides field names and ordering; this
// mirrors what the interpreter's TypeRegistry.instantiate() does.
function $record(typeName, fields) {
  const schema = $schema[typeName];
  if (!schema) throw new Error(`Unknown type '${typeName}'.`);
  const obj = { __type: typeName };
  if (schema.unionName) obj.__union = schema.unionName;
  if (Array.isArray(fields)) {
    if (fields.length !== schema.fields.length)
      throw new Error(`'${typeName}' expects ${schema.fields.length} field(s), got ${fields.length}.`);
    schema.fields.forEach((f, i) => obj[f] = fields[i]);
  } else {
    // named-field object — reorder to schema order
    schema.fields.forEach(f => {
      if (!(f in fields)) throw new Error(`Missing field '${f}' in ${typeName}.`);
      obj[f] = fields[f];
    });
  }
  return obj;
}

// ─── Schema table ─────────────────────────────────────────────────────────────
// Populated by transpiled code at the top of each output file via $registerType.
// Core types (Pair, Option, Result, etc.) are pre-seeded here so they're
// available even without an explicit TypeStmt in user code.
const $schema = {
  Pair:    { fields: ['key', 'value'],   unionName: null },
  Some:    { fields: ['value'],          unionName: 'Option' },
  None:    { fields: [],                 unionName: 'Option' },
  Ok:      { fields: ['value'],          unionName: 'Result' },
  Err:     { fields: ['message'],        unionName: 'Result' },
  // DbResult — used by both db/postgresql and db/mariadb
  // Ok/Err already cover DbResult's variants (same names, same fields).
  // DbValue variants
  DbInt:   { fields: ['value'],  unionName: 'DbValue' },
  DbFloat: { fields: ['value'],  unionName: 'DbValue' },
  DbText:  { fields: ['value'],  unionName: 'DbValue' },
  DbBool:  { fields: ['value'],  unionName: 'DbValue' },
  DbBytes: { fields: ['value'],  unionName: 'DbValue' },
  DbNull:  { fields: [],         unionName: 'DbValue' },
};
function $registerType(typeName, fields, unionName) {
  $schema[typeName] = { fields, unionName: unionName ?? null };
}

// ─── Output / formatting ─────────────────────────────────────────────────────
// $stringify is a direct port of Interpreter.prototype.stringify — the single
// most important function for differential parity (it defines all printed output).

function $stringify(value) {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint')  return value.toString();
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toFixed(1);
    return value.toString();
  }
  if (value instanceof PfunChar)  return value.value;
  if (value instanceof PfunByte)  return value.value.toString();
  if (value instanceof PfunDict) {
    const entries = [...value.entries.entries()].map(([k, v]) => `${k.slice(2)} -> ${$stringify(v)}`);
    return `dict { ${entries.join(', ')} }`;
  }
  if (value instanceof PfunArray) {
    return `array { ${value.elements.map($stringify).join(', ')} }`;
  }
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(c => c instanceof PfunChar)) return value.map(c => c.value).join('');
    return `[${value.map($stringify).join(', ')}]`;
  }
  if (value && value.__type) {
    const fields = Object.keys(value).filter(k => k !== '__type' && k !== '__union');
    if (fields.length === 0) return value.__type;
    return `${value.__type} { ${fields.map(f => $stringify(value[f])).join(', ')} }`;
  }
  return String(value);
}

function $println(value) {
  process.stdout.write($stringify(value) + '\n');
}
function $print(value) {
  process.stdout.write($stringify(value));
}
function $flushStdout() {
  // Node's stdout is synchronous when writing to a terminal or pipe;
  // no explicit flush is needed, but we honour the call as a no-op.
}
// $clearOutput and $attachDomHandler are browser-only; no-ops in Node.
function $clearOutput() {}
function $attachDomHandler(_key, _fn) {}
// $httpPost is browser-only (uses window.fetch); not available in Node.
async function $httpPost(_url, _value) {
  return { __type: 'Err', __union: 'HttpResult', message: 'httpPost() is browser-only.' };
}
// Use pfun-runtime-browser.js for the real implementation.
function $mountHtml(_html) { /* no-op in Node */ }

// ─── Synchronous stdin ───────────────────────────────────────────────────────
// Compiled Pfun programs can read from stdin synchronously using fd 0.
// This works in CLI programs; it does NOT work in async/event-loop contexts.

let _stdinBuf = '';
let _stdinEOF = false;

function _stdinReadMore() {
  if (_stdinEOF) return;
  try {
    const buf = Buffer.alloc(4096);
    const n = require('fs').readSync(0, buf, 0, 4096, null);
    if (n === 0) { _stdinEOF = true; return; }
    _stdinBuf += buf.toString('utf8', 0, n);
  } catch { _stdinEOF = true; }
}

function $readChar() {
  while (_stdinBuf.length === 0 && !_stdinEOF) _stdinReadMore();
  if (_stdinBuf.length === 0) return { __type: 'None', __union: 'Option' };
  const ch = _stdinBuf[0];
  _stdinBuf = _stdinBuf.slice(1);
  return { __type: 'Some', __union: 'Option', value: new PfunChar(ch) };
}

function $readln() {
  while (!_stdinBuf.includes('\n') && !_stdinEOF) _stdinReadMore();
  const nl = _stdinBuf.indexOf('\n');
  if (nl === -1) {
    if (_stdinBuf.length === 0) return { __type: 'None', __union: 'Option' };
    const line = _stdinBuf;
    _stdinBuf = '';
    return { __type: 'Some', __union: 'Option', value: line };
  }
  const line = _stdinBuf.slice(0, nl);
  _stdinBuf = _stdinBuf.slice(nl + 1);
  return { __type: 'Some', __union: 'Option', value: line };
}

function $scriptArgs() {
  // process.argv = ['node', 'script.js', ...userArgs]
  return process.argv.slice(2);
}

function $getEnv(name) {
  if (typeof name !== 'string') throw new Error('getEnv() requires a string argument.');
  const v = process.env[name];
  return v === undefined
    ? { __type: 'None', __union: 'Option' }
    : { __type: 'Some', __union: 'Option', value: v };
}

function $envVars() {
  return Object.entries(process.env).map(([k, v]) =>
    ({ __type: 'Pair', key: k, value: v ?? '' }));
}

// ─── Truthiness ──────────────────────────────────────────────────────────────
// Port of Interpreter.prototype.isTruthy — used for if/ternary/while.

function $truthy(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number')  return value !== 0;
  if (typeof value === 'bigint')  return value !== 0n;
  if (typeof value === 'string')  return value !== '';
  if (value instanceof PfunByte)  return value.value !== 0;
  return true;
}

// ─── Arithmetic / operators ───────────────────────────────────────────────────
// The runtime dispatchers — used at sites where operand types are polymorphic
// or unknown.  Specialised inline ops (bare bigint +, bare string +, etc.) are
// emitted directly by the transpiler when types are concrete; these serve the
// remaining sites.

function _checkFloat(result, op) {
  if (!isFinite(result) || isNaN(result))
    throw new Error(`Float domain error: ${op} produced ${isNaN(result) ? 'NaN' : 'Infinity'}.`);
  return result;
}

// Small inline guard used by the transpiler for float arithmetic sites.
// Exported as $ck.
function $ck(result, op) { return _checkFloat(result, op ?? '?'); }

function $add(l, r) {
  if (l instanceof PfunByte && r instanceof PfunByte) {
    const n = l.value + r.value;
    if (n < 0 || n > 255) throw new Error(`Byte overflow: + produced ${n}, which is out of range (0–255).`);
    return new PfunByte(n);
  }
  const lStr = typeof l === 'string', rStr = typeof r === 'string';
  const lChar = l instanceof PfunChar, rChar = r instanceof PfunChar;
  const lCL = Array.isArray(l) && l.every(c => c instanceof PfunChar);
  const rCL = Array.isArray(r) && r.every(c => c instanceof PfunChar);
  if (lStr || lChar || lCL || rStr || rChar || rCL) return $stringify(l) + $stringify(r);
  const lF = typeof l === 'number', rF = typeof r === 'number';
  if (lF || rF) return _checkFloat((lF ? l : Number(l)) + (rF ? r : Number(r)), '+');
  // List concatenation
  if (Array.isArray(l) && Array.isArray(r)) return [...l, ...r];
  return l + r;  // bigint + bigint
}

function $sub(l, r) {
  if (l instanceof PfunByte && r instanceof PfunByte) {
    const n = l.value - r.value;
    if (n < 0 || n > 255) throw new Error(`Byte overflow: - produced ${n}, which is out of range (0–255).`);
    return new PfunByte(n);
  }
  const lF = typeof l === 'number', rF = typeof r === 'number';
  if (lF || rF) return _checkFloat((lF ? l : Number(l)) - (rF ? r : Number(r)), '-');
  return l - r;
}

function $mul(l, r) {
  if (l instanceof PfunByte && r instanceof PfunByte) {
    const n = l.value * r.value;
    if (n < 0 || n > 255) throw new Error(`Byte overflow: * produced ${n}, which is out of range (0–255).`);
    return new PfunByte(n);
  }
  const lF = typeof l === 'number', rF = typeof r === 'number';
  if (lF || rF) return _checkFloat((lF ? l : Number(l)) * (rF ? r : Number(r)), '*');
  return l * r;
}

function $div(l, r) {
  if (l instanceof PfunByte && r instanceof PfunByte) {
    if (r.value === 0) throw new Error('Divide by zero.');
    return new PfunByte(Math.trunc(l.value / r.value));
  }
  const lF = typeof l === 'number', rF = typeof r === 'number';
  if (lF || rF) return _checkFloat((lF ? l : Number(l)) / (rF ? r : Number(r)), '/');
  if (r === 0n) throw new Error('Divide by zero.');
  return l / r;
}

function $mod(l, r) {
  if (l instanceof PfunByte && r instanceof PfunByte) {
    if (r.value === 0) throw new Error('Divide by zero (modulo by zero).');
    return new PfunByte(l.value % r.value);
  }
  if (typeof l === 'number' || typeof r === 'number')
    throw new Error('% requires integer operands. Use floats with fmod() from mathlib.');
  if (r === 0n) throw new Error('Divide by zero (modulo by zero).');
  return l % r;
}

function $neg(v) {
  if (v instanceof PfunByte) {
    const n = -v.value;
    if (n < 0 || n > 255) throw new Error(`Byte overflow: unary - produced ${n}, which is out of range (0–255).`);
    return new PfunByte(n);
  }
  return -v;
}

// ─── Comparisons ─────────────────────────────────────────────────────────────

function $eq(l, r) {
  if (l instanceof PfunByte && r instanceof PfunByte) return l.value === r.value;
  if (l instanceof PfunByte || r instanceof PfunByte) return false;
  if (l instanceof PfunChar && r instanceof PfunChar) return l.value === r.value;
  if (l instanceof PfunChar || r instanceof PfunChar) return false;
  const lF = typeof l === 'number', rF = typeof r === 'number';
  if (lF || rF) return (lF ? l : Number(l)) === (rF ? r : Number(r));
  return l === r;
}

function $neq(l, r) { return !$eq(l, r); }

// Ordering — Int/Float comparison (same promotion rules as interpreter)
function _numCmp(l, r) {
  const lF = typeof l === 'number', rF = typeof r === 'number';
  if (lF || rF) return [(lF ? l : Number(l)), (rF ? r : Number(r))];
  return [l, r];
}
function $lt(l, r)  { const [a, b] = _numCmp(l, r); return a <  b; }
function $lte(l, r) { const [a, b] = _numCmp(l, r); return a <= b; }
function $gt(l, r)  { const [a, b] = _numCmp(l, r); return a >  b; }
function $gte(l, r) { const [a, b] = _numCmp(l, r); return a >= b; }

// ─── Bitwise operators ────────────────────────────────────────────────────────

function $bitAnd(l, r) {
  if (l instanceof PfunByte && r instanceof PfunByte) return new PfunByte((l.value & r.value) & 0xFF);
  if (typeof l === 'bigint' && typeof r === 'bigint') return l & r;
  throw new Error(`& requires both operands to be Byte or both to be Int.`);
}
function $bitOr(l, r) {
  if (l instanceof PfunByte && r instanceof PfunByte) return new PfunByte((l.value | r.value) & 0xFF);
  if (typeof l === 'bigint' && typeof r === 'bigint') return l | r;
  throw new Error(`| requires both operands to be Byte or both to be Int.`);
}
function $shl(l, r) {
  if (l instanceof PfunByte) {
    const sh = typeof r === 'bigint' ? Number(r) : (r instanceof PfunByte ? r.value : -1);
    if (sh < 0) throw new Error(`<< shift amount must be a non-negative Int or Byte.`);
    return new PfunByte((l.value << (sh & 7)) & 0xFF);
  }
  if (typeof l === 'bigint') {
    const sh = typeof r === 'bigint' ? r : (r instanceof PfunByte ? BigInt(r.value) : null);
    if (sh === null || sh < 0n) throw new Error(`<< shift amount must be a non-negative Int or Byte.`);
    return l << sh;
  }
  throw new Error(`<< requires a Byte or Int left operand.`);
}
function $shr(l, r) {
  if (l instanceof PfunByte) {
    const sh = typeof r === 'bigint' ? Number(r) : (r instanceof PfunByte ? r.value : -1);
    if (sh < 0) throw new Error(`>> shift amount must be a non-negative Int or Byte.`);
    return new PfunByte((l.value >>> (sh & 7)) & 0xFF);
  }
  if (typeof l === 'bigint') {
    const sh = typeof r === 'bigint' ? r : (r instanceof PfunByte ? BigInt(r.value) : null);
    if (sh === null || sh < 0n) throw new Error(`>> shift amount must be a non-negative Int or Byte.`);
    return l >> sh;
  }
  throw new Error(`>> requires a Byte or Int left operand.`);
}

// ─── Field access / indexing ─────────────────────────────────────────────────

function $get(obj, field) {
  if (obj && obj.__type !== undefined) {
    if (!(field in obj)) throw new Error(`Field '${field}' not found on '${obj.__type}'.`);
    return obj[field];
  }
  // Plain JS object (e.g. the inner value of Ok { status, headers, body })
  if (obj && typeof obj === 'object' && field in obj) return obj[field];
  throw new Error(`Cannot access field '${field}' on non-record value.`);
}

function $index(obj, idx) {
  if (Array.isArray(obj)) {
    if (typeof idx !== 'bigint') throw new Error(`List index must be an Int, got ${typeof idx}.`);
    const i = Number(idx);
    if (i < 0 || i >= obj.length) throw new Error(`List index ${i} out of range (length ${obj.length}).`);
    return obj[i];
  }
  if (obj instanceof PfunArray) {
    if (typeof idx !== 'bigint') throw new Error(`Array index must be an Int, got ${typeof idx}.`);
    const i = Number(idx);
    if (i < 0 || i >= obj.elements.length) throw new Error(`Array index ${i} out of range (length ${obj.elements.length}).`);
    return obj.elements[i];
  }
  if (obj instanceof PfunDict) {
    return obj.entries.get(PfunDict.keyOf(idx));
  }
  if (typeof obj === 'string') {
    if (typeof idx !== 'bigint') throw new Error(`String index must be an Int, got ${typeof idx}.`);
    const i = Number(idx);
    const chars = [...obj];
    if (i < 0 || i >= chars.length) throw new Error(`String index ${i} out of range (length ${chars.length}).`);
    return new PfunChar(chars[i]);
  }
  throw new Error(`Cannot index into value of type ${typeof obj}.`);
}

function $indexSet(obj, idx, val) {
  if (obj instanceof PfunArray) {
    if (typeof idx !== 'bigint') throw new Error(`Array index must be an Int.`);
    const i = Number(idx);
    if (i < 0 || i >= obj.elements.length) throw new Error(`Array index ${i} out of range.`);
    obj.elements[i] = val;
    return val;
  }
  if (obj instanceof PfunDict) {
    obj.entries.set(PfunDict.keyOf(idx), val);
    return val;
  }
  throw new Error(`Cannot index-assign into value of type ${typeof obj}.`);
}

// ─── Match helper ─────────────────────────────────────────────────────────────
// Arms: Array of { variant: string|null, binding: string|null, guard: fn|null, body: fn }
// variant===null means untagged (matches anything); variant===string matches __type.

function $match(subject, arms) {
  for (const arm of arms) {
    // Tagged arm: only matches when subject.__type === arm.variant
    if (arm.variant !== null && (subject == null || subject.__type !== arm.variant)) continue;
    // Guard check: arm is skipped when guard returns falsy
    if (arm.guard !== null && !$truthy(arm.guard(subject))) continue;
    return arm.body(subject);
  }
  const t = subject && subject.__type ? subject.__type : typeof subject;
  throw new Error(`Non-exhaustive match: no arm matched value of type '${t}'.`);
}

// ─── Minimal stdlib (v1) ─────────────────────────────────────────────────────
// Only the functions exercised by the v1 fixture set.  The full library.ts
// port lands in a later stage behind the same names.

function $length(v) {
  if (Array.isArray(v)) return BigInt(v.length);
  if (typeof v === 'string') return BigInt([...v].length);
  if (v instanceof PfunArray) return BigInt(v.elements.length);
  if (v instanceof PfunDict)  return BigInt(v.entries.size);
  throw new Error(`length() requires a list, array, string, or dict.`);
}

function $head(v) {
  if (typeof v === 'string') {
    if (v.length === 0) throw new Error('head() called on empty string.');
    return new PfunChar([...v][0]);
  }
  if (Array.isArray(v) && v.length > 0) return v[0];
  if ($isLazy(v)) {
    const first = $materialize(1n, v);
    if (first.length === 0) throw new Error('head() called on empty lazy sequence.');
    return first[0];
  }
  throw new Error('head() called on empty list.');
}

function $tail(v) {
  if (typeof v === 'string') return v.slice(1);
  if (Array.isArray(v)) return v.slice(1);
  if ($isLazy(v)) return new $LazyTail(v);
  throw new Error('tail() requires a list or string.');
}

// ─── Lazy sequence classes ────────────────────────────────────────────────────
// Defined here (before $map/$filter/$cons which reference them) because
// class declarations are not hoisted like function declarations.

class $LazyIterate { constructor(f, seed) { this.f = f; this.seed = seed; } }
class $LazyRepeat  { constructor(value)   { this.value = value; } }
class $LazyCycle   { constructor(source)  { this.source = source; } }
class $LazyFilter  { constructor(f, source)  { this.f = f; this.source = source; } }
class $LazyMap     { constructor(f, source)  { this.f = f; this.source = source; } }
class $LazyCons    { constructor(h, tail)    { this.h = h; this.tail = tail; } }
class $LazyTail    { constructor(source)     { this.source = source; } }

function $isLazy(v) {
  return v instanceof $LazyIterate || v instanceof $LazyRepeat
      || v instanceof $LazyCycle   || v instanceof $LazyFilter
      || v instanceof $LazyMap     || v instanceof $LazyCons
      || v instanceof $LazyTail;
}

function $map(f, v) {
  if ($isLazy(v)) return new $LazyMap(f, v);
  if (typeof v === 'string') {
    const mapped = [...v].map(c => f(new PfunChar(c)));
    if (mapped.every(x => x instanceof PfunChar)) return mapped.map(x => x.value).join('');
    return mapped;
  }
  if (Array.isArray(v)) {
    const mapped = v.map(x => f(x));
    if (mapped.every(x => x instanceof PfunChar)) return mapped.map(x => x.value).join('');
    return mapped;
  }
  throw new Error('map() requires a list, string, or lazy sequence.');
}

function $filter(f, v) {
  if ($isLazy(v)) return new $LazyFilter(f, v);
  if (typeof v === 'string') {
    const filtered = [...v].map(c => new PfunChar(c)).filter(c => $truthy(f(c)));
    return filtered.map(c => c.value).join('');
  }
  if (Array.isArray(v)) return v.filter(x => $truthy(f(x)));
  throw new Error('filter() requires a list, string, or lazy sequence.');
}

function $reduce(f, init, v) {
  const arr = typeof v === 'string' ? [...v].map(c => new PfunChar(c)) : v;
  if (Array.isArray(arr)) return arr.reduce((acc, x) => f(acc, x), init);
  throw new Error('reduce() requires a list or string.');
}

function $reverse(v) {
  if (typeof v === 'string') return [...v].reverse().join('');
  if (Array.isArray(v)) return [...v].reverse();
  throw new Error('reverse() requires a list or string.');
}

function $join(v, sep) {
  // Pfun's join(list, separator) — list is first arg, separator second.
  const s = typeof sep === 'string' ? sep : (sep instanceof PfunChar ? sep.value : $stringify(sep));
  if (Array.isArray(v)) return v.map($stringify).join(s);
  throw new Error('join() requires a list as its first argument.');
}

function $split(s, sep) {
  if (typeof s !== 'string') throw new Error('split() requires a string as first argument.');
  const d = typeof sep === 'string' ? sep : (sep instanceof PfunChar ? sep.value : $stringify(sep));
  if (d === '') return s.split('');  // plain strings, matching interpreter behavior
  return s.split(d);
}

function $range(lo, hi) {
  if (typeof lo !== 'bigint' || typeof hi !== 'bigint') throw new Error('range() requires Int arguments.');
  const result = [];
  for (let i = lo; i < hi; i++) result.push(i);
  return result;
}

function $cons(h, t) {
  if ($isLazy(t)) return new $LazyCons(h, t);
  // char cons'd onto a string → string
  if (h instanceof PfunChar && typeof t === 'string') return h.value + t;
  // char cons'd onto empty list → string
  if (h instanceof PfunChar && Array.isArray(t) && t.length === 0) return h.value;
  if (!Array.isArray(t) && typeof t !== 'string') throw new Error('cons() tail must be a list, string, or lazy sequence.');
  const arr = typeof t === 'string' ? [...t].map(c => new PfunChar(c)) : t;
  const result = [h, ...arr];
  if (result.every(x => x instanceof PfunChar)) return result.map(x => x.value).join('');
  return result;
}

function $take(n, v) {
  if (typeof n !== 'bigint') throw new Error('take() requires an Int count.');
  if (typeof v === 'string') return v.slice(0, Number(n));
  if (Array.isArray(v)) return v.slice(0, Number(n));
  // Any lazy sequence — materialise
  if ($isInfinite(v) || v instanceof $LazyFilter || v instanceof $LazyMap
      || v instanceof $LazyCons || v instanceof $LazyTail) {
    return $materialize(n, v);
  }
  throw new Error('take() requires a list, string, or lazy sequence.');
}

function $drop(n, v) {
  if (typeof n !== 'bigint') throw new Error('drop() requires an Int count.');
  const count = Number(n);
  if (typeof v === 'string') return v.slice(count);
  if (Array.isArray(v)) return v.slice(count);
  if (v instanceof $LazyIterate) {
    let cur = v.seed;
    for (let i = 0; i < count; i++) cur = v.f(cur);
    return new $LazyIterate(v.f, cur);
  }
  if (v instanceof $LazyRepeat || v instanceof $LazyCycle) return v;
  if (v instanceof $LazyFilter || v instanceof $LazyMap
      || v instanceof $LazyCons || v instanceof $LazyTail) {
    // Materialise enough to skip, then return remaining as array
    // For infinite lazy sequences this is safe since drop(n) is finite
    const big = $materialize(BigInt(count + 10000), v);
    return big.slice(count);
  }
  throw new Error('drop() requires a list, string, or lazy sequence.');
}

function $nth(v, n) {
  if (typeof n !== 'bigint') throw new Error('nth() requires an Int index.');
  const i = Number(n);
  if (Array.isArray(v)) {
    if (i < 0 || i >= v.length) return false;
    return v[i];
  }
  if (typeof v === 'string') {
    const chars = [...v];
    if (i < 0 || i >= chars.length) return false;
    return new PfunChar(chars[i]);
  }
  if ($isLazy(v)) {
    const materialized = $materialize(BigInt(i + 1), v);
    if (i >= materialized.length) return false;
    return materialized[i];
  }
  throw new Error('nth() requires a list, string, or lazy sequence.');
}

// ─── Char / String ────────────────────────────────────────────────────────────

function $asc(c) {
  if (!(c instanceof PfunChar)) throw new Error('asc() requires a char argument.');
  return BigInt(c.value.codePointAt(0));
}

function $chr(n) {
  if (typeof n !== 'bigint') throw new Error('chr() requires an integer argument.');
  return new PfunChar(String.fromCodePoint(Number(n)));
}

function $__str__(v) { return $stringify(v); }

// ─── List: slice, find, findSlice ─────────────────────────────────────────────

function $slice(start, count, list) {
  const s = Number(start), c = Number(count);
  if (typeof list === 'string') return list.slice(s, s + c);
  if (Array.isArray(list)) return list.slice(s, s + c);
  if ($isLazy(list)) return $take(BigInt(c), $drop(BigInt(s), list));
  throw new Error('slice() requires a list, string, or lazy sequence.');
}

function _valEqual(a, b) {
  if (a === b) return true;
  if (a instanceof PfunChar && b instanceof PfunChar) return a.value === b.value;
  if (a instanceof PfunByte && b instanceof PfunByte) return a.value === b.value;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!_valEqual(a[i], b[i])) return false;
    return true;
  }
  if (a && b && a.__type && a.__type === b.__type) {
    const ak = Object.keys(a).filter(k => k !== '__type' && k !== '__union');
    const bk = Object.keys(b).filter(k => k !== '__type' && k !== '__union');
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (!_valEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

function $find(list, item) {
  const arr = Array.isArray(list) ? list
    : (list instanceof PfunArray ? list.elements
    : (typeof list === 'string' ? [...list].map(c => new PfunChar(c)) : null));
  if (!arr) throw new Error('find() requires a list, array, or string.');
  for (let i = 0; i < arr.length; i++) {
    if (_valEqual(arr[i], item)) return { __type: 'Some', __union: 'Option', value: BigInt(i) };
  }
  return { __type: 'None', __union: 'Option' };
}

function $findSlice(list, pattern) {
  const arr = Array.isArray(list) ? list
    : (typeof list === 'string' ? [...list].map(c => new PfunChar(c)) : null);
  const pat = Array.isArray(pattern) ? pattern
    : (typeof pattern === 'string' ? [...pattern].map(c => new PfunChar(c)) : null);
  if (!arr || !pat) throw new Error('findSlice() requires lists or strings.');
  if (pat.length === 0) return { __type: 'Some', __union: 'Option', value: 0n };
  outer: for (let i = 0; i <= arr.length - pat.length; i++) {
    for (let j = 0; j < pat.length; j++) { if (!_valEqual(arr[i + j], pat[j])) continue outer; }
    return { __type: 'Some', __union: 'Option', value: BigInt(i) };
  }
  return { __type: 'None', __union: 'Option' };
}

// ─── Lazy sequence constructors ───────────────────────────────────────────────
// Classes are defined above (before $map/$filter which reference them).

function $iterate(f, seed) { return new $LazyIterate(f, seed); }
function $repeat(value)    { return new $LazyRepeat(value); }
function $cycle(source)    { return new $LazyCycle(source); }
function $isInfinite(v)    { return $isLazy(v); }

// Materialise exactly `n` elements from any sequence (lazy or eager).
function $materialize(n, v) {
  if (typeof n !== 'bigint') throw new Error('take() requires an Int count.');
  const count = Number(n);
  if (typeof v === 'string') return v.slice(0, count);
  if (Array.isArray(v)) return v.slice(0, count);

  // For lazy sequences, use a generator to pull elements one at a time.
  function* gen(seq) {
    if (seq instanceof $LazyIterate) {
      let cur = seq.seed;
      while (true) { yield cur; cur = seq.f(cur); }
    } else if (seq instanceof $LazyRepeat) {
      while (true) yield seq.value;
    } else if (seq instanceof $LazyCycle) {
      const src = seq.source; if (!src.length) return;
      let i = 0;
      while (true) { yield src[i % src.length]; i++; }
    } else if (seq instanceof $LazyFilter) {
      for (const x of gen(seq.source)) { if ($truthy(seq.f(x))) yield x; }
    } else if (seq instanceof $LazyMap) {
      for (const x of gen(seq.source)) yield seq.f(x);
    } else if (seq instanceof $LazyCons) {
      yield seq.h;
      yield* gen(seq.tail);
    } else if (seq instanceof $LazyTail) {
      let first = true;
      for (const x of gen(seq.source)) { if (first) { first = false; continue; } yield x; }
    } else if (Array.isArray(seq)) {
      yield* seq;
    }
  }

  const result = [];
  for (const x of gen(v)) {
    result.push(x);
    if (result.length >= count) break;
  }
  return result;
}

// ─── Numeric casts & predicates ───────────────────────────────────────────────

function $toFloat(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (isNaN(n)) throw new Error(`toFloat: cannot convert string "${v}" to float.`);
    return n;
  }
  throw new Error(`toFloat() requires a number or string, got ${typeof v}.`);
}

function $toInt(v) {
  if (typeof v === 'bigint') return v;
  if (v instanceof PfunByte) return BigInt(v.value);
  if (typeof v === 'number') {
    if (!isFinite(v) || isNaN(v)) throw new Error('toInt: cannot convert NaN or Infinity to integer.');
    return BigInt(Math.trunc(v));
  }
  throw new Error(`toInt() requires a number or Byte, got ${typeof v}.`);
}

function $floor(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') { if (!isFinite(v) || isNaN(v)) throw new Error('floor: cannot floor NaN or Infinity.'); return BigInt(Math.floor(v)); }
  throw new Error(`floor() requires a number, got ${typeof v}.`);
}

function $ceil(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') { if (!isFinite(v) || isNaN(v)) throw new Error('ceil: cannot ceil NaN or Infinity.'); return BigInt(Math.ceil(v)); }
  throw new Error(`ceil() requires a number, got ${typeof v}.`);
}

function $round(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') { if (!isFinite(v) || isNaN(v)) throw new Error('round: cannot round NaN or Infinity.'); return BigInt(Math.round(v)); }
  throw new Error(`round() requires a number, got ${typeof v}.`);
}

function $isNaN(v)    { return typeof v === 'number' && Number.isNaN(v); }
function $isFinite(v) { if (typeof v === 'bigint') return true; if (typeof v === 'number') return Number.isFinite(v); return false; }

// ─── Byte / Char conversions ──────────────────────────────────────────────────

function $toByte(v) {
  if (v instanceof PfunByte) return v;
  if (typeof v === 'bigint') { const n = Number(v); if (n < 0 || n > 255) throw new Error(`toByte: value ${n} is out of range (0–255).`); return new PfunByte(n); }
  if (v instanceof PfunChar) { const cp = v.value.codePointAt(0); if (cp > 255) throw new Error(`toByte: char '${v.value}' has codepoint ${cp}, out of range (0–255).`); return new PfunByte(cp); }
  throw new Error(`toByte() requires an Int or Char, got ${typeof v}.`);
}

function $toChar(v) {
  if (!(v instanceof PfunByte)) throw new Error(`toChar() requires a Byte, got ${typeof v}.`);
  return new PfunChar(String.fromCodePoint(v.value));
}

function $charBytes(v) {
  if (!(v instanceof PfunChar)) throw new Error(`charBytes() requires a Char, got ${typeof v}.`);
  const buf = Buffer.from(v.value, 'utf8');
  return Array.from(buf, b => new PfunByte(b));
}

function $bytesToChar(v) {
  if (!Array.isArray(v) || !v.every(b => b instanceof PfunByte)) throw new Error('bytesToChar() requires a List<Byte>.');
  const s = Buffer.from(v.map(b => b.value)).toString('utf8');
  const codepoints = [...s];
  if (codepoints.length !== 1) throw new Error(`bytesToChar: decoded to ${codepoints.length} codepoints, expected 1.`);
  return new PfunChar(codepoints[0]);
}

// ─── Mutable structure helpers ────────────────────────────────────────────────
// Direct ports of mutStructures.ts — registered globally in the interpreter
// (no import needed), so these are part of pfun-runtime too.

// ── Array construction ────────────────────────────────────────────────────────

// $array_from([e0, e1, ...]) — constructs a PfunArray from a JS array literal.
// Used by the transpiler's ArrayExpr emission: array { 1, 2, 3 } → $array_from([1n, 2n, 3n])
function $array_from(elements) {
  const arr = new PfunArray([...elements]);
  if (elements.length > 0) {
    const first = elements[0];
    if (first instanceof PfunChar)  arr.elementType = 'char';
    else if (typeof first === 'bigint') arr.elementType = 'bigint';
    else if (typeof first === 'boolean') arr.elementType = 'boolean';
    else if (typeof first === 'string') arr.elementType = 'string';
    else if (Array.isArray(first))  arr.elementType = 'list';
    else if (first && first.__union) arr.elementType = first.__union;
    else if (first && first.__type)  arr.elementType = first.__type;
  }
  return arr;
}

// $dict_from([[k0,v0], [k1,v1], ...]) — constructs a PfunDict from entries.
// Used by the transpiler's DictExpr emission: dict { k -> v } → $dict_from([[k,v]])
function $dict_from(entries) {
  const map = new Map();
  for (const [k, v] of entries) map.set(PfunDict.keyOf(k), v);
  return new PfunDict(map);
}

// ── Array operations ──────────────────────────────────────────────────────────

function $arrayLength(arr) {
  if (!(arr instanceof PfunArray)) throw new Error('arrayLength() requires an array.');
  return BigInt(arr.elements.length);
}

function $append(arr, val) {
  if (!(arr instanceof PfunArray)) throw new Error("append() requires an array as first argument.");
  arr.elements.push(val);
  return arr;
}

function $removeAt(arr, idx) {
  if (!(arr instanceof PfunArray)) throw new Error("removeAt() requires an array as first argument.");
  if (typeof idx !== 'bigint') throw new Error("removeAt() requires an integer index.");
  const i = Number(idx);
  if (i < 0 || i >= arr.elements.length) throw new Error(`removeAt() index ${i} out of bounds (length ${arr.elements.length}).`);
  arr.elements.splice(i, 1);
  return arr;
}

function $insertAt(arr, idx, val) {
  if (!(arr instanceof PfunArray)) throw new Error("insertAt() requires an array as first argument.");
  if (typeof idx !== 'bigint') throw new Error("insertAt() requires an integer index.");
  const i = Number(idx);
  if (i < 0 || i > arr.elements.length) throw new Error(`insertAt() index ${i} out of bounds (length ${arr.elements.length}).`);
  arr.elements.splice(i, 0, val);
  return arr;
}

function $toList(arr) {
  if (!(arr instanceof PfunArray)) throw new Error("toList() requires an array.");
  return [...arr.elements];
}

function $toArray(val) {
  if (val instanceof PfunArray) return new PfunArray([...val.elements]);
  if (typeof val === 'string') {
    const chars = [...val].map(c => new PfunChar(c));
    const arr = new PfunArray(chars);
    if (chars.length > 0) arr.elementType = 'char';
    return arr;
  }
  if (Array.isArray(val)) {
    const arr = new PfunArray([...val]);
    if (val.length > 0) {
      const first = val[0];
      if (first instanceof PfunChar)  arr.elementType = 'char';
      else if (typeof first === 'bigint') arr.elementType = 'bigint';
      else if (typeof first === 'boolean') arr.elementType = 'boolean';
      else if (typeof first === 'string') arr.elementType = 'string';
      else if (Array.isArray(first))  arr.elementType = 'list';
      else if (first && first.__union) arr.elementType = first.__union;
      else if (first && first.__type)  arr.elementType = first.__type;
    }
    return arr;
  }
  throw new Error("toArray() requires a list, array, or string.");
}

function $toDict(arr) {
  if (!(arr instanceof PfunArray)) throw new Error("toDict() requires an array.");
  const map = new Map();
  arr.elements.forEach((v, i) => map.set(`i:${i}`, v));
  return new PfunDict(map);
}

// ── Dict operations ───────────────────────────────────────────────────────────

function $has(dict, key) {
  if (!(dict instanceof PfunDict)) throw new Error("has() requires a dict as first argument.");
  return dict.entries.has(PfunDict.keyOf(key));
}

function $remove(dict, key) {
  if (!(dict instanceof PfunDict)) throw new Error("remove() requires a dict as first argument.");
  dict.entries.delete(PfunDict.keyOf(key));
  return dict;
}

function $keys(dict) {
  if (!(dict instanceof PfunDict)) throw new Error("keys() requires a dict as first argument.");
  return [...dict.entries.keys()].map(k => {
    const prefix = k.slice(0, 2), raw = k.slice(2);
    if (prefix === 's:') return raw;
    if (prefix === 'i:') return BigInt(raw);
    if (prefix === 'b:') return raw === 'true';
    return raw;
  });
}

function $values(dict) {
  if (!(dict instanceof PfunDict)) throw new Error("values() requires a dict as first argument.");
  return [...dict.entries.values()];
}

// ── Dict / Pair conversions ───────────────────────────────────────────────────

function $dictToList(dict) {
  if (!(dict instanceof PfunDict)) throw new Error("dictToList() requires a dict.");
  return [...dict.entries.entries()].map(([k, v]) => {
    const prefix = k.slice(0, 2), raw = k.slice(2);
    let key;
    if (prefix === 's:') key = raw;
    else if (prefix === 'i:') key = BigInt(raw);
    else if (prefix === 'b:') key = raw === 'true';
    else key = raw;
    return { __type: 'Pair', key, value: v };
  });
}

function $listToDict(list) {
  if (!Array.isArray(list)) throw new Error("listToDict() requires a list of Pair records.");
  const map = new Map();
  for (const item of list) {
    if (!item || item.__type !== 'Pair') throw new Error("listToDict() requires a list of Pair records.");
    map.set(PfunDict.keyOf(item.key), item.value);
  }
  return new PfunDict(map);
}

// ─── Buffer operations (moved from mutStructures.ts) ─────────────────────────
// makeBuffer, appendBuffer, appendChar, appendString, makeStringBuffer,
// bufferToBytes, bufferToString, bufferLength all live here since they're
// core mutable structures — no import needed.

class PfunBuffer {
  constructor(mode, capacity = 4096) {
    this.mode = mode;  // 'byte' | 'char'
    this.data = Buffer.alloc(capacity);
    this.pos  = 0;
  }
  append(bytes) {
    if (this.pos + bytes.length > this.data.length) {
      let newCap = this.data.length * 2 || 16;
      while (newCap < this.pos + bytes.length) newCap *= 2;
      const grown = Buffer.alloc(newCap);
      this.data.copy(grown);
      this.data = grown;
    }
    bytes.copy(this.data, this.pos);
    this.pos += bytes.length;
  }
  toByteList() {
    const out = [];
    for (let i = 0; i < this.pos; i++) out.push(new PfunByte(this.data[i]));
    return out;
  }
}

// BufferMode union values (no import needed)
const ByteMode = { __type: 'ByteMode', __union: 'BufferMode' };
const CharMode  = { __type: 'CharMode',  __union: 'BufferMode' };

function $makeBuffer(mode) {
  if (!mode || (mode.__type !== 'ByteMode' && mode.__type !== 'CharMode'))
    throw new Error('makeBuffer: mode must be ByteMode or CharMode.');
  return new PfunBuffer(mode.__type === 'ByteMode' ? 'byte' : 'char');
}

function $makeStringBuffer(str) {
  if (typeof str !== 'string') throw new Error('makeStringBuffer: argument must be a string.');
  const pbuf = new PfunBuffer('char', Math.max(Buffer.byteLength(str, 'utf8') * 2, 16));
  pbuf.append(Buffer.from(str, 'utf8'));
  return pbuf;
}

function $appendBuffer(pbuf, bytes) {
  if (!(pbuf instanceof PfunBuffer)) throw new Error('appendBuffer: first argument must be a Buffer.');
  if (!Array.isArray(bytes) || !bytes.every(b => b instanceof PfunByte))
    throw new Error('appendBuffer: second argument must be a List<Byte>.');
  pbuf.append(Buffer.from(bytes.map(b => b.value)));
  return pbuf;
}

function $appendChar(pbuf, c) {
  if (!(pbuf instanceof PfunBuffer)) throw new Error('appendChar: first argument must be a Buffer.');
  if (!(c instanceof PfunChar)) throw new Error('appendChar: second argument must be a char.');
  pbuf.append(Buffer.from(c.value, 'utf8'));
  return pbuf;
}

function $appendString(pbuf, str) {
  if (!(pbuf instanceof PfunBuffer)) throw new Error('appendString: first argument must be a Buffer.');
  if (typeof str !== 'string') throw new Error('appendString: second argument must be a string.');
  pbuf.append(Buffer.from(str, 'utf8'));
  return pbuf;
}

function $bufferToBytes(pbuf) {
  if (!(pbuf instanceof PfunBuffer)) throw new Error('bufferToBytes: argument must be a Buffer.');
  return pbuf.toByteList();
}

function $bufferToString(pbuf) {
  if (!(pbuf instanceof PfunBuffer)) throw new Error('bufferToString: argument must be a Buffer.');
  return pbuf.data.toString('utf8', 0, pbuf.pos);
}

function $bufferLength(pbuf) {
  if (!(pbuf instanceof PfunBuffer)) throw new Error('bufferLength: argument must be a Buffer.');
  return BigInt(pbuf.pos);
}

// ─── Option (builtin union seeded into schema) ────────────────────────────────
$registerType('Some',  ['value'], 'Option');
$registerType('None',  [],        'Option');
$schema['None']._singleton = { __type: 'None', __union: 'Option' };

// Convenience: the transpiler emits None as a reference to the singleton
// object; Some { x } is emitted as $record('Some', [x]).
const None = { __type: 'None', __union: 'Option' };
function Some(value) { return $record('Some', [value]); }

// ─── Exports ─────────────────────────────────────────────────────────────────
// ─── Exports ─────────────────────────────────────────────────────────────────
module.exports = {
  PfunChar, PfunByte, PfunArray, PfunDict, PfunBuffer,
  $curry, $memoize,
  $char, $byte, $record, $registerType, $schema,
  $stringify, $println, $print, $flushStdout, $mountHtml, $clearOutput, $attachDomHandler, $httpPost, $truthy,
  $readln, $readChar, $scriptArgs, $getEnv, $envVars,
  $ck,
  $add, $sub, $mul, $div, $mod, $neg,
  $eq, $neq, $lt, $lte, $gt, $gte,
  $bitAnd, $bitOr, $shl, $shr,
  $get, $index, $indexSet,
  $match,
  // Core list ops — multi-arg ones wrapped for currying
  $length,
  $head, $tail, $reverse,
  $map:      $curry($map, 2),
  $filter:   $curry($filter, 2),
  $reduce:   $curry($reduce, 3),
  $join:     $curry($join, 2),
  $split:    $curry($split, 2),
  $range:    $curry($range, 2),
  $cons:     $curry($cons, 2),
  $take:     $curry($take, 2),
  $drop:     $curry($drop, 2),
  $nth:      $curry($nth, 2),
  // Extended list ops
  $slice:    $curry($slice, 3),
  $find:     $curry($find, 2),
  $findSlice:$curry($findSlice, 2),
  // Lazy sequences
  $iterate:  $curry($iterate, 2),
  $repeat, $cycle, $isInfinite, $isLazy,
  $LazyIterate, $LazyRepeat, $LazyCycle,
  $LazyFilter, $LazyMap, $LazyCons, $LazyTail,
  // Char / String
  $asc, $chr, $__str__,
  // Numeric casts & predicates
  $toFloat, $toInt, $floor, $ceil, $round, $isNaN, $isFinite,
  // Byte / Char conversions
  $toByte, $toChar, $charBytes, $bytesToChar,
  // Mutable array construction
  $array_from, $dict_from,
  // Array operations — multi-arg wrapped
  $arrayLength,
  $toList, $toArray, $toDict,
  $append:   $curry($append, 2),
  $removeAt: $curry($removeAt, 2),
  $insertAt: $curry($insertAt, 3),
  // Dict operations
  $has:      $curry($has, 2),
  $remove:   $curry($remove, 2),
  $keys, $values,
  // Dict / Pair conversions
  $dictToList, $listToDict,
  // Buffer operations
  $makeBuffer, $makeStringBuffer,
  $appendBuffer: $curry($appendBuffer, 2),
  $appendChar:   $curry($appendChar, 2),
  $appendString: $curry($appendString, 2),
  $bufferToBytes, $bufferToString, $bufferLength,
  ByteMode, CharMode,
  None, Some,
};
