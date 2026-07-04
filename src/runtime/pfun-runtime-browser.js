// pfun-runtime-browser.js — browser runtime for transpiled Pfun programs.
//
// This is a browser-compatible subset of pfun-runtime.js. It exports the same
// names so the transpiler can treat it identically, but:
//   - No process/Buffer/fs — replaced with stubs or removed
//   - $println / $print append to the DOM output element
//   - stdin functions ($readln, $readChar) are no-ops returning None
//   - Exported via a global `__pfun` object (no CommonJS require)
//
// Loaded as a plain <script> tag; the inlined compiled program expects
// the same destructured names as the Node version.

(function() {
'use strict';

// ─── Currying & memoization ───────────────────────────────────────────────────

function $curry(fn, arity) {
  if (arity <= 1) return fn;
  function curried(...args) {
    if (args.length >= arity) return fn(...args);
    return $curry((...more) => curried(...args, ...more), arity - args.length);
  }
  return curried;
}

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

// ─── Value constructors ───────────────────────────────────────────────────────

class PfunChar {
  constructor(value) { this.value = value; }
}

class PfunByte {
  constructor(value) { this.value = value; }
}

class PfunArray {
  constructor(elements) { this.elements = elements; this.elementType = null; }
  static from(elements) { return new PfunArray(elements); }
}

class PfunDict {
  constructor(entries) { this.entries = entries instanceof Map ? entries : new Map(); }
  static keyOf(k) {
    if (typeof k === 'string')  return 's:' + k;
    if (typeof k === 'bigint')  return 'i:' + k.toString();
    if (typeof k === 'boolean') return 'b:' + k;
    return 's:' + String(k);
  }
}

class PfunBuffer {
  constructor(mode, capacity = 4096) {
    this.mode = mode;
    this.bytes = new Uint8Array(capacity);
    this.pos = 0;
  }
  append(bytes) {
    if (this.pos + bytes.length > this.bytes.length) {
      let newCap = this.bytes.length * 2 || 16;
      while (newCap < this.pos + bytes.length) newCap *= 2;
      const grown = new Uint8Array(newCap);
      grown.set(this.bytes.subarray(0, this.pos));
      this.bytes = grown;
    }
    this.bytes.set(bytes, this.pos);
    this.pos += bytes.length;
  }
  toByteList() {
    const out = [];
    for (let i = 0; i < this.pos; i++) out.push(new PfunByte(this.bytes[i]));
    return out;
  }
}

function $char(c) { return new PfunChar(c); }
function $byte(n) { return new PfunByte(n); }
function $record(typeName, fieldValues) {
  const entry = $schema[typeName];
  if (!entry) throw new Error(`Unknown type '${typeName}'.`);
  const obj = { __type: typeName };
  if (entry.unionName) obj.__union = entry.unionName;
  entry.fields.forEach((f, i) => { obj[f] = fieldValues[i]; });
  return obj;
}
function $registerType(typeName, fields, unionName) {
  $schema[typeName] = { fields, unionName: unionName ?? null };
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const $schema = {
  Pair:    { fields: ['key', 'value'],   unionName: null },
  Some:    { fields: ['value'],          unionName: 'Option' },
  None:    { fields: [],                 unionName: 'Option' },
  Ok:      { fields: ['value'],          unionName: 'Result' },
  Err:     { fields: ['message'],        unionName: 'Result' },
  DbInt:   { fields: ['value'],  unionName: 'DbValue' },
  DbFloat: { fields: ['value'],  unionName: 'DbValue' },
  DbText:  { fields: ['value'],  unionName: 'DbValue' },
  DbBool:  { fields: ['value'],  unionName: 'DbValue' },
  DbBytes: { fields: ['value'],  unionName: 'DbValue' },
  DbNull:  { fields: [],         unionName: 'DbValue' },
};

// ─── DOM output ───────────────────────────────────────────────────────────────

let _outputEl = null;
let _pendingLine = '';

function _getOutput() {
  if (!_outputEl) _outputEl = document.getElementById('pfun-output');
  return _outputEl;
}

function _appendText(text) {
  const el = _getOutput();
  if (!el) { console.log(text); return; }
  // Split on newlines and append as separate lines.
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    _pendingLine += lines[i];
    if (i < lines.length - 1) {
      const div = document.createElement('div');
      div.textContent = _pendingLine || '\u00a0'; // non-breaking space for blank lines
      el.appendChild(div);
      _pendingLine = '';
    }
  }
}

function $println(value) { _appendText($stringify(value) + '\n'); }
function $print(value)   { _appendText($stringify(value)); }
function $flushStdout()  { /* no-op in browser */ }

// stdin — not available in browser; return None
function $readln()   { return { __type: 'None', __union: 'Option' }; }
function $readChar() { return { __type: 'None', __union: 'Option' }; }
function $scriptArgs() { return []; }
function $getEnv(_name) { return { __type: 'None', __union: 'Option' }; }
function $envVars() { return []; }

// ─── Stringify ────────────────────────────────────────────────────────────────

function _checkFloat(result, op) {
  if (!isFinite(result) || isNaN(result))
    throw new Error(`${op} produced ${result}`);
  return result;
}

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
    const pairs = [];
    for (const [k, v] of value.entries.entries()) {
      const key = k.slice(2);
      pairs.push(`${key}: ${$stringify(v)}`);
    }
    return `{${pairs.join(', ')}}`;
  }
  if (value instanceof PfunArray) {
    return `[${value.elements.map($stringify).join(', ')}]`;
  }
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(c => c instanceof PfunChar))
      return value.map(c => c.value).join('');
    return `[${value.map($stringify).join(', ')}]`;
  }
  if (value && typeof value === 'object') {
    if (value.__type === 'None') return 'None';
    if (value.__type) {
      const entry = $schema[value.__type];
      if (!entry || entry.fields.length === 0) return value.__type;
      const fields = entry.fields.map(f => $stringify(value[f])).join(', ');
      return `${value.__type} { ${fields} }`;
    }
    return String(value);
  }
  return String(value);
}

function $truthy(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'bigint')  return v !== 0n;
  if (typeof v === 'number')  return v !== 0;
  if (typeof v === 'string')  return v.length > 0;
  if (Array.isArray(v))       return v.length > 0;
  if (v instanceof PfunChar)  return true;
  if (v instanceof PfunByte)  return true;
  if (v && v.__type === 'None') return false;
  return true;
}

// ─── Arithmetic ───────────────────────────────────────────────────────────────

function $ck(result, op) { return _checkFloat(result, op ?? '?'); }

function $add(l, r) {
  if (typeof l === 'bigint' && typeof r === 'bigint') return l + r;
  if (typeof l === 'number' || typeof r === 'number') {
    const ln = typeof l === 'bigint' ? Number(l) : l;
    const rn = typeof r === 'bigint' ? Number(r) : r;
    return _checkFloat(ln + rn, '+');
  }
  if (typeof l === 'string' || typeof r === 'string')
    return $stringify(l) + $stringify(r);
  if (l instanceof PfunChar && r instanceof PfunChar) return l.value + r.value;
  if (l instanceof PfunByte && r instanceof PfunByte) {
    const n = l.value + r.value;
    if (n > 255) throw new Error(`Byte overflow: + produced ${n}`);
    return new PfunByte(n);
  }
  if (Array.isArray(l) && Array.isArray(r)) return [...l, ...r];
  throw new Error(`Cannot add ${typeof l} and ${typeof r}`);
}

function $sub(l, r) {
  if (typeof l === 'bigint' && typeof r === 'bigint') return l - r;
  return _checkFloat(Number(l) - Number(r), '-');
}
function $mul(l, r) {
  if (typeof l === 'bigint' && typeof r === 'bigint') return l * r;
  return _checkFloat(Number(l) * Number(r), '*');
}
function $div(l, r) {
  if (typeof l === 'bigint' && typeof r === 'bigint') {
    if (r === 0n) throw new Error('Division by zero');
    return l / r;
  }
  const rn = Number(r);
  if (rn === 0) throw new Error('Division by zero');
  return _checkFloat(Number(l) / rn, '/');
}
function $mod(l, r) {
  if (typeof l === 'bigint' && typeof r === 'bigint') {
    if (r === 0n) throw new Error('Modulo by zero');
    return l % r;
  }
  const rn = Number(r);
  if (rn === 0) throw new Error('Modulo by zero');
  return _checkFloat(Number(l) % rn, '%');
}
function $neg(v) {
  if (typeof v === 'bigint') return -v;
  return _checkFloat(-Number(v), 'neg');
}

function $eq(a, b)  {
  if (a === b) return true;
  if (a instanceof PfunChar && b instanceof PfunChar) return a.value === b.value;
  if (a instanceof PfunByte && b instanceof PfunByte) return a.value === b.value;
  if (a && b && a.__type && a.__type === b.__type) {
    const entry = $schema[a.__type];
    if (!entry) return false;
    return entry.fields.every(f => $eq(a[f], b[f]));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => $eq(x, b[i]));
  }
  return false;
}
function $neq(a, b) { return !$eq(a, b); }
function $lt(a, b)  {
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b;
  return Number(a) < Number(b);
}
function $gt(a, b)  {
  if (typeof a === 'bigint' && typeof b === 'bigint') return a > b;
  return Number(a) > Number(b);
}
function $lte(a, b) {
  if (typeof a === 'bigint' && typeof b === 'bigint') return a <= b;
  return Number(a) <= Number(b);
}
function $gte(a, b) {
  if (typeof a === 'bigint' && typeof b === 'bigint') return a >= b;
  return Number(a) >= Number(b);
}
function $bitAnd(a, b) { return a & b; }
function $bitOr(a, b)  { return a | b; }
function $shl(a, b)    { return a << b; }
function $shr(a, b)    { return a >> b; }

// ─── Record field access ──────────────────────────────────────────────────────

function $get(obj, field) {
  if (obj && obj.__type !== undefined) {
    if (!(field in obj)) throw new Error(`Field '${field}' not found on '${obj.__type}'.`);
    return obj[field];
  }
  if (obj && typeof obj === 'object' && field in obj) return obj[field];
  throw new Error(`Cannot access field '${field}' on non-record value.`);
}
function $index(obj, idx) {
  if (Array.isArray(obj)) {
    if (typeof idx !== 'bigint') throw new Error('List index must be an Int.');
    const i = Number(idx);
    if (i < 0 || i >= obj.length) throw new Error(`List index ${i} out of range.`);
    return obj[i];
  }
  if (obj instanceof PfunArray) {
    const i = Number(idx);
    if (i < 0 || i >= obj.elements.length) throw new Error(`Array index ${i} out of range.`);
    return obj.elements[i];
  }
  if (obj instanceof PfunDict) return obj.entries.get(PfunDict.keyOf(idx));
  if (typeof obj === 'string') {
    const chars = [...obj];
    const i = Number(idx);
    if (i < 0 || i >= chars.length) return undefined;
    return new PfunChar(chars[i]);
  }
  throw new Error('Index requires a list, array, dict, or string.');
}
function $indexSet(obj, idx, val) {
  if (obj instanceof PfunArray) { obj.elements[Number(idx)] = val; return obj; }
  if (obj instanceof PfunDict)  { obj.entries.set(PfunDict.keyOf(idx), val); return obj; }
  throw new Error('Index-set requires an array or dict.');
}

// ─── Pattern matching ─────────────────────────────────────────────────────────

function $match(subject, arms) {
  for (const arm of arms) {
    if (arm.variant !== null && (subject == null || subject.__type !== arm.variant)) continue;
    if (arm.guard !== null && !$truthy(arm.guard(subject))) continue;
    return arm.body(subject);
  }
  const t = subject && subject.__type ? subject.__type : typeof subject;
  throw new Error(`Non-exhaustive match: no arm matched value of type '${t}'.`);
}

// ─── Lazy sequence classes ────────────────────────────────────────────────────

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
function $iterate(f, seed) { return new $LazyIterate(f, seed); }
function $repeat(value)    { return new $LazyRepeat(value); }
function $cycle(source)    { return new $LazyCycle(source); }
function $isInfinite(v)    { return $isLazy(v); }

function $materialize(n, v) {
  if (typeof n !== 'bigint') throw new Error('take() requires an Int count.');
  const count = Number(n);
  if (typeof v === 'string') return v.slice(0, count);
  if (Array.isArray(v)) return v.slice(0, count);

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
  for (const x of gen(v)) { result.push(x); if (result.length >= count) break; }
  return result;
}

// ─── List operations ──────────────────────────────────────────────────────────

function $length(v) {
  if (typeof v === 'string')    return BigInt(v.length);
  if (Array.isArray(v))         return BigInt(v.length);
  if (v instanceof PfunArray)   return BigInt(v.elements.length);
  if (v instanceof PfunDict)    return BigInt(v.entries.size);
  throw new Error('length() requires a list, array, string, or dict.');
}
function $head(v) {
  if (typeof v === 'string') {
    if (v.length === 0) throw new Error('head() called on empty string.');
    return new PfunChar([...v][0]);
  }
  if (Array.isArray(v) && v.length > 0) return v[0];
  if ($isLazy(v)) { const f = $materialize(1n, v); if (!f.length) throw new Error('head() on empty lazy.'); return f[0]; }
  throw new Error('head() called on empty list.');
}
function $tail(v) {
  if (typeof v === 'string') return v.slice(1);
  if (Array.isArray(v)) return v.slice(1);
  if ($isLazy(v)) return new $LazyTail(v);
  throw new Error('tail() requires a list or string.');
}
function $map(f, v) {
  if ($isLazy(v)) return new $LazyMap(f, v);
  if (typeof v === 'string') {
    const mapped = [...v].map(c => f(new PfunChar(c)));
    if (mapped.length > 0 && mapped.every(x => x instanceof PfunChar)) return mapped.map(x => x.value).join('');
    return mapped;
  }
  if (Array.isArray(v)) {
    const mapped = v.map(x => f(x));
    if (mapped.length > 0 && mapped.every(x => x instanceof PfunChar)) return mapped.map(x => x.value).join('');
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
  const s = sep instanceof PfunChar ? sep.value : (typeof sep === 'string' ? sep : $stringify(sep));
  if (Array.isArray(v)) return v.map($stringify).join(s);
  throw new Error('join() requires a list.');
}
function $split(s, sep) {
  if (typeof s !== 'string') throw new Error('split() requires a string.');
  const d = typeof sep === 'string' ? sep : (sep instanceof PfunChar ? sep.value : $stringify(sep));
  if (d === '') return s.split('');
  return s.split(d);
}
function $range(lo, hi) {
  const l = Number(lo), h = Number(hi);
  const result = [];
  for (let i = l; i <= h; i++) result.push(BigInt(i));
  return result;
}
function $cons(h, t) {
  if ($isLazy(t)) return new $LazyCons(h, t);
  if (h instanceof PfunChar && typeof t === 'string') return h.value + t;
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
  if ($isLazy(v)) return $materialize(n, v);
  throw new Error('take() requires a list, string, or lazy sequence.');
}
function $drop(n, v) {
  if (typeof n !== 'bigint') throw new Error('drop() requires an Int count.');
  const count = Number(n);
  if (typeof v === 'string') return v.slice(count);
  if (Array.isArray(v)) return v.slice(count);
  if (v instanceof $LazyIterate) { let cur = v.seed; for (let i = 0; i < count; i++) cur = v.f(cur); return new $LazyIterate(v.f, cur); }
  if (v instanceof $LazyRepeat || v instanceof $LazyFilter || v instanceof $LazyMap || v instanceof $LazyCons || v instanceof $LazyTail) {
    const big = $materialize(BigInt(count + 10000), v);
    return big.slice(count);
  }
  if (v instanceof $LazyCycle) return v;
  throw new Error('drop() requires a list, string, or lazy sequence.');
}
function $nth(v, n) {
  if (typeof n !== 'bigint') throw new Error('nth() requires an Int index.');
  const i = Number(n);
  if (Array.isArray(v)) { if (i < 0 || i >= v.length) return false; return v[i]; }
  if (typeof v === 'string') { const chars = [...v]; if (i < 0 || i >= chars.length) return false; return new PfunChar(chars[i]); }
  if ($isLazy(v)) { const m = $materialize(BigInt(i + 1), v); return i >= m.length ? false : m[i]; }
  throw new Error('nth() requires a list, string, or lazy sequence.');
}
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
  return a === b;
}
function $find(list, item) {
  const arr = Array.isArray(list) ? list : (typeof list === 'string' ? [...list].map(c => new PfunChar(c)) : null);
  if (!arr) throw new Error('find() requires a list or string.');
  for (let i = 0; i < arr.length; i++) if (_valEqual(arr[i], item)) return { __type: 'Some', __union: 'Option', value: BigInt(i) };
  return { __type: 'None', __union: 'Option' };
}
function $findSlice(list, pattern) {
  const arr = Array.isArray(list) ? list : (typeof list === 'string' ? [...list].map(c => new PfunChar(c)) : null);
  const pat = Array.isArray(pattern) ? pattern : (typeof pattern === 'string' ? [...pattern].map(c => new PfunChar(c)) : null);
  if (!arr || !pat) throw new Error('findSlice() requires lists or strings.');
  if (pat.length === 0) return { __type: 'Some', __union: 'Option', value: 0n };
  outer: for (let i = 0; i <= arr.length - pat.length; i++) {
    for (let j = 0; j < pat.length; j++) { if (!_valEqual(arr[i + j], pat[j])) continue outer; }
    return { __type: 'Some', __union: 'Option', value: BigInt(i) };
  }
  return { __type: 'None', __union: 'Option' };
}

// ─── Char / String ────────────────────────────────────────────────────────────

function $asc(c) {
  if (!(c instanceof PfunChar)) throw new Error('asc() requires a char.');
  return BigInt(c.value.codePointAt(0));
}
function $chr(n) {
  if (typeof n !== 'bigint') throw new Error('chr() requires an Int.');
  return new PfunChar(String.fromCodePoint(Number(n)));
}
function $__str__(v) { return $stringify(v); }

// ─── Numeric casts ────────────────────────────────────────────────────────────

function $toFloat(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') { const n = parseFloat(v); if (isNaN(n)) throw new Error(`toFloat: cannot convert "${v}"`); return n; }
  throw new Error(`toFloat() requires a number or string.`);
}
function $toInt(v) {
  if (typeof v === 'bigint') return v;
  if (v instanceof PfunByte) return BigInt(v.value);
  if (typeof v === 'number') { if (!isFinite(v)) throw new Error('toInt: cannot convert Infinity/NaN'); return BigInt(Math.trunc(v)); }
  throw new Error(`toInt() requires a number or Byte.`);
}
function $floor(v) { if (typeof v === 'bigint') return v; return BigInt(Math.floor(v)); }
function $ceil(v)  { if (typeof v === 'bigint') return v; return BigInt(Math.ceil(v)); }
function $round(v) { if (typeof v === 'bigint') return v; return BigInt(Math.round(v)); }
function $isNaN(v)    { return typeof v === 'number' && Number.isNaN(v); }
function $isFinite(v) { if (typeof v === 'bigint') return true; if (typeof v === 'number') return Number.isFinite(v); return false; }

// ─── Byte conversions ─────────────────────────────────────────────────────────

function $toByte(v) {
  if (v instanceof PfunByte) return v;
  if (typeof v === 'bigint') { const n = Number(v); if (n < 0 || n > 255) throw new Error(`toByte: ${n} out of range`); return new PfunByte(n); }
  if (v instanceof PfunChar) { const cp = v.value.codePointAt(0); if (cp > 255) throw new Error(`toByte: char out of range`); return new PfunByte(cp); }
  throw new Error(`toByte() requires an Int or Char.`);
}
function $toChar(v) {
  if (!(v instanceof PfunByte)) throw new Error(`toChar() requires a Byte.`);
  return new PfunChar(String.fromCodePoint(v.value));
}
function $charBytes(v) {
  if (!(v instanceof PfunChar)) throw new Error(`charBytes() requires a Char.`);
  const encoder = new TextEncoder();
  return Array.from(encoder.encode(v.value), b => new PfunByte(b));
}
function $bytesToChar(v) {
  if (!Array.isArray(v) || !v.every(b => b instanceof PfunByte)) throw new Error('bytesToChar() requires a List<Byte>.');
  const decoder = new TextDecoder();
  return new PfunChar(decoder.decode(new Uint8Array(v.map(b => b.value))));
}

// ─── Mutable structures ───────────────────────────────────────────────────────

function $array_from(elements) { return new PfunArray([...elements]); }
function $dict_from(entries) {
  const map = new Map();
  for (const [k, v] of entries) map.set(PfunDict.keyOf(k), v);
  return new PfunDict(map);
}
function $arrayLength(arr) { if (!(arr instanceof PfunArray)) throw new Error('arrayLength() requires an array.'); return BigInt(arr.elements.length); }
function $append(arr, val) { arr.elements.push(val); return arr; }
function $removeAt(arr, idx) { arr.elements.splice(Number(idx), 1); return arr; }
function $insertAt(arr, idx, val) { arr.elements.splice(Number(idx), 0, val); return arr; }
function $toList(arr) { if (!(arr instanceof PfunArray)) throw new Error('toList() requires an array.'); return [...arr.elements]; }
function $toArray(val) {
  if (val instanceof PfunArray) return new PfunArray([...val.elements]);
  if (Array.isArray(val)) return new PfunArray([...val]);
  throw new Error('toArray() requires a list or array.');
}
function $toDict(arr) {
  const map = new Map();
  arr.elements.forEach((v, i) => map.set(`i:${i}`, v));
  return new PfunDict(map);
}
function $has(dict, key) { return dict.entries.has(PfunDict.keyOf(key)); }
function $remove(dict, key) { dict.entries.delete(PfunDict.keyOf(key)); return dict; }
function $keys(dict) {
  return [...dict.entries.keys()].map(k => {
    const prefix = k.slice(0, 2), raw = k.slice(2);
    if (prefix === 'i:') return BigInt(raw);
    if (prefix === 'b:') return raw === 'true';
    return raw;
  });
}
function $values(dict) { return [...dict.entries.values()]; }
function $dictToList(dict) {
  return [...dict.entries.entries()].map(([k, v]) => {
    const prefix = k.slice(0, 2), raw = k.slice(2);
    let key;
    if (prefix === 'i:') key = BigInt(raw);
    else if (prefix === 'b:') key = raw === 'true';
    else key = raw;
    return { __type: 'Pair', key, value: v };
  });
}
function $listToDict(list) {
  const map = new Map();
  for (const item of list) map.set(PfunDict.keyOf(item.key), item.value);
  return new PfunDict(map);
}

// Buffer — browser uses Uint8Array instead of Node's Buffer
const ByteMode = { __type: 'ByteMode', __union: 'BufferMode' };
const CharMode  = { __type: 'CharMode',  __union: 'BufferMode' };

function $makeBuffer(mode) { return new PfunBuffer(mode.__type === 'ByteMode' ? 'byte' : 'char'); }
function $makeStringBuffer(str) {
  const buf = new PfunBuffer('char');
  const encoded = new TextEncoder().encode(str);
  buf.append(encoded);
  return buf;
}
function $appendBuffer(pbuf, bytes) {
  pbuf.append(new Uint8Array(bytes.map(b => b.value)));
  return pbuf;
}
function $appendChar(pbuf, c) {
  pbuf.append(new TextEncoder().encode(c.value));
  return pbuf;
}
function $appendString(pbuf, str) {
  pbuf.append(new TextEncoder().encode(str));
  return pbuf;
}
function $bufferToBytes(pbuf) { return pbuf.toByteList(); }
function $bufferToString(pbuf) {
  return new TextDecoder().decode(pbuf.bytes.subarray(0, pbuf.pos));
}
function $bufferLength(pbuf) { return BigInt(pbuf.pos); }

// ─── HTTP client ──────────────────────────────────────────────────────────────
// $httpPost(url, value) — POST a Pfun value as JSON, return the deserialized
// response as Ok(value) or Err(message).
// Uses the same __pfun-tagged encoding as jsonlib / pfun-http.js so server
// and client speak the same wire format.

function $pfunToJsonValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint')  return { __pfun: 'int', v: value.toString() };
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number')  return value;
  if (typeof value === 'string')  return value;
  if (value instanceof PfunDict) {
    const obj = {};
    for (const [k, v] of value.entries.entries()) obj[k.slice(2)] = $pfunToJsonValue(v);
    return obj;
  }
  if (Array.isArray(value)) return value.map($pfunToJsonValue);
  if (value && typeof value === 'object' && '__type' in value) {
    const out = { __pfun: 'record', __type: value.__type, __union: value.__union ?? null };
    for (const key of Object.keys(value)) {
      if (key === '__type' || key === '__union') continue;
      out[key] = $pfunToJsonValue(value[key]);
    }
    return out;
  }
  return $stringify(value);
}

function $jsonToPfunValue(node) {
  if (node === null || node === undefined) return null;
  if (typeof node === 'boolean') return node;
  if (typeof node === 'number')  return Number.isInteger(node) ? BigInt(node) : node;
  if (typeof node === 'string')  return node;
  if (Array.isArray(node)) return node.map($jsonToPfunValue);
  if (typeof node === 'object') {
    if (node.__pfun === 'int') return BigInt(node.v);
    if (node.__pfun === 'record') {
      const obj = { __type: node.__type };
      if (node.__union) obj.__union = node.__union;
      for (const key of Object.keys(node)) {
        if (key === '__pfun' || key === '__type' || key === '__union') continue;
        obj[key] = $jsonToPfunValue(node[key]);
      }
      return obj;
    }
    const map = new Map();
    for (const [k, v] of Object.entries(node)) map.set('s:' + k, $jsonToPfunValue(v));
    return new PfunDict(map);
  }
  return node;
}

async function $httpPost(url, value) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify($pfunToJsonValue(value)),
    });
    if (!res.ok) {
      const text = await res.text();
      return { __type: 'Err', __union: 'HttpResult', message: `HTTP ${res.status}: ${text}` };
    }
    const json = await res.json();
    return { __type: 'Ok', __union: 'HttpResult', value: $jsonToPfunValue(json) };
  } catch (e) {
    return { __type: 'Err', __union: 'HttpResult', message: e instanceof Error ? e.message : String(e) };
  }
}

function $mountHtml(html) {
  const el = _getOutput();
  if (!el) { console.log(html); return; }
  const wrapper = document.createElement('div');
  wrapper.innerHTML = typeof html === 'string' ? html : $stringify(html);
  el.appendChild(wrapper);
  $restoreFocus();
}

function $clearOutput() {
  const el = _getOutput();
  if (el) {
    $saveFocus();
    el.innerHTML = '';
  }
}

// $setThemeStyles(css) — inject or replace the Pfun theme stylesheet in <head>.
// Lives in <head> under id="pfun-theme" so it survives $clearOutput (which
// only clears #pfun-output) and repeated calls replace rather than stack.
function $setThemeStyles(css) {
  const text = typeof css === 'string' ? css : $stringify(css);
  let el = document.getElementById('pfun-theme');
  if (!el) {
    el = document.createElement('style');
    el.id = 'pfun-theme';
    (document.head || document.documentElement).appendChild(el);
  }
  el.textContent = text;
  return true;
}

// Save/restore focus around a full DOM replacement so that text inputs
// don't lose focus on every keystroke.
let _focusedInputName = null;
let _focusedInputSelStart = null;
let _focusedInputSelEnd = null;

function $saveFocus() {
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && active.name) {
    _focusedInputName = active.name;
    _focusedInputSelStart = active.selectionStart;
    _focusedInputSelEnd = active.selectionEnd;
  } else {
    _focusedInputName = null;
  }
}

function $restoreFocus() {
  if (!_focusedInputName) return;
  const el = _getOutput();
  if (!el) return;
  const input = el.querySelector(`input[name="${CSS.escape(_focusedInputName)}"], textarea[name="${CSS.escape(_focusedInputName)}"]`);
  if (!input) return;
  input.focus();
  try {
    input.setSelectionRange(_focusedInputSelStart, _focusedInputSelEnd);
  } catch (_) {}
  _focusedInputName = null;
}

// attachDomHandler(key, occurrence, pfunFn)
// Finds the Nth element (0-indexed) whose data-pfun-* attribute matches
// `key` and attaches the appropriate DOM event listener.  Using occurrence
// index rather than attaching to all matches means that when multiple
// elements share the same key (e.g. several "Edit" or "Dismiss" buttons
// rendered in a list), each gets its own distinct handler closure.
// pfunFn receives a Pfun-typed value:
//   click  → true (Bool)
//   input  → the string value
//   check  → true/false (Bool)
//   change → the selected string value
function $attachDomHandler(key, occurrence, pfunFn) {
  const output = _getOutput();
  if (!output) return;
  const n = typeof occurrence === 'bigint' ? Number(occurrence) : (occurrence ?? 0);
  const tryAttach = (attr, event, getValue) => {
    const els = output.querySelectorAll(`[${attr}="${CSS.escape(key)}"]`);
    const el = els[n];
    if (!el) return;
    el.addEventListener(event, e => {
      const val = getValue(e);
      pfunFn(val);
    });
  };
  tryAttach('data-pfun-click',  'click',  ()  => true);
  tryAttach('data-pfun-input',  'input',  e   => e.target.value);
  tryAttach('data-pfun-check',  'change', e   => e.target.checked);
  tryAttach('data-pfun-change', 'change', e   => e.target.value);
}

// ─── Pre-built singletons ─────────────────────────────────────────────────────

const None = { __type: 'None', __union: 'Option' };
const Some = v => ({ __type: 'Some', __union: 'Option', value: v });

// ─── Export as global ─────────────────────────────────────────────────────────
// The browser inlined bundle destructures from window.__pfunRuntime.

window.__pfunRuntime = {
  PfunChar, PfunByte, PfunArray, PfunDict, PfunBuffer,
  $curry, $memoize,
  $char, $byte, $record, $registerType, $schema,
  $stringify, $println, $print, $flushStdout, $mountHtml, $clearOutput, $setThemeStyles, $saveFocus, $restoreFocus, $attachDomHandler, $httpPost, $truthy,
  $readln, $readChar, $scriptArgs, $getEnv, $envVars,
  $ck,
  $add, $sub, $mul, $div, $mod, $neg,
  $eq, $neq, $lt, $lte, $gt, $gte,
  $bitAnd, $bitOr, $shl, $shr,
  $get, $index, $indexSet,
  $match,
  $length, $head, $tail, $map, $filter, $reduce,
  $reverse, $join, $split, $range, $cons, $take, $drop, $nth,
  $slice, $find, $findSlice,
  $iterate, $repeat, $cycle, $isInfinite, $isLazy,
  $LazyIterate, $LazyRepeat, $LazyCycle, $LazyFilter, $LazyMap, $LazyCons, $LazyTail,
  $asc, $chr, $__str__,
  $toFloat, $toInt, $floor, $ceil, $round, $isNaN, $isFinite,
  $toByte, $toChar, $charBytes, $bytesToChar,
  $array_from, $dict_from,
  $arrayLength, $append, $removeAt, $insertAt, $toList, $toArray, $toDict,
  $has, $remove, $keys, $values, $dictToList, $listToDict,
  $makeBuffer, $makeStringBuffer, $appendBuffer, $appendChar, $appendString,
  $bufferToBytes, $bufferToString, $bufferLength,
  ByteMode, CharMode,
  None, Some,
};

})();
