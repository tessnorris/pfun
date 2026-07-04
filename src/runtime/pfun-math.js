'use strict';
// pfun-math.js — runtime support for `import * from "math"` in transpiled Pfun.
//
// Direct port of mathlib.ts semantics. All functions match the interpreter's
// behaviour exactly so the differential harness holds.
//
// Numeric convention: Int → BigInt, Float → JS number.
// Functions that accept both types coerce as needed.

function _toNum(v, name) {
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number') return v;
  throw new Error(`${name}() requires a numeric argument, got ${typeof v}.`);
}

function _checkResult(result, desc) {
  if (!isFinite(result) || isNaN(result))
    throw new Error(`Float domain error: ${desc} produced ${isNaN(result) ? 'NaN' : 'Infinity'}.`);
  return result;
}

function _mathFn1(name, impl) {
  return function(x) {
    return _checkResult(impl(_toNum(x, name)), `${name}`);
  };
}

function _mathFn2(name, impl) {
  return function(x, y) {
    return _checkResult(impl(_toNum(x, name), _toNum(y, name)), `${name}`);
  };
}

// ── Constants ──────────────────────────────────────────────────────────────────
const pi  = Math.PI;
const e   = Math.E;
const tau = Math.PI * 2;
const inf = Infinity;
const nan = NaN;

// ── Basic ──────────────────────────────────────────────────────────────────────
function abs(v) {
  if (typeof v === 'bigint') return v < 0n ? -v : v;
  if (typeof v === 'number') return Math.abs(v);
  throw new Error(`abs() requires a numeric argument, got ${typeof v}.`);
}

function sign(v) {
  if (typeof v === 'bigint') return v > 0n ? 1n : (v < 0n ? -1n : 0n);
  if (typeof v === 'number') return Math.sign(v);
  throw new Error(`sign() requires a numeric argument, got ${typeof v}.`);
}

function min(a, b) {
  const aF = typeof a === 'number', bF = typeof b === 'number';
  if (!aF && typeof a !== 'bigint') throw new Error('min() requires numeric arguments.');
  if (!bF && typeof b !== 'bigint') throw new Error('min() requires numeric arguments.');
  if (aF || bF) return Math.min(typeof a === 'bigint' ? Number(a) : a, typeof b === 'bigint' ? Number(b) : b);
  return a < b ? a : b;
}

function max(a, b) {
  const aF = typeof a === 'number', bF = typeof b === 'number';
  if (!aF && typeof a !== 'bigint') throw new Error('max() requires numeric arguments.');
  if (!bF && typeof b !== 'bigint') throw new Error('max() requires numeric arguments.');
  if (aF || bF) return Math.max(typeof a === 'bigint' ? Number(a) : a, typeof b === 'bigint' ? Number(b) : b);
  return a > b ? a : b;
}

function clamp(lo, hi, x) {
  const anyFloat = typeof lo === 'number' || typeof hi === 'number' || typeof x === 'number';
  if (anyFloat) {
    const ln = _toNum(lo, 'clamp'), hn = _toNum(hi, 'clamp'), xn = _toNum(x, 'clamp');
    return xn < ln ? ln : (xn > hn ? hn : xn);
  }
  if (typeof lo !== 'bigint' || typeof hi !== 'bigint' || typeof x !== 'bigint')
    throw new Error('clamp() requires numeric arguments.');
  return x < lo ? lo : (x > hi ? hi : x);
}

function lerp(a, b, t) {
  const an = _toNum(a, 'lerp'), bn = _toNum(b, 'lerp'), tn = _toNum(t, 'lerp');
  return _checkResult(an + tn * (bn - an), `lerp(${an}, ${bn}, ${tn})`);
}

// ── Powers & logarithms ────────────────────────────────────────────────────────
const sqrt  = _mathFn1('sqrt',  Math.sqrt);
const cbrt  = _mathFn1('cbrt',  Math.cbrt);
const exp   = _mathFn1('exp',   Math.exp);
const log   = _mathFn1('log',   Math.log);
const log2  = _mathFn1('log2',  Math.log2);
const log10 = _mathFn1('log10', Math.log10);
const pow   = _mathFn2('pow',   Math.pow);
const hypot = _mathFn2('hypot', Math.hypot);
function fmod(x, y) {
  const xn = _toNum(x, 'fmod'), yn = _toNum(y, 'fmod');
  if (yn === 0) throw new Error('Float domain error: fmod(x, 0) is undefined.');
  return _checkResult(xn % yn, `fmod(${xn}, ${yn})`);
}

// ── Trigonometry ───────────────────────────────────────────────────────────────
const sin  = _mathFn1('sin',  Math.sin);
const cos  = _mathFn1('cos',  Math.cos);
const tan  = _mathFn1('tan',  Math.tan);
const asin = _mathFn1('asin', Math.asin);
const acos = _mathFn1('acos', Math.acos);
const atan = _mathFn1('atan', Math.atan);
const atan2 = _mathFn2('atan2', Math.atan2);

// ── Hyperbolic ─────────────────────────────────────────────────────────────────
const sinh = _mathFn1('sinh', Math.sinh);
const cosh = _mathFn1('cosh', Math.cosh);
const tanh = _mathFn1('tanh', Math.tanh);

// ── Formatting ─────────────────────────────────────────────────────────────────

// formatFixed(n, x) — format number n to exactly x decimal places.
// n may be Int (BigInt) or Float (number). x must be an Int in 0–100.
// Returns a string, e.g. formatFixed(3.14159, 2) === "3.14".
function formatFixed(n, x) {
  if (typeof n !== 'number' && typeof n !== 'bigint')
    throw new Error('formatFixed() requires a numeric first argument.');
  if (typeof x !== 'bigint')
    throw new Error('formatFixed() requires an integer second argument (number of decimal places).');
  const decimals = Number(x);
  if (decimals < 0 || decimals > 100)
    throw new Error(`formatFixed() decimal places must be 0–100, got ${decimals}.`);
  const num = typeof n === 'bigint' ? Number(n) : n;
  if (isNaN(num))     throw new Error('Float domain error: formatFixed() called with NaN.');
  if (!isFinite(num)) throw new Error('Float domain error: formatFixed() called with Infinity.');
  return num.toFixed(decimals);
}

module.exports = {
  pi, e, tau, inf, nan,
  abs, sign, min, max, clamp, lerp,
  sqrt, cbrt, exp, log, log2, log10, pow, hypot, fmod,
  sin, cos, tan, asin, acos, atan, atan2,
  sinh, cosh, tanh,
  formatFixed,
};
