// src/mutStructures.ts
// Mutable data structure operations — PfunArray (mutable arrays) and
// PfunDict (dictionaries) — split out of library.ts so that the core
// stdlib (library.ts) contains only purely-functional operations on
// immutable lists/strings.
//
// Everything here either mutates a PfunArray/PfunDict in place, or
// constructs/consumes one. Registered globally alongside stdlib (no import
// required), matching prior behavior — array { } / dict { } are core
// language syntax, so their operations are core too.
//
// Note: the `Pair` generic record type itself remains in library.ts's
// stdlibTypes, since it's a general-purpose record usable independently of
// dicts (e.g. with iterate/map over plain lists). Only the dict<->Pair-list
// conversion functions (dictToList/listToDict) live here.

import {
  Interpreter, RegistryFunction, RegistryType,
  PfunChar, PfunDict, PfunArray
} from './interpreter';

// ─── Built-in Types ───────────────────────────────────────────────────────────
// (none — Pair stays in library.ts/stdlibTypes)

export const mutStructuresTypes: RegistryType[] = [];

// ─── Built-in Functions ───────────────────────────────────────────────────────

export const mutStructuresFunctions: RegistryFunction[] = [

  // ─── arrayLength ────────────────────────────────────────────────────────────

  // arrayLength(arr) — element count of a PfunArray.
  // Split out from library.ts's length(), which now only handles strings
  // and immutable lists. Reading .length doesn't mutate, but this lives here
  // alongside the rest of the PfunArray-aware operations.
  { name: 'arrayLength', fn: (args, interp) => {
    const arr = interp.force(args[0]);
    if (!(arr instanceof PfunArray)) throw new Error("arrayLength() requires an array.");
    return BigInt(arr.elements.length);
  }},

  // ─── Dictionary Operations ─────────────────────────────────────────────────

  { name: 'has', arity: 2, fn: (args, interp) => {
    const dict = interp.force(args[0]);
    const key  = interp.force(args[1]);
    if (!(dict instanceof PfunDict)) throw new Error("has() requires a dict as first argument.");
    return dict.entries.has(PfunDict.keyOf(key));
  }},

  { name: 'remove', arity: 2, fn: (args, interp) => {
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

  // ─── Dict / Pair conversions ───────────────────────────────────────────────

  // dictToList(dict) — convert a dict to a list of Pair { key, value } records.
  // Key types are restored: 's:' -> string, 'i:' -> bigint, 'b:' -> boolean.
  { name: 'dictToList', fn: (args, interp) => {
    const dict = interp.force(args[0]);
    if (!(dict instanceof PfunDict)) throw new Error("dictToList() requires a dict.");
    return [...dict.entries.entries()].map(([k, v]) => {
      const prefix = k.slice(0, 2), raw = k.slice(2);
      let key: any;
      if (prefix === 's:') key = raw;
      else if (prefix === 'i:') key = BigInt(raw);
      else if (prefix === 'b:') key = raw === 'true';
      else key = raw;
      return { __type: 'Pair', key, value: v };
    });
  }},

  // listToDict(pairs) — convert a list of Pair { key, value } records to a dict.
  // Keys must be strings, integers, or booleans — any other type throws an error.
  { name: 'listToDict', fn: (args, interp) => {
    const list = interp.force(args[0]);
    if (!Array.isArray(list)) throw new Error("listToDict() requires a list of Pair records.");
    const map = new Map<string, any>();
    for (const item of list) {
      const pair = interp.force(item);
      if (!pair || pair.__type !== 'Pair') throw new Error("listToDict() requires a list of Pair records.");
      map.set(PfunDict.keyOf(interp.force(pair.key)), interp.force(pair.value));
    }
    return new PfunDict(map);
  }},
];
