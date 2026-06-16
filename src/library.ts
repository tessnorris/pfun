// src/library.ts
// Standard library — all built-in function and type definitions for Pfun.
// Exports stdlibFunctions and stdlibTypes, registered by main.ts via
// interpreter.registerLibrary().

import {
  RegistryFunction, RegistryType,
  PfunChar, PfunByte, PfunArray, LazyList
} from './interpreter';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function strToCharList(s: string): PfunChar[] {
  return s.split('').map(c => new PfunChar(c));
}

export function maybeJoin(arr: any[]): any {
  if (arr.length === 0) return arr;
  if (arr.every((c: any) => c instanceof PfunChar)) return arr.map((c: PfunChar) => c.value).join('');
  return arr;
}

// ─── Built-in Types ───────────────────────────────────────────────────────────

export const stdlibTypes: RegistryType[] = [
  {
    kind: 'union',
    name: 'Option',
    variants: [
      { name: 'Some', fields: ['value'] },
      { name: 'None', fields: [] },
    ],
  },
  {
    kind: 'plain',
    name: 'Pair',
    fields: ['key', 'value'],
    generic: true,
  },
];

// ─── Built-in Functions ───────────────────────────────────────────────────────

export const stdlibFunctions: RegistryFunction[] = [

  // ─── Lists & Strings ──────────────────────────────────────────────────────

  { name: 'head', fn: (args, interp) => {
    const list = interp.force(args[0]);
    if (list instanceof LazyList) {
      const taken = interp.takeFrom(list, 1);
      if (taken.length === 0) throw new Error("head requires a non-empty list.");
      return taken[0];
    }
    if (typeof list === 'string') {
      if (list.length === 0) throw new Error("head requires a non-empty string.");
      return new PfunChar(list[0]);
    }
    if (!Array.isArray(list) || list.length === 0) throw new Error("head requires a non-empty list.");
    return list[0];
  }},

  { name: 'tail', fn: (args, interp) => {
    const list = interp.force(args[0]);
    if (list instanceof LazyList) return new LazyList({ kind: 'drop', n: 1, source: list });
    if (typeof list === 'string') return list.slice(1);
    if (!Array.isArray(list)) throw new Error("tail requires a list.");
    return list.slice(1);
  }},

  { name: 'cons', arity: 2, fn: (args, interp) => {
    const head = interp.force(args[0]);
    const tail = interp.force(args[1]);
    if (tail instanceof LazyList) return new LazyList({ kind: 'cons', head, tail });
    if (head instanceof PfunChar && typeof tail === 'string') return head.value + tail;
    if (head instanceof PfunChar && Array.isArray(tail) && tail.length === 0) return head.value;
    if (!Array.isArray(tail) && typeof tail !== 'string') throw new Error("cons requires a list as second argument.");
    const arr = typeof tail === 'string' ? strToCharList(tail) : tail;
    const result = maybeJoin([head, ...arr]);
    if (Array.isArray(result)) interp.enforceListType(result);
    return result;
  }},

  { name: 'map', arity: 2, fn: (args, interp) => {
    const fn   = interp.force(args[0]);
    const list = interp.force(args[1]);
    if (list instanceof LazyList) return new LazyList({ kind: 'map', f: fn, source: list });
    const arr    = typeof list === 'string' ? strToCharList(list) : list;
    const mapped = arr.map((item: any) => interp.force(fn.execute([item], interp)));
    const result = maybeJoin(mapped);
    if (Array.isArray(result)) interp.enforceListType(result);
    return result;
  }},

  { name: 'filter', arity: 2, fn: (args, interp) => {
    const fn   = interp.force(args[0]);
    const list = interp.force(args[1]);
    if (list instanceof LazyList) return new LazyList({ kind: 'filter', f: fn, source: list });
    const arr      = typeof list === 'string' ? strToCharList(list) : list;
    const filtered = arr.filter((item: any) => interp.isTruthy(interp.force(fn.execute([item], interp))));
    return maybeJoin(filtered);
  }},

  { name: 'reduce', arity: 3, fn: (args, interp) => {
    const fn   = interp.force(args[0]);
    let   acc  = interp.force(args[1]);
    const list = interp.force(args[2]);
    if (list instanceof LazyList) throw new Error("reduce cannot be used on an infinite list. Use take() first to get a finite list.");
    const arr = typeof list === 'string' ? strToCharList(list) : list;
    for (const item of arr) acc = interp.force(fn.execute([acc, item], interp));
    return acc;
  }},

  // ─── Infinite Lists ────────────────────────────────────────────────────────

  { name: 'iterate', arity: 2, fn: (args, interp) =>
    new LazyList({ kind: 'iterate', f: interp.force(args[0]), seed: interp.force(args[1]) })
  },

  { name: 'repeat', fn: (args, interp) =>
    new LazyList({ kind: 'repeat', value: interp.force(args[0]) })
  },

  { name: 'cycle', fn: (args, interp) =>
    new LazyList({ kind: 'cycle', source: interp.force(args[0]) })
  },

  { name: 'take', arity: 2, fn: (args, interp) => {
    const n    = interp.force(args[0]);
    const list = interp.force(args[1]);
    if (typeof n !== 'bigint') throw new Error("take requires an integer as first argument.");
    const count = Number(n);
    if (typeof list === 'string') return list.slice(0, count);
    if (Array.isArray(list)) { const r = list.slice(0, count); interp.enforceListType(r); return r; }
    if (list instanceof LazyList) return maybeJoin(interp.takeFrom(list, count));
    throw new Error("take requires a list as second argument.");
  }},

  { name: 'slice', arity: 3, fn: (args, interp) => {
    const start = Number(interp.force(args[0]));
    const count = Number(interp.force(args[1]));
    const list  = interp.force(args[2]);
    if (typeof list === 'string') return list.slice(start, start + count);
    if (Array.isArray(list)) return list.slice(start, start + count);
    if (list instanceof LazyList) return maybeJoin(interp.takeFrom(new LazyList({ kind: 'drop', n: start, source: list }), count));
    throw new Error("slice requires a list, string, or lazy list.");
  }},

  { name: 'isInfinite', fn: (args, interp) => interp.force(args[0]) instanceof LazyList },

  { name: 'nth', arity: 2, fn: (args, interp) => {
    const list = interp.force(args[0]);
    const n    = interp.force(args[1]);
    if (typeof n !== 'bigint') throw new Error("nth() requires an integer as second argument.");
    const idx = Number(n);
    if (typeof list === 'string') { if (idx < 0 || idx >= list.length) return false; return new PfunChar(list[idx]); }
    if (Array.isArray(list)) { if (idx < 0 || idx >= list.length) return false; return list[idx]; }
    if (list instanceof LazyList) {
      const taken = interp.takeFrom(new LazyList({ kind: 'drop', n: idx, source: list }), 1);
      return taken.length === 0 ? false : taken[0];
    }
    throw new Error("nth() requires a list, string, or lazy list.");
  }},

  { name: 'reverse', fn: (args, interp) => {
    const list = interp.force(args[0]);
    if (list instanceof LazyList) throw new Error("reverse cannot be used on an infinite list. Use take() first.");
    if (typeof list === 'string') return list.split('').reverse().join('');
    if (!Array.isArray(list)) throw new Error("reverse requires a list or string.");
    return [...list].reverse();
  }},

  // ─── Char / String ────────────────────────────────────────────────────────

  { name: 'length', fn: (args, interp) => {
    const s = interp.force(args[0]);
    if (typeof s === 'string') return BigInt(s.length);
    if (Array.isArray(s)) return BigInt(s.length);
    if (s instanceof LazyList) throw new Error("length cannot be used on an infinite list. Use take() first.");
    if (s instanceof PfunArray) throw new Error("length() does not accept arrays — use arrayLength() for mutable arrays.");
    throw new Error("length() requires a list or string.");
  }},

  { name: 'asc', fn: (args, interp) => {
    const c = interp.force(args[0]);
    if (!(c instanceof PfunChar)) throw new Error("asc() requires a char argument.");
    return BigInt(c.value.charCodeAt(0));
  }},

  { name: 'chr', fn: (args, interp) => {
    const n = interp.force(args[0]);
    if (typeof n !== 'bigint') throw new Error("chr() requires an integer argument.");
    return new PfunChar(String.fromCharCode(Number(n)));
  }},

  // ─── String Utilities ─────────────────────────────────────────────────────

  // __str__ is the internal coercion function used by $"..." interpolation.
  { name: '__str__', fn: (args, interp) => {
    const val = interp.force(args[0]);
    return interp.stringify(val);
  }},

  { name: 'split', arity: 2, fn: (args, interp) => {
    const str = interp.force(args[0]);
    const delim = interp.force(args[1]);
    if (typeof str !== 'string') throw new Error("split() requires a string as first argument.");
    if (typeof delim !== 'string') throw new Error("split() requires a string delimiter as second argument.");
    if (delim === '') return str.split('').map((c: string) => c);
    return str.split(delim);
  }},

  { name: 'join', arity: 2, fn: (args, interp) => {
    const list = interp.force(args[0]);
    const delim = interp.force(args[1]);
    if (!Array.isArray(list)) throw new Error("join() requires a list as first argument.");
    if (typeof delim !== 'string') throw new Error("join() requires a string delimiter as second argument.");
    return list.map((v: any) => interp.stringify(interp.force(v))).join(delim);
  }},

  // ─── Find ─────────────────────────────────────────────────────────────────

  { name: 'find', arity: 2, fn: (args, interp) => {
    const arr  = interp.toArray(interp.force(args[0]));
    const item = interp.force(args[1]);
    for (let i = 0; i < arr.length; i++) { if (interp.valEqual(arr[i], item)) return { __type: 'Some', __union: 'Option', value: BigInt(i) }; }
    return { __type: 'None', __union: 'Option' };
  }},

  { name: 'findSlice', arity: 2, fn: (args, interp) => {
    const arr = interp.toArray(interp.force(args[0]));
    const pat = interp.toArray(interp.force(args[1]));
    if (pat.length === 0) return { __type: 'Some', __union: 'Option', value: 0n };
    outer: for (let i = 0; i <= arr.length - pat.length; i++) {
      for (let j = 0; j < pat.length; j++) { if (!interp.valEqual(arr[i + j], pat[j])) continue outer; }
      return { __type: 'Some', __union: 'Option', value: BigInt(i) };
    }
    return { __type: 'None', __union: 'Option' };
  }},

  // ─── Numeric casts & predicates ──────────────────────────────────────────

  // toFloat(n) — convert integer or float to float. Accepts numeric strings too.
  { name: 'toFloat', arity: 1, fn: (args, interp) => {
    const v = interp.force(args[0]);
    if (typeof v === 'number') return v;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'string') {
      const n = parseFloat(v);
      if (isNaN(n)) throw new Error(`toFloat: cannot convert string "${v}" to float.`);
      return n;
    }
    throw new Error(`toFloat() requires a number or string, got ${typeof v}.`);
  }},

  // toInt(n) — convert float to integer (truncates toward zero). Integers pass through.
  // Also accepts Byte, returning its value as an Int.
  { name: 'toInt', arity: 1, fn: (args, interp) => {
    const v = interp.force(args[0]);
    if (typeof v === 'bigint') return v;
    if (v instanceof PfunByte) return BigInt(v.value);
    if (typeof v === 'number') {
      if (!isFinite(v) || isNaN(v)) throw new Error('toInt: cannot convert NaN or Infinity to integer.');
      return BigInt(Math.trunc(v));
    }
    throw new Error(`toInt() requires a number or Byte, got ${typeof v}.`);
  }},

  // floor(n) — largest integer <= n. Returns int.
  { name: 'floor', arity: 1, fn: (args, interp) => {
    const v = interp.force(args[0]);
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') {
      if (!isFinite(v) || isNaN(v)) throw new Error('floor: cannot floor NaN or Infinity.');
      return BigInt(Math.floor(v));
    }
    throw new Error(`floor() requires a number, got ${typeof v}.`);
  }},

  // ceil(n) — smallest integer >= n. Returns int.
  { name: 'ceil', arity: 1, fn: (args, interp) => {
    const v = interp.force(args[0]);
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') {
      if (!isFinite(v) || isNaN(v)) throw new Error('ceil: cannot ceil NaN or Infinity.');
      return BigInt(Math.ceil(v));
    }
    throw new Error(`ceil() requires a number, got ${typeof v}.`);
  }},

  // round(n) — round to nearest integer (half-up). Returns int.
  { name: 'round', arity: 1, fn: (args, interp) => {
    const v = interp.force(args[0]);
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') {
      if (!isFinite(v) || isNaN(v)) throw new Error('round: cannot round NaN or Infinity.');
      return BigInt(Math.round(v));
    }
    throw new Error(`round() requires a number, got ${typeof v}.`);
  }},

  // isNaN(n) — true if value is a float NaN.
  { name: 'isNaN', arity: 1, fn: (args, interp) => {
    const v = interp.force(args[0]);
    return typeof v === 'number' && Number.isNaN(v);
  }},

  // isFinite(n) — true if value is a finite number (not Infinity, not NaN).
  { name: 'isFinite', arity: 1, fn: (args, interp) => {
    const v = interp.force(args[0]);
    if (typeof v === 'bigint') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    return false;
  }},

  // ─── Byte conversions ─────────────────────────────────────────────────────

  // toByte(x) — convert Int or Char to Byte. Errors if out of range (0–255).
  { name: 'toByte', arity: 1, fn: (args, interp) => {
    const v = interp.force(args[0]);
    if (v instanceof PfunByte) return v;
    if (typeof v === 'bigint') {
      const n = Number(v);
      if (n < 0 || n > 255) throw new Error(`toByte: value ${n} is out of range (0–255).`);
      return new PfunByte(n);
    }
    if (v instanceof PfunChar) {
      const cp = v.value.codePointAt(0)!;
      if (cp > 255) throw new Error(`toByte: char '${v.value}' has codepoint ${cp}, which is out of range (0–255). Use charBytes() to get the UTF-8 byte sequence.`);
      return new PfunByte(cp);
    }
    throw new Error(`toByte() requires an Int or Char, got ${typeof v}.`);
  }},

  // toChar(b) — convert Byte to Char. Always valid since 0–255 ⊆ valid codepoints.
  { name: 'toChar', arity: 1, fn: (args, interp) => {
    const v = interp.force(args[0]);
    if (!(v instanceof PfunByte)) throw new Error(`toChar() requires a Byte, got ${typeof v}.`);
    return new PfunChar(String.fromCodePoint(v.value));
  }},

  // charBytes(c) — decompose a Char into its UTF-8 byte sequence as List<Byte>.
  // Handles all Unicode codepoints including those above U+00FF.
  { name: 'charBytes', arity: 1, fn: (args, interp) => {
    const v = interp.force(args[0]);
    if (!(v instanceof PfunChar)) throw new Error(`charBytes() requires a Char, got ${typeof v}.`);
    const bytes = Buffer.from(v.value, 'utf8');
    return Array.from(bytes, b => new PfunByte(b));
  }},

  // bytesToChar(bytes) — reassemble a List<Byte> UTF-8 sequence into a Char.
  // Errors if the bytes do not form a valid single Unicode codepoint.
  { name: 'bytesToChar', arity: 1, fn: (args, interp) => {
    const v = interp.force(args[0]);
    if (!Array.isArray(v) || !v.every((b: any) => b instanceof PfunByte))
      throw new Error(`bytesToChar() requires a List<Byte>.`);
    const buf = Buffer.from(v.map((b: PfunByte) => b.value));
    const str = buf.toString('utf8');
    // Validate that decoding produced exactly one codepoint
    const codepoints = [...str];
    if (codepoints.length !== 1) throw new Error(`bytesToChar: byte sequence decoded to ${codepoints.length} codepoints, expected exactly 1.`);
    return new PfunChar(codepoints[0]);
  }},
];
