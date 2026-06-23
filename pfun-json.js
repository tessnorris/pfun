'use strict';
// pfun-json.js — runtime support for `import * from "json"` in transpiled Pfun.
//
// Direct port of jsonlib.ts semantics. See that file's header for the
// serialisation format (bigint/char/byte wrappers, record/union encoding).

const { PfunChar, PfunByte } = require('./pfun-runtime');

// ─── Option helpers ───────────────────────────────────────────────────────────
const some = value => ({ __type: 'Some', __union: 'Option', value });
const none = { __type: 'None', __union: 'Option' };

// ─── Serialiser ──────────────────────────────────────────────────────────────
function pfunToJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return { __pfun: 'int', v: value.toString() };
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string')  return value;
  if (value instanceof PfunChar) return { __pfun: 'char', v: value.value };
  if (value instanceof PfunByte) return { __pfun: 'byte', v: value.value };
  if (Array.isArray(value)) return value.map(pfunToJson);
  if (value && typeof value === 'object' && value.__type) {
    const node = { __pfun: 'record', __type: value.__type };
    if (value.__union) node.__union = value.__union;
    for (const key of Object.keys(value)) {
      if (key === '__type' || key === '__union' || key.startsWith('__')) continue;
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
function jsonToPfun(node) {
  if (node === null || node === undefined) return null;
  if (typeof node === 'boolean') return node;
  if (typeof node === 'string')  return node;
  if (typeof node === 'number')  return BigInt(Math.trunc(node));
  if (Array.isArray(node)) return node.map(jsonToPfun);
  if (typeof node === 'object') {
    const tag = node.__pfun;
    if (tag === 'int')    return BigInt(node.v);
    if (tag === 'char')   return new PfunChar(node.v);
    if (tag === 'byte')   return new PfunByte(node.v);
    if (tag === 'record') {
      const obj = { __type: node.__type };
      if (node.__union) obj.__union = node.__union;
      for (const key of Object.keys(node)) {
        if (key === '__pfun' || key === '__type' || key === '__union') continue;
        obj[key] = jsonToPfun(node[key]);
      }
      return obj;
    }
    const obj = {};
    for (const key of Object.keys(node)) obj[key] = jsonToPfun(node[key]);
    return obj;
  }
  return node;
}

// ─── Exports ─────────────────────────────────────────────────────────────────
function jsonSerialize(value) {
  try {
    return some(JSON.stringify(pfunToJson(value), null, 2));
  } catch (e) {
    return none;
  }
}

function jsonDeserialize(str) {
  if (typeof str !== 'string') throw new Error('jsonDeserialize: argument must be a string.');
  try {
    return some(jsonToPfun(JSON.parse(str)));
  } catch (e) {
    return none;
  }
}

module.exports = { jsonSerialize, jsonDeserialize };
