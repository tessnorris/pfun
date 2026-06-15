// src/jsonlib.ts
// JSON encode/decode for Pfun immutable data structures.
// Handles records, discriminated union variants, and lists (arbitrarily nested).
//
// Register with: loader.registerBuiltin('json', jsonlibFunctions)
// Use with:      import * from "json";
//
// This module is purely encode/decode (no file I/O). To persist JSON to disk,
// compose with filelib's writeFile/readFile, e.g.:
//
//   match jsonSerialize(value) with
//   | Some json -> writeFile(path, json)
//   | None -> err("could not serialize")
//
//   match readFile(path) with
//   | Ok content -> jsonDeserialize(content)
//   | Err _ -> None
//
// (jsonlib uses Option-based results; filelib uses Result-based results —
// composing the two requires converting between the two conventions via match.)
//
// Serialization format
// --------------------
// Pfun runtime values map to JSON as follows:
//
//   bigint        → { "__pfun": "int",  "v": "123" }
//   boolean       → JSON boolean  (true / false)
//   string        → JSON string
//   PfunChar      → { "__pfun": "char", "v": "x" }
//   null/nil      → JSON null
//   Array (list)  → JSON array  (elements recursively encoded)
//   record/union  → { "__pfun": "record", "__type": "Foo", "__union": "Bar"|null,
//                     ...fields... }
//
// On the way back in, the "__pfun" discriminator tells the reviver exactly what
// to reconstruct, so round-trips are lossless for all supported types.

import { RegistryFunction, PfunChar } from './interpreter';

// ─── Option helpers ───────────────────────────────────────────────────────────

const some = (value: any) => ({ __type: 'Some', __union: 'Option', value });
const none = { __type: 'None', __union: 'Option' };

// ─── Serialiser ──────────────────────────────────────────────────────────────

/**
 * Recursively convert a Pfun runtime value to a JSON-safe plain object.
 * Throws if it encounters a type that cannot be persisted (LazyList, function,
 * dict).
 */
function pfunToJson(value: any): any {
  if (value === null || value === undefined) return null;

  if (typeof value === 'bigint') {
    return { __pfun: 'int', v: value.toString() };
  }

  if (typeof value === 'boolean') return value;
  if (typeof value === 'string')  return value;

  if (value instanceof PfunChar) {
    return { __pfun: 'char', v: value.value };
  }

  if (Array.isArray(value)) {
    return value.map(pfunToJson);
  }

  if (value && typeof value === 'object' && value.__type) {
    const node: any = { __pfun: 'record', __type: value.__type };
    if (value.__union) node.__union = value.__union;
    for (const key of Object.keys(value)) {
      if (key === '__type' || key === '__union') continue;
      // Skip any hidden runtime fields (e.g. FileHandle's __fd)
      if (key.startsWith('__')) continue;
      node[key] = pfunToJson(value[key]);
    }
    return node;
  }

  throw new Error(
    `jsonSerialize: cannot serialize value of type '${typeof value}'. ` +
    `Only records, unions, lists, strings, integers, booleans, chars, and nil are supported.`
  );
}

// ─── Deserialiser ─────────────────────────────────────────────────────────────

/**
 * Recursively convert a plain JSON value (already parsed) back into Pfun
 * runtime values.
 */
function jsonToPfun(node: any): any {
  if (node === null || node === undefined) return null;

  if (typeof node === 'boolean') return node;
  if (typeof node === 'string')  return node;
  if (typeof node === 'number') {
    // Plain JSON numbers are unexpected in Pfun-generated JSON (integers are
    // wrapped), but tolerate them gracefully as bigints.
    return BigInt(Math.trunc(node));
  }

  if (Array.isArray(node)) {
    return node.map(jsonToPfun);
  }

  if (typeof node === 'object') {
    const tag = node.__pfun;

    if (tag === 'int') {
      return BigInt(node.v);
    }

    if (tag === 'char') {
      return new PfunChar(node.v);
    }

    if (tag === 'record') {
      const obj: any = { __type: node.__type };
      if (node.__union) obj.__union = node.__union;
      for (const key of Object.keys(node)) {
        if (key === '__pfun' || key === '__type' || key === '__union') continue;
        obj[key] = jsonToPfun(node[key]);
      }
      return obj;
    }

    // Fallback: plain JSON object with no __pfun tag — deserialise its values.
    const obj: any = {};
    for (const key of Object.keys(node)) {
      obj[key] = jsonToPfun(node[key]);
    }
    return obj;
  }

  return node;
}

// ─── Registry Functions ───────────────────────────────────────────────────────

export const jsonlibFunctions: RegistryFunction[] = [

  // jsonSerialize(value) — convert a Pfun value to a JSON string.
  // Returns Some { string } on success, None on failure.
  { name: 'jsonSerialize', fn: (args, interp) => {
    const value = interp.force(args[0]);
    try {
      const jsonable = pfunToJson(value);
      return some(JSON.stringify(jsonable, null, 2));
    } catch (e) {
      return none;
    }
  }},

  // jsonDeserialize(string) — parse a JSON string back into a Pfun value.
  // Returns Some { value } on success, None on parse failure.
  { name: 'jsonDeserialize', fn: (args, interp) => {
    const str = interp.force(args[0]);
    if (typeof str !== 'string') throw new Error("jsonDeserialize: argument must be a string.");
    try {
      const parsed = JSON.parse(str);
      return some(jsonToPfun(parsed));
    } catch (e) {
      return none;
    }
  }},
];
