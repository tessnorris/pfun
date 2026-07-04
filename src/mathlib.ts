// src/mathlib.ts
// Mathematical function library for Pfun.
// Imported by user scripts via: import * from "math";
//
// All functions that can produce NaN or Infinity check their result and throw
// a FloatDomain error rather than silently propagating bad values.
//
// Type conventions:
//   - Functions that accept both int and float promote int -> float internally
//   - atan2, hypot, pow, fmod accept two numeric arguments
//   - Constants (pi, e, tau, inf) are plain number values

import { Interpreter, NativeFunction, RegistryFunction, PfunChar } from './interpreter';

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Coerce bigint or number to JS number. Throws for non-numeric values. */
function toNum(v: any, fnName: string): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  throw new Error(`${fnName}() requires a numeric argument, got ${typeof v}.`);
}

/** Check that a float result is finite and not NaN. */
function checkResult(result: number, context: string): number {
  if (isNaN(result))       throw new Error(`Float domain error: ${context} produced NaN.`);
  if (!isFinite(result))   throw new Error(`Float domain error: ${context} produced Infinity.`);
  return result;
}

/** Wrap a single-arg Math.* function with type coercion and domain checking. */
function mathFn1(name: string, impl: (x: number) => number): RegistryFunction {
  return { name, arity: 1, fn: (args, interp) => {
    const x = toNum(interp.force(args[0]), name);
    return checkResult(impl(x), `${name}(${x})`);
  }};
}

/** Wrap a two-arg Math.* function with type coercion and domain checking. */
function mathFn2(name: string, impl: (x: number, y: number) => number): RegistryFunction {
  return { name, arity: 2, fn: (args, interp) => {
    const x = toNum(interp.force(args[0]), name);
    const y = toNum(interp.force(args[1]), name);
    return checkResult(impl(x, y), `${name}(${x}, ${y})`);
  }};
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const mathlibFunctions: RegistryFunction[] = [

  // ── Constants (arity 0 — just return the value) ────────────────────────────
  { name: 'pi',  fn: () => Math.PI },
  { name: 'e',   fn: () => Math.E },
  { name: 'tau', fn: () => Math.PI * 2 },
  // inf and nan are values the user can test against; they don't throw on creation
  { name: 'inf', fn: () => Infinity },
  { name: 'nan', fn: () => NaN },

  // ── Basic ──────────────────────────────────────────────────────────────────

  { name: 'abs', arity: 1, fn: (args, interp) => {
    const v = interp.force(args[0]);
    if (typeof v === 'bigint') return v < 0n ? -v : v;
    if (typeof v === 'number') return Math.abs(v);
    throw new Error(`abs() requires a numeric argument, got ${typeof v}.`);
  }},

  { name: 'sign', arity: 1, fn: (args, interp) => {
    const v = interp.force(args[0]);
    if (typeof v === 'bigint') return v > 0n ? 1n : (v < 0n ? -1n : 0n);
    if (typeof v === 'number') return Math.sign(v);
    throw new Error(`sign() requires a numeric argument, got ${typeof v}.`);
  }},

  { name: 'min', arity: 2, fn: (args, interp) => {
    const a = interp.force(args[0]);
    const b = interp.force(args[1]);
    const aIsFloat = typeof a === 'number';
    const bIsFloat = typeof b === 'number';
    if (!aIsFloat && typeof a !== 'bigint') throw new Error("min() requires numeric arguments.");
    if (!bIsFloat && typeof b !== 'bigint') throw new Error("min() requires numeric arguments.");
    if (aIsFloat || bIsFloat) {
      return Math.min(typeof a === 'bigint' ? Number(a) : a, typeof b === 'bigint' ? Number(b) : b);
    }
    return a < b ? a : b;
  }},

  { name: 'max', arity: 2, fn: (args, interp) => {
    const a = interp.force(args[0]);
    const b = interp.force(args[1]);
    const aIsFloat = typeof a === 'number';
    const bIsFloat = typeof b === 'number';
    if (!aIsFloat && typeof a !== 'bigint') throw new Error("max() requires numeric arguments.");
    if (!bIsFloat && typeof b !== 'bigint') throw new Error("max() requires numeric arguments.");
    if (aIsFloat || bIsFloat) {
      return Math.max(typeof a === 'bigint' ? Number(a) : a, typeof b === 'bigint' ? Number(b) : b);
    }
    return a > b ? a : b;
  }},

  { name: 'clamp', arity: 3, fn: (args, interp) => {
    const lo = interp.force(args[0]);
    const hi = interp.force(args[1]);
    const x  = interp.force(args[2]);
    const anyFloat = typeof lo === 'number' || typeof hi === 'number' || typeof x === 'number';
    if (anyFloat) {
      const ln = toNum(lo, 'clamp'), hn = toNum(hi, 'clamp'), xn = toNum(x, 'clamp');
      return xn < ln ? ln : (xn > hn ? hn : xn);
    }
    if (typeof lo !== 'bigint' || typeof hi !== 'bigint' || typeof x !== 'bigint')
      throw new Error("clamp() requires numeric arguments.");
    return x < lo ? lo : (x > hi ? hi : x);
  }},

  // ── Powers & logarithms ────────────────────────────────────────────────────

  mathFn1('sqrt',  Math.sqrt),
  mathFn1('cbrt',  Math.cbrt),
  mathFn1('exp',   Math.exp),
  mathFn1('log',   Math.log),    // natural log; throws on log(0) or log(-x)
  mathFn1('log2',  Math.log2),
  mathFn1('log10', Math.log10),
  mathFn2('pow',   Math.pow),
  mathFn2('hypot', Math.hypot),
  mathFn2('fmod',  (x, y) => {
    if (y === 0) throw new Error('Float domain error: fmod(x, 0) is undefined.');
    return x % y;
  }),

  // Linear interpolation: lerp(a, b, t) = a + t*(b-a)
  { name: 'lerp', arity: 3, fn: (args, interp) => {
    const a = toNum(interp.force(args[0]), 'lerp');
    const b = toNum(interp.force(args[1]), 'lerp');
    const t = toNum(interp.force(args[2]), 'lerp');
    return checkResult(a + t * (b - a), `lerp(${a}, ${b}, ${t})`);
  }},

  // ── Trigonometry ───────────────────────────────────────────────────────────

  mathFn1('sin',  Math.sin),
  mathFn1('cos',  Math.cos),
  mathFn1('tan',  Math.tan),
  mathFn1('asin', Math.asin),
  mathFn1('acos', Math.acos),
  mathFn1('atan', Math.atan),
  mathFn2('atan2', Math.atan2),

  // ── Hyperbolic ─────────────────────────────────────────────────────────────

  mathFn1('sinh', Math.sinh),
  mathFn1('cosh', Math.cosh),
  mathFn1('tanh', Math.tanh),

  // ── Formatting ─────────────────────────────────────────────────────────────

  // formatFixed(n, x) — format the number n to exactly x decimal places.
  // n may be Int or Float.  x must be an Int in 0–100.
  // Returns a Str, e.g. formatFixed(3.14159, 2) = "3.14".
  // Throws FloatDomain if n is NaN or Infinity.
  // Throws a RangeError if x is negative or greater than 100.
  { name: 'formatFixed', arity: 2, fn: (args, interp) => {
    const n = interp.force(args[0]);
    const x = interp.force(args[1]);
    if (typeof n !== 'number' && typeof n !== 'bigint')
      throw new Error("formatFixed() requires a numeric first argument.");
    if (typeof x !== 'bigint')
      throw new Error("formatFixed() requires an integer second argument (number of decimal places).");
    const decimals = Number(x);
    if (decimals < 0 || decimals > 100)
      throw new Error(`formatFixed() decimal places must be 0–100, got ${decimals}.`);
    const num = typeof n === 'bigint' ? Number(n) : n;
    if (isNaN(num))      throw new Error("Float domain error: formatFixed() called with NaN.");
    if (!isFinite(num))  throw new Error("Float domain error: formatFixed() called with Infinity.");
    return num.toFixed(decimals);
  }},
];
