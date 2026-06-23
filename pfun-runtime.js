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

// Schema table: populated by transpiled code at the top of each output file.
// Each entry: { fields: string[], unionName: string|null }
const $schema = {};
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
  throw new Error('head() called on empty list.');
}

function $tail(v) {
  if (typeof v === 'string') return v.slice(1);
  if (Array.isArray(v)) return v.slice(1);
  throw new Error('tail() requires a list or string.');
}

function $map(f, v) {
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
  throw new Error('map() requires a list or string.');
}

function $filter(f, v) {
  if (typeof v === 'string') {
    const filtered = [...v].map(c => new PfunChar(c)).filter(c => $truthy(f(c)));
    return filtered.map(c => c.value).join('');
  }
  if (Array.isArray(v)) return v.filter(x => $truthy(f(x)));
  throw new Error('filter() requires a list or string.');
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
  if (d === '') return [...s].map(c => new PfunChar(c));
  return s.split(d);
}

function $range(lo, hi) {
  if (typeof lo !== 'bigint' || typeof hi !== 'bigint') throw new Error('range() requires Int arguments.');
  const result = [];
  for (let i = lo; i < hi; i++) result.push(i);
  return result;
}

function $cons(h, t) {
  // char cons'd onto a string → string
  if (h instanceof PfunChar && typeof t === 'string') return h.value + t;
  // char cons'd onto empty list → string
  if (h instanceof PfunChar && Array.isArray(t) && t.length === 0) return h.value;
  // char cons'd onto char list → string (maybeJoin)
  if (!Array.isArray(t) && typeof t !== 'string') throw new Error('cons() tail must be a list or string.');
  const arr = typeof t === 'string' ? [...t].map(c => new PfunChar(c)) : t;
  const result = [h, ...arr];
  // If all chars, join back to string
  if (result.every(x => x instanceof PfunChar)) return result.map(x => x.value).join('');
  return result;
}

function $take(n, v) {
  if (typeof n !== 'bigint') throw new Error('take() requires an Int count.');
  const count = Number(n);
  if (typeof v === 'string') return v.slice(0, count);
  if (Array.isArray(v)) return v.slice(0, count);
  // Lazy sequences
  if (v instanceof $LazyIterate) {
    const result = []; let cur = v.seed;
    for (let i = 0; i < count; i++) { result.push(cur); cur = v.f(cur); }
    return result;
  }
  if (v instanceof $LazyRepeat) return Array.from({ length: count }, () => v.value);
  if (v instanceof $LazyCycle) {
    const src = v.source; if (!src.length) return [];
    return Array.from({ length: count }, (_, i) => src[i % src.length]);
  }
  throw new Error('take() requires a list, string, or lazy sequence.');
}

function $drop(n, v) {
  if (typeof n !== 'bigint') throw new Error('drop() requires an Int count.');
  const count = Number(n);
  if (typeof v === 'string') return v.slice(count);
  if (Array.isArray(v)) return v.slice(count);
  if (v instanceof $LazyIterate) { let cur = v.seed; for (let i = 0; i < count; i++) cur = v.f(cur); return new $LazyIterate(v.f, cur); }
  if (v instanceof $LazyRepeat) return v;
  if (v instanceof $LazyCycle) return v;
  throw new Error('drop() requires a list, string, or lazy sequence.');
}

function $nth(v, n) {
  // Pfun: nth(list, index) — list first, index second
  if (typeof n !== 'bigint') throw new Error('nth() requires an Int index.');
  if (Array.isArray(v)) {
    const i = Number(n);
    if (i < 0 || i >= v.length) throw new Error(`nth(): index ${i} out of range.`);
    return v[i];
  }
  throw new Error('nth() requires a list.');
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
  throw new Error('slice() requires a list or string.');
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

// ─── Lazy list classes ────────────────────────────────────────────────────────

class $LazyIterate { constructor(f, seed) { this.f = f; this.seed = seed; } }
class $LazyRepeat  { constructor(value)   { this.value = value; } }
class $LazyCycle   { constructor(source)  { this.source = source; } }

function $iterate(f, seed) { return new $LazyIterate(f, seed); }
function $repeat(value)    { return new $LazyRepeat(value); }
function $cycle(source)    { return new $LazyCycle(source); }
function $isInfinite(v)    { return v instanceof $LazyIterate || v instanceof $LazyRepeat || v instanceof $LazyCycle; }

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
  PfunChar, PfunByte, PfunArray, PfunDict,
  $char, $byte, $record, $registerType, $schema,
  $stringify, $println, $truthy,
  $ck,
  $add, $sub, $mul, $div, $mod, $neg,
  $eq, $neq, $lt, $lte, $gt, $gte,
  $bitAnd, $bitOr, $shl, $shr,
  $get, $index, $indexSet,
  $match,
  // Core list ops
  $length, $head, $tail, $map, $filter, $reduce,
  $reverse, $join, $split, $range, $cons, $take, $drop, $nth,
  // Extended list ops
  $slice, $find, $findSlice,
  // Lazy sequences
  $iterate, $repeat, $cycle, $isInfinite,
  $LazyIterate, $LazyRepeat, $LazyCycle,
  // Char / String
  $asc, $chr, $__str__,
  // Numeric casts & predicates
  $toFloat, $toInt, $floor, $ceil, $round, $isNaN, $isFinite,
  // Byte / Char conversions
  $toByte, $toChar, $charBytes, $bytesToChar,
  None, Some,
};
