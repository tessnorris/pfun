"use strict";

// host/core.js — shared Pfun V2 bootstrap runtime floor.
//
// This file intentionally contains the platform-neutral ABI and intrinsics only.
// Node filesystem/process/HTTP/database intrinsics belong in host/node.js; browser
// DOM/fetch/event-loop intrinsics belong in host/browser.js. A few simple console
// intrinsics are included because they have useful behavior on both Node and the
// browser console.
//
// The exported names match the early bootstrap builtins/spec.pf intrinsic names:
//   $str, $length, $map, $filter, $reduce, $split, $join, ...
//
// The runtime representation follows the V2 architecture draft:
//   Int        number in safe range, bigint outside, canonicalized
//   Float      JS number
//   Unit/Nil   null
//   List       strict JS Array, or hidden lazy-list object
//   Record     { $t, $u, f, ...named fields... }
//   Array      { $arr: [...] }
//   Dict       { $dict: Map }
//   Buffer     { $buf: number[], $mode }

(function attachPfunCore(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.PfunCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildPfunCore() {
  const SAFE_MIN = Number.MIN_SAFE_INTEGER;
  const SAFE_MAX = Number.MAX_SAFE_INTEGER;
  const BYTE_MASK = 0xff;

  // ── diagnostics / runtime assertions ────────────────────────────────────

  function $runtimeError(message) {
    throw new Error("Pfun runtime error: " + message);
  }

  function $matchFail(subject) {
    $runtimeError("non-exhaustive match reached for " + $str(subject));
  }

  function $unreachable(message) {
    $runtimeError("internal compiler assertion failed" + (message ? ": " + message : ""));
  }

  function $unsupportedIntrinsic(name, platform) {
    $runtimeError(name + " is not available on " + platform + ". This intrinsic belongs in a platform host file.");
  }

  // ── record / variant ABI ────────────────────────────────────────────────

  function $makeRecord(typeName, fieldNames, values) {
    const out = { $t: String(typeName), $u: undefined, f: values.slice() };
    for (let i = 0; i < fieldNames.length; i += 1) {
      out[fieldNames[i]] = values[i];
    }
    return out;
  }

  function $makeVariant(variantName, unionName, fieldNames, values) {
    const out = { $t: String(variantName), $u: String(unionName), f: values.slice() };
    for (let i = 0; i < fieldNames.length; i += 1) {
      out[fieldNames[i]] = values[i];
    }
    return out;
  }

  function $unit() {
    return null;
  }

  function $none() {
    return $makeVariant("None", "Option", [], []);
  }

  function $some(value) {
    return $makeVariant("Some", "Option", ["value"], [value]);
  }

  function $ok(value) {
    return $makeVariant("Ok", "Result", ["value"], [value]);
  }

  function $err(message) {
    return $makeVariant("Err", "Result", ["message"], [String(message)]);
  }

  function $pair(key, value) {
    return $makeRecord("Pair", ["key", "value"], [key, value]);
  }

  function $isSome(value) {
    return !!value && value.$u === "Option" && value.$t === "Some";
  }

  function $isNone(value) {
    return !!value && value.$u === "Option" && value.$t === "None";
  }

  // ── Int helpers: hybrid number/bigint representation ────────────────────

  function $canonI(value) {
    if (typeof value === "bigint") {
      if (value >= BigInt(SAFE_MIN) && value <= BigInt(SAFE_MAX)) {
        return Number(value);
      }
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        $runtimeError("expected Int, got " + String(value));
      }
      if (Number.isSafeInteger(value)) {
        return value;
      }
      return BigInt(Math.trunc(value));
    }
    $runtimeError("expected Int, got " + typeof value);
  }

  function $toBigI(value) {
    value = $canonI(value);
    return typeof value === "bigint" ? value : BigInt(value);
  }

  function $smallI(value) {
    value = $canonI(value);
    return typeof value === "number" && Math.abs(value) < 0x7fffffff;
  }

  function $addI(a, b) {
    a = $canonI(a);
    b = $canonI(b);
    if (typeof a === "number" && typeof b === "number") {
      const r = a + b;
      if (Number.isSafeInteger(r)) return r;
    }
    return $canonI($toBigI(a) + $toBigI(b));
  }

  function $subI(a, b) {
    a = $canonI(a);
    b = $canonI(b);
    if (typeof a === "number" && typeof b === "number") {
      const r = a - b;
      if (Number.isSafeInteger(r)) return r;
    }
    return $canonI($toBigI(a) - $toBigI(b));
  }

  function $mulI(a, b) {
    a = $canonI(a);
    b = $canonI(b);
    if (typeof a === "number" && typeof b === "number") {
      const r = a * b;
      if (Number.isSafeInteger(r)) return r;
    }
    return $canonI($toBigI(a) * $toBigI(b));
  }

  function $negI(a) {
    a = $canonI(a);
    if (typeof a === "number") return -a;
    return $canonI(-a);
  }

  function $divI(a, b) {
    a = $canonI(a);
    b = $canonI(b);
    if ($eqI(b, 0)) {
      $runtimeError("integer division by zero reached host runtime");
    }
    if ($smallI(a) && $smallI(b)) {
      return $canonI(Math.trunc(a / b));
    }
    return $canonI($toBigI(a) / $toBigI(b));
  }

  function $modI(a, b) {
    a = $canonI(a);
    b = $canonI(b);
    if ($eqI(b, 0)) {
      $runtimeError("integer modulo by zero reached host runtime");
    }
    if ($smallI(a) && $smallI(b)) {
      return $canonI(a % b);
    }
    return $canonI($toBigI(a) % $toBigI(b));
  }

  function $bitAndI(a, b) {
    return $canonI($toBigI(a) & $toBigI(b));
  }

  function $bitOrI(a, b) {
    return $canonI($toBigI(a) | $toBigI(b));
  }

  function $shlI(a, b) {
    return $canonI($toBigI(a) << $toBigI(b));
  }

  function $shrI(a, b) {
    return $canonI($toBigI(a) >> $toBigI(b));
  }

  function $cmpI(a, b) {
    a = $canonI(a);
    b = $canonI(b);
    if (typeof a === typeof b) {
      return a < b ? -1 : (a > b ? 1 : 0);
    }
    const aa = $toBigI(a);
    const bb = $toBigI(b);
    return aa < bb ? -1 : (aa > bb ? 1 : 0);
  }

  function $eqI(a, b) { return $cmpI(a, b) === 0; }
  function $ltI(a, b) { return $cmpI(a, b) < 0; }
  function $leI(a, b) { return $cmpI(a, b) <= 0; }
  function $gtI(a, b) { return $cmpI(a, b) > 0; }
  function $geI(a, b) { return $cmpI(a, b) >= 0; }

  function $nonZero(n) {
    n = $canonI(n);
    return $eqI(n, 0) ? $none() : $some(n);
  }

  function $safeDiv(a, b) {
    b = $canonI(b);
    return $eqI(b, 0) ? $none() : $some($divI(a, b));
  }

  function $safeMod(a, b) {
    b = $canonI(b);
    return $eqI(b, 0) ? $none() : $some($modI(a, b));
  }

  // ── Float total-order helpers ───────────────────────────────────────────

  function $floatRank(n) {
    if (Number.isNaN(n)) return 4;
    if (n === Infinity) return 3;
    if (n === -Infinity) return 1;
    return 2;
  }

  function $cmpF(a, b) {
    a = Number(a);
    b = Number(b);
    const ra = $floatRank(a);
    const rb = $floatRank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    if (Number.isNaN(a) && Number.isNaN(b)) return 0;
    if (a < b) return -1;
    if (a > b) return 1;
    return 0; // includes -0 == +0
  }

  function $eqF(a, b) { return $cmpF(a, b) === 0; }
  function $ltF(a, b) { return $cmpF(a, b) < 0; }
  function $leF(a, b) { return $cmpF(a, b) <= 0; }
  function $gtF(a, b) { return $cmpF(a, b) > 0; }
  function $geF(a, b) { return $cmpF(a, b) >= 0; }

  function $floor(x) { return $canonI(Math.floor(Number(x))); }
  function $ceil(x) { return $canonI(Math.ceil(Number(x))); }
  function $round(x) { return $canonI(Math.round(Number(x))); }
  function $isNaN_(x) { return Number.isNaN(Number(x)); }
  function $isFinite_(x) { return typeof x === "bigint" ? true : Number.isFinite(Number(x)); }

  // ── Byte helpers ────────────────────────────────────────────────────────

  function $byte(value) {
    const n = Number($canonI(value));
    if (n < 0 || n > 255) return $none();
    return $some(n & BYTE_MASK);
  }

  function $wrapByte(value) {
    return Number(value) & BYTE_MASK;
  }

  function $addB(a, b) { return $wrapByte(a + b); }
  function $subB(a, b) { return $wrapByte(a - b); }
  function $mulB(a, b) { return $wrapByte(a * b); }
  function $bitAndB(a, b) { return $wrapByte(a & b); }
  function $bitOrB(a, b) { return $wrapByte(a | b); }
  function $shlB(a, b) { return $wrapByte(a << (b & 7)); }
  function $shrB(a, b) { return $wrapByte(a >> (b & 7)); }

  // ── Char / Str / UTF-8 ──────────────────────────────────────────────────

  function $concatS(a, b) {
    if (typeof a !== "string" || typeof b !== "string") {
      $runtimeError("++ expects Str and Str");
    }
    return a + b;
  }

  function $asc(c) {
    if (typeof c !== "string" || c.length === 0) {
      $runtimeError("asc expects Char");
    }
    return $canonI(c.codePointAt(0));
  }

  function $chr(n) {
    n = Number($canonI(n));
    if (n < 0 || n > 0x10ffff) return $none();
    if (n >= 0xd800 && n <= 0xdfff) return $none();
    return $some(String.fromCodePoint(n));
  }

  function $utf8Encode(str) {
    str = String(str);
    if (typeof TextEncoder !== "undefined") {
      return Array.from(new TextEncoder().encode(str));
    }
    if (typeof Buffer !== "undefined") {
      return Array.from(Buffer.from(str, "utf8"));
    }
    $runtimeError("no UTF-8 encoder available");
  }

  function $utf8Decode(bytes) {
    const arr = $listToArray(bytes).map(function toByte(x) { return Number(x) & BYTE_MASK; });
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(arr));
    }
    if (typeof Buffer !== "undefined") {
      return Buffer.from(arr).toString("utf8");
    }
    $runtimeError("no UTF-8 decoder available");
  }

  function $charBytes(c) {
    return $utf8Encode(c);
  }

  function $bytesToChar(bytes) {
    try {
      const s = $utf8Decode(bytes);
      const cps = Array.from(s);
      return cps.length === 1 ? $some(cps[0]) : $none();
    } catch (_) {
      return $none();
    }
  }

  function $split(str, delim) {
    str = String(str);
    delim = String(delim);
    if (delim === "") return Array.from(str);
    return str.split(delim);
  }

  function $join(values, delim) {
    delim = String(delim);
    return $listToArray(values).map($str).join(delim);
  }

  // ── strict/lazy list helpers ────────────────────────────────────────────

  function $lazy(factory) {
    return {
      $lazy: true,
      factory: factory,
      iterator: null,
      cache: [],
      done: false
    };
  }

  function $isLazyList(value) {
    return !!value && value.$lazy === true;
  }

  function $isList(value) {
    return Array.isArray(value) || $isLazyList(value);
  }

  function $iteratorOf(xs) {
    if (Array.isArray(xs)) return xs[Symbol.iterator]();
    if ($isLazyList(xs)) {
      return (function* iterateLazy() {
        let i = 0;
        while (true) {
          const cell = $forceLazyIndex(xs, i);
          if (!cell.ok) return;
          yield cell.value;
          i += 1;
        }
      })();
    }
    $runtimeError("expected List");
  }

  function $forceLazyIndex(xs, index) {
    if (!$isLazyList(xs)) {
      if (!Array.isArray(xs)) $runtimeError("expected List");
      if (index < 0 || index >= xs.length) return { ok: false };
      return { ok: true, value: xs[index] };
    }

    if (index < xs.cache.length) {
      return { ok: true, value: xs.cache[index] };
    }
    if (xs.done) return { ok: false };
    if (xs.iterator === null) xs.iterator = xs.factory();

    while (xs.cache.length <= index && !xs.done) {
      const next = xs.iterator.next();
      if (next.done) {
        xs.done = true;
        return { ok: false };
      }
      xs.cache.push(next.value);
    }

    if (index < xs.cache.length) return { ok: true, value: xs.cache[index] };
    return { ok: false };
  }

  function $forcePrefix(xs, count) {
    if (count <= 0) return [];
    if (Array.isArray(xs)) return xs.slice(0, count);
    if (!$isLazyList(xs)) $runtimeError("expected List");
    const out = [];
    for (let i = 0; i < count; i += 1) {
      const cell = $forceLazyIndex(xs, i);
      if (!cell.ok) return out;
      out.push(cell.value);
    }
    return out;
  }

  function $listToArray(xs) {
    if (Array.isArray(xs)) return xs.slice();
    if (!$isLazyList(xs)) $runtimeError("expected List");
    const out = [];
    let i = 0;
    while (true) {
      const cell = $forceLazyIndex(xs, i);
      if (!cell.ok) return out;
      out.push(cell.value);
      i += 1;
    }
  }

  function $length(x) {
    if (typeof x === "string") return $canonI(x.length);
    if (Array.isArray(x)) return $canonI(x.length);
    if ($isLazyList(x)) return $canonI($listToArray(x).length); // FULL
    if (x && x.$arr) return $canonI(x.$arr.length);
    if (x && x.$dict) return $canonI(x.$dict.size);
    $runtimeError("length expects Str or List");
  }

  function $reverse(xs) {
    if (typeof xs === "string") return Array.from(xs).reverse().join("");
    return $listToArray(xs).reverse();
  }

  function $cons(x, xs) {
    if (typeof xs === "string") {
      if (typeof x !== "string") $runtimeError("cons(Char, Str) expects Char");
      return x + xs;
    }
    if (Array.isArray(xs)) return [x].concat(xs);
    if ($isLazyList(xs)) {
      return $lazy(function* consLazy() {
        yield x;
        yield* $iteratorOf(xs);
      });
    }
    $runtimeError("cons expects List or Str");
  }

  function $slice(start, count, seq) {
    start = Number($canonI(start));
    count = Number($canonI(count));
    if (count <= 0) return typeof seq === "string" ? "" : [];
    if (typeof seq === "string") return seq.slice(start, start + count);
    if (Array.isArray(seq)) return seq.slice(start, start + count);
    if ($isLazyList(seq)) return $forcePrefix(seq, start + count).slice(start, start + count);
    $runtimeError("slice expects Str or List");
  }

  function $take(count, xs) {
    count = Number($canonI(count));
    if (typeof xs === "string") return xs.slice(0, count);
    return $forcePrefix(xs, count);
  }

  function $range(lo, hi) {
    lo = Number($canonI(lo));
    hi = Number($canonI(hi));
    const out = [];
    if (lo <= hi) {
      for (let i = lo; i <= hi; i += 1) out.push($canonI(i));
    } else {
      for (let i = lo; i >= hi; i -= 1) out.push($canonI(i));
    }
    return out;
  }

  function $map(fn, xs) {
    if (typeof xs === "string") return Array.from(xs).map(fn).join("");
    if (Array.isArray(xs)) return xs.map(fn);
    if ($isLazyList(xs)) {
      return $lazy(function* mapLazy() {
        for (const x of $iteratorOf(xs)) yield fn(x);
      });
    }
    $runtimeError("map expects List or Str");
  }

  function $filter(pred, xs) {
    if (typeof xs === "string") return Array.from(xs).filter(pred).join("");
    if (Array.isArray(xs)) return xs.filter(pred);
    if ($isLazyList(xs)) {
      return $lazy(function* filterLazy() {
        for (const x of $iteratorOf(xs)) {
          if (pred(x)) yield x;
        }
      });
    }
    $runtimeError("filter expects List or Str");
  }

  function $reduce(fn, seed, xs) {
    let acc = seed;
    if (typeof xs === "string") {
      for (const ch of Array.from(xs)) acc = fn(acc, ch);
      return acc;
    }
    for (const x of $iteratorOf(xs)) acc = fn(acc, x);
    return acc;
  }

  function $find(seq, item) {
    if (typeof seq === "string") {
      const needle = String(item);
      const idx = Array.from(seq).findIndex(function each(ch) { return ch === needle; });
      return idx < 0 ? $none() : $some($canonI(idx));
    }
    let i = 0;
    for (const x of $iteratorOf(seq)) {
      if ($eq(x, item)) return $some($canonI(i));
      i += 1;
    }
    return $none();
  }

  function $findSlice(seq, sub) {
    if (typeof seq === "string") {
      const idx = seq.indexOf(String(sub));
      return idx < 0 ? $none() : $some($canonI(idx));
    }
    const hay = $listToArray(seq);
    const needle = $listToArray(sub);
    if (needle.length === 0) return $some(0);
    for (let i = 0; i <= hay.length - needle.length; i += 1) {
      let ok = true;
      for (let j = 0; j < needle.length; j += 1) {
        if (!$eq(hay[i + j], needle[j])) {
          ok = false;
          break;
        }
      }
      if (ok) return $some($canonI(i));
    }
    return $none();
  }

  function $nth(xs, index) {
    index = Number($canonI(index));
    if (index < 0) return $none();
    if (typeof xs === "string") {
      if (index >= xs.length) return $none();
      const cp = xs.codePointAt(index);
      if (cp === undefined) return $none();
      const ch = String.fromCodePoint(cp);
      if (xs[index] !== ch[0]) return $none();
      return $some(ch);
    }
    const cell = $forceLazyIndex(xs, index);
    return cell.ok ? $some(cell.value) : $none();
  }

  function $head(xs) {
    return $nth(xs, 0);
  }

  function $tail(xs) {
    if (typeof xs === "string") return xs.length === 0 ? $none() : $some(xs.slice(1));
    if (Array.isArray(xs)) return xs.length === 0 ? $none() : $some(xs.slice(1));
    if ($isLazyList(xs)) {
      const first = $forceLazyIndex(xs, 0);
      if (!first.ok) return $none();
      return $some($lazy(function* tailLazy() {
        let i = 1;
        while (true) {
          const cell = $forceLazyIndex(xs, i);
          if (!cell.ok) return;
          yield cell.value;
          i += 1;
        }
      }));
    }
    $runtimeError("tail expects List or Str");
  }

  function $appendList(a, b) {
    if (typeof a === "string" && typeof b === "string") return a + b;
    if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
    return $lazy(function* appendLazy() {
      yield* $iteratorOf(a);
      yield* $iteratorOf(b);
    });
  }

  // ── equality / comparison / dict key encoding ───────────────────────────

  function $eq(a, b) {
    if (typeof a === "bigint" || typeof b === "bigint") {
      if ((typeof a === "bigint" || typeof a === "number") && (typeof b === "bigint" || typeof b === "number")) {
        return $eqI(a, b);
      }
      return false;
    }
    if (typeof a === "number" && typeof b === "number") {
      if (Number.isNaN(a) && Number.isNaN(b)) return true;
      return a === b; // includes -0 == +0
    }
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (Array.isArray(a) || $isLazyList(a)) {
      if (!(Array.isArray(b) || $isLazyList(b))) return false;
      const aa = $listToArray(a);
      const bb = $listToArray(b);
      if (aa.length !== bb.length) return false;
      for (let i = 0; i < aa.length; i += 1) {
        if (!$eq(aa[i], bb[i])) return false;
      }
      return true;
    }
    if (a && b && typeof a === "object") {
      if (a.$t !== undefined || b.$t !== undefined) {
        if (a.$t !== b.$t || a.$u !== b.$u) return false;
        const af = a.f || [];
        const bf = b.f || [];
        if (af.length !== bf.length) return false;
        for (let i = 0; i < af.length; i += 1) {
          if (!$eq(af[i], bf[i])) return false;
        }
        return true;
      }
      return a === b;
    }
    return false;
  }

  function $cmpScalar(a, b) {
    if (typeof a === "bigint" || typeof b === "bigint") return $cmpI(a, b);
    if (typeof a === "number" && typeof b === "number") return $cmpF(a, b);
    if (typeof a === "string" && typeof b === "string") return a < b ? -1 : (a > b ? 1 : 0);
    if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 0 : (a ? 1 : -1);
    $runtimeError("values are not comparable");
  }

  function $dictKey(value) {
    if (typeof value === "string") return "s:" + value;
    if (typeof value === "boolean") return "b:" + (value ? "1" : "0");
    if (typeof value === "bigint") return "i:" + $toBigI(value).toString();
    if (typeof value === "number") {
      if (Number.isInteger(value)) return "i:" + $toBigI(value).toString();
      if (Number.isNaN(value)) return "f:NaN";
      if (Object.is(value, -0)) return "f:0";
      return "f:" + String(value);
    }
    if (value === null) return "u:null";
    $runtimeError("unsupported dictionary key: " + $str(value));
  }

  // ── mutable Array / Dict / Buffer / ref cells ───────────────────────────

  function $newArray(values) {
    return { $arr: (values || []).slice() };
  }

  function $arrGet(arr, index) {
    index = Number($canonI(index));
    if (!arr || !arr.$arr) $runtimeError("arrGet expects Array");
    if (index < 0 || index >= arr.$arr.length) return $none();
    return $some(arr.$arr[index]);
  }

  function $arrSet(arr, index, value) {
    index = Number($canonI(index));
    if (!arr || !arr.$arr) $runtimeError("arrSet expects Array");
    if (index < 0 || index >= arr.$arr.length) return false;
    arr.$arr[index] = value;
    return true;
  }

  function $arrayLength(arr) {
    if (!arr || !arr.$arr) $runtimeError("arrayLength expects Array");
    return $canonI(arr.$arr.length);
  }

  function $arrayAppend(arr, value) {
    if (!arr || !arr.$arr) $runtimeError("append expects Array");
    arr.$arr.push(value);
    return null;
  }

  function $removeAt(arr, index) {
    index = Number($canonI(index));
    if (!arr || !arr.$arr) $runtimeError("removeAt expects Array");
    if (index < 0 || index >= arr.$arr.length) return false;
    arr.$arr.splice(index, 1);
    return true;
  }

  function $insertAt(arr, index, value) {
    index = Number($canonI(index));
    if (!arr || !arr.$arr) $runtimeError("insertAt expects Array");
    if (index < 0 || index > arr.$arr.length) return false;
    arr.$arr.splice(index, 0, value);
    return true;
  }

  function $toList(value) {
    if (value && value.$arr) return value.$arr.slice();
    if (typeof value === "string") return Array.from(value);
    if ($isList(value)) return $listToArray(value);
    $runtimeError("toList expects Array, Str, or List");
  }

  function $toArray(value) {
    if (value && value.$arr) return $newArray(value.$arr);
    if (typeof value === "string") return $newArray(Array.from(value));
    return $newArray($listToArray(value));
  }

  function $newDict(entries) {
    const d = { $dict: new Map() };
    if (entries) {
      for (const p of entries) $dictSet(d, p.key, p.value);
    }
    return d;
  }

  function $dictGet(dict, key) {
    if (!dict || !dict.$dict) $runtimeError("dict get expects Dict");
    const encoded = $dictKey(key);
    return dict.$dict.has(encoded) ? $some(dict.$dict.get(encoded).value) : $none();
  }

  function $dictSet(dict, key, value) {
    if (!dict || !dict.$dict) $runtimeError("dict set expects Dict");
    dict.$dict.set($dictKey(key), { key: key, value: value });
    return null;
  }

  function $dictHas(dict, key) {
    if (!dict || !dict.$dict) $runtimeError("has expects Dict");
    return dict.$dict.has($dictKey(key));
  }

  function $dictRemove(dict, key) {
    if (!dict || !dict.$dict) $runtimeError("remove expects Dict");
    return dict.$dict.delete($dictKey(key));
  }

  function $dictKeys(dict) {
    if (!dict || !dict.$dict) $runtimeError("keys expects Dict");
    return Array.from(dict.$dict.values()).map(function keyOf(p) { return p.key; });
  }

  function $dictValues(dict) {
    if (!dict || !dict.$dict) $runtimeError("values expects Dict");
    return Array.from(dict.$dict.values()).map(function valueOf(p) { return p.value; });
  }

  function $dictToList(dict) {
    if (!dict || !dict.$dict) $runtimeError("dictToList expects Dict");
    return Array.from(dict.$dict.values()).map(function pairOf(p) { return $pair(p.key, p.value); });
  }

  function $listToDict(pairs) {
    const d = $newDict();
    for (const p of $listToArray(pairs)) $dictSet(d, p.key, p.value);
    return d;
  }

  function $makeBuffer(mode) {
    return { $buf: [], $mode: mode && mode.$t ? mode.$t : String(mode || "ByteMode") };
  }

  function $makeStringBuffer(str) {
    const b = $makeBuffer("CharMode");
    $appendString(b, str);
    return b;
  }

  function $appendByteBuffer(buf, bytes) {
    if (!buf || !buf.$buf) $runtimeError("appendBuffer expects Buffer");
    for (const x of $listToArray(bytes)) buf.$buf.push(Number(x) & BYTE_MASK);
    return null;
  }

  function $appendChar(buf, ch) {
    return $appendByteBuffer(buf, $charBytes(ch));
  }

  function $appendString(buf, str) {
    return $appendByteBuffer(buf, $utf8Encode(str));
  }

  function $bufferLength(buf) {
    if (!buf || !buf.$buf) $runtimeError("bufferLength expects Buffer");
    return $canonI(buf.$buf.length);
  }

  function $bufferToBytes(buf) {
    if (!buf || !buf.$buf) $runtimeError("bufferToBytes expects Buffer");
    return buf.$buf.slice();
  }

  function $bufferToString(buf) {
    if (!buf || !buf.$buf) $runtimeError("bufferToString expects Buffer");
    return $utf8Decode(buf.$buf);
  }

  function $ref(value) { return { $ref: value }; }
  function $getRef(cell) { return cell.$ref; }
  function $setRef(cell, value) { cell.$ref = value; return null; }

  // ── function helpers ────────────────────────────────────────────────────

  function $curry(fn, arity, collected) {
    collected = collected || [];
    return function curried() {
      const args = collected.concat(Array.from(arguments));
      if (args.length >= arity) return fn.apply(null, args);
      return $curry(fn, arity, args);
    };
  }

  function $memoize(fn) {
    const cache = new Map();
    return function memoized() {
      const key = JSON.stringify(Array.from(arguments).map($stableKeyPart));
      if (cache.has(key)) return cache.get(key);
      const value = fn.apply(null, arguments);
      cache.set(key, value);
      return value;
    };
  }

  function $stableKeyPart(value) {
    if (typeof value === "bigint") return { bigint: value.toString() };
    if (typeof value === "number") {
      if (Number.isNaN(value)) return { number: "NaN" };
      if (Object.is(value, -0)) return { number: "0" };
      return { number: value };
    }
    if (Array.isArray(value) || $isLazyList(value)) return $listToArray(value).map($stableKeyPart);
    if (value && typeof value === "object" && value.$t !== undefined) {
      return { t: value.$t, u: value.$u, f: (value.f || []).map($stableKeyPart) };
    }
    return value;
  }

  // ── JSON helpers ────────────────────────────────────────────────────────

  function $jsonSerialize(value) {
    try {
      return $some(JSON.stringify($toTaggedJson(value)));
    } catch (_) {
      return $none();
    }
  }

  function $jsonDeserialize(text) {
    try {
      return $some($fromTaggedJson(JSON.parse(String(text))));
    } catch (_) {
      return $none();
    }
  }

  function $toTaggedJson(value) {
    if (typeof value === "bigint") return { __pfun: "int", v: value.toString() };
    if (typeof value === "number" && Number.isInteger(value) && Number.isSafeInteger(value)) return { __pfun: "int", v: String(value) };
    if (typeof value === "string" || typeof value === "boolean" || value === null) return value;
    if (typeof value === "number") {
      if (Number.isNaN(value)) return { __pfun: "float", v: "NaN" };
      if (value === Infinity) return { __pfun: "float", v: "Infinity" };
      if (value === -Infinity) return { __pfun: "float", v: "-Infinity" };
      return value;
    }
    if (Array.isArray(value) || $isLazyList(value)) return $listToArray(value).map($toTaggedJson);
    if (value && value.$t !== undefined) {
      const obj = { __pfun: "record", __type: value.$t };
      if (value.$u !== undefined) obj.__union = value.$u;
      const names = Object.keys(value).filter(function fieldName(k) {
        return k !== "$t" && k !== "$u" && k !== "f" && !k.startsWith("$");
      });
      for (const name of names) obj[name] = $toTaggedJson(value[name]);
      return obj;
    }
    return value;
  }

  function $fromTaggedJson(value) {
    if (Array.isArray(value)) return value.map($fromTaggedJson);
    if (!value || typeof value !== "object") return value;
    if (value.__pfun === "int") return $canonI(BigInt(value.v));
    if (value.__pfun === "float") return Number(value.v);
    if (value.__pfun === "record") {
      const names = Object.keys(value).filter(function fieldName(k) {
        return k !== "__pfun" && k !== "__type" && k !== "__union";
      });
      const vals = names.map(function valOf(n) { return $fromTaggedJson(value[n]); });
      return value.__union ? $makeVariant(value.__type, value.__union, names, vals) : $makeRecord(value.__type, names, vals);
    }
    const out = {};
    for (const k of Object.keys(value)) out[k] = $fromTaggedJson(value[k]);
    return out;
  }

  // ── stringify ───────────────────────────────────────────────────────────

  function $str(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "number") return Number.isNaN(value) ? "NaN" : String(value);
    if (typeof value === "boolean") return value ? "true" : "false";
    if (Array.isArray(value) || $isLazyList(value)) {
      return "[" + $listToArray(value).map($str).join(", ") + "]";
    }
    if (value && value.$t !== undefined) {
      const fields = value.f || [];
      if (fields.length === 0) return value.$t;
      const names = Object.keys(value).filter(function fieldName(k) {
        return k !== "$t" && k !== "$u" && k !== "f" && !k.startsWith("$");
      });
      if (names.length === fields.length) {
        return value.$t + " { " + names.map(function part(name) {
          return name + " = " + $str(value[name]);
        }).join(", ") + " }";
      }
      return value.$t + " { " + fields.map($str).join(", ") + " }";
    }
    if (value && value.$arr) return "array " + $str(value.$arr);
    if (value && value.$dict) return "dict " + $str($dictToList(value));
    return String(value);
  }

  // ── console / timing / math floor ───────────────────────────────────────

  function $print(value) {
    const s = $str(value);
    if (typeof process !== "undefined" && process.stdout && process.stdout.write) {
      process.stdout.write(s);
    } else if (typeof console !== "undefined" && console.log) {
      console.log(s);
    }
    return null;
  }

  function $println(value) {
    const s = $str(value);
    if (typeof process !== "undefined" && process.stdout && process.stdout.write) {
      process.stdout.write(s + "\n");
    } else if (typeof console !== "undefined" && console.log) {
      console.log(s);
    }
    return null;
  }

  function $flushStdout() {
    return null;
  }

  function $sleep(ms) {
    return new Promise(function resolveLater(resolve) {
      setTimeout(function done() { resolve(null); }, Number($canonI(ms)));
    });
  }

  function $pi() { return Math.PI; }
  function $e() { return Math.E; }
  function $tau() { return Math.PI * 2; }
  function $sqrt(x) { return Math.sqrt(Number(x)); }
  function $pow(a, b) { return Math.pow(Number(a), Number(b)); }
  function $absInt(x) { return $canonI($toBigI(x) < 0n ? -$toBigI(x) : $toBigI(x)); }
  function $minInt(a, b) { return $leI(a, b) ? $canonI(a) : $canonI(b); }
  function $maxInt(a, b) { return $geI(a, b) ? $canonI(a) : $canonI(b); }

  // The early manifest currently names $isNaN / $isFinite. Avoid shadowing the
  // global constructors internally, but export the exact intrinsic spellings.
  const api = {
    // ABI constructors
    $unit,
    $makeRecord,
    $makeVariant,
    $none,
    $some,
    $ok,
    $err,
    $pair,
    $isSome,
    $isNone,

    // errors
    $runtimeError,
    $matchFail,
    $unreachable,
    $unsupportedIntrinsic,

    // Int / Float / Byte
    $canonI,
    $toBigI,
    $addI,
    $subI,
    $mulI,
    $negI,
    $divI,
    $modI,
    $bitAndI,
    $bitOrI,
    $shlI,
    $shrI,
    $cmpI,
    $eqI,
    $ltI,
    $leI,
    $gtI,
    $geI,
    $cmpF,
    $eqF,
    $ltF,
    $leF,
    $gtF,
    $geF,
    $floor,
    $ceil,
    $round,
    $isNaN: $isNaN_,
    $isFinite: $isFinite_,
    $nonZero,
    $safeDiv,
    $safeMod,
    $byte,
    $wrapByte,
    $addB,
    $subB,
    $mulB,
    $bitAndB,
    $bitOrB,
    $shlB,
    $shrB,

    // strings / chars
    $str,
    $concatS,
    $asc,
    $chr,
    $charBytes,
    $bytesToChar,
    $split,
    $join,
    $utf8Encode,
    $utf8Decode,

    // lists
    $lazy,
    $isLazyList,
    $isList,
    $listToArray,
    $length,
    $reverse,
    $cons,
    $slice,
    $take,
    $range,
    $map,
    $filter,
    $reduce,
    $find,
    $findSlice,
    $nth,
    $head,
    $tail,
    $appendList,

    // equality / comparison / mutable structures
    $eq,
    $cmpScalar,
    $dictKey,
    $newArray,
    $arrGet,
    $arrSet,
    $arrayLength,
    $arrayAppend,
    $removeAt,
    $insertAt,
    $toList,
    $toArray,
    $newDict,
    $dictGet,
    $dictSet,
    $dictHas,
    $dictRemove,
    $dictKeys,
    $dictValues,
    $dictToList,
    $listToDict,
    $makeBuffer,
    $makeStringBuffer,
    $appendByteBuffer,
    $appendChar,
    $appendString,
    $bufferLength,
    $bufferToBytes,
    $bufferToString,
    $ref,
    $getRef,
    $setRef,

    // functions / json / platform-neutral effects
    $curry,
    $memoize,
    $jsonSerialize,
    $jsonDeserialize,
    $print,
    $println,
    $flushStdout,
    $sleep,

    // math module floor
    $pi,
    $e,
    $tau,
    $sqrt,
    $pow,
    $absInt,
    $minInt,
    $maxInt
  };

  return api;
});
