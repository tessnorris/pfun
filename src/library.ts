// src/library.ts
// Standard library — all built-in function and type definitions for Pfun.
// Exports stdlibFunctions and stdlibTypes, registered by main.ts via
// interpreter.registerLibrary().

import {
  Interpreter, NativeFunction, RegistryFunction, RegistryType,
  PfunChar, PfunDict, PfunArray, LazyList
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

  { name: 'cons', fn: (args, interp) => {
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

  { name: 'map', fn: (args, interp) => {
    const fn   = interp.force(args[0]);
    const list = interp.force(args[1]);
    if (list instanceof LazyList) return new LazyList({ kind: 'map', f: fn, source: list });
    const arr    = typeof list === 'string' ? strToCharList(list) : list;
    const mapped = arr.map((item: any) => interp.force(fn.execute([item], interp)));
    const result = maybeJoin(mapped);
    if (Array.isArray(result)) interp.enforceListType(result);
    return result;
  }},

  { name: 'filter', fn: (args, interp) => {
    const fn   = interp.force(args[0]);
    const list = interp.force(args[1]);
    if (list instanceof LazyList) return new LazyList({ kind: 'filter', f: fn, source: list });
    const arr      = typeof list === 'string' ? strToCharList(list) : list;
    const filtered = arr.filter((item: any) => interp.isTruthy(interp.force(fn.execute([item], interp))));
    return maybeJoin(filtered);
  }},

  { name: 'reduce', fn: (args, interp) => {
    const fn   = interp.force(args[0]);
    let   acc  = interp.force(args[1]);
    const list = interp.force(args[2]);
    if (list instanceof LazyList) throw new Error("reduce cannot be used on an infinite list. Use take() first to get a finite list.");
    const arr = typeof list === 'string' ? strToCharList(list) : list;
    for (const item of arr) acc = interp.force(fn.execute([acc, item], interp));
    return acc;
  }},

  // ─── Infinite Lists ────────────────────────────────────────────────────────

  { name: 'iterate', fn: (args, interp) =>
    new LazyList({ kind: 'iterate', f: interp.force(args[0]), seed: interp.force(args[1]) })
  },

  { name: 'repeat', fn: (args, interp) =>
    new LazyList({ kind: 'repeat', value: interp.force(args[0]) })
  },

  { name: 'cycle', fn: (args, interp) =>
    new LazyList({ kind: 'cycle', source: interp.force(args[0]) })
  },

  { name: 'take', fn: (args, interp) => {
    const n    = interp.force(args[0]);
    const list = interp.force(args[1]);
    if (typeof n !== 'bigint') throw new Error("take requires an integer as first argument.");
    const count = Number(n);
    if (typeof list === 'string') return list.slice(0, count);
    if (Array.isArray(list)) { const r = list.slice(0, count); interp.enforceListType(r); return r; }
    if (list instanceof LazyList) return maybeJoin(interp.takeFrom(list, count));
    throw new Error("take requires a list as second argument.");
  }},

  { name: 'slice', fn: (args, interp) => {
    const start = Number(interp.force(args[0]));
    const count = Number(interp.force(args[1]));
    const list  = interp.force(args[2]);
    if (typeof list === 'string') return list.slice(start, start + count);
    if (Array.isArray(list)) return list.slice(start, start + count);
    if (list instanceof LazyList) return maybeJoin(interp.takeFrom(new LazyList({ kind: 'drop', n: start, source: list }), count));
    throw new Error("slice requires a list, string, or lazy list.");
  }},

  { name: 'isInfinite', fn: (args, interp) => interp.force(args[0]) instanceof LazyList },

  { name: 'nth', fn: (args, interp) => {
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
    if (s instanceof PfunArray) return BigInt(s.elements.length);
    if (s instanceof LazyList) throw new Error("length cannot be used on an infinite list. Use take() first.");
    throw new Error("length() requires a list, array, or string.");
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

  // ─── Dictionary Operations ─────────────────────────────────────────────────

  { name: 'has', fn: (args, interp) => {
    const dict = interp.force(args[0]);
    const key  = interp.force(args[1]);
    if (!(dict instanceof PfunDict)) throw new Error("has() requires a dict as first argument.");
    return dict.entries.has(PfunDict.keyOf(key));
  }},

  { name: 'remove', fn: (args, interp) => {
    const dict = interp.force(args[0]);
    const key  = interp.force(args[1]);
    if (!(dict instanceof PfunDict)) throw new Error("remove() requires a dict as first argument.");
    dict.entries.delete(PfunDict.keyOf(key));
    return dict;
  }},

  { name: 'keys', fn: (args, interp) => {
    const dict = interp.force(args[0]);
    if (!(dict instanceof PfunDict)) throw new Error("keys() requires a dict as first argument.");
    return [...dict.entries.keys()].map(k => {
      const prefix = k.slice(0, 2), raw = k.slice(2);
      if (prefix === 's:') return raw;
      if (prefix === 'i:') return BigInt(raw);
      if (prefix === 'b:') return raw === 'true';
      return raw;
    });
  }},

  { name: 'values', fn: (args, interp) => {
    const dict = interp.force(args[0]);
    if (!(dict instanceof PfunDict)) throw new Error("values() requires a dict as first argument.");
    return [...dict.entries.values()];
  }},

  // ─── String Utilities ─────────────────────────────────────────────────────

  // __str__ is the internal coercion function used by $"..." interpolation.
  { name: '__str__', fn: (args, interp) => {
    const val = interp.force(args[0]);
    return interp.stringify(val);
  }},

  { name: 'split', fn: (args, interp) => {
    const str = interp.force(args[0]);
    const delim = interp.force(args[1]);
    if (typeof str !== 'string') throw new Error("split() requires a string as first argument.");
    if (typeof delim !== 'string') throw new Error("split() requires a string delimiter as second argument.");
    if (delim === '') return str.split('').map((c: string) => c);
    return str.split(delim);
  }},

  { name: 'join', fn: (args, interp) => {
    const list = interp.force(args[0]);
    const delim = interp.force(args[1]);
    if (!Array.isArray(list)) throw new Error("join() requires a list as first argument.");
    if (typeof delim !== 'string') throw new Error("join() requires a string delimiter as second argument.");
    return list.map((v: any) => interp.stringify(interp.force(v))).join(delim);
  }},

  // ─── Find ─────────────────────────────────────────────────────────────────

  { name: 'find', fn: (args, interp) => {
    const arr  = interp.toArray(interp.force(args[0]));
    const item = interp.force(args[1]);
    for (let i = 0; i < arr.length; i++) { if (interp.valEqual(arr[i], item)) return { __type: 'Some', __union: 'Option', value: BigInt(i) }; }
    return { __type: 'None', __union: 'Option' };
  }},

  { name: 'findSlice', fn: (args, interp) => {
    const arr = interp.toArray(interp.force(args[0]));
    const pat = interp.toArray(interp.force(args[1]));
    if (pat.length === 0) return { __type: 'Some', __union: 'Option', value: 0n };
    outer: for (let i = 0; i <= arr.length - pat.length; i++) {
      for (let j = 0; j < pat.length; j++) { if (!interp.valEqual(arr[i + j], pat[j])) continue outer; }
      return { __type: 'Some', __union: 'Option', value: BigInt(i) };
    }
    return { __type: 'None', __union: 'Option' };
  }},

  // ─── Array Operations ──────────────────────────────────────────────────────

  // append(arr, value) — adds value to the end of the array. Mutates in place.
  { name: 'append', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'append': side effects not allowed in pure functions.");
    const arr = interp.force(args[0]);
    if (!(arr instanceof PfunArray)) throw new Error("append() requires an array as first argument.");
    const val = interp.force(args[1]);
    interp.enforceArrayType(arr, val);
    arr.elements.push(val);
    return arr;
  }},

  // removeAt(arr, index) — removes the element at index, shifting later elements down.
  { name: 'removeAt', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'removeAt': side effects not allowed in pure functions.");
    const arr = interp.force(args[0]);
    if (!(arr instanceof PfunArray)) throw new Error("removeAt() requires an array as first argument.");
    const idx = interp.force(args[1]);
    if (typeof idx !== 'bigint') throw new Error("removeAt() requires an integer index.");
    const i = Number(idx);
    if (i < 0 || i >= arr.elements.length) throw new Error(`removeAt() index ${i} out of bounds (length ${arr.elements.length}).`);
    arr.elements.splice(i, 1);
    return arr;
  }},

  // insertAt(arr, index, value) — inserts value before index, shifting later elements up.
  // index must be in [0, length] — appending at end is allowed, gaps are not.
  { name: 'insertAt', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'insertAt': side effects not allowed in pure functions.");
    const arr = interp.force(args[0]);
    if (!(arr instanceof PfunArray)) throw new Error("insertAt() requires an array as first argument.");
    const idx = interp.force(args[1]);
    if (typeof idx !== 'bigint') throw new Error("insertAt() requires an integer index.");
    const i = Number(idx);
    if (i < 0 || i > arr.elements.length) throw new Error(`insertAt() index ${i} out of bounds (length ${arr.elements.length}). Use an index in [0, length].`);
    const val = interp.force(args[2]);
    interp.enforceArrayType(arr, val);
    arr.elements.splice(i, 0, val);
    return arr;
  }},

  // toList(arr) — converts a PfunArray to a Pfun list (immutable).
  { name: 'toList', fn: (args, interp) => {
    const arr = interp.force(args[0]);
    if (!(arr instanceof PfunArray)) throw new Error("toList() requires an array.");
    return [...arr.elements];
  }},

  // toArray(list) — converts a Pfun list or string to a mutable PfunArray.
  { name: 'toArray', fn: (args, interp) => {
    const val = interp.force(args[0]);
    if (val instanceof PfunArray) return new PfunArray([...val.elements]);
    if (typeof val === 'string') {
      const elements = val.split('').map((c: string) => c);
      const arr = new PfunArray(elements);
      if (elements.length > 0) arr.elementType = 'char';
      return arr;
    }
    if (Array.isArray(val)) {
      const arr = new PfunArray([...val]);
      if (val.length > 0) {
        // Infer element type from first element using stringify-based detection
        const first = interp.force(val[0]);
        if (first instanceof PfunChar) arr.elementType = 'char';
        else if (typeof first === 'bigint') arr.elementType = 'bigint';
        else if (typeof first === 'boolean') arr.elementType = 'boolean';
        else if (typeof first === 'string') arr.elementType = 'string';
        else if (Array.isArray(first)) arr.elementType = first.length === 0 ? 'list' : `list<${typeof interp.force(first[0])}>`;
        else if (first && first.__union) arr.elementType = first.__union;
        else if (first && first.__type) arr.elementType = first.__type;
      }
      return arr;
    }
    throw new Error("toArray() requires a list, array, or string.");
  }},

  // toDict(arr) — converts a PfunArray to a dict with integer keys 0, 1, 2, ...
  { name: 'toDict', fn: (args, interp) => {
    const arr = interp.force(args[0]);
    if (!(arr instanceof PfunArray)) throw new Error("toDict() requires an array.");
    const map = new Map<string, any>();
    arr.elements.forEach((v: any, i: number) => map.set(`i:${i}`, v));
    return new PfunDict(map);
  }},
];
