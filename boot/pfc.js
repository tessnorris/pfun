(function() {
  "use strict";

  /* host core */
  (function(module, exports, require) {
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

      // Unchecked total code-point constructor for bootstrap sources whose
      // arguments are literal, valid code points. chr() remains Option-returning.
      function $chrU(n) {
        return String.fromCodePoint(Number($canonI(n)));
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


      // ── Phase 13 emitter ABI reconciliation ────────────────────────────────

      function $toF(value) {
        return Number($canonI(value));
      }

      function $bitNotI(value) {
        return $canonI(~$toBigI(value));
      }

      function $lazyList(thunks) {
        if (!Array.isArray(thunks)) {
          $runtimeError("lazyList expects an array of thunks");
        }
        return $lazy(function* emittedLazyList() {
          for (const thunk of thunks) {
            if (typeof thunk !== "function") {
              $runtimeError("lazyList element is not a thunk");
            }
            yield thunk();
          }
        });
      }

      function $runComp(sources, guard, body, emit) {
        function visit(level, args) {
          if (level >= sources.length) {
            if (guard.apply(null, args)) emit(body.apply(null, args));
            return;
          }
          const sourceFn = sources[level];
          const source = sourceFn.apply(null, args);
          for (const value of $iteratorOf(source)) {
            visit(level + 1, args.concat([value]));
          }
        }
        visit(0, []);
      }

      function $compStrict(sources, names, guard, body) {
        void names;
        const out = [];
        $runComp(sources, guard, body, function pushValue(value) {
          out.push(value);
        });
        return out;
      }

      function $compLazy(sources, names, guard, body) {
        void names;
        return $lazy(function* emittedLazyComprehension() {
          const out = [];
          $runComp(sources, guard, body, function pushValue(value) {
            out.push(value);
          });
          for (const value of out) yield value;
        });
      }

      function $listExactLen(xs, count) {
        count = Number($canonI(count));
        if (count < 0) return false;
        if (Array.isArray(xs)) return xs.length === count;
        if (!$isLazyList(xs)) $runtimeError("list pattern expects List");
        if ($forcePrefix(xs, count).length !== count) return false;
        return !$forceLazyIndex(xs, count).ok;
      }

      function $listMinLen(xs, count) {
        count = Number($canonI(count));
        if (count <= 0) return $isList(xs);
        if (Array.isArray(xs)) return xs.length >= count;
        if (!$isLazyList(xs)) $runtimeError("list pattern expects List");
        return $forcePrefix(xs, count).length === count;
      }

      function $nthU(xs, index) {
        index = Number($canonI(index));
        if (typeof xs === "string") {
          const chars = Array.from(xs);
          if (index < 0 || index >= chars.length) {
            $runtimeError("internal list-pattern index is out of bounds");
          }
          return chars[index];
        }
        const cell = $forceLazyIndex(xs, index);
        if (!cell.ok) $runtimeError("internal list-pattern index is out of bounds");
        return cell.value;
      }

      function $listRest(xs, count) {
        count = Number($canonI(count));
        if (Array.isArray(xs)) return xs.slice(count);
        if (!$isLazyList(xs)) $runtimeError("listRest expects List");
        return $lazy(function* emittedListRest() {
          let index = count;
          while (true) {
            const cell = $forceLazyIndex(xs, index);
            if (!cell.ok) return;
            yield cell.value;
            index += 1;
          }
        });
      }

      function $strAt(str, index) {
        if (typeof str !== "string") $runtimeError("strAt expects Str");
        return $nth(str, index);
      }

      function $field(object, name) {
        if (object === null || object === undefined) {
          $runtimeError("field access on null");
        }
        if (Object.prototype.hasOwnProperty.call(object, name)) {
          return object[name];
        }
        $runtimeError(
          "field '" + name + "' is not available on " +
          (object.$t !== undefined ? object.$t : typeof object)
        );
      }

      function $index(object, index) {
        if (typeof object === "string") return $strAt(object, index);
        if ($isList(object)) return $nth(object, index);
        if (object && object.$arr) return $arrGet(object, index);
        if (object && object.$dict) return $dictGet(object, index);
        $runtimeError("index expects Str, List, Array, or Dict");
      }

      function $indexSet(object, index, value) {
        if (object && object.$arr) return $arrSet(object, index, value);
        if (object && object.$dict) {
          $dictSet(object, index, value);
          return true;
        }
        $runtimeError("index assignment expects Array or Dict");
      }

      function $dictFromEntries(entries) {
        const dict = $newDict();
        for (const entry of entries) {
          if (!Array.isArray(entry) || entry.length !== 2) {
            $runtimeError("dictionary entry must be [key, value]");
          }
          $dictSet(dict, entry[0], entry[1]);
        }
        return dict;
      }

      function $starGet(modules, name) {
        let found = false;
        let value;
        for (const moduleExports of modules) {
          if (
            moduleExports !== null &&
            moduleExports !== undefined &&
            Object.prototype.hasOwnProperty.call(moduleExports, name)
          ) {
            if (found && value !== moduleExports[name]) {
              $runtimeError("ambiguous star import for '" + name + "'");
            }
            found = true;
            value = moduleExports[name];
          }
        }
        if (!found) $runtimeError("name '" + name + "' not found in star imports");
        return value;
      }

      function $extern(platform, name) {
        const tables = [
          typeof globalThis !== "undefined" ? globalThis.PfunNode : undefined,
          typeof globalThis !== "undefined" ? globalThis.PfunBrowser : undefined,
          typeof globalThis !== "undefined" ? globalThis.PfunHost : undefined
        ];
        for (const table of tables) {
          if (table && typeof table[name] === "function") return table[name];
        }
        $unsupportedIntrinsic(name, platform);
      }

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

      // ── JSON helpers ───────────────────────────────────────────────────────────
    //
    // JSON is a typed Pfun boundary, not a raw JavaScript-object escape hatch.
    //
    // The emitter passes a compact descriptor for the static source/target type.
    // The linker registers nominal record/variant schemas before application code
    // runs. Unsupported values and malformed/forged tagged objects return None.

    const $jsonSchemas = new Map();
    const $jsonUnions = new Set();

    function $registerSchemas(schemas) {
      if (!Array.isArray(schemas)) {
        $runtimeError("registerSchemas expects a schema array");
      }

      for (const schema of schemas) {
        if (
          !schema ||
          typeof schema.name !== "string" ||
          !Array.isArray(schema.fields) ||
          typeof schema.variant !== "boolean"
        ) {
          $runtimeError("invalid emitted JSON schema");
        }

        const normalized = {
          name: schema.name,
          union:
            schema.union === null || schema.union === undefined
              ? null
              : String(schema.union),
          fields: schema.fields.map(String),
          variant: schema.variant,
        };

        $jsonSchemas.set(normalized.name, normalized);
        if (normalized.union !== null) {
          $jsonUnions.add(normalized.union);
        }
      }

      return null;
    }

    $registerSchemas([
      { name: "Pair", union: null, fields: ["key", "value"], variant: false },
      { name: "None", union: "Option", fields: [], variant: true },
      { name: "Some", union: "Option", fields: ["value"], variant: true },
      { name: "Ok", union: "Result", fields: ["value"], variant: true },
      { name: "Err", union: "Result", fields: ["message"], variant: true },
    ]);

    function $jsonDescriptorTag(desc) {
      return Array.isArray(desc) && desc.length > 0 ? desc[0] : "Unsupported";
    }

    function $jsonNamedName(desc) {
      return Array.isArray(desc) && desc.length > 1 ? String(desc[1]) : "";
    }

    function $jsonNamedArgs(desc) {
      return Array.isArray(desc) && Array.isArray(desc[2]) ? desc[2] : [];
    }

    function $jsonListElement(desc) {
      return Array.isArray(desc) && desc.length > 1 ? desc[1] : ["Unsupported"];
    }

    function $jsonPublicFieldNames(value) {
      return Object.keys(value).filter(function jsonPublicFieldName(name) {
        return (
          name !== "$t" &&
          name !== "$u" &&
          name !== "f" &&
          !name.startsWith("$")
        );
      });
    }

    function $jsonSameNames(actual, expected) {
      if (actual.length !== expected.length) return false;
      for (const name of expected) {
        if (!actual.includes(name)) return false;
      }
      return true;
    }

    function $jsonMatchesType(value, desc) {
      const tag = $jsonDescriptorTag(desc);

      if (tag === "Int") {
        return (
          typeof value === "bigint" ||
          (typeof value === "number" && Number.isInteger(value))
        );
      }

      if (tag === "Float") {
        return typeof value === "number";
      }

      if (tag === "Bool") {
        return typeof value === "boolean";
      }

      if (tag === "Str") {
        return typeof value === "string";
      }

      if (tag === "Char") {
        return typeof value === "string" && Array.from(value).length === 1;
      }

      if (tag === "Byte") {
        return (
          typeof value === "number" &&
          Number.isInteger(value) &&
          value >= 0 &&
          value <= 255
        );
      }

      if (tag === "Unit") {
        return value === null;
      }

      if (tag === "NonZero") {
        return (
          (typeof value === "bigint" && value !== 0n) ||
          (typeof value === "number" && Number.isInteger(value) && value !== 0)
        );
      }

      if (tag === "List") {
        if (!Array.isArray(value)) return false;
        const elem = $jsonListElement(desc);
        return value.every(function jsonListElementMatches(item) {
          return $jsonMatchesType(item, elem);
        });
      }

      if (tag === "Named") {
        if (!value || typeof value !== "object" || value.$t === undefined) {
          return false;
        }

        const requestedName = $jsonNamedName(desc);
        const args = $jsonNamedArgs(desc);
        void args;

        // The runtime tag identifies the concrete record or variant. The schema
        // registered under that tag is the single source of truth for both exact
        // nominal matching and union widening.
        const schema = $jsonSchemas.get(value.$t);
        if (!schema) return false;

        if (schema.union === null) {
          return (
            requestedName === schema.name &&
            value.$t === schema.name &&
            (value.$u === undefined || value.$u === null)
          );
        }

        // A variant may be requested either by its exact variant type or by its
        // containing union type. In both cases the runtime union tag must agree
        // with the registered schema.
        return (
          value.$t === schema.name &&
          value.$u === schema.union &&
          (
            requestedName === schema.name ||
            requestedName === schema.union
          )
        );
      }

      return false;
    }

    function $jsonExpectedChild(desc, index) {
      const tag = $jsonDescriptorTag(desc);
      if (tag === "List" && index === 0) return $jsonListElement(desc);
      return ["Unsupported"];
    }

    function $toTaggedJson(value, desc) {
      const tag = $jsonDescriptorTag(desc);

      if (
        typeof value === "function" ||
        typeof value === "symbol" ||
        value === undefined
      ) {
        throw new Error("unsupported JSON value");
      }

      if (tag === "Int" || tag === "NonZero") {
        const integer = $canonI(value);
        return { __pfun: "int", v: integer.toString() };
      }

      if (tag === "Float") {
        const number = Number(value);
        if (Number.isNaN(number)) return { __pfun: "float", v: "NaN" };
        if (number === Infinity) return { __pfun: "float", v: "Infinity" };
        if (number === -Infinity) return { __pfun: "float", v: "-Infinity" };
        return { __pfun: "float", v: String(number) };
      }

      if (
        tag === "Str" ||
        tag === "Char" ||
        tag === "Bool" ||
        tag === "Byte" ||
        tag === "Unit"
      ) {
        if (!$jsonMatchesType(value, desc)) {
          throw new Error("value does not match JSON source type");
        }
        return value;
      }

      if (tag === "List") {
        if (!Array.isArray(value)) {
          throw new Error("only strict lists are JSON serializable");
        }
        const elem = $jsonExpectedChild(desc, 0);
        return value.map(function jsonListItem(item) {
          return $toTaggedJson(item, elem);
        });
      }

      if (tag === "Named") {
        if (!$jsonMatchesType(value, desc)) {
          throw new Error("value does not match nominal JSON source type");
        }

        const schema = $jsonSchemas.get(value.$t);
        if (!schema) {
          throw new Error("unknown nominal JSON schema");
        }

        const actualNames = $jsonPublicFieldNames(value);
        if (!$jsonSameNames(actualNames, schema.fields)) {
          throw new Error("record fields do not match registered schema");
        }

        const object = {
          __pfun: "record",
          __type: value.$t,
        };

        if (schema.union !== null) {
          object.__union = schema.union;
        }

        for (const name of schema.fields) {
          // Field type descriptors are not yet stored in linker schemas. Runtime
          // representation is therefore encoded recursively with conservative
          // value-directed tagging for nested fields.
          object[name] = $toTaggedJsonDynamic(value[name]);
        }

        return object;
      }

      throw new Error("unsupported JSON source type");
    }

    function $toTaggedJsonDynamic(value) {
      if (
        typeof value === "function" ||
        typeof value === "symbol" ||
        value === undefined ||
        $isLazyList(value)
      ) {
        throw new Error("unsupported nested JSON value");
      }

      if (typeof value === "bigint") {
        return { __pfun: "int", v: value.toString() };
      }

      if (typeof value === "number") {
        if (Number.isInteger(value)) {
          return { __pfun: "int", v: $canonI(value).toString() };
        }
        if (Number.isNaN(value)) return { __pfun: "float", v: "NaN" };
        if (value === Infinity) return { __pfun: "float", v: "Infinity" };
        if (value === -Infinity) return { __pfun: "float", v: "-Infinity" };
        return { __pfun: "float", v: String(value) };
      }

      if (
        typeof value === "string" ||
        typeof value === "boolean" ||
        value === null
      ) {
        return value;
      }

      if (Array.isArray(value)) {
        return value.map($toTaggedJsonDynamic);
      }

      if (value && value.$t !== undefined) {
        const schema = $jsonSchemas.get(value.$t);
        if (!schema) throw new Error("unknown nested nominal JSON schema");

        const actualNames = $jsonPublicFieldNames(value);
        if (!$jsonSameNames(actualNames, schema.fields)) {
          throw new Error("nested record fields do not match registered schema");
        }

        const object = { __pfun: "record", __type: value.$t };
        if (schema.union !== null) object.__union = schema.union;

        for (const name of schema.fields) {
          object[name] = $toTaggedJsonDynamic(value[name]);
        }
        return object;
      }

      throw new Error("plain JavaScript objects are not Pfun JSON values");
    }

    function $fromTaggedJson(value) {
      if (Array.isArray(value)) {
        return value.map($fromTaggedJson);
      }

      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        typeof value === "number"
      ) {
        return value;
      }

      if (!value || typeof value !== "object") {
        throw new Error("unsupported parsed JSON value");
      }

      if (value.__pfun === "int") {
        const names = Object.keys(value);
        if (
          names.length !== 2 ||
          !Object.prototype.hasOwnProperty.call(value, "v") ||
          typeof value.v !== "string" ||
          !/^-?[0-9]+$/.test(value.v)
        ) {
          throw new Error("malformed tagged Int");
        }
        return $canonI(BigInt(value.v));
      }

      if (value.__pfun === "float") {
        const names = Object.keys(value);
        if (
          names.length !== 2 ||
          !Object.prototype.hasOwnProperty.call(value, "v") ||
          typeof value.v !== "string"
        ) {
          throw new Error("malformed tagged Float");
        }

        const number = Number(value.v);
        if (
          value.v !== "NaN" &&
          value.v !== "Infinity" &&
          value.v !== "-Infinity" &&
          !Number.isFinite(number)
        ) {
          throw new Error("malformed tagged Float value");
        }
        return number;
      }

      if (value.__pfun === "record") {
        if (typeof value.__type !== "string") {
          throw new Error("tagged record has no type name");
        }

        const schema = $jsonSchemas.get(value.__type);
        if (!schema) {
          throw new Error("tagged record names an unknown type");
        }

        const union =
          value.__union === undefined ? null : String(value.__union);
        if (union !== schema.union) {
          throw new Error("tagged record union does not match schema");
        }

        const metadata = ["__pfun", "__type"];
        if (schema.union !== null) metadata.push("__union");

        const actualFields = Object.keys(value).filter(function jsonDataField(name) {
          return !metadata.includes(name);
        });

        if (!$jsonSameNames(actualFields, schema.fields)) {
          throw new Error("tagged record fields do not match schema");
        }

        const values = schema.fields.map(function jsonFieldValue(name) {
          return $fromTaggedJson(value[name]);
        });

        return schema.union === null
          ? $makeRecord(schema.name, schema.fields, values)
          : $makeVariant(schema.name, schema.union, schema.fields, values);
      }

      throw new Error("plain JSON objects require a Pfun nominal tag");
    }

    function $jsonSerialize(value, sourceType) {
      try {
        if (!$jsonMatchesType(value, sourceType)) return $none();
        const tagged = $toTaggedJson(value, sourceType);
        const text = JSON.stringify(tagged);
        return typeof text === "string" ? $some(text) : $none();
      } catch (_) {
        return $none();
      }
    }

    function $jsonDeserialize(text, targetType) {
      try {
        const value = $fromTaggedJson(JSON.parse(String(text)));
        return $jsonMatchesType(value, targetType) ? $some(value) : $none();
      } catch (_) {
        return $none();
      }
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
    		ms = $canonI(ms);

    		const maximum = 2147483647;

    		if (typeof ms === "bigint") {
    			if (ms < 0n) {
    				$runtimeError(
    					"sleep duration must be non-negative."
    				);
    			}

    			if (ms > 2147483647n) {
    				$runtimeError(
    					"sleep duration must be at most "
    						+ maximum
    						+ " milliseconds."
    				);
    			}

    			ms = Number(ms);
    		} else {
    			if (ms < 0) {
    				$runtimeError(
    					"sleep duration must be non-negative."
    				);
    			}

    			if (ms > maximum) {
    				$runtimeError(
    					"sleep duration must be at most "
    						+ maximum
    						+ " milliseconds."
    				);
    			}
    		}

    		return new Promise(function resolveLater(resolve) {
    			setTimeout(function done() {
    				resolve(null);
    			}, ms);
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
        // Phase 13 emitter ABI
        $bitNotI,
        $compLazy,
        $compStrict,
        $dictFromEntries,
        $extern,
        $field,
        $index,
        $indexSet,
        $lazyList,
        $listExactLen,
        $listMinLen,
        $listRest,
        $nthU,
        $starGet,
        $strAt,
        $toF,

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
        $chr, $chrU,
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
        $registerSchemas, $jsonSerialize,
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
  })(undefined, undefined, typeof require === "function" ? require : undefined);
  /* PfunCore ABI bindings */
  const { $addI, $arrGet, $arrSet, $asc, $bitAndI, $bitNotI, $bitOrI, $bytesToChar, $ceil, $charBytes, $chr, $chrU, $cmpF, $compLazy, $compStrict, $concatS, $cons, $dictFromEntries, $dictGet, $dictSet, $divI, $eq, $eqF, $eqI, $extern, $field, $filter, $find, $findSlice, $floor, $geI, $gtI, $index, $indexSet, $isFinite, $jsonDeserialize, $jsonSerialize, $isNaN, $join, $lazyList, $leI, $length, $listExactLen, $listMinLen, $listRest, $ltI, $makeRecord, $makeVariant, $map, $matchFail, $memoize, $modI, $mulI, $negI, $newArray, $nonZero, $nth, $nthU, $range, $reduce, $registerSchemas, $reverse, $round, $safeDiv, $safeMod, $shlI, $shrI, $slice, $split, $starGet, $str, $strAt, $subI, $take, $toF } = globalThis.PfunCore;
  /* host platform */
  (function(module, exports, require) {
    "use strict";

    // host/node.js — minimal Node host for the self-hosting compiler.
    //
    // This is deliberately narrower than the eventual Node platform host. It owns
    // only the manifest-backed Node floor required to load source, write artifacts,
    // inspect argv/environment, read stdin, and terminate with an exit status.
    //
    // HTTP, database adapters, browser facilities, and general foreign interop are
    // intentionally deferred. They are not needed to compile the compiler with
    // itself.

    (function attachPfunNode(root, factory) {
      const nodeRequire =
        typeof require === "function" ? require : null;
      const core =
        root.PfunCore ||
        (nodeRequire ? nodeRequire("./core.js") : null);

      if (!core) {
        throw new Error(
          "host/node.js requires PfunCore. Load host/core.js first."
        );
      }

      const api = factory(core, nodeRequire);

      if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
      }

      root.PfunNode = api;
      root.PfunBuiltins = api.$builtins;
    })(
      typeof globalThis !== "undefined" ? globalThis : this,
      function buildPfunNode(core, nodeRequire) {
        if (!nodeRequire) {
          throw new Error("host/node.js requires the Node CommonJS loader.");
        }

        const fs = nodeRequire("node:fs");
    	const os = nodeRequire("node:os");
    	const nodePath = nodeRequire("node:path");
    	const childProcess = nodeRequire("node:child_process");

        function own(object, key) {
          return Object.prototype.hasOwnProperty.call(object, key);
        }

        function errorMessage(error) {
          if (error instanceof Error) {
            if (typeof error.code === "string" && error.code.length > 0) {
              return error.code + ": " + error.message;
            }
            return error.message;
          }
          return String(error);
        }

        function intToNumber(value, what) {
          const canonical = core.$canonI(value);
          const number = Number(canonical);
          if (!Number.isSafeInteger(number)) {
            throw new Error(what + " is outside the Node safe integer range.");
          }
          return number;
        }

        function pathText(value, what) {
          if (typeof value !== "string") {
            throw new Error(what + " must be a Str.");
          }
          return value;
        }

        function resultOf(thunk) {
          try {
            return core.$ok(thunk());
          } catch (error) {
            return core.$err(errorMessage(error));
          }
        }

        
    	function nodeArgs(values) {
    		if (!Array.isArray(values)) {
    			throw new Error("runNodeBundle arguments must be a List<Str>.");
    		}
    		return values.map(function nodeArg(value) {
    			return pathText(value, "runNodeBundle argument");
    		});
    	}

    	function $runNodeBundle(source, args) {
    		source = pathText(source, "runNodeBundle source");
    		const childArgs = nodeArgs(args);

    		return resultOf(function executeNodeBundle() {
    			const tempDir = fs.mkdtempSync(
    				nodePath.join(os.tmpdir(), "pfun-run-")
    			);
    			const scriptPath = nodePath.join(tempDir, "main.js");

    			try {
    				fs.writeFileSync(scriptPath, source, "utf8");
    				const child = childProcess.spawnSync(
    					process.execPath,
    					[scriptPath, ...childArgs],
    					{
    						cwd: process.cwd(),
    						env: process.env,
    						stdio: "inherit"
    					}
    				);

    				if (child.error) {
    					throw child.error;
    				}
    				if (typeof child.status === "number") {
    					return core.$canonI(child.status);
    				}
    				if (child.signal) {
    					throw new Error(
    						"Node child terminated by signal " + child.signal + "."
    					);
    				}
    				throw new Error("Node child did not report an exit status.");
    			} finally {
    				fs.rmSync(tempDir, { recursive: true, force: true });
    			}
    		});
    	}
    // ── stdin / process ──────────────────────────────────────────────────

        	function $eprint(value) {
    		process.stderr.write(core.$str(value));
    		return null;
    	}

    	function $eprintln(value) {
    		process.stderr.write(core.$str(value) + "\n");
    		return null;
    	}

    	let stdinText = null;
    	let stdinOffset = 0;

    	function ensureStdin() {
    		if (stdinText === null) {
    			stdinText = fs.readFileSync(0, "utf8");
    		}
    		return stdinText;
    	}

    	function nextLineBreak(text, start) {
    		for (let index = start; index < text.length; index += 1) {
    			const code = text.charCodeAt(index);
    			if (code === 0x0a || code === 0x0d) {
    				return index;
    			}
    		}
    		return -1;
    	}

    	function afterLineBreak(text, index) {
    		if (
    			text.charCodeAt(index) === 0x0d
    				&& text.charCodeAt(index + 1) === 0x0a
    		) {
    			return index + 2;
    		}
    		return index + 1;
    	}

    	function $scanln() {
    		const text = ensureStdin();

    		if (stdinOffset >= text.length) {
    			return core.$none();
    		}

    		const boundary = nextLineBreak(text, stdinOffset);

    		if (boundary < 0) {
    			const line = text.slice(stdinOffset);
    			stdinOffset = text.length;
    			return core.$some(line);
    		}

    		const line = text.slice(stdinOffset, boundary);
    		stdinOffset = afterLineBreak(text, boundary);
    		return core.$some(line);
    	}

    	function $scanChar() {
    		const text = ensureStdin();

    		if (stdinOffset >= text.length) {
    			return core.$none();
    		}

    		const codePoint = text.codePointAt(stdinOffset);

    		if (codePoint === undefined) {
    			stdinOffset = text.length;
    			return core.$none();
    		}

    		const value = String.fromCodePoint(codePoint);
    		stdinOffset += value.length;
    		return core.$some(value);
    	}

    	    function $scriptArgs() {
          return process.argv.slice(2);
        }

        function $getEnv(name) {
          name = pathText(name, "environment variable name");
          if (!own(process.env, name) || process.env[name] === undefined) {
            return core.$none();
          }
          return core.$some(String(process.env[name]));
        }

    	function $envVars() {
    		const snapshot = core.$newDict();

    		for (const name of Object.keys(process.env)) {
    			const value = process.env[name];

    			if (value !== undefined) {
    				core.$dictSet(
    					snapshot,
    					String(name),
    					String(value)
    				);
    			}
    		}

    		return snapshot;
    	}

        function $exit(code) {
          process.exit(intToNumber(code, "exit code"));
        }

        // ── filesystem ───────────────────────────────────────────────────────

    	function $readFile(path) {
    		path = pathText(path, "readFile path");
    		return resultOf(function readText() {
    			return fs.readFileSync(path, "utf8");
    		});
    	}

    	function $writeFile(path, content) {
    		path = pathText(path, "writeFile path");

    		if (typeof content !== "string") {
    			throw new Error("writeFile content must be a Str.");
    		}

    		return resultOf(function writeText() {
    			fs.writeFileSync(path, content, "utf8");
    			return null;
    		});
    	}

    	function $fileExists(path) {
    		path = pathText(path, "fileExists path");

    		try {
    			return fs.existsSync(path);
    		} catch (_error) {
    			return false;
    		}
    	}

    	function $mkdirP(path) {
    		path = pathText(path, "mkdirP path");

    		return resultOf(function makeDirectory() {
    			fs.mkdirSync(path, { recursive: true });
    			return null;
    		});
    	}

    	function $removeFile(path) {
    		path = pathText(path, "removeFile path");

    		return resultOf(function removePath() {
    			fs.unlinkSync(path);
    			return null;
    		});
    	}

    	function fileModeName(mode) {
    		if (mode && typeof mode.$t === "string") {
    			return mode.$t;
    		}

    		if (typeof mode === "string") {
    			return mode;
    		}

    		throw new Error(
    			"fileOpen mode must be Read, Write, or Append."
    		);
    	}

    	function openFlags(modeName) {
    		if (modeName === "Read") return "r";
    		if (modeName === "Write") return "w";
    		if (modeName === "Append") return "a";
    		throw new Error("unknown file mode: " + modeName);
    	}

    	function requireFileHandle(handle, operation, modes) {
    		if (
    			!handle
    				|| handle.$file !== true
    				|| !Number.isInteger(handle.fd)
    		) {
    			throw new Error(operation + " expects a FileHandle.");
    		}

    		if (handle.closed) {
    			throw new Error("file handle is already closed.");
    		}

    		if (modes && !modes.includes(handle.mode)) {
    			throw new Error(
    				operation
    					+ " requires "
    					+ modes.join(" or ")
    					+ " mode."
    			);
    		}

    		return handle;
    	}

    	function readOk(value) {
    		return core.$makeVariant(
    			"Ok",
    			"ReadResult",
    			["value"],
    			[value]
    		);
    	}

    	function readEof() {
    		return core.$makeVariant(
    			"Eof",
    			"ReadResult",
    			[],
    			[]
    		);
    	}

    	function readErr(error) {
    		return core.$makeVariant(
    			"Err",
    			"ReadResult",
    			["message"],
    			[errorMessage(error)]
    		);
    	}

    	function readHandleByte(handle) {
    		if (handle.pending.length > 0) {
    			return handle.pending.shift();
    		}

    		const one = Buffer.allocUnsafe(1);
    		const count = fs.readSync(
    			handle.fd,
    			one,
    			0,
    			1,
    			null
    		);

    		return count === 0 ? null : one[0];
    	}

    	function unreadHandleByte(handle, byte) {
    		handle.pending.unshift(byte);
    	}

    	function utf8Width(first) {
    		if (first <= 0x7f) return 1;
    		if (first >= 0xc2 && first <= 0xdf) return 2;
    		if (first >= 0xe0 && first <= 0xef) return 3;
    		if (first >= 0xf0 && first <= 0xf4) return 4;
    		throw new Error("invalid UTF-8 leading byte.");
    	}

    	function readUtf8Char(handle) {
    		const first = readHandleByte(handle);

    		if (first === null) {
    			return null;
    		}

    		const width = utf8Width(first);
    		const bytes = [first];

    		while (bytes.length < width) {
    			const next = readHandleByte(handle);

    			if (next === null) {
    				throw new Error(
    					"truncated UTF-8 character at end of file."
    				);
    			}

    			if (next < 0x80 || next > 0xbf) {
    				throw new Error(
    					"invalid UTF-8 continuation byte."
    				);
    			}

    			bytes.push(next);
    		}

    		const value = Buffer.from(bytes).toString("utf8");

    		if (
    			value.length === 0
    				|| value.codePointAt(0) === 0xfffd
    		) {
    			throw new Error("invalid UTF-8 character.");
    		}

    		return value;
    	}

    	function writeHandleText(handle, text) {
    		const bytes = Buffer.from(text, "utf8");
    		let offset = 0;

    		while (offset < bytes.length) {
    			offset += fs.writeSync(
    				handle.fd,
    				bytes,
    				offset,
    				bytes.length - offset,
    				null
    			);
    		}
    	}

    	function $fileOpen(path, mode) {
    		path = pathText(path, "fileOpen path");

    		return resultOf(function openFile() {
    			const modeName = fileModeName(mode);

    			return {
    				$file: true,
    				fd: fs.openSync(path, openFlags(modeName)),
    				mode: modeName,
    				closed: false,
    				pending: []
    			};
    		});
    	}

    	function $fileClose(handle) {
    		return resultOf(function closeFile() {
    			requireFileHandle(
    				handle,
    				"fileClose",
    				null
    			);
    			fs.closeSync(handle.fd);
    			handle.closed = true;
    			handle.pending = [];
    			return null;
    		});
    	}

    	function $readChar(handle) {
    		try {
    			requireFileHandle(
    				handle,
    				"readChar",
    				["Read"]
    			);

    			const value = readUtf8Char(handle);
    			return value === null
    				? readEof()
    				: readOk(value);
    		} catch (error) {
    			return readErr(error);
    		}
    	}

    	function $readLine(handle) {
    		try {
    			requireFileHandle(
    				handle,
    				"readLine",
    				["Read"]
    			);

    			const bytes = [];

    			while (true) {
    				const byte = readHandleByte(handle);

    				if (byte === null) {
    					return bytes.length === 0
    						? readEof()
    						: readOk(
    							Buffer.from(bytes).toString("utf8")
    						);
    				}

    				if (byte === 0x0a) {
    					return readOk(
    						Buffer.from(bytes).toString("utf8")
    					);
    				}

    				if (byte === 0x0d) {
    					const next = readHandleByte(handle);

    					if (next !== null && next !== 0x0a) {
    						unreadHandleByte(handle, next);
    					}

    					return readOk(
    						Buffer.from(bytes).toString("utf8")
    					);
    				}

    				bytes.push(byte);
    			}
    		} catch (error) {
    			return readErr(error);
    		}
    	}

    	function $writeChar(handle, value) {
    		if (
    			typeof value !== "string"
    				|| Array.from(value).length !== 1
    		) {
    			return core.$err(
    				"writeChar value must be a Char."
    			);
    		}

    		return resultOf(function writeCharacter() {
    			requireFileHandle(
    				handle,
    				"writeChar",
    				["Write", "Append"]
    			);
    			writeHandleText(handle, value);
    			return null;
    		});
    	}

    	function $writeLine(handle, value) {
    		if (typeof value !== "string") {
    			return core.$err(
    				"writeLine value must be a Str."
    			);
    		}

    		return resultOf(function writeTextLine() {
    			requireFileHandle(
    				handle,
    				"writeLine",
    				["Write", "Append"]
    			);
    			writeHandleText(handle, value + "\n");
    			return null;
    		});
    	}

    	// ── binary file I/O and buffers ──────────────────────────────────────

    	function byteNumber(value, what) {
    		const number = Number(value);

    		if (
    			!Number.isInteger(number)
    				|| number < 0
    				|| number > 255
    		) {
    			throw new Error(what + " must be a Byte (0..255).");
    		}

    		return number;
    	}

    	function byteList(value, what) {
    		return core.$listToArray(value).map(
    			function validateByte(byte, index) {
    				return byteNumber(
    					byte,
    					what + "[" + index + "]"
    				);
    			}
    		);
    	}

    	function readCount(value, what) {
    		const count = intToNumber(value, what);

    		if (count < 0) {
    			throw new Error(what + " must not be negative.");
    		}

    		return count;
    	}

    	function readHandleBytes(handle, count) {
    		const out = [];

    		while (out.length < count) {
    			const byte = readHandleByte(handle);

    			if (byte === null) {
    				break;
    			}

    			out.push(byte);
    		}

    		return out;
    	}

    	function writeHandleBytes(handle, bytes) {
    		const data = Buffer.from(bytes);
    		let offset = 0;

    		while (offset < data.length) {
    			offset += fs.writeSync(
    				handle.fd,
    				data,
    				offset,
    				data.length - offset,
    				null
    			);
    		}
    	}

    	function bufferModeName(mode) {
    		const name = mode && typeof mode.$t === "string"
    			? mode.$t
    			: String(mode);

    		if (name !== "ByteMode" && name !== "CharMode") {
    			throw new Error(
    				"buffer mode must be ByteMode or CharMode."
    			);
    		}

    		return name;
    	}

    	function requireBuffer(buffer, operation, expectedMode) {
    		if (!buffer || !Array.isArray(buffer.$buf)) {
    			throw new Error(operation + " expects a Buffer.");
    		}

    		if (
    			expectedMode !== null
    				&& buffer.$mode !== expectedMode
    		) {
    			throw new Error(
    				operation
    					+ " requires a "
    					+ expectedMode
    					+ " buffer."
    			);
    		}

    		return buffer;
    	}

    	function $readByte(handle) {
    		try {
    			requireFileHandle(handle, "readByte", ["Read"]);
    			const byte = readHandleByte(handle);
    			return byte === null ? readEof() : readOk(byte);
    		} catch (error) {
    			return readErr(error);
    		}
    	}

    	function $readBytes(handle, count) {
    		try {
    			requireFileHandle(handle, "readBytes", ["Read"]);
    			const wanted = readCount(count, "readBytes count");

    			if (wanted === 0) {
    				return readOk([]);
    			}

    			const bytes = readHandleBytes(handle, wanted);
    			return bytes.length === 0
    				? readEof()
    				: readOk(bytes);
    		} catch (error) {
    			return readErr(error);
    		}
    	}

    	function $writeByte(handle, byte) {
    		return resultOf(function writeOneByte() {
    			requireFileHandle(
    				handle,
    				"writeByte",
    				["Write", "Append"]
    			);
    			writeHandleBytes(
    				handle,
    				[byteNumber(byte, "writeByte value")]
    			);
    			return null;
    		});
    	}

    	function $writeBytes(handle, bytes) {
    		return resultOf(function writeManyBytes() {
    			requireFileHandle(
    				handle,
    				"writeBytes",
    				["Write", "Append"]
    			);
    			writeHandleBytes(
    				handle,
    				byteList(bytes, "writeBytes value")
    			);
    			return null;
    		});
    	}

    	function $readBuffer(handle, count, mode) {
    		return resultOf(function readIntoNewBuffer() {
    			requireFileHandle(
    				handle,
    				"readBuffer",
    				["Read"]
    			);
    			const wanted = readCount(count, "readBuffer count");
    			const buffer = core.$makeBuffer(bufferModeName(mode));
    			core.$appendByteBuffer(
    				buffer,
    				readHandleBytes(handle, wanted)
    			);
    			return buffer;
    		});
    	}

    	function $writeBuffer(handle, buffer) {
    		return resultOf(function writeWholeBuffer() {
    			requireFileHandle(
    				handle,
    				"writeBuffer",
    				["Write", "Append"]
    			);
    			requireBuffer(buffer, "writeBuffer", null);
    			writeHandleBytes(
    				handle,
    				core.$bufferToBytes(buffer)
    			);
    			return null;
    		});
    	}

    	function $makeBuffer(mode) {
    		return core.$makeBuffer(bufferModeName(mode));
    	}

    	function $makeStringBuffer() {
    		return core.$makeBuffer("CharMode");
    	}

    	function $appendBuffer(buffer, byte) {
    		requireBuffer(buffer, "appendBuffer", "ByteMode");
    		core.$appendByteBuffer(
    			buffer,
    			[byteNumber(byte, "appendBuffer value")]
    		);
    		return null;
    	}

    	function $appendChar(buffer, character) {
    		requireBuffer(buffer, "appendChar", "CharMode");

    		if (
    			typeof character !== "string"
    				|| Array.from(character).length !== 1
    		) {
    			throw new Error("appendChar value must be a Char.");
    		}

    		core.$appendChar(buffer, character);
    		return null;
    	}

    	function $appendString(buffer, text) {
    		requireBuffer(buffer, "appendString", "CharMode");

    		if (typeof text !== "string") {
    			throw new Error("appendString value must be a Str.");
    		}

    		core.$appendString(buffer, text);
    		return null;
    	}

    	function $bufferLength(buffer) {
    		requireBuffer(buffer, "bufferLength", null);
    		return core.$bufferLength(buffer);
    	}

    	function $bufferToBytes(buffer) {
    		requireBuffer(buffer, "bufferToBytes", "ByteMode");
    		return core.$bufferToBytes(buffer);
    	}

    	function $bufferToString(buffer) {
    		requireBuffer(buffer, "bufferToString", "CharMode");
    		return core.$bufferToString(buffer);
    	}

    	// ── builtin module registry ──────────────────────────────────────────

        const coreModule = Object.freeze({
          __str__: core.$str,
          str: core.$str,
          length: core.$length,
          reverse: core.$reverse,
          cons: core.$cons,
          nth: core.$nth,
          nthU: core.$nthU,
          slice: core.$slice,
          take: core.$take,
          range: core.$range,
          find: core.$find,
          findSlice: core.$findSlice,
          map: core.$map,
          filter: core.$filter,
          reduce: core.$reduce,
          split: core.$split,
          join: core.$join,
          asc: core.$asc,
          chr: core.$chr,
          chrU: core.$chrU,
          charBytes: core.$charBytes,
          bytesToChar: core.$bytesToChar,
          floor: core.$floor,
          ceil: core.$ceil,
          round: core.$round,
          isNaN: core.$isNaN,
          isFinite: core.$isFinite,
          nonZero: core.$nonZero,
          safeDiv: core.$safeDiv,
          safeMod: core.$safeMod
        });

        const ioModule = Object.freeze({
          print: core.$print,
          println: core.$println,
          eprint: $eprint,
          eprintln: $eprintln,
          flushStdout: core.$flushStdout,
          scanln: $scanln,
          scanChar: $scanChar,
          scriptArgs: $scriptArgs,
          getEnv: $getEnv,
          exit: $exit,
    		runNodeBundle: $runNodeBundle,
          envVars: $envVars
        });

        const fileModule = Object.freeze({
    		readFile: $readFile,
    		writeFile: $writeFile,
    		fileExists: $fileExists,
    		mkdirP: $mkdirP,
    		removeFile: $removeFile,
    		fileOpen: $fileOpen,
    		fileClose: $fileClose,
    		readChar: $readChar,
    		readLine: $readLine,
    		readByte: $readByte,
    		readBytes: $readBytes,
    		writeChar: $writeChar,
    		writeLine: $writeLine,
    		writeByte: $writeByte,
    		writeBytes: $writeBytes,
    		readBuffer: $readBuffer,
    		writeBuffer: $writeBuffer,
    		makeBuffer: $makeBuffer,
    		makeStringBuffer: $makeStringBuffer,
    		appendBuffer: $appendBuffer,
    		appendChar: $appendChar,
    		appendString: $appendString,
    		bufferLength: $bufferLength,
    		bufferToBytes: $bufferToBytes,
    		bufferToString: $bufferToString,
    	});

        const jsonModule = Object.freeze({
          jsonSerialize: core.$jsonSerialize,
          jsonDeserialize: core.$jsonDeserialize
        ,
          jsonDeserializeAs: core.$jsonDeserialize});

        const asyncModule = Object.freeze({
          sleep: core.$sleep
        });

    	const mathModule = Object.freeze({
          pi: core.$pi,
          e: core.$e,
          tau: core.$tau,
          sqrt: core.$sqrt,
          pow: core.$pow,
          abs: core.$absInt,
          min: core.$minInt,
          max: core.$maxInt
        });

        const $builtins = Object.freeze({
          "$builtin/core": coreModule,
          core: coreModule,
          io: ioModule,
          file: fileModule,
          json: jsonModule,
          async: asyncModule,
          math: mathModule
        });

        return Object.freeze({
    		$eprint,
    		$eprintln,
          $scanln,
          $scanChar,
          $scriptArgs,
          $getEnv,
          $exit,
          $readFile,
          $writeFile,
          $fileExists,
          $mkdirP,
          $fileOpen,
          $fileClose,
          $removeFile,
          $readChar,
          $readLine,
          $writeChar,
          $writeLine,
          $readByte,
          $readBytes,
          $writeByte,
          $writeBytes,
          $readBuffer,
          $writeBuffer,
          $makeBuffer,
          $makeStringBuffer,
          $appendBuffer,
          $appendChar,
          $appendString,
          $bufferLength,
          $bufferToBytes,
          $bufferToString,
          $builtins,
    		$runNodeBundle,
    		$envVars
        });
      }
    );
  })(undefined, undefined, typeof require === "function" ? require : undefined);

  const $mods = Object.create(null);
  const $maps = Object.create(null);
  const $cache = Object.create(null);
  const $builtinModules = globalThis.PfunBuiltins || Object.create(null);

  function $own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function $req(id) {
    if ($own($cache, id)) return $cache[id].exports;
    if (!$own($mods, id)) {
      if ($own($builtinModules, id)) return $builtinModules[id];
      throw new Error("Pfun module not found: " + id);
    }

    const module = { exports: {} };
    $cache[id] = module;
    const map = $maps[id] || Object.create(null);
    const $require = (raw) => {
      const target = $own(map, raw) ? map[raw] : raw;
      return $req(target);
    };

    $mods[id](module.exports, $require);
    return module.exports;
  }

  $maps["src/compat"] = {};
  $mods["src/compat"] = ((exports, $require) => {
    function listAt(xs, i) {
      if ($ltI(i, 0)) {
        return $makeVariant("None", "Option", [], []);
      } else {
        if ($geI(i, $length(xs))) {
          return $makeVariant("None", "Option", [], []);
        } else {
          return $makeVariant("Some", "Option", ["value"], [$nthU(xs, i)]);
        }
      }
    }
    function uncons(xs) {
      if ($eqI($length(xs), 0)) {
        return $makeVariant("None", "Option", [], []);
      } else {
        return $makeVariant("Some", "Option", ["value"], [$makeRecord("Pair", ["key", "value"], [$nthU(xs, 0), $slice(1, $subI($length(xs), 1), xs)])]);
      }
    }
    exports["listAt"] = listAt;
    exports["uncons"] = uncons;
  });
  $registerSchemas([{name: "CliCheck", union: "CliPlan", fields: ["entry"], variant: true}, {name: "CliBuild", union: "CliPlan", fields: ["entry", "target", "output", "page"], variant: true}, {name: "CliRun", union: "CliPlan", fields: ["entry", "args"], variant: true}, {name: "CliUsage", union: "CliPlan", fields: ["message"], variant: true}, {name: "BuildFlagsOk", union: "BuildFlagsResult", fields: ["target", "output", "page"], variant: true}, {name: "BuildFlagsErr", union: "BuildFlagsResult", fields: ["message"], variant: true}]);
  $maps["src/drivers/cliargs"] = {"../compat": "src/compat"};
  $mods["src/drivers/cliargs"] = ((exports, $require) => {
    const Compat = $require("../compat");
    function CliCheck(entry) {
      return $makeVariant("CliCheck", "CliPlan", ["entry"], [entry]);
    }
    function CliBuild(entry, target, output, page) {
      return $makeVariant("CliBuild", "CliPlan", ["entry", "target", "output", "page"], [entry, target, output, page]);
    }
    function CliRun(entry, args) {
      return $makeVariant("CliRun", "CliPlan", ["entry", "args"], [entry, args]);
    }
    function CliUsage(message) {
      return $makeVariant("CliUsage", "CliPlan", ["message"], [message]);
    }
    function BuildFlagsOk(target, output, page) {
      return $makeVariant("BuildFlagsOk", "BuildFlagsResult", ["target", "output", "page"], [target, output, page]);
    }
    function BuildFlagsErr(message) {
      return $makeVariant("BuildFlagsErr", "BuildFlagsResult", ["message"], [message]);
    }
    function usageText() {
      return $concatS($concatS($concatS($concatS($concatS("Usage:\n", "  pfc check <entry.pf>\n"), "  pfc build <entry.pf>"), " [--target node|node-bundle|browser]"), " [-o <path>] [--page <title>]\n"), "  pfc run <entry.pf> [args...]");
    }
    function argAt(args, index) {
      return (($match$19) => {
        if ($match$19.$t === "None") {
          return "";
        }
        if ($match$19.$t === "Some") {
          const value = $match$19;
          return value.f[0];
        }
        throw $matchFail("src/drivers/cliargs.pf", 19);
      })($field(Compat, "listAt")(args, index));
    }
    function validText(value) {
      return $gtI($length(value), 0);
    }
    function usage(message) {
      return $makeVariant("CliUsage", "CliPlan", ["message"], [$concatS($concatS(message, "\n"), usageText())]);
    }
    function parseCheck(args) {
      const entry = argAt(args, 1);
      if (!$eqI($length(args), 2)) {
        return usage("Check requires exactly one entry file.");
      } else {
        if (!validText(entry)) {
          return usage("Check requires an entry file.");
        } else {
          return $makeVariant("CliCheck", "CliPlan", ["entry"], [entry]);
        }
      }
    }
    function validBuildTarget(target) {
      return target === "node" || target === "node-bundle" || target === "browser";
    }
    function defaultBuildOutput(target) {
      if (target === "node") {
        return "build";
      } else {
        if (target === "browser") {
          return "index.html";
        } else {
          return "pfc.js";
        }
      }
    }
    function finishBuildFlags(target, output, page) {
      if (!validBuildTarget(target)) {
        return $makeVariant("BuildFlagsErr", "BuildFlagsResult", ["message"], [$concatS($concatS("Unknown build target '", target), "'.")]);
      } else {
        if ($gtI($length(page), 0) && !(target === "browser")) {
          return $makeVariant("BuildFlagsErr", "BuildFlagsResult", ["message"], ["--page is only valid with --target browser."]);
        } else {
          const finalOutput = $eqI($length(output), 0) ? defaultBuildOutput(target) : output;
          const finalPage = $eqI($length(page), 0) ? "Pfun Application" : page;
          return $makeVariant("BuildFlagsOk", "BuildFlagsResult", ["target", "output", "page"], [target, finalOutput, finalPage]);
        }
      }
    }
    function parseBuildFlags(args, target, output, page) {
      return (($match$153) => {
        if ($match$153.$t === "None") {
          return finishBuildFlags(target, output, page);
        }
        if ($match$153.$t === "Some") {
          const flagCell = $match$153;
          return (() => {
            const flag = flagCell.f[0].f[0];
            const afterFlag = flagCell.f[0].f[1];
            return (($match$172) => {
              if ($match$172.$t === "None") {
                return (() => {
                  return $makeVariant("BuildFlagsErr", "BuildFlagsResult", ["message"], [$concatS($concatS("Option '", flag), "' requires a value.")]);
                })();
              }
              if ($match$172.$t === "Some") {
                const valueCell = $match$172;
                return (() => {
                  const value = valueCell.f[0].f[0];
                  const rest = valueCell.f[0].f[1];
                  if (!validText(value)) {
                    return $makeVariant("BuildFlagsErr", "BuildFlagsResult", ["message"], [$concatS($concatS("Option '", flag), "' requires a value.")]);
                  } else {
                    if (flag === "--target") {
                      return parseBuildFlags(rest, value, output, page);
                    } else {
                      if (flag === "-o" || flag === "--output") {
                        return parseBuildFlags(rest, target, value, page);
                      } else {
                        if (flag === "--page") {
                          return parseBuildFlags(rest, target, output, value);
                        } else {
                          return $makeVariant("BuildFlagsErr", "BuildFlagsResult", ["message"], [$concatS($concatS("Unknown build option '", flag), "'.")]);
                        }
                      }
                    }
                  }
                })();
              }
              throw $matchFail("src/drivers/cliargs.pf", 172);
            })($field(Compat, "uncons")(afterFlag));
          })();
        }
        throw $matchFail("src/drivers/cliargs.pf", 153);
      })($field(Compat, "uncons")(args));
    }
    function parseBuild(args) {
      const entry = argAt(args, 1);
      const count = $length(args);
      if ($ltI(count, 2) || !validText(entry)) {
        return $makeVariant("CliUsage", "CliPlan", ["message"], [usageText()]);
      } else {
        const flags = $eqI(count, 2) ? [] : $slice(2, $subI(count, 2), args);
        return (($match$287) => {
          if ($match$287.$t === "BuildFlagsErr") {
            const failed = $match$287;
            return usage(failed.f[0]);
          }
          if ($match$287.$t === "BuildFlagsOk") {
            const parsed = $match$287;
            return (() => {
              return $makeVariant("CliBuild", "CliPlan", ["entry", "target", "output", "page"], [entry, parsed.f[0], parsed.f[1], parsed.f[2]]);
            })();
          }
          throw $matchFail("src/drivers/cliargs.pf", 287);
        })(parseBuildFlags(flags, "node-bundle", "", ""));
      }
    }
    function runArgs(args) {
      const count = $length(args);
      if ($leI(count, 2)) {
        return [];
      } else {
        return $slice(2, $subI(count, 2), args);
      }
    }
    function parseRun(args) {
      const entry = argAt(args, 1);
      if ($ltI($length(args), 2)) {
        return usage("Run requires an entry file.");
      } else {
        if (!validText(entry)) {
          return usage("Run requires an entry file.");
        } else {
          return $makeVariant("CliRun", "CliPlan", ["entry", "args"], [entry, runArgs(args)]);
        }
      }
    }
    function parseArgs(args) {
      const count = $length(args);
      const command = argAt(args, 0);
      if ($eqI(count, 0)) {
        return $makeVariant("CliUsage", "CliPlan", ["message"], [usageText()]);
      } else {
        if (command === "check") {
          return parseCheck(args);
        } else {
          if (command === "build") {
            return parseBuild(args);
          } else {
            if (command === "run") {
              return parseRun(args);
            } else {
              return $makeVariant("CliUsage", "CliPlan", ["message"], [$concatS($concatS($concatS("Unknown command '", command), "'.\n"), usageText())]);
            }
          }
        }
      }
    }
    function homeFromEnv(value) {
      return (($match$414) => {
        if ($match$414.$t === "None") {
          return ".";
        }
        if ($match$414.$t === "Some") {
          const home = $match$414;
          return (() => {
            if ($eqI($length(home.f[0]), 0)) {
              return ".";
            } else {
              return home.f[0];
            }
          })();
        }
        throw $matchFail("src/drivers/cliargs.pf", 414);
      })(value);
    }
    function endsWithSlash(path) {
      return $gtI($length(path), 0) && $eq($slice($subI($length(path), 1), 1, path), "/");
    }
    function startsWithSlash(path) {
      return $gtI($length(path), 0) && $eq($slice(0, 1, path), "/");
    }
    function stripLeadingSlash(path) {
      if (startsWithSlash(path)) {
        return $slice(1, $subI($length(path), 1), path);
      } else {
        return path;
      }
    }
    function joinPath(left, right) {
      if ($eqI($length(left), 0)) {
        return right;
      } else {
        if ($eqI($length(right), 0)) {
          return left;
        } else {
          if (endsWithSlash(left)) {
            return $concatS(left, stripLeadingSlash(right));
          } else {
            return $concatS($concatS(left, "/"), stripLeadingSlash(right));
          }
        }
      }
    }
    function lastSlashLoop(path, index, found) {
      while (true) {
        if ($geI(index, $length(path))) {
          return found;
        } else {
          if ($eq($slice(index, 1, path), "/")) {
            const $tc$540$0 = path;
            const $tc$540$1 = $addI(index, 1);
            const $tc$540$2 = index;
            path = $tc$540$0;
            index = $tc$540$1;
            found = $tc$540$2;
            continue;
          } else {
            const $tc$548$0 = path;
            const $tc$548$1 = $addI(index, 1);
            const $tc$548$2 = found;
            path = $tc$548$0;
            index = $tc$548$1;
            found = $tc$548$2;
            continue;
          }
        }
      }
    }
    function outputDir(path) {
      const slash = lastSlashLoop(path, 0, $subI(0, 1));
      if ($ltI(slash, 0)) {
        return ".";
      } else {
        if ($eqI(slash, 0)) {
          return "/";
        } else {
          return $slice(0, slash, path);
        }
      }
    }
    exports["CliCheck"] = CliCheck;
    exports["CliBuild"] = CliBuild;
    exports["CliRun"] = CliRun;
    exports["CliUsage"] = CliUsage;
    exports["usageText"] = usageText;
    exports["parseArgs"] = parseArgs;
    exports["homeFromEnv"] = homeFromEnv;
    exports["joinPath"] = joinPath;
    exports["outputDir"] = outputDir;
  });
  $registerSchemas([{name: "BOk", union: "BResult", fields: ["value"], variant: true}, {name: "BErr", union: "BResult", fields: ["message"], variant: true}]);
  $maps["src/data/resultx"] = {};
  $mods["src/data/resultx"] = ((exports, $require) => {
    function BOk(value) {
      return $makeVariant("BOk", "BResult", ["value"], [value]);
    }
    function BErr(message) {
      return $makeVariant("BErr", "BResult", ["message"], [message]);
    }
    const bResultMessageTypeWitness = $makeVariant("BErr", "BResult", ["message"], [""]);
    function ok(value) {
      return $makeVariant("BOk", "BResult", ["value"], [value]);
    }
    function err(message) {
      return $makeVariant("BErr", "BResult", ["message"], [message]);
    }
    function isOk(r) {
      return (($match$16) => {
        if ($match$16.$t === "BOk") {
          return true;
        }
        if ($match$16.$t === "BErr") {
          return false;
        }
        throw $matchFail("src/data/resultx.pf", 16);
      })(r);
    }
    function isErr(r) {
      return (($match$23) => {
        if ($match$23.$t === "BOk") {
          return false;
        }
        if ($match$23.$t === "BErr") {
          return true;
        }
        throw $matchFail("src/data/resultx.pf", 23);
      })(r);
    }
    function mapResult(f, r) {
      return (($match$30) => {
        if ($match$30.$t === "BOk") {
          const x = $match$30;
          return $makeVariant("BOk", "BResult", ["value"], [f(x.f[0])]);
        }
        if ($match$30.$t === "BErr") {
          const e = $match$30;
          return $makeVariant("BErr", "BResult", ["message"], [e.f[0]]);
        }
        throw $matchFail("src/data/resultx.pf", 30);
      })(r);
    }
    function mapErr(f, r) {
      return (($match$43) => {
        if ($match$43.$t === "BOk") {
          const x = $match$43;
          return $makeVariant("BOk", "BResult", ["value"], [x.f[0]]);
        }
        if ($match$43.$t === "BErr") {
          const e = $match$43;
          return $makeVariant("BErr", "BResult", ["message"], [f(e.f[0])]);
        }
        throw $matchFail("src/data/resultx.pf", 43);
      })(r);
    }
    function andThenResult(r, f) {
      return (($match$56) => {
        if ($match$56.$t === "BOk") {
          const x = $match$56;
          return f(x.f[0]);
        }
        if ($match$56.$t === "BErr") {
          const e = $match$56;
          return $makeVariant("BErr", "BResult", ["message"], [e.f[0]]);
        }
        throw $matchFail("src/data/resultx.pf", 56);
      })(r);
    }
    function withDefault(defaultValue, r) {
      return (($match$68) => {
        if ($match$68.$t === "BOk") {
          const x = $match$68;
          return x.f[0];
        }
        if ($match$68.$t === "BErr") {
          return defaultValue;
        }
        throw $matchFail("src/data/resultx.pf", 68);
      })(r);
    }
    function toOption(r) {
      return (($match$76) => {
        if ($match$76.$t === "BOk") {
          const x = $match$76;
          return $makeVariant("Some", "Option", ["value"], [x.f[0]]);
        }
        if ($match$76.$t === "BErr") {
          return $makeVariant("None", "Option", [], []);
        }
        throw $matchFail("src/data/resultx.pf", 76);
      })(r);
    }
    function fromOption(message, opt) {
      return (($match$85) => {
        if ($match$85.$t === "Some") {
          const x = $match$85;
          return $makeVariant("BOk", "BResult", ["value"], [x.f[0]]);
        }
        if ($match$85.$t === "None") {
          return $makeVariant("BErr", "BResult", ["message"], [message]);
        }
        throw $matchFail("src/data/resultx.pf", 85);
      })(opt);
    }
    function combine(left, right) {
      return (($match$95) => {
        if ($match$95.$t === "BErr") {
          const e = $match$95;
          return $makeVariant("BErr", "BResult", ["message"], [e.f[0]]);
        }
        if ($match$95.$t === "BOk") {
          return right;
        }
        throw $matchFail("src/data/resultx.pf", 95);
      })(left);
    }
    function collect(results) {
      const st = $reduce((acc, r) => (() => {
        return (($match$106) => {
          if ($match$106.$t === "BErr") {
            return acc;
          }
          if ($match$106.$t === "BOk") {
            const xs = $match$106;
            return (() => {
              return (($match$110) => {
                if ($match$110.$t === "BErr") {
                  const e = $match$110;
                  return $makeVariant("BErr", "BResult", ["message"], [e.f[0]]);
                }
                if ($match$110.$t === "BOk") {
                  const x = $match$110;
                  return $makeVariant("BOk", "BResult", ["value"], [$cons(x.f[0], xs.f[0])]);
                }
                throw $matchFail("src/data/resultx.pf", 110);
              })(r);
            })();
          }
          throw $matchFail("src/data/resultx.pf", 106);
        })(acc);
      })(), $makeVariant("BOk", "BResult", ["value"], [[]]), results);
      return (($match$130) => {
        if ($match$130.$t === "BErr") {
          const e = $match$130;
          return $makeVariant("BErr", "BResult", ["message"], [e.f[0]]);
        }
        if ($match$130.$t === "BOk") {
          const xs = $match$130;
          return $makeVariant("BOk", "BResult", ["value"], [$reverse(xs.f[0])]);
        }
        throw $matchFail("src/data/resultx.pf", 130);
      })(st);
    }
    exports["BOk"] = BOk;
    exports["BErr"] = BErr;
    exports["ok"] = ok;
    exports["err"] = err;
    exports["isOk"] = isOk;
    exports["isErr"] = isErr;
    exports["mapResult"] = mapResult;
    exports["mapErr"] = mapErr;
    exports["andThenResult"] = andThenResult;
    exports["withDefault"] = withDefault;
    exports["toOption"] = toOption;
    exports["fromOption"] = fromOption;
    exports["combine"] = combine;
    exports["collect"] = collect;
  });
  $maps["src/drivers/iofloor"] = {io: "io", file: "file", "../data/resultx": "src/data/resultx"};
  $mods["src/drivers/iofloor"] = ((exports, $require) => {
    const $star$1 = $require("io");
    const $star$2 = $require("file");
    const $star$3 = $require("../data/resultx");
    function okText(text) {
      return $makeVariant("BOk", "BResult", ["value"], [$concatS(text, "")]);
    }
    function errText(message) {
      return $makeVariant("BErr", "BResult", ["message"], [$concatS(message, "")]);
    }
    function args() {
      return $starGet([$star$1, $star$2, $star$3], "scriptArgs")();
    }
    function env(name) {
      return $starGet([$star$1, $star$2, $star$3], "getEnv")(name);
    }
    function readTextFile(path) {
      return (($match$29) => {
        if ($match$29.$t === "Ok") {
          const o = $match$29;
          return $makeVariant("BOk", "BResult", ["value"], [o.f[0]]);
        }
        if ($match$29.$t === "Err") {
          const e = $match$29;
          return $makeVariant("BErr", "BResult", ["message"], [e.f[0]]);
        }
        throw $matchFail("src/drivers/iofloor.pf", 29);
      })($starGet([$star$1, $star$2, $star$3], "readFile")(path));
    }
    function writeTextFile(path, text) {
      return (($match$42) => {
        if ($match$42.$t === "Ok") {
          const o = $match$42;
          return $makeVariant("BOk", "BResult", ["value"], [o.f[0]]);
        }
        if ($match$42.$t === "Err") {
          const e = $match$42;
          return $makeVariant("BErr", "BResult", ["message"], [e.f[0]]);
        }
        throw $matchFail("src/drivers/iofloor.pf", 42);
      })($starGet([$star$1, $star$2, $star$3], "writeFile")(path, text));
    }
    function ensureDir(path) {
      return (($match$56) => {
        if ($match$56.$t === "Ok") {
          const o = $match$56;
          return $makeVariant("BOk", "BResult", ["value"], [o.f[0]]);
        }
        if ($match$56.$t === "Err") {
          const e = $match$56;
          return $makeVariant("BErr", "BResult", ["message"], [e.f[0]]);
        }
        throw $matchFail("src/drivers/iofloor.pf", 56);
      })($starGet([$star$1, $star$2, $star$3], "mkdirP")(path));
    }
    function executeNodeBundle(source, args) {
      return (($match$69) => {
        if ($match$69.$t === "Ok") {
          const result = $match$69;
          return $makeVariant("BOk", "BResult", ["value"], [result.f[0]]);
        }
        if ($match$69.$t === "Err") {
          const failure = $match$69;
          return $makeVariant("BErr", "BResult", ["message"], [failure.f[0]]);
        }
        throw $matchFail("src/drivers/iofloor.pf", 69);
      })($starGet([$star$1, $star$2, $star$3], "runNodeBundle")(source, args));
    }
    function printLines(lines) {
      return $starGet([$star$1, $star$2, $star$3], "println")($join(lines, "\n"));
    }
    function errorLines(lines) {
      return $starGet([$star$1, $star$2, $star$3], "eprintln")($join(lines, "\n"));
    }
    function fail(message, code) {
      errorLines([$concatS(message, "")]);
      return $starGet([$star$1, $star$2, $star$3], "exit")(code);
    }
    function exitWith(code) {
      return $starGet([$star$1, $star$2, $star$3], "exit")(code);
    }
    function exitOk() {
      return $starGet([$star$1, $star$2, $star$3], "exit")(0);
    }
    function exitErr() {
      return $starGet([$star$1, $star$2, $star$3], "exit")(1);
    }
    exports["okText"] = okText;
    exports["errText"] = errText;
    exports["args"] = args;
    exports["env"] = env;
    exports["readTextFile"] = readTextFile;
    exports["writeTextFile"] = writeTextFile;
    exports["ensureDir"] = ensureDir;
    exports["executeNodeBundle"] = executeNodeBundle;
    exports["printLines"] = printLines;
    exports["errorLines"] = errorLines;
    exports["fail"] = fail;
    exports["exitWith"] = exitWith;
    exports["exitOk"] = exitOk;
    exports["exitErr"] = exitErr;
  });
  $registerSchemas([{name: "Pos", union: null, fields: ["line", "col", "offset"], variant: false}, {name: "Span", union: null, fields: ["start", "end"], variant: false}, {name: "TokInt", union: "Tok", fields: ["n"], variant: true}, {name: "TokFloat", union: "Tok", fields: ["text"], variant: true}, {name: "TokBool", union: "Tok", fields: ["b"], variant: true}, {name: "TokStr", union: "Tok", fields: ["s"], variant: true}, {name: "TokRawStr", union: "Tok", fields: ["s"], variant: true}, {name: "TokFmtStr", union: "Tok", fields: ["s"], variant: true}, {name: "TokChar", union: "Tok", fields: ["c"], variant: true}, {name: "TokByte", union: "Tok", fields: ["b"], variant: true}, {name: "TokIdent", union: "Tok", fields: ["name"], variant: true}, {name: "TokKw", union: "Tok", fields: ["word"], variant: true}, {name: "TokOp", union: "Tok", fields: ["op"], variant: true}, {name: "TokEof", union: "Tok", fields: [], variant: true}, {name: "Token", union: null, fields: ["tok", "span"], variant: false}]);
  $maps["src/syntax/token"] = {};
  $mods["src/syntax/token"] = ((exports, $require) => {
    function mkPos(line, col, offset) {
      return $makeRecord("Pos", ["line", "col", "offset"], [line, col, offset]);
    }
    function mkSpan(startPos, endPos) {
      return $makeRecord("Span", ["start", "end"], [startPos, endPos]);
    }
    function pointSpan(p) {
      return $makeRecord("Span", ["start", "end"], [p, p]);
    }
    function TokInt(n) {
      return $makeVariant("TokInt", "Tok", ["n"], [n]);
    }
    function TokFloat(text) {
      return $makeVariant("TokFloat", "Tok", ["text"], [text]);
    }
    function TokBool(b) {
      return $makeVariant("TokBool", "Tok", ["b"], [b]);
    }
    function TokStr(s) {
      return $makeVariant("TokStr", "Tok", ["s"], [s]);
    }
    function TokRawStr(s) {
      return $makeVariant("TokRawStr", "Tok", ["s"], [s]);
    }
    function TokFmtStr(s) {
      return $makeVariant("TokFmtStr", "Tok", ["s"], [s]);
    }
    function TokChar(c) {
      return $makeVariant("TokChar", "Tok", ["c"], [c]);
    }
    function TokByte(b) {
      return $makeVariant("TokByte", "Tok", ["b"], [b]);
    }
    function TokIdent(name) {
      return $makeVariant("TokIdent", "Tok", ["name"], [name]);
    }
    function TokKw(word) {
      return $makeVariant("TokKw", "Tok", ["word"], [word]);
    }
    function TokOp(op) {
      return $makeVariant("TokOp", "Tok", ["op"], [op]);
    }
    const TokEof = $makeVariant("TokEof", "Tok", [], []);
    function tokenTypeWitness() {
      const p = $makeRecord("Pos", ["line", "col", "offset"], [1, 1, 0]);
      const sp = $makeRecord("Span", ["start", "end"], [p, p]);
      return [$makeRecord("Token", ["tok", "span"], [$makeVariant("TokInt", "Tok", ["n"], [0]), sp]), $makeRecord("Token", ["tok", "span"], [$makeVariant("TokFloat", "Tok", ["text"], ["0.0"]), sp]), $makeRecord("Token", ["tok", "span"], [$makeVariant("TokBool", "Tok", ["b"], [false]), sp]), $makeRecord("Token", ["tok", "span"], [$makeVariant("TokStr", "Tok", ["s"], [""]), sp]), $makeRecord("Token", ["tok", "span"], [$makeVariant("TokRawStr", "Tok", ["s"], [""]), sp]), $makeRecord("Token", ["tok", "span"], [$makeVariant("TokFmtStr", "Tok", ["s"], [""]), sp]), $makeRecord("Token", ["tok", "span"], [$makeVariant("TokChar", "Tok", ["c"], ["x"]), sp]), $makeRecord("Token", ["tok", "span"], [$makeVariant("TokByte", "Tok", ["b"], [0]), sp]), $makeRecord("Token", ["tok", "span"], [$makeVariant("TokIdent", "Tok", ["name"], [""]), sp]), $makeRecord("Token", ["tok", "span"], [$makeVariant("TokKw", "Tok", ["word"], [""]), sp]), $makeRecord("Token", ["tok", "span"], [$makeVariant("TokOp", "Tok", ["op"], [""]), sp]), $makeRecord("Token", ["tok", "span"], [TokEof, sp])];
    }
    function mkToken(tok, span) {
      return $makeRecord("Token", ["tok", "span"], [tok, span]);
    }
    function intTok(n, span) {
      return $makeRecord("Token", ["tok", "span"], [$makeVariant("TokInt", "Tok", ["n"], [n]), span]);
    }
    function floatTok(text, span) {
      return $makeRecord("Token", ["tok", "span"], [$makeVariant("TokFloat", "Tok", ["text"], [text]), span]);
    }
    function boolTok(b, span) {
      return $makeRecord("Token", ["tok", "span"], [$makeVariant("TokBool", "Tok", ["b"], [b]), span]);
    }
    function strTok(s, span) {
      return $makeRecord("Token", ["tok", "span"], [$makeVariant("TokStr", "Tok", ["s"], [s]), span]);
    }
    function rawStrTok(s, span) {
      return $makeRecord("Token", ["tok", "span"], [$makeVariant("TokRawStr", "Tok", ["s"], [s]), span]);
    }
    function fmtStrTok(s, span) {
      return $makeRecord("Token", ["tok", "span"], [$makeVariant("TokFmtStr", "Tok", ["s"], [s]), span]);
    }
    function charTok(c, span) {
      return $makeRecord("Token", ["tok", "span"], [$makeVariant("TokChar", "Tok", ["c"], [c]), span]);
    }
    function byteTok(b, span) {
      return $makeRecord("Token", ["tok", "span"], [$makeVariant("TokByte", "Tok", ["b"], [b]), span]);
    }
    function identTok(name, span) {
      return $makeRecord("Token", ["tok", "span"], [$makeVariant("TokIdent", "Tok", ["name"], [name]), span]);
    }
    function kwTok(word, span) {
      return $makeRecord("Token", ["tok", "span"], [$makeVariant("TokKw", "Tok", ["word"], [word]), span]);
    }
    function opTok(op, span) {
      return $makeRecord("Token", ["tok", "span"], [$makeVariant("TokOp", "Tok", ["op"], [op]), span]);
    }
    function eofToken(pos) {
      return $makeRecord("Token", ["tok", "span"], [TokEof, pointSpan(pos)]);
    }
    function isOp(token, op) {
      return (($match$178) => {
        if ($match$178.$t === "TokOp") {
          const t = $match$178;
          return t.f[0] === op;
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/syntax/token.pf", 178);
      })(token.f[0]);
    }
    function isKw(token, word) {
      return (($match$189) => {
        if ($match$189.$t === "TokKw") {
          const t = $match$189;
          return t.f[0] === word;
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/syntax/token.pf", 189);
      })(token.f[0]);
    }
    function isIdent(token, name) {
      return (($match$200) => {
        if ($match$200.$t === "TokIdent") {
          const t = $match$200;
          return t.f[0] === name;
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/syntax/token.pf", 200);
      })(token.f[0]);
    }
    function tokenStart(token) {
      return token.f[1].f[0];
    }
    function tokenEnd(token) {
      return token.f[1].f[1];
    }
    function tokenKind(token) {
      return (($match$223) => {
        if ($match$223.$t === "TokInt") {
          return "TokInt";
        }
        if ($match$223.$t === "TokFloat") {
          return "TokFloat";
        }
        if ($match$223.$t === "TokBool") {
          return "TokBool";
        }
        if ($match$223.$t === "TokStr") {
          return "TokStr";
        }
        if ($match$223.$t === "TokRawStr") {
          return "TokRawStr";
        }
        if ($match$223.$t === "TokFmtStr") {
          return "TokFmtStr";
        }
        if ($match$223.$t === "TokChar") {
          return "TokChar";
        }
        if ($match$223.$t === "TokByte") {
          return "TokByte";
        }
        if ($match$223.$t === "TokIdent") {
          return "TokIdent";
        }
        if ($match$223.$t === "TokKw") {
          return "TokKw";
        }
        if ($match$223.$t === "TokOp") {
          return "TokOp";
        }
        if ($match$223.$t === "TokEof") {
          return "TokEof";
        }
        throw $matchFail("src/syntax/token.pf", 223);
      })(token.f[0]);
    }
    function tokPayload(tok) {
      return (($match$241) => {
        if ($match$241.$t === "TokInt") {
          const t = $match$241;
          return $str(t.f[0]);
        }
        if ($match$241.$t === "TokFloat") {
          const t = $match$241;
          return t.f[0];
        }
        if ($match$241.$t === "TokBool") {
          const t = $match$241;
          return $str(t.f[0]);
        }
        if ($match$241.$t === "TokStr") {
          const t = $match$241;
          return t.f[0];
        }
        if ($match$241.$t === "TokRawStr") {
          const t = $match$241;
          return t.f[0];
        }
        if ($match$241.$t === "TokFmtStr") {
          const t = $match$241;
          return t.f[0];
        }
        if ($match$241.$t === "TokChar") {
          const t = $match$241;
          return $str(t.f[0]);
        }
        if ($match$241.$t === "TokByte") {
          const t = $match$241;
          return $str(t.f[0]);
        }
        if ($match$241.$t === "TokIdent") {
          const t = $match$241;
          return t.f[0];
        }
        if ($match$241.$t === "TokKw") {
          const t = $match$241;
          return t.f[0];
        }
        if ($match$241.$t === "TokOp") {
          const t = $match$241;
          return t.f[0];
        }
        if ($match$241.$t === "TokEof") {
          return "";
        }
        throw $matchFail("src/syntax/token.pf", 241);
      })(tok);
    }
    function tokenPayload(token) {
      return tokPayload(token.f[0]);
    }
    function tokToStr(tok) {
      return (($match$284) => {
        if ($match$284.$t === "TokInt") {
          const t = $match$284;
          return $concatS($concatS("TokInt(", $str(t.f[0])), ")");
        }
        if ($match$284.$t === "TokFloat") {
          const t = $match$284;
          return $concatS($concatS("TokFloat(", t.f[0]), ")");
        }
        if ($match$284.$t === "TokBool") {
          const t = $match$284;
          return $concatS($concatS("TokBool(", $str(t.f[0])), ")");
        }
        if ($match$284.$t === "TokStr") {
          const t = $match$284;
          return $concatS($concatS("TokStr(\"", t.f[0]), "\")");
        }
        if ($match$284.$t === "TokRawStr") {
          const t = $match$284;
          return $concatS($concatS("TokRawStr(@\"", t.f[0]), "\")");
        }
        if ($match$284.$t === "TokFmtStr") {
          const t = $match$284;
          return $concatS($concatS("TokFmtStr($\"", t.f[0]), "\")");
        }
        if ($match$284.$t === "TokChar") {
          const t = $match$284;
          return $concatS($concatS("TokChar('", $str(t.f[0])), "')");
        }
        if ($match$284.$t === "TokByte") {
          const t = $match$284;
          return $concatS($concatS("TokByte(", $str(t.f[0])), ")");
        }
        if ($match$284.$t === "TokIdent") {
          const t = $match$284;
          return $concatS($concatS("TokIdent(", t.f[0]), ")");
        }
        if ($match$284.$t === "TokKw") {
          const t = $match$284;
          return $concatS($concatS("TokKw(", t.f[0]), ")");
        }
        if ($match$284.$t === "TokOp") {
          const t = $match$284;
          return $concatS($concatS("TokOp(", t.f[0]), ")");
        }
        if ($match$284.$t === "TokEof") {
          return "TokEof";
        }
        throw $matchFail("src/syntax/token.pf", 284);
      })(tok);
    }
    function tokenToStr(token) {
      return $concatS($concatS($concatS($concatS(tokToStr(token.f[0]), "@"), $str(token.f[1].f[0].f[0])), ":"), $str(token.f[1].f[0].f[1]));
    }
    const tokenAccessorWitnessPos = $makeRecord("Pos", ["line", "col", "offset"], [1, 1, 0]);
    const tokenAccessorWitnessSpan = $makeRecord("Span", ["start", "end"], [tokenAccessorWitnessPos, tokenAccessorWitnessPos]);
    const tokenAccessorWitnessToken = $makeRecord("Token", ["tok", "span"], [TokEof, tokenAccessorWitnessSpan]);
    const tokenPredicateTypeWitness = [isOp(tokenAccessorWitnessToken, ""), isKw(tokenAccessorWitnessToken, ""), isIdent(tokenAccessorWitnessToken, "")];
    const tokenPositionTypeWitness = [tokenStart(tokenAccessorWitnessToken), tokenEnd(tokenAccessorWitnessToken)];
    const tokenTextTypeWitness = [tokenKind(tokenAccessorWitnessToken), tokenPayload(tokenAccessorWitnessToken), tokenToStr(tokenAccessorWitnessToken)];
    exports["mkPos"] = mkPos;
    exports["mkSpan"] = mkSpan;
    exports["pointSpan"] = pointSpan;
    exports["TokInt"] = TokInt;
    exports["TokFloat"] = TokFloat;
    exports["TokBool"] = TokBool;
    exports["TokStr"] = TokStr;
    exports["TokRawStr"] = TokRawStr;
    exports["TokFmtStr"] = TokFmtStr;
    exports["TokChar"] = TokChar;
    exports["TokByte"] = TokByte;
    exports["TokIdent"] = TokIdent;
    exports["TokKw"] = TokKw;
    exports["TokOp"] = TokOp;
    exports["TokEof"] = TokEof;
    exports["mkToken"] = mkToken;
    exports["intTok"] = intTok;
    exports["floatTok"] = floatTok;
    exports["boolTok"] = boolTok;
    exports["strTok"] = strTok;
    exports["rawStrTok"] = rawStrTok;
    exports["fmtStrTok"] = fmtStrTok;
    exports["charTok"] = charTok;
    exports["byteTok"] = byteTok;
    exports["identTok"] = identTok;
    exports["kwTok"] = kwTok;
    exports["opTok"] = opTok;
    exports["eofToken"] = eofToken;
    exports["isOp"] = isOp;
    exports["isKw"] = isKw;
    exports["isIdent"] = isIdent;
    exports["tokenStart"] = tokenStart;
    exports["tokenEnd"] = tokenEnd;
    exports["tokenKind"] = tokenKind;
    exports["tokPayload"] = tokPayload;
    exports["tokenPayload"] = tokenPayload;
    exports["tokToStr"] = tokToStr;
    exports["tokenToStr"] = tokenToStr;
  });
  $maps["src/data/listx"] = {"../compat": "src/compat"};
  $mods["src/data/listx"] = ((exports, $require) => {
    const Compat = $require("../compat");
    function revOnto(xs, acc) {
      return $reduce((a, x) => $cons(x, a), acc, xs);
    }
    function isEmpty(xs) {
      return $eqI($length(xs), 0);
    }
    function nonEmpty(xs) {
      return $gtI($length(xs), 0);
    }
    function appendL(a, b) {
      return revOnto(revOnto(a, []), b);
    }
    function appendOne(xs, x) {
      return appendL(xs, [x]);
    }
    function concat(lists) {
      return $reverse($reduce((acc, xs) => revOnto(xs, acc), [], lists));
    }
    function foldLeft(f, init, xs) {
      return $reduce(f, init, xs);
    }
    function sum(xs) {
      return $reduce((acc, x) => $addI(acc, x), 0, xs);
    }
    function product(xs) {
      return $reduce((acc, x) => $mulI(acc, x), 1, xs);
    }
    function count(pred, xs) {
      return $reduce((n, x) => (() => {
        if (pred(x)) {
          return $addI(n, 1);
        } else {
          return n;
        }
      })(), 0, xs);
    }
    function countWhere(pred, xs) {
      return count(pred, xs);
    }
    function minByLoop(cmp, xs, best) {
      return (($match$117) => {
        if ($match$117.$t === "None") {
          return best;
        }
        if ($match$117.$t === "Some") {
          const cell = $match$117;
          return (() => {
            const p = cell.f[0];
            if ($ltI(cmp(p.f[0], best), 0)) {
              return minByLoop(cmp, p.f[1], p.f[0]);
            } else {
              return minByLoop(cmp, p.f[1], best);
            }
          })();
        }
        throw $matchFail("src/data/listx.pf", 117);
      })($field(Compat, "uncons")(xs));
    }
    function minBy(cmp, xs) {
      return (($match$152) => {
        if ($match$152.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$152.$t === "Some") {
          const cell = $match$152;
          return (() => {
            const p = cell.f[0];
            return $makeVariant("Some", "Option", ["value"], [minByLoop(cmp, p.f[1], p.f[0])]);
          })();
        }
        throw $matchFail("src/data/listx.pf", 152);
      })($field(Compat, "uncons")(xs));
    }
    function maxByLoop(cmp, xs, best) {
      return (($match$174) => {
        if ($match$174.$t === "None") {
          return best;
        }
        if ($match$174.$t === "Some") {
          const cell = $match$174;
          return (() => {
            const p = cell.f[0];
            if ($gtI(cmp(p.f[0], best), 0)) {
              return maxByLoop(cmp, p.f[1], p.f[0]);
            } else {
              return maxByLoop(cmp, p.f[1], best);
            }
          })();
        }
        throw $matchFail("src/data/listx.pf", 174);
      })($field(Compat, "uncons")(xs));
    }
    function maxBy(cmp, xs) {
      return (($match$209) => {
        if ($match$209.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$209.$t === "Some") {
          const cell = $match$209;
          return (() => {
            const p = cell.f[0];
            return $makeVariant("Some", "Option", ["value"], [maxByLoop(cmp, p.f[1], p.f[0])]);
          })();
        }
        throw $matchFail("src/data/listx.pf", 209);
      })($field(Compat, "uncons")(xs));
    }
    function compareScalar(a, b) {
      if (a < b) {
        return $negI(1);
      } else {
        if (a > b) {
          return 1;
        } else {
          return 0;
        }
      }
    }
    function minimum(xs) {
      return minBy(compareScalar, xs);
    }
    function maximum(xs) {
      return maxBy(compareScalar, xs);
    }
    function anyLoop(pred, xs) {
      return (($match$262) => {
        if ($match$262.$t === "None") {
          return false;
        }
        if ($match$262.$t === "Some") {
          const cell = $match$262;
          return (() => {
            const p = cell.f[0];
            if (pred(p.f[0])) {
              return true;
            } else {
              return anyLoop(pred, p.f[1]);
            }
          })();
        }
        throw $matchFail("src/data/listx.pf", 262);
      })($field(Compat, "uncons")(xs));
    }
    function any(pred, xs) {
      return anyLoop(pred, xs);
    }
    function allLoop(pred, xs) {
      return (($match$294) => {
        if ($match$294.$t === "None") {
          return true;
        }
        if ($match$294.$t === "Some") {
          const cell = $match$294;
          return (() => {
            const p = cell.f[0];
            if (pred(p.f[0])) {
              return allLoop(pred, p.f[1]);
            } else {
              return false;
            }
          })();
        }
        throw $matchFail("src/data/listx.pf", 294);
      })($field(Compat, "uncons")(xs));
    }
    function all(pred, xs) {
      return allLoop(pred, xs);
    }
    function containsBy(eq, needle, xs) {
      return any((x) => eq(x, needle), xs);
    }
    function elem(needle, xs) {
      return any((x) => $eq(x, needle), xs);
    }
    function notElem(needle, xs) {
      return !elem(needle, xs);
    }
    function findByLoop(pred, xs, index) {
      return (($match$355) => {
        if ($match$355.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$355.$t === "Some") {
          const cell = $match$355;
          return (() => {
            const p = cell.f[0];
            if (pred(p.f[0])) {
              return $makeVariant("Some", "Option", ["value"], [$makeRecord("Pair", ["key", "value"], [index, p.f[0]])]);
            } else {
              return findByLoop(pred, p.f[1], $addI(index, 1));
            }
          })();
        }
        throw $matchFail("src/data/listx.pf", 355);
      })($field(Compat, "uncons")(xs));
    }
    function findBy(pred, xs) {
      return findByLoop(pred, xs, 0);
    }
    function indexOfBy(eq, needle, xs) {
      return (($match$395) => {
        if ($match$395.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$395.$t === "Some") {
          const found = $match$395;
          return $makeVariant("Some", "Option", ["value"], [found.f[0].f[0]]);
        }
        throw $matchFail("src/data/listx.pf", 395);
      })(findBy((x) => eq(x, needle), xs));
    }
    function lookupLoop(key, pairs) {
      return (($match$412) => {
        if ($match$412.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$412.$t === "Some") {
          const cell = $match$412;
          return (() => {
            const p = cell.f[0];
            if ($eq($field(p.f[0], "key"), key)) {
              return $makeVariant("Some", "Option", ["value"], [$field(p.f[0], "value")]);
            } else {
              return lookupLoop(key, p.f[1]);
            }
          })();
        }
        throw $matchFail("src/data/listx.pf", 412);
      })($field(Compat, "uncons")(pairs));
    }
    function lookup(key, pairs) {
      return lookupLoop(key, pairs);
    }
    function filterMap(f, xs) {
      const rev = $reduce((acc, x) => (() => {
        return (($match$450) => {
          if ($match$450.$t === "None") {
            return acc;
          }
          if ($match$450.$t === "Some") {
            const y = $match$450;
            return $cons(y.f[0], acc);
          }
          throw $matchFail("src/data/listx.pf", 450);
        })(f(x));
      })(), [], xs);
      return $reverse(rev);
    }
    function mapWithIndex(f, xs) {
      const st = $reduce((state, x) => $makeRecord("Pair", ["key", "value"], [$addI(state.f[0], 1), $cons(f(state.f[0], x), state.f[1])]), $makeRecord("Pair", ["key", "value"], [0, []]), xs);
      return $reverse(st.f[1]);
    }
    function flatMap(f, xs) {
      return concat($map(f, xs));
    }
    function zipWithLoop(f, a, b, acc) {
      return (($match$510) => {
        if ($match$510.$t === "None") {
          return $reverse(acc);
        }
        if ($match$510.$t === "Some") {
          const acell = $match$510;
          return (() => {
            return (($match$519) => {
              if ($match$519.$t === "None") {
                return $reverse(acc);
              }
              if ($match$519.$t === "Some") {
                const bcell = $match$519;
                return (() => {
                  const ap = acell.f[0];
                  const bp = bcell.f[0];
                  return zipWithLoop(f, ap.f[1], bp.f[1], $cons(f(ap.f[0], bp.f[0]), acc));
                })();
              }
              throw $matchFail("src/data/listx.pf", 519);
            })($field(Compat, "uncons")(b));
          })();
        }
        throw $matchFail("src/data/listx.pf", 510);
      })($field(Compat, "uncons")(a));
    }
    function zipWith(f, a, b) {
      return zipWithLoop(f, a, b, []);
    }
    function zip(a, b) {
      return zipWith((x, y) => $makeRecord("Pair", ["key", "value"], [x, y]), a, b);
    }
    function unzipLoop(pairs, keys, values) {
      return (($match$574) => {
        if ($match$574.$t === "None") {
          return $makeRecord("Pair", ["key", "value"], [$reverse(keys), $reverse(values)]);
        }
        if ($match$574.$t === "Some") {
          const cell = $match$574;
          return (() => {
            const listCell = cell.f[0];
            const item = listCell.f[0];
            return unzipLoop(listCell.f[1], $cons($field(item, "key"), keys), $cons($field(item, "value"), values));
          })();
        }
        throw $matchFail("src/data/listx.pf", 574);
      })($field(Compat, "uncons")(pairs));
    }
    function unzip(pairs) {
      return unzipLoop(pairs, [], []);
    }
    function enumerate(xs) {
      return mapWithIndex((i, x) => $makeRecord("Pair", ["key", "value"], [i, x]), xs);
    }
    function takeL(n, xs) {
      if ($leI(n, 0)) {
        return [];
      } else {
        return $slice(0, n, xs);
      }
    }
    function dropL(n, xs) {
      if ($leI(n, 0)) {
        return xs;
      } else {
        const count = $subI($length(xs), n);
        if ($leI(count, 0)) {
          return [];
        } else {
          return $slice(n, count, xs);
        }
      }
    }
    function splitAt(n, xs) {
      return $makeRecord("Pair", ["key", "value"], [takeL(n, xs), dropL(n, xs)]);
    }
    function intersperse(sep, xs) {
      const st = $reduce((state, x) => (() => {
        if (state.f[0]) {
          return $makeRecord("Pair", ["key", "value"], [true, $cons(x, $cons(sep, state.f[1]))]);
        } else {
          return $makeRecord("Pair", ["key", "value"], [true, $cons(x, state.f[1])]);
        }
      })(), $makeRecord("Pair", ["key", "value"], [false, []]), xs);
      return $reverse(st.f[1]);
    }
    function mergeStep(cmp, a, b, la, lb, st) {
      const i = st.f[0].f[0];
      const j = st.f[0].f[1];
      const acc = st.f[1];
      if ($geI(i, la)) {
        return (($match$732) => {
          if ($match$732.$t === "None") {
            return st;
          }
          if ($match$732.$t === "Some") {
            const y = $match$732;
            return $makeRecord("Pair", ["key", "value"], [$makeRecord("Pair", ["key", "value"], [i, $addI(j, 1)]), $cons(y.f[0], acc)]);
          }
          throw $matchFail("src/data/listx.pf", 732);
        })($field(Compat, "listAt")(b, j));
      } else {
        if ($geI(j, lb)) {
          return (($match$754) => {
            if ($match$754.$t === "None") {
              return st;
            }
            if ($match$754.$t === "Some") {
              const x = $match$754;
              return $makeRecord("Pair", ["key", "value"], [$makeRecord("Pair", ["key", "value"], [$addI(i, 1), j]), $cons(x.f[0], acc)]);
            }
            throw $matchFail("src/data/listx.pf", 754);
          })($field(Compat, "listAt")(a, i));
        } else {
          return (($match$773) => {
            if ($match$773.$t === "None") {
              return st;
            }
            if ($match$773.$t === "Some") {
              const x = $match$773;
              return (() => {
                return (($match$781) => {
                  if ($match$781.$t === "None") {
                    return st;
                  }
                  if ($match$781.$t === "Some") {
                    const y = $match$781;
                    return (() => {
                      if ($leI(cmp(x.f[0], y.f[0]), 0)) {
                        return $makeRecord("Pair", ["key", "value"], [$makeRecord("Pair", ["key", "value"], [$addI(i, 1), j]), $cons(x.f[0], acc)]);
                      } else {
                        return $makeRecord("Pair", ["key", "value"], [$makeRecord("Pair", ["key", "value"], [i, $addI(j, 1)]), $cons(y.f[0], acc)]);
                      }
                    })();
                  }
                  throw $matchFail("src/data/listx.pf", 781);
                })($field(Compat, "listAt")(b, j));
              })();
            }
            throw $matchFail("src/data/listx.pf", 773);
          })($field(Compat, "listAt")(a, i));
        }
      }
    }
    function mergeTwo(cmp, a, b) {
      const la = $length(a);
      const lb = $length(b);
      const steps = appendL(a, b);
      const fin = $reduce((st, ignored) => mergeStep(cmp, a, b, la, lb, st), $makeRecord("Pair", ["key", "value"], [$makeRecord("Pair", ["key", "value"], [0, 0]), []]), steps);
      return $reverse(fin.f[1]);
    }
    function merge(cmp, a, b) {
      return mergeTwo(cmp, a, b);
    }
    function passStep(cmp, st, run) {
      const hasPending = $field($field(st, "key"), "key");
      const pending = $field($field(st, "key"), "value");
      const out = $field(st, "value");
      if (hasPending) {
        return $makeRecord("Pair", ["key", "value"], [$makeRecord("Pair", ["key", "value"], [false, []]), $cons(mergeTwo(cmp, pending, run), out)]);
      } else {
        return $makeRecord("Pair", ["key", "value"], [$makeRecord("Pair", ["key", "value"], [true, run]), out]);
      }
    }
    function mergePass(cmp, runs) {
      const fin = $reduce((st, run) => passStep(cmp, st, run), $makeRecord("Pair", ["key", "value"], [$makeRecord("Pair", ["key", "value"], [false, []]), []]), runs);
      if (fin.f[0].f[0]) {
        return $reverse($cons(fin.f[0].f[1], fin.f[1]));
      } else {
        return $reverse(fin.f[1]);
      }
    }
    function mergeAll(cmp, runs) {
      while (true) {
        if ($leI($length(runs), 1)) {
          const $match$945 = $field(Compat, "uncons")(runs);
          if ($match$945.$t === "None") {
            return [];
          }
          if ($match$945.$t === "Some") {
            const u = $match$945;
            return u.f[0].f[0];
          }
          throw $matchFail("src/data/listx.pf", 945);
        } else {
          const $tc$961$0 = cmp;
          const $tc$961$1 = mergePass(cmp, runs);
          cmp = $tc$961$0;
          runs = $tc$961$1;
          continue;
        }
      }
    }
    function sortBy(cmp, xs) {
      if ($leI($length(xs), 1)) {
        return xs;
      } else {
        return mergeAll(cmp, $map((x) => [x], xs));
      }
    }
    function sort(xs) {
      return sortBy(compareScalar, xs);
    }
    function sortDesc(xs) {
      return sortBy((a, b) => compareScalar(b, a), xs);
    }
    exports["isEmpty"] = isEmpty;
    exports["nonEmpty"] = nonEmpty;
    exports["appendL"] = appendL;
    exports["appendOne"] = appendOne;
    exports["concat"] = concat;
    exports["foldLeft"] = foldLeft;
    exports["sum"] = sum;
    exports["product"] = product;
    exports["count"] = count;
    exports["countWhere"] = countWhere;
    exports["minBy"] = minBy;
    exports["maxBy"] = maxBy;
    exports["compareScalar"] = compareScalar;
    exports["minimum"] = minimum;
    exports["maximum"] = maximum;
    exports["any"] = any;
    exports["all"] = all;
    exports["containsBy"] = containsBy;
    exports["elem"] = elem;
    exports["notElem"] = notElem;
    exports["findBy"] = findBy;
    exports["indexOfBy"] = indexOfBy;
    exports["lookup"] = lookup;
    exports["filterMap"] = filterMap;
    exports["mapWithIndex"] = mapWithIndex;
    exports["flatMap"] = flatMap;
    exports["zipWith"] = zipWith;
    exports["zip"] = zip;
    exports["unzip"] = unzip;
    exports["enumerate"] = enumerate;
    exports["takeL"] = takeL;
    exports["dropL"] = dropL;
    exports["splitAt"] = splitAt;
    exports["intersperse"] = intersperse;
    exports["merge"] = merge;
    exports["sortBy"] = sortBy;
    exports["sort"] = sort;
    exports["sortDesc"] = sortDesc;
  });
  $maps["src/data/strx"] = {"../compat": "src/compat", "./listx": "src/data/listx"};
  $mods["src/data/strx"] = ((exports, $require) => {
    const Compat = $require("../compat");
    const ListX = $require("./listx");
    function isWhitespace(c) {
      return c === " " || c === "\t" || c === "\n";
    }
    function strRepeat(s, n) {
      if ($leI(n, 0)) {
        return "";
      } else {
        if ($eqI(n, 1)) {
          return s;
        } else {
          const half = strRepeat(s, $divI(n, 2));
          if ($eqI($modI(n, 2), 0)) {
            return $concatS(half, half);
          } else {
            return $concatS($concatS(half, half), s);
          }
        }
      }
    }
    function trimRightStep(st, c) {
      if (isWhitespace(c)) {
        return $makeRecord("Pair", ["key", "value"], [$addI(st.f[0], 1), st.f[1]]);
      } else {
        return $makeRecord("Pair", ["key", "value"], [$addI(st.f[0], 1), st.f[0]]);
      }
    }
    function trimRight(s) {
      const cs = $split(s, "");
      const fin = $reduce((st, c) => trimRightStep(st, c), $makeRecord("Pair", ["key", "value"], [0, $subI(0, 1)]), cs);
      if ($ltI(fin.f[1], 0)) {
        return "";
      } else {
        return $slice(0, $addI(fin.f[1], 1), s);
      }
    }
    function trimLeftLoop(chars) {
      return (($match$112) => {
        if ($match$112.$t === "None") {
          return "";
        }
        if ($match$112.$t === "Some") {
          const cell = $match$112;
          return (() => {
            const p = cell.f[0];
            if (isWhitespace(p.f[0])) {
              return trimLeftLoop(p.f[1]);
            } else {
              return $join(chars, "");
            }
          })();
        }
        throw $matchFail("src/data/strx.pf", 112);
      })($field(Compat, "uncons")(chars));
    }
    function trimLeft(s) {
      return trimLeftLoop($split(s, ""));
    }
    function trim(s) {
      return trimRight(trimLeft(s));
    }
    function startsWith(s, prefix) {
      if ($gtI($length(prefix), $length(s))) {
        return false;
      } else {
        return $eq($slice(0, $length(prefix), s), prefix);
      }
    }
    function endsWith(s, suffix) {
      const ls = $length(s);
      const lx = $length(suffix);
      if ($gtI(lx, ls)) {
        return false;
      } else {
        return $eq($slice($subI(ls, lx), lx, s), suffix);
      }
    }
    function contains(s, needle) {
      return (($match$204) => {
        if ($match$204.$t === "None") {
          return false;
        }
        if ($match$204.$t === "Some") {
          return true;
        }
        throw $matchFail("src/data/strx.pf", 204);
      })($findSlice(s, needle));
    }
    function indexOf(s, needle) {
      return $findSlice(s, needle);
    }
    function replace(s, old, newText) {
      if ($eqI($length(old), 0)) {
        return s;
      } else {
        return (($match$228) => {
          if ($match$228.$t === "None") {
            return s;
          }
          if ($match$228.$t === "Some") {
            const found = $match$228;
            return (() => {
              const index = found.f[0];
              const after = $addI(index, $length(old));
              const tailCount = $subI($length(s), after);
              return $concatS($concatS($slice(0, index, s), newText), $slice(after, tailCount, s));
            })();
          }
          throw $matchFail("src/data/strx.pf", 228);
        })($findSlice(s, old));
      }
    }
    function replaceAll(s, old, newText) {
      if ($eqI($length(old), 0)) {
        return s;
      } else {
        return $join($split(s, old), newText);
      }
    }
    function strMatch(s, matchFn) {
      return $field(ListX, "any")(matchFn, $split(s, ""));
    }
    function replaceCharIf(c, matchFn, replaceFn) {
      if (matchFn(c)) {
        return replaceFn(c);
      } else {
        return c;
      }
    }
    function replaceMatch(s, matchFn, replaceFn) {
      return $join($map((c) => replaceCharIf(c, matchFn, replaceFn), $split(s, "")), "");
    }
    function takeWhileStep(pred, st, c) {
      if (st.f[0]) {
        if (pred(c)) {
          return $makeRecord("Pair", ["key", "value"], [true, $cons(c, st.f[1])]);
        } else {
          return $makeRecord("Pair", ["key", "value"], [false, st.f[1]]);
        }
      } else {
        return st;
      }
    }
    function takeWhile(s, pred) {
      const fin = $reduce((st, c) => takeWhileStep(pred, st, c), $makeRecord("Pair", ["key", "value"], [true, []]), $split(s, ""));
      return $join($reverse(fin.f[1]), "");
    }
    function dropWhileLoop(chars, pred) {
      return (($match$375) => {
        if ($match$375.$t === "None") {
          return "";
        }
        if ($match$375.$t === "Some") {
          const cell = $match$375;
          return (() => {
            const p = cell.f[0];
            if (pred(p.f[0])) {
              return dropWhileLoop(p.f[1], pred);
            } else {
              return $join(chars, "");
            }
          })();
        }
        throw $matchFail("src/data/strx.pf", 375);
      })($field(Compat, "uncons")(chars));
    }
    function dropWhile(s, pred) {
      return dropWhileLoop($split(s, ""), pred);
    }
    function nullOrEmpty(s) {
      return $eqI($length(s), 0);
    }
    function quote(s) {
      return $concatS($concatS("\"", s), "\"");
    }
    function indentLine(spaces, line) {
      return $concatS(strRepeat(" ", spaces), line);
    }
    function indent(spaces, text) {
      return $join($map((line) => indentLine(spaces, line), $split(text, "\n")), "\n");
    }
    function joinLines(lines) {
      return $join(lines, "\n");
    }
    function splitLines(text) {
      return $split(text, "\n");
    }
    function padLeft(width, fill, s) {
      const missing = $subI(width, $length(s));
      if ($leI(missing, 0)) {
        return s;
      } else {
        return $concatS(strRepeat(fill, missing), s);
      }
    }
    function padRight(width, fill, s) {
      const missing = $subI(width, $length(s));
      if ($leI(missing, 0)) {
        return s;
      } else {
        return $concatS(s, strRepeat(fill, missing));
      }
    }
    function commaList(items) {
      return $join(items, ", ");
    }
    function surround(prefix, suffix, s) {
      return $concatS($concatS(prefix, s), suffix);
    }
    exports["isWhitespace"] = isWhitespace;
    exports["strRepeat"] = strRepeat;
    exports["trimRight"] = trimRight;
    exports["trimLeft"] = trimLeft;
    exports["trim"] = trim;
    exports["startsWith"] = startsWith;
    exports["endsWith"] = endsWith;
    exports["contains"] = contains;
    exports["indexOf"] = indexOf;
    exports["replace"] = replace;
    exports["replaceAll"] = replaceAll;
    exports["strMatch"] = strMatch;
    exports["replaceMatch"] = replaceMatch;
    exports["takeWhile"] = takeWhile;
    exports["dropWhile"] = dropWhile;
    exports["nullOrEmpty"] = nullOrEmpty;
    exports["quote"] = quote;
    exports["indentLine"] = indentLine;
    exports["indent"] = indent;
    exports["joinLines"] = joinLines;
    exports["splitLines"] = splitLines;
    exports["padLeft"] = padLeft;
    exports["padRight"] = padRight;
    exports["commaList"] = commaList;
    exports["surround"] = surround;
  });
  $registerSchemas([{name: "ErrSev", union: "Severity", fields: [], variant: true}, {name: "WarnSev", union: "Severity", fields: [], variant: true}, {name: "LexD", union: "DiagCode", fields: [], variant: true}, {name: "ParseD", union: "DiagCode", fields: [], variant: true}, {name: "NameD", union: "DiagCode", fields: [], variant: true}, {name: "TypeD", union: "DiagCode", fields: [], variant: true}, {name: "ExhaustD", union: "DiagCode", fields: [], variant: true}, {name: "PurityD", union: "DiagCode", fields: [], variant: true}, {name: "ImportD", union: "DiagCode", fields: [], variant: true}, {name: "ArityD", union: "DiagCode", fields: [], variant: true}, {name: "RuntimeD", union: "DiagCode", fields: [], variant: true}, {name: "Diag", union: null, fields: ["severity", "code", "message", "path", "span", "notes"], variant: false}]);
  $maps["src/check/diag"] = {"../syntax/token": "src/syntax/token", "../data/strx": "src/data/strx", "../data/listx": "src/data/listx", "../compat": "src/compat"};
  $mods["src/check/diag"] = ((exports, $require) => {
    const T = $require("../syntax/token");
    const Strx = $require("../data/strx");
    const Lx = $require("../data/listx");
    const Compat = $require("../compat");
    const ErrSev = $makeVariant("ErrSev", "Severity", [], []);
    const WarnSev = $makeVariant("WarnSev", "Severity", [], []);
    const LexD = $makeVariant("LexD", "DiagCode", [], []);
    const ParseD = $makeVariant("ParseD", "DiagCode", [], []);
    const NameD = $makeVariant("NameD", "DiagCode", [], []);
    const TypeD = $makeVariant("TypeD", "DiagCode", [], []);
    const ExhaustD = $makeVariant("ExhaustD", "DiagCode", [], []);
    const PurityD = $makeVariant("PurityD", "DiagCode", [], []);
    const ImportD = $makeVariant("ImportD", "DiagCode", [], []);
    const ArityD = $makeVariant("ArityD", "DiagCode", [], []);
    const RuntimeD = $makeVariant("RuntimeD", "DiagCode", [], []);
    function diagTypeWitness() {
      const p = $field(T, "mkPos")(1, 1, 0);
      return $makeRecord("Diag", ["severity", "code", "message", "path", "span", "notes"], [ErrSev, ParseD, "", "", $field(T, "mkSpan")(p, p), [""]]);
    }
    function err(code, message, path, span) {
      return $makeRecord("Diag", ["severity", "code", "message", "path", "span", "notes"], [ErrSev, code, message, path, span, []]);
    }
    function warn(code, message, path, span) {
      return $makeRecord("Diag", ["severity", "code", "message", "path", "span", "notes"], [WarnSev, code, message, path, span, []]);
    }
    function note(diag, s) {
      return $makeRecord("Diag", ["severity", "code", "message", "path", "span", "notes"], [diag.f[0], diag.f[1], diag.f[2], diag.f[3], diag.f[4], $field(Lx, "concat")([diag.f[5], [s]])]);
    }
    function sevWord(severity) {
      return (($match$74) => {
        if ($match$74.$t === "ErrSev") {
          return "error";
        }
        if ($match$74.$t === "WarnSev") {
          return "warning";
        }
        throw $matchFail("src/check/diag.pf", 74);
      })(severity);
    }
    function codeLabel(code) {
      return (($match$80) => {
        if ($match$80.$t === "LexD") {
          return "Lex";
        }
        if ($match$80.$t === "ParseD") {
          return "Parse";
        }
        if ($match$80.$t === "NameD") {
          return "Name";
        }
        if ($match$80.$t === "TypeD") {
          return "Type";
        }
        if ($match$80.$t === "ExhaustD") {
          return "Exhaust";
        }
        if ($match$80.$t === "PurityD") {
          return "Purity";
        }
        if ($match$80.$t === "ImportD") {
          return "Import";
        }
        if ($match$80.$t === "ArityD") {
          return "Arity";
        }
        if ($match$80.$t === "RuntimeD") {
          return "Runtime";
        }
        throw $matchFail("src/check/diag.pf", 80);
      })(code);
    }
    function renderHeader(diag) {
      return $concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS(diag.f[3], ":"), $str($field(diag.f[4].f[0], "line"))), ":"), $str($field(diag.f[4].f[0], "col"))), ": "), sevWord(diag.f[0])), "["), codeLabel(diag.f[1])), "]: "), diag.f[2]);
    }
    function minInt(a, b) {
      if ($ltI(a, b)) {
        return a;
      } else {
        return b;
      }
    }
    function maxInt(a, b) {
      if ($gtI(a, b)) {
        return a;
      } else {
        return b;
      }
    }
    function pick(cond, a, b) {
      if (cond) {
        return a;
      } else {
        return b;
      }
    }
    function renderSnippet(span, sourceText) {
      const startP = span.f[0];
      const endP = span.f[1];
      const srcLines = $split(sourceText, "\n");
      return (($match$170) => {
        if ($match$170.$t === "None") {
          return [];
        }
        if ($match$170.$t === "Some") {
          const lt = $match$170;
          return (() => {
            const text = $field(Strx, "trimRight")(lt.f[0]);
            const lineLen = $length(text);
            const padN = minInt($subI($field(startP, "col"), 1), lineLen);
            const multi = $field(endP, "line") > $field(startP, "line");
            const spanEndCol = pick(multi, $addI(lineLen, 1), $field(endP, "col"));
            const width = maxInt(1, $subI(minInt(spanEndCol, $addI(lineLen, 1)), $addI(padN, 1)));
            const marks = $field(Strx, "strRepeat")("^", width);
            const cont = pick(multi, $concatS($concatS(" (span continues for ", $str($subI($field(endP, "line"), $field(startP, "line")))), " more lines)"), "");
            return [$concatS("  ", text), $concatS($concatS($concatS("  ", $field(Strx, "strRepeat")(" ", padN)), marks), cont)];
          })();
        }
        throw $matchFail("src/check/diag.pf", 170);
      })($field(Compat, "listAt")(srcLines, $subI($field(startP, "line"), 1)));
    }
    function renderNotes(notes) {
      return $field(Lx, "concat")([[], $map((s) => $concatS("  note: ", s), notes)]);
    }
    function renderDiag(diag, sourceOf) {
      const headerLine = [renderHeader(diag)];
      const snippet = (($match$288) => {
        if ($match$288.$t === "None") {
          return [];
        }
        if ($match$288.$t === "Some") {
          const src = $match$288;
          return renderSnippet(diag.f[4], src.f[0]);
        }
        throw $matchFail("src/check/diag.pf", 288);
      })(sourceOf(diag.f[3]));
      return $join($field(Lx, "concat")([headerLine, snippet, renderNotes(diag.f[5])]), "\n");
    }
    function diagCmp(a, b) {
      if ($field(a, "path") < $field(b, "path")) {
        return $subI(0, 1);
      } else {
        if ($field(b, "path") < $field(a, "path")) {
          return 1;
        } else {
          if ($field($field($field(a, "span"), "start"), "offset") < $field($field($field(b, "span"), "start"), "offset")) {
            return $subI(0, 1);
          } else {
            if ($field($field($field(b, "span"), "start"), "offset") < $field($field($field(a, "span"), "start"), "offset")) {
              return 1;
            } else {
              return 0;
            }
          }
        }
      }
    }
    function renderAll(diags, sourceOf) {
      const ordered = $field(Lx, "sortBy")(diagCmp, diags);
      return $join($map((d) => renderDiag(d, sourceOf), ordered), "\n\n");
    }
    const diagSigPos = $field(T, "mkPos")(1, 1, 0);
    const diagSigSpan = $field(T, "mkSpan")(diagSigPos, diagSigPos);
    const diagSigValue = $makeRecord("Diag", ["severity", "code", "message", "path", "span", "notes"], [ErrSev, ParseD, "", "witness.pf", diagSigSpan, [""]]);
    const diagSigValues = [diagSigValue];
    function diagSigCtor(code, message, path, span) {
      const codes = [ParseD, code];
      const messages = ["", message];
      const paths = ["", path];
      const spans = [diagSigSpan, span];
      return diagSigValue;
    }
    const diagSigCtorFns = [diagSigCtor, err, warn];
    function diagSigNote(diag, text) {
      const diags = [diagSigValue, diag];
      const texts = ["", text];
      return diagSigValue;
    }
    const diagSigNoteFns = [diagSigNote, note];
    function diagSigSource(path) {
      const paths = ["", path];
      return $makeVariant("Some", "Option", ["value"], [""]);
    }
    function diagSigRenderOne(diag, sourceOf) {
      const diags = [diagSigValue, diag];
      const sources = [diagSigSource, sourceOf];
      return "";
    }
    const diagSigRenderOneFns = [diagSigRenderOne, renderDiag];
    function diagSigRenderMany(diags, sourceOf) {
      const diagLists = [diagSigValues, diags];
      const sources = [diagSigSource, sourceOf];
      return "";
    }
    const diagSigRenderManyFns = [diagSigRenderMany, renderAll];
    exports["ErrSev"] = ErrSev;
    exports["WarnSev"] = WarnSev;
    exports["LexD"] = LexD;
    exports["ParseD"] = ParseD;
    exports["NameD"] = NameD;
    exports["TypeD"] = TypeD;
    exports["ExhaustD"] = ExhaustD;
    exports["PurityD"] = PurityD;
    exports["ImportD"] = ImportD;
    exports["ArityD"] = ArityD;
    exports["RuntimeD"] = RuntimeD;
    exports["err"] = err;
    exports["warn"] = warn;
    exports["note"] = note;
    exports["renderDiag"] = renderDiag;
    exports["renderAll"] = renderAll;
  });
  $registerSchemas([{name: "LexSt", union: null, fields: ["path", "src", "len", "offset", "line", "col", "acc"], variant: false}, {name: "LexTok", union: "LexStep", fields: ["st", "token"], variant: true}, {name: "LexSkip", union: "LexStep", fields: ["st"], variant: true}, {name: "LexDone", union: "LexStep", fields: ["st"], variant: true}, {name: "LexFail", union: "LexStep", fields: ["diag"], variant: true}, {name: "LexOk", union: "LexResult", fields: ["tokens"], variant: true}, {name: "LexErr", union: "LexResult", fields: ["diags"], variant: true}, {name: "FmtSkipOk", union: "FmtSkip", fields: ["st", "text"], variant: true}, {name: "FmtSkipFail", union: "FmtSkip", fields: ["diag"], variant: true}]);
  $maps["src/syntax/lexer"] = {"./token": "src/syntax/token", "../check/diag": "src/check/diag"};
  $mods["src/syntax/lexer"] = ((exports, $require) => {
    const T = $require("./token");
    const D = $require("../check/diag");
    function LexTok(st, token) {
      return $makeVariant("LexTok", "LexStep", ["st", "token"], [st, token]);
    }
    function LexSkip(st) {
      return $makeVariant("LexSkip", "LexStep", ["st"], [st]);
    }
    function LexDone(st) {
      return $makeVariant("LexDone", "LexStep", ["st"], [st]);
    }
    function LexFail(diag) {
      return $makeVariant("LexFail", "LexStep", ["diag"], [diag]);
    }
    function LexOk(tokens) {
      return $makeVariant("LexOk", "LexResult", ["tokens"], [tokens]);
    }
    function LexErr(diags) {
      return $makeVariant("LexErr", "LexResult", ["diags"], [diags]);
    }
    function posOf(st) {
      return $field(T, "mkPos")(st.f[4], st.f[5], st.f[3]);
    }
    function spanFrom(startPos, st) {
      return $field(T, "mkSpan")(startPos, posOf(st));
    }
    function withOffset(st, offset, line, col) {
      return $makeRecord("LexSt", ["path", "src", "len", "offset", "line", "col", "acc"], [st.f[0], st.f[1], st.f[2], offset, line, col, st.f[6]]);
    }
    function withAcc(st, acc) {
      return $makeRecord("LexSt", ["path", "src", "len", "offset", "line", "col", "acc"], [st.f[0], st.f[1], st.f[2], st.f[3], st.f[4], st.f[5], acc]);
    }
    function addToken(st, token) {
      return withAcc(st, $cons(token, st.f[6]));
    }
    function charAt(src, len, i) {
      if ($ltI(i, 0)) {
        return $makeVariant("None", "Option", [], []);
      } else {
        if ($geI(i, len)) {
          return $makeVariant("None", "Option", [], []);
        } else {
          return $makeVariant("Some", "Option", ["value"], [$slice(i, 1, src)]);
        }
      }
    }
    function current(st) {
      return charAt(st.f[1], st.f[2], st.f[3]);
    }
    function charAtOffset(st, delta) {
      return charAt($field(st, "src"), $field(st, "len"), $addI($field(st, "offset"), delta));
    }
    function advanceOne(st) {
      return (($match$109) => {
        if ($match$109.$t === "None") {
          return st;
        }
        if ($match$109.$t === "Some") {
          const c = $match$109;
          return (() => {
            if (c.f[0] === "\n") {
              return withOffset(st, $addI(st.f[3], 1), $addI(st.f[4], 1), 1);
            } else {
              return withOffset(st, $addI(st.f[3], 1), st.f[4], $addI(st.f[5], 1));
            }
          })();
        }
        throw $matchFail("src/syntax/lexer.pf", 109);
      })(current(st));
    }
    function advanceN(st, n) {
      while (true) {
        if ($leI(n, 0)) {
          return st;
        } else {
          const $tc$161$0 = advanceOne(st);
          const $tc$161$1 = $subI(n, 1);
          st = $tc$161$0;
          n = $tc$161$1;
          continue;
        }
      }
    }
    function textAt(src, len, offset, n) {
      if ($ltI(offset, 0)) {
        return "";
      } else {
        if ($gtI($addI(offset, n), len)) {
          return "";
        } else {
          return $slice(offset, n, src);
        }
      }
    }
    function startsWithAt(src, len, offset, needle) {
      const n = $length(needle);
      if ($ltI(offset, 0)) {
        return false;
      } else {
        if ($gtI($addI(offset, n), len)) {
          return false;
        } else {
          return $eq($slice(offset, n, src), needle);
        }
      }
    }
    function startsWith(st, needle) {
      return startsWithAt(st.f[1], st.f[2], st.f[3], needle);
    }
    function lexDiagAt(st, startPos, message) {
      return $field(D, "err")($makeVariant("LexD", "DiagCode", [], []), message, st.f[0], $field(T, "mkSpan")(startPos, posOf(st)));
    }
    function lexDiagPoint(st, message) {
      const p = posOf(st);
      return $field(D, "err")($makeVariant("LexD", "DiagCode", [], []), message, st.f[0], $field(T, "pointSpan")(p));
    }
    function isDigit(c) {
      return c >= "0" && c <= "9";
    }
    function isLower(c) {
      return c >= "a" && c <= "z";
    }
    function isUpper(c) {
      return c >= "A" && c <= "Z";
    }
    function isAlpha(c) {
      return isLower(c) || isUpper(c);
    }
    function isIdentStart(c) {
      return isAlpha(c) || c === "_";
    }
    function isIdentPart(c) {
      return isIdentStart(c) || isDigit(c);
    }
    function isHexDigit(c) {
      return isDigit(c) || c >= "a" && c <= "f" || c >= "A" && c <= "F";
    }
    function isWs(c) {
      return c === " " || c === "\t" || c === "\n" || c === $str($chrU(13));
    }
    function digitVal(c) {
      if (c === "0") {
        return 0;
      } else {
        if (c === "1") {
          return 1;
        } else {
          if (c === "2") {
            return 2;
          } else {
            if (c === "3") {
              return 3;
            } else {
              if (c === "4") {
                return 4;
              } else {
                if (c === "5") {
                  return 5;
                } else {
                  if (c === "6") {
                    return 6;
                  } else {
                    if (c === "7") {
                      return 7;
                    } else {
                      if (c === "8") {
                        return 8;
                      } else {
                        if (c === "9") {
                          return 9;
                        } else {
                          return 0;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    function hexVal(c) {
      if (isDigit(c)) {
        return digitVal(c);
      } else {
        if (c === "a" || c === "A") {
          return 10;
        } else {
          if (c === "b" || c === "B") {
            return 11;
          } else {
            if (c === "c" || c === "C") {
              return 12;
            } else {
              if (c === "d" || c === "D") {
                return 13;
              } else {
                if (c === "e" || c === "E") {
                  return 14;
                } else {
                  if (c === "f" || c === "F") {
                    return 15;
                  } else {
                    return 0;
                  }
                }
              }
            }
          }
        }
      }
    }
    function parseDecFrom(text, i, acc) {
      while (true) {
        if ($geI(i, $length(text))) {
          return acc;
        } else {
          const $tc$512$0 = text;
          const $tc$512$1 = $addI(i, 1);
          const $tc$512$2 = $addI($mulI(acc, 10), digitVal($slice(i, 1, text)));
          text = $tc$512$0;
          i = $tc$512$1;
          acc = $tc$512$2;
          continue;
        }
      }
    }
    function parseDec(text) {
      return parseDecFrom(text, 0, 0);
    }
    function parseHexFrom(text, i, acc) {
      while (true) {
        if ($geI(i, $length(text))) {
          return acc;
        } else {
          const $tc$546$0 = text;
          const $tc$546$1 = $addI(i, 1);
          const $tc$546$2 = $addI($mulI(acc, 16), hexVal($slice(i, 1, text)));
          text = $tc$546$0;
          i = $tc$546$1;
          acc = $tc$546$2;
          continue;
        }
      }
    }
    function parseHex(text) {
      return parseHexFrom(text, 0, 0);
    }
    function scanWhile(st, pred) {
      return (($match$557) => {
        if ($match$557.$t === "None") {
          return st;
        }
        if ($match$557.$t === "Some") {
          const c = $match$557;
          return (() => {
            if (pred(c.f[0])) {
              return scanWhile(advanceOne(st), pred);
            } else {
              return st;
            }
          })();
        }
        throw $matchFail("src/syntax/lexer.pf", 557);
      })(current(st));
    }
    function scanRequiredDigits(st) {
      return scanWhile(st, isDigit);
    }
    function scanRequiredHexDigits(st) {
      return scanWhile(st, isHexDigit);
    }
    function isKeywordText(s) {
      return s === "let" || s === "var" || s === "type" || s === "generic" || s === "if" || s === "then" || s === "else" || s === "function" || s === "proc" || s === "memo" || s === "async" || s === "await" || s === "return" || s === "fn" || s === "for" || s === "while" || s === "dict" || s === "array" || s === "import" || s === "export" || s === "as" || s === "from" || s === "match" || s === "with" || s === "where" || s === "extern" || s === "opaque" || s === "lazy";
    }
    function twoCharOp(st) {
      const two = textAt(st.f[1], st.f[2], st.f[3], 2);
      if (two === "==" || two === "!=" || two === "<=" || two === ">=" || two === "&&" || two === "||" || two === "++" || two === "<<" || two === ">>" || two === "|>" || two === "->" || two === "=>" || two === "<-") {
        return $makeVariant("Some", "Option", ["value"], [two]);
      } else {
        return $makeVariant("None", "Option", [], []);
      }
    }
    function isSingleOp(c) {
      return c === "+" || c === "-" || c === "*" || c === "/" || c === "%" || c === "=" || c === "<" || c === ">" || c === "!" || c === "&" || c === "|" || c === "(" || c === ")" || c === "{" || c === "}" || c === "[" || c === "]" || c === "," || c === ";" || c === ":" || c === "?" || c === ".";
    }
    function lex(path, source) {
      const st = $makeRecord("LexSt", ["path", "src", "len", "offset", "line", "col", "acc"], [path, source, $length(source), 0, 1, 1, []]);
      return scan(st);
    }
    function scan(st) {
      while (true) {
        const st1 = skipTrivia(st);
        const $match$882 = step(st1);
        if ($match$882.$t === "LexDone") {
          const d = $match$882;
          return (() => {
            const eof = $field(T, "eofToken")(posOf(d.f[0]));
            return $makeVariant("LexOk", "LexResult", ["tokens"], [$reverse($cons(eof, d.f[0].f[6]))]);
          })();
        }
        if ($match$882.$t === "LexTok") {
          const t = $match$882;
          const $tc$912$0 = addToken(t.f[0], t.f[1]);
          st = $tc$912$0;
          continue;
        }
        if ($match$882.$t === "LexSkip") {
          const s = $match$882;
          const $tc$916$0 = s.f[0];
          st = $tc$916$0;
          continue;
        }
        if ($match$882.$t === "LexFail") {
          const f = $match$882;
          return $makeVariant("LexErr", "LexResult", ["diags"], [[f.f[0]]]);
        }
        throw $matchFail("src/syntax/lexer.pf", 882);
      }
    }
    function step(st) {
      return (($match$923) => {
        if ($match$923.$t === "None") {
          return $makeVariant("LexDone", "LexStep", ["st"], [st]);
        }
        if ($match$923.$t === "Some") {
          const c = $match$923;
          return (() => {
            if (startsWith(st, "/*")) {
              return scanBlockComment(st);
            } else {
              if (startsWith(st, "@\"")) {
                return scanRawString(st);
              } else {
                if (startsWith(st, "$\"")) {
                  return scanFormatString(st);
                } else {
                  if (c.f[0] === "\"") {
                    return scanString(st);
                  } else {
                    if (c.f[0] === "'") {
                      return scanCharLiteral(st);
                    } else {
                      if (isDigit(c.f[0])) {
                        return scanNumber(st);
                      } else {
                        if (isIdentStart(c.f[0])) {
                          return scanIdentOrKw(st);
                        } else {
                          return scanOperatorOrFail(st);
                        }
                      }
                    }
                  }
                }
              }
            }
          })();
        }
        throw $matchFail("src/syntax/lexer.pf", 923);
      })(current(st));
    }
    function skipLineComment(st) {
      return (($match$999) => {
        if ($match$999.$t === "None") {
          return st;
        }
        if ($match$999.$t === "Some") {
          const c = $match$999;
          return (() => {
            if (c.f[0] === "\n") {
              return st;
            } else {
              return skipLineComment(advanceOne(st));
            }
          })();
        }
        throw $matchFail("src/syntax/lexer.pf", 999);
      })(current(st));
    }
    function skipTrivia(st) {
      return (($match$1020) => {
        if ($match$1020.$t === "None") {
          return st;
        }
        if ($match$1020.$t === "Some") {
          const c = $match$1020;
          return (() => {
            if (isWs(c.f[0])) {
              return skipTrivia(advanceOne(st));
            } else {
              if (startsWith(st, "//")) {
                return skipTrivia(skipLineComment(advanceN(st, 2)));
              } else {
                return st;
              }
            }
          })();
        }
        throw $matchFail("src/syntax/lexer.pf", 1020);
      })(current(st));
    }
    function blockCommentLoop(startPos, st) {
      while (true) {
        if (startsWith(st, "*/")) {
          return $makeVariant("LexSkip", "LexStep", ["st"], [advanceN(st, 2)]);
        } else {
          const $match$1065 = current(st);
          if ($match$1065.$t === "None") {
            return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(st, startPos, "Unterminated block comment.")]);
          }
          if ($match$1065.$t === "Some") {
            const $tc$1080$0 = startPos;
            const $tc$1080$1 = advanceOne(st);
            startPos = $tc$1080$0;
            st = $tc$1080$1;
            continue;
          }
          throw $matchFail("src/syntax/lexer.pf", 1065);
        }
      }
    }
    function scanBlockComment(st) {
      return blockCommentLoop(posOf(st), advanceN(st, 2));
    }
    function scanHexNumber(st) {
      const start = posOf(st);
      const digitsStart = $addI(st.f[3], 2);
      const afterPrefix = advanceN(st, 2);
      const afterDigits = scanRequiredHexDigits(afterPrefix);
      if ($eqI(afterDigits.f[3], digitsStart)) {
        return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(afterDigits, start, "Expected hexadecimal digits after 0x.")]);
      } else {
        const digits = $slice(digitsStart, $subI(afterDigits.f[3], digitsStart), st.f[1]);
        const value = parseHex(digits);
        if (startsWith(afterDigits, "_b")) {
          const fin = advanceN(afterDigits, 2);
          if ($gtI(value, 255)) {
            return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(fin, start, "Byte literal is outside 0..255.")]);
          } else {
            return $makeVariant("LexTok", "LexStep", ["st", "token"], [fin, $field(T, "byteTok")(value, spanFrom(start, fin))]);
          }
        } else {
          return $makeVariant("LexTok", "LexStep", ["st", "token"], [afterDigits, $field(T, "intTok")(value, spanFrom(start, afterDigits))]);
        }
      }
    }
    function skipExpSign(stp) {
      if (startsWith(stp, "+") || startsWith(stp, "-")) {
        return advanceOne(stp);
      } else {
        return stp;
      }
    }
    function scanFracIfPresent(hasFrac, afterWhole) {
      if (hasFrac) {
        return scanRequiredDigits(advanceOne(afterWhole));
      } else {
        return afterWhole;
      }
    }
    function scanExponent(afterMantissa) {
      if (startsWith(afterMantissa, "e") || startsWith(afterMantissa, "E")) {
        const epos = posOf(afterMantissa);
        const afterE = advanceOne(afterMantissa);
        const afterSign = skipExpSign(afterE);
        const afterDigits = scanRequiredDigits(afterSign);
        if ($eqI(afterDigits.f[3], afterSign.f[3])) {
          return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(afterDigits, epos, "Expected digits in exponent.")]);
        } else {
          return $makeVariant("LexSkip", "LexStep", ["st"], [afterDigits]);
        }
      } else {
        return $makeVariant("LexSkip", "LexStep", ["st"], [afterMantissa]);
      }
    }
    function scanDecimalNumber(st) {
      const start = posOf(st);
      const digitsStart = st.f[3];
      const afterWhole = scanRequiredDigits(st);
      const hasFrac = startsWith(afterWhole, ".") && (($match$1272) => {
        if ($match$1272.$t === "None") {
          return false;
        }
        if ($match$1272.$t === "Some") {
          const d = $match$1272;
          return isDigit(d.f[0]);
        }
        throw $matchFail("src/syntax/lexer.pf", 1272);
      })(charAt(afterWhole.f[1], afterWhole.f[2], $addI(afterWhole.f[3], 1)));
      const afterMantissa = scanFracIfPresent(hasFrac, afterWhole);
      return (($match$1295) => {
        if ($match$1295.$t === "LexFail") {
          const f = $match$1295;
          return $makeVariant("LexFail", "LexStep", ["diag"], [f.f[0]]);
        }
        if ($match$1295.$t === "LexSkip") {
          const expOut = $match$1295;
          return (() => {
            const fin = expOut.f[0];
            const isFloat = hasFrac || $gtI(fin.f[3], afterMantissa.f[3]);
            const text = $slice(digitsStart, $subI(fin.f[3], digitsStart), st.f[1]);
            if (isFloat) {
              return $makeVariant("LexTok", "LexStep", ["st", "token"], [fin, $field(T, "floatTok")(text, spanFrom(start, fin))]);
            } else {
              if (startsWith(fin, "b")) {
                const byteFin = advanceOne(fin);
                const value = parseDec(text);
                if ($gtI(value, 255)) {
                  return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(byteFin, start, "Byte literal is outside 0..255.")]);
                } else {
                  return $makeVariant("LexTok", "LexStep", ["st", "token"], [byteFin, $field(T, "byteTok")(value, spanFrom(start, byteFin))]);
                }
              } else {
                return $makeVariant("LexTok", "LexStep", ["st", "token"], [fin, $field(T, "intTok")(parseDec(text), spanFrom(start, fin))]);
              }
            }
          })();
        }
        if (true) {
          return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagPoint(st, "Internal lexer error while scanning number.")]);
        }
        throw $matchFail("src/syntax/lexer.pf", 1295);
      })(scanExponent(afterMantissa));
    }
    function scanNumber(st) {
      if (startsWith(st, "0x") || startsWith(st, "0X")) {
        return scanHexNumber(st);
      } else {
        return scanDecimalNumber(st);
      }
    }
    function escapeValue(c) {
      if (c === "n") {
        return $makeVariant("Some", "Option", ["value"], ["\n"]);
      } else {
        if (c === "t") {
          return $makeVariant("Some", "Option", ["value"], ["\t"]);
        } else {
          if (c === "\\") {
            return $makeVariant("Some", "Option", ["value"], ["\\"]);
          } else {
            if (c === "\"") {
              return $makeVariant("Some", "Option", ["value"], ["\""]);
            } else {
              if (c === "'") {
                return $makeVariant("Some", "Option", ["value"], ["'"]);
              } else {
                if (c === "{") {
                  return $makeVariant("Some", "Option", ["value"], ["{"]);
                } else {
                  if (c === "}") {
                    return $makeVariant("Some", "Option", ["value"], ["}"]);
                  } else {
                    return $makeVariant("None", "Option", [], []);
                  }
                }
              }
            }
          }
        }
      }
    }
    function stringLoop(startPos, st, acc) {
      return (($match$1463) => {
        if ($match$1463.$t === "None") {
          return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(st, startPos, "Unterminated string literal.")]);
        }
        if ($match$1463.$t === "Some") {
          const c = $match$1463;
          return (() => {
            if (c.f[0] === "\"") {
              const fin = advanceOne(st);
              return $makeVariant("LexTok", "LexStep", ["st", "token"], [fin, $field(T, "strTok")(acc, spanFrom(startPos, fin))]);
            } else {
              if (c.f[0] === "\n") {
                return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(st, startPos, "Unterminated string literal.")]);
              } else {
                if (c.f[0] === "\\") {
                  const escSt = advanceOne(st);
                  return (($match$1512) => {
                    if ($match$1512.$t === "None") {
                      return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(escSt, startPos, "Unterminated string escape.")]);
                    }
                    if ($match$1512.$t === "Some") {
                      const esc = $match$1512;
                      return (() => {
                        return (($match$1523) => {
                          if ($match$1523.$t === "None") {
                            return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(advanceOne(escSt), posOf(st), "Unknown escape sequence.")]);
                          }
                          if ($match$1523.$t === "Some") {
                            const v = $match$1523;
                            return stringLoop(startPos, advanceOne(escSt), $concatS(acc, v.f[0]));
                          }
                          throw $matchFail("src/syntax/lexer.pf", 1523);
                        })(escapeValue(esc.f[0]));
                      })();
                    }
                    throw $matchFail("src/syntax/lexer.pf", 1512);
                  })(current(escSt));
                } else {
                  return stringLoop(startPos, advanceOne(st), $concatS(acc, c.f[0]));
                }
              }
            }
          })();
        }
        throw $matchFail("src/syntax/lexer.pf", 1463);
      })(current(st));
    }
    function scanString(st) {
      return stringLoop(posOf(st), advanceOne(st), "");
    }
    function rawStringLoop(startPos, st, acc) {
      return (($match$1577) => {
        if ($match$1577.$t === "None") {
          return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(st, startPos, "Unterminated raw string literal.")]);
        }
        if ($match$1577.$t === "Some") {
          const c = $match$1577;
          return (() => {
            if (c.f[0] === "\"") {
              const fin = advanceOne(st);
              return $makeVariant("LexTok", "LexStep", ["st", "token"], [fin, $field(T, "rawStrTok")(acc, spanFrom(startPos, fin))]);
            } else {
              return rawStringLoop(startPos, advanceOne(st), $concatS(acc, c.f[0]));
            }
          })();
        }
        throw $matchFail("src/syntax/lexer.pf", 1577);
      })(current(st));
    }
    function scanRawString(st) {
      return rawStringLoop(posOf(st), advanceN(st, 2), "");
    }
    function charPayload(startPos, st) {
      return (($match$1633) => {
        if ($match$1633.$t === "None") {
          return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(st, startPos, "Unterminated character literal.")]);
        }
        if ($match$1633.$t === "Some") {
          const c = $match$1633;
          return (() => {
            if (c.f[0] === "\n") {
              return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(st, startPos, "Unterminated character literal.")]);
            } else {
              if (c.f[0] === "'") {
                return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(advanceOne(st), startPos, "Empty character literal.")]);
              } else {
                if (c.f[0] === "\\") {
                  const escSt = advanceOne(st);
                  return (($match$1676) => {
                    if ($match$1676.$t === "None") {
                      return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(escSt, startPos, "Unterminated character escape.")]);
                    }
                    if ($match$1676.$t === "Some") {
                      const esc = $match$1676;
                      return (() => {
                        return (($match$1687) => {
                          if ($match$1687.$t === "None") {
                            return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(advanceOne(escSt), posOf(st), "Unknown character escape.")]);
                          }
                          if ($match$1687.$t === "Some") {
                            const v = $match$1687;
                            return $makeVariant("LexTok", "LexStep", ["st", "token"], [advanceOne(escSt), $field(T, "charTok")(v.f[0], $field(T, "pointSpan")(posOf(st)))]);
                          }
                          throw $matchFail("src/syntax/lexer.pf", 1687);
                        })(escapeValue(esc.f[0]));
                      })();
                    }
                    throw $matchFail("src/syntax/lexer.pf", 1676);
                  })(current(escSt));
                } else {
                  return $makeVariant("LexTok", "LexStep", ["st", "token"], [advanceOne(st), $field(T, "charTok")(c.f[0], $field(T, "pointSpan")(posOf(st)))]);
                }
              }
            }
          })();
        }
        throw $matchFail("src/syntax/lexer.pf", 1633);
      })(current(st));
    }
    function scanCharLiteral(st) {
      const start = posOf(st);
      const body = advanceOne(st);
      return (($match$1748) => {
        if ($match$1748.$t === "LexFail") {
          const f = $match$1748;
          return $makeVariant("LexFail", "LexStep", ["diag"], [f.f[0]]);
        }
        if ($match$1748.$t === "LexTok") {
          const p = $match$1748;
          return (() => {
            return (($match$1757) => {
              if ($match$1757.$t === "None") {
                return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(p.f[0], start, "Unterminated character literal.")]);
              }
              if ($match$1757.$t === "Some") {
                const close = $match$1757;
                return (() => {
                  if (close.f[0] === "'") {
                    const fin = advanceOne(p.f[0]);
                    return $makeVariant("LexTok", "LexStep", ["st", "token"], [fin, $field(T, "charTok")($field(T, "tokenPayload")(p.f[1]), spanFrom(start, fin))]);
                  } else {
                    return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(p.f[0], start, "Character literal contains more than one character.")]);
                  }
                })();
              }
              throw $matchFail("src/syntax/lexer.pf", 1757);
            })(current(p.f[0]));
          })();
        }
        if (true) {
          return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(st, start, "Invalid character literal.")]);
        }
        throw $matchFail("src/syntax/lexer.pf", 1748);
      })(charPayload(start, body));
    }
    function FmtSkipOk(st, text) {
      return $makeVariant("FmtSkipOk", "FmtSkip", ["st", "text"], [st, text]);
    }
    function FmtSkipFail(diag) {
      return $makeVariant("FmtSkipFail", "FmtSkip", ["diag"], [diag]);
    }
    function fmtSkipString(startPos, st, acc) {
      return (($match$1813) => {
        if ($match$1813.$t === "None") {
          return $makeVariant("FmtSkipFail", "FmtSkip", ["diag"], [lexDiagAt(st, startPos, "Unterminated string literal in interpolation.")]);
        }
        if ($match$1813.$t === "Some") {
          const c = $match$1813;
          return (() => {
            if (c.f[0] === "\"") {
              return $makeVariant("FmtSkipOk", "FmtSkip", ["st", "text"], [advanceOne(st), $concatS(acc, c.f[0])]);
            } else {
              if (c.f[0] === "\n") {
                return $makeVariant("FmtSkipFail", "FmtSkip", ["diag"], [lexDiagAt(st, startPos, "Unterminated string literal in interpolation.")]);
              } else {
                if (c.f[0] === "\\") {
                  const escSt = advanceOne(st);
                  return (($match$1856) => {
                    if ($match$1856.$t === "None") {
                      return $makeVariant("FmtSkipFail", "FmtSkip", ["diag"], [lexDiagAt(escSt, startPos, "Unterminated string escape in interpolation.")]);
                    }
                    if ($match$1856.$t === "Some") {
                      const esc = $match$1856;
                      return fmtSkipString(startPos, advanceOne(escSt), $concatS($concatS(acc, "\\"), esc.f[0]));
                    }
                    throw $matchFail("src/syntax/lexer.pf", 1856);
                  })(current(escSt));
                } else {
                  return fmtSkipString(startPos, advanceOne(st), $concatS(acc, c.f[0]));
                }
              }
            }
          })();
        }
        throw $matchFail("src/syntax/lexer.pf", 1813);
      })(current(st));
    }
    function fmtSkipRawString(startPos, st, acc) {
      return (($match$1895) => {
        if ($match$1895.$t === "None") {
          return $makeVariant("FmtSkipFail", "FmtSkip", ["diag"], [lexDiagAt(st, startPos, "Unterminated raw string literal in interpolation.")]);
        }
        if ($match$1895.$t === "Some") {
          const c = $match$1895;
          return (() => {
            if (c.f[0] === "\"") {
              return $makeVariant("FmtSkipOk", "FmtSkip", ["st", "text"], [advanceOne(st), $concatS(acc, c.f[0])]);
            } else {
              return fmtSkipRawString(startPos, advanceOne(st), $concatS(acc, c.f[0]));
            }
          })();
        }
        throw $matchFail("src/syntax/lexer.pf", 1895);
      })(current(st));
    }
    function fmtSkipChar(startPos, st, acc) {
      return (($match$1933) => {
        if ($match$1933.$t === "None") {
          return $makeVariant("FmtSkipFail", "FmtSkip", ["diag"], [lexDiagAt(st, startPos, "Unterminated character literal in interpolation.")]);
        }
        if ($match$1933.$t === "Some") {
          const c = $match$1933;
          return (() => {
            if (c.f[0] === "\\") {
              const escSt = advanceOne(st);
              return (($match$1952) => {
                if ($match$1952.$t === "None") {
                  return $makeVariant("FmtSkipFail", "FmtSkip", ["diag"], [lexDiagAt(escSt, startPos, "Unterminated character escape in interpolation.")]);
                }
                if ($match$1952.$t === "Some") {
                  const esc = $match$1952;
                  return fmtSkipCharClose(advanceOne(escSt), $concatS($concatS(acc, "\\"), esc.f[0]));
                }
                throw $matchFail("src/syntax/lexer.pf", 1952);
              })(current(escSt));
            } else {
              return fmtSkipCharClose(advanceOne(st), $concatS(acc, c.f[0]));
            }
          })();
        }
        throw $matchFail("src/syntax/lexer.pf", 1933);
      })(current(st));
    }
    function fmtSkipCharClose(st, acc) {
      return (($match$1987) => {
        if ($match$1987.$t === "None") {
          return $makeVariant("FmtSkipOk", "FmtSkip", ["st", "text"], [st, acc]);
        }
        if ($match$1987.$t === "Some") {
          const c = $match$1987;
          return (() => {
            if (c.f[0] === "'") {
              return $makeVariant("FmtSkipOk", "FmtSkip", ["st", "text"], [advanceOne(st), $concatS(acc, c.f[0])]);
            } else {
              return $makeVariant("FmtSkipOk", "FmtSkip", ["st", "text"], [st, acc]);
            }
          })();
        }
        throw $matchFail("src/syntax/lexer.pf", 1987);
      })(current(st));
    }
    function fmtLoop(startPos, st, acc, depth) {
      return (($match$2015) => {
        if ($match$2015.$t === "None") {
          return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(st, startPos, "Unterminated format string literal.")]);
        }
        if ($match$2015.$t === "Some") {
          const c = $match$2015;
          return (() => {
            if ($eqI(depth, 0) && c.f[0] === "\"") {
              const fin = advanceOne(st);
              return $makeVariant("LexTok", "LexStep", ["st", "token"], [fin, $field(T, "fmtStrTok")(acc, spanFrom(startPos, fin))]);
            } else {
              if (c.f[0] === "\\") {
                const escSt = advanceOne(st);
                return (($match$2057) => {
                  if ($match$2057.$t === "None") {
                    return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(escSt, startPos, "Unterminated format string escape.")]);
                  }
                  if ($match$2057.$t === "Some") {
                    const esc = $match$2057;
                    return fmtLoop(startPos, advanceOne(escSt), $concatS($concatS(acc, "\\"), esc.f[0]), depth);
                  }
                  throw $matchFail("src/syntax/lexer.pf", 2057);
                })(current(escSt));
              } else {
                if ($gtI(depth, 0) && startsWith(st, "$\"")) {
                  return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(advanceN(st, 2), posOf(st), "Nested format strings inside interpolation are not allowed.")]);
                } else {
                  if ($gtI(depth, 0) && startsWith(st, "@\"")) {
                    return (($match$2109) => {
                      if ($match$2109.$t === "FmtSkipFail") {
                        const f = $match$2109;
                        return $makeVariant("LexFail", "LexStep", ["diag"], [f.f[0]]);
                      }
                      if ($match$2109.$t === "FmtSkipOk") {
                        const skip = $match$2109;
                        return fmtLoop(startPos, skip.f[0], $concatS(acc, skip.f[1]), depth);
                      }
                      throw $matchFail("src/syntax/lexer.pf", 2109);
                    })(fmtSkipRawString(startPos, advanceN(st, 2), "@\""));
                  } else {
                    if ($gtI(depth, 0) && c.f[0] === "\"") {
                      return (($match$2140) => {
                        if ($match$2140.$t === "FmtSkipFail") {
                          const f = $match$2140;
                          return $makeVariant("LexFail", "LexStep", ["diag"], [f.f[0]]);
                        }
                        if ($match$2140.$t === "FmtSkipOk") {
                          const skip = $match$2140;
                          return fmtLoop(startPos, skip.f[0], $concatS(acc, skip.f[1]), depth);
                        }
                        throw $matchFail("src/syntax/lexer.pf", 2140);
                      })(fmtSkipString(startPos, advanceOne(st), "\""));
                    } else {
                      if ($gtI(depth, 0) && c.f[0] === "'") {
                        return (($match$2170) => {
                          if ($match$2170.$t === "FmtSkipFail") {
                            const f = $match$2170;
                            return $makeVariant("LexFail", "LexStep", ["diag"], [f.f[0]]);
                          }
                          if ($match$2170.$t === "FmtSkipOk") {
                            const skip = $match$2170;
                            return fmtLoop(startPos, skip.f[0], $concatS(acc, skip.f[1]), depth);
                          }
                          throw $matchFail("src/syntax/lexer.pf", 2170);
                        })(fmtSkipChar(startPos, advanceOne(st), "'"));
                      } else {
                        if (c.f[0] === "{") {
                          return fmtLoop(startPos, advanceOne(st), $concatS(acc, c.f[0]), $addI(depth, 1));
                        } else {
                          if (c.f[0] === "}") {
                            if ($leI(depth, 0)) {
                              return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(advanceOne(st), posOf(st), "Unmatched '}' in format string.")]);
                            } else {
                              return fmtLoop(startPos, advanceOne(st), $concatS(acc, c.f[0]), $subI(depth, 1));
                            }
                          } else {
                            return fmtLoop(startPos, advanceOne(st), $concatS(acc, c.f[0]), depth);
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          })();
        }
        throw $matchFail("src/syntax/lexer.pf", 2015);
      })(current(st));
    }
    function scanFormatString(st) {
      return fmtLoop(posOf(st), advanceN(st, 2), "", 0);
    }
    function scanIdentPart(st) {
      return scanWhile(st, isIdentPart);
    }
    function scanIdentOrKw(st) {
      const start = posOf(st);
      const fin = scanIdentPart(st);
      const text = $slice(st.f[3], $subI(fin.f[3], st.f[3]), st.f[1]);
      if ($eq(text, "true")) {
        return $makeVariant("LexTok", "LexStep", ["st", "token"], [fin, $field(T, "boolTok")(true, spanFrom(start, fin))]);
      } else {
        if ($eq(text, "false")) {
          return $makeVariant("LexTok", "LexStep", ["st", "token"], [fin, $field(T, "boolTok")(false, spanFrom(start, fin))]);
        } else {
          if (isKeywordText(text)) {
            return $makeVariant("LexTok", "LexStep", ["st", "token"], [fin, $field(T, "kwTok")(text, spanFrom(start, fin))]);
          } else {
            return $makeVariant("LexTok", "LexStep", ["st", "token"], [fin, $field(T, "identTok")(text, spanFrom(start, fin))]);
          }
        }
      }
    }
    function scanOperatorOrFail(st) {
      const start = posOf(st);
      return (($match$2365) => {
        if ($match$2365.$t === "Some") {
          const two = $match$2365;
          return (() => {
            const fin = advanceN(st, 2);
            return $makeVariant("LexTok", "LexStep", ["st", "token"], [fin, $field(T, "opTok")(two.f[0], spanFrom(start, fin))]);
          })();
        }
        if ($match$2365.$t === "None") {
          return (() => {
            return (($match$2388) => {
              if ($match$2388.$t === "None") {
                return $makeVariant("LexDone", "LexStep", ["st"], [st]);
              }
              if ($match$2388.$t === "Some") {
                const c = $match$2388;
                return (() => {
                  if (isSingleOp(c.f[0])) {
                    const fin = advanceOne(st);
                    return $makeVariant("LexTok", "LexStep", ["st", "token"], [fin, $field(T, "opTok")(c.f[0], spanFrom(start, fin))]);
                  } else {
                    return $makeVariant("LexFail", "LexStep", ["diag"], [lexDiagAt(advanceOne(st), start, $concatS($concatS("Unexpected character '", c.f[0]), "'."))]);
                  }
                })();
              }
              throw $matchFail("src/syntax/lexer.pf", 2388);
            })(current(st));
          })();
        }
        throw $matchFail("src/syntax/lexer.pf", 2365);
      })(twoCharOp(st));
    }
    exports["LexOk"] = LexOk;
    exports["LexErr"] = LexErr;
    exports["lex"] = lex;
  });
  $registerSchemas([{name: "StrictList", union: "ListMode", fields: [], variant: true}, {name: "LazyList", union: "ListMode", fields: [], variant: true}, {name: "Field", union: null, fields: ["fname", "value"], variant: false}, {name: "GenClause", union: null, fields: ["gvar", "source"], variant: false}, {name: "DictEntry", union: null, fields: ["key", "value"], variant: false}, {name: "PeBind", union: "PatElem", fields: ["pname"], variant: true}, {name: "PeWild", union: "PatElem", fields: [], variant: true}, {name: "PWild", union: "Pattern", fields: [], variant: true}, {name: "PVariant", union: "Pattern", fields: ["vname", "bind"], variant: true}, {name: "PList", union: "Pattern", fields: ["elems", "rest"], variant: true}, {name: "MatchArm", union: null, fields: ["pattern", "guard", "body"], variant: false}, {name: "FmtLit", union: "FmtPart", fields: ["s"], variant: true}, {name: "FmtExpr", union: "FmtPart", fields: ["e"], variant: true}, {name: "EInt", union: "Expr", fields: ["id", "n", "span"], variant: true}, {name: "EFloat", union: "Expr", fields: ["id", "text", "span"], variant: true}, {name: "EBool", union: "Expr", fields: ["id", "b", "span"], variant: true}, {name: "EStr", union: "Expr", fields: ["id", "s", "span"], variant: true}, {name: "EChar", union: "Expr", fields: ["id", "c", "span"], variant: true}, {name: "EByte", union: "Expr", fields: ["id", "b", "span"], variant: true}, {name: "EVar", union: "Expr", fields: ["id", "name", "span"], variant: true}, {name: "EUnary", union: "Expr", fields: ["id", "op", "operand", "span"], variant: true}, {name: "EBinary", union: "Expr", fields: ["id", "op", "lhs", "rhs", "span"], variant: true}, {name: "EIf", union: "Expr", fields: ["id", "cond", "thenE", "elseE", "span"], variant: true}, {name: "ECall", union: "Expr", fields: ["id", "callee", "args", "span"], variant: true}, {name: "ELambda", union: "Expr", fields: ["id", "params", "body", "span"], variant: true}, {name: "EProcLambda", union: "Expr", fields: ["id", "params", "ret", "body", "isAsync", "span"], variant: true}, {name: "EBlock", union: "Expr", fields: ["id", "stmts", "span"], variant: true}, {name: "EList", union: "Expr", fields: ["id", "elems", "mode", "span"], variant: true}, {name: "EComp", union: "Expr", fields: ["id", "body", "gens", "guard", "mode", "span"], variant: true}, {name: "ERecord", union: "Expr", fields: ["id", "tname", "fields", "span"], variant: true}, {name: "EField", union: "Expr", fields: ["id", "object", "fname", "span"], variant: true}, {name: "EIndex", union: "Expr", fields: ["id", "object", "index", "span"], variant: true}, {name: "EMatch", union: "Expr", fields: ["id", "subject", "arms", "span"], variant: true}, {name: "EDict", union: "Expr", fields: ["id", "entries", "span"], variant: true}, {name: "EArray", union: "Expr", fields: ["id", "elems", "span"], variant: true}, {name: "EAwait", union: "Expr", fields: ["id", "value", "span"], variant: true}, {name: "EFmt", union: "Expr", fields: ["id", "parts", "span"], variant: true}, {name: "PureFn", union: "FnKind", fields: ["isMemo", "isGeneric"], variant: true}, {name: "ProcFn", union: "FnKind", fields: ["isAsync", "isGeneric"], variant: true}, {name: "FieldDecl", union: null, fields: ["fname", "isGeneric"], variant: false}, {name: "VariantDecl", union: null, fields: ["vname", "fields"], variant: false}, {name: "RecordDecl", union: "TypeDecl", fields: ["tname", "fields"], variant: true}, {name: "UnionDecl", union: "TypeDecl", fields: ["tname", "variants"], variant: true}, {name: "ImportName", union: null, fields: ["name", "alias"], variant: false}, {name: "INames", union: "ImportSpec", fields: ["names"], variant: true}, {name: "INamespace", union: "ImportSpec", fields: ["alias"], variant: true}, {name: "IStar", union: "ImportSpec", fields: [], variant: true}, {name: "TyName", union: "TypeExpr", fields: ["name", "args"], variant: true}, {name: "TyFun", union: "TypeExpr", fields: ["params", "ret"], variant: true}, {name: "TyProc", union: "TypeExpr", fields: ["params", "ret", "isAsync"], variant: true}, {name: "ExternFunction", union: "ExternKind", fields: [], variant: true}, {name: "ExternProc", union: "ExternKind", fields: ["isAsync"], variant: true}, {name: "TypedParam", union: null, fields: ["name", "typeExpr"], variant: false}, {name: "ExternDecl", union: null, fields: ["kind", "name", "params", "ret", "platform"], variant: false}, {name: "SLet", union: "Stmt", fields: ["id", "name", "init", "span"], variant: true}, {name: "SVar", union: "Stmt", fields: ["id", "name", "init", "span"], variant: true}, {name: "SAssign", union: "Stmt", fields: ["id", "name", "value", "span"], variant: true}, {name: "SIndexAssign", union: "Stmt", fields: ["id", "object", "index", "value", "span"], variant: true}, {name: "SFun", union: "Stmt", fields: ["id", "name", "params", "body", "kind", "span"], variant: true}, {name: "SType", union: "Stmt", fields: ["id", "decl", "isOpaque", "span"], variant: true}, {name: "SExpr", union: "Stmt", fields: ["id", "expr", "span"], variant: true}, {name: "SReturn", union: "Stmt", fields: ["id", "value", "span"], variant: true}, {name: "SIf", union: "Stmt", fields: ["id", "cond", "thenS", "elseS", "span"], variant: true}, {name: "SWhile", union: "Stmt", fields: ["id", "cond", "body", "span"], variant: true}, {name: "SImport", union: "Stmt", fields: ["id", "spec", "rawPath", "span"], variant: true}, {name: "SExport", union: "Stmt", fields: ["id", "inner", "span"], variant: true}, {name: "SExtern", union: "Stmt", fields: ["id", "decl", "span"], variant: true}, {name: "Module", union: null, fields: ["path", "stmts", "nextId"], variant: false}]);
  $maps["src/syntax/ast"] = {"./token": "src/syntax/token"};
  $mods["src/syntax/ast"] = ((exports, $require) => {
    const T = $require("./token");
    const StrictList = $makeVariant("StrictList", "ListMode", [], []);
    const LazyList = $makeVariant("LazyList", "ListMode", [], []);
    function PeBind(pname) {
      return $makeVariant("PeBind", "PatElem", ["pname"], [pname]);
    }
    const PeWild = $makeVariant("PeWild", "PatElem", [], []);
    const PWild = $makeVariant("PWild", "Pattern", [], []);
    function PVariant(vname, bind) {
      return $makeVariant("PVariant", "Pattern", ["vname", "bind"], [vname, bind]);
    }
    function PList(elems, rest) {
      return $makeVariant("PList", "Pattern", ["elems", "rest"], [elems, rest]);
    }
    function FmtLit(s) {
      return $makeVariant("FmtLit", "FmtPart", ["s"], [s]);
    }
    function FmtExpr(e) {
      return $makeVariant("FmtExpr", "FmtPart", ["e"], [e]);
    }
    function EInt(id, n, span) {
      return $makeVariant("EInt", "Expr", ["id", "n", "span"], [id, n, span]);
    }
    function EFloat(id, text, span) {
      return $makeVariant("EFloat", "Expr", ["id", "text", "span"], [id, text, span]);
    }
    function EBool(id, b, span) {
      return $makeVariant("EBool", "Expr", ["id", "b", "span"], [id, b, span]);
    }
    function EStr(id, s, span) {
      return $makeVariant("EStr", "Expr", ["id", "s", "span"], [id, s, span]);
    }
    function EChar(id, c, span) {
      return $makeVariant("EChar", "Expr", ["id", "c", "span"], [id, c, span]);
    }
    function EByte(id, b, span) {
      return $makeVariant("EByte", "Expr", ["id", "b", "span"], [id, b, span]);
    }
    function EVar(id, name, span) {
      return $makeVariant("EVar", "Expr", ["id", "name", "span"], [id, name, span]);
    }
    function EUnary(id, op, operand, span) {
      return $makeVariant("EUnary", "Expr", ["id", "op", "operand", "span"], [id, op, operand, span]);
    }
    function EBinary(id, op, lhs, rhs, span) {
      return $makeVariant("EBinary", "Expr", ["id", "op", "lhs", "rhs", "span"], [id, op, lhs, rhs, span]);
    }
    function EIf(id, cond, thenE, elseE, span) {
      return $makeVariant("EIf", "Expr", ["id", "cond", "thenE", "elseE", "span"], [id, cond, thenE, elseE, span]);
    }
    function ECall(id, callee, args, span) {
      return $makeVariant("ECall", "Expr", ["id", "callee", "args", "span"], [id, callee, args, span]);
    }
    function ELambda(id, params, body, span) {
      return $makeVariant("ELambda", "Expr", ["id", "params", "body", "span"], [id, params, body, span]);
    }
    function EProcLambda(id, params, ret, body, isAsync, span) {
      return $makeVariant("EProcLambda", "Expr", ["id", "params", "ret", "body", "isAsync", "span"], [id, params, ret, body, isAsync, span]);
    }
    function EBlock(id, stmts, span) {
      return $makeVariant("EBlock", "Expr", ["id", "stmts", "span"], [id, stmts, span]);
    }
    function EList(id, elems, mode, span) {
      return $makeVariant("EList", "Expr", ["id", "elems", "mode", "span"], [id, elems, mode, span]);
    }
    function EComp(id, body, gens, guard, mode, span) {
      return $makeVariant("EComp", "Expr", ["id", "body", "gens", "guard", "mode", "span"], [id, body, gens, guard, mode, span]);
    }
    function ERecord(id, tname, fields, span) {
      return $makeVariant("ERecord", "Expr", ["id", "tname", "fields", "span"], [id, tname, fields, span]);
    }
    function EField(id, object, fname, span) {
      return $makeVariant("EField", "Expr", ["id", "object", "fname", "span"], [id, object, fname, span]);
    }
    function EIndex(id, object, index, span) {
      return $makeVariant("EIndex", "Expr", ["id", "object", "index", "span"], [id, object, index, span]);
    }
    function EMatch(id, subject, arms, span) {
      return $makeVariant("EMatch", "Expr", ["id", "subject", "arms", "span"], [id, subject, arms, span]);
    }
    function EDict(id, entries, span) {
      return $makeVariant("EDict", "Expr", ["id", "entries", "span"], [id, entries, span]);
    }
    function EArray(id, elems, span) {
      return $makeVariant("EArray", "Expr", ["id", "elems", "span"], [id, elems, span]);
    }
    function EAwait(id, value, span) {
      return $makeVariant("EAwait", "Expr", ["id", "value", "span"], [id, value, span]);
    }
    function EFmt(id, parts, span) {
      return $makeVariant("EFmt", "Expr", ["id", "parts", "span"], [id, parts, span]);
    }
    function PureFn(isMemo, isGeneric) {
      return $makeVariant("PureFn", "FnKind", ["isMemo", "isGeneric"], [isMemo, isGeneric]);
    }
    function ProcFn(isAsync, isGeneric) {
      return $makeVariant("ProcFn", "FnKind", ["isAsync", "isGeneric"], [isAsync, isGeneric]);
    }
    function RecordDecl(tname, fields) {
      return $makeVariant("RecordDecl", "TypeDecl", ["tname", "fields"], [tname, fields]);
    }
    function UnionDecl(tname, variants) {
      return $makeVariant("UnionDecl", "TypeDecl", ["tname", "variants"], [tname, variants]);
    }
    function INames(names) {
      return $makeVariant("INames", "ImportSpec", ["names"], [names]);
    }
    function INamespace(alias) {
      return $makeVariant("INamespace", "ImportSpec", ["alias"], [alias]);
    }
    const IStar = $makeVariant("IStar", "ImportSpec", [], []);
    function TyName(name, args) {
      return $makeVariant("TyName", "TypeExpr", ["name", "args"], [name, args]);
    }
    function TyFun(params, ret) {
      return $makeVariant("TyFun", "TypeExpr", ["params", "ret"], [params, ret]);
    }
    function TyProc(params, ret, isAsync) {
      return $makeVariant("TyProc", "TypeExpr", ["params", "ret", "isAsync"], [params, ret, isAsync]);
    }
    const ExternFunction = $makeVariant("ExternFunction", "ExternKind", [], []);
    function ExternProc(isAsync) {
      return $makeVariant("ExternProc", "ExternKind", ["isAsync"], [isAsync]);
    }
    function SLet(id, name, init, span) {
      return $makeVariant("SLet", "Stmt", ["id", "name", "init", "span"], [id, name, init, span]);
    }
    function SVar(id, name, init, span) {
      return $makeVariant("SVar", "Stmt", ["id", "name", "init", "span"], [id, name, init, span]);
    }
    function SAssign(id, name, value, span) {
      return $makeVariant("SAssign", "Stmt", ["id", "name", "value", "span"], [id, name, value, span]);
    }
    function SIndexAssign(id, object, index, value, span) {
      return $makeVariant("SIndexAssign", "Stmt", ["id", "object", "index", "value", "span"], [id, object, index, value, span]);
    }
    function SFun(id, name, params, body, kind, span) {
      return $makeVariant("SFun", "Stmt", ["id", "name", "params", "body", "kind", "span"], [id, name, params, body, kind, span]);
    }
    function SType(id, decl, isOpaque, span) {
      return $makeVariant("SType", "Stmt", ["id", "decl", "isOpaque", "span"], [id, decl, isOpaque, span]);
    }
    function SExpr(id, expr, span) {
      return $makeVariant("SExpr", "Stmt", ["id", "expr", "span"], [id, expr, span]);
    }
    function SReturn(id, value, span) {
      return $makeVariant("SReturn", "Stmt", ["id", "value", "span"], [id, value, span]);
    }
    function SIf(id, cond, thenS, elseS, span) {
      return $makeVariant("SIf", "Stmt", ["id", "cond", "thenS", "elseS", "span"], [id, cond, thenS, elseS, span]);
    }
    function SWhile(id, cond, body, span) {
      return $makeVariant("SWhile", "Stmt", ["id", "cond", "body", "span"], [id, cond, body, span]);
    }
    function SImport(id, spec, rawPath, span) {
      return $makeVariant("SImport", "Stmt", ["id", "spec", "rawPath", "span"], [id, spec, rawPath, span]);
    }
    function SExport(id, inner, span) {
      return $makeVariant("SExport", "Stmt", ["id", "inner", "span"], [id, inner, span]);
    }
    function SExtern(id, decl, span) {
      return $makeVariant("SExtern", "Stmt", ["id", "decl", "span"], [id, decl, span]);
    }
    function astTypeWitness() {
      const p = $field(T, "mkPos")(1, 1, 0);
      const sp = $field(T, "mkSpan")(p, p);
      const baseExpr = $makeVariant("EInt", "Expr", ["id", "n", "span"], [0, 0, sp]);
      const baseStmt = $makeVariant("SExpr", "Stmt", ["id", "expr", "span"], [0, baseExpr, sp]);
      const patElem = $makeVariant("PeBind", "PatElem", ["pname"], ["p"]);
      const pattern = $makeVariant("PVariant", "Pattern", ["vname", "bind"], ["V", $makeVariant("Some", "Option", ["value"], ["value"])]);
      const field = $makeRecord("Field", ["fname", "value"], [$makeVariant("Some", "Option", ["value"], ["field"]), baseExpr]);
      const gen = $makeRecord("GenClause", ["gvar", "source"], ["item", baseExpr]);
      const entry = $makeRecord("DictEntry", ["key", "value"], [baseExpr, baseExpr]);
      const arm = $makeRecord("MatchArm", ["pattern", "guard", "body"], [pattern, $makeVariant("Some", "Option", ["value"], [baseExpr]), baseExpr]);
      const fmt = $makeVariant("FmtLit", "FmtPart", ["s"], [""]);
      const kind = $makeVariant("PureFn", "FnKind", ["isMemo", "isGeneric"], [false, false]);
      const fieldDecl = $makeRecord("FieldDecl", ["fname", "isGeneric"], ["field", false]);
      const variantDecl = $makeRecord("VariantDecl", ["vname", "fields"], ["V", [fieldDecl]]);
      const typeDecl = $makeVariant("RecordDecl", "TypeDecl", ["tname", "fields"], ["R", [fieldDecl]]);
      const importName = $makeRecord("ImportName", ["name", "alias"], ["name", $makeVariant("Some", "Option", ["value"], ["alias"])]);
      const importSpec = $makeVariant("INames", "ImportSpec", ["names"], [[importName]]);
      const typeExpr = $makeVariant("TyName", "TypeExpr", ["name", "args"], ["Int", []]);
      const typedParam = $makeRecord("TypedParam", ["name", "typeExpr"], ["x", typeExpr]);
      const externDecl = $makeRecord("ExternDecl", ["kind", "name", "params", "ret", "platform"], [ExternFunction, "nativeThing", [typedParam], typeExpr, $makeVariant("Some", "Option", ["value"], ["node"])]);
      const supporting = [$makeVariant("PeBind", "PatElem", ["pname"], ["p"]), PeWild];
      const patterns = [PWild, pattern, $makeVariant("PList", "Pattern", ["elems", "rest"], [[patElem], $makeVariant("Some", "Option", ["value"], [patElem])])];
      const formatParts = [fmt, $makeVariant("FmtExpr", "FmtPart", ["e"], [baseExpr])];
      const expressions = [baseExpr, $makeVariant("EFloat", "Expr", ["id", "text", "span"], [0, "0.0", sp]), $makeVariant("EBool", "Expr", ["id", "b", "span"], [0, false, sp]), $makeVariant("EStr", "Expr", ["id", "s", "span"], [0, "", sp]), $makeVariant("EChar", "Expr", ["id", "c", "span"], [0, "x", sp]), $makeVariant("EByte", "Expr", ["id", "b", "span"], [0, 0, sp]), $makeVariant("EVar", "Expr", ["id", "name", "span"], [0, "x", sp]), $makeVariant("EUnary", "Expr", ["id", "op", "operand", "span"], [0, "-", baseExpr, sp]), $makeVariant("EBinary", "Expr", ["id", "op", "lhs", "rhs", "span"], [0, "+", baseExpr, baseExpr, sp]), $makeVariant("EIf", "Expr", ["id", "cond", "thenE", "elseE", "span"], [0, baseExpr, baseExpr, baseExpr, sp]), $makeVariant("ECall", "Expr", ["id", "callee", "args", "span"], [0, baseExpr, [baseExpr], sp]), $makeVariant("ELambda", "Expr", ["id", "params", "body", "span"], [0, ["x"], baseExpr, sp]), $makeVariant("EProcLambda", "Expr", ["id", "params", "ret", "body", "isAsync", "span"], [0, [typedParam], typeExpr, [baseStmt], false, sp]), $makeVariant("EBlock", "Expr", ["id", "stmts", "span"], [0, [baseStmt], sp]), $makeVariant("EList", "Expr", ["id", "elems", "mode", "span"], [0, [baseExpr], StrictList, sp]), $makeVariant("EComp", "Expr", ["id", "body", "gens", "guard", "mode", "span"], [0, baseExpr, [gen], $makeVariant("Some", "Option", ["value"], [baseExpr]), LazyList, sp]), $makeVariant("ERecord", "Expr", ["id", "tname", "fields", "span"], [0, "R", [field], sp]), $makeVariant("EField", "Expr", ["id", "object", "fname", "span"], [0, baseExpr, "field", sp]), $makeVariant("EIndex", "Expr", ["id", "object", "index", "span"], [0, baseExpr, baseExpr, sp]), $makeVariant("EMatch", "Expr", ["id", "subject", "arms", "span"], [0, baseExpr, [arm], sp]), $makeVariant("EDict", "Expr", ["id", "entries", "span"], [0, [entry], sp]), $makeVariant("EArray", "Expr", ["id", "elems", "span"], [0, [baseExpr], sp]), $makeVariant("EAwait", "Expr", ["id", "value", "span"], [0, baseExpr, sp]), $makeVariant("EFmt", "Expr", ["id", "parts", "span"], [0, formatParts, sp])];
      const fnKinds = [kind, $makeVariant("ProcFn", "FnKind", ["isAsync", "isGeneric"], [false, false])];
      const typeDecls = [typeDecl, $makeVariant("UnionDecl", "TypeDecl", ["tname", "variants"], ["U", [variantDecl]])];
      const importSpecs = [importSpec, $makeVariant("INamespace", "ImportSpec", ["alias"], ["N"]), IStar];
      const typeExprs = [typeExpr, $makeVariant("TyFun", "TypeExpr", ["params", "ret"], [[typeExpr], typeExpr]), $makeVariant("TyProc", "TypeExpr", ["params", "ret", "isAsync"], [[typeExpr], typeExpr, false])];
      const externKinds = [ExternFunction, $makeVariant("ExternProc", "ExternKind", ["isAsync"], [false])];
      const statements = [$makeVariant("SLet", "Stmt", ["id", "name", "init", "span"], [0, "x", baseExpr, sp]), $makeVariant("SVar", "Stmt", ["id", "name", "init", "span"], [0, "x", baseExpr, sp]), $makeVariant("SAssign", "Stmt", ["id", "name", "value", "span"], [0, "x", baseExpr, sp]), $makeVariant("SIndexAssign", "Stmt", ["id", "object", "index", "value", "span"], [0, baseExpr, baseExpr, baseExpr, sp]), $makeVariant("SFun", "Stmt", ["id", "name", "params", "body", "kind", "span"], [0, "f", ["x"], [baseStmt], kind, sp]), $makeVariant("SType", "Stmt", ["id", "decl", "isOpaque", "span"], [0, typeDecl, false, sp]), baseStmt, $makeVariant("SReturn", "Stmt", ["id", "value", "span"], [0, $makeVariant("Some", "Option", ["value"], [baseExpr]), sp]), $makeVariant("SIf", "Stmt", ["id", "cond", "thenS", "elseS", "span"], [0, baseExpr, [baseStmt], $makeVariant("Some", "Option", ["value"], [[baseStmt]]), sp]), $makeVariant("SWhile", "Stmt", ["id", "cond", "body", "span"], [0, baseExpr, [baseStmt], sp]), $makeVariant("SImport", "Stmt", ["id", "spec", "rawPath", "span"], [0, importSpec, "./dep", sp]), $makeVariant("SExport", "Stmt", ["id", "inner", "span"], [0, baseStmt, sp]), $makeVariant("SExtern", "Stmt", ["id", "decl", "span"], [0, externDecl, sp])];
      return $makeRecord("Module", ["path", "stmts", "nextId"], ["witness.pf", statements, 1]);
    }
    function strictListMode() {
      return StrictList;
    }
    function lazyListMode() {
      return LazyList;
    }
    function mkField(fname, value) {
      return $makeRecord("Field", ["fname", "value"], [fname, value]);
    }
    function mkGenClause(gvar, source) {
      return $makeRecord("GenClause", ["gvar", "source"], [gvar, source]);
    }
    function mkDictEntry(key, value) {
      return $makeRecord("DictEntry", ["key", "value"], [key, value]);
    }
    function peBind(pname) {
      return $makeVariant("PeBind", "PatElem", ["pname"], [pname]);
    }
    function peWild() {
      return PeWild;
    }
    function pWild() {
      return PWild;
    }
    function pVariant(vname, bind) {
      return $makeVariant("PVariant", "Pattern", ["vname", "bind"], [vname, bind]);
    }
    function pList(elems, rest) {
      return $makeVariant("PList", "Pattern", ["elems", "rest"], [elems, rest]);
    }
    function mkMatchArm(pattern, guard, body) {
      return $makeRecord("MatchArm", ["pattern", "guard", "body"], [pattern, guard, body]);
    }
    function fmtLit(s) {
      return $makeVariant("FmtLit", "FmtPart", ["s"], [s]);
    }
    function fmtExpr(e) {
      return $makeVariant("FmtExpr", "FmtPart", ["e"], [e]);
    }
    function eInt(id, n, span) {
      return $makeVariant("EInt", "Expr", ["id", "n", "span"], [id, n, span]);
    }
    function eFloat(id, text, span) {
      return $makeVariant("EFloat", "Expr", ["id", "text", "span"], [id, text, span]);
    }
    function eBool(id, b, span) {
      return $makeVariant("EBool", "Expr", ["id", "b", "span"], [id, b, span]);
    }
    function eStr(id, s, span) {
      return $makeVariant("EStr", "Expr", ["id", "s", "span"], [id, s, span]);
    }
    function eChar(id, c, span) {
      return $makeVariant("EChar", "Expr", ["id", "c", "span"], [id, c, span]);
    }
    function eByte(id, b, span) {
      return $makeVariant("EByte", "Expr", ["id", "b", "span"], [id, b, span]);
    }
    function eVar(id, name, span) {
      return $makeVariant("EVar", "Expr", ["id", "name", "span"], [id, name, span]);
    }
    function eUnary(id, op, operand, span) {
      return $makeVariant("EUnary", "Expr", ["id", "op", "operand", "span"], [id, op, operand, span]);
    }
    function eBinary(id, op, lhs, rhs, span) {
      return $makeVariant("EBinary", "Expr", ["id", "op", "lhs", "rhs", "span"], [id, op, lhs, rhs, span]);
    }
    function eIf(id, cond, thenE, elseE, span) {
      return $makeVariant("EIf", "Expr", ["id", "cond", "thenE", "elseE", "span"], [id, cond, thenE, elseE, span]);
    }
    function eCall(id, callee, args, span) {
      return $makeVariant("ECall", "Expr", ["id", "callee", "args", "span"], [id, callee, args, span]);
    }
    function eLambda(id, params, body, span) {
      return $makeVariant("ELambda", "Expr", ["id", "params", "body", "span"], [id, params, body, span]);
    }
    function eProcLambda(id, params, ret, body, isAsync, span) {
      return $makeVariant("EProcLambda", "Expr", ["id", "params", "ret", "body", "isAsync", "span"], [id, params, ret, body, isAsync, span]);
    }
    function eBlock(id, stmts, span) {
      return $makeVariant("EBlock", "Expr", ["id", "stmts", "span"], [id, stmts, span]);
    }
    function eList(id, elems, mode, span) {
      return $makeVariant("EList", "Expr", ["id", "elems", "mode", "span"], [id, elems, mode, span]);
    }
    function eComp(id, body, gens, guard, mode, span) {
      return $makeVariant("EComp", "Expr", ["id", "body", "gens", "guard", "mode", "span"], [id, body, gens, guard, mode, span]);
    }
    function eRecord(id, tname, fields, span) {
      return $makeVariant("ERecord", "Expr", ["id", "tname", "fields", "span"], [id, tname, fields, span]);
    }
    function eField(id, object, fname, span) {
      return $makeVariant("EField", "Expr", ["id", "object", "fname", "span"], [id, object, fname, span]);
    }
    function eIndex(id, object, index, span) {
      return $makeVariant("EIndex", "Expr", ["id", "object", "index", "span"], [id, object, index, span]);
    }
    function eMatch(id, subject, arms, span) {
      return $makeVariant("EMatch", "Expr", ["id", "subject", "arms", "span"], [id, subject, arms, span]);
    }
    function eDict(id, entries, span) {
      return $makeVariant("EDict", "Expr", ["id", "entries", "span"], [id, entries, span]);
    }
    function eArray(id, elems, span) {
      return $makeVariant("EArray", "Expr", ["id", "elems", "span"], [id, elems, span]);
    }
    function eAwait(id, value, span) {
      return $makeVariant("EAwait", "Expr", ["id", "value", "span"], [id, value, span]);
    }
    function eFmt(id, parts, span) {
      return $makeVariant("EFmt", "Expr", ["id", "parts", "span"], [id, parts, span]);
    }
    function pureFn(isMemo, isGeneric) {
      return $makeVariant("PureFn", "FnKind", ["isMemo", "isGeneric"], [isMemo, isGeneric]);
    }
    function procFn(isAsync, isGeneric) {
      return $makeVariant("ProcFn", "FnKind", ["isAsync", "isGeneric"], [isAsync, isGeneric]);
    }
    function mkFieldDecl(fname, isGeneric) {
      return $makeRecord("FieldDecl", ["fname", "isGeneric"], [fname, isGeneric]);
    }
    function mkVariantDecl(vname, fields) {
      return $makeRecord("VariantDecl", ["vname", "fields"], [vname, fields]);
    }
    function recordDecl(tname, fields) {
      return $makeVariant("RecordDecl", "TypeDecl", ["tname", "fields"], [tname, fields]);
    }
    function unionDecl(tname, variants) {
      return $makeVariant("UnionDecl", "TypeDecl", ["tname", "variants"], [tname, variants]);
    }
    function mkImportName(name, alias) {
      return $makeRecord("ImportName", ["name", "alias"], [name, alias]);
    }
    function iNames(names) {
      return $makeVariant("INames", "ImportSpec", ["names"], [names]);
    }
    function iNamespace(alias) {
      return $makeVariant("INamespace", "ImportSpec", ["alias"], [alias]);
    }
    function iStar() {
      return IStar;
    }
    function tyName(name, args) {
      return $makeVariant("TyName", "TypeExpr", ["name", "args"], [name, args]);
    }
    function tyFun(params, ret) {
      return $makeVariant("TyFun", "TypeExpr", ["params", "ret"], [params, ret]);
    }
    function tyProc(params, ret, isAsync) {
      return $makeVariant("TyProc", "TypeExpr", ["params", "ret", "isAsync"], [params, ret, isAsync]);
    }
    function externFunction() {
      return ExternFunction;
    }
    function externProc(isAsync) {
      return $makeVariant("ExternProc", "ExternKind", ["isAsync"], [isAsync]);
    }
    function mkTypedParam(name, typeExpr) {
      return $makeRecord("TypedParam", ["name", "typeExpr"], [name, typeExpr]);
    }
    function mkExternDecl(kind, name, params, ret, platform) {
      return $makeRecord("ExternDecl", ["kind", "name", "params", "ret", "platform"], [kind, name, params, ret, platform]);
    }
    function sLet(id, name, init, span) {
      return $makeVariant("SLet", "Stmt", ["id", "name", "init", "span"], [id, name, init, span]);
    }
    function sVar(id, name, init, span) {
      return $makeVariant("SVar", "Stmt", ["id", "name", "init", "span"], [id, name, init, span]);
    }
    function sAssign(id, name, value, span) {
      return $makeVariant("SAssign", "Stmt", ["id", "name", "value", "span"], [id, name, value, span]);
    }
    function sIndexAssign(id, object, index, value, span) {
      return $makeVariant("SIndexAssign", "Stmt", ["id", "object", "index", "value", "span"], [id, object, index, value, span]);
    }
    function sFun(id, name, params, body, kind, span) {
      return $makeVariant("SFun", "Stmt", ["id", "name", "params", "body", "kind", "span"], [id, name, params, body, kind, span]);
    }
    function sType(id, decl, isOpaque, span) {
      return $makeVariant("SType", "Stmt", ["id", "decl", "isOpaque", "span"], [id, decl, isOpaque, span]);
    }
    function sExpr(id, expr, span) {
      return $makeVariant("SExpr", "Stmt", ["id", "expr", "span"], [id, expr, span]);
    }
    function sReturn(id, value, span) {
      return $makeVariant("SReturn", "Stmt", ["id", "value", "span"], [id, value, span]);
    }
    function sIf(id, cond, thenS, elseS, span) {
      return $makeVariant("SIf", "Stmt", ["id", "cond", "thenS", "elseS", "span"], [id, cond, thenS, elseS, span]);
    }
    function sWhile(id, cond, body, span) {
      return $makeVariant("SWhile", "Stmt", ["id", "cond", "body", "span"], [id, cond, body, span]);
    }
    function sImport(id, spec, rawPath, span) {
      return $makeVariant("SImport", "Stmt", ["id", "spec", "rawPath", "span"], [id, spec, rawPath, span]);
    }
    function sExport(id, inner, span) {
      return $makeVariant("SExport", "Stmt", ["id", "inner", "span"], [id, inner, span]);
    }
    function sExtern(id, decl, span) {
      return $makeVariant("SExtern", "Stmt", ["id", "decl", "span"], [id, decl, span]);
    }
    function mkModule(path, stmts, nextId) {
      return $makeRecord("Module", ["path", "stmts", "nextId"], [path, stmts, nextId]);
    }
    function exprId(expr) {
      return (($match$862) => {
        if ($match$862.$t === "EInt") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EFloat") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EBool") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EStr") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EChar") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EByte") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EVar") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EUnary") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EBinary") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EIf") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "ECall") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "ELambda") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EProcLambda") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EBlock") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EList") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EComp") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "ERecord") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EField") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EIndex") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EMatch") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EDict") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EArray") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EAwait") {
          const e = $match$862;
          return e.f[0];
        }
        if ($match$862.$t === "EFmt") {
          const e = $match$862;
          return e.f[0];
        }
        throw $matchFail("src/syntax/ast.pf", 862);
      })(expr);
    }
    function exprSpan(expr) {
      return (($match$915) => {
        if ($match$915.$t === "EInt") {
          const e = $match$915;
          return e.f[2];
        }
        if ($match$915.$t === "EFloat") {
          const e = $match$915;
          return e.f[2];
        }
        if ($match$915.$t === "EBool") {
          const e = $match$915;
          return e.f[2];
        }
        if ($match$915.$t === "EStr") {
          const e = $match$915;
          return e.f[2];
        }
        if ($match$915.$t === "EChar") {
          const e = $match$915;
          return e.f[2];
        }
        if ($match$915.$t === "EByte") {
          const e = $match$915;
          return e.f[2];
        }
        if ($match$915.$t === "EVar") {
          const e = $match$915;
          return e.f[2];
        }
        if ($match$915.$t === "EUnary") {
          const e = $match$915;
          return e.f[3];
        }
        if ($match$915.$t === "EBinary") {
          const e = $match$915;
          return e.f[4];
        }
        if ($match$915.$t === "EIf") {
          const e = $match$915;
          return e.f[4];
        }
        if ($match$915.$t === "ECall") {
          const e = $match$915;
          return e.f[3];
        }
        if ($match$915.$t === "ELambda") {
          const e = $match$915;
          return e.f[3];
        }
        if ($match$915.$t === "EProcLambda") {
          const e = $match$915;
          return e.f[5];
        }
        if ($match$915.$t === "EBlock") {
          const e = $match$915;
          return e.f[2];
        }
        if ($match$915.$t === "EList") {
          const e = $match$915;
          return e.f[3];
        }
        if ($match$915.$t === "EComp") {
          const e = $match$915;
          return e.f[5];
        }
        if ($match$915.$t === "ERecord") {
          const e = $match$915;
          return e.f[3];
        }
        if ($match$915.$t === "EField") {
          const e = $match$915;
          return e.f[3];
        }
        if ($match$915.$t === "EIndex") {
          const e = $match$915;
          return e.f[3];
        }
        if ($match$915.$t === "EMatch") {
          const e = $match$915;
          return e.f[3];
        }
        if ($match$915.$t === "EDict") {
          const e = $match$915;
          return e.f[2];
        }
        if ($match$915.$t === "EArray") {
          const e = $match$915;
          return e.f[2];
        }
        if ($match$915.$t === "EAwait") {
          const e = $match$915;
          return e.f[2];
        }
        if ($match$915.$t === "EFmt") {
          const e = $match$915;
          return e.f[2];
        }
        throw $matchFail("src/syntax/ast.pf", 915);
      })(expr);
    }
    function stmtSpan(stmt) {
      return (($match$968) => {
        if ($match$968.$t === "SLet") {
          const s = $match$968;
          return s.f[3];
        }
        if ($match$968.$t === "SVar") {
          const s = $match$968;
          return s.f[3];
        }
        if ($match$968.$t === "SAssign") {
          const s = $match$968;
          return s.f[3];
        }
        if ($match$968.$t === "SIndexAssign") {
          const s = $match$968;
          return s.f[4];
        }
        if ($match$968.$t === "SFun") {
          const s = $match$968;
          return s.f[5];
        }
        if ($match$968.$t === "SType") {
          const s = $match$968;
          return s.f[3];
        }
        if ($match$968.$t === "SExpr") {
          const s = $match$968;
          return s.f[2];
        }
        if ($match$968.$t === "SReturn") {
          const s = $match$968;
          return s.f[2];
        }
        if ($match$968.$t === "SIf") {
          const s = $match$968;
          return s.f[4];
        }
        if ($match$968.$t === "SWhile") {
          const s = $match$968;
          return s.f[3];
        }
        if ($match$968.$t === "SImport") {
          const s = $match$968;
          return s.f[3];
        }
        if ($match$968.$t === "SExport") {
          const s = $match$968;
          return s.f[2];
        }
        if ($match$968.$t === "SExtern") {
          const s = $match$968;
          return s.f[2];
        }
        throw $matchFail("src/syntax/ast.pf", 968);
      })(stmt);
    }
    function spanJoin(a, b) {
      return $field(T, "mkSpan")(a.f[0], b.f[1]);
    }
    function assignVarName(expr) {
      return (($match$1009) => {
        if ($match$1009.$t === "EVar") {
          const e = $match$1009;
          return $makeVariant("Some", "Option", ["value"], [e.f[1]]);
        }
        if (true) {
          return $makeVariant("None", "Option", [], []);
        }
        throw $matchFail("src/syntax/ast.pf", 1009);
      })(expr);
    }
    function assignIndexParts(expr) {
      return (($match$1018) => {
        if ($match$1018.$t === "EIndex") {
          const e = $match$1018;
          return $makeVariant("Some", "Option", ["value"], [$makeRecord("Pair", ["key", "value"], [e.f[1], e.f[2]])]);
        }
        if (true) {
          return $makeVariant("None", "Option", [], []);
        }
        throw $matchFail("src/syntax/ast.pf", 1018);
      })(expr);
    }
    function isNoArgVariantPattern(pattern) {
      return (($match$1030) => {
        if ($match$1030.$t === "PVariant") {
          const p = $match$1030;
          return (() => {
            return (($match$1033) => {
              if ($match$1033.$t === "None") {
                return true;
              }
              if ($match$1033.$t === "Some") {
                return false;
              }
              throw $matchFail("src/syntax/ast.pf", 1033);
            })(p.f[1]);
          })();
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/syntax/ast.pf", 1030);
      })(pattern);
    }
    const astSigPos = $field(T, "mkPos")(1, 1, 0);
    const astSigSpan = $field(T, "mkSpan")(astSigPos, astSigPos);
    const astSigExpr = $makeVariant("EInt", "Expr", ["id", "n", "span"], [0, 0, astSigSpan]);
    const astSigStmt = $makeVariant("SExpr", "Stmt", ["id", "expr", "span"], [0, astSigExpr, astSigSpan]);
    const astSigExprs = [astSigExpr];
    const astSigStmts = [astSigStmt];
    const astSigStrings = [""];
    const astSigMode = StrictList;
    const astSigField = $makeRecord("Field", ["fname", "value"], [$makeVariant("Some", "Option", ["value"], ["field"]), astSigExpr]);
    const astSigFields = [astSigField];
    const astSigGen = $makeRecord("GenClause", ["gvar", "source"], ["item", astSigExpr]);
    const astSigGens = [astSigGen];
    const astSigEntry = $makeRecord("DictEntry", ["key", "value"], [astSigExpr, astSigExpr]);
    const astSigEntries = [astSigEntry];
    const astSigPattern = PWild;
    const astSigArm = $makeRecord("MatchArm", ["pattern", "guard", "body"], [astSigPattern, $makeVariant("Some", "Option", ["value"], [astSigExpr]), astSigExpr]);
    const astSigArms = [astSigArm];
    const astSigFmtPart = $makeVariant("FmtLit", "FmtPart", ["s"], [""]);
    const astSigFmts = [astSigFmtPart];
    const astSigFieldDecl = $makeRecord("FieldDecl", ["fname", "isGeneric"], ["field", false]);
    const astSigTypeDecl = $makeVariant("RecordDecl", "TypeDecl", ["tname", "fields"], ["R", [astSigFieldDecl]]);
    const astSigTypeExpr = $makeVariant("TyName", "TypeExpr", ["name", "args"], ["Int", []]);
    const astSigTypeExprs = [astSigTypeExpr];
    const astSigImportSpec = IStar;
    const astSigFnKind = $makeVariant("PureFn", "FnKind", ["isMemo", "isGeneric"], [false, false]);
    const astSigExternDecl = $makeRecord("ExternDecl", ["kind", "name", "params", "ret", "platform"], [ExternFunction, "nativeThing", [$makeRecord("TypedParam", ["name", "typeExpr"], ["x", astSigTypeExpr])], astSigTypeExpr, $makeVariant("Some", "Option", ["value"], ["node"])]);
    function astSigIntIntSpanExpr(id, n, span) {
      const ids = [0, id];
      const nums = [0, n];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigIntIntSpanExprFns = [astSigIntIntSpanExpr, eInt];
    function astSigIntStrSpanExpr(id, text, span) {
      const ids = [0, id];
      const texts = ["", text];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigIntStrSpanExprFns = [astSigIntStrSpanExpr, eFloat, eStr, eVar];
    function astSigIntBoolSpanExpr(id, value, span) {
      const ids = [0, id];
      const values = [false, value];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigIntBoolSpanExprFns = [astSigIntBoolSpanExpr, eBool];
    function astSigIntCharSpanExpr(id, value, span) {
      const ids = [0, id];
      const values = ["x", value];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigIntCharSpanExprFns = [astSigIntCharSpanExpr, eChar];
    function astSigIntByteSpanExpr(id, value, span) {
      const ids = [0, id];
      const values = [0, value];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigIntByteSpanExprFns = [astSigIntByteSpanExpr, eByte];
    function astSigUnary(id, op, operand, span) {
      const ids = [0, id];
      const ops = ["", op];
      const operands = [astSigExpr, operand];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigUnaryFns = [astSigUnary, eUnary];
    function astSigBinary(id, op, lhs, rhs, span) {
      const ids = [0, id];
      const ops = ["", op];
      const lefts = [astSigExpr, lhs];
      const rights = [astSigExpr, rhs];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigBinaryFns = [astSigBinary, eBinary];
    function astSigIf(id, cond, thenE, elseE, span) {
      const ids = [0, id];
      const conds = [astSigExpr, cond];
      const thens = [astSigExpr, thenE];
      const elses = [astSigExpr, elseE];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigIfFns = [astSigIf, eIf];
    function astSigCall(id, callee, args, span) {
      const ids = [0, id];
      const callees = [astSigExpr, callee];
      const argLists = [astSigExprs, args];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigCallFns = [astSigCall, eCall];
    function astSigLambda(id, params, body, span) {
      const ids = [0, id];
      const paramLists = [astSigStrings, params];
      const bodies = [astSigExpr, body];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigLambdaFns = [astSigLambda, eLambda];
    function astSigProcLambda(id, params, ret, body, isAsync, span) {
      const ids = [0, id];
      const paramLists = [astSigExternDecl.f[2], params];
      const returns = [astSigTypeExpr, ret];
      const bodies = [astSigStmts, body];
      const asyncFlags = [false, isAsync];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigProcLambdaFns = [astSigProcLambda, eProcLambda];
    function astSigBlock(id, stmts, span) {
      const ids = [0, id];
      const stmtLists = [astSigStmts, stmts];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigBlockFns = [astSigBlock, eBlock];
    function astSigList(id, elems, mode, span) {
      const ids = [0, id];
      const elemLists = [astSigExprs, elems];
      const modes = [astSigMode, mode];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigListFns = [astSigList, eList];
    function astSigComp(id, body, gens, guard, mode, span) {
      const ids = [0, id];
      const bodies = [astSigExpr, body];
      const genLists = [astSigGens, gens];
      const guards = [$makeVariant("Some", "Option", ["value"], [astSigExpr]), guard];
      const modes = [astSigMode, mode];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigCompFns = [astSigComp, eComp];
    function astSigRecord(id, tname, fields, span) {
      const ids = [0, id];
      const names = ["", tname];
      const fieldLists = [astSigFields, fields];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigRecordFns = [astSigRecord, eRecord];
    function astSigFieldAccess(id, object, fname, span) {
      const ids = [0, id];
      const objects = [astSigExpr, object];
      const names = ["", fname];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigFieldAccessFns = [astSigFieldAccess, eField];
    function astSigIndex(id, object, index, span) {
      const ids = [0, id];
      const objects = [astSigExpr, object];
      const indexes = [astSigExpr, index];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigIndexFns = [astSigIndex, eIndex];
    function astSigMatch(id, subject, arms, span) {
      const ids = [0, id];
      const subjects = [astSigExpr, subject];
      const armLists = [astSigArms, arms];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigMatchFns = [astSigMatch, eMatch];
    function astSigDict(id, entries, span) {
      const ids = [0, id];
      const entryLists = [astSigEntries, entries];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigDictFns = [astSigDict, eDict];
    function astSigArray(id, elems, span) {
      const ids = [0, id];
      const elemLists = [astSigExprs, elems];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigArrayFns = [astSigArray, eArray];
    function astSigAwait(id, value, span) {
      const ids = [0, id];
      const values = [astSigExpr, value];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigAwaitFns = [astSigAwait, eAwait];
    function astSigFmt(id, parts, span) {
      const ids = [0, id];
      const partLists = [astSigFmts, parts];
      const spans = [astSigSpan, span];
      return astSigExpr;
    }
    const astSigFmtFns = [astSigFmt, eFmt];
    function astSigTyName(name, args) {
      const names = ["", name];
      const argLists = [astSigTypeExprs, args];
      return astSigTypeExpr;
    }
    const astSigTyNameFns = [astSigTyName, tyName];
    function astSigTyProc(params, ret, isAsync) {
      const paramLists = [astSigTypeExprs, params];
      const returns = [astSigTypeExpr, ret];
      const asyncFlags = [false, isAsync];
      return astSigTypeExpr;
    }
    const astSigTyProcFns = [astSigTyProc, tyProc];
    function astSigNamedStmt(id, name, value, span) {
      const ids = [0, id];
      const names = ["", name];
      const values = [astSigExpr, value];
      const spans = [astSigSpan, span];
      return astSigStmt;
    }
    const astSigNamedStmtFns = [astSigNamedStmt, sLet, sVar, sAssign];
    function astSigIndexAssign(id, object, index, value, span) {
      const ids = [0, id];
      const objects = [astSigExpr, object];
      const indexes = [astSigExpr, index];
      const values = [astSigExpr, value];
      const spans = [astSigSpan, span];
      return astSigStmt;
    }
    const astSigIndexAssignFns = [astSigIndexAssign, sIndexAssign];
    function astSigFun(id, name, params, body, kind, span) {
      const ids = [0, id];
      const names = ["", name];
      const paramLists = [astSigStrings, params];
      const bodies = [astSigStmts, body];
      const kinds = [astSigFnKind, kind];
      const spans = [astSigSpan, span];
      return astSigStmt;
    }
    const astSigFunFns = [astSigFun, sFun];
    function astSigTypeStmt(id, decl, isOpaque, span) {
      const ids = [0, id];
      const decls = [astSigTypeDecl, decl];
      const opaqueFlags = [false, isOpaque];
      const spans = [astSigSpan, span];
      return astSigStmt;
    }
    const astSigTypeStmtFns = [astSigTypeStmt, sType];
    function astSigExprStmt(id, expr, span) {
      const ids = [0, id];
      const exprs = [astSigExpr, expr];
      const spans = [astSigSpan, span];
      return astSigStmt;
    }
    const astSigExprStmtFns = [astSigExprStmt, sExpr];
    function astSigReturn(id, value, span) {
      const ids = [0, id];
      const values = [$makeVariant("Some", "Option", ["value"], [astSigExpr]), value];
      const spans = [astSigSpan, span];
      return astSigStmt;
    }
    const astSigReturnFns = [astSigReturn, sReturn];
    function astSigStmtIf(id, cond, thenS, elseS, span) {
      const ids = [0, id];
      const conds = [astSigExpr, cond];
      const thenLists = [astSigStmts, thenS];
      const elseLists = [$makeVariant("Some", "Option", ["value"], [astSigStmts]), elseS];
      const spans = [astSigSpan, span];
      return astSigStmt;
    }
    const astSigStmtIfFns = [astSigStmtIf, sIf];
    function astSigWhile(id, cond, body, span) {
      const ids = [0, id];
      const conds = [astSigExpr, cond];
      const bodies = [astSigStmts, body];
      const spans = [astSigSpan, span];
      return astSigStmt;
    }
    const astSigWhileFns = [astSigWhile, sWhile];
    function astSigImport(id, spec, rawPath, span) {
      const ids = [0, id];
      const specs = [astSigImportSpec, spec];
      const paths = ["", rawPath];
      const spans = [astSigSpan, span];
      return astSigStmt;
    }
    const astSigImportFns = [astSigImport, sImport];
    function astSigExport(id, inner, span) {
      const ids = [0, id];
      const inners = [astSigStmt, inner];
      const spans = [astSigSpan, span];
      return astSigStmt;
    }
    const astSigExportFns = [astSigExport, sExport];
    function astSigExtern(id, decl, span) {
      const ids = [0, id];
      const decls = [astSigExternDecl, decl];
      const spans = [astSigSpan, span];
      return astSigStmt;
    }
    const astSigExternFns = [astSigExtern, sExtern];
    function astSigExprSpan(expr) {
      const exprs = [astSigExpr, expr];
      return astSigSpan;
    }
    const astSigExprSpanFns = [astSigExprSpan, exprSpan];
    function astSigStmtSpan(stmt) {
      const stmts = [astSigStmt, stmt];
      return astSigSpan;
    }
    const astSigStmtSpanFns = [astSigStmtSpan, stmtSpan];
    function astSigSpanJoin(a, b) {
      const lefts = [astSigSpan, a];
      const rights = [astSigSpan, b];
      return astSigSpan;
    }
    const astSigSpanJoinFns = [astSigSpanJoin, spanJoin];
    exports["StrictList"] = StrictList;
    exports["LazyList"] = LazyList;
    exports["PeBind"] = PeBind;
    exports["PeWild"] = PeWild;
    exports["PWild"] = PWild;
    exports["PVariant"] = PVariant;
    exports["PList"] = PList;
    exports["FmtLit"] = FmtLit;
    exports["FmtExpr"] = FmtExpr;
    exports["EInt"] = EInt;
    exports["EFloat"] = EFloat;
    exports["EBool"] = EBool;
    exports["EStr"] = EStr;
    exports["EChar"] = EChar;
    exports["EByte"] = EByte;
    exports["EVar"] = EVar;
    exports["EUnary"] = EUnary;
    exports["EBinary"] = EBinary;
    exports["EIf"] = EIf;
    exports["ECall"] = ECall;
    exports["ELambda"] = ELambda;
    exports["EProcLambda"] = EProcLambda;
    exports["EBlock"] = EBlock;
    exports["EList"] = EList;
    exports["EComp"] = EComp;
    exports["ERecord"] = ERecord;
    exports["EField"] = EField;
    exports["EIndex"] = EIndex;
    exports["EMatch"] = EMatch;
    exports["EDict"] = EDict;
    exports["EArray"] = EArray;
    exports["EAwait"] = EAwait;
    exports["EFmt"] = EFmt;
    exports["PureFn"] = PureFn;
    exports["ProcFn"] = ProcFn;
    exports["RecordDecl"] = RecordDecl;
    exports["UnionDecl"] = UnionDecl;
    exports["INames"] = INames;
    exports["INamespace"] = INamespace;
    exports["IStar"] = IStar;
    exports["TyName"] = TyName;
    exports["TyFun"] = TyFun;
    exports["TyProc"] = TyProc;
    exports["ExternFunction"] = ExternFunction;
    exports["ExternProc"] = ExternProc;
    exports["SLet"] = SLet;
    exports["SVar"] = SVar;
    exports["SAssign"] = SAssign;
    exports["SIndexAssign"] = SIndexAssign;
    exports["SFun"] = SFun;
    exports["SType"] = SType;
    exports["SExpr"] = SExpr;
    exports["SReturn"] = SReturn;
    exports["SIf"] = SIf;
    exports["SWhile"] = SWhile;
    exports["SImport"] = SImport;
    exports["SExport"] = SExport;
    exports["SExtern"] = SExtern;
    exports["strictListMode"] = strictListMode;
    exports["lazyListMode"] = lazyListMode;
    exports["mkField"] = mkField;
    exports["mkGenClause"] = mkGenClause;
    exports["mkDictEntry"] = mkDictEntry;
    exports["peBind"] = peBind;
    exports["peWild"] = peWild;
    exports["pWild"] = pWild;
    exports["pVariant"] = pVariant;
    exports["pList"] = pList;
    exports["mkMatchArm"] = mkMatchArm;
    exports["fmtLit"] = fmtLit;
    exports["fmtExpr"] = fmtExpr;
    exports["eInt"] = eInt;
    exports["eFloat"] = eFloat;
    exports["eBool"] = eBool;
    exports["eStr"] = eStr;
    exports["eChar"] = eChar;
    exports["eByte"] = eByte;
    exports["eVar"] = eVar;
    exports["eUnary"] = eUnary;
    exports["eBinary"] = eBinary;
    exports["eIf"] = eIf;
    exports["eCall"] = eCall;
    exports["eLambda"] = eLambda;
    exports["eProcLambda"] = eProcLambda;
    exports["eBlock"] = eBlock;
    exports["eList"] = eList;
    exports["eComp"] = eComp;
    exports["eRecord"] = eRecord;
    exports["eField"] = eField;
    exports["eIndex"] = eIndex;
    exports["eMatch"] = eMatch;
    exports["eDict"] = eDict;
    exports["eArray"] = eArray;
    exports["eAwait"] = eAwait;
    exports["eFmt"] = eFmt;
    exports["pureFn"] = pureFn;
    exports["procFn"] = procFn;
    exports["mkFieldDecl"] = mkFieldDecl;
    exports["mkVariantDecl"] = mkVariantDecl;
    exports["recordDecl"] = recordDecl;
    exports["unionDecl"] = unionDecl;
    exports["mkImportName"] = mkImportName;
    exports["iNames"] = iNames;
    exports["iNamespace"] = iNamespace;
    exports["iStar"] = iStar;
    exports["tyName"] = tyName;
    exports["tyFun"] = tyFun;
    exports["tyProc"] = tyProc;
    exports["externFunction"] = externFunction;
    exports["externProc"] = externProc;
    exports["mkTypedParam"] = mkTypedParam;
    exports["mkExternDecl"] = mkExternDecl;
    exports["sLet"] = sLet;
    exports["sVar"] = sVar;
    exports["sAssign"] = sAssign;
    exports["sIndexAssign"] = sIndexAssign;
    exports["sFun"] = sFun;
    exports["sType"] = sType;
    exports["sExpr"] = sExpr;
    exports["sReturn"] = sReturn;
    exports["sIf"] = sIf;
    exports["sWhile"] = sWhile;
    exports["sImport"] = sImport;
    exports["sExport"] = sExport;
    exports["sExtern"] = sExtern;
    exports["mkModule"] = mkModule;
    exports["exprId"] = exprId;
    exports["exprSpan"] = exprSpan;
    exports["stmtSpan"] = stmtSpan;
    exports["spanJoin"] = spanJoin;
    exports["assignVarName"] = assignVarName;
    exports["assignIndexParts"] = assignIndexParts;
    exports["isNoArgVariantPattern"] = isNoArgVariantPattern;
  });
  $registerSchemas([{name: "PSt", union: null, fields: ["path", "toks", "index", "nextId", "inMatchArms"], variant: false}, {name: "POk", union: "PResult", fields: ["st", "node"], variant: true}, {name: "PErr", union: "PResult", fields: ["diags"], variant: true}, {name: "ParseOk", union: "ParseResult", fields: ["module"], variant: true}, {name: "ParseErr", union: "ParseResult", fields: ["diags"], variant: true}, {name: "BlockOut", union: null, fields: ["stmts", "span"], variant: false}, {name: "FmtHole", union: null, fields: ["text", "nextIndex"], variant: false}, {name: "FmtHoleOk", union: "FmtHoleResult", fields: ["hole"], variant: true}, {name: "FmtHoleErr", union: "FmtHoleResult", fields: ["message"], variant: true}]);
  $maps["src/syntax/parser"] = {"./ast": "src/syntax/ast", "./token": "src/syntax/token", "./lexer": "src/syntax/lexer", "../check/diag": "src/check/diag", "../compat": "src/compat"};
  $mods["src/syntax/parser"] = ((exports, $require) => {
    const A = $require("./ast");
    const T = $require("./token");
    const Lex = $require("./lexer");
    const D = $require("../check/diag");
    const Compat = $require("../compat");
    function POk(st, node) {
      return $makeVariant("POk", "PResult", ["st", "node"], [st, node]);
    }
    function PErr(diags) {
      return $makeVariant("PErr", "PResult", ["diags"], [diags]);
    }
    function ParseOk(module) {
      return $makeVariant("ParseOk", "ParseResult", ["module"], [module]);
    }
    function ParseErr(diags) {
      return $makeVariant("ParseErr", "ParseResult", ["diags"], [diags]);
    }
    function ok(st, node) {
      return $makeVariant("POk", "PResult", ["st", "node"], [st, node]);
    }
    function errAt(span, path, message) {
      return $field(D, "err")($makeVariant("ParseD", "DiagCode", [], []), message, path, span);
    }
    function failAt(st, span, message) {
      return $makeVariant("PErr", "PResult", ["diags"], [[errAt(span, $field(st, "path"), message)]]);
    }
    function fallbackSpan() {
      const p = $field(T, "mkPos")(1, 1, 0);
      return $field(T, "pointSpan")(p);
    }
    function withIndex(st, index) {
      return $makeRecord("PSt", ["path", "toks", "index", "nextId", "inMatchArms"], [st.f[0], st.f[1], index, st.f[3], st.f[4]]);
    }
    function withNextId(st, nextId) {
      return $makeRecord("PSt", ["path", "toks", "index", "nextId", "inMatchArms"], [st.f[0], st.f[1], st.f[2], nextId, st.f[4]]);
    }
    function withInMatchArms(st, inMatchArms) {
      return $makeRecord("PSt", ["path", "toks", "index", "nextId", "inMatchArms"], [st.f[0], st.f[1], st.f[2], st.f[3], inMatchArms]);
    }
    function peekOpt(st) {
      return $field(Compat, "listAt")(st.f[1], st.f[2]);
    }
    function prevTokenOpt(st) {
      return $field(Compat, "listAt")(st.f[1], $subI(st.f[2], 1));
    }
    function currentSpan(st) {
      return (($match$104) => {
        if ($match$104.$t === "Some") {
          const t = $match$104;
          return t.f[0].f[1];
        }
        if ($match$104.$t === "None") {
          return (() => {
            return (($match$112) => {
              if ($match$112.$t === "Some") {
                const p = $match$112;
                return $field(T, "pointSpan")($field($field(p.f[0], "span"), "end"));
              }
              if ($match$112.$t === "None") {
                return fallbackSpan();
              }
              throw $matchFail("src/syntax/parser.pf", 112);
            })(prevTokenOpt(st));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 104);
      })(peekOpt(st));
    }
    function previousSpan(st) {
      return (($match$128) => {
        if ($match$128.$t === "Some") {
          const p = $match$128;
          return $field(p.f[0], "span");
        }
        if ($match$128.$t === "None") {
          return currentSpan(st);
        }
        throw $matchFail("src/syntax/parser.pf", 128);
      })(prevTokenOpt(st));
    }
    function advance(st) {
      return withIndex(st, $addI(st.f[2], 1));
    }
    function atKind(st, kind) {
      return (($match$149) => {
        if ($match$149.$t === "Some") {
          const t = $match$149;
          return $field(T, "tokenKind")(t.f[0]) === kind;
        }
        if ($match$149.$t === "None") {
          return false;
        }
        throw $matchFail("src/syntax/parser.pf", 149);
      })(peekOpt(st));
    }
    function atPayload(st, payload) {
      return (($match$163) => {
        if ($match$163.$t === "Some") {
          const t = $match$163;
          return $field(T, "tokenPayload")(t.f[0]) === payload;
        }
        if ($match$163.$t === "None") {
          return false;
        }
        throw $matchFail("src/syntax/parser.pf", 163);
      })(peekOpt(st));
    }
    function atOp(st, op) {
      return (($match$177) => {
        if ($match$177.$t === "Some") {
          const t = $match$177;
          return $field(T, "isOp")(t.f[0], op);
        }
        if ($match$177.$t === "None") {
          return false;
        }
        throw $matchFail("src/syntax/parser.pf", 177);
      })(peekOpt(st));
    }
    function atEllipsis(st) {
      return atOp(st, ".") && atOp(advance(st), ".") && atOp(advance(advance(st)), ".");
    }
    function consumeEllipsis(st) {
      return advance(advance(advance(st)));
    }
    function atKw(st, word) {
      return (($match$221) => {
        if ($match$221.$t === "Some") {
          const t = $match$221;
          return $field(T, "isKw")(t.f[0], word);
        }
        if ($match$221.$t === "None") {
          return false;
        }
        throw $matchFail("src/syntax/parser.pf", 221);
      })(peekOpt(st));
    }
    function atIdent(st) {
      return atKind(st, "TokIdent");
    }
    function atIdentText(st, name) {
      return atKind(st, "TokIdent") && atPayload(st, name);
    }
    function atStringToken(st) {
      return atKind(st, "TokStr") || atKind(st, "TokRawStr");
    }
    function isEof(st) {
      return atKind(st, "TokEof");
    }
    function tokText(st) {
      return (($match$268) => {
        if ($match$268.$t === "Some") {
          const t = $match$268;
          return $field(T, "tokenPayload")(t.f[0]);
        }
        if ($match$268.$t === "None") {
          return "";
        }
        throw $matchFail("src/syntax/parser.pf", 268);
      })(peekOpt(st));
    }
    function eatOp(st, op) {
      if (atOp(st, op)) {
        return advance(st);
      } else {
        return st;
      }
    }
    function failHere(st, message) {
      return failAt(st, currentSpan(st), message);
    }
    function expectOp(st, op, what) {
      if (atOp(st, op)) {
        return ok(advance(st), true);
      } else {
        return failHere(st, $concatS($concatS($concatS($concatS("Expected '", op), "' "), what), "."));
      }
    }
    function expectKw(st, word, what) {
      if (atKw(st, word)) {
        return ok(advance(st), true);
      } else {
        return failHere(st, $concatS($concatS($concatS($concatS("Expected '", word), "' "), what), "."));
      }
    }
    function expectIdent(st, what) {
      if (atIdent(st) && !atPayload(st, "_")) {
        return ok(advance(st), tokText(st));
      } else {
        return failHere(st, $concatS($concatS("Expected identifier ", what), "."));
      }
    }
    function expectParamName(st, what) {
      if (atIdent(st)) {
        return ok(advance(st), tokText(st));
      } else {
        return failHere(st, $concatS($concatS("Expected parameter name ", what), "."));
      }
    }
    function expectString(st, what) {
      if (atStringToken(st)) {
        return ok(advance(st), tokText(st));
      } else {
        return failHere(st, $concatS($concatS("Expected string literal ", what), "."));
      }
    }
    function freshId(st) {
      return $makeRecord("Pair", ["key", "value"], [withNextId(st, $addI(st.f[3], 1)), st.f[3]]);
    }
    function spanFromStart(startSpan, endSpan) {
      return $field(T, "mkSpan")(startSpan.f[0], endSpan.f[1]);
    }
    function spanFromStartToPrev(startSpan, st) {
      return spanFromStart(startSpan, previousSpan(st));
    }
    function choose(cond, a, b) {
      if (cond) {
        return a;
      } else {
        return b;
      }
    }
    function digitValue(c) {
      if (c === "0") {
        return 0;
      } else {
        if (c === "1") {
          return 1;
        } else {
          if (c === "2") {
            return 2;
          } else {
            if (c === "3") {
              return 3;
            } else {
              if (c === "4") {
                return 4;
              } else {
                if (c === "5") {
                  return 5;
                } else {
                  if (c === "6") {
                    return 6;
                  } else {
                    if (c === "7") {
                      return 7;
                    } else {
                      if (c === "8") {
                        return 8;
                      } else {
                        if (c === "9") {
                          return 9;
                        } else {
                          return 0;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    function decValAt(text, i, acc) {
      while (true) {
        if ($geI(i, $length(text))) {
          return acc;
        } else {
          const c = $slice(i, 1, text);
          const d = digitValue(c);
          const $tc$554$0 = text;
          const $tc$554$1 = $addI(i, 1);
          const $tc$554$2 = $addI($mulI(acc, 10), d);
          text = $tc$554$0;
          i = $tc$554$1;
          acc = $tc$554$2;
          continue;
        }
      }
    }
    function parseCanonicalInt(text) {
      return decValAt(text, 0, 0);
    }
    function FmtHoleOk(hole) {
      return $makeVariant("FmtHoleOk", "FmtHoleResult", ["hole"], [hole]);
    }
    function FmtHoleErr(message) {
      return $makeVariant("FmtHoleErr", "FmtHoleResult", ["message"], [message]);
    }
    function fmtPosAt(body, target, index, line, col, offset) {
      while (true) {
        if ($geI(index, target)) {
          return $field(T, "mkPos")(line, col, offset);
        } else {
          if (fmtCharAt(body, index) === "\n") {
            const $tc$596$0 = body;
            const $tc$596$1 = target;
            const $tc$596$2 = $addI(index, 1);
            const $tc$596$3 = $addI(line, 1);
            const $tc$596$4 = 1;
            const $tc$596$5 = $addI(offset, 1);
            body = $tc$596$0;
            target = $tc$596$1;
            index = $tc$596$2;
            line = $tc$596$3;
            col = $tc$596$4;
            offset = $tc$596$5;
            continue;
          } else {
            const $tc$611$0 = body;
            const $tc$611$1 = target;
            const $tc$611$2 = $addI(index, 1);
            const $tc$611$3 = line;
            const $tc$611$4 = $addI(col, 1);
            const $tc$611$5 = $addI(offset, 1);
            body = $tc$611$0;
            target = $tc$611$1;
            index = $tc$611$2;
            line = $tc$611$3;
            col = $tc$611$4;
            offset = $tc$611$5;
            continue;
          }
        }
      }
    }
    function fmtBasePos(start, body, target) {
      return fmtPosAt(body, target, 0, start.f[0].f[0], $addI(start.f[0].f[1], 2), $addI(start.f[0].f[2], 2));
    }
    function remapFmtPos(base, p) {
      if ($eqI($field(p, "line"), 1)) {
        return $field(T, "mkPos")(base.f[0], $subI($addI(base.f[1], $field(p, "col")), 1), $addI(base.f[2], $field(p, "offset")));
      } else {
        return $field(T, "mkPos")($subI($addI(base.f[0], $field(p, "line")), 1), $field(p, "col"), $addI(base.f[2], $field(p, "offset")));
      }
    }
    function remapFmtSpan(base, span) {
      return $field(T, "mkSpan")(remapFmtPos(base, $field(span, "start")), remapFmtPos(base, $field(span, "end")));
    }
    function remapFmtToken(base, token) {
      return $field(T, "mkToken")($field(token, "tok"), remapFmtSpan(base, $field(token, "span")));
    }
    function remapFmtDiag(base, d) {
      return $field(D, "err")($field(d, "code"), $field(d, "message"), $field(d, "path"), remapFmtSpan(base, $field(d, "span")));
    }
    function fmtCharAt(body, index) {
      if ($ltI(index, 0)) {
        return "";
      } else {
        if ($geI(index, $length(body))) {
          return "";
        } else {
          return $slice(index, 1, body);
        }
      }
    }
    function fmtEscapeValue(c) {
      if (c === "n") {
        return $makeVariant("Some", "Option", ["value"], ["\n"]);
      } else {
        if (c === "t") {
          return $makeVariant("Some", "Option", ["value"], ["\t"]);
        } else {
          if (c === "\\") {
            return $makeVariant("Some", "Option", ["value"], ["\\"]);
          } else {
            if (c === "\"") {
              return $makeVariant("Some", "Option", ["value"], ["\""]);
            } else {
              if (c === "'") {
                return $makeVariant("Some", "Option", ["value"], ["'"]);
              } else {
                if (c === "{") {
                  return $makeVariant("Some", "Option", ["value"], ["{"]);
                } else {
                  if (c === "}") {
                    return $makeVariant("Some", "Option", ["value"], ["}"]);
                  } else {
                    return $makeVariant("None", "Option", [], []);
                  }
                }
              }
            }
          }
        }
      }
    }
    function appendFmtLiteral(parts, text) {
      if ($eqI($length(text), 0)) {
        return parts;
      } else {
        return $cons($field(A, "fmtLit")(text), parts);
      }
    }
    function scanFmtHole(body, start, index, depth, mode, escaped) {
      while (true) {
        if ($geI(index, $length(body))) {
          return $makeVariant("FmtHoleErr", "FmtHoleResult", ["message"], ["Unterminated interpolation in format string."]);
        } else {
          const c = fmtCharAt(body, index);
          if ($eqI(mode, 0)) {
            if (c === "@" && fmtCharAt(body, $addI(index, 1)) === "\"") {
              const $tc$848$0 = body;
              const $tc$848$1 = start;
              const $tc$848$2 = $addI(index, 2);
              const $tc$848$3 = depth;
              const $tc$848$4 = 3;
              const $tc$848$5 = false;
              body = $tc$848$0;
              start = $tc$848$1;
              index = $tc$848$2;
              depth = $tc$848$3;
              mode = $tc$848$4;
              escaped = $tc$848$5;
              continue;
            } else {
              if (c === "\"") {
                const $tc$862$0 = body;
                const $tc$862$1 = start;
                const $tc$862$2 = $addI(index, 1);
                const $tc$862$3 = depth;
                const $tc$862$4 = 1;
                const $tc$862$5 = false;
                body = $tc$862$0;
                start = $tc$862$1;
                index = $tc$862$2;
                depth = $tc$862$3;
                mode = $tc$862$4;
                escaped = $tc$862$5;
                continue;
              } else {
                if (c === "'") {
                  const $tc$876$0 = body;
                  const $tc$876$1 = start;
                  const $tc$876$2 = $addI(index, 1);
                  const $tc$876$3 = depth;
                  const $tc$876$4 = 2;
                  const $tc$876$5 = false;
                  body = $tc$876$0;
                  start = $tc$876$1;
                  index = $tc$876$2;
                  depth = $tc$876$3;
                  mode = $tc$876$4;
                  escaped = $tc$876$5;
                  continue;
                } else {
                  if (c === "{") {
                    const $tc$892$0 = body;
                    const $tc$892$1 = start;
                    const $tc$892$2 = $addI(index, 1);
                    const $tc$892$3 = $addI(depth, 1);
                    const $tc$892$4 = 0;
                    const $tc$892$5 = false;
                    body = $tc$892$0;
                    start = $tc$892$1;
                    index = $tc$892$2;
                    depth = $tc$892$3;
                    mode = $tc$892$4;
                    escaped = $tc$892$5;
                    continue;
                  } else {
                    if (c === "}") {
                      if ($eqI(depth, 1)) {
                        return $makeVariant("FmtHoleOk", "FmtHoleResult", ["hole"], [$makeRecord("FmtHole", ["text", "nextIndex"], [$slice(start, $subI(index, start), body), $addI(index, 1)])]);
                      } else {
                        const $tc$924$0 = body;
                        const $tc$924$1 = start;
                        const $tc$924$2 = $addI(index, 1);
                        const $tc$924$3 = $subI(depth, 1);
                        const $tc$924$4 = 0;
                        const $tc$924$5 = false;
                        body = $tc$924$0;
                        start = $tc$924$1;
                        index = $tc$924$2;
                        depth = $tc$924$3;
                        mode = $tc$924$4;
                        escaped = $tc$924$5;
                        continue;
                      }
                    } else {
                      const $tc$936$0 = body;
                      const $tc$936$1 = start;
                      const $tc$936$2 = $addI(index, 1);
                      const $tc$936$3 = depth;
                      const $tc$936$4 = 0;
                      const $tc$936$5 = false;
                      body = $tc$936$0;
                      start = $tc$936$1;
                      index = $tc$936$2;
                      depth = $tc$936$3;
                      mode = $tc$936$4;
                      escaped = $tc$936$5;
                      continue;
                    }
                  }
                }
              }
            }
          } else {
            if ($eqI(mode, 3)) {
              if (c === "\"") {
                const $tc$958$0 = body;
                const $tc$958$1 = start;
                const $tc$958$2 = $addI(index, 1);
                const $tc$958$3 = depth;
                const $tc$958$4 = 0;
                const $tc$958$5 = false;
                body = $tc$958$0;
                start = $tc$958$1;
                index = $tc$958$2;
                depth = $tc$958$3;
                mode = $tc$958$4;
                escaped = $tc$958$5;
                continue;
              } else {
                const $tc$969$0 = body;
                const $tc$969$1 = start;
                const $tc$969$2 = $addI(index, 1);
                const $tc$969$3 = depth;
                const $tc$969$4 = 3;
                const $tc$969$5 = false;
                body = $tc$969$0;
                start = $tc$969$1;
                index = $tc$969$2;
                depth = $tc$969$3;
                mode = $tc$969$4;
                escaped = $tc$969$5;
                continue;
              }
            } else {
              if (escaped) {
                const $tc$982$0 = body;
                const $tc$982$1 = start;
                const $tc$982$2 = $addI(index, 1);
                const $tc$982$3 = depth;
                const $tc$982$4 = mode;
                const $tc$982$5 = false;
                body = $tc$982$0;
                start = $tc$982$1;
                index = $tc$982$2;
                depth = $tc$982$3;
                mode = $tc$982$4;
                escaped = $tc$982$5;
                continue;
              } else {
                if (c === "\\") {
                  const $tc$996$0 = body;
                  const $tc$996$1 = start;
                  const $tc$996$2 = $addI(index, 1);
                  const $tc$996$3 = depth;
                  const $tc$996$4 = mode;
                  const $tc$996$5 = true;
                  body = $tc$996$0;
                  start = $tc$996$1;
                  index = $tc$996$2;
                  depth = $tc$996$3;
                  mode = $tc$996$4;
                  escaped = $tc$996$5;
                  continue;
                } else {
                  if ($eqI(mode, 1) && c === "\"") {
                    const $tc$1014$0 = body;
                    const $tc$1014$1 = start;
                    const $tc$1014$2 = $addI(index, 1);
                    const $tc$1014$3 = depth;
                    const $tc$1014$4 = 0;
                    const $tc$1014$5 = false;
                    body = $tc$1014$0;
                    start = $tc$1014$1;
                    index = $tc$1014$2;
                    depth = $tc$1014$3;
                    mode = $tc$1014$4;
                    escaped = $tc$1014$5;
                    continue;
                  } else {
                    if ($eqI(mode, 2) && c === "'") {
                      const $tc$1032$0 = body;
                      const $tc$1032$1 = start;
                      const $tc$1032$2 = $addI(index, 1);
                      const $tc$1032$3 = depth;
                      const $tc$1032$4 = 0;
                      const $tc$1032$5 = false;
                      body = $tc$1032$0;
                      start = $tc$1032$1;
                      index = $tc$1032$2;
                      depth = $tc$1032$3;
                      mode = $tc$1032$4;
                      escaped = $tc$1032$5;
                      continue;
                    } else {
                      const $tc$1043$0 = body;
                      const $tc$1043$1 = start;
                      const $tc$1043$2 = $addI(index, 1);
                      const $tc$1043$3 = depth;
                      const $tc$1043$4 = mode;
                      const $tc$1043$5 = false;
                      body = $tc$1043$0;
                      start = $tc$1043$1;
                      index = $tc$1043$2;
                      depth = $tc$1043$3;
                      mode = $tc$1043$4;
                      escaped = $tc$1043$5;
                      continue;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    function parseFmtExpr(outerSt, text, base) {
      if ($eqI($length(text), 0)) {
        return failAt(outerSt, $field(T, "pointSpan")(base), "Format interpolation cannot be empty.");
      } else {
        return (($match$1067) => {
          if ($match$1067.$t === "LexErr") {
            const e = $match$1067;
            return $makeVariant("PErr", "PResult", ["diags"], [$map((d) => remapFmtDiag(base, d), e.f[0])]);
          }
          if ($match$1067.$t === "LexOk") {
            const l = $match$1067;
            return (() => {
              const innerSt = $makeRecord("PSt", ["path", "toks", "index", "nextId", "inMatchArms"], [outerSt.f[0], $map((t) => remapFmtToken(base, t), l.f[0]), 0, outerSt.f[3], false]);
              return (($match$1102) => {
                if ($match$1102.$t === "PErr") {
                  const e = $match$1102;
                  return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                }
                if ($match$1102.$t === "POk") {
                  const parsed = $match$1102;
                  return (() => {
                    if (isEof(parsed.f[0])) {
                      return ok(withNextId(outerSt, parsed.f[0].f[3]), parsed.f[1]);
                    } else {
                      return failAt(parsed.f[0], currentSpan(parsed.f[0]), "Format interpolation must contain exactly one expression.");
                    }
                  })();
                }
                throw $matchFail("src/syntax/parser.pf", 1102);
              })(pExpr(innerSt, 1));
            })();
          }
          throw $matchFail("src/syntax/parser.pf", 1067);
        })($field(Lex, "lex")(outerSt.f[0], text));
      }
    }
    function parseFmtParts(st, start, body, index, literal, parts) {
      while (true) {
        if ($geI(index, $length(body))) {
          return ok(st, $reverse(appendFmtLiteral(parts, literal)));
        } else {
          const c = fmtCharAt(body, index);
          if (c === "\\") {
            const next = fmtCharAt(body, $addI(index, 1));
            const $match$1171 = fmtEscapeValue(next);
            if ($match$1171.$t === "None") {
              return (() => {
                return failAt(st, $field(T, "pointSpan")(fmtBasePos(start, body, index)), "Unknown format string escape.");
              })();
            }
            if ($match$1171.$t === "Some") {
              const escaped = $match$1171;
              return (() => {
                return parseFmtParts(st, start, body, $addI(index, 2), $concatS(literal, escaped.f[0]), parts);
              })();
            }
            throw $matchFail("src/syntax/parser.pf", 1171);
          } else {
            if (c === "{") {
              const withLiteral = appendFmtLiteral(parts, literal);
              const $match$1213 = scanFmtHole(body, $addI(index, 1), $addI(index, 1), 1, 0, false);
              if ($match$1213.$t === "FmtHoleErr") {
                const e = $match$1213;
                return (() => {
                  return failAt(st, $field(T, "pointSpan")(fmtBasePos(start, body, index)), e.f[0]);
                })();
              }
              if ($match$1213.$t === "FmtHoleOk") {
                const found = $match$1213;
                return (() => {
                  const hole = found.f[0];
                  return (($match$1245) => {
                    if ($match$1245.$t === "PErr") {
                      const e = $match$1245;
                      return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                    }
                    if ($match$1245.$t === "POk") {
                      const parsed = $match$1245;
                      return (() => {
                        return parseFmtParts(parsed.f[0], start, body, hole.f[1], "", $cons($field(A, "fmtExpr")(parsed.f[1]), withLiteral));
                      })();
                    }
                    throw $matchFail("src/syntax/parser.pf", 1245);
                  })(parseFmtExpr(st, hole.f[0], fmtBasePos(start, body, $addI(index, 1))));
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 1213);
            } else {
              if (c === "}") {
                return failAt(st, $field(T, "pointSpan")(fmtBasePos(start, body, index)), "Unmatched '}' in format string.");
              } else {
                const $tc$1309$0 = st;
                const $tc$1309$1 = start;
                const $tc$1309$2 = body;
                const $tc$1309$3 = $addI(index, 1);
                const $tc$1309$4 = $concatS(literal, c);
                const $tc$1309$5 = parts;
                st = $tc$1309$0;
                start = $tc$1309$1;
                body = $tc$1309$2;
                index = $tc$1309$3;
                literal = $tc$1309$4;
                parts = $tc$1309$5;
                continue;
              }
            }
          }
        }
      }
    }
    function pFormatToken(st0, id, start, body) {
      const afterToken = advance(st0);
      return (($match$1320) => {
        if ($match$1320.$t === "PErr") {
          const e = $match$1320;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$1320.$t === "POk") {
          const parsed = $match$1320;
          return (() => {
            return ok(parsed.f[0], $field(A, "eFmt")(id, parsed.f[1], start));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 1320);
      })(parseFmtParts(afterToken, start, body, 0, "", []));
    }
    function parseModule(path, tokens) {
      const st = $makeRecord("PSt", ["path", "toks", "index", "nextId", "inMatchArms"], [path, tokens, 0, 1, false]);
      return (($match$1354) => {
        if ($match$1354.$t === "PErr") {
          const e = $match$1354;
          return $makeVariant("ParseErr", "ParseResult", ["diags"], [e.f[0]]);
        }
        if ($match$1354.$t === "POk") {
          const o = $match$1354;
          return $makeVariant("ParseOk", "ParseResult", ["module"], [$field(A, "mkModule")(path, o.f[1], o.f[0].f[3])]);
        }
        throw $matchFail("src/syntax/parser.pf", 1354);
      })(pModuleLoop(st, []));
    }
    function pModuleLoop(st, acc) {
      while (true) {
        if (isEof(st)) {
          return ok(st, $reverse(acc));
        } else {
          if (atOp(st, ";")) {
            const $tc$1394$0 = advance(st);
            const $tc$1394$1 = acc;
            st = $tc$1394$0;
            acc = $tc$1394$1;
            continue;
          } else {
            const $match$1396 = pStmt(st);
            if ($match$1396.$t === "PErr") {
              const e = $match$1396;
              return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
            }
            if ($match$1396.$t === "POk") {
              const s = $match$1396;
              const $tc$1411$0 = s.f[0];
              const $tc$1411$1 = $cons(s.f[1], acc);
              st = $tc$1411$0;
              acc = $tc$1411$1;
              continue;
            }
            throw $matchFail("src/syntax/parser.pf", 1396);
          }
        }
      }
    }
    function pStmt(st) {
      if (atKw(st, "let")) {
        return pLet(st);
      } else {
        if (atKw(st, "var")) {
          return pVar(st);
        } else {
          if (atKw(st, "return")) {
            return pReturn(st);
          } else {
            if (atKw(st, "if")) {
              return pIfStmt(st);
            } else {
              if (atKw(st, "while")) {
                return pWhile(st);
              } else {
                if (atKw(st, "import")) {
                  return pImport(st);
                } else {
                  if (atKw(st, "export")) {
                    return pExport(st);
                  } else {
                    if (atKw(st, "type")) {
                      return pTypeStmt(st, false);
                    } else {
                      if (atKw(st, "extern")) {
                        return pExternStmt(st);
                      } else {
                        if (atKw(st, "generic")) {
                          return pGenericDecl(st);
                        } else {
                          if (atKw(st, "memo")) {
                            return pMemoFunction(st, false);
                          } else {
                            if (atKw(st, "function")) {
                              return pFunction(st, false, false);
                            } else {
                              if (atKw(st, "async")) {
                                return pAsyncProc(st, false);
                              } else {
                                if (atKw(st, "proc")) {
                                  return pProc(st, false, false);
                                } else {
                                  return pAssignOrExprStmt(st);
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    function pLet(st) {
      const start = currentSpan(st);
      const st1 = advance(st);
      return (($match$1562) => {
        if ($match$1562.$t === "PErr") {
          const e = $match$1562;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$1562.$t === "POk") {
          const n = $match$1562;
          return (() => {
            return (($match$1571) => {
              if ($match$1571.$t === "PErr") {
                const e = $match$1571;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$1571.$t === "POk") {
                const eq = $match$1571;
                return (() => {
                  return (($match$1582) => {
                    if ($match$1582.$t === "PErr") {
                      const e = $match$1582;
                      return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                    }
                    if ($match$1582.$t === "POk") {
                      const init = $match$1582;
                      return (() => {
                        return (($match$1592) => {
                          if ($match$1592.$t === "PErr") {
                            const e = $match$1592;
                            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                          }
                          if ($match$1592.$t === "POk") {
                            const semi = $match$1592;
                            return (() => {
                              const f = freshId(semi.f[0]);
                              return ok(f.f[0], $field(A, "sLet")(f.f[1], n.f[1], init.f[1], spanFromStartToPrev(start, semi.f[0])));
                            })();
                          }
                          throw $matchFail("src/syntax/parser.pf", 1592);
                        })(expectOp(init.f[0], ";", "after let initializer"));
                      })();
                    }
                    throw $matchFail("src/syntax/parser.pf", 1582);
                  })(pExpr(eq.f[0], 1));
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 1571);
            })(expectOp(n.f[0], "=", "after let name"));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 1562);
      })(expectIdent(st1, "after let"));
    }
    function pVar(st) {
      const start = currentSpan(st);
      const st1 = advance(st);
      return (($match$1640) => {
        if ($match$1640.$t === "PErr") {
          const e = $match$1640;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$1640.$t === "POk") {
          const n = $match$1640;
          return (() => {
            return (($match$1649) => {
              if ($match$1649.$t === "PErr") {
                const e = $match$1649;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$1649.$t === "POk") {
                const eq = $match$1649;
                return (() => {
                  return (($match$1660) => {
                    if ($match$1660.$t === "PErr") {
                      const e = $match$1660;
                      return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                    }
                    if ($match$1660.$t === "POk") {
                      const init = $match$1660;
                      return (() => {
                        return (($match$1670) => {
                          if ($match$1670.$t === "PErr") {
                            const e = $match$1670;
                            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                          }
                          if ($match$1670.$t === "POk") {
                            const semi = $match$1670;
                            return (() => {
                              const f = freshId(semi.f[0]);
                              return ok(f.f[0], $field(A, "sVar")(f.f[1], n.f[1], init.f[1], spanFromStartToPrev(start, semi.f[0])));
                            })();
                          }
                          throw $matchFail("src/syntax/parser.pf", 1670);
                        })(expectOp(init.f[0], ";", "after var initializer"));
                      })();
                    }
                    throw $matchFail("src/syntax/parser.pf", 1660);
                  })(pExpr(eq.f[0], 1));
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 1649);
            })(expectOp(n.f[0], "=", "after var name"));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 1640);
      })(expectIdent(st1, "after var"));
    }
    function pReturn(st) {
      const start = currentSpan(st);
      const st1 = advance(st);
      if (atOp(st1, ";")) {
        const st2 = advance(st1);
        const f = freshId(st2);
        return ok(f.f[0], $field(A, "sReturn")(f.f[1], $makeVariant("None", "Option", [], []), spanFromStartToPrev(start, st2)));
      } else {
        if (atOp(st1, "}") || isEof(st1)) {
          const f = freshId(st1);
          return ok(f.f[0], $field(A, "sReturn")(f.f[1], $makeVariant("None", "Option", [], []), spanFromStartToPrev(start, st1)));
        } else {
          return (($match$1772) => {
            if ($match$1772.$t === "PErr") {
              const e = $match$1772;
              return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
            }
            if ($match$1772.$t === "POk") {
              const v = $match$1772;
              return (() => {
                const st2 = eatOp(v.f[0], ";");
                const f = freshId(st2);
                return ok(f.f[0], $field(A, "sReturn")(f.f[1], $makeVariant("Some", "Option", ["value"], [v.f[1]]), spanFromStartToPrev(start, st2)));
              })();
            }
            throw $matchFail("src/syntax/parser.pf", 1772);
          })(pExpr(st1, 1));
        }
      }
    }
    function pIfStmt(st) {
      const start = currentSpan(st);
      const st1 = advance(st);
      return (($match$1820) => {
        if ($match$1820.$t === "PErr") {
          const e = $match$1820;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$1820.$t === "POk") {
          const cond = $match$1820;
          return (() => {
            return (($match$1829) => {
              if ($match$1829.$t === "PErr") {
                const e = $match$1829;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$1829.$t === "POk") {
                const thenKw = $match$1829;
                return (() => {
                  return (($match$1840) => {
                    if ($match$1840.$t === "PErr") {
                      const e = $match$1840;
                      return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                    }
                    if ($match$1840.$t === "POk") {
                      const tb = $match$1840;
                      return (() => {
                        if (atKw(tb.f[0], "else")) {
                          const elseStart = advance(tb.f[0]);
                          if (atKw(elseStart, "if")) {
                            return (($match$1863) => {
                              if ($match$1863.$t === "PErr") {
                                const e = $match$1863;
                                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                              }
                              if ($match$1863.$t === "POk") {
                                const inner = $match$1863;
                                return (() => {
                                  const f = freshId(inner.f[0]);
                                  return ok(f.f[0], $field(A, "sIf")(f.f[1], cond.f[1], tb.f[1].f[0], $makeVariant("Some", "Option", ["value"], [[inner.f[1]]]), spanFromStartToPrev(start, inner.f[0])));
                                })();
                              }
                              throw $matchFail("src/syntax/parser.pf", 1863);
                            })(pIfStmt(elseStart));
                          } else {
                            return (($match$1901) => {
                              if ($match$1901.$t === "PErr") {
                                const e = $match$1901;
                                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                              }
                              if ($match$1901.$t === "POk") {
                                const eb = $match$1901;
                                return (() => {
                                  const f = freshId(eb.f[0]);
                                  return ok(f.f[0], $field(A, "sIf")(f.f[1], cond.f[1], tb.f[1].f[0], $makeVariant("Some", "Option", ["value"], [eb.f[1].f[0]]), spanFromStartToPrev(start, eb.f[0])));
                                })();
                              }
                              throw $matchFail("src/syntax/parser.pf", 1901);
                            })(pBlock(elseStart));
                          }
                        } else {
                          const f = freshId(tb.f[0]);
                          return ok(f.f[0], $field(A, "sIf")(f.f[1], cond.f[1], tb.f[1].f[0], $makeVariant("None", "Option", [], []), spanFromStartToPrev(start, tb.f[0])));
                        }
                      })();
                    }
                    throw $matchFail("src/syntax/parser.pf", 1840);
                  })(pBlock(thenKw.f[0]));
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 1829);
            })(expectKw(cond.f[0], "then", "after if condition"));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 1820);
      })(pExpr(st1, 1));
    }
    function pWhile(st) {
      const start = currentSpan(st);
      const st1 = advance(st);
      return (($match$1979) => {
        if ($match$1979.$t === "PErr") {
          const e = $match$1979;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$1979.$t === "POk") {
          const open = $match$1979;
          return (() => {
            return (($match$1989) => {
              if ($match$1989.$t === "PErr") {
                const e = $match$1989;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$1989.$t === "POk") {
                const cond = $match$1989;
                return (() => {
                  return (($match$1999) => {
                    if ($match$1999.$t === "PErr") {
                      const e = $match$1999;
                      return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                    }
                    if ($match$1999.$t === "POk") {
                      const close = $match$1999;
                      return (() => {
                        return (($match$2010) => {
                          if ($match$2010.$t === "PErr") {
                            const e = $match$2010;
                            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                          }
                          if ($match$2010.$t === "POk") {
                            const body = $match$2010;
                            return (() => {
                              const f = freshId(body.f[0]);
                              return ok(f.f[0], $field(A, "sWhile")(f.f[1], cond.f[1], body.f[1].f[0], spanFromStartToPrev(start, body.f[0])));
                            })();
                          }
                          throw $matchFail("src/syntax/parser.pf", 2010);
                        })(pBlock(close.f[0]));
                      })();
                    }
                    throw $matchFail("src/syntax/parser.pf", 1999);
                  })(expectOp(cond.f[0], ")", "after while condition"));
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 1989);
            })(pExpr(open.f[0], 1));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 1979);
      })(expectOp(st1, "(", "after while"));
    }
    function pAssignOrExprStmt(st) {
      const start = currentSpan(st);
      return (($match$2053) => {
        if ($match$2053.$t === "PErr") {
          const e = $match$2053;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$2053.$t === "POk") {
          const lhs = $match$2053;
          return (() => {
            if (atOp(lhs.f[0], "=")) {
              const afterEq = advance(lhs.f[0]);
              return (($match$2072) => {
                if ($match$2072.$t === "PErr") {
                  const e = $match$2072;
                  return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                }
                if ($match$2072.$t === "POk") {
                  const rhs = $match$2072;
                  return (() => {
                    return (($match$2081) => {
                      if ($match$2081.$t === "PErr") {
                        const e = $match$2081;
                        return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                      }
                      if ($match$2081.$t === "POk") {
                        const semi = $match$2081;
                        return (() => {
                          return (($match$2092) => {
                            if ($match$2092.$t === "Some") {
                              const n = $match$2092;
                              return (() => {
                                const f = freshId(semi.f[0]);
                                return ok(f.f[0], $field(A, "sAssign")(f.f[1], n.f[0], rhs.f[1], spanFromStartToPrev(start, semi.f[0])));
                              })();
                            }
                            if ($match$2092.$t === "None") {
                              return (() => {
                                return (($match$2124) => {
                                  if ($match$2124.$t === "Some") {
                                    const parts = $match$2124;
                                    return (() => {
                                      const f = freshId(semi.f[0]);
                                      return ok(f.f[0], $field(A, "sIndexAssign")(f.f[1], parts.f[0].f[0], parts.f[0].f[1], rhs.f[1], spanFromStartToPrev(start, semi.f[0])));
                                    })();
                                  }
                                  if ($match$2124.$t === "None") {
                                    return failAt(lhs.f[0], $field(A, "exprSpan")(lhs.f[1]), "Invalid assignment target.");
                                  }
                                  throw $matchFail("src/syntax/parser.pf", 2124);
                                })($field(A, "assignIndexParts")(lhs.f[1]));
                              })();
                            }
                            throw $matchFail("src/syntax/parser.pf", 2092);
                          })($field(A, "assignVarName")(lhs.f[1]));
                        })();
                      }
                      throw $matchFail("src/syntax/parser.pf", 2081);
                    })(expectOp(rhs.f[0], ";", "after assignment"));
                  })();
                }
                throw $matchFail("src/syntax/parser.pf", 2072);
              })(pExpr(afterEq, 1));
            } else {
              const st2 = eatOp(lhs.f[0], ";");
              const f = freshId(st2);
              return ok(f.f[0], $field(A, "sExpr")(f.f[1], lhs.f[1], spanFromStartToPrev(start, st2)));
            }
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 2053);
      })(pExpr(st, 1));
    }
    function pBlock(st) {
      const start = currentSpan(st);
      return (($match$2206) => {
        if ($match$2206.$t === "PErr") {
          const e = $match$2206;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$2206.$t === "POk") {
          const open = $match$2206;
          return pBlockLoop(open.f[0], start, []);
        }
        throw $matchFail("src/syntax/parser.pf", 2206);
      })(expectOp(st, "{", "to start block"));
    }
    function pBlockLoop(st, start, acc) {
      while (true) {
        if (atOp(st, "}")) {
          const st2 = advance(st);
          return ok(st2, $makeRecord("BlockOut", ["stmts", "span"], [$reverse(acc), spanFromStartToPrev(start, st2)]));
        } else {
          if (isEof(st)) {
            return failHere(st, "Expected '}' to close block.");
          } else {
            if (atOp(st, ";")) {
              const $tc$2261$0 = advance(st);
              const $tc$2261$1 = start;
              const $tc$2261$2 = acc;
              st = $tc$2261$0;
              start = $tc$2261$1;
              acc = $tc$2261$2;
              continue;
            } else {
              const $match$2263 = pStmt(st);
              if ($match$2263.$t === "PErr") {
                const e = $match$2263;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$2263.$t === "POk") {
                const s = $match$2263;
                const $tc$2279$0 = s.f[0];
                const $tc$2279$1 = start;
                const $tc$2279$2 = $cons(s.f[1], acc);
                st = $tc$2279$0;
                start = $tc$2279$1;
                acc = $tc$2279$2;
                continue;
              }
              throw $matchFail("src/syntax/parser.pf", 2263);
            }
          }
        }
      }
    }
    function pImport(st) {
      const start = currentSpan(st);
      const st1 = advance(st);
      return (($match$2293) => {
        if ($match$2293.$t === "PErr") {
          const e = $match$2293;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$2293.$t === "POk") {
          const spec = $match$2293;
          return (() => {
            return (($match$2301) => {
              if ($match$2301.$t === "PErr") {
                const e = $match$2301;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$2301.$t === "POk") {
                const fromKw = $match$2301;
                return (() => {
                  return (($match$2312) => {
                    if ($match$2312.$t === "PErr") {
                      const e = $match$2312;
                      return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                    }
                    if ($match$2312.$t === "POk") {
                      const path = $match$2312;
                      return (() => {
                        const st2 = eatOp(path.f[0], ";");
                        const f = freshId(st2);
                        return ok(f.f[0], $field(A, "sImport")(f.f[1], spec.f[1], path.f[1], spanFromStartToPrev(start, st2)));
                      })();
                    }
                    throw $matchFail("src/syntax/parser.pf", 2312);
                  })(expectString(fromKw.f[0], "after from"));
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 2301);
            })(expectKw(spec.f[0], "from", "after import spec"));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 2293);
      })(pImportSpec(st1));
    }
    function pImportSpec(st) {
      if (atOp(st, "{")) {
        return pImportNames(advance(st), []);
      } else {
        if (atOp(st, "*")) {
          const st1 = advance(st);
          if (atKw(st1, "as")) {
            return (($match$2377) => {
              if ($match$2377.$t === "PErr") {
                const e = $match$2377;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$2377.$t === "POk") {
                const alias = $match$2377;
                return ok(alias.f[0], $field(A, "iNamespace")(alias.f[1]));
              }
              throw $matchFail("src/syntax/parser.pf", 2377);
            })(expectIdent(advance(st1), "after import * as"));
          } else {
            return ok(st1, $field(A, "iStar")());
          }
        } else {
          return failHere(st, "Expected import spec.");
        }
      }
    }
    function pImportNames(st, acc) {
      if (atOp(st, "}")) {
        return ok(advance(st), $field(A, "iNames")($reverse(acc)));
      } else {
        return (($match$2429) => {
          if ($match$2429.$t === "PErr") {
            const e = $match$2429;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$2429.$t === "POk") {
            const name = $match$2429;
            return (() => {
              if (atKw(name.f[0], "as")) {
                return (($match$2443) => {
                  if ($match$2443.$t === "PErr") {
                    const e = $match$2443;
                    return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                  }
                  if ($match$2443.$t === "POk") {
                    const a = $match$2443;
                    return pImportNameTail(a.f[0], name.f[1], $makeVariant("Some", "Option", ["value"], [a.f[1]]), acc);
                  }
                  throw $matchFail("src/syntax/parser.pf", 2443);
                })(expectIdent(advance(name.f[0]), "after import alias"));
              } else {
                return pImportNameTail(name.f[0], name.f[1], $makeVariant("None", "Option", [], []), acc);
              }
            })();
          }
          throw $matchFail("src/syntax/parser.pf", 2429);
        })(expectIdent(st, "in import list"));
      }
    }
    function pImportNameTail(st, name, alias, acc) {
      const entry = $field(A, "mkImportName")(name, alias);
      if (atOp(st, ",")) {
        return pImportNames(advance(st), $cons(entry, acc));
      } else {
        if (atOp(st, "}")) {
          return pImportNames(st, $cons(entry, acc));
        } else {
          return failHere(st, "Expected ',' or '}' in import list.");
        }
      }
    }
    function pExport(st) {
      const start = currentSpan(st);
      const st1 = advance(st);
      if (atKw(st1, "extern")) {
        return failHere(st1, "Extern declarations are private and cannot be exported.");
      } else {
        if (atKw(st1, "var")) {
          return failHere(st1, "Mutable var declarations cannot be exported.");
        } else {
          if (atKw(st1, "opaque")) {
            return (($match$2548) => {
              if ($match$2548.$t === "PErr") {
                const e = $match$2548;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$2548.$t === "POk") {
                const inner = $match$2548;
                return (() => {
                  const f = freshId(inner.f[0]);
                  return ok(f.f[0], $field(A, "sExport")(f.f[1], inner.f[1], spanFromStartToPrev(start, inner.f[0])));
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 2548);
            })(pTypeStmt(advance(st1), true));
          } else {
            return (($match$2582) => {
              if ($match$2582.$t === "PErr") {
                const e = $match$2582;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$2582.$t === "POk") {
                const inner = $match$2582;
                return (() => {
                  const f = freshId(inner.f[0]);
                  return ok(f.f[0], $field(A, "sExport")(f.f[1], inner.f[1], spanFromStartToPrev(start, inner.f[0])));
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 2582);
            })(pStmt(st1));
          }
        }
      }
    }
    function pGenericDecl(st) {
      const st1 = advance(st);
      if (atKw(st1, "memo")) {
        return pMemoFunction(st1, true);
      } else {
        if (atKw(st1, "function")) {
          return pFunction(st1, true, false);
        } else {
          if (atKw(st1, "async")) {
            return pAsyncProc(st1, true);
          } else {
            if (atKw(st1, "proc")) {
              return pProc(st1, true, false);
            } else {
              return failHere(st1, "Expected function, memo function, async proc, or proc after generic.");
            }
          }
        }
      }
    }
    function pMemoFunction(st, isGeneric) {
      const st1 = advance(st);
      if (atKw(st1, "function")) {
        return pFunction(st1, isGeneric, true);
      } else {
        return failHere(st1, "Expected function after memo.");
      }
    }
    function pAsyncProc(st, isGeneric) {
      const st1 = advance(st);
      if (atKw(st1, "proc")) {
        return pProc(st1, isGeneric, true);
      } else {
        return failHere(st1, "Expected proc after async.");
      }
    }
    function pFunction(st, isGeneric, isMemo) {
      const start = currentSpan(st);
      const st1 = advance(st);
      return (($match$2719) => {
        if ($match$2719.$t === "PErr") {
          const e = $match$2719;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$2719.$t === "POk") {
          const name = $match$2719;
          return (() => {
            return (($match$2728) => {
              if ($match$2728.$t === "PErr") {
                const e = $match$2728;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$2728.$t === "POk") {
                const ps = $match$2728;
                return (() => {
                  return (($match$2737) => {
                    if ($match$2737.$t === "PErr") {
                      const e = $match$2737;
                      return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                    }
                    if ($match$2737.$t === "POk") {
                      const body = $match$2737;
                      return (() => {
                        const f = freshId(body.f[0]);
                        return ok(f.f[0], $field(A, "sFun")(f.f[1], name.f[1], ps.f[1], body.f[1].f[0], $field(A, "pureFn")(isMemo, isGeneric), spanFromStartToPrev(start, body.f[0])));
                      })();
                    }
                    throw $matchFail("src/syntax/parser.pf", 2737);
                  })(pBlock(ps.f[0]));
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 2728);
            })(pParenParams(name.f[0]));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 2719);
      })(expectIdent(st1, "after function"));
    }
    function pProc(st, isGeneric, isAsync) {
      const start = currentSpan(st);
      const st1 = advance(st);
      return (($match$2790) => {
        if ($match$2790.$t === "PErr") {
          const e = $match$2790;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$2790.$t === "POk") {
          const name = $match$2790;
          return (() => {
            return (($match$2799) => {
              if ($match$2799.$t === "PErr") {
                const e = $match$2799;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$2799.$t === "POk") {
                const ps = $match$2799;
                return (() => {
                  return (($match$2808) => {
                    if ($match$2808.$t === "PErr") {
                      const e = $match$2808;
                      return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                    }
                    if ($match$2808.$t === "POk") {
                      const body = $match$2808;
                      return (() => {
                        const f = freshId(body.f[0]);
                        return ok(f.f[0], $field(A, "sFun")(f.f[1], name.f[1], ps.f[1], body.f[1].f[0], $field(A, "procFn")(isAsync, isGeneric), spanFromStartToPrev(start, body.f[0])));
                      })();
                    }
                    throw $matchFail("src/syntax/parser.pf", 2808);
                  })(pBlock(ps.f[0]));
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 2799);
            })(pParenParams(name.f[0]));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 2790);
      })(expectIdent(st1, "after proc"));
    }
    function pParenParams(st) {
      return (($match$2853) => {
        if ($match$2853.$t === "PErr") {
          const e = $match$2853;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$2853.$t === "POk") {
          const open = $match$2853;
          return pParamList(open.f[0], []);
        }
        throw $matchFail("src/syntax/parser.pf", 2853);
      })(expectOp(st, "(", "before parameter list"));
    }
    function pParamList(st, acc) {
      if (atOp(st, ")")) {
        return ok(advance(st), $reverse(acc));
      } else {
        return (($match$2882) => {
          if ($match$2882.$t === "PErr") {
            const e = $match$2882;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$2882.$t === "POk") {
            const p = $match$2882;
            return (() => {
              if (atOp(p.f[0], ",")) {
                return pParamList(advance(p.f[0]), $cons(p.f[1], acc));
              } else {
                if (atOp(p.f[0], ")")) {
                  return pParamList(p.f[0], $cons(p.f[1], acc));
                } else {
                  return failHere(p.f[0], "Expected ',' or ')' in parameter list.");
                }
              }
            })();
          }
          throw $matchFail("src/syntax/parser.pf", 2882);
        })(expectParamName(st, "in parameter list"));
      }
    }
    function pTypeStmt(st, isOpaque) {
      const start = currentSpan(st);
      const st1 = advance(st);
      return (($match$2942) => {
        if ($match$2942.$t === "PErr") {
          const e = $match$2942;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$2942.$t === "POk") {
          const name = $match$2942;
          return (() => {
            return (($match$2951) => {
              if ($match$2951.$t === "PErr") {
                const e = $match$2951;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$2951.$t === "POk") {
                const eq = $match$2951;
                return (() => {
                  return (($match$2962) => {
                    if ($match$2962.$t === "PErr") {
                      const e = $match$2962;
                      return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                    }
                    if ($match$2962.$t === "POk") {
                      const open = $match$2962;
                      return (() => {
                        if (atOp(open.f[0], "|")) {
                          return (($match$2978) => {
                            if ($match$2978.$t === "PErr") {
                              const e = $match$2978;
                              return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                            }
                            if ($match$2978.$t === "POk") {
                              const vs = $match$2978;
                              return (() => {
                                const st2 = eatOp(vs.f[0], ";");
                                const f = freshId(st2);
                                return ok(f.f[0], $field(A, "sType")(f.f[1], $field(A, "unionDecl")(name.f[1], vs.f[1]), isOpaque, spanFromStartToPrev(start, st2)));
                              })();
                            }
                            throw $matchFail("src/syntax/parser.pf", 2978);
                          })(pVariants(open.f[0], []));
                        } else {
                          return (($match$3021) => {
                            if ($match$3021.$t === "PErr") {
                              const e = $match$3021;
                              return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                            }
                            if ($match$3021.$t === "POk") {
                              const fs = $match$3021;
                              return (() => {
                                const st2 = eatOp(fs.f[0], ";");
                                const f = freshId(st2);
                                return ok(f.f[0], $field(A, "sType")(f.f[1], $field(A, "recordDecl")(name.f[1], fs.f[1]), isOpaque, spanFromStartToPrev(start, st2)));
                              })();
                            }
                            throw $matchFail("src/syntax/parser.pf", 3021);
                          })(pRecordFields(open.f[0], []));
                        }
                      })();
                    }
                    throw $matchFail("src/syntax/parser.pf", 2962);
                  })(expectOp(eq.f[0], "{", "to start type body"));
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 2951);
            })(expectOp(name.f[0], "=", "after type name"));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 2942);
      })(expectIdent(st1, "after type"));
    }
    function pFieldDecl(st) {
      const isGen = atKw(st, "generic");
      const st1 = choose(isGen, advance(st), st);
      return (($match$3082) => {
        if ($match$3082.$t === "PErr") {
          const e = $match$3082;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$3082.$t === "POk") {
          const n = $match$3082;
          return ok(n.f[0], $field(A, "mkFieldDecl")(n.f[1], isGen));
        }
        throw $matchFail("src/syntax/parser.pf", 3082);
      })(expectIdent(st1, "as field name"));
    }
    function pRecordFields(st, acc) {
      if (atOp(st, "}")) {
        return ok(advance(st), $reverse(acc));
      } else {
        return (($match$3115) => {
          if ($match$3115.$t === "PErr") {
            const e = $match$3115;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$3115.$t === "POk") {
            const f = $match$3115;
            return (() => {
              if (atOp(f.f[0], ",")) {
                return pRecordFields(advance(f.f[0]), $cons(f.f[1], acc));
              } else {
                if (atOp(f.f[0], "}")) {
                  return pRecordFields(f.f[0], $cons(f.f[1], acc));
                } else {
                  return failHere(f.f[0], "Expected ',' or '}' after record field.");
                }
              }
            })();
          }
          throw $matchFail("src/syntax/parser.pf", 3115);
        })(pFieldDecl(st));
      }
    }
    function pVariants(st, acc) {
      if (atOp(st, "}")) {
        return ok(advance(st), $reverse(acc));
      } else {
        if (atOp(st, "|")) {
          const st1 = advance(st);
          return (($match$3187) => {
            if ($match$3187.$t === "PErr") {
              const e = $match$3187;
              return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
            }
            if ($match$3187.$t === "POk") {
              const name = $match$3187;
              return (() => {
                if (atOp(name.f[0], ":")) {
                  return (($match$3201) => {
                    if ($match$3201.$t === "PErr") {
                      const e = $match$3201;
                      return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                    }
                    if ($match$3201.$t === "POk") {
                      const fs = $match$3201;
                      return pVariants(fs.f[0], $cons($field(A, "mkVariantDecl")(name.f[1], fs.f[1]), acc));
                    }
                    throw $matchFail("src/syntax/parser.pf", 3201);
                  })(pVariantFields(advance(name.f[0]), []));
                } else {
                  return pVariants(name.f[0], $cons($field(A, "mkVariantDecl")(name.f[1], []), acc));
                }
              })();
            }
            throw $matchFail("src/syntax/parser.pf", 3187);
          })(expectIdent(st1, "as variant name"));
        } else {
          return failHere(st, "Expected variant arm or '}' in union declaration.");
        }
      }
    }
    function pVariantFields(st, acc) {
      if (atOp(st, "|") || atOp(st, "}")) {
        return ok(st, $reverse(acc));
      } else {
        return (($match$3267) => {
          if ($match$3267.$t === "PErr") {
            const e = $match$3267;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$3267.$t === "POk") {
            const f = $match$3267;
            return (() => {
              if (atOp(f.f[0], ",")) {
                return pVariantFields(advance(f.f[0]), $cons(f.f[1], acc));
              } else {
                return pVariantFields(f.f[0], $cons(f.f[1], acc));
              }
            })();
          }
          throw $matchFail("src/syntax/parser.pf", 3267);
        })(pFieldDecl(st));
      }
    }
    function pExternStmt(st) {
      const start = currentSpan(st);
      const st1 = advance(st);
      if (atKw(st1, "function")) {
        return pExternAfterKind(advance(st1), start, $field(A, "externFunction")());
      } else {
        if (atKw(st1, "async")) {
          const st2 = advance(st1);
          if (atKw(st2, "proc")) {
            return pExternAfterKind(advance(st2), start, $field(A, "externProc")(true));
          } else {
            return failHere(st2, "Expected proc after extern async.");
          }
        } else {
          if (atKw(st1, "proc")) {
            return pExternAfterKind(advance(st1), start, $field(A, "externProc")(false));
          } else {
            return failHere(st1, "Expected function or proc after extern.");
          }
        }
      }
    }
    function pExternAfterKind(st, start, kind) {
      return (($match$3381) => {
        if ($match$3381.$t === "PErr") {
          const e = $match$3381;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$3381.$t === "POk") {
          const name = $match$3381;
          return (() => {
            return (($match$3390) => {
              if ($match$3390.$t === "PErr") {
                const e = $match$3390;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$3390.$t === "POk") {
                const params = $match$3390;
                return (() => {
                  return (($match$3399) => {
                    if ($match$3399.$t === "PErr") {
                      const e = $match$3399;
                      return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                    }
                    if ($match$3399.$t === "POk") {
                      const arrow = $match$3399;
                      return (() => {
                        return (($match$3410) => {
                          if ($match$3410.$t === "PErr") {
                            const e = $match$3410;
                            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                          }
                          if ($match$3410.$t === "POk") {
                            const ret = $match$3410;
                            return (() => {
                              const st2 = eatOp(ret.f[0], ";");
                              const f = freshId(st2);
                              const decl = $field(A, "mkExternDecl")(kind, name.f[1], params.f[1], ret.f[1], $makeVariant("None", "Option", [], []));
                              return ok(f.f[0], $field(A, "sExtern")(f.f[1], decl, spanFromStartToPrev(start, st2)));
                            })();
                          }
                          throw $matchFail("src/syntax/parser.pf", 3410);
                        })(pTypeExpr(arrow.f[0]));
                      })();
                    }
                    throw $matchFail("src/syntax/parser.pf", 3399);
                  })(expectOp(params.f[0], "->", "after extern parameters"));
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 3390);
            })(pTypedParams(name.f[0]));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 3381);
      })(expectIdent(st, "after extern kind"));
    }
    function pTypedParams(st) {
      return (($match$3461) => {
        if ($match$3461.$t === "PErr") {
          const e = $match$3461;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$3461.$t === "POk") {
          const open = $match$3461;
          return pTypedParamList(open.f[0], []);
        }
        throw $matchFail("src/syntax/parser.pf", 3461);
      })(expectOp(st, "(", "before extern parameter list"));
    }
    function pTypedParamList(st, acc) {
      if (atOp(st, ")")) {
        return ok(advance(st), $reverse(acc));
      } else {
        return (($match$3490) => {
          if ($match$3490.$t === "PErr") {
            const e = $match$3490;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$3490.$t === "POk") {
            const name = $match$3490;
            return (() => {
              return (($match$3499) => {
                if ($match$3499.$t === "PErr") {
                  const e = $match$3499;
                  return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                }
                if ($match$3499.$t === "POk") {
                  const colon = $match$3499;
                  return (() => {
                    return (($match$3510) => {
                      if ($match$3510.$t === "PErr") {
                        const e = $match$3510;
                        return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                      }
                      if ($match$3510.$t === "POk") {
                        const te = $match$3510;
                        return (() => {
                          const item = $field(A, "mkTypedParam")(name.f[1], te.f[1]);
                          if (atOp(te.f[0], ",")) {
                            return pTypedParamList(advance(te.f[0]), $cons(item, acc));
                          } else {
                            if (atOp(te.f[0], ")")) {
                              return pTypedParamList(te.f[0], $cons(item, acc));
                            } else {
                              return failHere(te.f[0], "Expected ',' or ')' in typed parameter list.");
                            }
                          }
                        })();
                      }
                      throw $matchFail("src/syntax/parser.pf", 3510);
                    })(pTypeExpr(colon.f[0]));
                  })();
                }
                throw $matchFail("src/syntax/parser.pf", 3499);
              })(expectOp(name.f[0], ":", "after typed parameter name"));
            })();
          }
          throw $matchFail("src/syntax/parser.pf", 3490);
        })(expectIdent(st, "in typed parameter list"));
      }
    }
    function pTypeExpr(st) {
      if (atKw(st, "proc")) {
        return pProcTypeExpr(st, false);
      } else {
        if (atKw(st, "async")) {
          return pAsyncProcTypeExpr(st);
        } else {
          if (atOp(st, "(")) {
            return pFunctionTypeExpr(st);
          } else {
            return (($match$3595) => {
              if ($match$3595.$t === "PErr") {
                const e = $match$3595;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$3595.$t === "POk") {
                const name = $match$3595;
                return (() => {
                  if (atOp(name.f[0], "<")) {
                    return (($match$3609) => {
                      if ($match$3609.$t === "PErr") {
                        const e = $match$3609;
                        return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                      }
                      if ($match$3609.$t === "POk") {
                        const args = $match$3609;
                        return ok(args.f[0], $field(A, "tyName")(name.f[1], args.f[1]));
                      }
                      throw $matchFail("src/syntax/parser.pf", 3609);
                    })(pTypeArgs(advance(name.f[0]), []));
                  } else {
                    return ok(name.f[0], $field(A, "tyName")(name.f[1], []));
                  }
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 3595);
            })(expectIdent(st, "as type name"));
          }
        }
      }
    }
    function pAsyncProcTypeExpr(st) {
      const st1 = advance(st);
      if (atKw(st1, "proc")) {
        return pProcTypeExpr(st1, true);
      } else {
        return failHere(st1, "Expected proc after async in procedure type.");
      }
    }
    function pProcTypeExpr(st, isAsync) {
      const st1 = advance(st);
      return (($match$3673) => {
        if ($match$3673.$t === "PErr") {
          const e = $match$3673;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$3673.$t === "POk") {
          const open = $match$3673;
          return (() => {
            return (($match$3683) => {
              if ($match$3683.$t === "PErr") {
                const e = $match$3683;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$3683.$t === "POk") {
                const params = $match$3683;
                return (() => {
                  return (($match$3693) => {
                    if ($match$3693.$t === "PErr") {
                      const e = $match$3693;
                      return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                    }
                    if ($match$3693.$t === "POk") {
                      const arrow = $match$3693;
                      return (() => {
                        return (($match$3704) => {
                          if ($match$3704.$t === "PErr") {
                            const e = $match$3704;
                            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                          }
                          if ($match$3704.$t === "POk") {
                            const ret = $match$3704;
                            return ok(ret.f[0], $field(A, "tyProc")(params.f[1], ret.f[1], isAsync));
                          }
                          throw $matchFail("src/syntax/parser.pf", 3704);
                        })(pTypeExpr(arrow.f[0]));
                      })();
                    }
                    throw $matchFail("src/syntax/parser.pf", 3693);
                  })(expectOp(params.f[0], "->", "after procedure type parameters"));
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 3683);
            })(pTypeExprList(open.f[0], []));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 3673);
      })(expectOp(st1, "(", "to start procedure type"));
    }
    function pTypeArgs(st, acc) {
      if (atOp(st, ">")) {
        return ok(advance(st), $reverse(acc));
      } else {
        return (($match$3742) => {
          if ($match$3742.$t === "PErr") {
            const e = $match$3742;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$3742.$t === "POk") {
            const te = $match$3742;
            return (() => {
              if (atOp(te.f[0], ",")) {
                return pTypeArgs(advance(te.f[0]), $cons(te.f[1], acc));
              } else {
                if (atOp(te.f[0], ">")) {
                  return pTypeArgs(te.f[0], $cons(te.f[1], acc));
                } else {
                  return failHere(te.f[0], "Expected ',' or '>' in type argument list.");
                }
              }
            })();
          }
          throw $matchFail("src/syntax/parser.pf", 3742);
        })(pTypeExpr(st));
      }
    }
    function pFunctionTypeExpr(st) {
      return (($match$3793) => {
        if ($match$3793.$t === "PErr") {
          const e = $match$3793;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$3793.$t === "POk") {
          const open = $match$3793;
          return (() => {
            return (($match$3803) => {
              if ($match$3803.$t === "PErr") {
                const e = $match$3803;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$3803.$t === "POk") {
                const params = $match$3803;
                return (() => {
                  return (($match$3813) => {
                    if ($match$3813.$t === "PErr") {
                      const e = $match$3813;
                      return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                    }
                    if ($match$3813.$t === "POk") {
                      const arrow = $match$3813;
                      return (() => {
                        return (($match$3824) => {
                          if ($match$3824.$t === "PErr") {
                            const e = $match$3824;
                            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                          }
                          if ($match$3824.$t === "POk") {
                            const ret = $match$3824;
                            return ok(ret.f[0], $field(A, "tyFun")(params.f[1], ret.f[1]));
                          }
                          throw $matchFail("src/syntax/parser.pf", 3824);
                        })(pTypeExpr(arrow.f[0]));
                      })();
                    }
                    throw $matchFail("src/syntax/parser.pf", 3813);
                  })(expectOp(params.f[0], "->", "after function type parameters"));
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 3803);
            })(pTypeExprList(open.f[0], []));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 3793);
      })(expectOp(st, "(", "to start function type"));
    }
    function pTypeExprList(st, acc) {
      if (atOp(st, ")")) {
        return ok(advance(st), $reverse(acc));
      } else {
        return (($match$3861) => {
          if ($match$3861.$t === "PErr") {
            const e = $match$3861;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$3861.$t === "POk") {
            const te = $match$3861;
            return (() => {
              if (atOp(te.f[0], ",")) {
                return pTypeExprList(advance(te.f[0]), $cons(te.f[1], acc));
              } else {
                if (atOp(te.f[0], ")")) {
                  return pTypeExprList(te.f[0], $cons(te.f[1], acc));
                } else {
                  return failHere(te.f[0], "Expected ',' or ')' in type expression list.");
                }
              }
            })();
          }
          throw $matchFail("src/syntax/parser.pf", 3861);
        })(pTypeExpr(st));
      }
    }
    function pExpr(st, minPrec) {
      return (($match$3912) => {
        if ($match$3912.$t === "PErr") {
          const e = $match$3912;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$3912.$t === "POk") {
          const left = $match$3912;
          return pInfix(left.f[0], left.f[1], minPrec);
        }
        throw $matchFail("src/syntax/parser.pf", 3912);
      })(pPrefix(st));
    }
    function pPrefix(st) {
      const start = currentSpan(st);
      const f = freshId(st);
      const id = f.f[1];
      const st0 = f.f[0];
      if (atKind(st, "TokInt")) {
        return ok(advance(st0), $field(A, "eInt")(id, parseCanonicalInt(tokText(st)), start));
      } else {
        if (atKind(st, "TokFloat")) {
          return ok(advance(st0), $field(A, "eFloat")(id, tokText(st), start));
        } else {
          if (atKind(st, "TokBool")) {
            return ok(advance(st0), $field(A, "eBool")(id, tokText(st) === "true", start));
          } else {
            if (atKind(st, "TokStr")) {
              return ok(advance(st0), $field(A, "eStr")(id, tokText(st), start));
            } else {
              if (atKind(st, "TokRawStr")) {
                return ok(advance(st0), $field(A, "eStr")(id, tokText(st), start));
              } else {
                if (atKind(st, "TokFmtStr")) {
                  return pFormatToken(st0, id, start, tokText(st));
                } else {
                  if (atKind(st, "TokChar")) {
                    return ok(advance(st0), $field(A, "eChar")(id, tokText(st), start));
                  } else {
                    if (atKind(st, "TokByte")) {
                      return ok(advance(st0), $field(A, "eByte")(id, parseCanonicalInt(tokText(st)), start));
                    } else {
                      if (atKind(st, "TokIdent")) {
                        return pIdentOrRecord(st0, id, tokText(st), start);
                      } else {
                        if (atOp(st, "(")) {
                          return (($match$4104) => {
                            if ($match$4104.$t === "PErr") {
                              const e = $match$4104;
                              return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                            }
                            if ($match$4104.$t === "POk") {
                              const inner = $match$4104;
                              return (() => {
                                return (($match$4115) => {
                                  if ($match$4115.$t === "PErr") {
                                    const e = $match$4115;
                                    return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                                  }
                                  if ($match$4115.$t === "POk") {
                                    const close = $match$4115;
                                    return ok(close.f[0], inner.f[1]);
                                  }
                                  throw $matchFail("src/syntax/parser.pf", 4115);
                                })(expectOp(inner.f[0], ")", "after parenthesized expression"));
                              })();
                            }
                            throw $matchFail("src/syntax/parser.pf", 4104);
                          })(pExpr(advance(st0), 1));
                        } else {
                          if (atOp(st, "[")) {
                            return pListAfterOpen(advance(st0), id, $field(A, "strictListMode")(), start);
                          } else {
                            if (atOp(st, "{")) {
                              return (($match$4152) => {
                                if ($match$4152.$t === "PErr") {
                                  const e = $match$4152;
                                  return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                                }
                                if ($match$4152.$t === "POk") {
                                  const b = $match$4152;
                                  return ok(b.f[0], $field(A, "eBlock")(id, b.f[1].f[0], b.f[1].f[1]));
                                }
                                throw $matchFail("src/syntax/parser.pf", 4152);
                              })(pBlock(st0));
                            } else {
                              if (atKw(st, "lazy")) {
                                return pLazyList(st0, id, start);
                              } else {
                                if (atKw(st, "dict")) {
                                  return pDict(st0, id, start);
                                } else {
                                  if (atKw(st, "array")) {
                                    return pArray(st0, id, start);
                                  } else {
                                    if (atKw(st, "fn")) {
                                      return pLambda(st0, id, start);
                                    } else {
                                      if (atKw(st, "proc")) {
                                        return pProcLambda(st0, id, start, false);
                                      } else {
                                        if (atKw(st, "async")) {
                                          return pAsyncProcLambda(st0, id, start);
                                        } else {
                                          if (atKw(st, "match")) {
                                            return pMatch(st0, id, start);
                                          } else {
                                            if (atKw(st, "if")) {
                                              return pIfExpr(st0, id, start);
                                            } else {
                                              if (atKw(st, "await")) {
                                                return (($match$4259) => {
                                                  if ($match$4259.$t === "PErr") {
                                                    const e = $match$4259;
                                                    return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                                                  }
                                                  if ($match$4259.$t === "POk") {
                                                    const v = $match$4259;
                                                    return ok(v.f[0], $field(A, "eAwait")(id, v.f[1], spanFromStart(start, $field(A, "exprSpan")(v.f[1]))));
                                                  }
                                                  throw $matchFail("src/syntax/parser.pf", 4259);
                                                })(pExpr(advance(st0), 12));
                                              } else {
                                                if (atOp(st, "-") || atOp(st, "!")) {
                                                  const op = tokText(st);
                                                  return (($match$4301) => {
                                                    if ($match$4301.$t === "PErr") {
                                                      const e = $match$4301;
                                                      return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                                                    }
                                                    if ($match$4301.$t === "POk") {
                                                      const v = $match$4301;
                                                      return ok(v.f[0], $field(A, "eUnary")(id, op, v.f[1], spanFromStart(start, $field(A, "exprSpan")(v.f[1]))));
                                                    }
                                                    throw $matchFail("src/syntax/parser.pf", 4301);
                                                  })(pExpr(advance(st0), 12));
                                                } else {
                                                  return failHere(st, "Expected expression.");
                                                }
                                              }
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    function pIdentOrRecord(st0, id, name, start) {
      const after = advance(st0);
      if (atOp(after, "{")) {
        return (($match$4367) => {
          if ($match$4367.$t === "PErr") {
            const e = $match$4367;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$4367.$t === "POk") {
            const fields = $match$4367;
            return ok(fields.f[0], $field(A, "eRecord")(id, name, fields.f[1], spanFromStartToPrev(start, fields.f[0])));
          }
          throw $matchFail("src/syntax/parser.pf", 4367);
        })(pRecordFieldsExpr(advance(after), []));
      } else {
        return ok(after, $field(A, "eVar")(id, name, start));
      }
    }
    function pInfix(st, left, minPrec) {
      if (atOp(st, "(")) {
        return pCallPostfix(st, left, minPrec);
      } else {
        if (atOp(st, "[")) {
          return pIndexPostfix(st, left, minPrec);
        } else {
          if (atOp(st, ".")) {
            return pFieldPostfix(st, left, minPrec);
          } else {
            if (atOp(st, "?") && $leI(minPrec, 2)) {
              return pTernary(st, left, minPrec);
            } else {
              const op = tokText(st);
              const prec = precedenceOf(st, op);
              if ($leI(prec, 0) || $ltI(prec, minPrec)) {
                return ok(st, left);
              } else {
                const st1 = advance(st);
                return (($match$4475) => {
                  if ($match$4475.$t === "PErr") {
                    const e = $match$4475;
                    return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                  }
                  if ($match$4475.$t === "POk") {
                    const rhs = $match$4475;
                    return (() => {
                      const f = freshId(rhs.f[0]);
                      const expr = $field(A, "eBinary")(f.f[1], op, left, rhs.f[1], spanFromStart($field(A, "exprSpan")(left), $field(A, "exprSpan")(rhs.f[1])));
                      return pInfix(f.f[0], expr, minPrec);
                    })();
                  }
                  throw $matchFail("src/syntax/parser.pf", 4475);
                })(pExpr(st1, $addI(prec, 1)));
              }
            }
          }
        }
      }
    }
    function precedenceOf(st, op) {
      if (st.f[4] && op === "|") {
        return 0;
      } else {
        if (op === "|>") {
          return 1;
        } else {
          if (op === "||") {
            return 3;
          } else {
            if (op === "&&") {
              return 4;
            } else {
              if (op === "==" || op === "!=") {
                return 5;
              } else {
                if (op === "<" || op === ">" || op === "<=" || op === ">=") {
                  return 6;
                } else {
                  if (op === "|") {
                    return 7;
                  } else {
                    if (op === "&") {
                      return 8;
                    } else {
                      if (op === "<<" || op === ">>") {
                        return 9;
                      } else {
                        if (op === "+" || op === "-" || op === "++") {
                          return 10;
                        } else {
                          if (op === "*" || op === "/" || op === "%") {
                            return 11;
                          } else {
                            return 0;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    function pCallPostfix(st, left, minPrec) {
      const start = $field(A, "exprSpan")(left);
      return (($match$4639) => {
        if ($match$4639.$t === "PErr") {
          const e = $match$4639;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$4639.$t === "POk") {
          const args = $match$4639;
          return (() => {
            const f = freshId(args.f[0]);
            const expr = $field(A, "eCall")(f.f[1], left, args.f[1], spanFromStartToPrev(start, args.f[0]));
            return pInfix(f.f[0], expr, minPrec);
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 4639);
      })(pExprList(advance(st), ")", []));
    }
    function pIndexPostfix(st, left, minPrec) {
      const start = $field(A, "exprSpan")(left);
      return (($match$4684) => {
        if ($match$4684.$t === "PErr") {
          const e = $match$4684;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$4684.$t === "POk") {
          const ix = $match$4684;
          return (() => {
            return (($match$4695) => {
              if ($match$4695.$t === "PErr") {
                const e = $match$4695;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$4695.$t === "POk") {
                const close = $match$4695;
                return (() => {
                  const f = freshId(close.f[0]);
                  const expr = $field(A, "eIndex")(f.f[1], left, ix.f[1], spanFromStartToPrev(start, close.f[0]));
                  return pInfix(f.f[0], expr, minPrec);
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 4695);
            })(expectOp(ix.f[0], "]", "after index expression"));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 4684);
      })(pExpr(advance(st), 1));
    }
    function pFieldPostfix(st, left, minPrec) {
      const start = $field(A, "exprSpan")(left);
      return (($match$4740) => {
        if ($match$4740.$t === "PErr") {
          const e = $match$4740;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$4740.$t === "POk") {
          const name = $match$4740;
          return (() => {
            const f = freshId(name.f[0]);
            const expr = $field(A, "eField")(f.f[1], left, name.f[1], spanFromStartToPrev(start, name.f[0]));
            return pInfix(f.f[0], expr, minPrec);
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 4740);
      })(expectIdent(advance(st), "after '.'"));
    }
    function pTernary(st, left, minPrec) {
      const start = $field(A, "exprSpan")(left);
      const st1 = advance(st);
      return (($match$4788) => {
        if ($match$4788.$t === "PErr") {
          const e = $match$4788;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$4788.$t === "POk") {
          const thenE = $match$4788;
          return (() => {
            return (($match$4797) => {
              if ($match$4797.$t === "PErr") {
                const e = $match$4797;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$4797.$t === "POk") {
                const colon = $match$4797;
                return (() => {
                  return (($match$4808) => {
                    if ($match$4808.$t === "PErr") {
                      const e = $match$4808;
                      return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                    }
                    if ($match$4808.$t === "POk") {
                      const elseE = $match$4808;
                      return (() => {
                        const f = freshId(elseE.f[0]);
                        const expr = $field(A, "eIf")(f.f[1], left, thenE.f[1], elseE.f[1], spanFromStart(start, $field(A, "exprSpan")(elseE.f[1])));
                        return pInfix(f.f[0], expr, minPrec);
                      })();
                    }
                    throw $matchFail("src/syntax/parser.pf", 4808);
                  })(pExpr(colon.f[0], 2));
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 4797);
            })(expectOp(thenE.f[0], ":", "in ternary expression"));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 4788);
      })(pExpr(st1, 1));
    }
    function pExprList(st, closeOp, acc) {
      if (atOp(st, closeOp)) {
        return ok(advance(st), $reverse(acc));
      } else {
        return (($match$4866) => {
          if ($match$4866.$t === "PErr") {
            const e = $match$4866;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$4866.$t === "POk") {
            const item = $match$4866;
            return (() => {
              if (atOp(item.f[0], ",")) {
                return pExprList(advance(item.f[0]), closeOp, $cons(item.f[1], acc));
              } else {
                if (atOp(item.f[0], closeOp)) {
                  return pExprList(item.f[0], closeOp, $cons(item.f[1], acc));
                } else {
                  return failHere(item.f[0], $concatS($concatS("Expected ',' or '", closeOp), "' in expression list."));
                }
              }
            })();
          }
          throw $matchFail("src/syntax/parser.pf", 4866);
        })(pExpr(st, 1));
      }
    }
    function pLazyList(st0, id, start) {
      const st1 = advance(st0);
      if (atOp(st1, "[")) {
        return pListAfterOpen(advance(st1), id, $field(A, "lazyListMode")(), start);
      } else {
        return failHere(st1, "Expected '[' after lazy.");
      }
    }
    function pListAfterOpen(st, id, mode, start) {
      if (atOp(st, "]")) {
        const st2 = advance(st);
        return ok(st2, $field(A, "eList")(id, [], mode, spanFromStartToPrev(start, st2)));
      } else {
        return (($match$4972) => {
          if ($match$4972.$t === "PErr") {
            const e = $match$4972;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$4972.$t === "POk") {
            const first = $match$4972;
            return (() => {
              if (atKw(first.f[0], "for")) {
                return (($match$4986) => {
                  if ($match$4986.$t === "PErr") {
                    const e = $match$4986;
                    return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                  }
                  if ($match$4986.$t === "POk") {
                    const gens = $match$4986;
                    return pCompAfterGens(gens.f[0], id, start, first.f[1], gens.f[1], mode);
                  }
                  throw $matchFail("src/syntax/parser.pf", 4986);
                })(pCompGens(first.f[0], []));
              } else {
                return pListElems(first.f[0], id, mode, start, [first.f[1]]);
              }
            })();
          }
          throw $matchFail("src/syntax/parser.pf", 4972);
        })(pExpr(st, 1));
      }
    }
    function pCompAfterGens(st, id, start, body, gens, mode) {
      if (atKw(st, "where")) {
        return (($match$5026) => {
          if ($match$5026.$t === "PErr") {
            const e = $match$5026;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$5026.$t === "POk") {
            const g = $match$5026;
            return pCompClose(g.f[0], id, start, body, gens, $makeVariant("Some", "Option", ["value"], [g.f[1]]), mode);
          }
          throw $matchFail("src/syntax/parser.pf", 5026);
        })(pExpr(advance(st), 1));
      } else {
        return pCompClose(st, id, start, body, gens, $makeVariant("None", "Option", [], []), mode);
      }
    }
    function pCompClose(st, id, start, body, gens, guard, mode) {
      return (($match$5061) => {
        if ($match$5061.$t === "PErr") {
          const e = $match$5061;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$5061.$t === "POk") {
          const close = $match$5061;
          return ok(close.f[0], $field(A, "eComp")(id, body, gens, guard, mode, spanFromStartToPrev(start, close.f[0])));
        }
        throw $matchFail("src/syntax/parser.pf", 5061);
      })(expectOp(st, "]", "after list comprehension"));
    }
    function pListElems(st, id, mode, start, acc) {
      while (true) {
        if (atOp(st, "]")) {
          const st2 = advance(st);
          return ok(st2, $field(A, "eList")(id, $reverse(acc), mode, spanFromStartToPrev(start, st2)));
        } else {
          if (atOp(st, ",")) {
            const $match$5117 = pExpr(advance(st), 1);
            if ($match$5117.$t === "PErr") {
              const e = $match$5117;
              return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
            }
            if ($match$5117.$t === "POk") {
              const item = $match$5117;
              const $tc$5138$0 = item.f[0];
              const $tc$5138$1 = id;
              const $tc$5138$2 = mode;
              const $tc$5138$3 = start;
              const $tc$5138$4 = $cons(item.f[1], acc);
              st = $tc$5138$0;
              id = $tc$5138$1;
              mode = $tc$5138$2;
              start = $tc$5138$3;
              acc = $tc$5138$4;
              continue;
            }
            throw $matchFail("src/syntax/parser.pf", 5117);
          } else {
            return failHere(st, "Expected ',' or ']' in list literal.");
          }
        }
      }
    }
    function pCompGens(st, acc) {
      if (atKw(st, "for")) {
        const st1 = advance(st);
        return (($match$5156) => {
          if ($match$5156.$t === "PErr") {
            const e = $match$5156;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$5156.$t === "POk") {
            const name = $match$5156;
            return (() => {
              return (($match$5165) => {
                if ($match$5165.$t === "PErr") {
                  const e = $match$5165;
                  return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                }
                if ($match$5165.$t === "POk") {
                  const arrow = $match$5165;
                  return (() => {
                    return (($match$5176) => {
                      if ($match$5176.$t === "PErr") {
                        const e = $match$5176;
                        return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                      }
                      if ($match$5176.$t === "POk") {
                        const src = $match$5176;
                        return pCompGens(src.f[0], $cons($field(A, "mkGenClause")(name.f[1], src.f[1]), acc));
                      }
                      throw $matchFail("src/syntax/parser.pf", 5176);
                    })(pExpr(arrow.f[0], 1));
                  })();
                }
                throw $matchFail("src/syntax/parser.pf", 5165);
              })(expectOp(name.f[0], "<-", "after comprehension binding"));
            })();
          }
          throw $matchFail("src/syntax/parser.pf", 5156);
        })(expectIdent(st1, "after for"));
      } else {
        return ok(st, $reverse(acc));
      }
    }
    function pRecordFieldsExpr(st, acc) {
      if (atOp(st, "}")) {
        return ok(advance(st), $reverse(acc));
      } else {
        if (atIdent(st) && atOp(advance(st), "=")) {
          const fname = tokText(st);
          const valueStart = advance(advance(st));
          return (($match$5244) => {
            if ($match$5244.$t === "PErr") {
              const e = $match$5244;
              return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
            }
            if ($match$5244.$t === "POk") {
              const v = $match$5244;
              return pRecordFieldTail(v.f[0], $cons($field(A, "mkField")($makeVariant("Some", "Option", ["value"], [fname]), v.f[1]), acc));
            }
            throw $matchFail("src/syntax/parser.pf", 5244);
          })(pExpr(valueStart, 1));
        } else {
          return (($match$5267) => {
            if ($match$5267.$t === "PErr") {
              const e = $match$5267;
              return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
            }
            if ($match$5267.$t === "POk") {
              const v = $match$5267;
              return pRecordFieldTail(v.f[0], $cons($field(A, "mkField")($makeVariant("None", "Option", [], []), v.f[1]), acc));
            }
            throw $matchFail("src/syntax/parser.pf", 5267);
          })(pExpr(st, 1));
        }
      }
    }
    function pRecordFieldTail(st, acc) {
      if (atOp(st, ",")) {
        return pRecordFieldsExpr(advance(st), acc);
      } else {
        if (atOp(st, "}")) {
          return pRecordFieldsExpr(st, acc);
        } else {
          return failHere(st, "Expected ',' or '}' in record literal.");
        }
      }
    }
    function pDict(st0, id, start) {
      const st1 = advance(st0);
      return (($match$5324) => {
        if ($match$5324.$t === "PErr") {
          const e = $match$5324;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$5324.$t === "POk") {
          const open = $match$5324;
          return pDictEntries(open.f[0], id, start, []);
        }
        throw $matchFail("src/syntax/parser.pf", 5324);
      })(expectOp(st1, "{", "after dict"));
    }
    function pDictEntries(st, id, start, acc) {
      if (atOp(st, "}")) {
        const st2 = advance(st);
        return ok(st2, $field(A, "eDict")(id, $reverse(acc), spanFromStartToPrev(start, st2)));
      } else {
        return (($match$5365) => {
          if ($match$5365.$t === "PErr") {
            const e = $match$5365;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$5365.$t === "POk") {
            const key = $match$5365;
            return (() => {
              return (($match$5374) => {
                if ($match$5374.$t === "PErr") {
                  const e = $match$5374;
                  return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                }
                if ($match$5374.$t === "POk") {
                  const arrow = $match$5374;
                  return (() => {
                    return (($match$5385) => {
                      if ($match$5385.$t === "PErr") {
                        const e = $match$5385;
                        return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                      }
                      if ($match$5385.$t === "POk") {
                        const val = $match$5385;
                        return (() => {
                          const entry = $field(A, "mkDictEntry")(key.f[1], val.f[1]);
                          if (atOp(val.f[0], ",")) {
                            return pDictEntries(advance(val.f[0]), id, start, $cons(entry, acc));
                          } else {
                            if (atOp(val.f[0], "}")) {
                              return pDictEntries(val.f[0], id, start, $cons(entry, acc));
                            } else {
                              return failHere(val.f[0], "Expected ',' or '}' in dict literal.");
                            }
                          }
                        })();
                      }
                      throw $matchFail("src/syntax/parser.pf", 5385);
                    })(pExpr(arrow.f[0], 1));
                  })();
                }
                throw $matchFail("src/syntax/parser.pf", 5374);
              })(expectOp(key.f[0], "->", "in dict entry"));
            })();
          }
          throw $matchFail("src/syntax/parser.pf", 5365);
        })(pExpr(st, 1));
      }
    }
    function pArray(st0, id, start) {
      const st1 = advance(st0);
      return (($match$5454) => {
        if ($match$5454.$t === "PErr") {
          const e = $match$5454;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$5454.$t === "POk") {
          const open = $match$5454;
          return (() => {
            return (($match$5464) => {
              if ($match$5464.$t === "PErr") {
                const e = $match$5464;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$5464.$t === "POk") {
                const elems = $match$5464;
                return ok(elems.f[0], $field(A, "eArray")(id, elems.f[1], spanFromStartToPrev(start, elems.f[0])));
              }
              throw $matchFail("src/syntax/parser.pf", 5464);
            })(pExprList(open.f[0], "}", []));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 5454);
      })(expectOp(st1, "{", "after array"));
    }
    function pLambda(st0, id, start) {
      const st1 = advance(st0);
      if (atOp(st1, "(")) {
        return (($match$5500) => {
          if ($match$5500.$t === "PErr") {
            const e = $match$5500;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$5500.$t === "POk") {
            const ps = $match$5500;
            return (() => {
              return (($match$5511) => {
                if ($match$5511.$t === "PErr") {
                  const e = $match$5511;
                  return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                }
                if ($match$5511.$t === "POk") {
                  const arrow = $match$5511;
                  return pLambdaBody(arrow.f[0], id, start, ps.f[1]);
                }
                throw $matchFail("src/syntax/parser.pf", 5511);
              })(expectOp(ps.f[0], "=>", "after lambda parameter list"));
            })();
          }
          throw $matchFail("src/syntax/parser.pf", 5500);
        })(pLambdaParenParams(advance(st1), []));
      } else {
        return (($match$5531) => {
          if ($match$5531.$t === "PErr") {
            const e = $match$5531;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$5531.$t === "POk") {
            const ps = $match$5531;
            return pLambdaBody(ps.f[0], id, start, ps.f[1]);
          }
          throw $matchFail("src/syntax/parser.pf", 5531);
        })(pLambdaBareParams(st1, []));
      }
    }
    function pLambdaParenParams(st, acc) {
      if (atOp(st, ")")) {
        return ok(advance(st), $reverse(acc));
      } else {
        return (($match$5563) => {
          if ($match$5563.$t === "PErr") {
            const e = $match$5563;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$5563.$t === "POk") {
            const p = $match$5563;
            return (() => {
              if (atOp(p.f[0], ",")) {
                return pLambdaParenParams(advance(p.f[0]), $cons(p.f[1], acc));
              } else {
                if (atOp(p.f[0], ")")) {
                  return pLambdaParenParams(p.f[0], $cons(p.f[1], acc));
                } else {
                  return failHere(p.f[0], "Expected ',' or ')' in lambda parameter list.");
                }
              }
            })();
          }
          throw $matchFail("src/syntax/parser.pf", 5563);
        })(expectParamName(st, "in lambda parameter list"));
      }
    }
    function pLambdaBareParams(st, acc) {
      if (atOp(st, "=>")) {
        if ($eqI($length(acc), 0)) {
          return failHere(st, "Expected lambda parameter before '=>'.");
        } else {
          return ok(advance(st), $reverse(acc));
        }
      } else {
        return (($match$5639) => {
          if ($match$5639.$t === "PErr") {
            const e = $match$5639;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$5639.$t === "POk") {
            const p = $match$5639;
            return (() => {
              if (atOp(p.f[0], ",")) {
                return pLambdaBareParams(advance(p.f[0]), $cons(p.f[1], acc));
              } else {
                if (atOp(p.f[0], "=>")) {
                  return pLambdaBareParams(p.f[0], $cons(p.f[1], acc));
                } else {
                  return failHere(p.f[0], "Expected ',' or '=>' in lambda parameter list.");
                }
              }
            })();
          }
          throw $matchFail("src/syntax/parser.pf", 5639);
        })(expectParamName(st, "in lambda parameter list"));
      }
    }
    function pLambdaBody(st, id, start, params) {
      if (atOp(st, "{")) {
        return (($match$5695) => {
          if ($match$5695.$t === "PErr") {
            const e = $match$5695;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$5695.$t === "POk") {
            const b = $match$5695;
            return (() => {
              const bf = freshId(b.f[0]);
              const blockExpr = $field(A, "eBlock")(bf.f[1], b.f[1].f[0], b.f[1].f[1]);
              return ok(bf.f[0], $field(A, "eLambda")(id, params, blockExpr, spanFromStartToPrev(start, bf.f[0])));
            })();
          }
          throw $matchFail("src/syntax/parser.pf", 5695);
        })(pBlock(st));
      } else {
        return (($match$5737) => {
          if ($match$5737.$t === "PErr") {
            const e = $match$5737;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$5737.$t === "POk") {
            const body = $match$5737;
            return ok(body.f[0], $field(A, "eLambda")(id, params, body.f[1], spanFromStart(start, $field(A, "exprSpan")(body.f[1]))));
          }
          throw $matchFail("src/syntax/parser.pf", 5737);
        })(pExpr(st, 1));
      }
    }
    function pAsyncProcLambda(st0, id, start) {
      const st1 = advance(st0);
      if (atKw(st1, "proc")) {
        return pProcLambda(st1, id, start, true);
      } else {
        return failHere(st1, "Expected proc after async in procedure lambda.");
      }
    }
    function pProcLambda(st0, id, start, isAsync) {
      const st1 = advance(st0);
      return (($match$5793) => {
        if ($match$5793.$t === "PErr") {
          const e = $match$5793;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$5793.$t === "POk") {
          const params = $match$5793;
          return (() => {
            return (($match$5801) => {
              if ($match$5801.$t === "PErr") {
                const e = $match$5801;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$5801.$t === "POk") {
                const arrow = $match$5801;
                return (() => {
                  return (($match$5812) => {
                    if ($match$5812.$t === "PErr") {
                      const e = $match$5812;
                      return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                    }
                    if ($match$5812.$t === "POk") {
                      const ret = $match$5812;
                      return (() => {
                        return (($match$5821) => {
                          if ($match$5821.$t === "PErr") {
                            const e = $match$5821;
                            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                          }
                          if ($match$5821.$t === "POk") {
                            const body = $match$5821;
                            return (() => {
                              return ok(body.f[0], $field(A, "eProcLambda")(id, params.f[1], ret.f[1], body.f[1].f[0], isAsync, spanFromStartToPrev(start, body.f[0])));
                            })();
                          }
                          throw $matchFail("src/syntax/parser.pf", 5821);
                        })(pBlock(ret.f[0]));
                      })();
                    }
                    throw $matchFail("src/syntax/parser.pf", 5812);
                  })(pTypeExpr(arrow.f[0]));
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 5801);
            })(expectOp(params.f[0], "->", "after procedure lambda parameters"));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 5793);
      })(pTypedParams(st1));
    }
    function pIfExpr(st0, id, start) {
      const st1 = advance(st0);
      return (($match$5861) => {
        if ($match$5861.$t === "PErr") {
          const e = $match$5861;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$5861.$t === "POk") {
          const cond = $match$5861;
          return (() => {
            return (($match$5870) => {
              if ($match$5870.$t === "PErr") {
                const e = $match$5870;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$5870.$t === "POk") {
                const thenKw = $match$5870;
                return (() => {
                  return (($match$5881) => {
                    if ($match$5881.$t === "PErr") {
                      const e = $match$5881;
                      return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                    }
                    if ($match$5881.$t === "POk") {
                      const tb = $match$5881;
                      return (() => {
                        return (($match$5890) => {
                          if ($match$5890.$t === "PErr") {
                            const e = $match$5890;
                            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                          }
                          if ($match$5890.$t === "POk") {
                            const elseKw = $match$5890;
                            return (() => {
                              return (($match$5901) => {
                                if ($match$5901.$t === "PErr") {
                                  const e = $match$5901;
                                  return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                                }
                                if ($match$5901.$t === "POk") {
                                  const eb = $match$5901;
                                  return (() => {
                                    const tf = freshId(eb.f[0]);
                                    const thenExpr = $field(A, "eBlock")(tf.f[1], tb.f[1].f[0], tb.f[1].f[1]);
                                    const ef = freshId(tf.f[0]);
                                    const elseExpr = $field(A, "eBlock")(ef.f[1], eb.f[1].f[0], eb.f[1].f[1]);
                                    return ok(ef.f[0], $field(A, "eIf")(id, cond.f[1], thenExpr, elseExpr, spanFromStartToPrev(start, ef.f[0])));
                                  })();
                                }
                                throw $matchFail("src/syntax/parser.pf", 5901);
                              })(pBlock(elseKw.f[0]));
                            })();
                          }
                          throw $matchFail("src/syntax/parser.pf", 5890);
                        })(expectKw(tb.f[0], "else", "after expression if then block"));
                      })();
                    }
                    throw $matchFail("src/syntax/parser.pf", 5881);
                  })(pBlock(thenKw.f[0]));
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 5870);
            })(expectKw(cond.f[0], "then", "after if condition"));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 5861);
      })(pExpr(st1, 1));
    }
    function pMatch(st0, id, start) {
      const st1 = advance(st0);
      return (($match$5972) => {
        if ($match$5972.$t === "PErr") {
          const e = $match$5972;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$5972.$t === "POk") {
          const subj = $match$5972;
          return (() => {
            return (($match$5981) => {
              if ($match$5981.$t === "PErr") {
                const e = $match$5981;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$5981.$t === "POk") {
                const withKw = $match$5981;
                return (() => {
                  const armSt = withInMatchArms(withKw.f[0], true);
                  return (($match$5998) => {
                    if ($match$5998.$t === "PErr") {
                      const e = $match$5998;
                      return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                    }
                    if ($match$5998.$t === "POk") {
                      const arms = $match$5998;
                      return (() => {
                        const outSt = withInMatchArms(arms.f[0], st0.f[4]);
                        return ok(outSt, $field(A, "eMatch")(id, subj.f[1], arms.f[1], spanFromStartToPrev(start, outSt)));
                      })();
                    }
                    throw $matchFail("src/syntax/parser.pf", 5998);
                  })(pMatchArms(armSt, []));
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 5981);
            })(expectKw(subj.f[0], "with", "after match subject"));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 5972);
      })(pExpr(st1, 1));
    }
    function pMatchArms(st, acc) {
      while (true) {
        if (atOp(st, "|")) {
          const $match$6038 = pMatchArm(st);
          if ($match$6038.$t === "PErr") {
            const e = $match$6038;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$6038.$t === "POk") {
            const arm = $match$6038;
            const $tc$6053$0 = arm.f[0];
            const $tc$6053$1 = $cons(arm.f[1], acc);
            st = $tc$6053$0;
            acc = $tc$6053$1;
            continue;
          }
          throw $matchFail("src/syntax/parser.pf", 6038);
        } else {
          if ($eqI($length(acc), 0)) {
            return failHere(st, "Expected at least one match arm.");
          } else {
            return ok(st, $reverse(acc));
          }
        }
      }
    }
    function pMatchArm(st) {
      const st1 = advance(st);
      return (($match$6079) => {
        if ($match$6079.$t === "PErr") {
          const e = $match$6079;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$6079.$t === "POk") {
          const pat = $match$6079;
          return pMatchArmAfterPattern(pat.f[0], pat.f[1]);
        }
        throw $matchFail("src/syntax/parser.pf", 6079);
      })(pPattern(st1));
    }
    function pMatchArmAfterPattern(st, pattern) {
      if (atKw(st, "where")) {
        return (($match$6098) => {
          if ($match$6098.$t === "PErr") {
            const e = $match$6098;
            return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
          }
          if ($match$6098.$t === "POk") {
            const g = $match$6098;
            return pMatchArmAfterGuard(g.f[0], pattern, $makeVariant("Some", "Option", ["value"], [g.f[1]]));
          }
          throw $matchFail("src/syntax/parser.pf", 6098);
        })(pExpr(advance(st), 1));
      } else {
        return pMatchArmAfterGuard(st, pattern, $makeVariant("None", "Option", [], []));
      }
    }
    function pMatchArmAfterGuard(st, pattern, guard) {
      return (($match$6125) => {
        if ($match$6125.$t === "PErr") {
          const e = $match$6125;
          return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
        }
        if ($match$6125.$t === "POk") {
          const arrow = $match$6125;
          return (() => {
            return (($match$6135) => {
              if ($match$6135.$t === "PErr") {
                const e = $match$6135;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$6135.$t === "POk") {
                const body = $match$6135;
                return ok(body.f[0], $field(A, "mkMatchArm")(pattern, guard, body.f[1]));
              }
              throw $matchFail("src/syntax/parser.pf", 6135);
            })(pExpr(arrow.f[0], 1));
          })();
        }
        throw $matchFail("src/syntax/parser.pf", 6125);
      })(expectOp(st, "->", "after match pattern"));
    }
    function pPattern(st) {
      if (atIdentText(st, "_")) {
        return ok(advance(st), $field(A, "pWild")());
      } else {
        if (atOp(st, "[")) {
          return pListPattern(advance(st), []);
        } else {
          if (atKind(st, "TokIdent")) {
            const name = tokText(st);
            const st1 = advance(st);
            if (atKind(st1, "TokIdent")) {
              const b = tokText(st1);
              if (b === "_") {
                return ok(advance(st1), $field(A, "pVariant")(name, $makeVariant("None", "Option", [], [])));
              } else {
                return ok(advance(st1), $field(A, "pVariant")(name, $makeVariant("Some", "Option", ["value"], [b])));
              }
            } else {
              return ok(st1, $field(A, "pVariant")(name, $makeVariant("None", "Option", [], [])));
            }
          } else {
            return failHere(st, "Expected match pattern.");
          }
        }
      }
    }
    function pPatElem(st) {
      if (atIdentText(st, "_")) {
        return ok(advance(st), $field(A, "peWild")());
      } else {
        if (atKind(st, "TokIdent")) {
          return ok(advance(st), $field(A, "peBind")(tokText(st)));
        } else {
          return failHere(st, "Expected list-pattern binder or '_'.");
        }
      }
    }
    function pListPattern(st, acc) {
      if (atOp(st, "]")) {
        return ok(advance(st), $field(A, "pList")($reverse(acc), $makeVariant("None", "Option", [], [])));
      } else {
        if (atEllipsis(st)) {
          return failHere(st, "A list rest pattern must follow at least one explicit element.");
        } else {
          return (($match$6310) => {
            if ($match$6310.$t === "PErr") {
              const e = $match$6310;
              return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
            }
            if ($match$6310.$t === "POk") {
              const elem = $match$6310;
              return pListPatternTail(elem.f[0], $cons(elem.f[1], acc));
            }
            throw $matchFail("src/syntax/parser.pf", 6310);
          })(pPatElem(st));
        }
      }
    }
    function pListPatternTail(st, acc) {
      while (true) {
        if (atOp(st, "]")) {
          return ok(advance(st), $field(A, "pList")($reverse(acc), $makeVariant("None", "Option", [], [])));
        } else {
          if (atOp(st, ",")) {
            const st1 = advance(st);
            if (atEllipsis(st1)) {
              const $match$6358 = pPatElem(consumeEllipsis(st1));
              if ($match$6358.$t === "PErr") {
                const e = $match$6358;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$6358.$t === "POk") {
                const rest = $match$6358;
                return (() => {
                  return (($match$6368) => {
                    if ($match$6368.$t === "PErr") {
                      const e = $match$6368;
                      return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
                    }
                    if ($match$6368.$t === "POk") {
                      const close = $match$6368;
                      return ok(close.f[0], $field(A, "pList")($reverse(acc), $makeVariant("Some", "Option", ["value"], [rest.f[1]])));
                    }
                    throw $matchFail("src/syntax/parser.pf", 6368);
                  })(expectOp(rest.f[0], "]", "after list rest pattern"));
                })();
              }
              throw $matchFail("src/syntax/parser.pf", 6358);
            } else {
              const $match$6393 = pPatElem(st1);
              if ($match$6393.$t === "PErr") {
                const e = $match$6393;
                return $makeVariant("PErr", "PResult", ["diags"], [e.f[0]]);
              }
              if ($match$6393.$t === "POk") {
                const elem = $match$6393;
                const $tc$6408$0 = elem.f[0];
                const $tc$6408$1 = $cons(elem.f[1], acc);
                st = $tc$6408$0;
                acc = $tc$6408$1;
                continue;
              }
              throw $matchFail("src/syntax/parser.pf", 6393);
            }
          } else {
            return failHere(st, "Expected ',' or ']' in list pattern.");
          }
        }
      }
    }
    exports["ParseOk"] = ParseOk;
    exports["ParseErr"] = ParseErr;
    exports["parseModule"] = parseModule;
  });
  $registerSchemas([{name: "MLeaf", union: "IMapS", fields: [], variant: true}, {name: "MNode", union: "IMapS", fields: ["k", "v", "left", "right", "height"], variant: true}]);
  $maps["src/data/imaps"] = {};
  $mods["src/data/imaps"] = ((exports, $require) => {
    const MLeaf = $makeVariant("MLeaf", "IMapS", [], []);
    function MNode(k, v, left, right, height) {
      return $makeVariant("MNode", "IMapS", ["k", "v", "left", "right", "height"], [k, v, left, right, height]);
    }
    const imsTypeWitness = $makeVariant("MNode", "IMapS", ["k", "v", "left", "right", "height"], ["", 0, MLeaf, MLeaf, 1]);
    function imsEmpty() {
      return MLeaf;
    }
    function imsMax(a, b) {
      if ($gtI(a, b)) {
        return a;
      } else {
        return b;
      }
    }
    function imsHeight(m) {
      return (($match$23) => {
        if ($match$23.$t === "MLeaf") {
          return 0;
        }
        if ($match$23.$t === "MNode") {
          const n = $match$23;
          return n.f[4];
        }
        throw $matchFail("src/data/imaps.pf", 23);
      })(m);
    }
    function imsNode(k, v, left, right) {
      return $makeVariant("MNode", "IMapS", ["k", "v", "left", "right", "height"], [k, v, left, right, $addI(1, imsMax(imsHeight(left), imsHeight(right)))]);
    }
    function imsBalanceFactor(m) {
      return (($match$47) => {
        if ($match$47.$t === "MLeaf") {
          return 0;
        }
        if ($match$47.$t === "MNode") {
          const n = $match$47;
          return $subI(imsHeight(n.f[2]), imsHeight(n.f[3]));
        }
        throw $matchFail("src/data/imaps.pf", 47);
      })(m);
    }
    function imsRotateRight(m) {
      return (($match$61) => {
        if ($match$61.$t === "MLeaf") {
          return MLeaf;
        }
        if ($match$61.$t === "MNode") {
          const y = $match$61;
          return (() => {
            return (($match$65) => {
              if ($match$65.$t === "MLeaf") {
                return m;
              }
              if ($match$65.$t === "MNode") {
                const x = $match$65;
                return (() => {
                  const beta = x.f[3];
                  const newRight = imsNode(y.f[0], y.f[1], beta, y.f[3]);
                  return imsNode(x.f[0], x.f[1], x.f[2], newRight);
                })();
              }
              throw $matchFail("src/data/imaps.pf", 65);
            })(y.f[2]);
          })();
        }
        throw $matchFail("src/data/imaps.pf", 61);
      })(m);
    }
    function imsRotateLeft(m) {
      return (($match$96) => {
        if ($match$96.$t === "MLeaf") {
          return MLeaf;
        }
        if ($match$96.$t === "MNode") {
          const x = $match$96;
          return (() => {
            return (($match$100) => {
              if ($match$100.$t === "MLeaf") {
                return m;
              }
              if ($match$100.$t === "MNode") {
                const y = $match$100;
                return (() => {
                  const beta = y.f[2];
                  const newLeft = imsNode(x.f[0], x.f[1], x.f[2], beta);
                  return imsNode(y.f[0], y.f[1], newLeft, y.f[3]);
                })();
              }
              throw $matchFail("src/data/imaps.pf", 100);
            })(x.f[3]);
          })();
        }
        throw $matchFail("src/data/imaps.pf", 96);
      })(m);
    }
    function imsBalance(m) {
      return (($match$131) => {
        if ($match$131.$t === "MLeaf") {
          return MLeaf;
        }
        if ($match$131.$t === "MNode") {
          const n = $match$131;
          return (() => {
            const balancedNode = imsNode(n.f[0], n.f[1], n.f[2], n.f[3]);
            const bf = imsBalanceFactor(balancedNode);
            if ($gtI(bf, 1)) {
              return (($match$153) => {
                if ($match$153.$t === "MLeaf") {
                  return balancedNode;
                }
                if ($match$153.$t === "MNode") {
                  const leftNode = $match$153;
                  return (() => {
                    if ($geI(imsHeight(leftNode.f[2]), imsHeight(leftNode.f[3]))) {
                      return imsRotateRight(balancedNode);
                    } else {
                      const newLeft = imsRotateLeft(n.f[2]);
                      const rebuilt = imsNode(n.f[0], n.f[1], newLeft, n.f[3]);
                      return imsRotateRight(rebuilt);
                    }
                  })();
                }
                throw $matchFail("src/data/imaps.pf", 153);
              })(n.f[2]);
            } else {
              if ($ltI(bf, $negI(1))) {
                return (($match$196) => {
                  if ($match$196.$t === "MLeaf") {
                    return balancedNode;
                  }
                  if ($match$196.$t === "MNode") {
                    const rightNode = $match$196;
                    return (() => {
                      if ($geI(imsHeight(rightNode.f[3]), imsHeight(rightNode.f[2]))) {
                        return imsRotateLeft(balancedNode);
                      } else {
                        const newRight = imsRotateRight(n.f[3]);
                        const rebuilt = imsNode(n.f[0], n.f[1], n.f[2], newRight);
                        return imsRotateLeft(rebuilt);
                      }
                    })();
                  }
                  throw $matchFail("src/data/imaps.pf", 196);
                })(n.f[3]);
              } else {
                return balancedNode;
              }
            }
          })();
        }
        throw $matchFail("src/data/imaps.pf", 131);
      })(m);
    }
    function imsGet(m, k) {
      return (($match$241) => {
        if ($match$241.$t === "MLeaf") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$241.$t === "MNode") {
          const n = $match$241;
          return (() => {
            if (k === n.f[0]) {
              return $makeVariant("Some", "Option", ["value"], [n.f[1]]);
            } else {
              if (k < n.f[0]) {
                return imsGet(n.f[2], k);
              } else {
                return imsGet(n.f[3], k);
              }
            }
          })();
        }
        throw $matchFail("src/data/imaps.pf", 241);
      })(m);
    }
    function imsPut(m, k, v) {
      return (($match$274) => {
        if ($match$274.$t === "MLeaf") {
          return imsNode(k, v, MLeaf, MLeaf);
        }
        if ($match$274.$t === "MNode") {
          const n = $match$274;
          return (() => {
            if (k === n.f[0]) {
              return imsNode(k, v, n.f[2], n.f[3]);
            } else {
              if (k < n.f[0]) {
                const newLeft = imsPut(n.f[2], k, v);
                return imsBalance(imsNode(n.f[0], n.f[1], newLeft, n.f[3]));
              } else {
                const newRight = imsPut(n.f[3], k, v);
                return imsBalance(imsNode(n.f[0], n.f[1], n.f[2], newRight));
              }
            }
          })();
        }
        throw $matchFail("src/data/imaps.pf", 274);
      })(m);
    }
    function imsHas(m, k) {
      return (($match$343) => {
        if ($match$343.$t === "None") {
          return false;
        }
        if ($match$343.$t === "Some") {
          return true;
        }
        throw $matchFail("src/data/imaps.pf", 343);
      })(imsGet(m, k));
    }
    function imsMinEntry(m) {
      return (($match$353) => {
        if ($match$353.$t === "MLeaf") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$353.$t === "MNode") {
          const n = $match$353;
          return (() => {
            return (($match$357) => {
              if ($match$357.$t === "MLeaf") {
                return $makeVariant("Some", "Option", ["value"], [$makeRecord("Pair", ["key", "value"], [n.f[0], n.f[1]])]);
              }
              if ($match$357.$t === "MNode") {
                return imsMinEntry(n.f[2]);
              }
              throw $matchFail("src/data/imaps.pf", 357);
            })(n.f[2]);
          })();
        }
        throw $matchFail("src/data/imaps.pf", 353);
      })(m);
    }
    function imsRemoveMin(m) {
      return (($match$373) => {
        if ($match$373.$t === "MLeaf") {
          return MLeaf;
        }
        if ($match$373.$t === "MNode") {
          const n = $match$373;
          return (() => {
            return (($match$377) => {
              if ($match$377.$t === "MLeaf") {
                return n.f[3];
              }
              if ($match$377.$t === "MNode") {
                return (() => {
                  const newLeft = imsRemoveMin(n.f[2]);
                  return imsBalance(imsNode(n.f[0], n.f[1], newLeft, n.f[3]));
                })();
              }
              throw $matchFail("src/data/imaps.pf", 377);
            })(n.f[2]);
          })();
        }
        throw $matchFail("src/data/imaps.pf", 373);
      })(m);
    }
    function imsRemove(m, k) {
      return (($match$403) => {
        if ($match$403.$t === "MLeaf") {
          return MLeaf;
        }
        if ($match$403.$t === "MNode") {
          const n = $match$403;
          return (() => {
            if (k < n.f[0]) {
              const newLeft = imsRemove(n.f[2], k);
              return imsBalance(imsNode(n.f[0], n.f[1], newLeft, n.f[3]));
            } else {
              if (k > n.f[0]) {
                const newRight = imsRemove(n.f[3], k);
                return imsBalance(imsNode(n.f[0], n.f[1], n.f[2], newRight));
              } else {
                return (($match$451) => {
                  if ($match$451.$t === "MLeaf") {
                    return n.f[3];
                  }
                  if ($match$451.$t === "MNode") {
                    return (() => {
                      return (($match$457) => {
                        if ($match$457.$t === "MLeaf") {
                          return n.f[2];
                        }
                        if ($match$457.$t === "MNode") {
                          return (() => {
                            const successor = imsMinEntry(n.f[3]);
                            return (($match$468) => {
                              if ($match$468.$t === "None") {
                                return n.f[2];
                              }
                              if ($match$468.$t === "Some") {
                                const s = $match$468;
                                return (() => {
                                  const newRight = imsRemoveMin(n.f[3]);
                                  return imsBalance(imsNode(s.f[0].f[0], s.f[0].f[1], n.f[2], newRight));
                                })();
                              }
                              throw $matchFail("src/data/imaps.pf", 468);
                            })(successor);
                          })();
                        }
                        throw $matchFail("src/data/imaps.pf", 457);
                      })(n.f[3]);
                    })();
                  }
                  throw $matchFail("src/data/imaps.pf", 451);
                })(n.f[2]);
              }
            }
          })();
        }
        throw $matchFail("src/data/imaps.pf", 403);
      })(m);
    }
    function imsKeysAcc(m, acc) {
      return (($match$500) => {
        if ($match$500.$t === "MLeaf") {
          return acc;
        }
        if ($match$500.$t === "MNode") {
          const n = $match$500;
          return (() => {
            const withRight = imsKeysAcc(n.f[3], acc);
            const withNode = $cons(n.f[0], withRight);
            return imsKeysAcc(n.f[2], withNode);
          })();
        }
        throw $matchFail("src/data/imaps.pf", 500);
      })(m);
    }
    function imsKeys(m) {
      return imsKeysAcc(m, []);
    }
    function imsEntriesAcc(m, acc) {
      return (($match$531) => {
        if ($match$531.$t === "MLeaf") {
          return acc;
        }
        if ($match$531.$t === "MNode") {
          const n = $match$531;
          return (() => {
            const withRight = imsEntriesAcc(n.f[3], acc);
            const entry = $makeRecord("Pair", ["key", "value"], [n.f[0], n.f[1]]);
            const withNode = $cons(entry, withRight);
            return imsEntriesAcc(n.f[2], withNode);
          })();
        }
        throw $matchFail("src/data/imaps.pf", 531);
      })(m);
    }
    function imsEntries(m) {
      return imsEntriesAcc(m, []);
    }
    function imsPutEntry(acc, entry) {
      return imsPut(acc, $field(entry, "key"), $field(entry, "value"));
    }
    function imsUnion(a, b) {
      return $reduce(imsPutEntry, a, imsEntries(b));
    }
    function imsFromList(pairs) {
      return $reduce(imsPutEntry, imsEmpty(), pairs);
    }
    function imsMap(f, m) {
      return (($match$595) => {
        if ($match$595.$t === "MLeaf") {
          return MLeaf;
        }
        if ($match$595.$t === "MNode") {
          const n = $match$595;
          return (() => {
            const newLeft = imsMap(f, n.f[2]);
            const newRight = imsMap(f, n.f[3]);
            return imsNode(n.f[0], f(n.f[1]), newLeft, newRight);
          })();
        }
        throw $matchFail("src/data/imaps.pf", 595);
      })(m);
    }
    exports["MLeaf"] = MLeaf;
    exports["MNode"] = MNode;
    exports["imsEmpty"] = imsEmpty;
    exports["imsGet"] = imsGet;
    exports["imsPut"] = imsPut;
    exports["imsHas"] = imsHas;
    exports["imsRemove"] = imsRemove;
    exports["imsKeys"] = imsKeys;
    exports["imsEntries"] = imsEntries;
    exports["imsUnion"] = imsUnion;
    exports["imsFromList"] = imsFromList;
    exports["imsMap"] = imsMap;
  });
  $registerSchemas([{name: "SourceFile", union: null, fields: ["path", "text"], variant: false}, {name: "UserPath", union: "ResolvedPath", fields: ["p"], variant: true}, {name: "BuiltinPath", union: "ResolvedPath", fields: ["name"], variant: true}, {name: "ImportEdge", union: null, fields: ["spec", "rawPath", "resolved", "span"], variant: false}, {name: "RawModule", union: null, fields: ["path", "ast", "edges"], variant: false}, {name: "SearchEnv", union: null, fields: ["libDir", "pfunHome", "builtinNames"], variant: false}, {name: "ResolveOk", union: "ResolveResult", fields: ["resolved"], variant: true}, {name: "ResolveErr", union: "ResolveResult", fields: ["diag"], variant: true}, {name: "EdgesOk", union: "EdgesResult", fields: ["edges"], variant: true}, {name: "EdgesErr", union: "EdgesResult", fields: ["diags"], variant: true}, {name: "TopoOk", union: "TopoResult", fields: ["modules"], variant: true}, {name: "TopoErr", union: "TopoResult", fields: ["diags"], variant: true}, {name: "NotVisited", union: "VisitState", fields: [], variant: true}, {name: "Visiting", union: "VisitState", fields: [], variant: true}, {name: "Visited", union: "VisitState", fields: [], variant: true}, {name: "TopoSt", union: null, fields: ["byPath", "states", "acc", "diags"], variant: false}, {name: "VisitOk", union: "VisitResult", fields: ["st"], variant: true}, {name: "VisitFail", union: "VisitResult", fields: ["st"], variant: true}]);
  $maps["src/graph/modgraph"] = {"../syntax/ast": "src/syntax/ast", "../syntax/token": "src/syntax/token", "../check/diag": "src/check/diag", "../data/imaps": "src/data/imaps", "../compat": "src/compat"};
  $mods["src/graph/modgraph"] = ((exports, $require) => {
    const A = $require("../syntax/ast");
    const T = $require("../syntax/token");
    const D = $require("../check/diag");
    const IMS = $require("../data/imaps");
    const Compat = $require("../compat");
    function UserPath(p) {
      return $makeVariant("UserPath", "ResolvedPath", ["p"], [p]);
    }
    function BuiltinPath(name) {
      return $makeVariant("BuiltinPath", "ResolvedPath", ["name"], [name]);
    }
    function ResolveOk(resolved) {
      return $makeVariant("ResolveOk", "ResolveResult", ["resolved"], [resolved]);
    }
    function ResolveErr(diag) {
      return $makeVariant("ResolveErr", "ResolveResult", ["diag"], [diag]);
    }
    function EdgesOk(edges) {
      return $makeVariant("EdgesOk", "EdgesResult", ["edges"], [edges]);
    }
    function EdgesErr(diags) {
      return $makeVariant("EdgesErr", "EdgesResult", ["diags"], [diags]);
    }
    function TopoOk(modules) {
      return $makeVariant("TopoOk", "TopoResult", ["modules"], [modules]);
    }
    function TopoErr(diags) {
      return $makeVariant("TopoErr", "TopoResult", ["diags"], [diags]);
    }
    const NotVisited = $makeVariant("NotVisited", "VisitState", [], []);
    const Visiting = $makeVariant("Visiting", "VisitState", [], []);
    const Visited = $makeVariant("Visited", "VisitState", [], []);
    function VisitOk(st) {
      return $makeVariant("VisitOk", "VisitResult", ["st"], [st]);
    }
    function VisitFail(st) {
      return $makeVariant("VisitFail", "VisitResult", ["st"], [st]);
    }
    function mkSourceFile(path, text) {
      return $makeRecord("SourceFile", ["path", "text"], [path, text]);
    }
    function userPath(p) {
      return $makeVariant("UserPath", "ResolvedPath", ["p"], [p]);
    }
    function builtinPath(name) {
      return $makeVariant("BuiltinPath", "ResolvedPath", ["name"], [name]);
    }
    function mkImportEdge(spec, rawPath, resolved, span) {
      return $makeRecord("ImportEdge", ["spec", "rawPath", "resolved", "span"], [spec, rawPath, resolved, span]);
    }
    function mkRawModule(path, ast, edges) {
      return $makeRecord("RawModule", ["path", "ast", "edges"], [path, ast, edges]);
    }
    function mkSearchEnv(libDir, pfunHome, builtinNames) {
      return $makeRecord("SearchEnv", ["libDir", "pfunHome", "builtinNames"], [libDir, pfunHome, builtinNames]);
    }
    function fallbackSpan() {
      const p = $field(T, "mkPos")(1, 1, 0);
      return $field(T, "pointSpan")(p);
    }
    function importDiag(path, span, message) {
      return $field(D, "err")($makeVariant("ImportD", "DiagCode", [], []), message, path, span);
    }
    function diagForResolve(fromDir, rawPath) {
      return importDiag(fromDir, fallbackSpan(), $concatS($concatS("Cannot resolve import '", rawPath), "'."));
    }
    function hasDiags(diags) {
      return $gtI($length(diags), 0);
    }
    function appendOne(xs, x) {
      return $reverse($cons(x, $reverse(xs)));
    }
    function listContains(xs, value) {
      return (($match$114) => {
        if ($match$114.$t === "None") {
          return false;
        }
        if ($match$114.$t === "Some") {
          const cell = $match$114;
          return (() => {
            const pair = cell.f[0];
            if (pair.f[0] === value) {
              return true;
            } else {
              return listContains(pair.f[1], value);
            }
          })();
        }
        throw $matchFail("src/graph/modgraph.pf", 114);
      })($field(Compat, "uncons")(xs));
    }
    function startsWith(s, prefix) {
      const n = $length(prefix);
      if ($ltI($length(s), n)) {
        return false;
      } else {
        return $eq($slice(0, n, s), prefix);
      }
    }
    function endsWith(s, suffix) {
      const n = $length(suffix);
      const len = $length(s);
      if ($ltI(len, n)) {
        return false;
      } else {
        return $eq($slice($subI(len, n), n, s), suffix);
      }
    }
    function stripLeadingDotSlash(s) {
      if (startsWith(s, "./")) {
        return $slice(2, $subI($length(s), 2), s);
      } else {
        return s;
      }
    }
    function ensurePfExtension(path) {
      if (endsWith(path, ".pf")) {
        return path;
      } else {
        return $concatS(path, ".pf");
      }
    }
    function lastSlashFrom(path, i, found) {
      while (true) {
        if ($geI(i, $length(path))) {
          return found;
        } else {
          if ($eq($slice(i, 1, path), "/")) {
            const $tc$235$0 = path;
            const $tc$235$1 = $addI(i, 1);
            const $tc$235$2 = i;
            path = $tc$235$0;
            i = $tc$235$1;
            found = $tc$235$2;
            continue;
          } else {
            const $tc$243$0 = path;
            const $tc$243$1 = $addI(i, 1);
            const $tc$243$2 = found;
            path = $tc$243$0;
            i = $tc$243$1;
            found = $tc$243$2;
            continue;
          }
        }
      }
    }
    function dirOf(path) {
      const ix = lastSlashFrom(path, 0, $negI(1));
      if ($ltI(ix, 0)) {
        return ".";
      } else {
        if ($eqI(ix, 0)) {
          return "/";
        } else {
          return $slice(0, ix, path);
        }
      }
    }
    function joinPath(dir, rawPath) {
      if (startsWith(rawPath, "/")) {
        return rawPath;
      } else {
        if (dir === "" || dir === ".") {
          return rawPath;
        } else {
          if (endsWith(dir, "/")) {
            return $concatS(dir, rawPath);
          } else {
            return $concatS($concatS(dir, "/"), rawPath);
          }
        }
      }
    }
    function popComponent(stack, absolute) {
      return (($match$308) => {
        if ($match$308.$t === "None") {
          return (() => {
            if (absolute) {
              return [];
            } else {
              return [".."];
            }
          })();
        }
        if ($match$308.$t === "Some") {
          const cell = $match$308;
          return (() => {
            if (!absolute && cell.f[0].f[0] === "..") {
              return $cons("..", stack);
            } else {
              return cell.f[0].f[1];
            }
          })();
        }
        throw $matchFail("src/graph/modgraph.pf", 308);
      })($field(Compat, "uncons")(stack));
    }
    function normalizeParts(parts, stack, absolute) {
      return (($match$342) => {
        if ($match$342.$t === "None") {
          return $reverse(stack);
        }
        if ($match$342.$t === "Some") {
          const cell = $match$342;
          return (() => {
            const part = cell.f[0].f[0];
            const rest = cell.f[0].f[1];
            if (part === "" || part === ".") {
              return normalizeParts(rest, stack, absolute);
            } else {
              if (part === "..") {
                return normalizeParts(rest, popComponent(stack, absolute), absolute);
              } else {
                return normalizeParts(rest, $cons(part, stack), absolute);
              }
            }
          })();
        }
        throw $matchFail("src/graph/modgraph.pf", 342);
      })($field(Compat, "uncons")(parts));
    }
    function addLeadingSlash(path, absolute) {
      if (!absolute) {
        return path;
      } else {
        if (path === "") {
          return "/";
        } else {
          return $concatS("/", path);
        }
      }
    }
    function normalizePath(path) {
      const absolute = startsWith(path, "/");
      const parts = $split(path, "/");
      const clean = normalizeParts(parts, [], absolute);
      const joined = $join(clean, "/");
      const fixed = addLeadingSlash(joined, absolute);
      if (fixed === "") {
        return ".";
      } else {
        return fixed;
      }
    }
    function canonicalUserPath(path) {
      return normalizePath(ensurePfExtension(stripLeadingDotSlash(path)));
    }
    function resolvedPathToStr(resolved) {
      return (($match$458) => {
        if ($match$458.$t === "UserPath") {
          const r = $match$458;
          return r.f[0];
        }
        if ($match$458.$t === "BuiltinPath") {
          const r = $match$458;
          return $concatS("$builtin/", r.f[0]);
        }
        throw $matchFail("src/graph/modgraph.pf", 458);
      })(resolved);
    }
    function isBuiltinImport(rawPath, env) {
      return listContains(env.f[2], rawPath);
    }
    function isRelativeImport(rawPath) {
      return startsWith(rawPath, "./") || startsWith(rawPath, "../");
    }
    function isPublicNamespaceImport(rawPath) {
      return startsWith(rawPath, "testing/") || startsWith(rawPath, "browser/");
    }
    function publicNamespacePath(rawPath, env) {
      return canonicalUserPath(joinPath(env.f[1], $concatS("src/", rawPath)));
    }
    function resolveImport(rawPath, fromDir, env) {
      if (isRelativeImport(rawPath)) {
        return $makeVariant("ResolveOk", "ResolveResult", ["resolved"], [userPath(canonicalUserPath(joinPath(fromDir, rawPath)))]);
      } else {
        if (isPublicNamespaceImport(rawPath)) {
          return $makeVariant("ResolveOk", "ResolveResult", ["resolved"], [userPath(publicNamespacePath(rawPath, env))]);
        } else {
          if (isBuiltinImport(rawPath, env)) {
            return $makeVariant("ResolveOk", "ResolveResult", ["resolved"], [builtinPath(rawPath)]);
          } else {
            if (!(env.f[0] === "")) {
              return $makeVariant("ResolveOk", "ResolveResult", ["resolved"], [userPath(canonicalUserPath(joinPath(env.f[0], rawPath)))]);
            } else {
              return $makeVariant("ResolveErr", "ResolveResult", ["diag"], [diagForResolve(fromDir, rawPath)]);
            }
          }
        }
      }
    }
    function edgeOfImport(stmt, modulePath, fromDir, env) {
      while (true) {
        const $match$572 = stmt;
        if ($match$572.$t === "SImport") {
          const s = $match$572;
          return (() => {
            return (($match$575) => {
              if ($match$575.$t === "ResolveOk") {
                const r = $match$575;
                return $makeVariant("EdgesOk", "EdgesResult", ["edges"], [[mkImportEdge(s.f[1], s.f[2], r.f[0], s.f[3])]]);
              }
              if ($match$575.$t === "ResolveErr") {
                const e = $match$575;
                return $makeVariant("EdgesErr", "EdgesResult", ["diags"], [[e.f[0]]]);
              }
              throw $matchFail("src/graph/modgraph.pf", 575);
            })(resolveImport(s.f[2], fromDir, env));
          })();
        }
        if ($match$572.$t === "SExport") {
          const e = $match$572;
          const $tc$605$0 = e.f[1];
          const $tc$605$1 = modulePath;
          const $tc$605$2 = fromDir;
          const $tc$605$3 = env;
          stmt = $tc$605$0;
          modulePath = $tc$605$1;
          fromDir = $tc$605$2;
          env = $tc$605$3;
          continue;
        }
        if (true) {
          return $makeVariant("EdgesOk", "EdgesResult", ["edges"], [[]]);
        }
        throw $matchFail("src/graph/modgraph.pf", 572);
      }
    }
    function appendEdges(a, b) {
      while (true) {
        const $match$610 = $field(Compat, "uncons")(b);
        if ($match$610.$t === "None") {
          return a;
        }
        if ($match$610.$t === "Some") {
          const cell = $match$610;
          const $tc$626$0 = appendOne(a, cell.f[0].f[0]);
          const $tc$626$1 = cell.f[0].f[1];
          a = $tc$626$0;
          b = $tc$626$1;
          continue;
        }
        throw $matchFail("src/graph/modgraph.pf", 610);
      }
    }
    function edgeLoop(stmts, modulePath, fromDir, env, edges, diags) {
      return (($match$629) => {
        if ($match$629.$t === "None") {
          return (() => {
            if (hasDiags(diags)) {
              return $makeVariant("EdgesErr", "EdgesResult", ["diags"], [$reverse(diags)]);
            } else {
              return $makeVariant("EdgesOk", "EdgesResult", ["edges"], [edges]);
            }
          })();
        }
        if ($match$629.$t === "Some") {
          const cell = $match$629;
          return (() => {
            return (($match$648) => {
              if ($match$648.$t === "EdgesOk") {
                const e = $match$648;
                return edgeLoop(cell.f[0].f[1], modulePath, fromDir, env, appendEdges(edges, e.f[0]), diags);
              }
              if ($match$648.$t === "EdgesErr") {
                const d = $match$648;
                return edgeLoop(cell.f[0].f[1], modulePath, fromDir, env, edges, appendEdges(diags, d.f[0]));
              }
              throw $matchFail("src/graph/modgraph.pf", 648);
            })(edgeOfImport(cell.f[0].f[0], modulePath, fromDir, env));
          })();
        }
        throw $matchFail("src/graph/modgraph.pf", 629);
      })($field(Compat, "uncons")(stmts));
    }
    function edgesOf(ast, env) {
      return edgeLoop(ast.f[1], ast.f[0], dirOf(ast.f[0]), env, [], []);
    }
    function rawModulePair(m) {
      return $makeRecord("Pair", ["key", "value"], [canonicalUserPath($field(m, "path")), m]);
    }
    function moduleMapLoop(mods, acc) {
      while (true) {
        const $match$712 = $field(Compat, "uncons")(mods);
        if ($match$712.$t === "None") {
          return $field(IMS, "imsFromList")($reverse(acc));
        }
        if ($match$712.$t === "Some") {
          const cell = $match$712;
          const $tc$735$0 = cell.f[0].f[1];
          const $tc$735$1 = $cons(rawModulePair(cell.f[0].f[0]), acc);
          mods = $tc$735$0;
          acc = $tc$735$1;
          continue;
        }
        throw $matchFail("src/graph/modgraph.pf", 712);
      }
    }
    function moduleMap(mods) {
      return moduleMapLoop(mods, []);
    }
    function stateOf(states, path) {
      return (($match$744) => {
        if ($match$744.$t === "None") {
          return NotVisited;
        }
        if ($match$744.$t === "Some") {
          const s = $match$744;
          return s.f[0];
        }
        throw $matchFail("src/graph/modgraph.pf", 744);
      })($field(IMS, "imsGet")(states, path));
    }
    function topoState(byPath, states, acc, diags) {
      return $makeRecord("TopoSt", ["byPath", "states", "acc", "diags"], [byPath, states, acc, diags]);
    }
    function withState(st, path, state) {
      return topoState(st.f[0], $field(IMS, "imsPut")(st.f[1], path, state), st.f[2], st.f[3]);
    }
    function withDiag(st, diag) {
      return topoState(st.f[0], st.f[1], st.f[2], $cons(diag, st.f[3]));
    }
    function withAcc(st, module) {
      return topoState(st.f[0], st.f[1], $cons(module, st.f[2]), st.f[3]);
    }
    function missingModuleDiag(importer, edge) {
      return importDiag(importer, edge.f[3], $concatS($concatS("Imported module '", resolvedPathToStr(edge.f[2])), "' was not loaded."));
    }
    function cycleDiag(path, span) {
      return importDiag(path, span, $concatS($concatS("Import cycle involving '", path), "'."));
    }
    function visitEdge(edge, importer, st, stack) {
      return (($match$835) => {
        if ($match$835.$t === "BuiltinPath") {
          return $makeVariant("VisitOk", "VisitResult", ["st"], [st]);
        }
        if ($match$835.$t === "UserPath") {
          const p = $match$835;
          return visitPath(p.f[0], importer, $field(edge, "span"), st, $cons(importer, stack));
        }
        throw $matchFail("src/graph/modgraph.pf", 835);
      })($field(edge, "resolved"));
    }
    function visitEdges(edges, importer, st, stack) {
      return (($match$854) => {
        if ($match$854.$t === "None") {
          return $makeVariant("VisitOk", "VisitResult", ["st"], [st]);
        }
        if ($match$854.$t === "Some") {
          const cell = $match$854;
          return (() => {
            return (($match$862) => {
              if ($match$862.$t === "VisitOk") {
                const r = $match$862;
                return visitEdges(cell.f[0].f[1], importer, r.f[0], stack);
              }
              if ($match$862.$t === "VisitFail") {
                const r = $match$862;
                return $makeVariant("VisitFail", "VisitResult", ["st"], [r.f[0]]);
              }
              throw $matchFail("src/graph/modgraph.pf", 862);
            })(visitEdge(cell.f[0].f[0], importer, st, stack));
          })();
        }
        throw $matchFail("src/graph/modgraph.pf", 854);
      })($field(Compat, "uncons")(edges));
    }
    function visitLoaded(path, module, st, stack) {
      const marked = withState(st, path, Visiting);
      return (($match$892) => {
        if ($match$892.$t === "VisitFail") {
          const bad = $match$892;
          return $makeVariant("VisitFail", "VisitResult", ["st"], [bad.f[0]]);
        }
        if ($match$892.$t === "VisitOk") {
          const ok = $match$892;
          return (() => {
            const done = withState(ok.f[0], path, Visited);
            return $makeVariant("VisitOk", "VisitResult", ["st"], [withAcc(done, module)]);
          })();
        }
        throw $matchFail("src/graph/modgraph.pf", 892);
      })(visitEdges($field(module, "edges"), path, marked, stack));
    }
    function visitPath(path, importer, span, st, stack) {
      const key = canonicalUserPath(path);
      return (($match$923) => {
        if ($match$923.$t === "Visited") {
          return $makeVariant("VisitOk", "VisitResult", ["st"], [st]);
        }
        if ($match$923.$t === "Visiting") {
          return $makeVariant("VisitFail", "VisitResult", ["st"], [withDiag(st, cycleDiag(key, span))]);
        }
        if ($match$923.$t === "NotVisited") {
          return (() => {
            return (($match$940) => {
              if ($match$940.$t === "None") {
                return (() => {
                  const edge = mkImportEdge($field(A, "iStar")(), key, userPath(key), span);
                  return $makeVariant("VisitFail", "VisitResult", ["st"], [withDiag(st, missingModuleDiag(importer, edge))]);
                })();
              }
              if ($match$940.$t === "Some") {
                const m = $match$940;
                return visitLoaded(key, m.f[0], st, stack);
              }
              throw $matchFail("src/graph/modgraph.pf", 940);
            })($field(IMS, "imsGet")(st.f[0], key));
          })();
        }
        throw $matchFail("src/graph/modgraph.pf", 923);
      })(stateOf(st.f[1], key));
    }
    function visitModuleValue(module, st) {
      const key = canonicalUserPath($field(module, "path"));
      return visitPath(key, key, fallbackSpan(), st, []);
    }
    function topoLoop(mods, st) {
      return (($match$993) => {
        if ($match$993.$t === "None") {
          return (() => {
            if (hasDiags(st.f[3])) {
              return $makeVariant("TopoErr", "TopoResult", ["diags"], [$reverse(st.f[3])]);
            } else {
              return $makeVariant("TopoOk", "TopoResult", ["modules"], [$reverse(st.f[2])]);
            }
          })();
        }
        if ($match$993.$t === "Some") {
          const cell = $match$993;
          return (() => {
            return (($match$1017) => {
              if ($match$1017.$t === "VisitOk") {
                const r = $match$1017;
                return topoLoop(cell.f[0].f[1], r.f[0]);
              }
              if ($match$1017.$t === "VisitFail") {
                const r = $match$1017;
                return topoLoop(cell.f[0].f[1], r.f[0]);
              }
              throw $matchFail("src/graph/modgraph.pf", 1017);
            })(visitModuleValue(cell.f[0].f[0], st));
          })();
        }
        throw $matchFail("src/graph/modgraph.pf", 993);
      })($field(Compat, "uncons")(mods));
    }
    function toposort(mods) {
      const byPath = moduleMap(mods);
      const st = topoState(byPath, $field(IMS, "imsEmpty")(), [], []);
      return topoLoop(mods, st);
    }
    function graphGroundingWitness() {
      const sf = mkSourceFile("", "");
      const env = mkSearchEnv("", "", [""]);
      const m = $field(A, "mkModule")("", [], 0);
      const raw = mkRawModule("", m, [mkImportEdge($field(A, "iStar")(), "", userPath(""), fallbackSpan())]);
      const b = isBuiltinImport("", env);
      const r = resolveImport("", "", env);
      const e = edgesOf(m, env);
      return $concatS(sf.f[0], raw.f[0]);
    }
    exports["UserPath"] = UserPath;
    exports["BuiltinPath"] = BuiltinPath;
    exports["ResolveOk"] = ResolveOk;
    exports["ResolveErr"] = ResolveErr;
    exports["EdgesOk"] = EdgesOk;
    exports["EdgesErr"] = EdgesErr;
    exports["TopoOk"] = TopoOk;
    exports["TopoErr"] = TopoErr;
    exports["mkSourceFile"] = mkSourceFile;
    exports["userPath"] = userPath;
    exports["builtinPath"] = builtinPath;
    exports["mkImportEdge"] = mkImportEdge;
    exports["mkRawModule"] = mkRawModule;
    exports["mkSearchEnv"] = mkSearchEnv;
    exports["dirOf"] = dirOf;
    exports["normalizePath"] = normalizePath;
    exports["resolvedPathToStr"] = resolvedPathToStr;
    exports["isBuiltinImport"] = isBuiltinImport;
    exports["isRelativeImport"] = isRelativeImport;
    exports["isPublicNamespaceImport"] = isPublicNamespaceImport;
    exports["resolveImport"] = resolveImport;
    exports["edgesOf"] = edgesOf;
    exports["toposort"] = toposort;
  });
  $registerSchemas([{name: "ParseOneOk", union: "ParseOneResult", fields: ["module"], variant: true}, {name: "ParseOneErr", union: "ParseOneResult", fields: ["diags"], variant: true}, {name: "LoadOk", union: "LoadResult", fields: ["modules"], variant: true}, {name: "LoadErr", union: "LoadResult", fields: ["diags"], variant: true}, {name: "LoadPending", union: null, fields: ["path", "importer", "span"], variant: false}]);
  $maps["src/drivers/load"] = {"../syntax/lexer": "src/syntax/lexer", "../syntax/parser": "src/syntax/parser", "../graph/modgraph": "src/graph/modgraph", "../check/diag": "src/check/diag", "../syntax/token": "src/syntax/token", "../data/imaps": "src/data/imaps", "../compat": "src/compat", "./iofloor": "src/drivers/iofloor"};
  $mods["src/drivers/load"] = ((exports, $require) => {
    const Lex = $require("../syntax/lexer");
    const Parser = $require("../syntax/parser");
    const MG = $require("../graph/modgraph");
    const D = $require("../check/diag");
    const T = $require("../syntax/token");
    const IMS = $require("../data/imaps");
    const Compat = $require("../compat");
    const IO = $require("./iofloor");
    function ParseOneOk(module) {
      return $makeVariant("ParseOneOk", "ParseOneResult", ["module"], [module]);
    }
    function ParseOneErr(diags) {
      return $makeVariant("ParseOneErr", "ParseOneResult", ["diags"], [diags]);
    }
    function LoadOk(modules) {
      return $makeVariant("LoadOk", "LoadResult", ["modules"], [modules]);
    }
    function LoadErr(diags) {
      return $makeVariant("LoadErr", "LoadResult", ["diags"], [diags]);
    }
    function startsWith(s, prefix) {
      const n = $length(prefix);
      if ($ltI($length(s), n)) {
        return false;
      } else {
        return $eq($slice(0, n, s), prefix);
      }
    }
    function endsWith(s, suffix) {
      const n = $length(suffix);
      const len = $length(s);
      if ($ltI(len, n)) {
        return false;
      } else {
        return $eq($slice($subI(len, n), n, s), suffix);
      }
    }
    function stripLeadingDotSlash(path) {
      if (startsWith(path, "./")) {
        return $slice(2, $subI($length(path), 2), path);
      } else {
        return path;
      }
    }
    function ensurePfExtension(path) {
      if (endsWith(path, ".pf")) {
        return path;
      } else {
        return $concatS(path, ".pf");
      }
    }
    function canonicalPath(path) {
      return $field(MG, "normalizePath")(ensurePfExtension(stripLeadingDotSlash(path)));
    }
    function fallbackSpan() {
      const p = $field(T, "mkPos")(1, 1, 0);
      return $field(T, "pointSpan")(p);
    }
    function entryPending(entryPath) {
      const path = canonicalPath(entryPath);
      return $makeRecord("LoadPending", ["path", "importer", "span"], [path, path, fallbackSpan()]);
    }
    function importedPending(path, importer, span) {
      return $makeRecord("LoadPending", ["path", "importer", "span"], [canonicalPath(path), importer, span]);
    }
    function sourceMapLoop(files, acc) {
      return (($match$133) => {
        if ($match$133.$t === "None") {
          return acc;
        }
        if ($match$133.$t === "Some") {
          const cell = $match$133;
          return (() => {
            const file = cell.f[0].f[0];
            return sourceMapLoop(cell.f[0].f[1], $field(IMS, "imsPut")(acc, canonicalPath($field(file, "path")), $field(file, "text")));
          })();
        }
        throw $matchFail("src/drivers/load.pf", 133);
      })($field(Compat, "uncons")(files));
    }
    function sourceMapFromFiles(files) {
      return sourceMapLoop(files, $field(IMS, "imsEmpty")());
    }
    function missingSourceDiag(pending) {
      return $field(D, "err")($makeVariant("ImportD", "DiagCode", [], []), $concatS($concatS("Source for module '", $field(pending, "path")), "' is not available in the in-memory source map."), $field(pending, "importer"), $field(pending, "span"));
    }
    function readSourceDiag(pending, message) {
      return $field(D, "err")($makeVariant("ImportD", "DiagCode", [], []), $concatS($concatS($concatS("Could not read module '", $field(pending, "path")), "': "), message), $field(pending, "importer"), $field(pending, "span"));
    }
    function parseOne(path, text, env) {
      const canonical = canonicalPath(path);
      return (($match$209) => {
        if ($match$209.$t === "LexErr") {
          const e = $match$209;
          return $makeVariant("ParseOneErr", "ParseOneResult", ["diags"], [e.f[0]]);
        }
        if ($match$209.$t === "LexOk") {
          const l = $match$209;
          return (() => {
            return (($match$219) => {
              if ($match$219.$t === "ParseErr") {
                const e = $match$219;
                return $makeVariant("ParseOneErr", "ParseOneResult", ["diags"], [e.f[0]]);
              }
              if ($match$219.$t === "ParseOk") {
                const p = $match$219;
                return (() => {
                  return (($match$230) => {
                    if ($match$230.$t === "EdgesErr") {
                      const e = $match$230;
                      return $makeVariant("ParseOneErr", "ParseOneResult", ["diags"], [e.f[0]]);
                    }
                    if ($match$230.$t === "EdgesOk") {
                      const g = $match$230;
                      return $makeVariant("ParseOneOk", "ParseOneResult", ["module"], [$field(MG, "mkRawModule")(canonical, p.f[0], g.f[0])]);
                    }
                    throw $matchFail("src/drivers/load.pf", 230);
                  })($field(MG, "edgesOf")(p.f[0], env));
                })();
              }
              throw $matchFail("src/drivers/load.pf", 219);
            })($field(Parser, "parseModule")(canonical, l.f[0]));
          })();
        }
        throw $matchFail("src/drivers/load.pf", 209);
      })($field(Lex, "lex")(canonical, text));
    }
    function pendingEdgesLoop(edges, importer, acc) {
      return (($match$254) => {
        if ($match$254.$t === "None") {
          return $reverse(acc);
        }
        if ($match$254.$t === "Some") {
          const cell = $match$254;
          return (() => {
            const edge = cell.f[0].f[0];
            const rest = cell.f[0].f[1];
            return (($match$271) => {
              if ($match$271.$t === "BuiltinPath") {
                return pendingEdgesLoop(rest, importer, acc);
              }
              if ($match$271.$t === "UserPath") {
                const p = $match$271;
                return pendingEdgesLoop(rest, importer, $cons(importedPending(p.f[0], importer, $field(edge, "span")), acc));
              }
              throw $matchFail("src/drivers/load.pf", 271);
            })($field(edge, "resolved"));
          })();
        }
        throw $matchFail("src/drivers/load.pf", 254);
      })($field(Compat, "uncons")(edges));
    }
    function pendingFromEdges(edges, importer) {
      return pendingEdgesLoop(edges, importer, []);
    }
    function appendPending(left, right) {
      return (($match$303) => {
        if ($match$303.$t === "None") {
          return right;
        }
        if ($match$303.$t === "Some") {
          const cell = $match$303;
          return $cons(cell.f[0].f[0], appendPending(cell.f[0].f[1], right));
        }
        throw $matchFail("src/drivers/load.pf", 303);
      })($field(Compat, "uncons")(left));
    }
    function loadMemLoop(files, pending, seen, raws, env) {
      return (($match$322) => {
        if ($match$322.$t === "None") {
          return $makeVariant("LoadOk", "LoadResult", ["modules"], [$reverse(raws)]);
        }
        if ($match$322.$t === "Some") {
          const cell = $match$322;
          return (() => {
            const task = cell.f[0].f[0];
            const rest = cell.f[0].f[1];
            if ($field(IMS, "imsHas")(seen, $field(task, "path"))) {
              return loadMemLoop(files, rest, seen, raws, env);
            } else {
              return (($match$354) => {
                if ($match$354.$t === "None") {
                  return $makeVariant("LoadErr", "LoadResult", ["diags"], [[missingSourceDiag(task)]]);
                }
                if ($match$354.$t === "Some") {
                  const source = $match$354;
                  return (() => {
                    return (($match$367) => {
                      if ($match$367.$t === "ParseOneErr") {
                        const e = $match$367;
                        return $makeVariant("LoadErr", "LoadResult", ["diags"], [e.f[0]]);
                      }
                      if ($match$367.$t === "ParseOneOk") {
                        const parsed = $match$367;
                        return (() => {
                          const module = parsed.f[0];
                          const seen2 = $field(IMS, "imsPut")(seen, $field(task, "path"), true);
                          const imports = pendingFromEdges(module.f[2], module.f[0]);
                          return loadMemLoop(files, appendPending(imports, rest), seen2, $cons(module, raws), env);
                        })();
                      }
                      throw $matchFail("src/drivers/load.pf", 367);
                    })(parseOne($field(task, "path"), source.f[0], env));
                  })();
                }
                throw $matchFail("src/drivers/load.pf", 354);
              })($field(IMS, "imsGet")(files, $field(task, "path")));
            }
          })();
        }
        throw $matchFail("src/drivers/load.pf", 322);
      })($field(Compat, "uncons")(pending));
    }
    function loadGraphMem(files, entryPath, env) {
      return loadMemLoop(files, [entryPending(entryPath)], $field(IMS, "imsEmpty")(), [], env);
    }
    function loadDiskLoop(pending, seen, raws, env) {
      return (($match$431) => {
        if ($match$431.$t === "None") {
          return $makeVariant("LoadOk", "LoadResult", ["modules"], [$reverse(raws)]);
        }
        if ($match$431.$t === "Some") {
          const cell = $match$431;
          return (() => {
            const task = cell.f[0].f[0];
            const rest = cell.f[0].f[1];
            if ($field(IMS, "imsHas")(seen, $field(task, "path"))) {
              return loadDiskLoop(rest, seen, raws, env);
            } else {
              return (($match$462) => {
                if ($match$462.$t === "BErr") {
                  const e = $match$462;
                  return $makeVariant("LoadErr", "LoadResult", ["diags"], [[readSourceDiag(task, e.f[0])]]);
                }
                if ($match$462.$t === "BOk") {
                  const source = $match$462;
                  return (() => {
                    return (($match$476) => {
                      if ($match$476.$t === "ParseOneErr") {
                        const e = $match$476;
                        return $makeVariant("LoadErr", "LoadResult", ["diags"], [e.f[0]]);
                      }
                      if ($match$476.$t === "ParseOneOk") {
                        const parsed = $match$476;
                        return (() => {
                          const module = parsed.f[0];
                          const seen2 = $field(IMS, "imsPut")(seen, $field(task, "path"), true);
                          const imports = pendingFromEdges(module.f[2], module.f[0]);
                          return loadDiskLoop(appendPending(imports, rest), seen2, $cons(module, raws), env);
                        })();
                      }
                      throw $matchFail("src/drivers/load.pf", 476);
                    })(parseOne($field(task, "path"), source.f[0], env));
                  })();
                }
                throw $matchFail("src/drivers/load.pf", 462);
              })($field(IO, "readTextFile")($field(task, "path")));
            }
          })();
        }
        throw $matchFail("src/drivers/load.pf", 431);
      })($field(Compat, "uncons")(pending));
    }
    function loadGraph(entryPath, env) {
      return loadDiskLoop([entryPending(entryPath)], $field(IMS, "imsEmpty")(), [], env);
    }
    exports["ParseOneOk"] = ParseOneOk;
    exports["ParseOneErr"] = ParseOneErr;
    exports["LoadOk"] = LoadOk;
    exports["LoadErr"] = LoadErr;
    exports["canonicalPath"] = canonicalPath;
    exports["sourceMapFromFiles"] = sourceMapFromFiles;
    exports["parseOne"] = parseOne;
    exports["loadGraphMem"] = loadGraphMem;
    exports["loadGraph"] = loadGraph;
  });
  $registerSchemas([{name: "KFun", union: "ExportKind", fields: [], variant: true}, {name: "KProc", union: "ExportKind", fields: [], variant: true}, {name: "KValue", union: "ExportKind", fields: [], variant: true}, {name: "KMutable", union: "ExportKind", fields: [], variant: true}, {name: "KType", union: "ExportKind", fields: [], variant: true}, {name: "KOpaqueType", union: "ExportKind", fields: [], variant: true}, {name: "Scheme", union: null, fields: ["vars", "constraints", "body"], variant: false}, {name: "ITUnknown", union: "IfaceType", fields: [], variant: true}, {name: "ITName", union: "IfaceType", fields: ["name"], variant: true}, {name: "ITInt", union: "IfaceType", fields: [], variant: true}, {name: "ITFloat", union: "IfaceType", fields: [], variant: true}, {name: "ITBool", union: "IfaceType", fields: [], variant: true}, {name: "ITStr", union: "IfaceType", fields: [], variant: true}, {name: "ITChar", union: "IfaceType", fields: [], variant: true}, {name: "ITByte", union: "IfaceType", fields: [], variant: true}, {name: "ITUnit", union: "IfaceType", fields: [], variant: true}, {name: "ITNonZero", union: "IfaceType", fields: [], variant: true}, {name: "ITAny", union: "IfaceType", fields: [], variant: true}, {name: "ITList", union: "IfaceType", fields: ["elem"], variant: true}, {name: "ITArray", union: "IfaceType", fields: ["elem"], variant: true}, {name: "ITDict", union: "IfaceType", fields: ["keyT", "valT"], variant: true}, {name: "ITFun", union: "IfaceType", fields: ["params", "ret"], variant: true}, {name: "ITProc", union: "IfaceType", fields: ["params", "ret", "isAsync"], variant: true}, {name: "ITNamed", union: "IfaceType", fields: ["tname", "args"], variant: true}, {name: "ITVar", union: "IfaceType", fields: ["v"], variant: true}, {name: "ModIface", union: null, fields: ["path", "kinds", "types", "records", "unions"], variant: false}, {name: "CheckedModule", union: null, fields: ["path", "kinds", "types", "records", "unions"], variant: false}, {name: "BuiltinExport", union: null, fields: ["name", "kind", "scheme"], variant: false}, {name: "BuiltinUnion", union: null, fields: ["name", "variants"], variant: false}, {name: "BuiltinModule", union: null, fields: ["path", "exports", "unions"], variant: false}]);
  $maps["src/check/iface"] = {"../syntax/ast": "src/syntax/ast", "../data/imaps": "src/data/imaps", "../compat": "src/compat"};
  $mods["src/check/iface"] = ((exports, $require) => {
    const A = $require("../syntax/ast");
    const IMS = $require("../data/imaps");
    const Compat = $require("../compat");
    const KFun = $makeVariant("KFun", "ExportKind", [], []);
    const KProc = $makeVariant("KProc", "ExportKind", [], []);
    const KValue = $makeVariant("KValue", "ExportKind", [], []);
    const KMutable = $makeVariant("KMutable", "ExportKind", [], []);
    const KType = $makeVariant("KType", "ExportKind", [], []);
    const KOpaqueType = $makeVariant("KOpaqueType", "ExportKind", [], []);
    const ITUnknown = $makeVariant("ITUnknown", "IfaceType", [], []);
    function ITName(name) {
      return $makeVariant("ITName", "IfaceType", ["name"], [name]);
    }
    const ITInt = $makeVariant("ITInt", "IfaceType", [], []);
    const ITFloat = $makeVariant("ITFloat", "IfaceType", [], []);
    const ITBool = $makeVariant("ITBool", "IfaceType", [], []);
    const ITStr = $makeVariant("ITStr", "IfaceType", [], []);
    const ITChar = $makeVariant("ITChar", "IfaceType", [], []);
    const ITByte = $makeVariant("ITByte", "IfaceType", [], []);
    const ITUnit = $makeVariant("ITUnit", "IfaceType", [], []);
    const ITNonZero = $makeVariant("ITNonZero", "IfaceType", [], []);
    const ITAny = $makeVariant("ITAny", "IfaceType", [], []);
    function ITList(elem) {
      return $makeVariant("ITList", "IfaceType", ["elem"], [elem]);
    }
    function ITArray(elem) {
      return $makeVariant("ITArray", "IfaceType", ["elem"], [elem]);
    }
    function ITDict(keyT, valT) {
      return $makeVariant("ITDict", "IfaceType", ["keyT", "valT"], [keyT, valT]);
    }
    function ITFun(params, ret) {
      return $makeVariant("ITFun", "IfaceType", ["params", "ret"], [params, ret]);
    }
    function ITProc(params, ret, isAsync) {
      return $makeVariant("ITProc", "IfaceType", ["params", "ret", "isAsync"], [params, ret, isAsync]);
    }
    function ITNamed(tname, args) {
      return $makeVariant("ITNamed", "IfaceType", ["tname", "args"], [tname, args]);
    }
    function ITVar(v) {
      return $makeVariant("ITVar", "IfaceType", ["v"], [v]);
    }
    function kFun() {
      return KFun;
    }
    function kProc() {
      return KProc;
    }
    function kValue() {
      return KValue;
    }
    function kMutable() {
      return KMutable;
    }
    function kType() {
      return KType;
    }
    function kOpaqueType() {
      return KOpaqueType;
    }
    function mkScheme(vars, constraints, body) {
      return $makeRecord("Scheme", ["vars", "constraints", "body"], [vars, constraints, body]);
    }
    function unknownType() {
      return ITUnknown;
    }
    function nameType(name) {
      return $makeVariant("ITName", "IfaceType", ["name"], [name]);
    }
    function mkIface(path, kinds, types, unions) {
      return $makeRecord("ModIface", ["path", "kinds", "types", "records", "unions"], [path, kinds, types, $field(IMS, "imsEmpty")(), unions]);
    }
    function mkIfaceWithRecords(path, kinds, types, records, unions) {
      return $makeRecord("ModIface", ["path", "kinds", "types", "records", "unions"], [path, kinds, types, records, unions]);
    }
    function mkCheckedModule(path, kinds, types, unions) {
      return $makeRecord("CheckedModule", ["path", "kinds", "types", "records", "unions"], [path, kinds, types, $field(IMS, "imsEmpty")(), unions]);
    }
    function mkCheckedModuleWithRecords(path, kinds, types, records, unions) {
      return $makeRecord("CheckedModule", ["path", "kinds", "types", "records", "unions"], [path, kinds, types, records, unions]);
    }
    function mkBuiltinExport(name, kind, scheme) {
      return $makeRecord("BuiltinExport", ["name", "kind", "scheme"], [name, kind, scheme]);
    }
    function mkBuiltinUnion(name, variants) {
      return $makeRecord("BuiltinUnion", ["name", "variants"], [name, variants]);
    }
    function mkBuiltinModule(path, exports, unions) {
      return $makeRecord("BuiltinModule", ["path", "exports", "unions"], [path, exports, unions]);
    }
    function ifaceGroundingWitness() {
      const iface = mkIfaceWithRecords("", $field(IMS, "imsEmpty")(), $field(IMS, "imsEmpty")(), $field(IMS, "imsEmpty")(), $field(IMS, "imsEmpty")());
      const cm = mkCheckedModuleWithRecords("", $field(IMS, "imsEmpty")(), $field(IMS, "imsEmpty")(), $field(IMS, "imsEmpty")(), $field(IMS, "imsEmpty")());
      const be = mkBuiltinExport("", KFun, mkScheme([0], [], ITUnknown));
      const bu = mkBuiltinUnion("", []);
      return mkBuiltinModule($concatS($concatS($concatS(iface.f[0], cm.f[0]), be.f[0]), bu.f[0]), [], []);
    }
    function emptyIface(path) {
      return mkIface(path, $field(IMS, "imsEmpty")(), $field(IMS, "imsEmpty")(), $field(IMS, "imsEmpty")());
    }
    function lookupKind(iface, name) {
      return $field(IMS, "imsGet")($field(iface, "kinds"), name);
    }
    function lookupType(iface, name) {
      return $field(IMS, "imsGet")($field(iface, "types"), name);
    }
    function lookupRecord(iface, name) {
      return $field(IMS, "imsGet")($field(iface, "records"), name);
    }
    function lookupUnion(iface, name) {
      return $field(IMS, "imsGet")($field(iface, "unions"), name);
    }
    function putKind(iface, name, kind) {
      return mkIfaceWithRecords($field(iface, "path"), $field(IMS, "imsPut")($field(iface, "kinds"), name, kind), $field(iface, "types"), $field(iface, "records"), $field(iface, "unions"));
    }
    function putType(iface, name, scheme) {
      return mkIfaceWithRecords($field(iface, "path"), $field(iface, "kinds"), $field(IMS, "imsPut")($field(iface, "types"), name, scheme), $field(iface, "records"), $field(iface, "unions"));
    }
    function putRecord(iface, name, fields) {
      return mkIfaceWithRecords($field(iface, "path"), $field(iface, "kinds"), $field(iface, "types"), $field(IMS, "imsPut")($field(iface, "records"), name, fields), $field(iface, "unions"));
    }
    function putUnion(iface, name, variants) {
      return mkIfaceWithRecords($field(iface, "path"), $field(iface, "kinds"), $field(iface, "types"), $field(iface, "records"), $field(IMS, "imsPut")($field(iface, "unions"), name, variants));
    }
    function hasExport(iface, name) {
      return $field(IMS, "imsHas")($field(iface, "kinds"), name);
    }
    function exportedNames(iface) {
      return $field(IMS, "imsKeys")($field(iface, "kinds"));
    }
    function kindToStr(kind) {
      return (($match$333) => {
        if ($match$333.$t === "KFun") {
          return "function";
        }
        if ($match$333.$t === "KProc") {
          return "proc";
        }
        if ($match$333.$t === "KValue") {
          return "value";
        }
        if ($match$333.$t === "KMutable") {
          return "mutable";
        }
        if ($match$333.$t === "KType") {
          return "type";
        }
        if ($match$333.$t === "KOpaqueType") {
          return "opaque type";
        }
        throw $matchFail("src/check/iface.pf", 333);
      })(kind);
    }
    function unknownScheme() {
      return mkScheme([], [], unknownType());
    }
    function typeNameOfDecl(decl) {
      return (($match$352) => {
        if ($match$352.$t === "RecordDecl") {
          const r = $match$352;
          return r.f[0];
        }
        if ($match$352.$t === "UnionDecl") {
          const u = $match$352;
          return u.f[0];
        }
        throw $matchFail("src/check/iface.pf", 352);
      })(decl);
    }
    function putDeclShape(iface, decl) {
      return (($match$360) => {
        if ($match$360.$t === "RecordDecl") {
          const r = $match$360;
          return putRecord(iface, r.f[0], r.f[1]);
        }
        if ($match$360.$t === "UnionDecl") {
          const u = $match$360;
          return putUnion(iface, u.f[0], u.f[1]);
        }
        throw $matchFail("src/check/iface.pf", 360);
      })(decl);
    }
    function typeKind(isOpaque) {
      if (isOpaque) {
        return KOpaqueType;
      } else {
        return KType;
      }
    }
    function fnExportKind(kind) {
      return (($match$385) => {
        if ($match$385.$t === "PureFn") {
          return KFun;
        }
        if ($match$385.$t === "ProcFn") {
          return KProc;
        }
        throw $matchFail("src/check/iface.pf", 385);
      })(kind);
    }
    function addTypeExport(iface, stmt) {
      return (($match$391) => {
        if ($match$391.$t === "SType") {
          const s = $match$391;
          return (() => {
            const name = typeNameOfDecl(s.f[1]);
            const kind = typeKind(s.f[2]);
            const iface1 = putKind(iface, name, kind);
            const iface2 = putType(iface1, name, mkScheme([], [], nameType(name)));
            return putDeclShape(iface2, s.f[1]);
          })();
        }
        if (true) {
          return iface;
        }
        throw $matchFail("src/check/iface.pf", 391);
      })(stmt);
    }
    function addValueExport(iface, stmt) {
      return (($match$431) => {
        if ($match$431.$t === "SLet") {
          const s = $match$431;
          return putType(putKind(iface, s.f[1], KValue), s.f[1], unknownScheme());
        }
        if ($match$431.$t === "SVar") {
          const s = $match$431;
          return putType(putKind(iface, s.f[1], KMutable), s.f[1], unknownScheme());
        }
        if ($match$431.$t === "SFun") {
          const s = $match$431;
          return putType(putKind(iface, s.f[1], fnExportKind(s.f[4])), s.f[1], unknownScheme());
        }
        if ($match$431.$t === "SType") {
          return addTypeExport(iface, stmt);
        }
        if ($match$431.$t === "SExtern") {
          return iface;
        }
        if (true) {
          return iface;
        }
        throw $matchFail("src/check/iface.pf", 431);
      })(stmt);
    }
    function addExportedStmt(iface, stmt) {
      return (($match$480) => {
        if ($match$480.$t === "SExport") {
          const e = $match$480;
          return addValueExport(iface, e.f[1]);
        }
        if (true) {
          return iface;
        }
        throw $matchFail("src/check/iface.pf", 480);
      })(stmt);
    }
    function ifaceAstLoop(stmts, iface) {
      while (true) {
        const $match$490 = $field(Compat, "uncons")(stmts);
        if ($match$490.$t === "None") {
          return iface;
        }
        if ($match$490.$t === "Some") {
          const cell = $match$490;
          const $tc$506$0 = cell.f[0].f[1];
          const $tc$506$1 = addExportedStmt(iface, cell.f[0].f[0]);
          stmts = $tc$506$0;
          iface = $tc$506$1;
          continue;
        }
        throw $matchFail("src/check/iface.pf", 490);
      }
    }
    function ifaceOfAst(ast) {
      return ifaceAstLoop($field(ast, "stmts"), emptyIface($field(ast, "path")));
    }
    function ifaceOfChecked(cm) {
      return mkIfaceWithRecords($field(cm, "path"), $field(cm, "kinds"), $field(cm, "types"), $field(cm, "records"), $field(cm, "unions"));
    }
    function builtinExportsLoop(exports, iface) {
      return (($match$535) => {
        if ($match$535.$t === "None") {
          return iface;
        }
        if ($match$535.$t === "Some") {
          const cell = $match$535;
          return (() => {
            const ex = cell.f[0].f[0];
            const iface1 = putKind(iface, $field(ex, "name"), $field(ex, "kind"));
            const iface2 = putType(iface1, $field(ex, "name"), $field(ex, "scheme"));
            return builtinExportsLoop(cell.f[0].f[1], iface2);
          })();
        }
        throw $matchFail("src/check/iface.pf", 535);
      })($field(Compat, "uncons")(exports));
    }
    function builtinUnionsLoop(unions, iface) {
      return (($match$571) => {
        if ($match$571.$t === "None") {
          return iface;
        }
        if ($match$571.$t === "Some") {
          const cell = $match$571;
          return (() => {
            const u = cell.f[0].f[0];
            return builtinUnionsLoop(cell.f[0].f[1], putUnion(iface, $field(u, "name"), $field(u, "variants")));
          })();
        }
        throw $matchFail("src/check/iface.pf", 571);
      })($field(Compat, "uncons")(unions));
    }
    function ifaceOfBuiltin(bm) {
      const iface0 = emptyIface($field(bm, "path"));
      const iface1 = builtinExportsLoop($field(bm, "exports"), iface0);
      return builtinUnionsLoop($field(bm, "unions"), iface1);
    }
    exports["KFun"] = KFun;
    exports["KProc"] = KProc;
    exports["KValue"] = KValue;
    exports["KMutable"] = KMutable;
    exports["KType"] = KType;
    exports["KOpaqueType"] = KOpaqueType;
    exports["ITUnknown"] = ITUnknown;
    exports["ITName"] = ITName;
    exports["ITInt"] = ITInt;
    exports["ITFloat"] = ITFloat;
    exports["ITBool"] = ITBool;
    exports["ITStr"] = ITStr;
    exports["ITChar"] = ITChar;
    exports["ITByte"] = ITByte;
    exports["ITUnit"] = ITUnit;
    exports["ITNonZero"] = ITNonZero;
    exports["ITAny"] = ITAny;
    exports["ITList"] = ITList;
    exports["ITArray"] = ITArray;
    exports["ITDict"] = ITDict;
    exports["ITFun"] = ITFun;
    exports["ITProc"] = ITProc;
    exports["ITNamed"] = ITNamed;
    exports["ITVar"] = ITVar;
    exports["kFun"] = kFun;
    exports["kProc"] = kProc;
    exports["kValue"] = kValue;
    exports["kMutable"] = kMutable;
    exports["kType"] = kType;
    exports["kOpaqueType"] = kOpaqueType;
    exports["mkScheme"] = mkScheme;
    exports["unknownType"] = unknownType;
    exports["nameType"] = nameType;
    exports["mkIface"] = mkIface;
    exports["mkIfaceWithRecords"] = mkIfaceWithRecords;
    exports["mkCheckedModule"] = mkCheckedModule;
    exports["mkCheckedModuleWithRecords"] = mkCheckedModuleWithRecords;
    exports["mkBuiltinExport"] = mkBuiltinExport;
    exports["mkBuiltinUnion"] = mkBuiltinUnion;
    exports["mkBuiltinModule"] = mkBuiltinModule;
    exports["emptyIface"] = emptyIface;
    exports["lookupKind"] = lookupKind;
    exports["lookupType"] = lookupType;
    exports["lookupRecord"] = lookupRecord;
    exports["lookupUnion"] = lookupUnion;
    exports["putKind"] = putKind;
    exports["putType"] = putType;
    exports["putRecord"] = putRecord;
    exports["putUnion"] = putUnion;
    exports["hasExport"] = hasExport;
    exports["exportedNames"] = exportedNames;
    exports["kindToStr"] = kindToStr;
    exports["ifaceOfAst"] = ifaceOfAst;
    exports["ifaceOfChecked"] = ifaceOfChecked;
    exports["ifaceOfBuiltin"] = ifaceOfBuiltin;
  });
  $registerSchemas([{name: "MLeaf", union: "IMapI", fields: [], variant: true}, {name: "MNode", union: "IMapI", fields: ["k", "v", "left", "right", "height"], variant: true}]);
  $maps["src/data/imapi"] = {};
  $mods["src/data/imapi"] = ((exports, $require) => {
    const MLeaf = $makeVariant("MLeaf", "IMapI", [], []);
    function MNode(k, v, left, right, height) {
      return $makeVariant("MNode", "IMapI", ["k", "v", "left", "right", "height"], [k, v, left, right, height]);
    }
    const imiTypeWitness = $makeVariant("MNode", "IMapI", ["k", "v", "left", "right", "height"], [0, 0, MLeaf, MLeaf, 1]);
    function imiEmpty() {
      return MLeaf;
    }
    function imiMax(a, b) {
      if ($gtI(a, b)) {
        return a;
      } else {
        return b;
      }
    }
    function imiHeight(m) {
      return (($match$23) => {
        if ($match$23.$t === "MLeaf") {
          return 0;
        }
        if ($match$23.$t === "MNode") {
          const n = $match$23;
          return n.f[4];
        }
        throw $matchFail("src/data/imapi.pf", 23);
      })(m);
    }
    function imiNode(k, v, left, right) {
      return $makeVariant("MNode", "IMapI", ["k", "v", "left", "right", "height"], [k, v, left, right, $addI(1, imiMax(imiHeight(left), imiHeight(right)))]);
    }
    function imiBalanceFactor(m) {
      return (($match$47) => {
        if ($match$47.$t === "MLeaf") {
          return 0;
        }
        if ($match$47.$t === "MNode") {
          const n = $match$47;
          return $subI(imiHeight(n.f[2]), imiHeight(n.f[3]));
        }
        throw $matchFail("src/data/imapi.pf", 47);
      })(m);
    }
    function imiRotateRight(m) {
      return (($match$61) => {
        if ($match$61.$t === "MLeaf") {
          return MLeaf;
        }
        if ($match$61.$t === "MNode") {
          const y = $match$61;
          return (() => {
            return (($match$65) => {
              if ($match$65.$t === "MLeaf") {
                return m;
              }
              if ($match$65.$t === "MNode") {
                const x = $match$65;
                return (() => {
                  const beta = x.f[3];
                  const newRight = imiNode(y.f[0], y.f[1], beta, y.f[3]);
                  return imiNode(x.f[0], x.f[1], x.f[2], newRight);
                })();
              }
              throw $matchFail("src/data/imapi.pf", 65);
            })(y.f[2]);
          })();
        }
        throw $matchFail("src/data/imapi.pf", 61);
      })(m);
    }
    function imiRotateLeft(m) {
      return (($match$96) => {
        if ($match$96.$t === "MLeaf") {
          return MLeaf;
        }
        if ($match$96.$t === "MNode") {
          const x = $match$96;
          return (() => {
            return (($match$100) => {
              if ($match$100.$t === "MLeaf") {
                return m;
              }
              if ($match$100.$t === "MNode") {
                const y = $match$100;
                return (() => {
                  const beta = y.f[2];
                  const newLeft = imiNode(x.f[0], x.f[1], x.f[2], beta);
                  return imiNode(y.f[0], y.f[1], newLeft, y.f[3]);
                })();
              }
              throw $matchFail("src/data/imapi.pf", 100);
            })(x.f[3]);
          })();
        }
        throw $matchFail("src/data/imapi.pf", 96);
      })(m);
    }
    function imiBalance(m) {
      return (($match$131) => {
        if ($match$131.$t === "MLeaf") {
          return MLeaf;
        }
        if ($match$131.$t === "MNode") {
          const n = $match$131;
          return (() => {
            const balancedNode = imiNode(n.f[0], n.f[1], n.f[2], n.f[3]);
            const bf = imiBalanceFactor(balancedNode);
            if ($gtI(bf, 1)) {
              return (($match$153) => {
                if ($match$153.$t === "MLeaf") {
                  return balancedNode;
                }
                if ($match$153.$t === "MNode") {
                  const leftNode = $match$153;
                  return (() => {
                    if ($geI(imiHeight(leftNode.f[2]), imiHeight(leftNode.f[3]))) {
                      return imiRotateRight(balancedNode);
                    } else {
                      const newLeft = imiRotateLeft(n.f[2]);
                      const rebuilt = imiNode(n.f[0], n.f[1], newLeft, n.f[3]);
                      return imiRotateRight(rebuilt);
                    }
                  })();
                }
                throw $matchFail("src/data/imapi.pf", 153);
              })(n.f[2]);
            } else {
              if ($ltI(bf, $negI(1))) {
                return (($match$196) => {
                  if ($match$196.$t === "MLeaf") {
                    return balancedNode;
                  }
                  if ($match$196.$t === "MNode") {
                    const rightNode = $match$196;
                    return (() => {
                      if ($geI(imiHeight(rightNode.f[3]), imiHeight(rightNode.f[2]))) {
                        return imiRotateLeft(balancedNode);
                      } else {
                        const newRight = imiRotateRight(n.f[3]);
                        const rebuilt = imiNode(n.f[0], n.f[1], n.f[2], newRight);
                        return imiRotateLeft(rebuilt);
                      }
                    })();
                  }
                  throw $matchFail("src/data/imapi.pf", 196);
                })(n.f[3]);
              } else {
                return balancedNode;
              }
            }
          })();
        }
        throw $matchFail("src/data/imapi.pf", 131);
      })(m);
    }
    function imiGet(m, k) {
      return (($match$241) => {
        if ($match$241.$t === "MLeaf") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$241.$t === "MNode") {
          const n = $match$241;
          return (() => {
            if ($eqI(k, n.f[0])) {
              return $makeVariant("Some", "Option", ["value"], [n.f[1]]);
            } else {
              if ($ltI(k, n.f[0])) {
                return imiGet(n.f[2], k);
              } else {
                return imiGet(n.f[3], k);
              }
            }
          })();
        }
        throw $matchFail("src/data/imapi.pf", 241);
      })(m);
    }
    function imiPut(m, k, v) {
      return (($match$274) => {
        if ($match$274.$t === "MLeaf") {
          return imiNode(k, v, MLeaf, MLeaf);
        }
        if ($match$274.$t === "MNode") {
          const n = $match$274;
          return (() => {
            if ($eqI(k, n.f[0])) {
              return imiNode(k, v, n.f[2], n.f[3]);
            } else {
              if ($ltI(k, n.f[0])) {
                const newLeft = imiPut(n.f[2], k, v);
                return imiBalance(imiNode(n.f[0], n.f[1], newLeft, n.f[3]));
              } else {
                const newRight = imiPut(n.f[3], k, v);
                return imiBalance(imiNode(n.f[0], n.f[1], n.f[2], newRight));
              }
            }
          })();
        }
        throw $matchFail("src/data/imapi.pf", 274);
      })(m);
    }
    function imiHas(m, k) {
      return (($match$343) => {
        if ($match$343.$t === "None") {
          return false;
        }
        if ($match$343.$t === "Some") {
          return true;
        }
        throw $matchFail("src/data/imapi.pf", 343);
      })(imiGet(m, k));
    }
    function imiMinEntry(m) {
      return (($match$353) => {
        if ($match$353.$t === "MLeaf") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$353.$t === "MNode") {
          const n = $match$353;
          return (() => {
            return (($match$357) => {
              if ($match$357.$t === "MLeaf") {
                return $makeVariant("Some", "Option", ["value"], [$makeRecord("Pair", ["key", "value"], [n.f[0], n.f[1]])]);
              }
              if ($match$357.$t === "MNode") {
                return imiMinEntry(n.f[2]);
              }
              throw $matchFail("src/data/imapi.pf", 357);
            })(n.f[2]);
          })();
        }
        throw $matchFail("src/data/imapi.pf", 353);
      })(m);
    }
    function imiRemoveMin(m) {
      return (($match$373) => {
        if ($match$373.$t === "MLeaf") {
          return MLeaf;
        }
        if ($match$373.$t === "MNode") {
          const n = $match$373;
          return (() => {
            return (($match$377) => {
              if ($match$377.$t === "MLeaf") {
                return n.f[3];
              }
              if ($match$377.$t === "MNode") {
                return (() => {
                  const newLeft = imiRemoveMin(n.f[2]);
                  return imiBalance(imiNode(n.f[0], n.f[1], newLeft, n.f[3]));
                })();
              }
              throw $matchFail("src/data/imapi.pf", 377);
            })(n.f[2]);
          })();
        }
        throw $matchFail("src/data/imapi.pf", 373);
      })(m);
    }
    function imiRemove(m, k) {
      return (($match$403) => {
        if ($match$403.$t === "MLeaf") {
          return MLeaf;
        }
        if ($match$403.$t === "MNode") {
          const n = $match$403;
          return (() => {
            if ($ltI(k, n.f[0])) {
              const newLeft = imiRemove(n.f[2], k);
              return imiBalance(imiNode(n.f[0], n.f[1], newLeft, n.f[3]));
            } else {
              if ($gtI(k, n.f[0])) {
                const newRight = imiRemove(n.f[3], k);
                return imiBalance(imiNode(n.f[0], n.f[1], n.f[2], newRight));
              } else {
                return (($match$451) => {
                  if ($match$451.$t === "MLeaf") {
                    return n.f[3];
                  }
                  if ($match$451.$t === "MNode") {
                    return (() => {
                      return (($match$457) => {
                        if ($match$457.$t === "MLeaf") {
                          return n.f[2];
                        }
                        if ($match$457.$t === "MNode") {
                          return (() => {
                            const successor = imiMinEntry(n.f[3]);
                            return (($match$468) => {
                              if ($match$468.$t === "None") {
                                return n.f[2];
                              }
                              if ($match$468.$t === "Some") {
                                const s = $match$468;
                                return (() => {
                                  const newRight = imiRemoveMin(n.f[3]);
                                  return imiBalance(imiNode(s.f[0].f[0], s.f[0].f[1], n.f[2], newRight));
                                })();
                              }
                              throw $matchFail("src/data/imapi.pf", 468);
                            })(successor);
                          })();
                        }
                        throw $matchFail("src/data/imapi.pf", 457);
                      })(n.f[3]);
                    })();
                  }
                  throw $matchFail("src/data/imapi.pf", 451);
                })(n.f[2]);
              }
            }
          })();
        }
        throw $matchFail("src/data/imapi.pf", 403);
      })(m);
    }
    function imiKeysAcc(m, acc) {
      return (($match$500) => {
        if ($match$500.$t === "MLeaf") {
          return acc;
        }
        if ($match$500.$t === "MNode") {
          const n = $match$500;
          return (() => {
            const withRight = imiKeysAcc(n.f[3], acc);
            const withNode = $cons(n.f[0], withRight);
            return imiKeysAcc(n.f[2], withNode);
          })();
        }
        throw $matchFail("src/data/imapi.pf", 500);
      })(m);
    }
    function imiKeys(m) {
      return imiKeysAcc(m, []);
    }
    function imiEntriesAcc(m, acc) {
      return (($match$531) => {
        if ($match$531.$t === "MLeaf") {
          return acc;
        }
        if ($match$531.$t === "MNode") {
          const n = $match$531;
          return (() => {
            const withRight = imiEntriesAcc(n.f[3], acc);
            const entry = $makeRecord("Pair", ["key", "value"], [n.f[0], n.f[1]]);
            const withNode = $cons(entry, withRight);
            return imiEntriesAcc(n.f[2], withNode);
          })();
        }
        throw $matchFail("src/data/imapi.pf", 531);
      })(m);
    }
    function imiEntries(m) {
      return imiEntriesAcc(m, []);
    }
    function imiPutEntry(acc, entry) {
      return imiPut(acc, $field(entry, "key"), $field(entry, "value"));
    }
    function imiUnion(a, b) {
      return $reduce(imiPutEntry, a, imiEntries(b));
    }
    function imiFromList(pairs) {
      return $reduce(imiPutEntry, imiEmpty(), pairs);
    }
    function imiMap(f, m) {
      return (($match$595) => {
        if ($match$595.$t === "MLeaf") {
          return MLeaf;
        }
        if ($match$595.$t === "MNode") {
          const n = $match$595;
          return (() => {
            const newLeft = imiMap(f, n.f[2]);
            const newRight = imiMap(f, n.f[3]);
            return imiNode(n.f[0], f(n.f[1]), newLeft, newRight);
          })();
        }
        throw $matchFail("src/data/imapi.pf", 595);
      })(m);
    }
    exports["MLeaf"] = MLeaf;
    exports["MNode"] = MNode;
    exports["imiEmpty"] = imiEmpty;
    exports["imiGet"] = imiGet;
    exports["imiPut"] = imiPut;
    exports["imiHas"] = imiHas;
    exports["imiRemove"] = imiRemove;
    exports["imiKeys"] = imiKeys;
    exports["imiEntries"] = imiEntries;
    exports["imiUnion"] = imiUnion;
    exports["imiFromList"] = imiFromList;
    exports["imiMap"] = imiMap;
  });
  $registerSchemas([{name: "TInt", union: "Type", fields: [], variant: true}, {name: "TFloat", union: "Type", fields: [], variant: true}, {name: "TBool", union: "Type", fields: [], variant: true}, {name: "TStr", union: "Type", fields: [], variant: true}, {name: "TChar", union: "Type", fields: [], variant: true}, {name: "TByte", union: "Type", fields: [], variant: true}, {name: "TUnit", union: "Type", fields: [], variant: true}, {name: "TNonZero", union: "Type", fields: [], variant: true}, {name: "TAny", union: "Type", fields: [], variant: true}, {name: "TList", union: "Type", fields: ["elem"], variant: true}, {name: "TArray", union: "Type", fields: ["elem"], variant: true}, {name: "TDict", union: "Type", fields: ["keyT", "valT"], variant: true}, {name: "TFun", union: "Type", fields: ["params", "ret"], variant: true}, {name: "TProc", union: "Type", fields: ["params", "ret", "isAsync"], variant: true}, {name: "TNamed", union: "Type", fields: ["tname", "args"], variant: true}, {name: "TVariant", union: "Type", fields: ["vname", "unionName", "args"], variant: true}, {name: "TVar", union: "Type", fields: ["v"], variant: true}, {name: "TUnknown", union: "Type", fields: [], variant: true}, {name: "InferScheme", union: null, fields: ["vars", "constraints", "body"], variant: false}, {name: "Subst", union: null, fields: ["m"], variant: false}, {name: "HasField", union: "Constraint", fields: ["tvar", "fname", "ftype", "span"], variant: true}, {name: "Equatable", union: "Constraint", fields: ["t", "span"], variant: true}, {name: "Comparable", union: "Constraint", fields: ["t", "span"], variant: true}, {name: "TcSt", union: null, fields: ["nextVar", "subst", "pending", "types", "diags", "records", "variants"], variant: false}, {name: "TcOut", union: null, fields: ["st", "val"], variant: false}, {name: "InferResult", union: null, fields: ["types", "exports", "diags"], variant: false}, {name: "FieldMono", union: "FieldShape", fields: ["t"], variant: true}, {name: "FieldSlot", union: "FieldShape", fields: ["index"], variant: true}, {name: "FieldInfo", union: null, fields: ["fname", "shape"], variant: false}, {name: "VariantInfo", union: null, fields: ["vname", "unionName", "fields", "slotCount"], variant: false}, {name: "TypeInfo", union: null, fields: ["tname", "isUnion", "fields", "variants", "slotCount"], variant: false}, {name: "FieldsOut", union: null, fields: ["fields", "slotCount"], variant: false}, {name: "VariantBuildOut", union: null, fields: ["variants", "slotCount"], variant: false}, {name: "FreshListOut", union: null, fields: ["st", "types"], variant: false}, {name: "EnvOut", union: null, fields: ["st", "env"], variant: false}, {name: "ExprOut", union: null, fields: ["st", "typ"], variant: false}, {name: "BodyOut", union: null, fields: ["st", "typ"], variant: false}, {name: "NameScan", union: null, fields: ["refs", "bound"], variant: false}, {name: "BindingDecl", union: null, fields: ["name", "stmt", "deps"], variant: false}, {name: "DfsOut", union: null, fields: ["visited", "order"], variant: false}, {name: "ComponentOut", union: null, fields: ["visited", "members"], variant: false}, {name: "ComponentsOut", union: null, fields: ["visited", "groups"], variant: false}, {name: "TScheme", union: "TcEntry", fields: ["scheme"], variant: true}, {name: "TMono", union: "TcEntry", fields: ["t"], variant: true}, {name: "TNamespace", union: "TcEntry", fields: ["table"], variant: true}, {name: "TTypeName", union: "TcEntry", fields: ["name"], variant: true}, {name: "TVariantCtor", union: "TcEntry", fields: ["info"], variant: true}, {name: "NsNotNamespace", union: "NsLookup", fields: [], variant: true}, {name: "NsMember", union: "NsLookup", fields: ["entry"], variant: true}, {name: "NsMissing", union: "NsLookup", fields: ["alias"], variant: true}]);
  $maps["src/check/types"] = {"../syntax/ast": "src/syntax/ast", "../syntax/token": "src/syntax/token", "./diag": "src/check/diag", "./iface": "src/check/iface", "../data/imaps": "src/data/imaps", "../data/imapi": "src/data/imapi", "../compat": "src/compat"};
  $mods["src/check/types"] = ((exports, $require) => {
    const A = $require("../syntax/ast");
    const T = $require("../syntax/token");
    const D = $require("./diag");
    const I = $require("./iface");
    const IMS = $require("../data/imaps");
    const IMI = $require("../data/imapi");
    const Compat = $require("../compat");
    const TInt = $makeVariant("TInt", "Type", [], []);
    const TFloat = $makeVariant("TFloat", "Type", [], []);
    const TBool = $makeVariant("TBool", "Type", [], []);
    const TStr = $makeVariant("TStr", "Type", [], []);
    const TChar = $makeVariant("TChar", "Type", [], []);
    const TByte = $makeVariant("TByte", "Type", [], []);
    const TUnit = $makeVariant("TUnit", "Type", [], []);
    const TNonZero = $makeVariant("TNonZero", "Type", [], []);
    const TAny = $makeVariant("TAny", "Type", [], []);
    function TList(elem) {
      return $makeVariant("TList", "Type", ["elem"], [elem]);
    }
    function TArray(elem) {
      return $makeVariant("TArray", "Type", ["elem"], [elem]);
    }
    function TDict(keyT, valT) {
      return $makeVariant("TDict", "Type", ["keyT", "valT"], [keyT, valT]);
    }
    function TFun(params, ret) {
      return $makeVariant("TFun", "Type", ["params", "ret"], [params, ret]);
    }
    function TProc(params, ret, isAsync) {
      return $makeVariant("TProc", "Type", ["params", "ret", "isAsync"], [params, ret, isAsync]);
    }
    function TNamed(tname, args) {
      return $makeVariant("TNamed", "Type", ["tname", "args"], [tname, args]);
    }
    function TVariant(vname, unionName, args) {
      return $makeVariant("TVariant", "Type", ["vname", "unionName", "args"], [vname, unionName, args]);
    }
    function TVar(v) {
      return $makeVariant("TVar", "Type", ["v"], [v]);
    }
    const TUnknown = $makeVariant("TUnknown", "Type", [], []);
    function HasField(tvar, fname, ftype, span) {
      return $makeVariant("HasField", "Constraint", ["tvar", "fname", "ftype", "span"], [tvar, fname, ftype, span]);
    }
    function Equatable(t, span) {
      return $makeVariant("Equatable", "Constraint", ["t", "span"], [t, span]);
    }
    function Comparable(t, span) {
      return $makeVariant("Comparable", "Constraint", ["t", "span"], [t, span]);
    }
    function FieldMono(t) {
      return $makeVariant("FieldMono", "FieldShape", ["t"], [t]);
    }
    function FieldSlot(index) {
      return $makeVariant("FieldSlot", "FieldShape", ["index"], [index]);
    }
    function TScheme(scheme) {
      return $makeVariant("TScheme", "TcEntry", ["scheme"], [scheme]);
    }
    function TMono(t) {
      return $makeVariant("TMono", "TcEntry", ["t"], [t]);
    }
    function TNamespace(table) {
      return $makeVariant("TNamespace", "TcEntry", ["table"], [table]);
    }
    function TTypeName(name) {
      return $makeVariant("TTypeName", "TcEntry", ["name"], [name]);
    }
    function TVariantCtor(info) {
      return $makeVariant("TVariantCtor", "TcEntry", ["info"], [info]);
    }
    function tInt() {
      return TInt;
    }
    function tFloat() {
      return TFloat;
    }
    function tBool() {
      return TBool;
    }
    function tStr() {
      return TStr;
    }
    function tChar() {
      return TChar;
    }
    function tByte() {
      return TByte;
    }
    function tUnit() {
      return TUnit;
    }
    function tNonZero() {
      return TNonZero;
    }
    function tAny() {
      return TAny;
    }
    function tList(elem) {
      return $makeVariant("TList", "Type", ["elem"], [elem]);
    }
    function tArray(elem) {
      return $makeVariant("TArray", "Type", ["elem"], [elem]);
    }
    function tDict(keyT, valT) {
      return $makeVariant("TDict", "Type", ["keyT", "valT"], [keyT, valT]);
    }
    function tFun(params, ret) {
      return $makeVariant("TFun", "Type", ["params", "ret"], [params, ret]);
    }
    function tProc(params, ret, isAsync) {
      return $makeVariant("TProc", "Type", ["params", "ret", "isAsync"], [params, ret, isAsync]);
    }
    function tNamed(tname, args) {
      return $makeVariant("TNamed", "Type", ["tname", "args"], [tname, args]);
    }
    function tVariant(vname, unionName, args) {
      return $makeVariant("TVariant", "Type", ["vname", "unionName", "args"], [vname, unionName, args]);
    }
    function tVar(v) {
      return $makeVariant("TVar", "Type", ["v"], [v]);
    }
    function tUnknown() {
      return TUnknown;
    }
    function mkScheme(vars, constraints, body) {
      return $makeRecord("InferScheme", ["vars", "constraints", "body"], [vars, constraints, body]);
    }
    function emptySubst() {
      return $makeRecord("Subst", ["m"], [$field(IMI, "imiEmpty")()]);
    }
    function mkInferResult(types, exports, diags) {
      return $makeRecord("InferResult", ["types", "exports", "diags"], [types, exports, diags]);
    }
    function out(st, val) {
      return $makeRecord("TcOut", ["st", "val"], [st, val]);
    }
    function exprOut(st, typ) {
      return $makeRecord("ExprOut", ["st", "typ"], [st, typ]);
    }
    function envOut(st, env) {
      return $makeRecord("EnvOut", ["st", "env"], [st, env]);
    }
    function bodyOut(st, typ) {
      return $makeRecord("BodyOut", ["st", "typ"], [st, typ]);
    }
    function freshListOut(st, types) {
      return $makeRecord("FreshListOut", ["st", "types"], [st, types]);
    }
    function emptyState() {
      return $makeRecord("TcSt", ["nextVar", "subst", "pending", "types", "diags", "records", "variants"], [0, emptySubst(), [], $field(IMI, "imiEmpty")(), [], $field(IMS, "imsEmpty")(), $field(IMS, "imsEmpty")()]);
    }
    function withNextVar(st, nextVar) {
      return $makeRecord("TcSt", ["nextVar", "subst", "pending", "types", "diags", "records", "variants"], [nextVar, st.f[1], st.f[2], st.f[3], st.f[4], st.f[5], st.f[6]]);
    }
    function withSubst(st, subst) {
      return $makeRecord("TcSt", ["nextVar", "subst", "pending", "types", "diags", "records", "variants"], [st.f[0], subst, st.f[2], st.f[3], st.f[4], st.f[5], st.f[6]]);
    }
    function withPending(st, pending) {
      return $makeRecord("TcSt", ["nextVar", "subst", "pending", "types", "diags", "records", "variants"], [st.f[0], st.f[1], pending, st.f[3], st.f[4], st.f[5], st.f[6]]);
    }
    function withTypes(st, types) {
      return $makeRecord("TcSt", ["nextVar", "subst", "pending", "types", "diags", "records", "variants"], [st.f[0], st.f[1], st.f[2], types, st.f[4], st.f[5], st.f[6]]);
    }
    function withDiags(st, diags) {
      return $makeRecord("TcSt", ["nextVar", "subst", "pending", "types", "diags", "records", "variants"], [st.f[0], st.f[1], st.f[2], st.f[3], diags, st.f[5], st.f[6]]);
    }
    function withRecords(st, records) {
      return $makeRecord("TcSt", ["nextVar", "subst", "pending", "types", "diags", "records", "variants"], [st.f[0], st.f[1], st.f[2], st.f[3], st.f[4], records, st.f[6]]);
    }
    function withVariants(st, variants) {
      return $makeRecord("TcSt", ["nextVar", "subst", "pending", "types", "diags", "records", "variants"], [st.f[0], st.f[1], st.f[2], st.f[3], st.f[4], st.f[5], variants]);
    }
    function addDiag(st, diag) {
      return withDiags(st, $cons(diag, st.f[4]));
    }
    function typeDiag(path, span, message) {
      return $field(D, "err")($makeVariant("TypeD", "DiagCode", [], []), message, path, span);
    }
    function addTypeDiag(st, path, span, message) {
      return addDiag(st, typeDiag(path, span, message));
    }
    function addTypedNode(st, id, typ) {
      return withTypes(st, $field(IMI, "imiPut")(st.f[3], id, apply(st.f[1], typ)));
    }
    function nextUnsubstitutedVar(st, v) {
      while (true) {
        const $match$345 = $field(IMI, "imiGet")(st.f[1].f[0], v);
        if ($match$345.$t === "None") {
          return v;
        }
        if ($match$345.$t === "Some") {
          const $tc$359$0 = st;
          const $tc$359$1 = $addI(v, 1);
          st = $tc$359$0;
          v = $tc$359$1;
          continue;
        }
        throw $matchFail("src/check/types.pf", 345);
      }
    }
    function freshVar(st) {
      const v = nextUnsubstitutedVar(st, st.f[0]);
      return $makeRecord("Pair", ["key", "value"], [withNextVar(st, $addI(v, 1)), $makeVariant("TVar", "Type", ["v"], [v])]);
    }
    function freshVars(st, n, acc) {
      while (true) {
        if ($leI(n, 0)) {
          return freshListOut(st, $reverse(acc));
        } else {
          const fv = freshVar(st);
          const $tc$404$0 = fv.f[0];
          const $tc$404$1 = $subI(n, 1);
          const $tc$404$2 = $cons(fv.f[1], acc);
          st = $tc$404$0;
          n = $tc$404$1;
          acc = $tc$404$2;
          continue;
        }
      }
    }
    function freshTypeList(st, n) {
      return freshVars(st, n, []);
    }
    function appendList(a, b) {
      return $reduce((acc, x) => $cons(x, acc), b, $reverse(a));
    }
    function appendOne(xs, x) {
      return $reverse($cons(x, $reverse(xs)));
    }
    function intContains(xs, v) {
      return (($match$438) => {
        if ($match$438.$t === "None") {
          return false;
        }
        if ($match$438.$t === "Some") {
          const cell = $match$438;
          return (() => {
            const p = cell.f[0];
            if ($eqI(p.f[0], v)) {
              return true;
            } else {
              return intContains(p.f[1], v);
            }
          })();
        }
        throw $matchFail("src/check/types.pf", 438);
      })($field(Compat, "uncons")(xs));
    }
    function intAdd(xs, v) {
      if (intContains(xs, v)) {
        return xs;
      } else {
        return $cons(v, xs);
      }
    }
    function intUnion(a, b) {
      return (($match$476) => {
        if ($match$476.$t === "None") {
          return a;
        }
        if ($match$476.$t === "Some") {
          const cell = $match$476;
          return (() => {
            const p = cell.f[0];
            return intUnion(intAdd(a, p.f[0]), p.f[1]);
          })();
        }
        throw $matchFail("src/check/types.pf", 476);
      })($field(Compat, "uncons")(b));
    }
    function intRemoveAll(xs, remove) {
      return (($match$498) => {
        if ($match$498.$t === "None") {
          return [];
        }
        if ($match$498.$t === "Some") {
          const cell = $match$498;
          return (() => {
            const p = cell.f[0];
            const rest = intRemoveAll(p.f[1], remove);
            if (intContains(remove, p.f[0])) {
              return rest;
            } else {
              return $cons(p.f[0], rest);
            }
          })();
        }
        throw $matchFail("src/check/types.pf", 498);
      })($field(Compat, "uncons")(xs));
    }
    function listLength(xs) {
      return $length(xs);
    }
    function listMapTypes(f, xs) {
      return $map(f, xs);
    }
    function maybeFirst(xs, fallback) {
      return (($match$541) => {
        if ($match$541.$t === "None") {
          return fallback;
        }
        if ($match$541.$t === "Some") {
          const x = $match$541;
          return x.f[0];
        }
        throw $matchFail("src/check/types.pf", 541);
      })($field(Compat, "listAt")(xs, 0));
    }
    function joinTypeList(ts) {
      return $join($map(formatType, ts), ", ");
    }
    function formatType(t) {
      return (($match$561) => {
        if ($match$561.$t === "TInt") {
          return "Int";
        }
        if ($match$561.$t === "TFloat") {
          return "Float";
        }
        if ($match$561.$t === "TBool") {
          return "Bool";
        }
        if ($match$561.$t === "TStr") {
          return "Str";
        }
        if ($match$561.$t === "TChar") {
          return "Char";
        }
        if ($match$561.$t === "TByte") {
          return "Byte";
        }
        if ($match$561.$t === "TUnit") {
          return "Unit";
        }
        if ($match$561.$t === "TNonZero") {
          return "NonZero";
        }
        if ($match$561.$t === "TAny") {
          return "Any";
        }
        if ($match$561.$t === "TList") {
          const x = $match$561;
          return $concatS($concatS("List<", formatType(x.f[0])), ">");
        }
        if ($match$561.$t === "TArray") {
          const x = $match$561;
          return $concatS($concatS("Array<", formatType(x.f[0])), ">");
        }
        if ($match$561.$t === "TDict") {
          const x = $match$561;
          return $concatS($concatS($concatS($concatS("Dict<", formatType(x.f[0])), ", "), formatType(x.f[1])), ">");
        }
        if ($match$561.$t === "TFun") {
          const f = $match$561;
          return $concatS($concatS($concatS("(", joinTypeList(f.f[0])), ") -> "), formatType(f.f[1]));
        }
        if ($match$561.$t === "TProc") {
          const p = $match$561;
          return $concatS($concatS($concatS("proc(", joinTypeList(p.f[0])), ") -> "), formatType(p.f[1]));
        }
        if ($match$561.$t === "TNamed") {
          const n = $match$561;
          return (() => {
            if ($eqI($length(n.f[1]), 0)) {
              return n.f[0];
            } else {
              return $concatS($concatS($concatS(n.f[0], "<"), joinTypeList(n.f[1])), ">");
            }
          })();
        }
        if ($match$561.$t === "TVariant") {
          const v = $match$561;
          return (() => {
            if ($eqI($length(v.f[2]), 0)) {
              return v.f[0];
            } else {
              return $concatS($concatS($concatS(v.f[0], "<"), joinTypeList(v.f[2])), ">");
            }
          })();
        }
        if ($match$561.$t === "TVar") {
          const v = $match$561;
          return $concatS("'", $str(v.f[0]));
        }
        if ($match$561.$t === "TUnknown") {
          return "?";
        }
        throw $matchFail("src/check/types.pf", 561);
      })(t);
    }
    function substGet(subst, v) {
      return $field(IMI, "imiGet")(subst.f[0], v);
    }
    function substPut(subst, v, t) {
      return $makeRecord("Subst", ["m"], [$field(IMI, "imiPut")(subst.f[0], v, t)]);
    }
    function applyList(subst, ts) {
      return $map((t) => applyType(subst, t), ts);
    }
    function applyType(subst, t) {
      return (($match$713) => {
        if ($match$713.$t === "TVar") {
          const v = $match$713;
          return (() => {
            return (($match$716) => {
              if ($match$716.$t === "None") {
                return t;
              }
              if ($match$716.$t === "Some") {
                const found = $match$716;
                return applyType(subst, found.f[0]);
              }
              throw $matchFail("src/check/types.pf", 716);
            })(substGet(subst, v.f[0]));
          })();
        }
        if ($match$713.$t === "TList") {
          const x = $match$713;
          return $makeVariant("TList", "Type", ["elem"], [applyType(subst, x.f[0])]);
        }
        if ($match$713.$t === "TArray") {
          const x = $match$713;
          return $makeVariant("TArray", "Type", ["elem"], [applyType(subst, x.f[0])]);
        }
        if ($match$713.$t === "TDict") {
          const x = $match$713;
          return $makeVariant("TDict", "Type", ["keyT", "valT"], [applyType(subst, x.f[0]), applyType(subst, x.f[1])]);
        }
        if ($match$713.$t === "TFun") {
          const f = $match$713;
          return $makeVariant("TFun", "Type", ["params", "ret"], [applyList(subst, f.f[0]), applyType(subst, f.f[1])]);
        }
        if ($match$713.$t === "TProc") {
          const p = $match$713;
          return $makeVariant("TProc", "Type", ["params", "ret", "isAsync"], [applyList(subst, p.f[0]), applyType(subst, p.f[1]), p.f[2]]);
        }
        if ($match$713.$t === "TNamed") {
          const n = $match$713;
          return $makeVariant("TNamed", "Type", ["tname", "args"], [n.f[0], applyList(subst, n.f[1])]);
        }
        if ($match$713.$t === "TVariant") {
          const v = $match$713;
          return $makeVariant("TVariant", "Type", ["vname", "unionName", "args"], [v.f[0], v.f[1], applyList(subst, v.f[2])]);
        }
        if (true) {
          return t;
        }
        throw $matchFail("src/check/types.pf", 713);
      })(t);
    }
    function apply(subst, t) {
      return applyType(subst, t);
    }
    function freeVarsList(ts) {
      return $reduce((acc, t) => intUnion(acc, freeVars(t)), [], ts);
    }
    function freeVars(t) {
      while (true) {
        const $match$818 = t;
        if ($match$818.$t === "TVar") {
          const v = $match$818;
          return [v.f[0]];
        }
        if ($match$818.$t === "TList") {
          const x = $match$818;
          const $tc$826$0 = x.f[0];
          t = $tc$826$0;
          continue;
        }
        if ($match$818.$t === "TArray") {
          const x = $match$818;
          const $tc$830$0 = x.f[0];
          t = $tc$830$0;
          continue;
        }
        if ($match$818.$t === "TDict") {
          const x = $match$818;
          return intUnion(freeVars(x.f[0]), freeVars(x.f[1]));
        }
        if ($match$818.$t === "TFun") {
          const f = $match$818;
          return intUnion(freeVarsList(f.f[0]), freeVars(f.f[1]));
        }
        if ($match$818.$t === "TProc") {
          const p = $match$818;
          return intUnion(freeVarsList(p.f[0]), freeVars(p.f[1]));
        }
        if ($match$818.$t === "TNamed") {
          const n = $match$818;
          return freeVarsList(n.f[1]);
        }
        if ($match$818.$t === "TVariant") {
          const v = $match$818;
          return freeVarsList(v.f[2]);
        }
        if (true) {
          return [];
        }
        throw $matchFail("src/check/types.pf", 818);
      }
    }
    function schemeFreeVars(scheme) {
      return intRemoveAll(freeVars(scheme.f[2]), scheme.f[0]);
    }
    function envEntryFreeVars(entry) {
      return (($match$883) => {
        if ($match$883.$t === "TScheme") {
          const s = $match$883;
          return schemeFreeVars(s.f[0]);
        }
        if ($match$883.$t === "TMono") {
          const m = $match$883;
          return freeVars(m.f[0]);
        }
        if ($match$883.$t === "TNamespace") {
          return [];
        }
        if ($match$883.$t === "TTypeName") {
          return [];
        }
        if ($match$883.$t === "TVariantCtor") {
          return [];
        }
        throw $matchFail("src/check/types.pf", 883);
      })(entry);
    }
    function envFreeVarsFromEntries(entries, acc) {
      return (($match$898) => {
        if ($match$898.$t === "None") {
          return acc;
        }
        if ($match$898.$t === "Some") {
          const cell = $match$898;
          return (() => {
            const p = cell.f[0];
            return envFreeVarsFromEntries(p.f[1], intUnion(acc, envEntryFreeVars($field(p.f[0], "value"))));
          })();
        }
        throw $matchFail("src/check/types.pf", 898);
      })($field(Compat, "uncons")(entries));
    }
    function envFreeVars(env) {
      return envFreeVarsFromEntries($field(IMS, "imsEntries")(env), []);
    }
    function isSelfHeaded(st, ownName, t) {
      return (($match$932) => {
        if ($match$932.$t === "TNamed") {
          const n = $match$932;
          return n.f[0] === ownName;
        }
        if ($match$932.$t === "TVariant") {
          const v = $match$932;
          return v.f[1] === ownName;
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/check/types.pf", 932);
      })(apply(st.f[1], t));
    }
    function fieldShapeFreeVars(st, ownName, shape) {
      return (($match$949) => {
        if ($match$949.$t === "FieldMono") {
          const f = $match$949;
          return (() => {
            if (isSelfHeaded(st, ownName, f.f[0])) {
              return [];
            } else {
              return freeVars(apply(st.f[1], f.f[0]));
            }
          })();
        }
        if ($match$949.$t === "FieldSlot") {
          return [];
        }
        throw $matchFail("src/check/types.pf", 949);
      })(shape);
    }
    function fieldInfosFreeVars(st, ownName, fields, acc) {
      return (($match$973) => {
        if ($match$973.$t === "None") {
          return acc;
        }
        if ($match$973.$t === "Some") {
          const cell = $match$973;
          return (() => {
            const p = cell.f[0];
            return fieldInfosFreeVars(st, ownName, p.f[1], intUnion(acc, fieldShapeFreeVars(st, ownName, $field(p.f[0], "shape"))));
          })();
        }
        throw $matchFail("src/check/types.pf", 973);
      })($field(Compat, "uncons")(fields));
    }
    function variantInfosFreeVars(st, ownName, variants, acc) {
      return (($match$1002) => {
        if ($match$1002.$t === "None") {
          return acc;
        }
        if ($match$1002.$t === "Some") {
          const cell = $match$1002;
          return (() => {
            const p = cell.f[0];
            const withFields = fieldInfosFreeVars(st, ownName, $field(p.f[0], "fields"), acc);
            return variantInfosFreeVars(st, ownName, p.f[1], withFields);
          })();
        }
        throw $matchFail("src/check/types.pf", 1002);
      })($field(Compat, "uncons")(variants));
    }
    function typeInfoFreeVars(st, info) {
      const fields = fieldInfosFreeVars(st, $field(info, "tname"), $field(info, "fields"), []);
      return variantInfosFreeVars(st, $field(info, "tname"), $field(info, "variants"), fields);
    }
    function declarationFreeVarsLoop(st, entries, acc) {
      return (($match$1050) => {
        if ($match$1050.$t === "None") {
          return acc;
        }
        if ($match$1050.$t === "Some") {
          const cell = $match$1050;
          return (() => {
            const p = cell.f[0];
            return declarationFreeVarsLoop(st, p.f[1], intUnion(acc, typeInfoFreeVars(st, $field(p.f[0], "value"))));
          })();
        }
        throw $matchFail("src/check/types.pf", 1050);
      })($field(Compat, "uncons")(entries));
    }
    function declarationFreeVars(st) {
      return declarationFreeVarsLoop(st, $field(IMS, "imsEntries")(st.f[5]), []);
    }
    function occursIn(v, t, subst) {
      const applied = applyType(subst, t);
      return intContains(freeVars(applied), v);
    }
    function sameScalar(a, b) {
      return (($match$1101) => {
        if ($match$1101.$t === "TInt") {
          return (() => {
            return (($match$1104) => {
              if ($match$1104.$t === "TInt") {
                return true;
              }
              if (true) {
                return false;
              }
              throw $matchFail("src/check/types.pf", 1104);
            })(b);
          })();
        }
        if ($match$1101.$t === "TFloat") {
          return (() => {
            return (($match$1110) => {
              if ($match$1110.$t === "TFloat") {
                return true;
              }
              if (true) {
                return false;
              }
              throw $matchFail("src/check/types.pf", 1110);
            })(b);
          })();
        }
        if ($match$1101.$t === "TBool") {
          return (() => {
            return (($match$1116) => {
              if ($match$1116.$t === "TBool") {
                return true;
              }
              if (true) {
                return false;
              }
              throw $matchFail("src/check/types.pf", 1116);
            })(b);
          })();
        }
        if ($match$1101.$t === "TStr") {
          return (() => {
            return (($match$1122) => {
              if ($match$1122.$t === "TStr") {
                return true;
              }
              if (true) {
                return false;
              }
              throw $matchFail("src/check/types.pf", 1122);
            })(b);
          })();
        }
        if ($match$1101.$t === "TChar") {
          return (() => {
            return (($match$1128) => {
              if ($match$1128.$t === "TChar") {
                return true;
              }
              if (true) {
                return false;
              }
              throw $matchFail("src/check/types.pf", 1128);
            })(b);
          })();
        }
        if ($match$1101.$t === "TByte") {
          return (() => {
            return (($match$1134) => {
              if ($match$1134.$t === "TByte") {
                return true;
              }
              if (true) {
                return false;
              }
              throw $matchFail("src/check/types.pf", 1134);
            })(b);
          })();
        }
        if ($match$1101.$t === "TUnit") {
          return (() => {
            return (($match$1140) => {
              if ($match$1140.$t === "TUnit") {
                return true;
              }
              if (true) {
                return false;
              }
              throw $matchFail("src/check/types.pf", 1140);
            })(b);
          })();
        }
        if ($match$1101.$t === "TNonZero") {
          return (() => {
            return (($match$1146) => {
              if ($match$1146.$t === "TNonZero") {
                return true;
              }
              if (true) {
                return false;
              }
              throw $matchFail("src/check/types.pf", 1146);
            })(b);
          })();
        }
        if ($match$1101.$t === "TAny") {
          return true;
        }
        if ($match$1101.$t === "TUnknown") {
          return true;
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/check/types.pf", 1101);
      })(a);
    }
    function widenVariant(t) {
      return (($match$1156) => {
        if ($match$1156.$t === "TVariant") {
          const v = $match$1156;
          return $makeVariant("TNamed", "Type", ["tname", "args"], [v.f[1], v.f[2]]);
        }
        if (true) {
          return t;
        }
        throw $matchFail("src/check/types.pf", 1156);
      })(t);
    }
    function bindVar(st, v, t, path, span) {
      const t1 = widenVariant(apply(st.f[1], t));
      return (($match$1174) => {
        if ($match$1174.$t === "TVar") {
          const other = $match$1174;
          return (() => {
            if ($eqI(other.f[0], v)) {
              return st;
            } else {
              return withSubst(st, substPut(st.f[1], v, t1));
            }
          })();
        }
        if (true) {
          return (() => {
            if (occursIn(v, t1, st.f[1])) {
              return addTypeDiag(st, path, span, $concatS($concatS($concatS($concatS("Recursive type would be required: '", $str(v)), " occurs in "), formatType(t1)), "."));
            } else {
              return withSubst(st, substPut(st.f[1], v, t1));
            }
          })();
        }
        throw $matchFail("src/check/types.pf", 1174);
      })(t1);
    }
    function bindParamName(env, pname, ty) {
      if (pname === "_") {
        return env;
      } else {
        return putEnv(env, pname, $makeVariant("TMono", "TcEntry", ["t"], [ty]));
      }
    }
    function schemeOrMono(isGen, env, st1, solved) {
      if (isGen) {
        return $makeVariant("TScheme", "TcEntry", ["scheme"], [generalizeWithEnv(env, st1, solved)]);
      } else {
        return $makeVariant("TMono", "TcEntry", ["t"], [solved]);
      }
    }
    function builtinTyName(nm, argTs) {
      if (nm === "Int") {
        return TInt;
      } else {
        if (nm === "Float") {
          return TFloat;
        } else {
          if (nm === "Bool") {
            return TBool;
          } else {
            if (nm === "Str" || nm === "String") {
              return TStr;
            } else {
              if (nm === "Char") {
                return TChar;
              } else {
                if (nm === "Byte") {
                  return TByte;
                } else {
                  if (nm === "Unit") {
                    return TUnit;
                  } else {
                    if (nm === "NonZero") {
                      return TNonZero;
                    } else {
                      if (nm === "Any") {
                        return TAny;
                      } else {
                        if (nm === "List") {
                          return $makeVariant("TList", "Type", ["elem"], [maybeFirst(argTs, TUnknown)]);
                        } else {
                          if (nm === "Array") {
                            return $makeVariant("TArray", "Type", ["elem"], [maybeFirst(argTs, TUnknown)]);
                          } else {
                            return $makeVariant("TNamed", "Type", ["tname", "args"], [nm, argTs]);
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    function varsOutsideSlots(t) {
      while (true) {
        const $match$1343 = t;
        if ($match$1343.$t === "TVar") {
          const v = $match$1343;
          return [v.f[0]];
        }
        if ($match$1343.$t === "TList") {
          const x = $match$1343;
          const $tc$1351$0 = x.f[0];
          t = $tc$1351$0;
          continue;
        }
        if ($match$1343.$t === "TArray") {
          const x = $match$1343;
          const $tc$1355$0 = x.f[0];
          t = $tc$1355$0;
          continue;
        }
        if ($match$1343.$t === "TDict") {
          const x = $match$1343;
          return intUnion(varsOutsideSlots(x.f[0]), varsOutsideSlots(x.f[1]));
        }
        if ($match$1343.$t === "TFun") {
          const f = $match$1343;
          return intUnion(varsOutsideSlotsList(f.f[0]), varsOutsideSlots(f.f[1]));
        }
        if ($match$1343.$t === "TProc") {
          const pr = $match$1343;
          return intUnion(varsOutsideSlotsList(pr.f[0]), varsOutsideSlots(pr.f[1]));
        }
        if (true) {
          return [];
        }
        throw $matchFail("src/check/types.pf", 1343);
      }
    }
    function varsOutsideSlotsList(ts) {
      return (($match$1389) => {
        if ($match$1389.$t === "None") {
          return [];
        }
        if ($match$1389.$t === "Some") {
          const cell = $match$1389;
          return intUnion(varsOutsideSlots(cell.f[0].f[0]), varsOutsideSlotsList(cell.f[0].f[1]));
        }
        throw $matchFail("src/check/types.pf", 1389);
      })($field(Compat, "uncons")(ts));
    }
    function defaultSlotVar(t, v) {
      return applyType($makeRecord("Subst", ["m"], [$field(IMI, "imiPut")($field(IMI, "imiEmpty")(), v, TUnit)]), t);
    }
    function defaultSlotVarsLoop(t, vs) {
      while (true) {
        const $match$1423 = $field(Compat, "uncons")(vs);
        if ($match$1423.$t === "None") {
          return t;
        }
        if ($match$1423.$t === "Some") {
          const cell = $match$1423;
          const $tc$1439$0 = defaultSlotVar(t, cell.f[0].f[0]);
          const $tc$1439$1 = cell.f[0].f[1];
          t = $tc$1439$0;
          vs = $tc$1439$1;
          continue;
        }
        throw $matchFail("src/check/types.pf", 1423);
      }
    }
    function defaultResidualSlots(t) {
      const residual = intRemoveAll(freeVars(t), varsOutsideSlots(t));
      return defaultSlotVarsLoop(t, residual);
    }
    function checkExportGround(st, stmt, path, bname, solved) {
      if (stmtIsGenericExport(stmt)) {
        return st;
      } else {
        if (typeHasFreeVars(solved)) {
          return addTypeDiag(st, path, $field(A, "stmtSpan")(stmt), $concatS($concatS("Exported non-generic binding '", bname), "' is not ground; add a constraining use, or declare it generic."));
        } else {
          return st;
        }
      }
    }
    function unifyTypeLists(st, aTys, bTys, path, span) {
      if (!$eqI($length(aTys), $length(bTys))) {
        return addTypeDiag(st, path, span, "Arity mismatch while unifying type lists.");
      } else {
        return unifyTypeListsLoop(st, aTys, bTys, path, span);
      }
    }
    function unifyTypeListsLoop(st, aTys, bTys, path, span) {
      return (($match$1508) => {
        if ($match$1508.$t === "None") {
          return st;
        }
        if ($match$1508.$t === "Some") {
          const acell = $match$1508;
          return (() => {
            return (($match$1515) => {
              if ($match$1515.$t === "None") {
                return st;
              }
              if ($match$1515.$t === "Some") {
                const bcell = $match$1515;
                return (() => {
                  const aPair = acell.f[0];
                  const bPair = bcell.f[0];
                  const st1 = unify(st, aPair.f[0], bPair.f[0], path, span);
                  return unifyTypeListsLoop(st1, aPair.f[1], bPair.f[1], path, span);
                })();
              }
              throw $matchFail("src/check/types.pf", 1515);
            })($field(Compat, "uncons")(bTys));
          })();
        }
        throw $matchFail("src/check/types.pf", 1508);
      })($field(Compat, "uncons")(aTys));
    }
    function unifyNamed(st, aName, aArgs, bName, bArgs, path, span) {
      if (!(aName === bName)) {
        return addTypeDiag(st, path, span, $concatS($concatS($concatS($concatS("Cannot unify ", formatType($makeVariant("TNamed", "Type", ["tname", "args"], [aName, aArgs]))), " with "), formatType($makeVariant("TNamed", "Type", ["tname", "args"], [bName, bArgs]))), "."));
      } else {
        return unifyTypeLists(st, aArgs, bArgs, path, span);
      }
    }
    function unify(st, a, b, path, span) {
      const a1 = apply(st.f[1], a);
      const b1 = apply(st.f[1], b);
      return (($match$1599) => {
        if ($match$1599.$t === "TAny") {
          return st;
        }
        if ($match$1599.$t === "TUnknown") {
          return st;
        }
        if ($match$1599.$t === "TVar") {
          const av = $match$1599;
          return bindVar(st, av.f[0], b1, path, span);
        }
        if ($match$1599.$t === "TList") {
          const ax = $match$1599;
          return (() => {
            return (($match$1612) => {
              if ($match$1612.$t === "TList") {
                const bx = $match$1612;
                return unify(st, ax.f[0], bx.f[0], path, span);
              }
              if ($match$1612.$t === "TVar") {
                const bv = $match$1612;
                return bindVar(st, bv.f[0], a1, path, span);
              }
              if ($match$1612.$t === "TAny") {
                return st;
              }
              if ($match$1612.$t === "TUnknown") {
                return st;
              }
              if (true) {
                return addTypeDiag(st, path, span, $concatS($concatS($concatS($concatS("Expected ", formatType(a1)), ", got "), formatType(b1)), "."));
              }
              throw $matchFail("src/check/types.pf", 1612);
            })(b1);
          })();
        }
        if ($match$1599.$t === "TArray") {
          const ax = $match$1599;
          return (() => {
            return (($match$1653) => {
              if ($match$1653.$t === "TArray") {
                const bx = $match$1653;
                return unify(st, ax.f[0], bx.f[0], path, span);
              }
              if ($match$1653.$t === "TVar") {
                const bv = $match$1653;
                return bindVar(st, bv.f[0], a1, path, span);
              }
              if ($match$1653.$t === "TAny") {
                return st;
              }
              if ($match$1653.$t === "TUnknown") {
                return st;
              }
              if (true) {
                return addTypeDiag(st, path, span, $concatS($concatS($concatS($concatS("Expected ", formatType(a1)), ", got "), formatType(b1)), "."));
              }
              throw $matchFail("src/check/types.pf", 1653);
            })(b1);
          })();
        }
        if ($match$1599.$t === "TDict") {
          const ax = $match$1599;
          return (() => {
            return (($match$1694) => {
              if ($match$1694.$t === "TDict") {
                const bx = $match$1694;
                return (() => {
                  const st1 = unify(st, ax.f[0], bx.f[0], path, span);
                  return unify(st1, ax.f[1], bx.f[1], path, span);
                })();
              }
              if ($match$1694.$t === "TVar") {
                const bv = $match$1694;
                return bindVar(st, bv.f[0], a1, path, span);
              }
              if ($match$1694.$t === "TAny") {
                return st;
              }
              if ($match$1694.$t === "TUnknown") {
                return st;
              }
              if (true) {
                return addTypeDiag(st, path, span, $concatS($concatS($concatS($concatS("Expected ", formatType(a1)), ", got "), formatType(b1)), "."));
              }
              throw $matchFail("src/check/types.pf", 1694);
            })(b1);
          })();
        }
        if ($match$1599.$t === "TFun") {
          const af = $match$1599;
          return (() => {
            return (($match$1747) => {
              if ($match$1747.$t === "TFun") {
                const bf = $match$1747;
                return (() => {
                  const st1 = unifyTypeLists(st, af.f[0], bf.f[0], path, span);
                  return unify(st1, af.f[1], bf.f[1], path, span);
                })();
              }
              if ($match$1747.$t === "TVar") {
                const bv = $match$1747;
                return bindVar(st, bv.f[0], a1, path, span);
              }
              if ($match$1747.$t === "TAny") {
                return st;
              }
              if ($match$1747.$t === "TUnknown") {
                return st;
              }
              if (true) {
                return addTypeDiag(st, path, span, $concatS($concatS($concatS($concatS("Expected ", formatType(a1)), ", got "), formatType(b1)), "."));
              }
              throw $matchFail("src/check/types.pf", 1747);
            })(b1);
          })();
        }
        if ($match$1599.$t === "TProc") {
          const ap = $match$1599;
          return (() => {
            return (($match$1800) => {
              if ($match$1800.$t === "TProc") {
                const bp = $match$1800;
                return (() => {
                  const st1 = unifyTypeLists(st, ap.f[0], bp.f[0], path, span);
                  const st2 = unify(st1, ap.f[1], bp.f[1], path, span);
                  if ($eq(ap.f[2], bp.f[2])) {
                    return st2;
                  } else {
                    return addTypeDiag(st2, path, span, "Cannot unify async and non-async procedures.");
                  }
                })();
              }
              if ($match$1800.$t === "TVar") {
                const bv = $match$1800;
                return bindVar(st, bv.f[0], a1, path, span);
              }
              if ($match$1800.$t === "TAny") {
                return st;
              }
              if ($match$1800.$t === "TUnknown") {
                return st;
              }
              if (true) {
                return addTypeDiag(st, path, span, $concatS($concatS($concatS($concatS("Expected ", formatType(a1)), ", got "), formatType(b1)), "."));
              }
              throw $matchFail("src/check/types.pf", 1800);
            })(b1);
          })();
        }
        if ($match$1599.$t === "TNamed") {
          const an = $match$1599;
          return (() => {
            return (($match$1868) => {
              if ($match$1868.$t === "TNamed") {
                const bn = $match$1868;
                return unifyNamed(st, an.f[0], an.f[1], bn.f[0], bn.f[1], path, span);
              }
              if ($match$1868.$t === "TVariant") {
                const bv = $match$1868;
                return (() => {
                  if (an.f[0] === bv.f[1]) {
                    return unifyTypeLists(st, an.f[1], bv.f[2], path, span);
                  } else {
                    return addTypeDiag(st, path, span, $concatS($concatS($concatS($concatS("Expected ", formatType(a1)), ", got "), formatType(b1)), "."));
                  }
                })();
              }
              if ($match$1868.$t === "TVar") {
                const bv = $match$1868;
                return bindVar(st, bv.f[0], a1, path, span);
              }
              if ($match$1868.$t === "TAny") {
                return st;
              }
              if ($match$1868.$t === "TUnknown") {
                return st;
              }
              if (true) {
                return addTypeDiag(st, path, span, $concatS($concatS($concatS($concatS("Expected ", formatType(a1)), ", got "), formatType(b1)), "."));
              }
              throw $matchFail("src/check/types.pf", 1868);
            })(b1);
          })();
        }
        if ($match$1599.$t === "TVariant") {
          const av = $match$1599;
          return (() => {
            return (($match$1949) => {
              if ($match$1949.$t === "TVariant") {
                const bv = $match$1949;
                return (() => {
                  if (av.f[1] === bv.f[1]) {
                    return unifyTypeLists(st, av.f[2], bv.f[2], path, span);
                  } else {
                    return addTypeDiag(st, path, span, $concatS($concatS($concatS($concatS("Expected ", formatType(a1)), ", got "), formatType(b1)), "."));
                  }
                })();
              }
              if ($match$1949.$t === "TNamed") {
                const bn = $match$1949;
                return (() => {
                  if (av.f[1] === bn.f[0]) {
                    return unifyTypeLists(st, av.f[2], bn.f[1], path, span);
                  } else {
                    return addTypeDiag(st, path, span, $concatS($concatS($concatS($concatS("Expected ", formatType(a1)), ", got "), formatType(b1)), "."));
                  }
                })();
              }
              if ($match$1949.$t === "TVar") {
                const bv = $match$1949;
                return bindVar(st, bv.f[0], a1, path, span);
              }
              if ($match$1949.$t === "TAny") {
                return st;
              }
              if ($match$1949.$t === "TUnknown") {
                return st;
              }
              if (true) {
                return addTypeDiag(st, path, span, $concatS($concatS($concatS($concatS("Expected ", formatType(a1)), ", got "), formatType(b1)), "."));
              }
              throw $matchFail("src/check/types.pf", 1949);
            })(b1);
          })();
        }
        if (true) {
          return (() => {
            return (($match$2053) => {
              if ($match$2053.$t === "TVar") {
                const bv = $match$2053;
                return bindVar(st, bv.f[0], a1, path, span);
              }
              if ($match$2053.$t === "TAny") {
                return st;
              }
              if ($match$2053.$t === "TUnknown") {
                return st;
              }
              if (true) {
                return (() => {
                  if (sameScalar(a1, b1)) {
                    return st;
                  } else {
                    return addTypeDiag(st, path, span, $concatS($concatS($concatS($concatS("Expected ", formatType(a1)), ", got "), formatType(b1)), "."));
                  }
                })();
              }
              throw $matchFail("src/check/types.pf", 2053);
            })(b1);
          })();
        }
        throw $matchFail("src/check/types.pf", 1599);
      })(a1);
    }
    function addConstraint(st, c) {
      return withPending(st, $cons(c, st.f[2]));
    }
    function typeContainsCallable(t) {
      while (true) {
        const $match$2106 = t;
        if ($match$2106.$t === "TFun") {
          return true;
        }
        if ($match$2106.$t === "TProc") {
          return true;
        }
        if ($match$2106.$t === "TList") {
          const x = $match$2106;
          const $tc$2113$0 = x.f[0];
          t = $tc$2113$0;
          continue;
        }
        if ($match$2106.$t === "TArray") {
          const x = $match$2106;
          const $tc$2117$0 = x.f[0];
          t = $tc$2117$0;
          continue;
        }
        if ($match$2106.$t === "TDict") {
          const x = $match$2106;
          return typeContainsCallable(x.f[0]) || typeContainsCallable(x.f[1]);
        }
        if ($match$2106.$t === "TNamed") {
          const n = $match$2106;
          return anyTypeContainsCallable(n.f[1]);
        }
        if ($match$2106.$t === "TVariant") {
          const v = $match$2106;
          return anyTypeContainsCallable(v.f[2]);
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/check/types.pf", 2106);
      }
    }
    function anyTypeContainsCallable(ts) {
      return (($match$2138) => {
        if ($match$2138.$t === "None") {
          return false;
        }
        if ($match$2138.$t === "Some") {
          const cell = $match$2138;
          return (() => {
            const p = cell.f[0];
            if (typeContainsCallable(p.f[0])) {
              return true;
            } else {
              return anyTypeContainsCallable(p.f[1]);
            }
          })();
        }
        throw $matchFail("src/check/types.pf", 2138);
      })($field(Compat, "uncons")(ts));
    }
    function comparableType(t) {
      while (true) {
        const $match$2162 = t;
        if ($match$2162.$t === "TInt") {
          return true;
        }
        if ($match$2162.$t === "TFloat") {
          return true;
        }
        if ($match$2162.$t === "TBool") {
          return true;
        }
        if ($match$2162.$t === "TStr") {
          return true;
        }
        if ($match$2162.$t === "TChar") {
          return true;
        }
        if ($match$2162.$t === "TByte") {
          return true;
        }
        if ($match$2162.$t === "TNonZero") {
          return true;
        }
        if ($match$2162.$t === "TList") {
          const x = $match$2162;
          const $tc$2174$0 = x.f[0];
          t = $tc$2174$0;
          continue;
        }
        if ($match$2162.$t === "TVar") {
          return true;
        }
        if ($match$2162.$t === "TUnknown") {
          return true;
        }
        if ($match$2162.$t === "TAny") {
          return true;
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/check/types.pf", 2162);
      }
    }
    function requireEquatable(st, typ, path, span) {
      const t = apply(st.f[1], typ);
      return (($match$2187) => {
        if ($match$2187.$t === "TVar") {
          const v = $match$2187;
          return addConstraint(st, $makeVariant("Equatable", "Constraint", ["t", "span"], [t, span]));
        }
        if (true) {
          return (() => {
            if (typeContainsCallable(t)) {
              return addTypeDiag(st, path, span, $concatS($concatS("Type ", formatType(t)), " cannot be compared for equality."));
            } else {
              return st;
            }
          })();
        }
        throw $matchFail("src/check/types.pf", 2187);
      })(t);
    }
    function requireComparable(st, typ, path, span) {
      const t = apply(st.f[1], typ);
      return (($match$2223) => {
        if ($match$2223.$t === "TVar") {
          const v = $match$2223;
          return addConstraint(st, $makeVariant("Comparable", "Constraint", ["t", "span"], [t, span]));
        }
        if (true) {
          return (() => {
            if (comparableType(t)) {
              return st;
            } else {
              return addTypeDiag(st, path, span, $concatS($concatS("Type ", formatType(t)), " is not Comparable."));
            }
          })();
        }
        throw $matchFail("src/check/types.pf", 2223);
      })(t);
    }
    function recheckPending(st, path, c) {
      return (($match$2253) => {
        if ($match$2253.$t === "HasField") {
          const h = $match$2253;
          return (() => {
            const t = apply(st.f[1], $makeVariant("TVar", "Type", ["v"], [h.f[0]]));
            return (($match$2264) => {
              if ($match$2264.$t === "TVar") {
                return st;
              }
              if ($match$2264.$t === "TUnknown") {
                return st;
              }
              if ($match$2264.$t === "TAny") {
                return st;
              }
              if ($match$2264.$t === "TNamed") {
                const n = $match$2264;
                return (() => {
                  return (($match$2270) => {
                    if ($match$2270.$t === "None") {
                      return addTypeDiag(st, path, h.f[3], $concatS($concatS("Type ", n.f[0]), " has no known fields."));
                    }
                    if ($match$2270.$t === "Some") {
                      const info = $match$2270;
                      return (() => {
                        return (($match$2291) => {
                          if ($match$2291.$t === "None") {
                            return addTypeDiag(st, path, h.f[3], $concatS($concatS($concatS($concatS("Type ", n.f[0]), " has no field '"), h.f[1]), "'."));
                          }
                          if ($match$2291.$t === "Some") {
                            const f = $match$2291;
                            return unify(st, h.f[2], fieldTypeFromShape($field(f.f[0], "shape"), n.f[1]), path, h.f[3]);
                          }
                          throw $matchFail("src/check/types.pf", 2291);
                        })(findFieldByName(info.f[0].f[2], h.f[1]));
                      })();
                    }
                    throw $matchFail("src/check/types.pf", 2270);
                  })($field(IMS, "imsGet")(st.f[5], n.f[0]));
                })();
              }
              if (true) {
                return addTypeDiag(st, path, h.f[3], $concatS($concatS($concatS($concatS("Cannot access field '.", h.f[1]), "' on "), formatType(t)), "."));
              }
              throw $matchFail("src/check/types.pf", 2264);
            })(t);
          })();
        }
        if ($match$2253.$t === "Equatable") {
          const e = $match$2253;
          return (() => {
            const t = apply(st.f[1], e.f[0]);
            return (($match$2360) => {
              if ($match$2360.$t === "TVar") {
                return st;
              }
              if (true) {
                return (() => {
                  if (typeContainsCallable(t)) {
                    return addTypeDiag(st, path, e.f[1], $concatS($concatS("Type ", formatType(t)), " cannot be compared for equality."));
                  } else {
                    return st;
                  }
                })();
              }
              throw $matchFail("src/check/types.pf", 2360);
            })(t);
          })();
        }
        if ($match$2253.$t === "Comparable") {
          const c2 = $match$2253;
          return (() => {
            const t = apply(st.f[1], c2.f[0]);
            return (($match$2393) => {
              if ($match$2393.$t === "TVar") {
                return st;
              }
              if (true) {
                return (() => {
                  if (comparableType(t)) {
                    return st;
                  } else {
                    return addTypeDiag(st, path, c2.f[1], $concatS($concatS("Type ", formatType(t)), " is not Comparable."));
                  }
                })();
              }
              throw $matchFail("src/check/types.pf", 2393);
            })(t);
          })();
        }
        throw $matchFail("src/check/types.pf", 2253);
      })(c);
    }
    function finalizePending(st, path) {
      return $reduce((acc, c) => recheckPending(acc, path, c), st, $reverse(st.f[2]));
    }
    function generalizeWithEnv(env, st, t) {
      const solved = apply(st.f[1], t);
      const locked = intUnion(envFreeVars(env), declarationFreeVars(st));
      const vars = intRemoveAll(freeVars(solved), locked);
      return mkScheme(vars, [], solved);
    }
    function generalize(envFree, st, t) {
      const solved = apply($field(st, "subst"), t);
      const vars = intRemoveAll(freeVars(solved), envFree);
      return mkScheme(vars, [], solved);
    }
    function freshMapForVars(st, vars, acc) {
      return (($match$2485) => {
        if ($match$2485.$t === "None") {
          return $makeRecord("Pair", ["key", "value"], [st, acc]);
        }
        if ($match$2485.$t === "Some") {
          const cell = $match$2485;
          return (() => {
            const p = cell.f[0];
            const fv = freshVar(st);
            return freshMapForVars(fv.f[0], p.f[1], $field(IMI, "imiPut")(acc, p.f[0], fv.f[1]));
          })();
        }
        throw $matchFail("src/check/types.pf", 2485);
      })($field(Compat, "uncons")(vars));
    }
    function replaceQuantified(t, m) {
      return (($match$2518) => {
        if ($match$2518.$t === "TVar") {
          const v = $match$2518;
          return (() => {
            return (($match$2521) => {
              if ($match$2521.$t === "None") {
                return t;
              }
              if ($match$2521.$t === "Some") {
                const found = $match$2521;
                return found.f[0];
              }
              throw $matchFail("src/check/types.pf", 2521);
            })($field(IMI, "imiGet")(m, v.f[0]));
          })();
        }
        if ($match$2518.$t === "TList") {
          const x = $match$2518;
          return $makeVariant("TList", "Type", ["elem"], [replaceQuantified(x.f[0], m)]);
        }
        if ($match$2518.$t === "TArray") {
          const x = $match$2518;
          return $makeVariant("TArray", "Type", ["elem"], [replaceQuantified(x.f[0], m)]);
        }
        if ($match$2518.$t === "TDict") {
          const x = $match$2518;
          return $makeVariant("TDict", "Type", ["keyT", "valT"], [replaceQuantified(x.f[0], m), replaceQuantified(x.f[1], m)]);
        }
        if ($match$2518.$t === "TFun") {
          const f = $match$2518;
          return $makeVariant("TFun", "Type", ["params", "ret"], [$map((x) => replaceQuantified(x, m), f.f[0]), replaceQuantified(f.f[1], m)]);
        }
        if ($match$2518.$t === "TProc") {
          const p = $match$2518;
          return $makeVariant("TProc", "Type", ["params", "ret", "isAsync"], [$map((x) => replaceQuantified(x, m), p.f[0]), replaceQuantified(p.f[1], m), p.f[2]]);
        }
        if ($match$2518.$t === "TNamed") {
          const n = $match$2518;
          return $makeVariant("TNamed", "Type", ["tname", "args"], [n.f[0], $map((x) => replaceQuantified(x, m), n.f[1])]);
        }
        if ($match$2518.$t === "TVariant") {
          const v = $match$2518;
          return $makeVariant("TVariant", "Type", ["vname", "unionName", "args"], [v.f[0], v.f[1], $map((x) => replaceQuantified(x, m), v.f[2])]);
        }
        if (true) {
          return t;
        }
        throw $matchFail("src/check/types.pf", 2518);
      })(t);
    }
    function instantiate(st, scheme) {
      const fmap = freshMapForVars(st, $field(scheme, "vars"), $field(IMI, "imiEmpty")());
      return $makeRecord("Pair", ["key", "value"], [fmap.f[0], replaceQuantified($field(scheme, "body"), fmap.f[1])]);
    }
    function typeToIface(t) {
      return (($match$2637) => {
        if ($match$2637.$t === "TInt") {
          return $makeVariant("ITInt", "IfaceType", [], []);
        }
        if ($match$2637.$t === "TFloat") {
          return $makeVariant("ITFloat", "IfaceType", [], []);
        }
        if ($match$2637.$t === "TBool") {
          return $makeVariant("ITBool", "IfaceType", [], []);
        }
        if ($match$2637.$t === "TStr") {
          return $makeVariant("ITStr", "IfaceType", [], []);
        }
        if ($match$2637.$t === "TChar") {
          return $makeVariant("ITChar", "IfaceType", [], []);
        }
        if ($match$2637.$t === "TByte") {
          return $makeVariant("ITByte", "IfaceType", [], []);
        }
        if ($match$2637.$t === "TUnit") {
          return $makeVariant("ITUnit", "IfaceType", [], []);
        }
        if ($match$2637.$t === "TNonZero") {
          return $makeVariant("ITNonZero", "IfaceType", [], []);
        }
        if ($match$2637.$t === "TAny") {
          return $makeVariant("ITAny", "IfaceType", [], []);
        }
        if ($match$2637.$t === "TList") {
          const x = $match$2637;
          return $makeVariant("ITList", "IfaceType", ["elem"], [typeToIface(x.f[0])]);
        }
        if ($match$2637.$t === "TArray") {
          const x = $match$2637;
          return $makeVariant("ITArray", "IfaceType", ["elem"], [typeToIface(x.f[0])]);
        }
        if ($match$2637.$t === "TDict") {
          const x = $match$2637;
          return $makeVariant("ITDict", "IfaceType", ["keyT", "valT"], [typeToIface(x.f[0]), typeToIface(x.f[1])]);
        }
        if ($match$2637.$t === "TFun") {
          const f = $match$2637;
          return $makeVariant("ITFun", "IfaceType", ["params", "ret"], [$map(typeToIface, f.f[0]), typeToIface(f.f[1])]);
        }
        if ($match$2637.$t === "TProc") {
          const p = $match$2637;
          return $makeVariant("ITProc", "IfaceType", ["params", "ret", "isAsync"], [$map(typeToIface, p.f[0]), typeToIface(p.f[1]), p.f[2]]);
        }
        if ($match$2637.$t === "TNamed") {
          const n = $match$2637;
          return $makeVariant("ITNamed", "IfaceType", ["tname", "args"], [n.f[0], $map(typeToIface, n.f[1])]);
        }
        if ($match$2637.$t === "TVariant") {
          const v = $match$2637;
          return $makeVariant("ITNamed", "IfaceType", ["tname", "args"], [v.f[1], $map(typeToIface, v.f[2])]);
        }
        if ($match$2637.$t === "TVar") {
          const v = $match$2637;
          return $makeVariant("ITVar", "IfaceType", ["v"], [v.f[0]]);
        }
        if ($match$2637.$t === "TUnknown") {
          return $makeVariant("ITUnknown", "IfaceType", [], []);
        }
        throw $matchFail("src/check/types.pf", 2637);
      })(t);
    }
    function ifaceBodyToType(body) {
      return (($match$2712) => {
        if ($match$2712.$t === "ITUnknown") {
          return TUnknown;
        }
        if ($match$2712.$t === "ITName") {
          const n = $match$2712;
          return $makeVariant("TNamed", "Type", ["tname", "args"], [n.f[0], []]);
        }
        if ($match$2712.$t === "ITInt") {
          return TInt;
        }
        if ($match$2712.$t === "ITFloat") {
          return TFloat;
        }
        if ($match$2712.$t === "ITBool") {
          return TBool;
        }
        if ($match$2712.$t === "ITStr") {
          return TStr;
        }
        if ($match$2712.$t === "ITChar") {
          return TChar;
        }
        if ($match$2712.$t === "ITByte") {
          return TByte;
        }
        if ($match$2712.$t === "ITUnit") {
          return TUnit;
        }
        if ($match$2712.$t === "ITNonZero") {
          return TNonZero;
        }
        if ($match$2712.$t === "ITAny") {
          return TAny;
        }
        if ($match$2712.$t === "ITList") {
          const x = $match$2712;
          return $makeVariant("TList", "Type", ["elem"], [ifaceBodyToType(x.f[0])]);
        }
        if ($match$2712.$t === "ITArray") {
          const x = $match$2712;
          return $makeVariant("TArray", "Type", ["elem"], [ifaceBodyToType(x.f[0])]);
        }
        if ($match$2712.$t === "ITDict") {
          const x = $match$2712;
          return $makeVariant("TDict", "Type", ["keyT", "valT"], [ifaceBodyToType(x.f[0]), ifaceBodyToType(x.f[1])]);
        }
        if ($match$2712.$t === "ITFun") {
          const f = $match$2712;
          return $makeVariant("TFun", "Type", ["params", "ret"], [$map(ifaceBodyToType, f.f[0]), ifaceBodyToType(f.f[1])]);
        }
        if ($match$2712.$t === "ITProc") {
          const p = $match$2712;
          return $makeVariant("TProc", "Type", ["params", "ret", "isAsync"], [$map(ifaceBodyToType, p.f[0]), ifaceBodyToType(p.f[1]), p.f[2]]);
        }
        if ($match$2712.$t === "ITNamed") {
          const n = $match$2712;
          return $makeVariant("TNamed", "Type", ["tname", "args"], [n.f[0], $map(ifaceBodyToType, n.f[1])]);
        }
        if ($match$2712.$t === "ITVar") {
          const v = $match$2712;
          return $makeVariant("TVar", "Type", ["v"], [v.f[0]]);
        }
        throw $matchFail("src/check/types.pf", 2712);
      })(body);
    }
    function schemeFromIface(s) {
      return mkScheme($field(s, "vars"), $field(s, "constraints"), ifaceBodyToType($field(s, "body")));
    }
    function fieldMono(t) {
      return $makeVariant("FieldMono", "FieldShape", ["t"], [t]);
    }
    function fieldSlot(index) {
      return $makeVariant("FieldSlot", "FieldShape", ["index"], [index]);
    }
    function fieldInfo(fname, shape) {
      return $makeRecord("FieldInfo", ["fname", "shape"], [fname, shape]);
    }
    function variantInfo(vname, unionName, fields, slotCount) {
      return $makeRecord("VariantInfo", ["vname", "unionName", "fields", "slotCount"], [vname, unionName, fields, slotCount]);
    }
    function typeInfo(tname, isUnion, fields, variants, slotCount) {
      return $makeRecord("TypeInfo", ["tname", "isUnion", "fields", "variants", "slotCount"], [tname, isUnion, fields, variants, slotCount]);
    }
    function fieldsFromDecls(st, fieldDecls, slotCount, acc) {
      return (($match$2822) => {
        if ($match$2822.$t === "None") {
          return $makeRecord("Pair", ["key", "value"], [st, $makeRecord("FieldsOut", ["fields", "slotCount"], [$reverse(acc), slotCount])]);
        }
        if ($match$2822.$t === "Some") {
          const cell = $match$2822;
          return (() => {
            const p = cell.f[0];
            const f = p.f[0];
            if ($field(f, "isGeneric")) {
              return fieldsFromDecls(st, p.f[1], $addI(slotCount, 1), $cons(fieldInfo($field(f, "fname"), fieldSlot(slotCount)), acc));
            } else {
              const fv = freshVar(st);
              return fieldsFromDecls(fv.f[0], p.f[1], slotCount, $cons(fieldInfo($field(f, "fname"), fieldMono(fv.f[1])), acc));
            }
          })();
        }
        throw $matchFail("src/check/types.pf", 2822);
      })($field(Compat, "uncons")(fieldDecls));
    }
    function variantsFromDecls(st, unionName, decls, slotCount, acc) {
      return (($match$2888) => {
        if ($match$2888.$t === "None") {
          return $makeRecord("Pair", ["key", "value"], [st, $makeRecord("VariantBuildOut", ["variants", "slotCount"], [$reverse(acc), slotCount])]);
        }
        if ($match$2888.$t === "Some") {
          const cell = $match$2888;
          return (() => {
            const p = cell.f[0];
            const v = p.f[0];
            const flds = fieldsFromDecls(st, $field(v, "fields"), slotCount, []);
            const outv = variantInfo($field(v, "vname"), unionName, flds.f[1].f[0], flds.f[1].f[1]);
            return variantsFromDecls(flds.f[0], unionName, p.f[1], flds.f[1].f[1], $cons(outv, acc));
          })();
        }
        throw $matchFail("src/check/types.pf", 2888);
      })($field(Compat, "uncons")(decls));
    }
    function putVariantInfos(st, variants) {
      return (($match$2944) => {
        if ($match$2944.$t === "None") {
          return st;
        }
        if ($match$2944.$t === "Some") {
          const cell = $match$2944;
          return (() => {
            const p = cell.f[0];
            return putVariantInfos(withVariants(st, $field(IMS, "imsPut")(st.f[6], $field(p.f[0], "vname"), p.f[0])), p.f[1]);
          })();
        }
        throw $matchFail("src/check/types.pf", 2944);
      })($field(Compat, "uncons")(variants));
    }
    function declareType(st, env, stmt) {
      return (($match$2974) => {
        if ($match$2974.$t === "SType") {
          const s = $match$2974;
          return (() => {
            return (($match$2977) => {
              if ($match$2977.$t === "RecordDecl") {
                const r = $match$2977;
                return registerRecord(st, env, r.f[0], r.f[1]);
              }
              if ($match$2977.$t === "UnionDecl") {
                const u = $match$2977;
                return registerUnion(st, env, u.f[0], u.f[1]);
              }
              throw $matchFail("src/check/types.pf", 2977);
            })(s.f[1]);
          })();
        }
        if (true) {
          return envOut(st, env);
        }
        throw $matchFail("src/check/types.pf", 2974);
      })(stmt);
    }
    function registerRecord(st, env, tname, fieldDecls) {
      const flds = fieldsFromDecls(st, fieldDecls, 0, []);
      const info = typeInfo(tname, false, flds.f[1].f[0], [], flds.f[1].f[1]);
      const st1 = withRecords(flds.f[0], $field(IMS, "imsPut")(flds.f[0].f[5], tname, info));
      const env1 = $field(IMS, "imsPut")(env, tname, $makeVariant("TTypeName", "TcEntry", ["name"], [tname]));
      return envOut(st1, env1);
    }
    function registerBuiltinTypes(st, env) {
      return registerRecord(st, env, "Pair", [$field(A, "mkFieldDecl")("key", true), $field(A, "mkFieldDecl")("value", true)]);
    }
    function registerUnion(st, env, unionName, variantDecls) {
      const built = variantsFromDecls(st, unionName, variantDecls, 0, []);
      const info = typeInfo(unionName, true, [], built.f[1].f[0], built.f[1].f[1]);
      const st1 = withRecords(built.f[0], $field(IMS, "imsPut")(built.f[0].f[5], unionName, info));
      const st2 = putVariantInfos(st1, built.f[1].f[0]);
      const env1 = $field(IMS, "imsPut")(env, unionName, $makeVariant("TTypeName", "TcEntry", ["name"], [unionName]));
      const env2 = bindVariantCtors(env1, built.f[1].f[0]);
      return envOut(st2, env2);
    }
    function registerIfaceRecordEntries(st, env, entries) {
      return (($match$3128) => {
        if ($match$3128.$t === "None") {
          return envOut(st, env);
        }
        if ($match$3128.$t === "Some") {
          const cell = $match$3128;
          return (() => {
            const p = cell.f[0];
            const one = registerRecord(st, env, $field(p.f[0], "key"), $field(p.f[0], "value"));
            return registerIfaceRecordEntries(one.f[0], one.f[1], p.f[1]);
          })();
        }
        throw $matchFail("src/check/types.pf", 3128);
      })($field(Compat, "uncons")(entries));
    }
    function registerIfaceUnionEntries(st, env, entries) {
      return (($match$3163) => {
        if ($match$3163.$t === "None") {
          return envOut(st, env);
        }
        if ($match$3163.$t === "Some") {
          const cell = $match$3163;
          return (() => {
            const p = cell.f[0];
            const one = registerUnion(st, env, $field(p.f[0], "key"), $field(p.f[0], "value"));
            return registerIfaceUnionEntries(one.f[0], one.f[1], p.f[1]);
          })();
        }
        throw $matchFail("src/check/types.pf", 3163);
      })($field(Compat, "uncons")(entries));
    }
    function isImplicitBuiltinPath(path) {
      return $eq($slice(0, 9, path), "$builtin/");
    }
    function bindAllIfaceExports(st, env, entries) {
      return (($match$3207) => {
        if ($match$3207.$t === "None") {
          return env;
        }
        if ($match$3207.$t === "Some") {
          const cell = $match$3207;
          return (() => {
            const p = cell.f[0];
            return bindAllIfaceExports(st, putEnv(env, $field(p.f[0], "key"), $makeVariant("TScheme", "TcEntry", ["scheme"], [schemeFromIface($field(p.f[0], "value"))])), p.f[1]);
          })();
        }
        throw $matchFail("src/check/types.pf", 3207);
      })($field(Compat, "uncons")(entries));
    }
    function registerDepTypesLoop(st, env, entries, seen) {
      return (($match$3237) => {
        if ($match$3237.$t === "None") {
          return envOut(st, env);
        }
        if ($match$3237.$t === "Some") {
          const cell = $match$3237;
          return (() => {
            const p = cell.f[0];
            const iface = $field(p.f[0], "value");
            if (strListContains(seen, $field(iface, "path"))) {
              return registerDepTypesLoop(st, env, p.f[1], seen);
            } else {
              const records = registerIfaceRecordEntries(st, env, $field(IMS, "imsEntries")($field(iface, "records")));
              const one = registerIfaceUnionEntries(records.f[0], records.f[1], $field(IMS, "imsEntries")($field(iface, "unions")));
              if (isImplicitBuiltinPath($field(iface, "path"))) {
                const env2 = bindAllIfaceExports(one.f[0], one.f[1], $field(IMS, "imsEntries")($field(iface, "types")));
                return registerDepTypesLoop(one.f[0], env2, p.f[1], $cons($field(iface, "path"), seen));
              } else {
                return registerDepTypesLoop(one.f[0], one.f[1], p.f[1], $cons($field(iface, "path"), seen));
              }
            }
          })();
        }
        throw $matchFail("src/check/types.pf", 3237);
      })($field(Compat, "uncons")(entries));
    }
    function strListContains(xs, s) {
      return (($match$3336) => {
        if ($match$3336.$t === "None") {
          return false;
        }
        if ($match$3336.$t === "Some") {
          const cell = $match$3336;
          return (() => {
            if ($eq(cell.f[0].f[0], s)) {
              return true;
            } else {
              return strListContains(cell.f[0].f[1], s);
            }
          })();
        }
        throw $matchFail("src/check/types.pf", 3336);
      })($field(Compat, "uncons")(xs));
    }
    function registerDepTypes(st, env, deps) {
      return registerDepTypesLoop(st, env, $field(IMS, "imsEntries")(deps), []);
    }
    function bindVariantCtors(env, variants) {
      return (($match$3371) => {
        if ($match$3371.$t === "None") {
          return env;
        }
        if ($match$3371.$t === "Some") {
          const cell = $match$3371;
          return (() => {
            const p = cell.f[0];
            return bindVariantCtors($field(IMS, "imsPut")(env, $field(p.f[0], "vname"), $makeVariant("TVariantCtor", "TcEntry", ["info"], [p.f[0]])), p.f[1]);
          })();
        }
        throw $matchFail("src/check/types.pf", 3371);
      })($field(Compat, "uncons")(variants));
    }
    function declareTypes(st, env, stmts) {
      return (($match$3398) => {
        if ($match$3398.$t === "None") {
          return envOut(st, env);
        }
        if ($match$3398.$t === "Some") {
          const cell = $match$3398;
          return (() => {
            const p = cell.f[0];
            return (($match$3411) => {
              if ($match$3411.$t === "SExport") {
                const ex = $match$3411;
                return (() => {
                  const out1 = declareType(st, env, ex.f[1]);
                  return declareTypes(out1.f[0], out1.f[1], p.f[1]);
                })();
              }
              if (true) {
                return (() => {
                  const out1 = declareType(st, env, p.f[0]);
                  return declareTypes(out1.f[0], out1.f[1], p.f[1]);
                })();
              }
              throw $matchFail("src/check/types.pf", 3411);
            })(p.f[0]);
          })();
        }
        throw $matchFail("src/check/types.pf", 3398);
      })($field(Compat, "uncons")(stmts));
    }
    const NsNotNamespace = $makeVariant("NsNotNamespace", "NsLookup", [], []);
    function NsMember(entry) {
      return $makeVariant("NsMember", "NsLookup", ["entry"], [entry]);
    }
    function NsMissing(alias) {
      return $makeVariant("NsMissing", "NsLookup", ["alias"], [alias]);
    }
    function namespaceLookup(env, object, fname) {
      return (($match$3452) => {
        if ($match$3452.$t === "EVar") {
          const v = $match$3452;
          return (() => {
            return (($match$3455) => {
              if ($match$3455.$t === "Some") {
                const entry = $match$3455;
                return (() => {
                  return (($match$3462) => {
                    if ($match$3462.$t === "TNamespace") {
                      const ns = $match$3462;
                      return (() => {
                        return (($match$3466) => {
                          if ($match$3466.$t === "Some") {
                            const member = $match$3466;
                            return $makeVariant("NsMember", "NsLookup", ["entry"], [member.f[0]]);
                          }
                          if ($match$3466.$t === "None") {
                            return $makeVariant("NsMissing", "NsLookup", ["alias"], [v.f[1]]);
                          }
                          throw $matchFail("src/check/types.pf", 3466);
                        })($field(IMS, "imsGet")(ns.f[0], fname));
                      })();
                    }
                    if (true) {
                      return NsNotNamespace;
                    }
                    throw $matchFail("src/check/types.pf", 3462);
                  })(entry.f[0]);
                })();
              }
              if ($match$3455.$t === "None") {
                return NsNotNamespace;
              }
              throw $matchFail("src/check/types.pf", 3455);
            })(lookupEnv(env, v.f[1]));
          })();
        }
        if (true) {
          return NsNotNamespace;
        }
        throw $matchFail("src/check/types.pf", 3452);
      })(object);
    }
    function fieldTypeFromShape(shape, args) {
      return (($match$3487) => {
        if ($match$3487.$t === "FieldMono") {
          const f = $match$3487;
          return f.f[0];
        }
        if ($match$3487.$t === "FieldSlot") {
          const s = $match$3487;
          return (() => {
            return (($match$3492) => {
              if ($match$3492.$t === "None") {
                return TUnknown;
              }
              if ($match$3492.$t === "Some") {
                const t = $match$3492;
                return t.f[0];
              }
              throw $matchFail("src/check/types.pf", 3492);
            })($field(Compat, "listAt")(args, s.f[0]));
          })();
        }
        throw $matchFail("src/check/types.pf", 3487);
      })(shape);
    }
    function findFieldByName(fields, name) {
      return (($match$3505) => {
        if ($match$3505.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$3505.$t === "Some") {
          const cell = $match$3505;
          return (() => {
            const p = cell.f[0];
            if ($field(p.f[0], "fname") === name) {
              return $makeVariant("Some", "Option", ["value"], [p.f[0]]);
            } else {
              return findFieldByName(p.f[1], name);
            }
          })();
        }
        throw $matchFail("src/check/types.pf", 3505);
      })($field(Compat, "uncons")(fields));
    }
    function fieldAt(fields, index) {
      return $field(Compat, "listAt")(fields, index);
    }
    function unionSlotArgs(st, vi) {
      return (($match$3540) => {
        if ($match$3540.$t === "Some") {
          const info = $match$3540;
          return slotArgs(st, info.f[0].f[4]);
        }
        if ($match$3540.$t === "None") {
          return slotArgs(st, $field(vi, "slotCount"));
        }
        throw $matchFail("src/check/types.pf", 3540);
      })($field(IMS, "imsGet")(st.f[5], $field(vi, "unionName")));
    }
    function slotArgs(st, count) {
      return freshTypeList(st, count);
    }
    function tOption(t) {
      return $makeVariant("TNamed", "Type", ["tname", "args"], ["Option", [t]]);
    }
    function tResult(okT, errT) {
      return $makeVariant("TNamed", "Type", ["tname", "args"], ["Result", [okT, errT]]);
    }
    function builtinEnv() {
      const env0 = $field(IMS, "imsEmpty")();
      const env1 = $field(IMS, "imsPut")(env0, "true", $makeVariant("TMono", "TcEntry", ["t"], [TBool]));
      const env2 = $field(IMS, "imsPut")(env1, "false", $makeVariant("TMono", "TcEntry", ["t"], [TBool]));
      const env3 = $field(IMS, "imsPut")(env2, "None", $makeVariant("TMono", "TcEntry", ["t"], [tOption(TUnknown)]));
      const env4 = $field(IMS, "imsPut")(env3, "__str__", $makeVariant("TScheme", "TcEntry", ["scheme"], [mkScheme([0], [], $makeVariant("TFun", "Type", ["params", "ret"], [[$makeVariant("TVar", "Type", ["v"], [0])], TStr]))]));
      const env5 = $field(IMS, "imsPut")(env4, "length", $makeVariant("TScheme", "TcEntry", ["scheme"], [mkScheme([0], [], $makeVariant("TFun", "Type", ["params", "ret"], [[$makeVariant("TList", "Type", ["elem"], [$makeVariant("TVar", "Type", ["v"], [0])])], TInt]))]));
      const env6 = $field(IMS, "imsPut")(env5, "reverse", $makeVariant("TScheme", "TcEntry", ["scheme"], [mkScheme([0], [], $makeVariant("TFun", "Type", ["params", "ret"], [[$makeVariant("TList", "Type", ["elem"], [$makeVariant("TVar", "Type", ["v"], [0])])], $makeVariant("TList", "Type", ["elem"], [$makeVariant("TVar", "Type", ["v"], [0])])]))]));
      const env7 = $field(IMS, "imsPut")(env6, "cons", $makeVariant("TScheme", "TcEntry", ["scheme"], [mkScheme([0], [], $makeVariant("TFun", "Type", ["params", "ret"], [[$makeVariant("TVar", "Type", ["v"], [0]), $makeVariant("TList", "Type", ["elem"], [$makeVariant("TVar", "Type", ["v"], [0])])], $makeVariant("TList", "Type", ["elem"], [$makeVariant("TVar", "Type", ["v"], [0])])]))]));
      const env8 = $field(IMS, "imsPut")(env7, "map", $makeVariant("TScheme", "TcEntry", ["scheme"], [mkScheme([0, 1], [], $makeVariant("TFun", "Type", ["params", "ret"], [[$makeVariant("TFun", "Type", ["params", "ret"], [[$makeVariant("TVar", "Type", ["v"], [0])], $makeVariant("TVar", "Type", ["v"], [1])]), $makeVariant("TList", "Type", ["elem"], [$makeVariant("TVar", "Type", ["v"], [0])])], $makeVariant("TList", "Type", ["elem"], [$makeVariant("TVar", "Type", ["v"], [1])])]))]));
      const env9 = $field(IMS, "imsPut")(env8, "filter", $makeVariant("TScheme", "TcEntry", ["scheme"], [mkScheme([0], [], $makeVariant("TFun", "Type", ["params", "ret"], [[$makeVariant("TFun", "Type", ["params", "ret"], [[$makeVariant("TVar", "Type", ["v"], [0])], TBool]), $makeVariant("TList", "Type", ["elem"], [$makeVariant("TVar", "Type", ["v"], [0])])], $makeVariant("TList", "Type", ["elem"], [$makeVariant("TVar", "Type", ["v"], [0])])]))]));
      const env10 = $field(IMS, "imsPut")(env9, "reduce", $makeVariant("TScheme", "TcEntry", ["scheme"], [mkScheme([0, 1], [], $makeVariant("TFun", "Type", ["params", "ret"], [[$makeVariant("TFun", "Type", ["params", "ret"], [[$makeVariant("TVar", "Type", ["v"], [0]), $makeVariant("TVar", "Type", ["v"], [1])], $makeVariant("TVar", "Type", ["v"], [0])]), $makeVariant("TVar", "Type", ["v"], [0]), $makeVariant("TList", "Type", ["elem"], [$makeVariant("TVar", "Type", ["v"], [1])])], $makeVariant("TVar", "Type", ["v"], [0])]))]));
      const env11 = $field(IMS, "imsPut")(env10, "slice", $makeVariant("TScheme", "TcEntry", ["scheme"], [mkScheme([0], [], $makeVariant("TFun", "Type", ["params", "ret"], [[TInt, TInt, $makeVariant("TList", "Type", ["elem"], [$makeVariant("TVar", "Type", ["v"], [0])])], $makeVariant("TList", "Type", ["elem"], [$makeVariant("TVar", "Type", ["v"], [0])])]))]));
      const env12 = $field(IMS, "imsPut")(env11, "join", $makeVariant("TMono", "TcEntry", ["t"], [$makeVariant("TFun", "Type", ["params", "ret"], [[$makeVariant("TList", "Type", ["elem"], [TStr]), TStr], TStr])]));
      const env13 = $field(IMS, "imsPut")(env12, "split", $makeVariant("TMono", "TcEntry", ["t"], [$makeVariant("TFun", "Type", ["params", "ret"], [[TStr, TStr], $makeVariant("TList", "Type", ["elem"], [TStr])])]));
      return env13;
    }
    function lookupEnv(env, name) {
      return $field(IMS, "imsGet")(env, name);
    }
    function putEnv(env, name, entry) {
      return $field(IMS, "imsPut")(env, name, entry);
    }
    function bindParams(env, params, types) {
      return (($match$3835) => {
        if ($match$3835.$t === "None") {
          return env;
        }
        if ($match$3835.$t === "Some") {
          const pcell = $match$3835;
          return (() => {
            return (($match$3842) => {
              if ($match$3842.$t === "None") {
                return env;
              }
              if ($match$3842.$t === "Some") {
                const tcell = $match$3842;
                return (() => {
                  const pp = pcell.f[0];
                  const tp = tcell.f[0];
                  const env1 = bindParamName(env, pp.f[0], tp.f[0]);
                  return bindParams(env1, pp.f[1], tp.f[1]);
                })();
              }
              throw $matchFail("src/check/types.pf", 3842);
            })($field(Compat, "uncons")(types));
          })();
        }
        throw $matchFail("src/check/types.pf", 3835);
      })($field(Compat, "uncons")(params));
    }
    function depsLookup(deps, rawPath) {
      return $field(IMS, "imsGet")(deps, rawPath);
    }
    function bindOneImportedName(st, env, iface, name, alias) {
      const local = (($match$3881) => {
        if ($match$3881.$t === "None") {
          return name;
        }
        if ($match$3881.$t === "Some") {
          const a = $match$3881;
          return a.f[0];
        }
        throw $matchFail("src/check/types.pf", 3881);
      })(alias);
      return (($match$3887) => {
        if ($match$3887.$t === "Some") {
          const sch = $match$3887;
          return putEnv(env, local, $makeVariant("TScheme", "TcEntry", ["scheme"], [schemeFromIface(sch.f[0])]));
        }
        if ($match$3887.$t === "None") {
          return (() => {
            return (($match$3903) => {
              if ($match$3903.$t === "Some") {
                const kind = $match$3903;
                return putEnv(env, local, $makeVariant("TMono", "TcEntry", ["t"], [TUnknown]));
              }
              if ($match$3903.$t === "None") {
                return env;
              }
              throw $matchFail("src/check/types.pf", 3903);
            })($field(I, "lookupKind")(iface, name));
          })();
        }
        throw $matchFail("src/check/types.pf", 3887);
      })($field(I, "lookupType")(iface, name));
    }
    function bindNamedImports(st, env, iface, names) {
      return (($match$3919) => {
        if ($match$3919.$t === "None") {
          return env;
        }
        if ($match$3919.$t === "Some") {
          const cell = $match$3919;
          return (() => {
            const p = cell.f[0];
            return bindNamedImports(st, bindOneImportedName(st, env, iface, $field(p.f[0], "name"), $field(p.f[0], "alias")), iface, p.f[1]);
          })();
        }
        throw $matchFail("src/check/types.pf", 3919);
      })($field(Compat, "uncons")(names));
    }
    function bindNamespaceEntries(entries, table) {
      return (($match$3949) => {
        if ($match$3949.$t === "None") {
          return table;
        }
        if ($match$3949.$t === "Some") {
          const cell = $match$3949;
          return (() => {
            const p = cell.f[0];
            return bindNamespaceEntries(p.f[1], $field(IMS, "imsPut")(table, $field(p.f[0], "key"), $makeVariant("TScheme", "TcEntry", ["scheme"], [schemeFromIface($field(p.f[0], "value"))])));
          })();
        }
        throw $matchFail("src/check/types.pf", 3949);
      })($field(Compat, "uncons")(entries));
    }
    function bindImportStmt(st, env, stmt, deps) {
      return (($match$3979) => {
        if ($match$3979.$t === "SImport") {
          const s = $match$3979;
          return (() => {
            return (($match$3982) => {
              if ($match$3982.$t === "None") {
                return envOut(st, env);
              }
              if ($match$3982.$t === "Some") {
                const ifaceCell = $match$3982;
                return (() => {
                  const iface = ifaceCell.f[0];
                  return (($match$3996) => {
                    if ($match$3996.$t === "INames") {
                      const spec = $match$3996;
                      return envOut(st, bindNamedImports(st, env, iface, spec.f[0]));
                    }
                    if ($match$3996.$t === "INamespace") {
                      const ns = $match$3996;
                      return (() => {
                        const table = bindNamespaceEntries($field(IMS, "imsEntries")($field(iface, "types")), $field(IMS, "imsEmpty")());
                        return envOut(st, putEnv(env, ns.f[0], $makeVariant("TNamespace", "TcEntry", ["table"], [table])));
                      })();
                    }
                    if ($match$3996.$t === "IStar") {
                      return envOut(st, bindNamedImports(st, env, iface, $map((p) => $field(A, "mkImportName")(p.f[0], $makeVariant("None", "Option", [], [])), $field(IMS, "imsEntries")($field(iface, "types")))));
                    }
                    throw $matchFail("src/check/types.pf", 3996);
                  })(s.f[1]);
                })();
              }
              throw $matchFail("src/check/types.pf", 3982);
            })(depsLookup(deps, s.f[2]));
          })();
        }
        if (true) {
          return envOut(st, env);
        }
        throw $matchFail("src/check/types.pf", 3979);
      })(stmt);
    }
    function bindImports(st, env, stmts, deps) {
      return (($match$4062) => {
        if ($match$4062.$t === "None") {
          return envOut(st, env);
        }
        if ($match$4062.$t === "Some") {
          const cell = $match$4062;
          return (() => {
            const p = cell.f[0];
            const out1 = (($match$4075) => {
              if ($match$4075.$t === "SExport") {
                const e = $match$4075;
                return bindImportStmt(st, env, e.f[1], deps);
              }
              if (true) {
                return bindImportStmt(st, env, p.f[0], deps);
              }
              throw $matchFail("src/check/types.pf", 4075);
            })(p.f[0]);
            return bindImports(out1.f[0], out1.f[1], p.f[1], deps);
          })();
        }
        throw $matchFail("src/check/types.pf", 4062);
      })($field(Compat, "uncons")(stmts));
    }
    function isDefinitelyNonNumericType(t) {
      return (($match$4105) => {
        if ($match$4105.$t === "TInt") {
          return false;
        }
        if ($match$4105.$t === "TFloat") {
          return false;
        }
        if ($match$4105.$t === "TVar") {
          return false;
        }
        if ($match$4105.$t === "TUnknown") {
          return false;
        }
        if ($match$4105.$t === "TAny") {
          return false;
        }
        if (true) {
          return true;
        }
        throw $matchFail("src/check/types.pf", 4105);
      })(t);
    }
    function isDefinitelyNonStringType(t) {
      return (($match$4115) => {
        if ($match$4115.$t === "TStr") {
          return false;
        }
        if ($match$4115.$t === "TVar") {
          return false;
        }
        if ($match$4115.$t === "TUnknown") {
          return false;
        }
        if ($match$4115.$t === "TAny") {
          return false;
        }
        if (true) {
          return true;
        }
        throw $matchFail("src/check/types.pf", 4115);
      })(t);
    }
    function isFloatType(t) {
      return (($match$4124) => {
        if ($match$4124.$t === "TFloat") {
          return true;
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/check/types.pf", 4124);
      })(t);
    }
    function promoteFloatOperand(st, t, path, span) {
      return (($match$4130) => {
        if ($match$4130.$t === "TVar") {
          const v = $match$4130;
          return unify(st, t, TFloat, path, span);
        }
        if (true) {
          return st;
        }
        throw $matchFail("src/check/types.pf", 4130);
      })(t);
    }
    function inferNumericBinary(st, path, span, leftT, rightT) {
      const l = apply(st.f[1], leftT);
      const r = apply(st.f[1], rightT);
      if (isFloatType(l) || isFloatType(r)) {
        const st1 = promoteFloatOperand(st, l, path, span);
        const st2 = promoteFloatOperand(st1, r, path, span);
        return exprOut(st2, TFloat);
      } else {
        const st1 = unify(st, l, TInt, path, span);
        const st2 = unify(st1, r, TInt, path, span);
        return exprOut(st2, TInt);
      }
    }
    function inferNumericUnary(st, path, span, op, t0) {
      const t = apply(st.f[1], t0);
      if (isDefinitelyNonNumericType(t)) {
        return exprOut(addTypeDiag(st, path, span, $concatS($concatS("Operator '", op), "' requires a numeric operand.")), TUnknown);
      } else {
        return (($match$4226) => {
          if ($match$4226.$t === "TFloat") {
            return exprOut(st, TFloat);
          }
          if (true) {
            return exprOut(unify(st, t, TInt, path, span), TInt);
          }
          throw $matchFail("src/check/types.pf", 4226);
        })(t);
      }
    }
    function inferLogicalBinary(st, path, span, leftT, rightT) {
      const st1 = unify(st, leftT, TBool, path, span);
      const st2 = unify(st1, rightT, TBool, path, span);
      return exprOut(st2, TBool);
    }
    function inferEquality(st, path, span, leftT, rightT) {
      const st1 = unify(st, leftT, rightT, path, span);
      const st2 = requireEquatable(st1, leftT, path, span);
      return exprOut(st2, TBool);
    }
    function inferComparison(st, path, span, leftT, rightT) {
      const st1 = unify(st, leftT, rightT, path, span);
      const st2 = requireComparable(st1, leftT, path, span);
      return exprOut(st2, TBool);
    }
    function isZeroIntLiteral(expr) {
      return (($match$4309) => {
        if ($match$4309.$t === "EInt") {
          const value = $match$4309;
          return $eqI(value.f[1], 0);
        }
        if ($match$4309.$t === "EUnary") {
          const unary = $match$4309;
          return (() => {
            if (unary.f[1] === "-") {
              return isZeroIntLiteral(unary.f[2]);
            } else {
              return false;
            }
          })();
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/check/types.pf", 4309);
      })(expr);
    }
    function isNonZeroIntLiteral(expr) {
      return (($match$4331) => {
        if ($match$4331.$t === "EInt") {
          const value = $match$4331;
          return !$eqI(value.f[1], 0);
        }
        if ($match$4331.$t === "EUnary") {
          const unary = $match$4331;
          return (() => {
            if (unary.f[1] === "-") {
              return isNonZeroIntLiteral(unary.f[2]);
            } else {
              return false;
            }
          })();
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/check/types.pf", 4331);
      })(expr);
    }
    function isDefinitelyNonDivisionNumericType(t) {
      return (($match$4353) => {
        if ($match$4353.$t === "TInt") {
          return false;
        }
        if ($match$4353.$t === "TFloat") {
          return false;
        }
        if ($match$4353.$t === "TNonZero") {
          return false;
        }
        if ($match$4353.$t === "TVar") {
          return false;
        }
        if ($match$4353.$t === "TUnknown") {
          return false;
        }
        if ($match$4353.$t === "TAny") {
          return false;
        }
        if (true) {
          return true;
        }
        throw $matchFail("src/check/types.pf", 4353);
      })(t);
    }
    function safeDivisionName(op) {
      if (op === "/") {
        return "safeDiv";
      } else {
        return "safeMod";
      }
    }
    function nonZeroDivisorMessage(op, zeroLiteral) {
      const intro = zeroLiteral ? "Literal 0 is not a valid Int divisor. " : $concatS($concatS("Int operator '", op), "' requires a NonZero divisor. ");
      const safeName = safeDivisionName(op);
      return $concatS($concatS($concatS($concatS($concatS(intro, "Use `match nonZero(y) with | Some nz -> x "), op), " nz.value | None -> ...`, `"), safeName), "(x, y)`, or inline a nonzero integer literal.");
    }
    function inferIntDivision(st, path, span, op, rhsExpr, leftT, rightT) {
      const st1 = unify(st, leftT, TInt, path, span);
      const right = apply(st1.f[1], rightT);
      if (isZeroIntLiteral(rhsExpr)) {
        return exprOut(addTypeDiag(st1, path, span, nonZeroDivisorMessage(op, true)), TInt);
      } else {
        if (isNonZeroIntLiteral(rhsExpr)) {
          const st2 = unify(st1, rightT, TInt, path, span);
          return exprOut(st2, TInt);
        } else {
          return (($match$4445) => {
            if ($match$4445.$t === "TNonZero") {
              return exprOut(st1, TInt);
            }
            if ($match$4445.$t === "TVar") {
              return (() => {
                const st2 = unify(st1, rightT, TNonZero, path, span);
                return exprOut(st2, TInt);
              })();
            }
            if ($match$4445.$t === "TUnknown") {
              return exprOut(st1, TUnknown);
            }
            if (true) {
              return (() => {
                return exprOut(addTypeDiag(st1, path, span, nonZeroDivisorMessage(op, false)), TInt);
              })();
            }
            throw $matchFail("src/check/types.pf", 4445);
          })(right);
        }
      }
    }
    function inferDivisionBinary(st, path, span, op, rhsExpr, leftT, rightT) {
      const left = apply(st.f[1], leftT);
      const right = apply(st.f[1], rightT);
      if (isDefinitelyNonDivisionNumericType(left) || isDefinitelyNonDivisionNumericType(right)) {
        return exprOut(addTypeDiag(st, path, span, $concatS($concatS("Operator '", op), "' requires numeric operands.")), TUnknown);
      } else {
        if (isFloatType(left) || isFloatType(right)) {
          return inferNumericBinary(st, path, span, leftT, rightT);
        } else {
          return inferIntDivision(st, path, span, op, rhsExpr, leftT, rightT);
        }
      }
    }
    function inferBinaryExpr(st, path, span, op, rhsExpr, leftT, rightT) {
      if (op === "/" || op === "%") {
        return inferDivisionBinary(st, path, span, op, rhsExpr, leftT, rightT);
      } else {
        return inferBinaryByOp(st, path, span, op, leftT, rightT);
      }
    }
    function inferBinaryByOp(st, path, span, op, leftT, rightT) {
      const left = apply(st.f[1], leftT);
      const right = apply(st.f[1], rightT);
      if (op === "++") {
        if (isDefinitelyNonStringType(left) || isDefinitelyNonStringType(right)) {
          return exprOut(addTypeDiag(st, path, span, "Operator '++' requires Str operands."), TStr);
        } else {
          const st1 = unify(st, leftT, TStr, path, span);
          const st2 = unify(st1, rightT, TStr, path, span);
          return exprOut(st2, TStr);
        }
      } else {
        if (op === "+" || op === "-" || op === "*" || op === "/" || op === "%") {
          if (isDefinitelyNonNumericType(left) || isDefinitelyNonNumericType(right)) {
            return exprOut(addTypeDiag(st, path, span, $concatS($concatS("Operator '", op), "' requires numeric operands.")), TUnknown);
          } else {
            return inferNumericBinary(st, path, span, leftT, rightT);
          }
        } else {
          if (op === "==" || op === "!=") {
            return inferEquality(st, path, span, leftT, rightT);
          } else {
            if (op === "<" || op === ">" || op === "<=" || op === ">=") {
              return inferComparison(st, path, span, leftT, rightT);
            } else {
              if (op === "&&" || op === "||") {
                return inferLogicalBinary(st, path, span, leftT, rightT);
              } else {
                if (op === "&" || op === "|" || op === "<<" || op === ">>") {
                  const st1 = unify(st, leftT, TInt, path, span);
                  const st2 = unify(st1, rightT, TInt, path, span);
                  return exprOut(st2, TInt);
                } else {
                  return exprOut(addTypeDiag(st, path, span, $concatS($concatS("Unknown binary operator '", op), "'.")), TUnknown);
                }
              }
            }
          }
        }
      }
    }
    function inferCallArgs(st, env, args, params, path, span) {
      if (!$eqI($length(args), $length(params))) {
        return $makeRecord("Pair", ["key", "value"], [addTypeDiag(st, path, span, $concatS($concatS($concatS($concatS("Call expected ", $str($length(params))), " argument(s), got "), $str($length(args))), ".")), st]);
      } else {
        return inferCallArgsLoop(st, env, args, params, path, span);
      }
    }
    function inferCallArgsLoop(st, env, args, params, path, span) {
      return (($match$4832) => {
        if ($match$4832.$t === "None") {
          return $makeRecord("Pair", ["key", "value"], [st, st]);
        }
        if ($match$4832.$t === "Some") {
          const acell = $match$4832;
          return (() => {
            return (($match$4841) => {
              if ($match$4841.$t === "None") {
                return $makeRecord("Pair", ["key", "value"], [st, st]);
              }
              if ($match$4841.$t === "Some") {
                const pcell = $match$4841;
                return (() => {
                  const ap = acell.f[0];
                  const pp = pcell.f[0];
                  const ao = cgenExpr(st, env, ap.f[0], path);
                  const st1 = unify(ao.f[0], ao.f[1], pp.f[0], path, $field(A, "exprSpan")(ap.f[0]));
                  return inferCallArgsLoop(st1, env, ap.f[1], pp.f[1], path, span);
                })();
              }
              throw $matchFail("src/check/types.pf", 4841);
            })($field(Compat, "uncons")(params));
          })();
        }
        throw $matchFail("src/check/types.pf", 4832);
      })($field(Compat, "uncons")(args));
    }
    function inferCall(st, env, callee, args, span, path) {
      const co = cgenExpr(st, env, callee, path);
      const ct = apply(co.f[0].f[1], co.f[1]);
      return (($match$4908) => {
        if ($match$4908.$t === "TFun") {
          const tf = $match$4908;
          return (() => {
            const ao = inferCallArgs(co.f[0], env, args, tf.f[0], path, span);
            return exprOut(ao.f[0], tf.f[1]);
          })();
        }
        if ($match$4908.$t === "TProc") {
          const pr = $match$4908;
          return (() => {
            const ao = inferCallArgs(co.f[0], env, args, pr.f[0], path, span);
            return exprOut(ao.f[0], pr.f[1]);
          })();
        }
        if ($match$4908.$t === "TVar") {
          const v = $match$4908;
          return (() => {
            const fresh = freshTypeList(co.f[0], $length(args));
            const ret = freshVar(fresh.f[0]);
            const fnT = $makeVariant("TFun", "Type", ["params", "ret"], [fresh.f[1], ret.f[1]]);
            const st1 = unify(ret.f[0], ct, fnT, path, span);
            const ao = inferCallArgs(st1, env, args, fresh.f[1], path, span);
            return exprOut(ao.f[0], ret.f[1]);
          })();
        }
        if ($match$4908.$t === "TUnknown") {
          return exprOut(co.f[0], TUnknown);
        }
        if ($match$4908.$t === "TAny") {
          return exprOut(co.f[0], TUnknown);
        }
        if (true) {
          return exprOut(addTypeDiag(co.f[0], path, span, $concatS($concatS("Cannot call value of type ", formatType(ct)), ".")), TUnknown);
        }
        throw $matchFail("src/check/types.pf", 4908);
      })(ct);
    }
    function inferListElems(st, env, elems, elemT, path) {
      return (($match$5022) => {
        if ($match$5022.$t === "None") {
          return exprOut(st, $makeVariant("TList", "Type", ["elem"], [elemT]));
        }
        if ($match$5022.$t === "Some") {
          const cell = $match$5022;
          return (() => {
            const p = cell.f[0];
            const eo = cgenExpr(st, env, p.f[0], path);
            const st1 = unify(eo.f[0], eo.f[1], elemT, path, $field(A, "exprSpan")(p.f[0]));
            return inferListElems(st1, env, p.f[1], elemT, path);
          })();
        }
        throw $matchFail("src/check/types.pf", 5022);
      })($field(Compat, "uncons")(elems));
    }
    function inferDictEntries(st, env, entries, keyT, valT, path) {
      return (($match$5069) => {
        if ($match$5069.$t === "None") {
          return exprOut(st, $makeVariant("TDict", "Type", ["keyT", "valT"], [keyT, valT]));
        }
        if ($match$5069.$t === "Some") {
          const cell = $match$5069;
          return (() => {
            const p = cell.f[0];
            const ko = cgenExpr(st, env, $field(p.f[0], "key"), path);
            const st1 = unify(ko.f[0], ko.f[1], keyT, path, $field(A, "exprSpan")($field(p.f[0], "key")));
            const vo = cgenExpr(st1, env, $field(p.f[0], "value"), path);
            const st2 = unify(vo.f[0], vo.f[1], valT, path, $field(A, "exprSpan")($field(p.f[0], "value")));
            return inferDictEntries(st2, env, p.f[1], keyT, valT, path);
          })();
        }
        throw $matchFail("src/check/types.pf", 5069);
      })($field(Compat, "uncons")(entries));
    }
    function inferArrayElems(st, env, elems, elemT, path) {
      return (($match$5144) => {
        if ($match$5144.$t === "None") {
          return exprOut(st, $makeVariant("TArray", "Type", ["elem"], [elemT]));
        }
        if ($match$5144.$t === "Some") {
          const cell = $match$5144;
          return (() => {
            const p = cell.f[0];
            const eo = cgenExpr(st, env, p.f[0], path);
            const st1 = unify(eo.f[0], eo.f[1], elemT, path, $field(A, "exprSpan")(p.f[0]));
            return inferArrayElems(st1, env, p.f[1], elemT, path);
          })();
        }
        throw $matchFail("src/check/types.pf", 5144);
      })($field(Compat, "uncons")(elems));
    }
    function fieldExpectedByInput(fields, input, index, args) {
      return (($match$5191) => {
        if ($match$5191.$t === "Some") {
          const name = $match$5191;
          return (() => {
            return (($match$5195) => {
              if ($match$5195.$t === "None") {
                return $makeVariant("None", "Option", [], []);
              }
              if ($match$5195.$t === "Some") {
                const f = $match$5195;
                return $makeVariant("Some", "Option", ["value"], [fieldTypeFromShape($field(f.f[0], "shape"), args)]);
              }
              throw $matchFail("src/check/types.pf", 5195);
            })(findFieldByName(fields, name.f[0]));
          })();
        }
        if ($match$5191.$t === "None") {
          return (() => {
            return (($match$5211) => {
              if ($match$5211.$t === "None") {
                return $makeVariant("None", "Option", [], []);
              }
              if ($match$5211.$t === "Some") {
                const f = $match$5211;
                return $makeVariant("Some", "Option", ["value"], [fieldTypeFromShape($field(f.f[0], "shape"), args)]);
              }
              throw $matchFail("src/check/types.pf", 5211);
            })(fieldAt(fields, index));
          })();
        }
        throw $matchFail("src/check/types.pf", 5191);
      })($field(input, "fname"));
    }
    function inferConstructorFields(st, env, inputs, fields, args, path, index) {
      return (($match$5227) => {
        if ($match$5227.$t === "None") {
          return st;
        }
        if ($match$5227.$t === "Some") {
          const cell = $match$5227;
          return (() => {
            const p = cell.f[0];
            return (($match$5237) => {
              if ($match$5237.$t === "None") {
                return inferConstructorFields(addTypeDiag(st, path, $field(A, "exprSpan")($field(p.f[0], "value")), "Unknown or extra constructor field."), env, p.f[1], fields, args, path, $addI(index, 1));
              }
              if ($match$5237.$t === "Some") {
                const expected = $match$5237;
                return (() => {
                  const vo = cgenExpr(st, env, $field(p.f[0], "value"), path);
                  const st1 = unify(vo.f[0], vo.f[1], expected.f[0], path, $field(A, "exprSpan")($field(p.f[0], "value")));
                  return inferConstructorFields(st1, env, p.f[1], fields, args, path, $addI(index, 1));
                })();
              }
              throw $matchFail("src/check/types.pf", 5237);
            })(fieldExpectedByInput(fields, p.f[0], index, args));
          })();
        }
        throw $matchFail("src/check/types.pf", 5227);
      })($field(Compat, "uncons")(inputs));
    }
    function inferRecordConstruction(st, env, name, fields, span, path) {
      return (($match$5309) => {
        if ($match$5309.$t === "Some") {
          const rec = $match$5309;
          return (() => {
            const args = slotArgs(st, rec.f[0].f[4]);
            const st1 = inferConstructorFields(args.f[0], env, fields, rec.f[0].f[2], args.f[1], path, 0);
            return exprOut(st1, $makeVariant("TNamed", "Type", ["tname", "args"], [name, args.f[1]]));
          })();
        }
        if ($match$5309.$t === "None") {
          return (() => {
            return (($match$5347) => {
              if ($match$5347.$t === "Some") {
                const vi = $match$5347;
                return (() => {
                  const args = unionSlotArgs(st, vi.f[0]);
                  const st1 = inferConstructorFields(args.f[0], env, fields, $field(vi.f[0], "fields"), args.f[1], path, 0);
                  return exprOut(st1, $makeVariant("TVariant", "Type", ["vname", "unionName", "args"], [name, $field(vi.f[0], "unionName"), args.f[1]]));
                })();
              }
              if ($match$5347.$t === "None") {
                return exprOut(addTypeDiag(st, path, span, $concatS($concatS("Unknown record or variant constructor '", name), "'.")), TUnknown);
              }
              throw $matchFail("src/check/types.pf", 5347);
            })($field(IMS, "imsGet")(st.f[6], name));
          })();
        }
        throw $matchFail("src/check/types.pf", 5309);
      })($field(IMS, "imsGet")(st.f[5], name));
    }
    function inferFieldAccess(st, objectType, fieldName, span, path) {
      const t = apply(st.f[1], objectType);
      return (($match$5408) => {
        if ($match$5408.$t === "TVariant") {
          const v = $match$5408;
          return (() => {
            return (($match$5411) => {
              if ($match$5411.$t === "None") {
                return (() => {
                  return exprOut(addTypeDiag(st, path, span, $concatS($concatS("Unknown variant '", v.f[0]), "'.")), TUnknown);
                })();
              }
              if ($match$5411.$t === "Some") {
                const vi = $match$5411;
                return (() => {
                  return (($match$5436) => {
                    if ($match$5436.$t === "None") {
                      return (() => {
                        return exprOut(addTypeDiag(st, path, span, $concatS($concatS($concatS($concatS("Variant ", v.f[0]), " has no field '"), fieldName), "'.")), TUnknown);
                      })();
                    }
                    if ($match$5436.$t === "Some") {
                      const f = $match$5436;
                      return (() => {
                        return exprOut(st, fieldTypeFromShape($field(f.f[0], "shape"), v.f[2]));
                      })();
                    }
                    throw $matchFail("src/check/types.pf", 5436);
                  })(findFieldByName($field(vi.f[0], "fields"), fieldName));
                })();
              }
              throw $matchFail("src/check/types.pf", 5411);
            })(variantFromUnion(st, v.f[1], v.f[0]));
          })();
        }
        if ($match$5408.$t === "TNamed") {
          const n = $match$5408;
          return (() => {
            return (($match$5478) => {
              if ($match$5478.$t === "None") {
                return (() => {
                  return exprOut(addTypeDiag(st, path, span, $concatS($concatS("Type ", n.f[0]), " has no known fields.")), TUnknown);
                })();
              }
              if ($match$5478.$t === "Some") {
                const info = $match$5478;
                return (() => {
                  return (($match$5503) => {
                    if ($match$5503.$t === "None") {
                      return (() => {
                        return exprOut(addTypeDiag(st, path, span, $concatS($concatS($concatS($concatS("Type ", n.f[0]), " has no field '"), fieldName), "'.")), TUnknown);
                      })();
                    }
                    if ($match$5503.$t === "Some") {
                      const f = $match$5503;
                      return (() => {
                        return exprOut(st, fieldTypeFromShape($field(f.f[0], "shape"), n.f[1]));
                      })();
                    }
                    throw $matchFail("src/check/types.pf", 5503);
                  })(findFieldByName(info.f[0].f[2], fieldName));
                })();
              }
              throw $matchFail("src/check/types.pf", 5478);
            })($field(IMS, "imsGet")(st.f[5], n.f[0]));
          })();
        }
        if ($match$5408.$t === "TVar") {
          const v = $match$5408;
          return (() => {
            const fv = freshVar(st);
            const st1 = addConstraint(fv.f[0], $makeVariant("HasField", "Constraint", ["tvar", "fname", "ftype", "span"], [v.f[0], fieldName, fv.f[1], span]));
            return exprOut(st1, fv.f[1]);
          })();
        }
        if ($match$5408.$t === "TUnknown") {
          return exprOut(st, TUnknown);
        }
        if ($match$5408.$t === "TAny") {
          return exprOut(st, TUnknown);
        }
        if (true) {
          return (() => {
            return exprOut(addTypeDiag(st, path, span, $concatS($concatS($concatS($concatS("Cannot access field '", fieldName), "' on "), formatType(t)), ".")), TUnknown);
          })();
        }
        throw $matchFail("src/check/types.pf", 5408);
      })(t);
    }
    function inferIndexAccess(st, objectType, span, path) {
      const t = apply(st.f[1], objectType);
      return (($match$5604) => {
        if ($match$5604.$t === "TList") {
          const l = $match$5604;
          return exprOut(st, tOption(l.f[0]));
        }
        if ($match$5604.$t === "TArray") {
          const a = $match$5604;
          return exprOut(st, tOption(a.f[0]));
        }
        if ($match$5604.$t === "TStr") {
          return exprOut(st, tOption(TChar));
        }
        if ($match$5604.$t === "TDict") {
          const d = $match$5604;
          return exprOut(st, tOption(d.f[1]));
        }
        if ($match$5604.$t === "TVar") {
          const v = $match$5604;
          return (() => {
            const elem = freshVar(st);
            const st1 = unify(elem.f[0], t, $makeVariant("TList", "Type", ["elem"], [elem.f[1]]), path, span);
            return exprOut(st1, tOption(elem.f[1]));
          })();
        }
        if (true) {
          return exprOut(addTypeDiag(st, path, span, $concatS($concatS("Cannot index value of type ", formatType(t)), ".")), TUnknown);
        }
        throw $matchFail("src/check/types.pf", 5604);
      })(t);
    }
    function inferFmtParts(st, env, parts, path) {
      return (($match$5674) => {
        if ($match$5674.$t === "None") {
          return exprOut(st, TStr);
        }
        if ($match$5674.$t === "Some") {
          const cell = $match$5674;
          return (() => {
            const p = cell.f[0];
            return (($match$5687) => {
              if ($match$5687.$t === "FmtLit") {
                return inferFmtParts(st, env, p.f[1], path);
              }
              if ($match$5687.$t === "FmtExpr") {
                const fe = $match$5687;
                return (() => {
                  const eo = cgenExpr(st, env, fe.f[0], path);
                  return inferFmtParts(eo.f[0], env, p.f[1], path);
                })();
              }
              throw $matchFail("src/check/types.pf", 5687);
            })(p.f[0]);
          })();
        }
        throw $matchFail("src/check/types.pf", 5674);
      })($field(Compat, "uncons")(parts));
    }
    function findVariantInfo(variants, vname) {
      return (($match$5718) => {
        if ($match$5718.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$5718.$t === "Some") {
          const cell = $match$5718;
          return (() => {
            const p = cell.f[0];
            if ($field(p.f[0], "vname") === vname) {
              return $makeVariant("Some", "Option", ["value"], [p.f[0]]);
            } else {
              return findVariantInfo(p.f[1], vname);
            }
          })();
        }
        throw $matchFail("src/check/types.pf", 5718);
      })($field(Compat, "uncons")(variants));
    }
    function variantFromUnion(st, unionName, vname) {
      return (($match$5746) => {
        if ($match$5746.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$5746.$t === "Some") {
          const info = $match$5746;
          return (() => {
            if (info.f[0].f[1]) {
              return findVariantInfo(info.f[0].f[3], vname);
            } else {
              return $makeVariant("None", "Option", [], []);
            }
          })();
        }
        throw $matchFail("src/check/types.pf", 5746);
      })($field(IMS, "imsGet")(st.f[5], unionName));
    }
    function variantForSubject(st, subjectT, vname) {
      return (($match$5770) => {
        if ($match$5770.$t === "TNamed") {
          const named = $match$5770;
          return (() => {
            return variantFromUnion(st, named.f[0], vname);
          })();
        }
        if ($match$5770.$t === "TVariant") {
          const variant = $match$5770;
          return (() => {
            return variantFromUnion(st, variant.f[1], vname);
          })();
        }
        if (true) {
          return $field(IMS, "imsGet")(st.f[6], vname);
        }
        throw $matchFail("src/check/types.pf", 5770);
      })(apply(st.f[1], subjectT));
    }
    function bindPattern(st, env, pattern, subjectT, path, span) {
      return (($match$5800) => {
        if ($match$5800.$t === "PWild") {
          return envOut(st, env);
        }
        if ($match$5800.$t === "PVariant") {
          const p = $match$5800;
          return (() => {
            return (($match$5807) => {
              if ($match$5807.$t === "None") {
                return (() => {
                  return envOut(addTypeDiag(st, path, span, $concatS($concatS("Unknown variant '", p.f[0]), "'.")), env);
                })();
              }
              if ($match$5807.$t === "Some") {
                const vi = $match$5807;
                return (() => {
                  const args = unionSlotArgs(st, vi.f[0]);
                  const st1 = unify(args.f[0], subjectT, $makeVariant("TNamed", "Type", ["tname", "args"], [$field(vi.f[0], "unionName"), args.f[1]]), path, span);
                  const env1 = (($match$5851) => {
                    if ($match$5851.$t === "None") {
                      return env;
                    }
                    if ($match$5851.$t === "Some") {
                      const name = $match$5851;
                      return (() => {
                        return putEnv(env, name.f[0], $makeVariant("TMono", "TcEntry", ["t"], [$makeVariant("TVariant", "Type", ["vname", "unionName", "args"], [p.f[0], $field(vi.f[0], "unionName"), args.f[1]])]));
                      })();
                    }
                    throw $matchFail("src/check/types.pf", 5851);
                  })(p.f[1]);
                  return envOut(st1, env1);
                })();
              }
              throw $matchFail("src/check/types.pf", 5807);
            })(variantForSubject(st, subjectT, p.f[0]));
          })();
        }
        if ($match$5800.$t === "PList") {
          const p = $match$5800;
          return (() => {
            const elem = freshVar(st);
            const st1 = unify(elem.f[0], subjectT, $makeVariant("TList", "Type", ["elem"], [elem.f[1]]), path, span);
            const env1 = bindListPatternElems(env, p.f[0], elem.f[1]);
            const env2 = (($match$5902) => {
              if ($match$5902.$t === "None") {
                return env1;
              }
              if ($match$5902.$t === "Some") {
                const rest = $match$5902;
                return (() => {
                  return bindPatElem(env1, rest.f[0], $makeVariant("TList", "Type", ["elem"], [elem.f[1]]));
                })();
              }
              throw $matchFail("src/check/types.pf", 5902);
            })(p.f[1]);
            return envOut(st1, env2);
          })();
        }
        throw $matchFail("src/check/types.pf", 5800);
      })(pattern);
    }
    function bindPatElem(env, patElem, typ) {
      return (($match$5924) => {
        if ($match$5924.$t === "PeWild") {
          return env;
        }
        if ($match$5924.$t === "PeBind") {
          const b = $match$5924;
          return putEnv(env, b.f[0], $makeVariant("TMono", "TcEntry", ["t"], [typ]));
        }
        throw $matchFail("src/check/types.pf", 5924);
      })(patElem);
    }
    function bindListPatternElems(env, elems, elemT) {
      return (($match$5936) => {
        if ($match$5936.$t === "None") {
          return env;
        }
        if ($match$5936.$t === "Some") {
          const cell = $match$5936;
          return (() => {
            const p = cell.f[0];
            return bindListPatternElems(bindPatElem(env, p.f[0], elemT), p.f[1], elemT);
          })();
        }
        throw $matchFail("src/check/types.pf", 5936);
      })($field(Compat, "uncons")(elems));
    }
    function inferMatchArms(st, env, arms, subjectT, resultT, path) {
      return (($match$5960) => {
        if ($match$5960.$t === "None") {
          return exprOut(st, resultT);
        }
        if ($match$5960.$t === "Some") {
          const cell = $match$5960;
          return (() => {
            const p = cell.f[0];
            const arm = p.f[0];
            const bound = bindPattern(st, env, $field(arm, "pattern"), subjectT, path, $field(A, "exprSpan")($field(arm, "body")));
            const st1 = (($match$5990) => {
              if ($match$5990.$t === "None") {
                return bound.f[0];
              }
              if ($match$5990.$t === "Some") {
                const g = $match$5990;
                return (() => {
                  const go = cgenExpr(bound.f[0], bound.f[1], g.f[0], path);
                  return unify(go.f[0], go.f[1], TBool, path, $field(A, "exprSpan")(g.f[0]));
                })();
              }
              throw $matchFail("src/check/types.pf", 5990);
            })($field(arm, "guard"));
            const bo = cgenExpr(st1, bound.f[1], $field(arm, "body"), path);
            const st2 = unify(bo.f[0], bo.f[1], resultT, path, $field(A, "exprSpan")($field(arm, "body")));
            return inferMatchArms(st2, env, p.f[1], subjectT, resultT, path);
          })();
        }
        throw $matchFail("src/check/types.pf", 5960);
      })($field(Compat, "uncons")(arms));
    }
    function cgenExpr(st, env, e, path) {
      return (($match$6056) => {
        if ($match$6056.$t === "EInt") {
          const x = $match$6056;
          return exprOut(addTypedNode(st, x.f[0], TInt), TInt);
        }
        if ($match$6056.$t === "EFloat") {
          const x = $match$6056;
          return exprOut(addTypedNode(st, x.f[0], TFloat), TFloat);
        }
        if ($match$6056.$t === "EBool") {
          const x = $match$6056;
          return exprOut(addTypedNode(st, x.f[0], TBool), TBool);
        }
        if ($match$6056.$t === "EStr") {
          const x = $match$6056;
          return exprOut(addTypedNode(st, x.f[0], TStr), TStr);
        }
        if ($match$6056.$t === "EChar") {
          const x = $match$6056;
          return exprOut(addTypedNode(st, x.f[0], TChar), TChar);
        }
        if ($match$6056.$t === "EByte") {
          const x = $match$6056;
          return exprOut(addTypedNode(st, x.f[0], TByte), TByte);
        }
        if ($match$6056.$t === "EVar") {
          const x = $match$6056;
          return (() => {
            return (($match$6113) => {
              if ($match$6113.$t === "None") {
                return exprOut(addTypedNode(addTypeDiag(st, path, x.f[2], $concatS($concatS("Unknown name '", x.f[1]), "'.")), x.f[0], TUnknown), TUnknown);
              }
              if ($match$6113.$t === "Some") {
                const entry = $match$6113;
                return (() => {
                  return (($match$6140) => {
                    if ($match$6140.$t === "TScheme") {
                      const s = $match$6140;
                      return (() => {
                        const inst = instantiate(st, s.f[0]);
                        return exprOut(addTypedNode(inst.f[0], x.f[0], inst.f[1]), inst.f[1]);
                      })();
                    }
                    if ($match$6140.$t === "TMono") {
                      const m = $match$6140;
                      return exprOut(addTypedNode(st, x.f[0], m.f[0]), m.f[0]);
                    }
                    if ($match$6140.$t === "TVariantCtor") {
                      const vc = $match$6140;
                      return (() => {
                        if ($eqI($length($field(vc.f[0], "fields")), 0)) {
                          const args = unionSlotArgs(st, vc.f[0]);
                          const typ = $makeVariant("TVariant", "Type", ["vname", "unionName", "args"], [$field(vc.f[0], "vname"), $field(vc.f[0], "unionName"), args.f[1]]);
                          return exprOut(addTypedNode(args.f[0], x.f[0], typ), typ);
                        } else {
                          return exprOut(addTypedNode(addTypeDiag(st, path, x.f[2], $concatS($concatS("Variant '", x.f[1]), "' requires a payload.")), x.f[0], TUnknown), TUnknown);
                        }
                      })();
                    }
                    if ($match$6140.$t === "TNamespace") {
                      return exprOut(addTypedNode(st, x.f[0], TUnknown), TUnknown);
                    }
                    if ($match$6140.$t === "TTypeName") {
                      return exprOut(addTypedNode(st, x.f[0], TUnknown), TUnknown);
                    }
                    throw $matchFail("src/check/types.pf", 6140);
                  })(entry.f[0]);
                })();
              }
              throw $matchFail("src/check/types.pf", 6113);
            })(lookupEnv(env, x.f[1]));
          })();
        }
        if ($match$6056.$t === "EUnary") {
          const x = $match$6056;
          return (() => {
            const oo = cgenExpr(st, env, x.f[2], path);
            if (x.f[1] === "!") {
              const st1 = unify(oo.f[0], oo.f[1], TBool, path, x.f[3]);
              return exprOut(addTypedNode(st1, x.f[0], TBool), TBool);
            } else {
              if (x.f[1] === "-") {
                const ro = inferNumericUnary(oo.f[0], path, x.f[3], "-", oo.f[1]);
                return exprOut(addTypedNode(ro.f[0], x.f[0], ro.f[1]), ro.f[1]);
              } else {
                return exprOut(addTypedNode(oo.f[0], x.f[0], oo.f[1]), oo.f[1]);
              }
            }
          })();
        }
        if ($match$6056.$t === "EBinary") {
          const x = $match$6056;
          return (() => {
            const lo = cgenExpr(st, env, x.f[2], path);
            const ro = cgenExpr(lo.f[0], env, x.f[3], path);
            const bo = inferBinaryExpr(ro.f[0], path, x.f[4], x.f[1], x.f[3], lo.f[1], ro.f[1]);
            return exprOut(addTypedNode(bo.f[0], x.f[0], bo.f[1]), bo.f[1]);
          })();
        }
        if ($match$6056.$t === "EIf") {
          const x = $match$6056;
          return (() => {
            const co = cgenExpr(st, env, x.f[1], path);
            const st1 = unify(co.f[0], co.f[1], TBool, path, $field(A, "exprSpan")(x.f[1]));
            const to = cgenExpr(st1, env, x.f[2], path);
            const eo = cgenExpr(to.f[0], env, x.f[3], path);
            const j = freshVar(eo.f[0]);
            const st2 = unify(j.f[0], j.f[1], to.f[1], path, x.f[4]);
            const st3 = unify(st2, j.f[1], eo.f[1], path, x.f[4]);
            const typ = apply(st3.f[1], j.f[1]);
            return exprOut(addTypedNode(st3, x.f[0], typ), typ);
          })();
        }
        if ($match$6056.$t === "ECall") {
          const x = $match$6056;
          return (() => {
            const co = inferCall(st, env, x.f[1], x.f[2], x.f[3], path);
            return exprOut(addTypedNode(co.f[0], x.f[0], co.f[1]), co.f[1]);
          })();
        }
        if ($match$6056.$t === "ELambda") {
          const x = $match$6056;
          return (() => {
            const ps = freshTypeList(st, $length(x.f[1]));
            const env1 = bindParams(env, x.f[1], ps.f[1]);
            const bo = cgenExpr(ps.f[0], env1, x.f[2], path);
            const typ = $makeVariant("TFun", "Type", ["params", "ret"], [ps.f[1], bo.f[1]]);
            return exprOut(addTypedNode(bo.f[0], x.f[0], typ), typ);
          })();
        }
        if ($match$6056.$t === "EProcLambda") {
          const x = $match$6056;
          return (() => {
            const ps = typedParamsTypes(st, x.f[1], []);
            const ret = inferTypeExpr(ps.f[0], x.f[2]);
            const env1 = bindParams(env, typedParamNames(x.f[1]), ps.f[1]);
            const bo = inferBody(ret.f[0], env1, x.f[3], path);
            const st1 = unify(bo.f[0], ret.f[1], bo.f[1], path, x.f[5]);
            const raw = $makeVariant("TProc", "Type", ["params", "ret", "isAsync"], [ps.f[1], ret.f[1], x.f[4]]);
            const typ = apply(st1.f[1], raw);
            return exprOut(addTypedNode(st1, x.f[0], typ), typ);
          })();
        }
        if ($match$6056.$t === "EBlock") {
          const x = $match$6056;
          return (() => {
            const bo = inferBody(st, env, x.f[1], path);
            return exprOut(addTypedNode(bo.f[0], x.f[0], bo.f[1]), bo.f[1]);
          })();
        }
        if ($match$6056.$t === "EList") {
          const x = $match$6056;
          return (() => {
            const elem = freshVar(st);
            const lo = inferListElems(elem.f[0], env, x.f[1], elem.f[1], path);
            return exprOut(addTypedNode(lo.f[0], x.f[0], lo.f[1]), lo.f[1]);
          })();
        }
        if ($match$6056.$t === "EComp") {
          const x = $match$6056;
          return (() => {
            const bound = bindCompGens(st, env, x.f[2], path);
            const guardSt = (($match$6659) => {
              if ($match$6659.$t === "None") {
                return bound.f[0];
              }
              if ($match$6659.$t === "Some") {
                const g = $match$6659;
                return (() => {
                  const go = cgenExpr(bound.f[0], bound.f[1], g.f[0], path);
                  return unify(go.f[0], go.f[1], TBool, path, $field(A, "exprSpan")(g.f[0]));
                })();
              }
              throw $matchFail("src/check/types.pf", 6659);
            })(x.f[3]);
            const bo = cgenExpr(guardSt, bound.f[1], x.f[1], path);
            const typ = $makeVariant("TList", "Type", ["elem"], [bo.f[1]]);
            return exprOut(addTypedNode(bo.f[0], x.f[0], typ), typ);
          })();
        }
        if ($match$6056.$t === "ERecord") {
          const x = $match$6056;
          return (() => {
            const ro = inferRecordConstruction(st, env, x.f[1], x.f[2], x.f[3], path);
            return exprOut(addTypedNode(ro.f[0], x.f[0], ro.f[1]), ro.f[1]);
          })();
        }
        if ($match$6056.$t === "EField") {
          const x = $match$6056;
          return (() => {
            return (($match$6741) => {
              if ($match$6741.$t === "NsMember") {
                const m = $match$6741;
                return (() => {
                  return (($match$6750) => {
                    if ($match$6750.$t === "TScheme") {
                      const s = $match$6750;
                      return (() => {
                        const inst = instantiate(st, s.f[0]);
                        const typ = inst.f[1];
                        return exprOut(addTypedNode(inst.f[0], x.f[0], typ), typ);
                      })();
                    }
                    if ($match$6750.$t === "TMono") {
                      const mo = $match$6750;
                      return exprOut(addTypedNode(st, x.f[0], mo.f[0]), mo.f[0]);
                    }
                    if (true) {
                      return exprOut(addTypedNode(addTypeDiag(st, path, x.f[3], $concatS($concatS("Namespace member '", x.f[2]), "' is not a value.")), x.f[0], TUnknown), TUnknown);
                    }
                    throw $matchFail("src/check/types.pf", 6750);
                  })(m.f[0]);
                })();
              }
              if ($match$6741.$t === "NsMissing") {
                const ms = $match$6741;
                return exprOut(addTypedNode(addTypeDiag(st, path, x.f[3], $concatS($concatS($concatS($concatS("Namespace '", ms.f[0]), "' has no export '"), x.f[2]), "'.")), x.f[0], TUnknown), TUnknown);
              }
              if ($match$6741.$t === "NsNotNamespace") {
                return (() => {
                  const oo = cgenExpr(st, env, x.f[1], path);
                  const fo = inferFieldAccess(oo.f[0], oo.f[1], x.f[2], x.f[3], path);
                  return exprOut(addTypedNode(fo.f[0], x.f[0], fo.f[1]), fo.f[1]);
                })();
              }
              throw $matchFail("src/check/types.pf", 6741);
            })(namespaceLookup(env, x.f[1], x.f[2]));
          })();
        }
        if ($match$6056.$t === "EIndex") {
          const x = $match$6056;
          return (() => {
            const oo = cgenExpr(st, env, x.f[1], path);
            const io = cgenExpr(oo.f[0], env, x.f[2], path);
            const st1 = unify(io.f[0], io.f[1], TInt, path, $field(A, "exprSpan")(x.f[2]));
            const ix = inferIndexAccess(st1, oo.f[1], x.f[3], path);
            return exprOut(addTypedNode(ix.f[0], x.f[0], ix.f[1]), ix.f[1]);
          })();
        }
        if ($match$6056.$t === "EMatch") {
          const x = $match$6056;
          return (() => {
            const so = cgenExpr(st, env, x.f[1], path);
            const rt = freshVar(so.f[0]);
            const mo = inferMatchArms(rt.f[0], env, x.f[2], so.f[1], rt.f[1], path);
            const typ = apply(mo.f[0].f[1], rt.f[1]);
            return exprOut(addTypedNode(mo.f[0], x.f[0], typ), typ);
          })();
        }
        if ($match$6056.$t === "EDict") {
          const x = $match$6056;
          return (() => {
            const kt = freshVar(st);
            const vt = freshVar(kt.f[0]);
            const $pf$100_111 = inferDictEntries(vt.f[0], env, x.f[1], kt.f[1], vt.f[1], path);
            return exprOut(addTypedNode($pf$100_111.f[0], x.f[0], $pf$100_111.f[1]), $pf$100_111.f[1]);
          })();
        }
        if ($match$6056.$t === "EArray") {
          const x = $match$6056;
          return (() => {
            const elem = freshVar(st);
            const ao = inferArrayElems(elem.f[0], env, x.f[1], elem.f[1], path);
            return exprOut(addTypedNode(ao.f[0], x.f[0], ao.f[1]), ao.f[1]);
          })();
        }
        if ($match$6056.$t === "EAwait") {
          const x = $match$6056;
          return (() => {
            const vo = cgenExpr(st, env, x.f[1], path);
            return exprOut(addTypedNode(vo.f[0], x.f[0], vo.f[1]), vo.f[1]);
          })();
        }
        if ($match$6056.$t === "EFmt") {
          const x = $match$6056;
          return (() => {
            const fo = inferFmtParts(st, env, x.f[1], path);
            return exprOut(addTypedNode(fo.f[0], x.f[0], TStr), TStr);
          })();
        }
        throw $matchFail("src/check/types.pf", 6056);
      })(e);
    }
    function bindCompGens(st, env, gens, path) {
      return (($match$7076) => {
        if ($match$7076.$t === "None") {
          return envOut(st, env);
        }
        if ($match$7076.$t === "Some") {
          const cell = $match$7076;
          return (() => {
            const p = cell.f[0];
            const elem = freshVar(st);
            const src = cgenExpr(elem.f[0], env, $field(p.f[0], "source"), path);
            const st1 = unify(src.f[0], src.f[1], $makeVariant("TList", "Type", ["elem"], [elem.f[1]]), path, $field(A, "exprSpan")($field(p.f[0], "source")));
            const env1 = putEnv(env, $field(p.f[0], "gvar"), $makeVariant("TMono", "TcEntry", ["t"], [elem.f[1]]));
            return bindCompGens(st1, env1, p.f[1], path);
          })();
        }
        throw $matchFail("src/check/types.pf", 7076);
      })($field(Compat, "uncons")(gens));
    }
    function inferBody(st, env, stmts, path) {
      return inferBodyLoop(st, env, stmts, TUnit, path);
    }
    function inferBodyLoop(st, env, stmts, lastT, path) {
      return (($match$7149) => {
        if ($match$7149.$t === "None") {
          return bodyOut(st, lastT);
        }
        if ($match$7149.$t === "Some") {
          const cell = $match$7149;
          return (() => {
            const p = cell.f[0];
            return (($match$7162) => {
              if ($match$7162.$t === "SExpr") {
                const sx = $match$7162;
                return (() => {
                  const eo = cgenExpr(st, env, sx.f[1], path);
                  return inferBodyLoop(eo.f[0], env, p.f[1], eo.f[1], path);
                })();
              }
              if ($match$7162.$t === "SIf") {
                const sx = $match$7162;
                return (() => {
                  if ($eqI($length(p.f[1]), 0)) {
                    const co = cgenExpr(st, env, sx.f[1], path);
                    const st1 = unify(co.f[0], co.f[1], TBool, path, $field(A, "exprSpan")(sx.f[1]));
                    const thenOut = inferBody(st1, env, sx.f[2], path);
                    return (($match$7222) => {
                      if ($match$7222.$t === "None") {
                        return bodyOut(addTypedNode(thenOut.f[0], sx.f[0], TUnit), TUnit);
                      }
                      if ($match$7222.$t === "Some") {
                        const es = $match$7222;
                        return (() => {
                          const elseOut = inferBody(thenOut.f[0], env, es.f[0], path);
                          const j = freshVar(elseOut.f[0]);
                          const st2 = unify(j.f[0], j.f[1], thenOut.f[1], path, sx.f[4]);
                          const st3 = unify(st2, j.f[1], elseOut.f[1], path, sx.f[4]);
                          const typ = apply(st3.f[1], j.f[1]);
                          return bodyOut(addTypedNode(st3, sx.f[0], typ), typ);
                        })();
                      }
                      throw $matchFail("src/check/types.pf", 7222);
                    })(sx.f[3]);
                  } else {
                    const so = cgenStmt(st, env, p.f[0], path);
                    return inferBodyLoop(so.f[0], so.f[1], p.f[1], TUnit, path);
                  }
                })();
              }
              if ($match$7162.$t === "SReturn") {
                const sr = $match$7162;
                return (() => {
                  return (($match$7312) => {
                    if ($match$7312.$t === "None") {
                      return inferBodyLoop(st, env, p.f[1], TUnit, path);
                    }
                    if ($match$7312.$t === "Some") {
                      const rv = $match$7312;
                      return (() => {
                        const eo = cgenExpr(st, env, rv.f[0], path);
                        return inferBodyLoop(eo.f[0], env, p.f[1], eo.f[1], path);
                      })();
                    }
                    throw $matchFail("src/check/types.pf", 7312);
                  })(sr.f[1]);
                })();
              }
              if (true) {
                return (() => {
                  const so = cgenStmt(st, env, p.f[0], path);
                  return inferBodyLoop(so.f[0], so.f[1], p.f[1], TUnit, path);
                })();
              }
              throw $matchFail("src/check/types.pf", 7162);
            })(p.f[0]);
          })();
        }
        throw $matchFail("src/check/types.pf", 7149);
      })($field(Compat, "uncons")(stmts));
    }
    function strContains(xs, value) {
      return (($match$7367) => {
        if ($match$7367.$t === "None") {
          return false;
        }
        if ($match$7367.$t === "Some") {
          const cell = $match$7367;
          return (() => {
            const p = cell.f[0];
            if (p.f[0] === value) {
              return true;
            } else {
              return strContains(p.f[1], value);
            }
          })();
        }
        throw $matchFail("src/check/types.pf", 7367);
      })($field(Compat, "uncons")(xs));
    }
    function strAdd(xs, value) {
      if (strContains(xs, value)) {
        return xs;
      } else {
        return $cons(value, xs);
      }
    }
    function strUnion(a, b) {
      return (($match$7405) => {
        if ($match$7405.$t === "None") {
          return a;
        }
        if ($match$7405.$t === "Some") {
          const cell = $match$7405;
          return (() => {
            const p = cell.f[0];
            return strUnion(strAdd(a, p.f[0]), p.f[1]);
          })();
        }
        throw $matchFail("src/check/types.pf", 7405);
      })($field(Compat, "uncons")(b));
    }
    function addNames(bound, names) {
      return (($match$7427) => {
        if ($match$7427.$t === "None") {
          return bound;
        }
        if ($match$7427.$t === "Some") {
          const cell = $match$7427;
          return (() => {
            const p = cell.f[0];
            return addNames(strAdd(bound, p.f[0]), p.f[1]);
          })();
        }
        throw $matchFail("src/check/types.pf", 7427);
      })($field(Compat, "uncons")(names));
    }
    function addTopRef(name, topNames, bound, refs) {
      if (strContains(topNames, name)) {
        if (strContains(bound, name)) {
          return refs;
        } else {
          return strAdd(refs, name);
        }
      } else {
        return refs;
      }
    }
    function scanExprList(exprs, topNames, bound, refs) {
      return (($match$7469) => {
        if ($match$7469.$t === "None") {
          return refs;
        }
        if ($match$7469.$t === "Some") {
          const cell = $match$7469;
          return (() => {
            const p = cell.f[0];
            const refs1 = scanExpr(p.f[0], topNames, bound, refs);
            return scanExprList(p.f[1], topNames, bound, refs1);
          })();
        }
        throw $matchFail("src/check/types.pf", 7469);
      })($field(Compat, "uncons")(exprs));
    }
    function scanFields(fields, topNames, bound, refs) {
      return (($match$7497) => {
        if ($match$7497.$t === "None") {
          return refs;
        }
        if ($match$7497.$t === "Some") {
          const cell = $match$7497;
          return (() => {
            const p = cell.f[0];
            const refs1 = scanExpr($field(p.f[0], "value"), topNames, bound, refs);
            return scanFields(p.f[1], topNames, bound, refs1);
          })();
        }
        throw $matchFail("src/check/types.pf", 7497);
      })($field(Compat, "uncons")(fields));
    }
    function scanDictEntries(entries, topNames, bound, refs) {
      return (($match$7526) => {
        if ($match$7526.$t === "None") {
          return refs;
        }
        if ($match$7526.$t === "Some") {
          const cell = $match$7526;
          return (() => {
            const p = cell.f[0];
            const refs1 = scanExpr($field(p.f[0], "key"), topNames, bound, refs);
            const refs2 = scanExpr($field(p.f[0], "value"), topNames, bound, refs1);
            return scanDictEntries(p.f[1], topNames, bound, refs2);
          })();
        }
        throw $matchFail("src/check/types.pf", 7526);
      })($field(Compat, "uncons")(entries));
    }
    function scanFmtParts(parts, topNames, bound, refs) {
      return (($match$7564) => {
        if ($match$7564.$t === "None") {
          return refs;
        }
        if ($match$7564.$t === "Some") {
          const cell = $match$7564;
          return (() => {
            const p = cell.f[0];
            return (($match$7574) => {
              if ($match$7574.$t === "FmtLit") {
                return scanFmtParts(p.f[1], topNames, bound, refs);
              }
              if ($match$7574.$t === "FmtExpr") {
                const part = $match$7574;
                return (() => {
                  const refs1 = scanExpr(part.f[0], topNames, bound, refs);
                  return scanFmtParts(p.f[1], topNames, bound, refs1);
                })();
              }
              throw $matchFail("src/check/types.pf", 7574);
            })(p.f[0]);
          })();
        }
        throw $matchFail("src/check/types.pf", 7564);
      })($field(Compat, "uncons")(parts));
    }
    function addPatElemBound(bound, elem) {
      return (($match$7604) => {
        if ($match$7604.$t === "PeBind") {
          const p = $match$7604;
          return (() => {
            if (p.f[0] === "_") {
              return bound;
            } else {
              return strAdd(bound, p.f[0]);
            }
          })();
        }
        if ($match$7604.$t === "PeWild") {
          return bound;
        }
        throw $matchFail("src/check/types.pf", 7604);
      })(elem);
    }
    function addPatElemsBound(bound, elems) {
      return (($match$7623) => {
        if ($match$7623.$t === "None") {
          return bound;
        }
        if ($match$7623.$t === "Some") {
          const cell = $match$7623;
          return (() => {
            const p = cell.f[0];
            return addPatElemsBound(addPatElemBound(bound, p.f[0]), p.f[1]);
          })();
        }
        throw $matchFail("src/check/types.pf", 7623);
      })($field(Compat, "uncons")(elems));
    }
    function addPatternBound(bound, pattern) {
      return (($match$7645) => {
        if ($match$7645.$t === "PWild") {
          return bound;
        }
        if ($match$7645.$t === "PVariant") {
          const p = $match$7645;
          return (() => {
            return (($match$7649) => {
              if ($match$7649.$t === "None") {
                return bound;
              }
              if ($match$7649.$t === "Some") {
                const name = $match$7649;
                return strAdd(bound, name.f[0]);
              }
              throw $matchFail("src/check/types.pf", 7649);
            })(p.f[1]);
          })();
        }
        if ($match$7645.$t === "PList") {
          const p = $match$7645;
          return (() => {
            const bound1 = addPatElemsBound(bound, p.f[0]);
            return (($match$7666) => {
              if ($match$7666.$t === "None") {
                return bound1;
              }
              if ($match$7666.$t === "Some") {
                const rest = $match$7666;
                return addPatElemBound(bound1, rest.f[0]);
              }
              throw $matchFail("src/check/types.pf", 7666);
            })(p.f[1]);
          })();
        }
        throw $matchFail("src/check/types.pf", 7645);
      })(pattern);
    }
    function scanMatchArms(arms, topNames, bound, refs) {
      return (($match$7678) => {
        if ($match$7678.$t === "None") {
          return refs;
        }
        if ($match$7678.$t === "Some") {
          const cell = $match$7678;
          return (() => {
            const p = cell.f[0];
            const armBound = addPatternBound(bound, $field(p.f[0], "pattern"));
            const refs1 = (($match$7695) => {
              if ($match$7695.$t === "None") {
                return refs;
              }
              if ($match$7695.$t === "Some") {
                const guard = $match$7695;
                return scanExpr(guard.f[0], topNames, armBound, refs);
              }
              throw $matchFail("src/check/types.pf", 7695);
            })($field(p.f[0], "guard"));
            const refs2 = scanExpr($field(p.f[0], "body"), topNames, armBound, refs1);
            return scanMatchArms(p.f[1], topNames, bound, refs2);
          })();
        }
        throw $matchFail("src/check/types.pf", 7678);
      })($field(Compat, "uncons")(arms));
    }
    function scanCompGens(gens, topNames, bound, refs) {
      return (($match$7727) => {
        if ($match$7727.$t === "None") {
          return $makeRecord("NameScan", ["refs", "bound"], [refs, bound]);
        }
        if ($match$7727.$t === "Some") {
          const cell = $match$7727;
          return (() => {
            const p = cell.f[0];
            const refs1 = scanExpr($field(p.f[0], "source"), topNames, bound, refs);
            const bound1 = strAdd(bound, $field(p.f[0], "gvar"));
            return scanCompGens(p.f[1], topNames, bound1, refs1);
          })();
        }
        throw $matchFail("src/check/types.pf", 7727);
      })($field(Compat, "uncons")(gens));
    }
    function scanExpr(expr, topNames, bound, refs) {
      while (true) {
        const $match$7765 = expr;
        if ($match$7765.$t === "EInt") {
          return refs;
        }
        if ($match$7765.$t === "EFloat") {
          return refs;
        }
        if ($match$7765.$t === "EBool") {
          return refs;
        }
        if ($match$7765.$t === "EStr") {
          return refs;
        }
        if ($match$7765.$t === "EChar") {
          return refs;
        }
        if ($match$7765.$t === "EByte") {
          return refs;
        }
        if ($match$7765.$t === "EVar") {
          const x = $match$7765;
          return addTopRef(x.f[1], topNames, bound, refs);
        }
        if ($match$7765.$t === "EUnary") {
          const x = $match$7765;
          const $tc$7786$0 = x.f[2];
          const $tc$7786$1 = topNames;
          const $tc$7786$2 = bound;
          const $tc$7786$3 = refs;
          expr = $tc$7786$0;
          topNames = $tc$7786$1;
          bound = $tc$7786$2;
          refs = $tc$7786$3;
          continue;
        }
        if ($match$7765.$t === "EBinary") {
          const x = $match$7765;
          return (() => {
            const refs1 = scanExpr(x.f[2], topNames, bound, refs);
            return scanExpr(x.f[3], topNames, bound, refs1);
          })();
        }
        if ($match$7765.$t === "EIf") {
          const x = $match$7765;
          return (() => {
            const refs1 = scanExpr(x.f[1], topNames, bound, refs);
            const refs2 = scanExpr(x.f[2], topNames, bound, refs1);
            return scanExpr(x.f[3], topNames, bound, refs2);
          })();
        }
        if ($match$7765.$t === "ECall") {
          const x = $match$7765;
          return (() => {
            const refs1 = scanExpr(x.f[1], topNames, bound, refs);
            return scanExprList(x.f[2], topNames, bound, refs1);
          })();
        }
        if ($match$7765.$t === "ELambda") {
          const x = $match$7765;
          const $tc$7856$0 = x.f[2];
          const $tc$7856$1 = topNames;
          const $tc$7856$2 = addNames(bound, x.f[1]);
          const $tc$7856$3 = refs;
          expr = $tc$7856$0;
          topNames = $tc$7856$1;
          bound = $tc$7856$2;
          refs = $tc$7856$3;
          continue;
        }
        if ($match$7765.$t === "EProcLambda") {
          const x = $match$7765;
          return (() => {
            const out = scanStmtList(x.f[3], topNames, addNames(bound, typedParamNames(x.f[1])), refs);
            return out.f[0];
          })();
        }
        if ($match$7765.$t === "EBlock") {
          const x = $match$7765;
          return (() => {
            const out = scanStmtList(x.f[1], topNames, bound, refs);
            return out.f[0];
          })();
        }
        if ($match$7765.$t === "EList") {
          const x = $match$7765;
          return scanExprList(x.f[1], topNames, bound, refs);
        }
        if ($match$7765.$t === "EComp") {
          const x = $match$7765;
          return (() => {
            const gens = scanCompGens(x.f[2], topNames, bound, refs);
            const refs1 = scanExpr(x.f[1], topNames, gens.f[1], gens.f[0]);
            return (($match$7913) => {
              if ($match$7913.$t === "None") {
                return refs1;
              }
              if ($match$7913.$t === "Some") {
                const guard = $match$7913;
                return scanExpr(guard.f[0], topNames, gens.f[1], refs1);
              }
              throw $matchFail("src/check/types.pf", 7913);
            })(x.f[3]);
          })();
        }
        if ($match$7765.$t === "ERecord") {
          const x = $match$7765;
          return scanFields(x.f[2], topNames, bound, refs);
        }
        if ($match$7765.$t === "EField") {
          const x = $match$7765;
          const $tc$7939$0 = x.f[1];
          const $tc$7939$1 = topNames;
          const $tc$7939$2 = bound;
          const $tc$7939$3 = refs;
          expr = $tc$7939$0;
          topNames = $tc$7939$1;
          bound = $tc$7939$2;
          refs = $tc$7939$3;
          continue;
        }
        if ($match$7765.$t === "EIndex") {
          const x = $match$7765;
          return (() => {
            const refs1 = scanExpr(x.f[1], topNames, bound, refs);
            return scanExpr(x.f[2], topNames, bound, refs1);
          })();
        }
        if ($match$7765.$t === "EMatch") {
          const x = $match$7765;
          return (() => {
            const refs1 = scanExpr(x.f[1], topNames, bound, refs);
            return scanMatchArms(x.f[2], topNames, bound, refs1);
          })();
        }
        if ($match$7765.$t === "EDict") {
          const x = $match$7765;
          return scanDictEntries(x.f[1], topNames, bound, refs);
        }
        if ($match$7765.$t === "EArray") {
          const x = $match$7765;
          return scanExprList(x.f[1], topNames, bound, refs);
        }
        if ($match$7765.$t === "EAwait") {
          const x = $match$7765;
          const $tc$7994$0 = x.f[1];
          const $tc$7994$1 = topNames;
          const $tc$7994$2 = bound;
          const $tc$7994$3 = refs;
          expr = $tc$7994$0;
          topNames = $tc$7994$1;
          bound = $tc$7994$2;
          refs = $tc$7994$3;
          continue;
        }
        if ($match$7765.$t === "EFmt") {
          const x = $match$7765;
          return scanFmtParts(x.f[1], topNames, bound, refs);
        }
        throw $matchFail("src/check/types.pf", 7765);
      }
    }
    function scanStmtBranch(stmts, topNames, bound, refs) {
      const out = scanStmtList(stmts, topNames, bound, refs);
      return out.f[0];
    }
    function scanStmt(stmt, topNames, bound, refs) {
      while (true) {
        const $match$8015 = stmt;
        if ($match$8015.$t === "SLet") {
          const x = $match$8015;
          return (() => {
            const refs1 = scanExpr(x.f[2], topNames, bound, refs);
            return $makeRecord("NameScan", ["refs", "bound"], [refs1, strAdd(bound, x.f[1])]);
          })();
        }
        if ($match$8015.$t === "SVar") {
          const x = $match$8015;
          return (() => {
            const refs1 = scanExpr(x.f[2], topNames, bound, refs);
            return $makeRecord("NameScan", ["refs", "bound"], [refs1, strAdd(bound, x.f[1])]);
          })();
        }
        if ($match$8015.$t === "SAssign") {
          const x = $match$8015;
          return (() => {
            const refs1 = addTopRef(x.f[1], topNames, bound, refs);
            const refs2 = scanExpr(x.f[2], topNames, bound, refs1);
            return $makeRecord("NameScan", ["refs", "bound"], [refs2, bound]);
          })();
        }
        if ($match$8015.$t === "SIndexAssign") {
          const x = $match$8015;
          return (() => {
            const refs1 = scanExpr(x.f[1], topNames, bound, refs);
            const refs2 = scanExpr(x.f[2], topNames, bound, refs1);
            const refs3 = scanExpr(x.f[3], topNames, bound, refs2);
            return $makeRecord("NameScan", ["refs", "bound"], [refs3, bound]);
          })();
        }
        if ($match$8015.$t === "SFun") {
          const x = $match$8015;
          return (() => {
            const bodyBound = addNames(strAdd(bound, x.f[1]), x.f[2]);
            const bodyOut = scanStmtList(x.f[3], topNames, bodyBound, refs);
            return $makeRecord("NameScan", ["refs", "bound"], [bodyOut.f[0], strAdd(bound, x.f[1])]);
          })();
        }
        if ($match$8015.$t === "SType") {
          return $makeRecord("NameScan", ["refs", "bound"], [refs, bound]);
        }
        if ($match$8015.$t === "SExpr") {
          const x = $match$8015;
          return $makeRecord("NameScan", ["refs", "bound"], [scanExpr(x.f[1], topNames, bound, refs), bound]);
        }
        if ($match$8015.$t === "SReturn") {
          const x = $match$8015;
          return (() => {
            return (($match$8142) => {
              if ($match$8142.$t === "None") {
                return $makeRecord("NameScan", ["refs", "bound"], [refs, bound]);
              }
              if ($match$8142.$t === "Some") {
                const value = $match$8142;
                return $makeRecord("NameScan", ["refs", "bound"], [scanExpr(value.f[0], topNames, bound, refs), bound]);
              }
              throw $matchFail("src/check/types.pf", 8142);
            })(x.f[1]);
          })();
        }
        if ($match$8015.$t === "SIf") {
          const x = $match$8015;
          return (() => {
            const refs1 = scanExpr(x.f[1], topNames, bound, refs);
            const refs2 = scanStmtBranch(x.f[2], topNames, bound, refs1);
            const refs3 = (($match$8175) => {
              if ($match$8175.$t === "None") {
                return refs2;
              }
              if ($match$8175.$t === "Some") {
                const branch = $match$8175;
                return scanStmtBranch(branch.f[0], topNames, bound, refs2);
              }
              throw $matchFail("src/check/types.pf", 8175);
            })(x.f[3]);
            return $makeRecord("NameScan", ["refs", "bound"], [refs3, bound]);
          })();
        }
        if ($match$8015.$t === "SWhile") {
          const x = $match$8015;
          return (() => {
            const refs1 = scanExpr(x.f[1], topNames, bound, refs);
            const refs2 = scanStmtBranch(x.f[2], topNames, bound, refs1);
            return $makeRecord("NameScan", ["refs", "bound"], [refs2, bound]);
          })();
        }
        if ($match$8015.$t === "SImport") {
          return $makeRecord("NameScan", ["refs", "bound"], [refs, bound]);
        }
        if ($match$8015.$t === "SExport") {
          const x = $match$8015;
          const $tc$8221$0 = x.f[1];
          const $tc$8221$1 = topNames;
          const $tc$8221$2 = bound;
          const $tc$8221$3 = refs;
          stmt = $tc$8221$0;
          topNames = $tc$8221$1;
          bound = $tc$8221$2;
          refs = $tc$8221$3;
          continue;
        }
        if ($match$8015.$t === "SExtern") {
          const x = $match$8015;
          return $makeRecord("NameScan", ["refs", "bound"], [refs, strAdd(bound, $field(x.f[1], "name"))]);
        }
        throw $matchFail("src/check/types.pf", 8015);
      }
    }
    function scanStmtList(stmts, topNames, bound, refs) {
      return (($match$8232) => {
        if ($match$8232.$t === "None") {
          return $makeRecord("NameScan", ["refs", "bound"], [refs, bound]);
        }
        if ($match$8232.$t === "Some") {
          const cell = $match$8232;
          return (() => {
            const p = cell.f[0];
            const one = scanStmt(p.f[0], topNames, bound, refs);
            return scanStmtList(p.f[1], topNames, one.f[1], one.f[0]);
          })();
        }
        throw $matchFail("src/check/types.pf", 8232);
      })($field(Compat, "uncons")(stmts));
    }
    function bindingNameOf(stmt) {
      while (true) {
        const $match$8264 = stmt;
        if ($match$8264.$t === "SLet") {
          const x = $match$8264;
          return $makeVariant("Some", "Option", ["value"], [x.f[1]]);
        }
        if ($match$8264.$t === "SVar") {
          const x = $match$8264;
          return $makeVariant("Some", "Option", ["value"], [x.f[1]]);
        }
        if ($match$8264.$t === "SFun") {
          const x = $match$8264;
          return $makeVariant("Some", "Option", ["value"], [x.f[1]]);
        }
        if ($match$8264.$t === "SExport") {
          const x = $match$8264;
          const $tc$8278$0 = x.f[1];
          stmt = $tc$8278$0;
          continue;
        }
        if (true) {
          return $makeVariant("None", "Option", [], []);
        }
        throw $matchFail("src/check/types.pf", 8264);
      }
    }
    function collectRawBindings(stmts, acc) {
      return (($match$8282) => {
        if ($match$8282.$t === "None") {
          return $reverse(acc);
        }
        if ($match$8282.$t === "Some") {
          const cell = $match$8282;
          return (() => {
            const p = cell.f[0];
            return (($match$8294) => {
              if ($match$8294.$t === "None") {
                return collectRawBindings(p.f[1], acc);
              }
              if ($match$8294.$t === "Some") {
                const name = $match$8294;
                return collectRawBindings(p.f[1], $cons($makeRecord("BindingDecl", ["name", "stmt", "deps"], [name.f[0], p.f[0], []]), acc));
              }
              throw $matchFail("src/check/types.pf", 8294);
            })(bindingNameOf(p.f[0]));
          })();
        }
        throw $matchFail("src/check/types.pf", 8282);
      })($field(Compat, "uncons")(stmts));
    }
    function bindingNames(bindings, acc) {
      return (($match$8320) => {
        if ($match$8320.$t === "None") {
          return $reverse(acc);
        }
        if ($match$8320.$t === "Some") {
          const cell = $match$8320;
          return (() => {
            const p = cell.f[0];
            return bindingNames(p.f[1], $cons($field(p.f[0], "name"), acc));
          })();
        }
        throw $matchFail("src/check/types.pf", 8320);
      })($field(Compat, "uncons")(bindings));
    }
    function bindingDeps(stmt, topNames) {
      while (true) {
        const $match$8345 = stmt;
        if ($match$8345.$t === "SFun") {
          const x = $match$8345;
          return (() => {
            const out = scanStmtList(x.f[3], topNames, addNames([], x.f[2]), []);
            return out.f[0];
          })();
        }
        if ($match$8345.$t === "SLet") {
          const x = $match$8345;
          return scanExpr(x.f[2], topNames, [], []);
        }
        if ($match$8345.$t === "SVar") {
          const x = $match$8345;
          return scanExpr(x.f[2], topNames, [], []);
        }
        if ($match$8345.$t === "SExport") {
          const x = $match$8345;
          const $tc$8381$0 = x.f[1];
          const $tc$8381$1 = topNames;
          stmt = $tc$8381$0;
          topNames = $tc$8381$1;
          continue;
        }
        if (true) {
          return [];
        }
        throw $matchFail("src/check/types.pf", 8345);
      }
    }
    function fillBindingDeps(bindings, topNames, acc) {
      return (($match$8385) => {
        if ($match$8385.$t === "None") {
          return $reverse(acc);
        }
        if ($match$8385.$t === "Some") {
          const cell = $match$8385;
          return (() => {
            const p = cell.f[0];
            return fillBindingDeps(p.f[1], topNames, $cons($makeRecord("BindingDecl", ["name", "stmt", "deps"], [$field(p.f[0], "name"), $field(p.f[0], "stmt"), bindingDeps($field(p.f[0], "stmt"), topNames)]), acc));
          })();
        }
        throw $matchFail("src/check/types.pf", 8385);
      })($field(Compat, "uncons")(bindings));
    }
    function collectBindings(stmts) {
      const raw = collectRawBindings(stmts, []);
      const names = bindingNames(raw, []);
      return fillBindingDeps(raw, names, []);
    }
    function findBinding(bindings, name) {
      return (($match$8438) => {
        if ($match$8438.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$8438.$t === "Some") {
          const cell = $match$8438;
          return (() => {
            const p = cell.f[0];
            if ($field(p.f[0], "name") === name) {
              return $makeVariant("Some", "Option", ["value"], [p.f[0]]);
            } else {
              return findBinding(p.f[1], name);
            }
          })();
        }
        throw $matchFail("src/check/types.pf", 8438);
      })($field(Compat, "uncons")(bindings));
    }
    function depsForName(bindings, name) {
      return (($match$8466) => {
        if ($match$8466.$t === "None") {
          return [];
        }
        if ($match$8466.$t === "Some") {
          const binding = $match$8466;
          return $field(binding.f[0], "deps");
        }
        throw $matchFail("src/check/types.pf", 8466);
      })(findBinding(bindings, name));
    }
    function finishDeps(deps, bindings, visited, order) {
      return (($match$8477) => {
        if ($match$8477.$t === "None") {
          return $makeRecord("DfsOut", ["visited", "order"], [visited, order]);
        }
        if ($match$8477.$t === "Some") {
          const cell = $match$8477;
          return (() => {
            const p = cell.f[0];
            const one = finishDfs(p.f[0], bindings, visited, order);
            return finishDeps(p.f[1], bindings, one.f[0], one.f[1]);
          })();
        }
        throw $matchFail("src/check/types.pf", 8477);
      })($field(Compat, "uncons")(deps));
    }
    function finishDfs(name, bindings, visited, order) {
      if (strContains(visited, name)) {
        return $makeRecord("DfsOut", ["visited", "order"], [visited, order]);
      } else {
        const visited1 = strAdd(visited, name);
        const after = finishDeps(depsForName(bindings, name), bindings, visited1, order);
        return $makeRecord("DfsOut", ["visited", "order"], [after.f[0], $cons(name, after.f[1])]);
      }
    }
    function finishAll(names, bindings, visited, order) {
      return (($match$8543) => {
        if ($match$8543.$t === "None") {
          return $makeRecord("DfsOut", ["visited", "order"], [visited, order]);
        }
        if ($match$8543.$t === "Some") {
          const cell = $match$8543;
          return (() => {
            const p = cell.f[0];
            const one = finishDfs(p.f[0], bindings, visited, order);
            return finishAll(p.f[1], bindings, one.f[0], one.f[1]);
          })();
        }
        throw $matchFail("src/check/types.pf", 8543);
      })($field(Compat, "uncons")(names));
    }
    function reverseDepsForName(bindings, name, acc) {
      return (($match$8575) => {
        if ($match$8575.$t === "None") {
          return $reverse(acc);
        }
        if ($match$8575.$t === "Some") {
          const cell = $match$8575;
          return (() => {
            const p = cell.f[0];
            const acc1 = strContains($field(p.f[0], "deps"), name) ? (() => {
              return $cons($field(p.f[0], "name"), acc);
            })() : (() => {
              return acc;
            })();
            return reverseDepsForName(p.f[1], name, acc1);
          })();
        }
        throw $matchFail("src/check/types.pf", 8575);
      })($field(Compat, "uncons")(bindings));
    }
    function collectReverseDeps(deps, bindings, visited, members) {
      return (($match$8615) => {
        if ($match$8615.$t === "None") {
          return $makeRecord("ComponentOut", ["visited", "members"], [visited, members]);
        }
        if ($match$8615.$t === "Some") {
          const cell = $match$8615;
          return (() => {
            const p = cell.f[0];
            const one = collectReverseDfs(p.f[0], bindings, visited, members);
            return collectReverseDeps(p.f[1], bindings, one.f[0], one.f[1]);
          })();
        }
        throw $matchFail("src/check/types.pf", 8615);
      })($field(Compat, "uncons")(deps));
    }
    function collectReverseDfs(name, bindings, visited, members) {
      if (strContains(visited, name)) {
        return $makeRecord("ComponentOut", ["visited", "members"], [visited, members]);
      } else {
        const visited1 = strAdd(visited, name);
        const incoming = reverseDepsForName(bindings, name, []);
        const after = collectReverseDeps(incoming, bindings, visited1, $cons(name, members));
        return after;
      }
    }
    function collectComponents(order, bindings, visited, groups) {
      return (($match$8680) => {
        if ($match$8680.$t === "None") {
          return $makeRecord("ComponentsOut", ["visited", "groups"], [visited, groups]);
        }
        if ($match$8680.$t === "Some") {
          const cell = $match$8680;
          return (() => {
            const p = cell.f[0];
            if (strContains(visited, p.f[0])) {
              return collectComponents(p.f[1], bindings, visited, groups);
            } else {
              const one = collectReverseDfs(p.f[0], bindings, visited, []);
              return collectComponents(p.f[1], bindings, one.f[0], $cons(one.f[1], groups));
            }
          })();
        }
        throw $matchFail("src/check/types.pf", 8680);
      })($field(Compat, "uncons")(order));
    }
    function bindingGroups(bindings) {
      const names = bindingNames(bindings, []);
      const finished = finishAll(names, bindings, [], []);
      const components = collectComponents(finished.f[1], bindings, [], []);
      return components.f[1];
    }
    function bindingsInGroup(bindings, names, acc) {
      return (($match$8753) => {
        if ($match$8753.$t === "None") {
          return $reverse(acc);
        }
        if ($match$8753.$t === "Some") {
          const cell = $match$8753;
          return (() => {
            const p = cell.f[0];
            const acc1 = strContains(names, $field(p.f[0], "name")) ? (() => {
              return $cons(p.f[0], acc);
            })() : (() => {
              return acc;
            })();
            return bindingsInGroup(p.f[1], names, acc1);
          })();
        }
        throw $matchFail("src/check/types.pf", 8753);
      })($field(Compat, "uncons")(bindings));
    }
    function predeclareBinding(st, env, stmt) {
      while (true) {
        const $match$8792 = stmt;
        if ($match$8792.$t === "SFun") {
          const s = $match$8792;
          return (() => {
            const ps = freshTypeList(st, $length(s.f[2]));
            const ret = freshVar(ps.f[0]);
            const typ = rawFunctionType(s.f[4], ps.f[1], ret.f[1]);
            return envOut(ret.f[0], putEnv(env, s.f[1], $makeVariant("TMono", "TcEntry", ["t"], [typ])));
          })();
        }
        if ($match$8792.$t === "SLet") {
          const s = $match$8792;
          return (() => {
            const typ = freshVar(st);
            return envOut(typ.f[0], putEnv(env, s.f[1], $makeVariant("TMono", "TcEntry", ["t"], [typ.f[1]])));
          })();
        }
        if ($match$8792.$t === "SVar") {
          const s = $match$8792;
          return (() => {
            const typ = freshVar(st);
            return envOut(typ.f[0], putEnv(env, s.f[1], $makeVariant("TMono", "TcEntry", ["t"], [typ.f[1]])));
          })();
        }
        if ($match$8792.$t === "SExport") {
          const s = $match$8792;
          const $tc$8870$0 = st;
          const $tc$8870$1 = env;
          const $tc$8870$2 = s.f[1];
          st = $tc$8870$0;
          env = $tc$8870$1;
          stmt = $tc$8870$2;
          continue;
        }
        if (true) {
          return envOut(st, env);
        }
        throw $matchFail("src/check/types.pf", 8792);
      }
    }
    function predeclareBindings(st, env, bindings) {
      return (($match$8877) => {
        if ($match$8877.$t === "None") {
          return envOut(st, env);
        }
        if ($match$8877.$t === "Some") {
          const cell = $match$8877;
          return (() => {
            const p = cell.f[0];
            const one = predeclareBinding(st, env, $field(p.f[0], "stmt"));
            return predeclareBindings(one.f[0], one.f[1], p.f[1]);
          })();
        }
        throw $matchFail("src/check/types.pf", 8877);
      })($field(Compat, "uncons")(bindings));
    }
    function inferExternStmt(st, env, stmt, path) {
      return (($match$8909) => {
        if ($match$8909.$t === "SExtern") {
          const x = $match$8909;
          return inferExtern(st, env, x.f[0], x.f[1], path);
        }
        if ($match$8909.$t === "SExport") {
          const x = $match$8909;
          return (() => {
            return (($match$8921) => {
              if ($match$8921.$t === "SExtern") {
                return (() => {
                  const inner = inferExternStmt(st, env, x.f[1], path);
                  return envOut(addTypedNode(inner.f[0], x.f[0], TUnit), inner.f[1]);
                })();
              }
              if (true) {
                return envOut(st, env);
              }
              throw $matchFail("src/check/types.pf", 8921);
            })(x.f[1]);
          })();
        }
        if (true) {
          return envOut(st, env);
        }
        throw $matchFail("src/check/types.pf", 8909);
      })(stmt);
    }
    function inferExterns(st, env, stmts, path) {
      return (($match$8956) => {
        if ($match$8956.$t === "None") {
          return envOut(st, env);
        }
        if ($match$8956.$t === "Some") {
          const cell = $match$8956;
          return (() => {
            const p = cell.f[0];
            const one = inferExternStmt(st, env, p.f[0], path);
            return inferExterns(one.f[0], one.f[1], p.f[1], path);
          })();
        }
        throw $matchFail("src/check/types.pf", 8956);
      })($field(Compat, "uncons")(stmts));
    }
    function inferFunctionAgainstPredecl(st, env, id, params, body, kind, span, paramTypes, returnType, path) {
      const env1 = bindParams(env, params, paramTypes);
      const bo = inferBody(st, env1, body, path);
      const st1 = unify(bo.f[0], returnType, bo.f[1], path, span);
      const typ = rawFunctionType(kind, paramTypes, returnType);
      return envOut(addTypedNode(st1, id, apply(st1.f[1], typ)), env);
    }
    function inferPredeclaredFunction(st, env, id, name, params, body, kind, span, path) {
      return (($match$9032) => {
        if ($match$9032.$t === "None") {
          return (() => {
            const fallback = inferFunctionDecl(st, env, id, name, params, body, kind, span, path);
            return envOut(fallback.f[0], env);
          })();
        }
        if ($match$9032.$t === "Some") {
          const entry = $match$9032;
          return (() => {
            return (($match$9057) => {
              if ($match$9057.$t === "TMono") {
                const mono = $match$9057;
                return (() => {
                  return (($match$9061) => {
                    if ($match$9061.$t === "TFun") {
                      const f = $match$9061;
                      return inferFunctionAgainstPredecl(st, env, id, params, body, kind, span, f.f[0], f.f[1], path);
                    }
                    if ($match$9061.$t === "TProc") {
                      const p = $match$9061;
                      return inferFunctionAgainstPredecl(st, env, id, params, body, kind, span, p.f[0], p.f[1], path);
                    }
                    if (true) {
                      return (() => {
                        const fallback = inferFunctionDecl(st, env, id, name, params, body, kind, span, path);
                        return envOut(fallback.f[0], env);
                      })();
                    }
                    throw $matchFail("src/check/types.pf", 9061);
                  })(mono.f[0]);
                })();
              }
              if (true) {
                return (() => {
                  const fallback = inferFunctionDecl(st, env, id, name, params, body, kind, span, path);
                  return envOut(fallback.f[0], env);
                })();
              }
              throw $matchFail("src/check/types.pf", 9057);
            })(entry.f[0]);
          })();
        }
        throw $matchFail("src/check/types.pf", 9032);
      })(lookupEnv(env, name));
    }
    function inferPredeclaredValue(st, env, id, name, init, span, path) {
      const value = cgenExpr(st, env, init, path);
      const st1 = (($match$9141) => {
        if ($match$9141.$t === "None") {
          return value.f[0];
        }
        if ($match$9141.$t === "Some") {
          const entry = $match$9141;
          return (() => {
            return (($match$9149) => {
              if ($match$9149.$t === "TMono") {
                const mono = $match$9149;
                return unify(value.f[0], mono.f[0], value.f[1], path, span);
              }
              if (true) {
                return value.f[0];
              }
              throw $matchFail("src/check/types.pf", 9149);
            })(entry.f[0]);
          })();
        }
        throw $matchFail("src/check/types.pf", 9141);
      })(lookupEnv(env, name));
      const typ = (($match$9166) => {
        if ($match$9166.$t === "None") {
          return value.f[1];
        }
        if ($match$9166.$t === "Some") {
          const entry = $match$9166;
          return (() => {
            return (($match$9174) => {
              if ($match$9174.$t === "TMono") {
                const mono = $match$9174;
                return apply(st1.f[1], mono.f[0]);
              }
              if (true) {
                return value.f[1];
              }
              throw $matchFail("src/check/types.pf", 9174);
            })(entry.f[0]);
          })();
        }
        throw $matchFail("src/check/types.pf", 9166);
      })(lookupEnv(env, name));
      return envOut(addTypedNode(st1, id, typ), env);
    }
    function inferGroupBinding(st, env, stmt, path) {
      return (($match$9197) => {
        if ($match$9197.$t === "SFun") {
          const s = $match$9197;
          return inferPredeclaredFunction(st, env, s.f[0], s.f[1], s.f[2], s.f[3], s.f[4], s.f[5], path);
        }
        if ($match$9197.$t === "SLet") {
          const s = $match$9197;
          return inferPredeclaredValue(st, env, s.f[0], s.f[1], s.f[2], s.f[3], path);
        }
        if ($match$9197.$t === "SVar") {
          const s = $match$9197;
          return inferPredeclaredValue(st, env, s.f[0], s.f[1], s.f[2], s.f[3], path);
        }
        if ($match$9197.$t === "SExport") {
          const s = $match$9197;
          return (() => {
            const inner = inferGroupBinding(st, env, s.f[1], path);
            return envOut(addTypedNode(inner.f[0], s.f[0], TUnit), env);
          })();
        }
        if (true) {
          return envOut(st, env);
        }
        throw $matchFail("src/check/types.pf", 9197);
      })(stmt);
    }
    function inferGroupMembers(st, env, bindings, path) {
      return (($match$9268) => {
        if ($match$9268.$t === "None") {
          return envOut(st, env);
        }
        if ($match$9268.$t === "Some") {
          const cell = $match$9268;
          return (() => {
            const p = cell.f[0];
            const one = inferGroupBinding(st, env, $field(p.f[0], "stmt"), path);
            return inferGroupMembers(one.f[0], env, p.f[1], path);
          })();
        }
        throw $matchFail("src/check/types.pf", 9268);
      })($field(Compat, "uncons")(bindings));
    }
    function envFreeVarsExceptNamesFromEntries(entries, excluded, acc) {
      return (($match$9301) => {
        if ($match$9301.$t === "None") {
          return acc;
        }
        if ($match$9301.$t === "Some") {
          const cell = $match$9301;
          return (() => {
            const p = cell.f[0];
            const binding = p.f[0];
            const acc1 = strContains(excluded, $field(binding, "key")) ? (() => {
              return acc;
            })() : (() => {
              return intUnion(acc, envEntryFreeVars($field(binding, "value")));
            })();
            return envFreeVarsExceptNamesFromEntries(p.f[1], excluded, acc1);
          })();
        }
        throw $matchFail("src/check/types.pf", 9301);
      })($field(Compat, "uncons")(entries));
    }
    function envFreeVarsExceptNames(env, excluded) {
      return envFreeVarsExceptNamesFromEntries($field(IMS, "imsEntries")(env), excluded, []);
    }
    function bindingIsGeneric(stmt) {
      while (true) {
        const $match$9352 = stmt;
        if ($match$9352.$t === "SFun") {
          const s = $match$9352;
          return isGenericKind(s.f[4]);
        }
        if ($match$9352.$t === "SExport") {
          const s = $match$9352;
          const $tc$9361$0 = s.f[1];
          stmt = $tc$9361$0;
          continue;
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/check/types.pf", 9352);
      }
    }
    function solvedBindingType(st, env, name) {
      return (($match$9365) => {
        if ($match$9365.$t === "None") {
          return TUnknown;
        }
        if ($match$9365.$t === "Some") {
          const entry = $match$9365;
          return (() => {
            return (($match$9372) => {
              if ($match$9372.$t === "TMono") {
                const mono = $match$9372;
                return apply(st.f[1], mono.f[0]);
              }
              if ($match$9372.$t === "TScheme") {
                const scheme = $match$9372;
                return apply(st.f[1], scheme.f[0].f[2]);
              }
              if (true) {
                return TUnknown;
              }
              throw $matchFail("src/check/types.pf", 9372);
            })(entry.f[0]);
          })();
        }
        throw $matchFail("src/check/types.pf", 9365);
      })(lookupEnv(env, name));
    }
    function nonGenericGroupVars(st, env, bindings, acc) {
      return (($match$9392) => {
        if ($match$9392.$t === "None") {
          return acc;
        }
        if ($match$9392.$t === "Some") {
          const cell = $match$9392;
          return (() => {
            const p = cell.f[0];
            const acc1 = bindingIsGeneric($field(p.f[0], "stmt")) ? (() => {
              return acc;
            })() : (() => {
              return intUnion(acc, freeVars(solvedBindingType(st, env, $field(p.f[0], "name"))));
            })();
            return nonGenericGroupVars(st, env, p.f[1], acc1);
          })();
        }
        throw $matchFail("src/check/types.pf", 9392);
      })($field(Compat, "uncons")(bindings));
    }
    function groupLockedVars(st, env, names, bindings) {
      const outer = envFreeVarsExceptNames(env, names);
      const declarations = declarationFreeVars(st);
      const nonGeneric = nonGenericGroupVars(st, env, bindings, []);
      return intUnion(intUnion(outer, declarations), nonGeneric);
    }
    function schemeWithLocked(st, typ, locked) {
      const solved = apply(st.f[1], typ);
      const vars = intRemoveAll(freeVars(solved), locked);
      return mkScheme(vars, [], solved);
    }
    function finalizeGroupEntries(st, baseEnv, outEnv, bindings, locked) {
      return (($match$9481) => {
        if ($match$9481.$t === "None") {
          return outEnv;
        }
        if ($match$9481.$t === "Some") {
          const cell = $match$9481;
          return (() => {
            const p = cell.f[0];
            const solved = solvedBindingType(st, baseEnv, $field(p.f[0], "name"));
            const entry = bindingIsGeneric($field(p.f[0], "stmt")) ? (() => {
              return $makeVariant("TScheme", "TcEntry", ["scheme"], [schemeWithLocked(st, solved, locked)]);
            })() : (() => {
              return $makeVariant("TMono", "TcEntry", ["t"], [solved]);
            })();
            return finalizeGroupEntries(st, baseEnv, putEnv(outEnv, $field(p.f[0], "name"), entry), p.f[1], locked);
          })();
        }
        throw $matchFail("src/check/types.pf", 9481);
      })($field(Compat, "uncons")(bindings));
    }
    function groupIsRecursive(names, bindings) {
      return (($match$9535) => {
        if ($match$9535.$t === "None") {
          return false;
        }
        if ($match$9535.$t === "Some") {
          const cell = $match$9535;
          return (() => {
            const p = cell.f[0];
            return (($match$9545) => {
              if ($match$9545.$t === "Some") {
                return true;
              }
              if ($match$9545.$t === "None") {
                return strContains(depsForName(bindings, p.f[0]), p.f[0]);
              }
              throw $matchFail("src/check/types.pf", 9545);
            })($field(Compat, "uncons")(p.f[1]));
          })();
        }
        throw $matchFail("src/check/types.pf", 9535);
      })($field(Compat, "uncons")(names));
    }
    function inferDirectGroupMembers(st, env, bindings, path) {
      return (($match$9564) => {
        if ($match$9564.$t === "None") {
          return envOut(st, env);
        }
        if ($match$9564.$t === "Some") {
          const cell = $match$9564;
          return (() => {
            const p = cell.f[0];
            const one = cgenStmt(st, env, $field(p.f[0], "stmt"), path);
            return inferDirectGroupMembers(one.f[0], one.f[1], p.f[1], path);
          })();
        }
        throw $matchFail("src/check/types.pf", 9564);
      })($field(Compat, "uncons")(bindings));
    }
    function inferOneBindingGroup(st, env, names, members, bindings, path) {
      if (groupIsRecursive(names, bindings)) {
        const predeclared = predeclareBindings(st, env, members);
        const checked = inferGroupMembers(predeclared.f[0], predeclared.f[1], members, path);
        const locked = groupLockedVars(checked.f[0], predeclared.f[1], names, members);
        const env1 = finalizeGroupEntries(checked.f[0], predeclared.f[1], env, members, locked);
        return envOut(checked.f[0], env1);
      } else {
        return inferDirectGroupMembers(st, env, members, path);
      }
    }
    function inferBindingGroups(st, env, groups, bindings, path) {
      return (($match$9651) => {
        if ($match$9651.$t === "None") {
          return envOut(st, env);
        }
        if ($match$9651.$t === "Some") {
          const cell = $match$9651;
          return (() => {
            const p = cell.f[0];
            const members = bindingsInGroup(bindings, p.f[0], []);
            const checked = inferOneBindingGroup(st, env, p.f[0], members, bindings, path);
            return inferBindingGroups(checked.f[0], checked.f[1], p.f[1], bindings, path);
          })();
        }
        throw $matchFail("src/check/types.pf", 9651);
      })($field(Compat, "uncons")(groups));
    }
    function isGroupedBinding(stmt) {
      while (true) {
        const $match$9694 = stmt;
        if ($match$9694.$t === "SFun") {
          return true;
        }
        if ($match$9694.$t === "SLet") {
          return true;
        }
        if ($match$9694.$t === "SVar") {
          return true;
        }
        if ($match$9694.$t === "SExport") {
          const s = $match$9694;
          const $tc$9702$0 = s.f[1];
          stmt = $tc$9702$0;
          continue;
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/check/types.pf", 9694);
      }
    }
    function isExternBinding(stmt) {
      while (true) {
        const $match$9706 = stmt;
        if ($match$9706.$t === "SExtern") {
          return true;
        }
        if ($match$9706.$t === "SExport") {
          const s = $match$9706;
          const $tc$9712$0 = s.f[1];
          stmt = $tc$9712$0;
          continue;
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/check/types.pf", 9706);
      }
    }
    function inferResidualStmts(st, env, stmts, path) {
      return (($match$9716) => {
        if ($match$9716.$t === "None") {
          return envOut(st, env);
        }
        if ($match$9716.$t === "Some") {
          const cell = $match$9716;
          return (() => {
            const p = cell.f[0];
            const one = isGroupedBinding(p.f[0]) ? (() => {
              return envOut(st, env);
            })() : (() => {
              if (isExternBinding(p.f[0])) {
                return envOut(st, env);
              } else {
                return cgenStmt(st, env, p.f[0], path);
              }
            })();
            return inferResidualStmts(one.f[0], one.f[1], p.f[1], path);
          })();
        }
        throw $matchFail("src/check/types.pf", 9716);
      })($field(Compat, "uncons")(stmts));
    }
    function isGenericKind(kind) {
      return (($match$9772) => {
        if ($match$9772.$t === "PureFn") {
          const k = $match$9772;
          return k.f[1];
        }
        if ($match$9772.$t === "ProcFn") {
          const k = $match$9772;
          return k.f[1];
        }
        throw $matchFail("src/check/types.pf", 9772);
      })(kind);
    }
    function rawFunctionType(kind, params, ret) {
      return (($match$9780) => {
        if ($match$9780.$t === "PureFn") {
          return $makeVariant("TFun", "Type", ["params", "ret"], [params, ret]);
        }
        if ($match$9780.$t === "ProcFn") {
          const k = $match$9780;
          return $makeVariant("TProc", "Type", ["params", "ret", "isAsync"], [params, ret, k.f[0]]);
        }
        throw $matchFail("src/check/types.pf", 9780);
      })(kind);
    }
    function inferFunctionDecl(st, env, id, name, params, body, kind, span, path) {
      const ps = freshTypeList(st, $length(params));
      const ret = freshVar(ps.f[0]);
      const localType = rawFunctionType(kind, ps.f[1], ret.f[1]);
      const recursiveEnv = putEnv(env, name, $makeVariant("TMono", "TcEntry", ["t"], [localType]));
      const env1 = bindParams(recursiveEnv, params, ps.f[1]);
      const bo = inferBody(ret.f[0], env1, body, path);
      const st1 = unify(bo.f[0], ret.f[1], bo.f[1], path, span);
      const solved = apply(st1.f[1], localType);
      const st2 = addTypedNode(st1, id, solved);
      const entry = schemeOrMono(isGenericKind(kind), env, st2, solved);
      return envOut(st2, putEnv(env, name, entry));
    }
    function inferTypeExpr(st, te) {
      return (($match$9876) => {
        if ($match$9876.$t === "TyName") {
          const n = $match$9876;
          return (() => {
            const args = inferTypeExprList(st, n.f[1], []);
            const typ = builtinTyName(n.f[0], args.f[1]);
            return $makeRecord("Pair", ["key", "value"], [args.f[0], typ]);
          })();
        }
        if ($match$9876.$t === "TyFun") {
          const f = $match$9876;
          return (() => {
            const ps = inferTypeExprList(st, f.f[0], []);
            const ret = inferTypeExpr(ps.f[0], f.f[1]);
            return $makeRecord("Pair", ["key", "value"], [ret.f[0], $makeVariant("TFun", "Type", ["params", "ret"], [ps.f[1], ret.f[1]])]);
          })();
        }
        if ($match$9876.$t === "TyProc") {
          const p = $match$9876;
          return (() => {
            const ps = inferTypeExprList(st, p.f[0], []);
            const ret = inferTypeExpr(ps.f[0], p.f[1]);
            return $makeRecord("Pair", ["key", "value"], [ret.f[0], $makeVariant("TProc", "Type", ["params", "ret", "isAsync"], [ps.f[1], ret.f[1], p.f[2]])]);
          })();
        }
        throw $matchFail("src/check/types.pf", 9876);
      })(te);
    }
    function inferTypeExprList(st, tes, acc) {
      return (($match$9950) => {
        if ($match$9950.$t === "None") {
          return $makeRecord("Pair", ["key", "value"], [st, $reverse(acc)]);
        }
        if ($match$9950.$t === "Some") {
          const cell = $match$9950;
          return (() => {
            const p = cell.f[0];
            const one = inferTypeExpr(st, p.f[0]);
            return inferTypeExprList(one.f[0], p.f[1], $cons(one.f[1], acc));
          })();
        }
        throw $matchFail("src/check/types.pf", 9950);
      })($field(Compat, "uncons")(tes));
    }
    function typedParamsTypes(st, params, acc) {
      return (($match$9984) => {
        if ($match$9984.$t === "None") {
          return $makeRecord("Pair", ["key", "value"], [st, $reverse(acc)]);
        }
        if ($match$9984.$t === "Some") {
          const cell = $match$9984;
          return (() => {
            const p = cell.f[0];
            const one = inferTypeExpr(st, $field(p.f[0], "typeExpr"));
            return typedParamsTypes(one.f[0], p.f[1], $cons(one.f[1], acc));
          })();
        }
        throw $matchFail("src/check/types.pf", 9984);
      })($field(Compat, "uncons")(params));
    }
    function typedParamNames(params) {
      return $map((param) => $field(param, "name"), params);
    }
    function inferExtern(st, env, id, decl, path) {
      const params = typedParamsTypes(st, $field(decl, "params"), []);
      const ret = inferTypeExpr(params.f[0], $field(decl, "ret"));
      const typ = (($match$10041) => {
        if ($match$10041.$t === "ExternFunction") {
          return $makeVariant("TFun", "Type", ["params", "ret"], [params.f[1], ret.f[1]]);
        }
        if ($match$10041.$t === "ExternProc") {
          const k = $match$10041;
          return $makeVariant("TProc", "Type", ["params", "ret", "isAsync"], [params.f[1], ret.f[1], k.f[0]]);
        }
        throw $matchFail("src/check/types.pf", 10041);
      })($field(decl, "kind"));
      return envOut(addTypedNode(ret.f[0], id, typ), putEnv(env, $field(decl, "name"), $makeVariant("TMono", "TcEntry", ["t"], [typ])));
    }
    function cgenStmt(st, env, s, path) {
      return (($match$10074) => {
        if ($match$10074.$t === "SLet") {
          const x = $match$10074;
          return (() => {
            const eo = cgenExpr(st, env, x.f[2], path);
            return envOut(addTypedNode(eo.f[0], x.f[0], eo.f[1]), putEnv(env, x.f[1], $makeVariant("TMono", "TcEntry", ["t"], [eo.f[1]])));
          })();
        }
        if ($match$10074.$t === "SVar") {
          const x = $match$10074;
          return (() => {
            const eo = cgenExpr(st, env, x.f[2], path);
            return envOut(addTypedNode(eo.f[0], x.f[0], eo.f[1]), putEnv(env, x.f[1], $makeVariant("TMono", "TcEntry", ["t"], [eo.f[1]])));
          })();
        }
        if ($match$10074.$t === "SAssign") {
          const x = $match$10074;
          return (() => {
            return (($match$10133) => {
              if ($match$10133.$t === "None") {
                return envOut(addTypeDiag(st, path, x.f[3], $concatS($concatS("Unknown assignment target '", x.f[1]), "'.")), env);
              }
              if ($match$10133.$t === "Some") {
                const e = $match$10133;
                return (() => {
                  const rhs = cgenExpr(st, env, x.f[2], path);
                  const target = (($match$10163) => {
                    if ($match$10163.$t === "TMono") {
                      const m = $match$10163;
                      return m.f[0];
                    }
                    if ($match$10163.$t === "TScheme") {
                      const sc = $match$10163;
                      return sc.f[0].f[2];
                    }
                    if (true) {
                      return TUnknown;
                    }
                    throw $matchFail("src/check/types.pf", 10163);
                  })(e.f[0]);
                  const st1 = unify(rhs.f[0], target, rhs.f[1], path, x.f[3]);
                  return envOut(addTypedNode(st1, x.f[0], TUnit), env);
                })();
              }
              throw $matchFail("src/check/types.pf", 10133);
            })(lookupEnv(env, x.f[1]));
          })();
        }
        if ($match$10074.$t === "SIndexAssign") {
          const x = $match$10074;
          return (() => {
            const oo = cgenExpr(st, env, x.f[1], path);
            const io = cgenExpr(oo.f[0], env, x.f[2], path);
            const st1 = unify(io.f[0], io.f[1], TInt, path, $field(A, "exprSpan")(x.f[2]));
            const slot = inferIndexAccess(st1, oo.f[1], x.f[4], path);
            const rhs = cgenExpr(slot.f[0], env, x.f[3], path);
            const expected = (($match$10245) => {
              if ($match$10245.$t === "TNamed") {
                const opt = $match$10245;
                return (() => {
                  return (($match$10249) => {
                    if ($match$10249.$t === "None") {
                      return TUnknown;
                    }
                    if ($match$10249.$t === "Some") {
                      const v = $match$10249;
                      return v.f[0];
                    }
                    throw $matchFail("src/check/types.pf", 10249);
                  })($field(Compat, "listAt")(opt.f[1], 0));
                })();
              }
              if (true) {
                return TUnknown;
              }
              throw $matchFail("src/check/types.pf", 10245);
            })(slot.f[1]);
            const st2 = unify(rhs.f[0], expected, rhs.f[1], path, $field(A, "exprSpan")(x.f[3]));
            return envOut(addTypedNode(st2, x.f[0], TUnit), env);
          })();
        }
        if ($match$10074.$t === "SFun") {
          const x = $match$10074;
          return inferFunctionDecl(st, env, x.f[0], x.f[1], x.f[2], x.f[3], x.f[4], x.f[5], path);
        }
        if ($match$10074.$t === "SType") {
          const x = $match$10074;
          return envOut(addTypedNode(st, x.f[0], TUnit), env);
        }
        if ($match$10074.$t === "SExpr") {
          const x = $match$10074;
          return (() => {
            const eo = cgenExpr(st, env, x.f[1], path);
            return envOut(addTypedNode(eo.f[0], x.f[0], eo.f[1]), env);
          })();
        }
        if ($match$10074.$t === "SReturn") {
          const x = $match$10074;
          return (() => {
            return (($match$10334) => {
              if ($match$10334.$t === "None") {
                return envOut(addTypedNode(st, x.f[0], TUnit), env);
              }
              if ($match$10334.$t === "Some") {
                const rv = $match$10334;
                return (() => {
                  const eo = cgenExpr(st, env, rv.f[0], path);
                  return envOut(addTypedNode(eo.f[0], x.f[0], eo.f[1]), env);
                })();
              }
              throw $matchFail("src/check/types.pf", 10334);
            })(x.f[1]);
          })();
        }
        if ($match$10074.$t === "SIf") {
          const x = $match$10074;
          return (() => {
            const co = cgenExpr(st, env, x.f[1], path);
            const st1 = unify(co.f[0], co.f[1], TBool, path, $field(A, "exprSpan")(x.f[1]));
            const thenOut = inferBody(st1, env, x.f[2], path);
            const elseOut = (($match$10399) => {
              if ($match$10399.$t === "None") {
                return bodyOut(thenOut.f[0], TUnit);
              }
              if ($match$10399.$t === "Some") {
                const es = $match$10399;
                return inferBody(thenOut.f[0], env, es.f[0], path);
              }
              throw $matchFail("src/check/types.pf", 10399);
            })(x.f[3]);
            return envOut(addTypedNode(elseOut.f[0], x.f[0], TUnit), env);
          })();
        }
        if ($match$10074.$t === "SWhile") {
          const x = $match$10074;
          return (() => {
            const co = cgenExpr(st, env, x.f[1], path);
            const st1 = unify(co.f[0], co.f[1], TBool, path, $field(A, "exprSpan")(x.f[1]));
            const bo = inferBody(st1, env, x.f[2], path);
            return envOut(addTypedNode(bo.f[0], x.f[0], TUnit), env);
          })();
        }
        if ($match$10074.$t === "SImport") {
          const x = $match$10074;
          return envOut(addTypedNode(st, x.f[0], TUnit), env);
        }
        if ($match$10074.$t === "SExport") {
          const x = $match$10074;
          return (() => {
            const inner = cgenStmt(st, env, x.f[1], path);
            return envOut(addTypedNode(inner.f[0], x.f[0], TUnit), inner.f[1]);
          })();
        }
        if ($match$10074.$t === "SExtern") {
          const x = $match$10074;
          return inferExtern(st, env, x.f[0], x.f[1], path);
        }
        throw $matchFail("src/check/types.pf", 10074);
      })(s);
    }
    function inferStmts(st, env, stmts, path) {
      return (($match$10511) => {
        if ($match$10511.$t === "None") {
          return envOut(st, env);
        }
        if ($match$10511.$t === "Some") {
          const cell = $match$10511;
          return (() => {
            const p = cell.f[0];
            const out1 = cgenStmt(st, env, p.f[0], path);
            return inferStmts(out1.f[0], out1.f[1], p.f[1], path);
          })();
        }
        throw $matchFail("src/check/types.pf", 10511);
      })($field(Compat, "uncons")(stmts));
    }
    function exportedNameOf(stmt) {
      return (($match$10544) => {
        if ($match$10544.$t === "SLet") {
          const s = $match$10544;
          return $makeVariant("Some", "Option", ["value"], [s.f[1]]);
        }
        if ($match$10544.$t === "SVar") {
          const s = $match$10544;
          return $makeVariant("Some", "Option", ["value"], [s.f[1]]);
        }
        if ($match$10544.$t === "SFun") {
          const s = $match$10544;
          return $makeVariant("Some", "Option", ["value"], [s.f[1]]);
        }
        if ($match$10544.$t === "SType") {
          const s = $match$10544;
          return (() => {
            return (($match$10556) => {
              if ($match$10556.$t === "RecordDecl") {
                const r = $match$10556;
                return $makeVariant("Some", "Option", ["value"], [r.f[0]]);
              }
              if ($match$10556.$t === "UnionDecl") {
                const u = $match$10556;
                return $makeVariant("Some", "Option", ["value"], [u.f[0]]);
              }
              throw $matchFail("src/check/types.pf", 10556);
            })(s.f[1]);
          })();
        }
        if (true) {
          return $makeVariant("None", "Option", [], []);
        }
        throw $matchFail("src/check/types.pf", 10544);
      })(stmt);
    }
    function stmtIsGenericExport(stmt) {
      return (($match$10569) => {
        if ($match$10569.$t === "SFun") {
          const s = $match$10569;
          return isGenericKind(s.f[4]);
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/check/types.pf", 10569);
      })(stmt);
    }
    function typeHasFreeVars(t) {
      return $gtI($length(freeVars(t)), 0);
    }
    function widenVariantsDeep(t) {
      return (($match$10587) => {
        if ($match$10587.$t === "TVariant") {
          const v = $match$10587;
          return $makeVariant("TNamed", "Type", ["tname", "args"], [v.f[1], $map(widenVariantsDeep, v.f[2])]);
        }
        if ($match$10587.$t === "TList") {
          const x = $match$10587;
          return $makeVariant("TList", "Type", ["elem"], [widenVariantsDeep(x.f[0])]);
        }
        if ($match$10587.$t === "TArray") {
          const x = $match$10587;
          return $makeVariant("TArray", "Type", ["elem"], [widenVariantsDeep(x.f[0])]);
        }
        if ($match$10587.$t === "TDict") {
          const x = $match$10587;
          return $makeVariant("TDict", "Type", ["keyT", "valT"], [widenVariantsDeep(x.f[0]), widenVariantsDeep(x.f[1])]);
        }
        if ($match$10587.$t === "TFun") {
          const f = $match$10587;
          return $makeVariant("TFun", "Type", ["params", "ret"], [$map(widenVariantsDeep, f.f[0]), widenVariantsDeep(f.f[1])]);
        }
        if ($match$10587.$t === "TProc") {
          const pr = $match$10587;
          return $makeVariant("TProc", "Type", ["params", "ret", "isAsync"], [$map(widenVariantsDeep, pr.f[0]), widenVariantsDeep(pr.f[1]), pr.f[2]]);
        }
        if ($match$10587.$t === "TNamed") {
          const n = $match$10587;
          return $makeVariant("TNamed", "Type", ["tname", "args"], [n.f[0], $map(widenVariantsDeep, n.f[1])]);
        }
        if (true) {
          return t;
        }
        throw $matchFail("src/check/types.pf", 10587);
      })(t);
    }
    function substMapWithoutVars(m, vars) {
      return (($match$10649) => {
        if ($match$10649.$t === "None") {
          return m;
        }
        if ($match$10649.$t === "Some") {
          const cell = $match$10649;
          return (() => {
            const p = cell.f[0];
            return substMapWithoutVars($field(IMI, "imiRemove")(m, p.f[0]), p.f[1]);
          })();
        }
        throw $matchFail("src/check/types.pf", 10649);
      })($field(Compat, "uncons")(vars));
    }
    function applySchemeForExport(st, scheme) {
      const m = substMapWithoutVars(st.f[1].f[0], scheme.f[0]);
      return apply($makeRecord("Subst", ["m"], [m]), scheme.f[2]);
    }
    function exportSchemeFor(st, env, stmt, path) {
      return (($match$10688) => {
        if ($match$10688.$t === "None") {
          return $makeRecord("Pair", ["key", "value"], [st, $makeVariant("None", "Option", [], [])]);
        }
        if ($match$10688.$t === "Some") {
          const n = $match$10688;
          return (() => {
            return (($match$10696) => {
              if ($match$10696.$t === "None") {
                return $makeRecord("Pair", ["key", "value"], [st, $makeVariant("Some", "Option", ["value"], [$makeRecord("Pair", ["key", "value"], [n.f[0], mkScheme([], [], $makeVariant("TNamed", "Type", ["tname", "args"], [n.f[0], []]))])])]);
              }
              if ($match$10696.$t === "Some") {
                const entry = $match$10696;
                return (() => {
                  return (($match$10717) => {
                    if ($match$10717.$t === "TScheme") {
                      const s = $match$10717;
                      return (() => {
                        const solved = widenVariantsDeep(applySchemeForExport(st, s.f[0]));
                        return $makeRecord("Pair", ["key", "value"], [st, $makeVariant("Some", "Option", ["value"], [$makeRecord("Pair", ["key", "value"], [n.f[0], mkScheme(s.f[0].f[0], s.f[0].f[1], solved)])])]);
                      })();
                    }
                    if ($match$10717.$t === "TMono") {
                      const m = $match$10717;
                      return (() => {
                        const solved = defaultResidualSlots(widenVariantsDeep(apply(st.f[1], m.f[0])));
                        const st1 = checkExportGround(st, stmt, path, n.f[0], solved);
                        return $makeRecord("Pair", ["key", "value"], [st1, $makeVariant("Some", "Option", ["value"], [$makeRecord("Pair", ["key", "value"], [n.f[0], mkScheme([], [], solved)])])]);
                      })();
                    }
                    if (true) {
                      return $makeRecord("Pair", ["key", "value"], [st, $makeVariant("Some", "Option", ["value"], [$makeRecord("Pair", ["key", "value"], [n.f[0], mkScheme([], [], TUnknown)])])]);
                    }
                    throw $matchFail("src/check/types.pf", 10717);
                  })(entry.f[0]);
                })();
              }
              throw $matchFail("src/check/types.pf", 10696);
            })(lookupEnv(env, n.f[0]));
          })();
        }
        throw $matchFail("src/check/types.pf", 10688);
      })(exportedNameOf(stmt));
    }
    function collectExportsLoop(st, env, stmts, path, acc) {
      return (($match$10793) => {
        if ($match$10793.$t === "None") {
          return $makeRecord("Pair", ["key", "value"], [st, acc]);
        }
        if ($match$10793.$t === "Some") {
          const cell = $match$10793;
          return (() => {
            const p = cell.f[0];
            return (($match$10805) => {
              if ($match$10805.$t === "SExport") {
                const e = $match$10805;
                return (() => {
                  const one = exportSchemeFor(st, env, e.f[1], path);
                  const acc1 = (($match$10817) => {
                    if ($match$10817.$t === "None") {
                      return acc;
                    }
                    if ($match$10817.$t === "Some") {
                      const pair = $match$10817;
                      return $field(IMS, "imsPut")(acc, pair.f[0].f[0], pair.f[0].f[1]);
                    }
                    throw $matchFail("src/check/types.pf", 10817);
                  })(one.f[1]);
                  return collectExportsLoop(one.f[0], env, p.f[1], path, acc1);
                })();
              }
              if (true) {
                return collectExportsLoop(st, env, p.f[1], path, acc);
              }
              throw $matchFail("src/check/types.pf", 10805);
            })(p.f[0]);
          })();
        }
        throw $matchFail("src/check/types.pf", 10793);
      })($field(Compat, "uncons")(stmts));
    }
    function collectExports(st, env, stmts, path) {
      return collectExportsLoop(st, env, stmts, path, $field(IMS, "imsEmpty")());
    }
    function applyTypesMap(types, subst) {
      return $field(IMI, "imiMap")((t) => apply(subst, t), types);
    }
    function inferModule(ast, deps) {
      const st0 = emptyState();
      const env0 = builtinEnv();
      const intrinsic = registerBuiltinTypes(st0, env0);
      const seeded = registerDepTypes(intrinsic.f[0], intrinsic.f[1], deps);
      const imported = bindImports(seeded.f[0], seeded.f[1], $field(ast, "stmts"), deps);
      const declared = declareTypes(imported.f[0], imported.f[1], $field(ast, "stmts"));
      const externed = inferExterns(declared.f[0], declared.f[1], $field(ast, "stmts"), $field(ast, "path"));
      const bindings = collectBindings($field(ast, "stmts"));
      const groups = bindingGroups(bindings);
      const grouped = inferBindingGroups(externed.f[0], externed.f[1], groups, bindings, $field(ast, "path"));
      const solved = inferResidualStmts(grouped.f[0], grouped.f[1], $field(ast, "stmts"), $field(ast, "path"));
      const pendingDone = finalizePending(solved.f[0], $field(ast, "path"));
      const exported = collectExports(pendingDone, solved.f[1], $field(ast, "stmts"), $field(ast, "path"));
      return mkInferResult(applyTypesMap(exported.f[0].f[3], exported.f[0].f[1]), exported.f[1], $reverse(exported.f[0].f[4]));
    }
    exports["TInt"] = TInt;
    exports["TFloat"] = TFloat;
    exports["TBool"] = TBool;
    exports["TStr"] = TStr;
    exports["TChar"] = TChar;
    exports["TByte"] = TByte;
    exports["TUnit"] = TUnit;
    exports["TNonZero"] = TNonZero;
    exports["TAny"] = TAny;
    exports["TList"] = TList;
    exports["TArray"] = TArray;
    exports["TDict"] = TDict;
    exports["TFun"] = TFun;
    exports["TProc"] = TProc;
    exports["TNamed"] = TNamed;
    exports["TVariant"] = TVariant;
    exports["TVar"] = TVar;
    exports["TUnknown"] = TUnknown;
    exports["HasField"] = HasField;
    exports["Equatable"] = Equatable;
    exports["Comparable"] = Comparable;
    exports["tInt"] = tInt;
    exports["tFloat"] = tFloat;
    exports["tBool"] = tBool;
    exports["tStr"] = tStr;
    exports["tChar"] = tChar;
    exports["tByte"] = tByte;
    exports["tUnit"] = tUnit;
    exports["tNonZero"] = tNonZero;
    exports["tAny"] = tAny;
    exports["tList"] = tList;
    exports["tArray"] = tArray;
    exports["tDict"] = tDict;
    exports["tFun"] = tFun;
    exports["tProc"] = tProc;
    exports["tNamed"] = tNamed;
    exports["tVariant"] = tVariant;
    exports["tVar"] = tVar;
    exports["tUnknown"] = tUnknown;
    exports["mkScheme"] = mkScheme;
    exports["emptySubst"] = emptySubst;
    exports["mkInferResult"] = mkInferResult;
    exports["formatType"] = formatType;
    exports["applyType"] = applyType;
    exports["apply"] = apply;
    exports["freeVars"] = freeVars;
    exports["unify"] = unify;
    exports["generalize"] = generalize;
    exports["instantiate"] = instantiate;
    exports["typeToIface"] = typeToIface;
    exports["cgenExpr"] = cgenExpr;
    exports["cgenStmt"] = cgenStmt;
    exports["inferModule"] = inferModule;
  });
  $registerSchemas([{name: "NKValue", union: "NameKind", fields: [], variant: true}, {name: "NKFunction", union: "NameKind", fields: [], variant: true}, {name: "NKProc", union: "NameKind", fields: ["isAsync"], variant: true}, {name: "NKType", union: "NameKind", fields: [], variant: true}, {name: "NKNamespace", union: "NameKind", fields: ["table"], variant: true}, {name: "CtxPure", union: "PurityCtx", fields: [], variant: true}, {name: "CtxProc", union: "PurityCtx", fields: ["isAsync"], variant: true}, {name: "CtxTop", union: "PurityCtx", fields: [], variant: true}, {name: "PurityResult", union: null, fields: ["diags"], variant: false}, {name: "PuritySt", union: null, fields: ["path", "env", "types", "diags"], variant: false}, {name: "ArmOut", union: null, fields: ["st", "env"], variant: false}]);
  $maps["src/check/purity"] = {"../syntax/ast": "src/syntax/ast", "./diag": "src/check/diag", "./iface": "src/check/iface", "./types": "src/check/types", "../data/imapi": "src/data/imapi", "../data/imaps": "src/data/imaps", "../compat": "src/compat"};
  $mods["src/check/purity"] = ((exports, $require) => {
    const A = $require("../syntax/ast");
    const D = $require("./diag");
    const I = $require("./iface");
    const TY = $require("./types");
    const IMI = $require("../data/imapi");
    const IMS = $require("../data/imaps");
    const Compat = $require("../compat");
    const NKValue = $makeVariant("NKValue", "NameKind", [], []);
    const NKFunction = $makeVariant("NKFunction", "NameKind", [], []);
    function NKProc(isAsync) {
      return $makeVariant("NKProc", "NameKind", ["isAsync"], [isAsync]);
    }
    const NKType = $makeVariant("NKType", "NameKind", [], []);
    function NKNamespace(table) {
      return $makeVariant("NKNamespace", "NameKind", ["table"], [table]);
    }
    const CtxPure = $makeVariant("CtxPure", "PurityCtx", [], []);
    function CtxProc(isAsync) {
      return $makeVariant("CtxProc", "PurityCtx", ["isAsync"], [isAsync]);
    }
    const CtxTop = $makeVariant("CtxTop", "PurityCtx", [], []);
    function nkValue() {
      return NKValue;
    }
    function nkFunction() {
      return NKFunction;
    }
    function nkProc(isAsync) {
      return $makeVariant("NKProc", "NameKind", ["isAsync"], [isAsync]);
    }
    function nkType() {
      return NKType;
    }
    function nkNamespace(table) {
      return $makeVariant("NKNamespace", "NameKind", ["table"], [table]);
    }
    function ctxPure() {
      return CtxPure;
    }
    function ctxProc(isAsync) {
      return $makeVariant("CtxProc", "PurityCtx", ["isAsync"], [isAsync]);
    }
    function ctxTop() {
      return CtxTop;
    }
    function mkPurityResult(diags) {
      return $makeRecord("PurityResult", ["diags"], [diags]);
    }
    function mkState(path, env, types, diags) {
      return $makeRecord("PuritySt", ["path", "env", "types", "diags"], [path, env, types, diags]);
    }
    function withEnv(st, env) {
      return $makeRecord("PuritySt", ["path", "env", "types", "diags"], [st.f[0], env, st.f[2], st.f[3]]);
    }
    function withDiags(st, diags) {
      return $makeRecord("PuritySt", ["path", "env", "types", "diags"], [st.f[0], st.f[1], st.f[2], diags]);
    }
    function armOut(st, env) {
      return $makeRecord("ArmOut", ["st", "env"], [st, env]);
    }
    function addDiag(st, span, message) {
      return withDiags(st, $cons($field(D, "err")($makeVariant("PurityD", "DiagCode", [], []), message, st.f[0], span), st.f[3]));
    }
    function bindName(st, name, kind) {
      return withEnv(st, $field(IMS, "imsPut")(st.f[1], name, kind));
    }
    function bindInEnv(env, name, kind) {
      return $field(IMS, "imsPut")(env, name, kind);
    }
    function lookupName(st, name) {
      return $field(IMS, "imsGet")(st.f[1], name);
    }
    function ctxAllowsEffects(ctx) {
      return (($match$133) => {
        if ($match$133.$t === "CtxPure") {
          return false;
        }
        if ($match$133.$t === "CtxProc") {
          return true;
        }
        if ($match$133.$t === "CtxTop") {
          return true;
        }
        throw $matchFail("src/check/purity.pf", 133);
      })(ctx);
    }
    function ctxAllowsAwait(ctx) {
      return (($match$140) => {
        if ($match$140.$t === "CtxProc") {
          const c = $match$140;
          return c.f[0];
        }
        if ($match$140.$t === "CtxPure") {
          return false;
        }
        if ($match$140.$t === "CtxTop") {
          return false;
        }
        throw $matchFail("src/check/purity.pf", 140);
      })(ctx);
    }
    function pureContextForLazy(mode, ctx) {
      return (($match$148) => {
        if ($match$148.$t === "LazyList") {
          return CtxPure;
        }
        if ($match$148.$t === "StrictList") {
          return ctx;
        }
        throw $matchFail("src/check/purity.pf", 148);
      })(mode);
    }
    function kindFromExportKind(kind) {
      return (($match$154) => {
        if ($match$154.$t === "KFun") {
          return NKFunction;
        }
        if ($match$154.$t === "KProc") {
          return $makeVariant("NKProc", "NameKind", ["isAsync"], [false]);
        }
        if ($match$154.$t === "KValue") {
          return NKValue;
        }
        if ($match$154.$t === "KMutable") {
          return NKValue;
        }
        if ($match$154.$t === "KType") {
          return NKType;
        }
        if ($match$154.$t === "KOpaqueType") {
          return NKType;
        }
        throw $matchFail("src/check/purity.pf", 154);
      })(kind);
    }
    function tableFromKindEntries(entries, table) {
      return (($match$165) => {
        if ($match$165.$t === "None") {
          return table;
        }
        if ($match$165.$t === "Some") {
          const cell = $match$165;
          return (() => {
            const p = cell.f[0].f[0];
            const table1 = $field(IMS, "imsPut")(table, $field(p, "key"), kindFromExportKind($field(p, "value")));
            return tableFromKindEntries(cell.f[0].f[1], table1);
          })();
        }
        throw $matchFail("src/check/purity.pf", 165);
      })($field(Compat, "uncons")(entries));
    }
    function tableFromVariants(variants, table) {
      return (($match$196) => {
        if ($match$196.$t === "None") {
          return table;
        }
        if ($match$196.$t === "Some") {
          const cell = $match$196;
          return (() => {
            const v = cell.f[0].f[0];
            const table1 = $field(IMS, "imsPut")(table, $field(v, "vname"), NKFunction);
            return tableFromVariants(cell.f[0].f[1], table1);
          })();
        }
        throw $matchFail("src/check/purity.pf", 196);
      })($field(Compat, "uncons")(variants));
    }
    function tableFromUnionEntries(entries, table) {
      return (($match$224) => {
        if ($match$224.$t === "None") {
          return table;
        }
        if ($match$224.$t === "Some") {
          const cell = $match$224;
          return (() => {
            const p = cell.f[0].f[0];
            const table1 = tableFromVariants($field(p, "value"), table);
            return tableFromUnionEntries(cell.f[0].f[1], table1);
          })();
        }
        throw $matchFail("src/check/purity.pf", 224);
      })($field(Compat, "uncons")(entries));
    }
    function tableFromIface(iface) {
      const table1 = tableFromKindEntries($field(IMS, "imsEntries")($field(iface, "kinds")), $field(IMS, "imsEmpty")());
      return tableFromUnionEntries($field(IMS, "imsEntries")($field(iface, "unions")), table1);
    }
    function variantKindInVariants(variants, name) {
      return (($match$271) => {
        if ($match$271.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$271.$t === "Some") {
          const cell = $match$271;
          return (() => {
            const v = cell.f[0].f[0];
            if ($field(v, "vname") === name) {
              return $makeVariant("Some", "Option", ["value"], [NKFunction]);
            } else {
              return variantKindInVariants(cell.f[0].f[1], name);
            }
          })();
        }
        throw $matchFail("src/check/purity.pf", 271);
      })($field(Compat, "uncons")(variants));
    }
    function variantKindInUnionEntries(entries, name) {
      return (($match$299) => {
        if ($match$299.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$299.$t === "Some") {
          const cell = $match$299;
          return (() => {
            const p = cell.f[0].f[0];
            return (($match$310) => {
              if ($match$310.$t === "Some") {
                const k = $match$310;
                return $makeVariant("Some", "Option", ["value"], [k.f[0]]);
              }
              if ($match$310.$t === "None") {
                return variantKindInUnionEntries(cell.f[0].f[1], name);
              }
              throw $matchFail("src/check/purity.pf", 310);
            })(variantKindInVariants($field(p, "value"), name));
          })();
        }
        throw $matchFail("src/check/purity.pf", 299);
      })($field(Compat, "uncons")(entries));
    }
    function lookupIfaceNameKind(iface, name) {
      return (($match$328) => {
        if ($match$328.$t === "Some") {
          const k = $match$328;
          return $makeVariant("Some", "Option", ["value"], [kindFromExportKind(k.f[0])]);
        }
        if ($match$328.$t === "None") {
          return variantKindInUnionEntries($field(IMS, "imsEntries")($field(iface, "unions")), name);
        }
        throw $matchFail("src/check/purity.pf", 328);
      })($field(I, "lookupKind")(iface, name));
    }
    function ifacePathMatches(rawPath, iface) {
      return $field(iface, "path") === rawPath;
    }
    function ifaceForImportLoop(entries, rawPath) {
      return (($match$355) => {
        if ($match$355.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$355.$t === "Some") {
          const cell = $match$355;
          return (() => {
            const p = cell.f[0].f[0];
            const iface = $field(p, "value");
            if (ifacePathMatches(rawPath, iface)) {
              return $makeVariant("Some", "Option", ["value"], [iface]);
            } else {
              return ifaceForImportLoop(cell.f[0].f[1], rawPath);
            }
          })();
        }
        throw $matchFail("src/check/purity.pf", 355);
      })($field(Compat, "uncons")(entries));
    }
    function ifaceForImport(rawPath, deps) {
      return (($match$386) => {
        if ($match$386.$t === "Some") {
          const iface = $match$386;
          return $makeVariant("Some", "Option", ["value"], [iface.f[0]]);
        }
        if ($match$386.$t === "None") {
          return ifaceForImportLoop($field(IMS, "imsEntries")(deps), rawPath);
        }
        throw $matchFail("src/check/purity.pf", 386);
      })($field(IMS, "imsGet")(deps, rawPath));
    }
    function importAliasName(importName) {
      return (($match$404) => {
        if ($match$404.$t === "Some") {
          const a = $match$404;
          return a.f[0];
        }
        if ($match$404.$t === "None") {
          return $field(importName, "name");
        }
        throw $matchFail("src/check/purity.pf", 404);
      })($field(importName, "alias"));
    }
    function bindNamedImports(st, iface, names) {
      return (($match$413) => {
        if ($match$413.$t === "None") {
          return st;
        }
        if ($match$413.$t === "Some") {
          const cell = $match$413;
          return (() => {
            const item = cell.f[0].f[0];
            const localName = importAliasName(item);
            return (($match$428) => {
              if ($match$428.$t === "Some") {
                const k = $match$428;
                return bindNamedImports(bindName(st, localName, k.f[0]), iface, cell.f[0].f[1]);
              }
              if ($match$428.$t === "None") {
                return bindNamedImports(bindName(st, localName, NKValue), iface, cell.f[0].f[1]);
              }
              throw $matchFail("src/check/purity.pf", 428);
            })(lookupIfaceNameKind(iface, $field(item, "name")));
          })();
        }
        throw $matchFail("src/check/purity.pf", 413);
      })($field(Compat, "uncons")(names));
    }
    function bindStarImports(st, iface) {
      const table = tableFromIface(iface);
      const entries = $field(IMS, "imsEntries")(table);
      return bindStarEntries(st, entries);
    }
    function bindStarEntries(st, entries) {
      return (($match$475) => {
        if ($match$475.$t === "None") {
          return st;
        }
        if ($match$475.$t === "Some") {
          const cell = $match$475;
          return (() => {
            const p = cell.f[0].f[0];
            return bindStarEntries(bindName(st, $field(p, "key"), $field(p, "value")), cell.f[0].f[1]);
          })();
        }
        throw $matchFail("src/check/purity.pf", 475);
      })($field(Compat, "uncons")(entries));
    }
    function bindImportStmt(st, stmt, deps) {
      return (($match$501) => {
        if ($match$501.$t === "SImport") {
          const s = $match$501;
          return (() => {
            return (($match$504) => {
              if ($match$504.$t === "None") {
                return st;
              }
              if ($match$504.$t === "Some") {
                const ifaceCell = $match$504;
                return (() => {
                  const iface = ifaceCell.f[0];
                  return (($match$515) => {
                    if ($match$515.$t === "INames") {
                      const spec = $match$515;
                      return bindNamedImports(st, iface, spec.f[0]);
                    }
                    if ($match$515.$t === "INamespace") {
                      const spec = $match$515;
                      return bindName(st, spec.f[0], $makeVariant("NKNamespace", "NameKind", ["table"], [tableFromIface(iface)]));
                    }
                    if ($match$515.$t === "IStar") {
                      return bindStarImports(st, iface);
                    }
                    throw $matchFail("src/check/purity.pf", 515);
                  })(s.f[1]);
                })();
              }
              throw $matchFail("src/check/purity.pf", 504);
            })(ifaceForImport(s.f[2], deps));
          })();
        }
        if (true) {
          return st;
        }
        throw $matchFail("src/check/purity.pf", 501);
      })(stmt);
    }
    function bindImportStmts(st, stmts, deps) {
      while (true) {
        const $match$542 = $field(Compat, "uncons")(stmts);
        if ($match$542.$t === "None") {
          return st;
        }
        if ($match$542.$t === "Some") {
          const cell = $match$542;
          const $tc$560$0 = bindImportStmt(st, cell.f[0].f[0], deps);
          const $tc$560$1 = cell.f[0].f[1];
          const $tc$560$2 = deps;
          st = $tc$560$0;
          stmts = $tc$560$1;
          deps = $tc$560$2;
          continue;
        }
        throw $matchFail("src/check/purity.pf", 542);
      }
    }
    function nameOfTypeDecl(decl) {
      return (($match$563) => {
        if ($match$563.$t === "RecordDecl") {
          const r = $match$563;
          return r.f[0];
        }
        if ($match$563.$t === "UnionDecl") {
          const u = $match$563;
          return u.f[0];
        }
        throw $matchFail("src/check/purity.pf", 563);
      })(decl);
    }
    function variantsOfTypeDecl(decl) {
      return (($match$571) => {
        if ($match$571.$t === "RecordDecl") {
          return [];
        }
        if ($match$571.$t === "UnionDecl") {
          const u = $match$571;
          return u.f[1];
        }
        throw $matchFail("src/check/purity.pf", 571);
      })(decl);
    }
    function kindOfFnKind(kind) {
      return (($match$578) => {
        if ($match$578.$t === "PureFn") {
          return NKFunction;
        }
        if ($match$578.$t === "ProcFn") {
          const p = $match$578;
          return $makeVariant("NKProc", "NameKind", ["isAsync"], [p.f[0]]);
        }
        throw $matchFail("src/check/purity.pf", 578);
      })(kind);
    }
    function kindOfExternKind(kind) {
      return (($match$586) => {
        if ($match$586.$t === "ExternFunction") {
          return NKFunction;
        }
        if ($match$586.$t === "ExternProc") {
          const p = $match$586;
          return $makeVariant("NKProc", "NameKind", ["isAsync"], [p.f[0]]);
        }
        throw $matchFail("src/check/purity.pf", 586);
      })(kind);
    }
    function bindVariantDecls(st, variants) {
      return (($match$594) => {
        if ($match$594.$t === "None") {
          return st;
        }
        if ($match$594.$t === "Some") {
          const cell = $match$594;
          return (() => {
            const v = cell.f[0].f[0];
            return bindVariantDecls(bindName(st, $field(v, "vname"), NKFunction), cell.f[0].f[1]);
          })();
        }
        throw $matchFail("src/check/purity.pf", 594);
      })($field(Compat, "uncons")(variants));
    }
    function prebindOne(st, stmt) {
      while (true) {
        const $match$619 = stmt;
        if ($match$619.$t === "SLet") {
          const s = $match$619;
          return bindName(st, s.f[1], NKValue);
        }
        if ($match$619.$t === "SVar") {
          const s = $match$619;
          return bindName(st, s.f[1], NKValue);
        }
        if ($match$619.$t === "SFun") {
          const s = $match$619;
          return bindName(st, s.f[1], kindOfFnKind(s.f[4]));
        }
        if ($match$619.$t === "SExtern") {
          const s = $match$619;
          return bindName(st, $field(s.f[1], "name"), kindOfExternKind($field(s.f[1], "kind")));
        }
        if ($match$619.$t === "SType") {
          const s = $match$619;
          return (() => {
            const st1 = bindName(st, nameOfTypeDecl(s.f[1]), NKType);
            return bindVariantDecls(st1, variantsOfTypeDecl(s.f[1]));
          })();
        }
        if ($match$619.$t === "SExport") {
          const e = $match$619;
          const $tc$675$0 = st;
          const $tc$675$1 = e.f[1];
          st = $tc$675$0;
          stmt = $tc$675$1;
          continue;
        }
        if (true) {
          return st;
        }
        throw $matchFail("src/check/purity.pf", 619);
      }
    }
    function prebindLocalDecls(st, stmts) {
      while (true) {
        const $match$679 = $field(Compat, "uncons")(stmts);
        if ($match$679.$t === "None") {
          return st;
        }
        if ($match$679.$t === "Some") {
          const cell = $match$679;
          const $tc$695$0 = prebindOne(st, cell.f[0].f[0]);
          const $tc$695$1 = cell.f[0].f[1];
          st = $tc$695$0;
          stmts = $tc$695$1;
          continue;
        }
        throw $matchFail("src/check/purity.pf", 679);
      }
    }
    function bindParams(st, params) {
      while (true) {
        const $match$698 = $field(Compat, "uncons")(params);
        if ($match$698.$t === "None") {
          return st;
        }
        if ($match$698.$t === "Some") {
          const cell = $match$698;
          const $tc$715$0 = bindName(st, cell.f[0].f[0], NKValue);
          const $tc$715$1 = cell.f[0].f[1];
          st = $tc$715$0;
          params = $tc$715$1;
          continue;
        }
        throw $matchFail("src/check/purity.pf", 698);
      }
    }
    function lookupNamespaceField(st, objectExpr, fname) {
      return (($match$718) => {
        if ($match$718.$t === "EVar") {
          const e = $match$718;
          return (() => {
            return (($match$721) => {
              if ($match$721.$t === "Some") {
                const k = $match$721;
                return (() => {
                  return (($match$728) => {
                    if ($match$728.$t === "NKNamespace") {
                      const ns = $match$728;
                      return $field(IMS, "imsGet")(ns.f[0], fname);
                    }
                    if (true) {
                      return $makeVariant("None", "Option", [], []);
                    }
                    throw $matchFail("src/check/purity.pf", 728);
                  })(k.f[0]);
                })();
              }
              if ($match$721.$t === "None") {
                return $makeVariant("None", "Option", [], []);
              }
              throw $matchFail("src/check/purity.pf", 721);
            })(lookupName(st, e.f[1]));
          })();
        }
        if (true) {
          return $makeVariant("None", "Option", [], []);
        }
        throw $matchFail("src/check/purity.pf", 718);
      })(objectExpr);
    }
    function kindOfNamedExpr(st, expr) {
      return (($match$744) => {
        if ($match$744.$t === "EVar") {
          const e = $match$744;
          return lookupName(st, e.f[1]);
        }
        if ($match$744.$t === "EField") {
          const e = $match$744;
          return lookupNamespaceField(st, e.f[1], e.f[2]);
        }
        if (true) {
          return $makeVariant("None", "Option", [], []);
        }
        throw $matchFail("src/check/purity.pf", 744);
      })(expr);
    }
    function nameOfNamedExpr(expr) {
      return (($match$761) => {
        if ($match$761.$t === "EVar") {
          const e = $match$761;
          return e.f[1];
        }
        if ($match$761.$t === "EField") {
          const e = $match$761;
          return e.f[2];
        }
        if (true) {
          return "<expression>";
        }
        throw $matchFail("src/check/purity.pf", 761);
      })(expr);
    }
    function procCallDiag(st, span, name) {
      return addDiag(st, span, $concatS($concatS("Pure code cannot call procedure '", name), "'."));
    }
    function checkNamedValueUse(st, ctx, expr) {
      return checkExprObjectPart(st, ctx, expr);
    }
    function checkExprObjectPart(st, ctx, expr) {
      return (($match$788) => {
        if ($match$788.$t === "EField") {
          const e = $match$788;
          return checkExpr(st, ctx, e.f[1]);
        }
        if (true) {
          return st;
        }
        throw $matchFail("src/check/purity.pf", 788);
      })(expr);
    }
    function inferredExprIsProc(st, expr) {
      return (($match$799) => {
        if ($match$799.$t === "None") {
          return false;
        }
        if ($match$799.$t === "Some") {
          const found = $match$799;
          return (() => {
            return (($match$811) => {
              if ($match$811.$t === "TProc") {
                return true;
              }
              if (true) {
                return false;
              }
              throw $matchFail("src/check/purity.pf", 811);
            })(found.f[0]);
          })();
        }
        throw $matchFail("src/check/purity.pf", 799);
      })($field(IMI, "imiGet")(st.f[2], $field(A, "exprId")(expr)));
    }
    function namedExprIsProc(st, expr) {
      return (($match$819) => {
        if ($match$819.$t === "Some") {
          const k = $match$819;
          return (() => {
            return (($match$825) => {
              if ($match$825.$t === "NKProc") {
                return true;
              }
              if (true) {
                return false;
              }
              throw $matchFail("src/check/purity.pf", 825);
            })(k.f[0]);
          })();
        }
        if ($match$819.$t === "None") {
          return false;
        }
        throw $matchFail("src/check/purity.pf", 819);
      })(kindOfNamedExpr(st, expr));
    }
    function exprIsProc(st, expr) {
      return inferredExprIsProc(st, expr) || namedExprIsProc(st, expr);
    }
    function checkExprList(st, ctx, exprs) {
      while (true) {
        const $match$845 = $field(Compat, "uncons")(exprs);
        if ($match$845.$t === "None") {
          return st;
        }
        if ($match$845.$t === "Some") {
          const cell = $match$845;
          const $tc$863$0 = checkExpr(st, ctx, cell.f[0].f[0]);
          const $tc$863$1 = ctx;
          const $tc$863$2 = cell.f[0].f[1];
          st = $tc$863$0;
          ctx = $tc$863$1;
          exprs = $tc$863$2;
          continue;
        }
        throw $matchFail("src/check/purity.pf", 845);
      }
    }
    function checkFieldExprs(st, ctx, fields) {
      return (($match$866) => {
        if ($match$866.$t === "None") {
          return st;
        }
        if ($match$866.$t === "Some") {
          const cell = $match$866;
          return (() => {
            const f = cell.f[0].f[0];
            return checkFieldExprs(checkExpr(st, ctx, $field(f, "value")), ctx, cell.f[0].f[1]);
          })();
        }
        throw $matchFail("src/check/purity.pf", 866);
      })($field(Compat, "uncons")(fields));
    }
    function checkDictEntries(st, ctx, entries) {
      return (($match$892) => {
        if ($match$892.$t === "None") {
          return st;
        }
        if ($match$892.$t === "Some") {
          const cell = $match$892;
          return (() => {
            const e = cell.f[0].f[0];
            const st1 = checkExpr(st, ctx, $field(e, "key"));
            const st2 = checkExpr(st1, ctx, $field(e, "value"));
            return checkDictEntries(st2, ctx, cell.f[0].f[1]);
          })();
        }
        throw $matchFail("src/check/purity.pf", 892);
      })($field(Compat, "uncons")(entries));
    }
    function checkFmtParts(st, ctx, parts) {
      return (($match$927) => {
        if ($match$927.$t === "None") {
          return st;
        }
        if ($match$927.$t === "Some") {
          const cell = $match$927;
          return (() => {
            const p = cell.f[0].f[0];
            return (($match$938) => {
              if ($match$938.$t === "FmtLit") {
                return checkFmtParts(st, ctx, cell.f[0].f[1]);
              }
              if ($match$938.$t === "FmtExpr") {
                const f = $match$938;
                return checkFmtParts(checkExpr(st, ctx, f.f[0]), ctx, cell.f[0].f[1]);
              }
              throw $matchFail("src/check/purity.pf", 938);
            })(p);
          })();
        }
        throw $matchFail("src/check/purity.pf", 927);
      })($field(Compat, "uncons")(parts));
    }
    function checkCall(st, ctx, expr) {
      return (($match$962) => {
        if ($match$962.$t === "ECall") {
          const c = $match$962;
          return (() => {
            const st1 = checkExpr(st, ctx, c.f[1]);
            const st2 = exprIsProc(st1, c.f[1]) && !ctxAllowsEffects(ctx) ? (() => {
              return procCallDiag(st1, c.f[3], nameOfNamedExpr(c.f[1]));
            })() : (() => {
              return st1;
            })();
            return checkExprList(st2, ctx, c.f[2]);
          })();
        }
        if (true) {
          return st;
        }
        throw $matchFail("src/check/purity.pf", 962);
      })(expr);
    }
    function checkPipe(st, ctx, lhs, rhs, span) {
      const st1 = checkExpr(st, ctx, lhs);
      const st2 = checkExpr(st1, ctx, rhs);
      if (exprIsProc(st2, rhs) && !ctxAllowsEffects(ctx)) {
        return procCallDiag(st2, span, nameOfNamedExpr(rhs));
      } else {
        return st2;
      }
    }
    function checkCompGens(st, ctx, gens) {
      return (($match$1041) => {
        if ($match$1041.$t === "None") {
          return st;
        }
        if ($match$1041.$t === "Some") {
          const cell = $match$1041;
          return (() => {
            const g = cell.f[0].f[0];
            const st1 = checkExpr(st, ctx, $field(g, "source"));
            const st2 = bindName(st1, $field(g, "gvar"), NKValue);
            return checkCompGens(st2, ctx, cell.f[0].f[1]);
          })();
        }
        throw $matchFail("src/check/purity.pf", 1041);
      })($field(Compat, "uncons")(gens));
    }
    function checkComprehension(st, ctx, body, gens, guard, mode) {
      const oldEnv = st.f[1];
      const compCtx = pureContextForLazy(mode, ctx);
      const st1 = checkCompGens(st, compCtx, gens);
      const st2 = checkExpr(st1, compCtx, body);
      const st3 = (($match$1096) => {
        if ($match$1096.$t === "Some") {
          const g = $match$1096;
          return checkExpr(st2, compCtx, g.f[0]);
        }
        if ($match$1096.$t === "None") {
          return st2;
        }
        throw $matchFail("src/check/purity.pf", 1096);
      })(guard);
      return withEnv(st3, oldEnv);
    }
    function bindPatElem(st, elem) {
      return (($match$1112) => {
        if ($match$1112.$t === "PeBind") {
          const p = $match$1112;
          return bindName(st, p.f[0], NKValue);
        }
        if ($match$1112.$t === "PeWild") {
          return st;
        }
        throw $matchFail("src/check/purity.pf", 1112);
      })(elem);
    }
    function bindPatElems(st, elems) {
      while (true) {
        const $match$1123 = $field(Compat, "uncons")(elems);
        if ($match$1123.$t === "None") {
          return st;
        }
        if ($match$1123.$t === "Some") {
          const cell = $match$1123;
          const $tc$1139$0 = bindPatElem(st, cell.f[0].f[0]);
          const $tc$1139$1 = cell.f[0].f[1];
          st = $tc$1139$0;
          elems = $tc$1139$1;
          continue;
        }
        throw $matchFail("src/check/purity.pf", 1123);
      }
    }
    function bindPattern(st, pattern) {
      return (($match$1142) => {
        if ($match$1142.$t === "PWild") {
          return st;
        }
        if ($match$1142.$t === "PVariant") {
          const p = $match$1142;
          return (() => {
            return (($match$1146) => {
              if ($match$1146.$t === "Some") {
                const b = $match$1146;
                return bindName(st, b.f[0], NKValue);
              }
              if ($match$1146.$t === "None") {
                return st;
              }
              throw $matchFail("src/check/purity.pf", 1146);
            })(p.f[1]);
          })();
        }
        if ($match$1142.$t === "PList") {
          const p = $match$1142;
          return (() => {
            const st1 = bindPatElems(st, p.f[0]);
            return (($match$1164) => {
              if ($match$1164.$t === "Some") {
                const r = $match$1164;
                return bindPatElem(st1, r.f[0]);
              }
              if ($match$1164.$t === "None") {
                return st1;
              }
              throw $matchFail("src/check/purity.pf", 1164);
            })(p.f[1]);
          })();
        }
        throw $matchFail("src/check/purity.pf", 1142);
      })(pattern);
    }
    function checkArm(st, ctx, arm) {
      const oldEnv = st.f[1];
      const st1 = bindPattern(st, $field(arm, "pattern"));
      const st2 = (($match$1185) => {
        if ($match$1185.$t === "Some") {
          const g = $match$1185;
          return checkExpr(st1, ctx, g.f[0]);
        }
        if ($match$1185.$t === "None") {
          return st1;
        }
        throw $matchFail("src/check/purity.pf", 1185);
      })($field(arm, "guard"));
      const st3 = checkExpr(st2, ctx, $field(arm, "body"));
      return withEnv(st3, oldEnv);
    }
    function checkArms(st, ctx, arms) {
      while (true) {
        const $match$1209 = $field(Compat, "uncons")(arms);
        if ($match$1209.$t === "None") {
          return st;
        }
        if ($match$1209.$t === "Some") {
          const cell = $match$1209;
          const $tc$1227$0 = checkArm(st, ctx, cell.f[0].f[0]);
          const $tc$1227$1 = ctx;
          const $tc$1227$2 = cell.f[0].f[1];
          st = $tc$1227$0;
          ctx = $tc$1227$1;
          arms = $tc$1227$2;
          continue;
        }
        throw $matchFail("src/check/purity.pf", 1209);
      }
    }
    function checkExpr(st, ctx, expr) {
      while (true) {
        const $match$1230 = expr;
        if ($match$1230.$t === "EInt") {
          return st;
        }
        if ($match$1230.$t === "EFloat") {
          return st;
        }
        if ($match$1230.$t === "EBool") {
          return st;
        }
        if ($match$1230.$t === "EStr") {
          return st;
        }
        if ($match$1230.$t === "EChar") {
          return st;
        }
        if ($match$1230.$t === "EByte") {
          return st;
        }
        if ($match$1230.$t === "EVar") {
          return checkNamedValueUse(st, ctx, expr);
        }
        if ($match$1230.$t === "EUnary") {
          const e = $match$1230;
          const $tc$1248$0 = st;
          const $tc$1248$1 = ctx;
          const $tc$1248$2 = e.f[2];
          st = $tc$1248$0;
          ctx = $tc$1248$1;
          expr = $tc$1248$2;
          continue;
        }
        if ($match$1230.$t === "EBinary") {
          const e = $match$1230;
          return (() => {
            if (e.f[1] === "|>") {
              return checkPipe(st, ctx, e.f[2], e.f[3], e.f[4]);
            } else {
              const st1 = checkExpr(st, ctx, e.f[2]);
              return checkExpr(st1, ctx, e.f[3]);
            }
          })();
        }
        if ($match$1230.$t === "EIf") {
          const e = $match$1230;
          return (() => {
            const st1 = checkExpr(st, ctx, e.f[1]);
            const st2 = checkExpr(st1, ctx, e.f[2]);
            return checkExpr(st2, ctx, e.f[3]);
          })();
        }
        if ($match$1230.$t === "ECall") {
          return checkCall(st, ctx, expr);
        }
        if ($match$1230.$t === "ELambda") {
          const e = $match$1230;
          return checkLambda(st, e.f[1], e.f[2]);
        }
        if ($match$1230.$t === "EProcLambda") {
          const e = $match$1230;
          return checkProcLambda(st, e.f[1], e.f[3], e.f[4]);
        }
        if ($match$1230.$t === "EBlock") {
          const e = $match$1230;
          return checkScopedStmtList(st, ctx, e.f[1]);
        }
        if ($match$1230.$t === "EList") {
          const e = $match$1230;
          return checkExprList(st, pureContextForLazy(e.f[2], ctx), e.f[1]);
        }
        if ($match$1230.$t === "EComp") {
          const e = $match$1230;
          return checkComprehension(st, ctx, e.f[1], e.f[2], e.f[3], e.f[4]);
        }
        if ($match$1230.$t === "ERecord") {
          const e = $match$1230;
          return checkFieldExprs(st, ctx, e.f[2]);
        }
        if ($match$1230.$t === "EField") {
          return checkNamedValueUse(st, ctx, expr);
        }
        if ($match$1230.$t === "EIndex") {
          const e = $match$1230;
          return (() => {
            const st1 = checkExpr(st, ctx, e.f[1]);
            return checkExpr(st1, ctx, e.f[2]);
          })();
        }
        if ($match$1230.$t === "EMatch") {
          const e = $match$1230;
          return (() => {
            const st1 = checkExpr(st, ctx, e.f[1]);
            return checkArms(st1, ctx, e.f[2]);
          })();
        }
        if ($match$1230.$t === "EDict") {
          const e = $match$1230;
          return checkDictEntries(st, ctx, e.f[1]);
        }
        if ($match$1230.$t === "EArray") {
          const e = $match$1230;
          return checkExprList(st, ctx, e.f[1]);
        }
        if ($match$1230.$t === "EAwait") {
          const e = $match$1230;
          return (() => {
            const st1 = ctxAllowsAwait(ctx) ? st : addDiag(st, e.f[2], "await is only allowed inside async proc bodies.");
            return checkExpr(st1, ctx, e.f[1]);
          })();
        }
        if ($match$1230.$t === "EFmt") {
          const e = $match$1230;
          return checkFmtParts(st, ctx, e.f[1]);
        }
        throw $matchFail("src/check/purity.pf", 1230);
      }
    }
    function checkLambda(st, params, body) {
      const oldEnv = st.f[1];
      const st1 = bindParams(st, params);
      const st2 = checkExpr(st1, CtxPure, body);
      return withEnv(st2, oldEnv);
    }
    function typedParamNames(params) {
      return $map((param) => $field(param, "name"), params);
    }
    function checkProcLambda(st, params, body, isAsync) {
      const oldEnv = st.f[1];
      const st1 = bindParams(st, typedParamNames(params));
      const st2 = checkScopedStmtList(st1, $makeVariant("CtxProc", "PurityCtx", ["isAsync"], [isAsync]), body);
      return withEnv(st2, oldEnv);
    }
    function checkMaybeExpr(st, ctx, value) {
      return (($match$1483) => {
        if ($match$1483.$t === "Some") {
          const v = $match$1483;
          return checkExpr(st, ctx, v.f[0]);
        }
        if ($match$1483.$t === "None") {
          return st;
        }
        throw $matchFail("src/check/purity.pf", 1483);
      })(value);
    }
    function checkPureOnlyStmt(st, ctx, span, message) {
      if (ctxAllowsEffects(ctx)) {
        return st;
      } else {
        return addDiag(st, span, message);
      }
    }
    function ctxForFnKind(kind) {
      return (($match$1507) => {
        if ($match$1507.$t === "PureFn") {
          return CtxPure;
        }
        if ($match$1507.$t === "ProcFn") {
          const p = $match$1507;
          return $makeVariant("CtxProc", "PurityCtx", ["isAsync"], [p.f[0]]);
        }
        throw $matchFail("src/check/purity.pf", 1507);
      })(kind);
    }
    function checkFunctionBody(st, kind, params, body) {
      const oldEnv = st.f[1];
      const st1 = bindParams(st, params);
      const st2 = checkScopedStmtList(st1, ctxForFnKind(kind), body);
      return withEnv(st2, oldEnv);
    }
    function checkStmt(st, ctx, stmt) {
      while (true) {
        const $match$1537 = stmt;
        if ($match$1537.$t === "SLet") {
          const s = $match$1537;
          return checkExpr(st, ctx, s.f[2]);
        }
        if ($match$1537.$t === "SVar") {
          const s = $match$1537;
          return (() => {
            const st1 = checkPureOnlyStmt(st, ctx, s.f[3], "var bindings are not allowed in pure functions or fn lambdas.");
            return checkExpr(st1, ctx, s.f[2]);
          })();
        }
        if ($match$1537.$t === "SAssign") {
          const s = $match$1537;
          return (() => {
            const st1 = checkPureOnlyStmt(st, ctx, s.f[3], "Assignment is not allowed in pure functions or fn lambdas.");
            return checkExpr(st1, ctx, s.f[2]);
          })();
        }
        if ($match$1537.$t === "SIndexAssign") {
          const s = $match$1537;
          return (() => {
            const st1 = checkPureOnlyStmt(st, ctx, s.f[4], "Index assignment is not allowed in pure functions or fn lambdas.");
            const st2 = checkExpr(st1, ctx, s.f[1]);
            const st3 = checkExpr(st2, ctx, s.f[2]);
            return checkExpr(st3, ctx, s.f[3]);
          })();
        }
        if ($match$1537.$t === "SFun") {
          const s = $match$1537;
          return checkFunctionBody(st, s.f[4], s.f[2], s.f[3]);
        }
        if ($match$1537.$t === "SType") {
          return st;
        }
        if ($match$1537.$t === "SExpr") {
          const s = $match$1537;
          return checkExpr(st, ctx, s.f[1]);
        }
        if ($match$1537.$t === "SReturn") {
          const s = $match$1537;
          return checkMaybeExpr(st, ctx, s.f[1]);
        }
        if ($match$1537.$t === "SIf") {
          const s = $match$1537;
          return (() => {
            const st1 = checkExpr(st, ctx, s.f[1]);
            const st2 = checkScopedStmtList(st1, ctx, s.f[2]);
            return (($match$1644) => {
              if ($match$1644.$t === "Some") {
                const e = $match$1644;
                return checkScopedStmtList(st2, ctx, e.f[0]);
              }
              if ($match$1644.$t === "None") {
                return st2;
              }
              throw $matchFail("src/check/purity.pf", 1644);
            })(s.f[3]);
          })();
        }
        if ($match$1537.$t === "SWhile") {
          const s = $match$1537;
          return (() => {
            const st1 = checkPureOnlyStmt(st, ctx, s.f[3], "while loops are not allowed in pure functions or fn lambdas.");
            const st2 = checkExpr(st1, ctx, s.f[1]);
            return checkScopedStmtList(st2, ctx, s.f[2]);
          })();
        }
        if ($match$1537.$t === "SImport") {
          return st;
        }
        if ($match$1537.$t === "SExport") {
          const s = $match$1537;
          const $tc$1684$0 = st;
          const $tc$1684$1 = ctx;
          const $tc$1684$2 = s.f[1];
          st = $tc$1684$0;
          ctx = $tc$1684$1;
          stmt = $tc$1684$2;
          continue;
        }
        if ($match$1537.$t === "SExtern") {
          return st;
        }
        throw $matchFail("src/check/purity.pf", 1537);
      }
    }
    function checkStmtListLoop(st, ctx, stmts) {
      while (true) {
        const $match$1688 = $field(Compat, "uncons")(stmts);
        if ($match$1688.$t === "None") {
          return st;
        }
        if ($match$1688.$t === "Some") {
          const cell = $match$1688;
          const $tc$1706$0 = checkStmt(st, ctx, cell.f[0].f[0]);
          const $tc$1706$1 = ctx;
          const $tc$1706$2 = cell.f[0].f[1];
          st = $tc$1706$0;
          ctx = $tc$1706$1;
          stmts = $tc$1706$2;
          continue;
        }
        throw $matchFail("src/check/purity.pf", 1688);
      }
    }
    function checkScopedStmtList(st, ctx, stmts) {
      const oldEnv = st.f[1];
      const st1 = prebindLocalDecls(st, stmts);
      const st2 = checkStmtListLoop(st1, ctx, stmts);
      return withEnv(st2, oldEnv);
    }
    function bindModuleNames(ast, deps, types) {
      const st0 = mkState($field(ast, "path"), $field(IMS, "imsEmpty")(), types, []);
      const st1 = bindImportStmts(st0, $field(ast, "stmts"), deps);
      return prebindLocalDecls(st1, $field(ast, "stmts"));
    }
    function checkModule(ast, deps, types) {
      const st0 = bindModuleNames(ast, deps, types);
      const st1 = checkStmtListLoop(st0, CtxTop, $field(ast, "stmts"));
      return mkPurityResult($reverse(st1.f[3]));
    }
    function checkPurity(ast, deps, types) {
      return checkModule(ast, deps, types);
    }
    exports["NKValue"] = NKValue;
    exports["NKFunction"] = NKFunction;
    exports["NKProc"] = NKProc;
    exports["NKType"] = NKType;
    exports["NKNamespace"] = NKNamespace;
    exports["CtxPure"] = CtxPure;
    exports["CtxProc"] = CtxProc;
    exports["CtxTop"] = CtxTop;
    exports["nkValue"] = nkValue;
    exports["nkFunction"] = nkFunction;
    exports["nkProc"] = nkProc;
    exports["nkType"] = nkType;
    exports["nkNamespace"] = nkNamespace;
    exports["ctxPure"] = ctxPure;
    exports["ctxProc"] = ctxProc;
    exports["ctxTop"] = ctxTop;
    exports["mkPurityResult"] = mkPurityResult;
    exports["checkModule"] = checkModule;
    exports["checkPurity"] = checkPurity;
  });
  $registerSchemas([{name: "ExhaustResult", union: null, fields: ["diags"], variant: false}, {name: "SubjectUnion", union: "SubjectKind", fields: ["tname", "variants"], variant: true}, {name: "SubjectList", union: "SubjectKind", fields: [], variant: true}, {name: "SubjectOther", union: "SubjectKind", fields: [], variant: true}, {name: "SubjectUnknown", union: "SubjectKind", fields: [], variant: true}, {name: "ExSt", union: null, fields: ["path", "unions", "diags"], variant: false}, {name: "UnionCov", union: null, fields: ["seen", "wildcard"], variant: false}, {name: "ListCov", union: null, fields: ["exact", "restStart", "wildcard"], variant: false}]);
  $maps["src/check/exhaust"] = {"../syntax/ast": "src/syntax/ast", "./diag": "src/check/diag", "./iface": "src/check/iface", "./types": "src/check/types", "../data/imaps": "src/data/imaps", "../data/imapi": "src/data/imapi", "../compat": "src/compat"};
  $mods["src/check/exhaust"] = ((exports, $require) => {
    const A = $require("../syntax/ast");
    const D = $require("./diag");
    const I = $require("./iface");
    const TY = $require("./types");
    const IMS = $require("../data/imaps");
    const IMI = $require("../data/imapi");
    const Compat = $require("../compat");
    function SubjectUnion(tname, variants) {
      return $makeVariant("SubjectUnion", "SubjectKind", ["tname", "variants"], [tname, variants]);
    }
    const SubjectList = $makeVariant("SubjectList", "SubjectKind", [], []);
    const SubjectOther = $makeVariant("SubjectOther", "SubjectKind", [], []);
    const SubjectUnknown = $makeVariant("SubjectUnknown", "SubjectKind", [], []);
    function mkExhaustResult(diags) {
      return $makeRecord("ExhaustResult", ["diags"], [diags]);
    }
    function subjectUnion(tname, variants) {
      return $makeVariant("SubjectUnion", "SubjectKind", ["tname", "variants"], [tname, variants]);
    }
    function subjectList() {
      return SubjectList;
    }
    function subjectOther() {
      return SubjectOther;
    }
    function subjectUnknown() {
      return SubjectUnknown;
    }
    function mkState(path, unions, diags) {
      return $makeRecord("ExSt", ["path", "unions", "diags"], [path, unions, diags]);
    }
    function withUnions(st, unions) {
      return $makeRecord("ExSt", ["path", "unions", "diags"], [st.f[0], unions, st.f[2]]);
    }
    function withDiags(st, diags) {
      return $makeRecord("ExSt", ["path", "unions", "diags"], [st.f[0], st.f[1], diags]);
    }
    function addDiag(st, span, message) {
      return withDiags(st, $cons($field(D, "err")($makeVariant("ExhaustD", "DiagCode", [], []), message, st.f[0], span), st.f[2]));
    }
    function unionCov(seen, wildcard) {
      return $makeRecord("UnionCov", ["seen", "wildcard"], [seen, wildcard]);
    }
    function listCov(exact, restStart, wildcard) {
      return $makeRecord("ListCov", ["exact", "restStart", "wildcard"], [exact, restStart, wildcard]);
    }
    function appendList(a, b) {
      return $reduce((acc, x) => $cons(x, acc), b, $reverse(a));
    }
    function strContains(xs, s) {
      return (($match$101) => {
        if ($match$101.$t === "None") {
          return false;
        }
        if ($match$101.$t === "Some") {
          const cell = $match$101;
          return (() => {
            const p = cell.f[0];
            if (p.f[0] === s) {
              return true;
            } else {
              return strContains(p.f[1], s);
            }
          })();
        }
        throw $matchFail("src/check/exhaust.pf", 101);
      })($field(Compat, "uncons")(xs));
    }
    function strAdd(xs, s) {
      if (strContains(xs, s)) {
        return xs;
      } else {
        return $cons(s, xs);
      }
    }
    function intContains(xs, n) {
      return (($match$139) => {
        if ($match$139.$t === "None") {
          return false;
        }
        if ($match$139.$t === "Some") {
          const cell = $match$139;
          return (() => {
            const p = cell.f[0];
            if ($eqI(p.f[0], n)) {
              return true;
            } else {
              return intContains(p.f[1], n);
            }
          })();
        }
        throw $matchFail("src/check/exhaust.pf", 139);
      })($field(Compat, "uncons")(xs));
    }
    function intAdd(xs, n) {
      if (intContains(xs, n)) {
        return xs;
      } else {
        return $cons(n, xs);
      }
    }
    function maybeMin(a, b) {
      return (($match$177) => {
        if ($match$177.$t === "None") {
          return b;
        }
        if ($match$177.$t === "Some") {
          const av = $match$177;
          return (() => {
            return (($match$181) => {
              if ($match$181.$t === "None") {
                return a;
              }
              if ($match$181.$t === "Some") {
                const bv = $match$181;
                return (() => {
                  if ($leI(av.f[0], bv.f[0])) {
                    return a;
                  } else {
                    return b;
                  }
                })();
              }
              throw $matchFail("src/check/exhaust.pf", 181);
            })(b);
          })();
        }
        throw $matchFail("src/check/exhaust.pf", 177);
      })(a);
    }
    function variantNameList(variants) {
      return $map((v) => $field(v, "vname"), variants);
    }
    function variantNameExists(variants, name) {
      return strContains(variantNameList(variants), name);
    }
    function missingVariantNames(variants, seen) {
      return missingVariantNamesLoop(variants, seen, []);
    }
    function missingVariantNamesLoop(variants, seen, acc) {
      return (($match$221) => {
        if ($match$221.$t === "None") {
          return $reverse(acc);
        }
        if ($match$221.$t === "Some") {
          const cell = $match$221;
          return (() => {
            const v = cell.f[0].f[0];
            const rest = cell.f[0].f[1];
            if (strContains(seen, $field(v, "vname"))) {
              return missingVariantNamesLoop(rest, seen, acc);
            } else {
              return missingVariantNamesLoop(rest, seen, $cons($field(v, "vname"), acc));
            }
          })();
        }
        throw $matchFail("src/check/exhaust.pf", 221);
      })($field(Compat, "uncons")(variants));
    }
    function quotedNames(names) {
      return $join($map((n) => $concatS($concatS("'", n), "'"), names), ", ");
    }
    function addUnion(st, name, variants) {
      return withUnions(st, $field(IMS, "imsPut")(st.f[1], name, variants));
    }
    function addIfaceUnionEntries(st, entries) {
      return (($match$288) => {
        if ($match$288.$t === "None") {
          return st;
        }
        if ($match$288.$t === "Some") {
          const cell = $match$288;
          return (() => {
            const p = cell.f[0].f[0];
            const st1 = addUnion(st, $field(p, "key"), $field(p, "value"));
            return addIfaceUnionEntries(st1, cell.f[0].f[1]);
          })();
        }
        throw $matchFail("src/check/exhaust.pf", 288);
      })($field(Compat, "uncons")(entries));
    }
    function addDepIface(st, iface) {
      return addIfaceUnionEntries(st, $field(IMS, "imsEntries")($field(iface, "unions")));
    }
    function addDepIfaces(st, entries) {
      return (($match$326) => {
        if ($match$326.$t === "None") {
          return st;
        }
        if ($match$326.$t === "Some") {
          const cell = $match$326;
          return (() => {
            const p = cell.f[0].f[0];
            return addDepIfaces(addDepIface(st, $field(p, "value")), cell.f[0].f[1]);
          })();
        }
        throw $matchFail("src/check/exhaust.pf", 326);
      })($field(Compat, "uncons")(entries));
    }
    function addTypeDeclUnions(st, decl) {
      return (($match$350) => {
        if ($match$350.$t === "RecordDecl") {
          return st;
        }
        if ($match$350.$t === "UnionDecl") {
          const u = $match$350;
          return addUnion(st, u.f[0], u.f[1]);
        }
        throw $matchFail("src/check/exhaust.pf", 350);
      })(decl);
    }
    function addLocalUnionsFromStmt(st, stmt) {
      while (true) {
        const $match$362 = stmt;
        if ($match$362.$t === "SType") {
          const s = $match$362;
          return addTypeDeclUnions(st, s.f[1]);
        }
        if ($match$362.$t === "SExport") {
          const e = $match$362;
          const $tc$373$0 = st;
          const $tc$373$1 = e.f[1];
          st = $tc$373$0;
          stmt = $tc$373$1;
          continue;
        }
        if (true) {
          return st;
        }
        throw $matchFail("src/check/exhaust.pf", 362);
      }
    }
    function addLocalUnions(st, stmts) {
      while (true) {
        const $match$377 = $field(Compat, "uncons")(stmts);
        if ($match$377.$t === "None") {
          return st;
        }
        if ($match$377.$t === "Some") {
          const cell = $match$377;
          const $tc$393$0 = addLocalUnionsFromStmt(st, cell.f[0].f[0]);
          const $tc$393$1 = cell.f[0].f[1];
          st = $tc$393$0;
          stmts = $tc$393$1;
          continue;
        }
        throw $matchFail("src/check/exhaust.pf", 377);
      }
    }
    function initialState(ast, deps) {
      const st0 = mkState($field(ast, "path"), $field(IMS, "imsEmpty")(), []);
      const st1 = addDepIfaces(st0, $field(IMS, "imsEntries")(deps));
      return addLocalUnions(st1, $field(ast, "stmts"));
    }
    function lookupNodeType(infer, id) {
      return $field(IMI, "imiGet")($field(infer, "types"), id);
    }
    function lookupExprType(infer, expr) {
      return lookupNodeType(infer, $field(A, "exprId")(expr));
    }
    function subjectKindFromType(st, typ) {
      return (($match$437) => {
        if ($match$437.$t === "TNamed") {
          const n = $match$437;
          return (() => {
            return (($match$440) => {
              if ($match$440.$t === "Some") {
                const variants = $match$440;
                return $makeVariant("SubjectUnion", "SubjectKind", ["tname", "variants"], [n.f[0], variants.f[0]]);
              }
              if ($match$440.$t === "None") {
                return SubjectOther;
              }
              throw $matchFail("src/check/exhaust.pf", 440);
            })($field(IMS, "imsGet")(st.f[1], n.f[0]));
          })();
        }
        if ($match$437.$t === "TVariant") {
          const v = $match$437;
          return (() => {
            return (($match$456) => {
              if ($match$456.$t === "Some") {
                const variants = $match$456;
                return $makeVariant("SubjectUnion", "SubjectKind", ["tname", "variants"], [v.f[1], variants.f[0]]);
              }
              if ($match$456.$t === "None") {
                return SubjectOther;
              }
              throw $matchFail("src/check/exhaust.pf", 456);
            })($field(IMS, "imsGet")(st.f[1], v.f[1]));
          })();
        }
        if ($match$437.$t === "TList") {
          return SubjectList;
        }
        if ($match$437.$t === "TUnknown") {
          return SubjectUnknown;
        }
        if ($match$437.$t === "TAny") {
          return SubjectUnknown;
        }
        if ($match$437.$t === "TVar") {
          return SubjectUnknown;
        }
        if (true) {
          return SubjectOther;
        }
        throw $matchFail("src/check/exhaust.pf", 437);
      })(typ);
    }
    function subjectKindOf(st, infer, expr) {
      return (($match$478) => {
        if ($match$478.$t === "None") {
          return SubjectUnknown;
        }
        if ($match$478.$t === "Some") {
          const t = $match$478;
          return subjectKindFromType(st, t.f[0]);
        }
        throw $matchFail("src/check/exhaust.pf", 478);
      })(lookupExprType(infer, expr));
    }
    function isGuarded(arm) {
      return (($match$491) => {
        if ($match$491.$t === "Some") {
          return true;
        }
        if ($match$491.$t === "None") {
          return false;
        }
        throw $matchFail("src/check/exhaust.pf", 491);
      })($field(arm, "guard"));
    }
    function unionArmCoverage(st, variants, cov, arm) {
      if (isGuarded(arm)) {
        return $makeRecord("Pair", ["key", "value"], [st, cov]);
      } else {
        return (($match$505) => {
          if ($match$505.$t === "PWild") {
            return $makeRecord("Pair", ["key", "value"], [st, unionCov(cov.f[0], true)]);
          }
          if ($match$505.$t === "PVariant") {
            const p = $match$505;
            return (() => {
              if (variantNameExists(variants, p.f[0])) {
                return $makeRecord("Pair", ["key", "value"], [st, unionCov(strAdd(cov.f[0], p.f[0]), cov.f[1])]);
              } else {
                const st1 = addDiag(st, $field(A, "exprSpan")($field(arm, "body")), $concatS($concatS("Pattern '", p.f[0]), "' is not a variant of this union."));
                return $makeRecord("Pair", ["key", "value"], [st1, cov]);
              }
            })();
          }
          if ($match$505.$t === "PList") {
            return (() => {
              const st1 = addDiag(st, $field(A, "exprSpan")($field(arm, "body")), "List pattern cannot cover a union value.");
              return $makeRecord("Pair", ["key", "value"], [st1, cov]);
            })();
          }
          throw $matchFail("src/check/exhaust.pf", 505);
        })($field(arm, "pattern"));
      }
    }
    function unionCoverageLoop(st, variants, arms, cov) {
      return (($match$572) => {
        if ($match$572.$t === "None") {
          return $makeRecord("Pair", ["key", "value"], [st, cov]);
        }
        if ($match$572.$t === "Some") {
          const cell = $match$572;
          return (() => {
            const out = unionArmCoverage(st, variants, cov, cell.f[0].f[0]);
            return unionCoverageLoop(out.f[0], variants, cell.f[0].f[1], out.f[1]);
          })();
        }
        throw $matchFail("src/check/exhaust.pf", 572);
      })($field(Compat, "uncons")(arms));
    }
    function checkUnionCoverage(st, span, tname, variants, arms) {
      const out = unionCoverageLoop(st, variants, arms, unionCov([], false));
      const st1 = out.f[0];
      const cov = out.f[1];
      if (cov.f[1]) {
        return st1;
      } else {
        const missing = missingVariantNames(variants, cov.f[0]);
        if ($eqI($length(missing), 0)) {
          return st1;
        } else {
          return addDiag(st1, span, $concatS($concatS($concatS($concatS("Non-exhaustive match on '", tname), "': missing unguarded arm(s) for "), quotedNames(missing)), "."));
        }
      }
    }
    function patternListMinLength(pattern) {
      return (($match$655) => {
        if ($match$655.$t === "PList") {
          const p = $match$655;
          return $length(p.f[0]);
        }
        if (true) {
          return 0;
        }
        throw $matchFail("src/check/exhaust.pf", 655);
      })(pattern);
    }
    function listArmCoverage(st, cov, arm) {
      if (isGuarded(arm)) {
        return $makeRecord("Pair", ["key", "value"], [st, cov]);
      } else {
        return (($match$671) => {
          if ($match$671.$t === "PWild") {
            return $makeRecord("Pair", ["key", "value"], [st, listCov(cov.f[0], cov.f[1], true)]);
          }
          if ($match$671.$t === "PList") {
            const p = $match$671;
            return (() => {
              const n = $length(p.f[0]);
              return (($match$689) => {
                if ($match$689.$t === "Some") {
                  return $makeRecord("Pair", ["key", "value"], [st, listCov(cov.f[0], maybeMin(cov.f[1], $makeVariant("Some", "Option", ["value"], [n])), cov.f[2])]);
                }
                if ($match$689.$t === "None") {
                  return $makeRecord("Pair", ["key", "value"], [st, listCov(intAdd(cov.f[0], n), cov.f[1], cov.f[2])]);
                }
                throw $matchFail("src/check/exhaust.pf", 689);
              })(p.f[1]);
            })();
          }
          if ($match$671.$t === "PVariant") {
            const p = $match$671;
            return (() => {
              const st1 = addDiag(st, $field(A, "exprSpan")($field(arm, "body")), $concatS($concatS("Variant pattern '", p.f[0]), "' cannot cover a list value."));
              return $makeRecord("Pair", ["key", "value"], [st1, cov]);
            })();
          }
          throw $matchFail("src/check/exhaust.pf", 671);
        })($field(arm, "pattern"));
      }
    }
    function listCoverageLoop(st, arms, cov) {
      return (($match$743) => {
        if ($match$743.$t === "None") {
          return $makeRecord("Pair", ["key", "value"], [st, cov]);
        }
        if ($match$743.$t === "Some") {
          const cell = $match$743;
          return (() => {
            const out = listArmCoverage(st, cov, cell.f[0].f[0]);
            return listCoverageLoop(out.f[0], cell.f[0].f[1], out.f[1]);
          })();
        }
        throw $matchFail("src/check/exhaust.pf", 743);
      })($field(Compat, "uncons")(arms));
    }
    function coveredByRest(restStart, n) {
      return (($match$772) => {
        if ($match$772.$t === "None") {
          return false;
        }
        if ($match$772.$t === "Some") {
          const r = $match$772;
          return $geI(n, r.f[0]);
        }
        throw $matchFail("src/check/exhaust.pf", 772);
      })(restStart);
    }
    function smallestMissingLengthFrom(n, exact, restStart) {
      while (true) {
        if (coveredByRest(restStart, n)) {
          return $makeVariant("None", "Option", [], []);
        } else {
          if (intContains(exact, n)) {
            const $tc$797$0 = $addI(n, 1);
            const $tc$797$1 = exact;
            const $tc$797$2 = restStart;
            n = $tc$797$0;
            exact = $tc$797$1;
            restStart = $tc$797$2;
            continue;
          } else {
            return $makeVariant("Some", "Option", ["value"], [n]);
          }
        }
      }
    }
    function checkListCoverage(st, span, arms) {
      const out = listCoverageLoop(st, arms, listCov([], $makeVariant("None", "Option", [], []), false));
      const st1 = out.f[0];
      const cov = out.f[1];
      if (cov.f[2]) {
        return st1;
      } else {
        return (($match$825) => {
          if ($match$825.$t === "None") {
            return st1;
          }
          if ($match$825.$t === "Some") {
            const n = $match$825;
            return addDiag(st1, span, $concatS($concatS("Non-exhaustive match on list: missing unguarded coverage for length ", $str(n.f[0])), "."));
          }
          throw $matchFail("src/check/exhaust.pf", 825);
        })(smallestMissingLengthFrom(0, cov.f[0], cov.f[1]));
      }
    }
    function patternIsFallback(pattern) {
      return (($match$849) => {
        if ($match$849.$t === "PWild") {
          return true;
        }
        if ($match$849.$t === "PVariant") {
          const p = $match$849;
          return (() => {
            return (($match$853) => {
              if ($match$853.$t === "None") {
                return true;
              }
              if ($match$853.$t === "Some") {
                return false;
              }
              throw $matchFail("src/check/exhaust.pf", 853);
            })(p.f[1]);
          })();
        }
        if ($match$849.$t === "PList") {
          return false;
        }
        throw $matchFail("src/check/exhaust.pf", 849);
      })(pattern);
    }
    function hasUnguardedFallback(arms) {
      return (($match$862) => {
        if ($match$862.$t === "None") {
          return false;
        }
        if ($match$862.$t === "Some") {
          const cell = $match$862;
          return (() => {
            const arm = cell.f[0].f[0];
            if (isGuarded(arm)) {
              return hasUnguardedFallback(cell.f[0].f[1]);
            } else {
              if (patternIsFallback($field(arm, "pattern"))) {
                return true;
              } else {
                return hasUnguardedFallback(cell.f[0].f[1]);
              }
            }
          })();
        }
        throw $matchFail("src/check/exhaust.pf", 862);
      })($field(Compat, "uncons")(arms));
    }
    function checkOtherCoverage(st, span, arms) {
      if (hasUnguardedFallback(arms)) {
        return st;
      } else {
        return addDiag(st, span, "Non-exhaustive match: add an unguarded fallback wildcard or binding arm.");
      }
    }
    function checkUnknownCoverage(st, span, arms) {
      return checkOtherCoverage(st, span, arms);
    }
    function checkMatchCoverage(st, infer, subject, arms, span) {
      return (($match$918) => {
        if ($match$918.$t === "SubjectUnion") {
          const s = $match$918;
          return checkUnionCoverage(st, span, s.f[0], s.f[1], arms);
        }
        if ($match$918.$t === "SubjectList") {
          return checkListCoverage(st, span, arms);
        }
        if ($match$918.$t === "SubjectOther") {
          return checkOtherCoverage(st, span, arms);
        }
        if ($match$918.$t === "SubjectUnknown") {
          return checkUnknownCoverage(st, span, arms);
        }
        throw $matchFail("src/check/exhaust.pf", 918);
      })(subjectKindOf(st, infer, subject));
    }
    function checkExprList(st, infer, exprs) {
      while (true) {
        const $match$950 = $field(Compat, "uncons")(exprs);
        if ($match$950.$t === "None") {
          return st;
        }
        if ($match$950.$t === "Some") {
          const cell = $match$950;
          const $tc$968$0 = checkExpr(st, infer, cell.f[0].f[0]);
          const $tc$968$1 = infer;
          const $tc$968$2 = cell.f[0].f[1];
          st = $tc$968$0;
          infer = $tc$968$1;
          exprs = $tc$968$2;
          continue;
        }
        throw $matchFail("src/check/exhaust.pf", 950);
      }
    }
    function checkFields(st, infer, fields) {
      return (($match$971) => {
        if ($match$971.$t === "None") {
          return st;
        }
        if ($match$971.$t === "Some") {
          const cell = $match$971;
          return (() => {
            const f = cell.f[0].f[0];
            return checkFields(checkExpr(st, infer, $field(f, "value")), infer, cell.f[0].f[1]);
          })();
        }
        throw $matchFail("src/check/exhaust.pf", 971);
      })($field(Compat, "uncons")(fields));
    }
    function checkDictEntries(st, infer, entries) {
      return (($match$997) => {
        if ($match$997.$t === "None") {
          return st;
        }
        if ($match$997.$t === "Some") {
          const cell = $match$997;
          return (() => {
            const e = cell.f[0].f[0];
            const st1 = checkExpr(st, infer, $field(e, "key"));
            const st2 = checkExpr(st1, infer, $field(e, "value"));
            return checkDictEntries(st2, infer, cell.f[0].f[1]);
          })();
        }
        throw $matchFail("src/check/exhaust.pf", 997);
      })($field(Compat, "uncons")(entries));
    }
    function checkFmtParts(st, infer, parts) {
      return (($match$1032) => {
        if ($match$1032.$t === "None") {
          return st;
        }
        if ($match$1032.$t === "Some") {
          const cell = $match$1032;
          return (() => {
            const p = cell.f[0].f[0];
            return (($match$1043) => {
              if ($match$1043.$t === "FmtLit") {
                return checkFmtParts(st, infer, cell.f[0].f[1]);
              }
              if ($match$1043.$t === "FmtExpr") {
                const f = $match$1043;
                return checkFmtParts(checkExpr(st, infer, f.f[0]), infer, cell.f[0].f[1]);
              }
              throw $matchFail("src/check/exhaust.pf", 1043);
            })(p);
          })();
        }
        throw $matchFail("src/check/exhaust.pf", 1032);
      })($field(Compat, "uncons")(parts));
    }
    function checkGenClauses(st, infer, gens) {
      return (($match$1067) => {
        if ($match$1067.$t === "None") {
          return st;
        }
        if ($match$1067.$t === "Some") {
          const cell = $match$1067;
          return (() => {
            const g = cell.f[0].f[0];
            return checkGenClauses(checkExpr(st, infer, $field(g, "source")), infer, cell.f[0].f[1]);
          })();
        }
        throw $matchFail("src/check/exhaust.pf", 1067);
      })($field(Compat, "uncons")(gens));
    }
    function checkArm(st, infer, arm) {
      const st1 = (($match$1093) => {
        if ($match$1093.$t === "Some") {
          const g = $match$1093;
          return checkExpr(st, infer, g.f[0]);
        }
        if ($match$1093.$t === "None") {
          return st;
        }
        throw $matchFail("src/check/exhaust.pf", 1093);
      })($field(arm, "guard"));
      return checkExpr(st1, infer, $field(arm, "body"));
    }
    function checkArms(st, infer, arms) {
      while (true) {
        const $match$1112 = $field(Compat, "uncons")(arms);
        if ($match$1112.$t === "None") {
          return st;
        }
        if ($match$1112.$t === "Some") {
          const cell = $match$1112;
          const $tc$1130$0 = checkArm(st, infer, cell.f[0].f[0]);
          const $tc$1130$1 = infer;
          const $tc$1130$2 = cell.f[0].f[1];
          st = $tc$1130$0;
          infer = $tc$1130$1;
          arms = $tc$1130$2;
          continue;
        }
        throw $matchFail("src/check/exhaust.pf", 1112);
      }
    }
    function checkExpr(st, infer, expr) {
      while (true) {
        const $match$1133 = expr;
        if ($match$1133.$t === "EInt") {
          return st;
        }
        if ($match$1133.$t === "EFloat") {
          return st;
        }
        if ($match$1133.$t === "EBool") {
          return st;
        }
        if ($match$1133.$t === "EStr") {
          return st;
        }
        if ($match$1133.$t === "EChar") {
          return st;
        }
        if ($match$1133.$t === "EByte") {
          return st;
        }
        if ($match$1133.$t === "EVar") {
          return st;
        }
        if ($match$1133.$t === "EUnary") {
          const e = $match$1133;
          const $tc$1147$0 = st;
          const $tc$1147$1 = infer;
          const $tc$1147$2 = e.f[2];
          st = $tc$1147$0;
          infer = $tc$1147$1;
          expr = $tc$1147$2;
          continue;
        }
        if ($match$1133.$t === "EBinary") {
          const e = $match$1133;
          return (() => {
            const st1 = checkExpr(st, infer, e.f[2]);
            return checkExpr(st1, infer, e.f[3]);
          })();
        }
        if ($match$1133.$t === "EIf") {
          const e = $match$1133;
          return (() => {
            const st1 = checkExpr(st, infer, e.f[1]);
            const st2 = checkExpr(st1, infer, e.f[2]);
            return checkExpr(st2, infer, e.f[3]);
          })();
        }
        if ($match$1133.$t === "ECall") {
          const e = $match$1133;
          return (() => {
            const st1 = checkExpr(st, infer, e.f[1]);
            return checkExprList(st1, infer, e.f[2]);
          })();
        }
        if ($match$1133.$t === "ELambda") {
          const e = $match$1133;
          const $tc$1205$0 = st;
          const $tc$1205$1 = infer;
          const $tc$1205$2 = e.f[2];
          st = $tc$1205$0;
          infer = $tc$1205$1;
          expr = $tc$1205$2;
          continue;
        }
        if ($match$1133.$t === "EProcLambda") {
          const e = $match$1133;
          return checkStmtList(st, infer, e.f[3]);
        }
        if ($match$1133.$t === "EBlock") {
          const e = $match$1133;
          return checkStmtList(st, infer, e.f[1]);
        }
        if ($match$1133.$t === "EList") {
          const e = $match$1133;
          return checkExprList(st, infer, e.f[1]);
        }
        if ($match$1133.$t === "EComp") {
          const e = $match$1133;
          return (() => {
            const st1 = checkGenClauses(st, infer, e.f[2]);
            const st2 = checkExpr(st1, infer, e.f[1]);
            return (($match$1239) => {
              if ($match$1239.$t === "Some") {
                const g = $match$1239;
                return checkExpr(st2, infer, g.f[0]);
              }
              if ($match$1239.$t === "None") {
                return st2;
              }
              throw $matchFail("src/check/exhaust.pf", 1239);
            })(e.f[3]);
          })();
        }
        if ($match$1133.$t === "ERecord") {
          const e = $match$1133;
          return checkFields(st, infer, e.f[2]);
        }
        if ($match$1133.$t === "EField") {
          const e = $match$1133;
          const $tc$1261$0 = st;
          const $tc$1261$1 = infer;
          const $tc$1261$2 = e.f[1];
          st = $tc$1261$0;
          infer = $tc$1261$1;
          expr = $tc$1261$2;
          continue;
        }
        if ($match$1133.$t === "EIndex") {
          const e = $match$1133;
          return (() => {
            const st1 = checkExpr(st, infer, e.f[1]);
            return checkExpr(st1, infer, e.f[2]);
          })();
        }
        if ($match$1133.$t === "EMatch") {
          const e = $match$1133;
          return (() => {
            const st1 = checkExpr(st, infer, e.f[1]);
            const st2 = checkArms(st1, infer, e.f[2]);
            return checkMatchCoverage(st2, infer, e.f[1], e.f[2], e.f[3]);
          })();
        }
        if ($match$1133.$t === "EDict") {
          const e = $match$1133;
          return checkDictEntries(st, infer, e.f[1]);
        }
        if ($match$1133.$t === "EArray") {
          const e = $match$1133;
          return checkExprList(st, infer, e.f[1]);
        }
        if ($match$1133.$t === "EAwait") {
          const e = $match$1133;
          const $tc$1320$0 = st;
          const $tc$1320$1 = infer;
          const $tc$1320$2 = e.f[1];
          st = $tc$1320$0;
          infer = $tc$1320$1;
          expr = $tc$1320$2;
          continue;
        }
        if ($match$1133.$t === "EFmt") {
          const e = $match$1133;
          return checkFmtParts(st, infer, e.f[1]);
        }
        throw $matchFail("src/check/exhaust.pf", 1133);
      }
    }
    function checkMaybeExpr(st, infer, value) {
      return (($match$1329) => {
        if ($match$1329.$t === "None") {
          return st;
        }
        if ($match$1329.$t === "Some") {
          const v = $match$1329;
          return checkExpr(st, infer, v.f[0]);
        }
        throw $matchFail("src/check/exhaust.pf", 1329);
      })(value);
    }
    function checkStmt(st, infer, stmt) {
      while (true) {
        const $match$1340 = stmt;
        if ($match$1340.$t === "SLet") {
          const s = $match$1340;
          return checkExpr(st, infer, s.f[2]);
        }
        if ($match$1340.$t === "SVar") {
          const s = $match$1340;
          return checkExpr(st, infer, s.f[2]);
        }
        if ($match$1340.$t === "SAssign") {
          const s = $match$1340;
          return checkExpr(st, infer, s.f[2]);
        }
        if ($match$1340.$t === "SIndexAssign") {
          const s = $match$1340;
          return (() => {
            const st1 = checkExpr(st, infer, s.f[1]);
            const st2 = checkExpr(st1, infer, s.f[2]);
            return checkExpr(st2, infer, s.f[3]);
          })();
        }
        if ($match$1340.$t === "SFun") {
          const s = $match$1340;
          return checkStmtList(st, infer, s.f[3]);
        }
        if ($match$1340.$t === "SType") {
          return st;
        }
        if ($match$1340.$t === "SExpr") {
          const s = $match$1340;
          return checkExpr(st, infer, s.f[1]);
        }
        if ($match$1340.$t === "SReturn") {
          const s = $match$1340;
          return checkMaybeExpr(st, infer, s.f[1]);
        }
        if ($match$1340.$t === "SIf") {
          const s = $match$1340;
          return (() => {
            const st1 = checkExpr(st, infer, s.f[1]);
            const st2 = checkStmtList(st1, infer, s.f[2]);
            return checkMaybeStmtList(st2, infer, s.f[3]);
          })();
        }
        if ($match$1340.$t === "SWhile") {
          const s = $match$1340;
          return (() => {
            const st1 = checkExpr(st, infer, s.f[1]);
            return checkStmtList(st1, infer, s.f[2]);
          })();
        }
        if ($match$1340.$t === "SImport") {
          return st;
        }
        if ($match$1340.$t === "SExport") {
          const s = $match$1340;
          const $tc$1444$0 = st;
          const $tc$1444$1 = infer;
          const $tc$1444$2 = s.f[1];
          st = $tc$1444$0;
          infer = $tc$1444$1;
          stmt = $tc$1444$2;
          continue;
        }
        if ($match$1340.$t === "SExtern") {
          return st;
        }
        throw $matchFail("src/check/exhaust.pf", 1340);
      }
    }
    function checkStmtList(st, infer, stmts) {
      while (true) {
        const $match$1448 = $field(Compat, "uncons")(stmts);
        if ($match$1448.$t === "None") {
          return st;
        }
        if ($match$1448.$t === "Some") {
          const cell = $match$1448;
          const $tc$1466$0 = checkStmt(st, infer, cell.f[0].f[0]);
          const $tc$1466$1 = infer;
          const $tc$1466$2 = cell.f[0].f[1];
          st = $tc$1466$0;
          infer = $tc$1466$1;
          stmts = $tc$1466$2;
          continue;
        }
        throw $matchFail("src/check/exhaust.pf", 1448);
      }
    }
    function checkMaybeStmtList(st, infer, stmts) {
      return (($match$1469) => {
        if ($match$1469.$t === "None") {
          return st;
        }
        if ($match$1469.$t === "Some") {
          const body = $match$1469;
          return checkStmtList(st, infer, body.f[0]);
        }
        throw $matchFail("src/check/exhaust.pf", 1469);
      })(stmts);
    }
    function checkModule(ast, infer, deps) {
      const st0 = initialState(ast, deps);
      const st1 = checkStmtList(st0, infer, $field(ast, "stmts"));
      return mkExhaustResult($reverse(st1.f[2]));
    }
    function checkExhaustiveness(ast, infer, deps) {
      return checkModule(ast, infer, deps);
    }
    function checkSyntaxOnly(ast, deps) {
      const st0 = initialState(ast, deps);
      return mkExhaustResult($reverse(st0.f[2]));
    }
    exports["SubjectUnion"] = SubjectUnion;
    exports["SubjectList"] = SubjectList;
    exports["SubjectOther"] = SubjectOther;
    exports["SubjectUnknown"] = SubjectUnknown;
    exports["mkExhaustResult"] = mkExhaustResult;
    exports["subjectUnion"] = subjectUnion;
    exports["subjectList"] = subjectList;
    exports["subjectOther"] = subjectOther;
    exports["subjectUnknown"] = subjectUnknown;
    exports["checkModule"] = checkModule;
    exports["checkExhaustiveness"] = checkExhaustiveness;
    exports["checkSyntaxOnly"] = checkSyntaxOnly;
  });
  $registerSchemas([{name: "CheckedUnit", union: null, fields: ["path", "ast", "infer", "iface", "diags"], variant: false}, {name: "CheckGraphResult", union: null, fields: ["modules", "ifaces", "diags"], variant: false}]);
  $maps["src/check/check"] = {"../syntax/ast": "src/syntax/ast", "../syntax/token": "src/syntax/token", "../graph/modgraph": "src/graph/modgraph", "./diag": "src/check/diag", "./iface": "src/check/iface", "./types": "src/check/types", "./purity": "src/check/purity", "./exhaust": "src/check/exhaust", "../data/imaps": "src/data/imaps", "../data/imapi": "src/data/imapi", "../compat": "src/compat"};
  $mods["src/check/check"] = ((exports, $require) => {
    const A = $require("../syntax/ast");
    const T = $require("../syntax/token");
    const M = $require("../graph/modgraph");
    const D = $require("./diag");
    const I = $require("./iface");
    const TY = $require("./types");
    const P = $require("./purity");
    const X = $require("./exhaust");
    const IMS = $require("../data/imaps");
    const IMI = $require("../data/imapi");
    const Compat = $require("../compat");
    function mkCheckedUnit(path, ast, infer, iface, diags) {
      return $makeRecord("CheckedUnit", ["path", "ast", "infer", "iface", "diags"], [path, ast, infer, iface, diags]);
    }
    function mkCheckGraphResult(modules, ifaces, diags) {
      return $makeRecord("CheckGraphResult", ["modules", "ifaces", "diags"], [modules, ifaces, diags]);
    }
    function appendList(a, b) {
      return $reduce((acc, x) => $cons(x, acc), b, $reverse(a));
    }
    function appendOne(xs, x) {
      return $reverse($cons(x, $reverse(xs)));
    }
    function hasBlockingDiags(diags) {
      return $gtI($length(diags), 0);
    }
    function strListContains(xs, s) {
      return (($match$62) => {
        if ($match$62.$t === "None") {
          return false;
        }
        if ($match$62.$t === "Some") {
          const cell = $match$62;
          return (() => {
            const p = cell.f[0];
            if (p.f[0] === s) {
              return true;
            } else {
              return strListContains(p.f[1], s);
            }
          })();
        }
        throw $matchFail("src/check/check.pf", 62);
      })($field(Compat, "uncons")(xs));
    }
    function addUniqueStr(xs, s) {
      if (strListContains(xs, s)) {
        return xs;
      } else {
        return $cons(s, xs);
      }
    }
    function fallbackSpan() {
      const p = $field(T, "mkPos")(1, 1, 0);
      return $field(T, "pointSpan")(p);
    }
    function importDiag(path, span, message) {
      return $field(D, "err")($makeVariant("ImportD", "DiagCode", [], []), message, path, span);
    }
    function emptyInfer(diags) {
      return $field(TY, "mkInferResult")($field(IMI, "imiEmpty")(), $field(IMS, "imsEmpty")(), diags);
    }
    function emptyCheckedUnit(path, ast, diags) {
      return mkCheckedUnit(path, ast, emptyInfer(diags), $field(I, "emptyIface")(path), diags);
    }
    function ifaceSchemeFromTypeScheme(s) {
      return $field(I, "mkScheme")($field(s, "vars"), $field(s, "constraints"), $field(TY, "typeToIface")($field(s, "body")));
    }
    function putTypedExport(acc, pair) {
      return $field(IMS, "imsPut")(acc, $field(pair, "key"), ifaceSchemeFromTypeScheme($field(pair, "value")));
    }
    function mergeTypedExports(entries, acc) {
      return (($match$174) => {
        if ($match$174.$t === "None") {
          return acc;
        }
        if ($match$174.$t === "Some") {
          const cell = $match$174;
          return (() => {
            const p = cell.f[0];
            return mergeTypedExports(p.f[1], putTypedExport(acc, p.f[0]));
          })();
        }
        throw $matchFail("src/check/check.pf", 174);
      })($field(Compat, "uncons")(entries));
    }
    function ifaceFromInfer(ast, infer) {
      const skeleton = $field(I, "ifaceOfAst")(ast);
      const typedExports = mergeTypedExports($field(IMS, "imsEntries")($field(infer, "exports")), skeleton.f[2]);
      return $field(I, "mkIfaceWithRecords")($field(ast, "path"), skeleton.f[1], typedExports, skeleton.f[3], skeleton.f[4]);
    }
    function runExhaust(ast, infer, deps) {
      return $field(X, "checkModule")(ast, infer, deps);
    }
    function checkModule(ast, deps) {
      const infer = $field(TY, "inferModule")(ast, deps);
      const purity = $field(P, "checkModule")(ast, deps, infer.f[0]);
      const exhaust = runExhaust(ast, infer, deps);
      const d1 = appendList(infer.f[2], purity.f[0]);
      const d2 = appendList(d1, exhaust.f[0]);
      const iface = hasBlockingDiags(d2) ? $field(I, "emptyIface")($field(ast, "path")) : ifaceFromInfer(ast, infer);
      return mkCheckedUnit($field(ast, "path"), ast, infer, iface, d2);
    }
    function checkOneModule(ast, deps) {
      return checkModule(ast, deps);
    }
    function tryIfaceKey(ifaces, key) {
      return $field(IMS, "imsGet")(ifaces, key);
    }
    function ifaceForBuiltin(ifaces, name, rawPath) {
      return (($match$305) => {
        if ($match$305.$t === "Some") {
          const iface = $match$305;
          return $makeVariant("Some", "Option", ["value"], [iface.f[0]]);
        }
        if ($match$305.$t === "None") {
          return (() => {
            return (($match$314) => {
              if ($match$314.$t === "Some") {
                const iface2 = $match$314;
                return $makeVariant("Some", "Option", ["value"], [iface2.f[0]]);
              }
              if ($match$314.$t === "None") {
                return (() => {
                  return (($match$325) => {
                    if ($match$325.$t === "Some") {
                      const iface3 = $match$325;
                      return $makeVariant("Some", "Option", ["value"], [iface3.f[0]]);
                    }
                    if ($match$325.$t === "None") {
                      return $makeVariant("None", "Option", [], []);
                    }
                    throw $matchFail("src/check/check.pf", 325);
                  })(tryIfaceKey(ifaces, rawPath));
                })();
              }
              throw $matchFail("src/check/check.pf", 314);
            })(tryIfaceKey(ifaces, $concatS("$builtin/", name)));
          })();
        }
        throw $matchFail("src/check/check.pf", 305);
      })(tryIfaceKey(ifaces, name));
    }
    function ifaceForUserPath(ifaces, path, rawPath) {
      return (($match$338) => {
        if ($match$338.$t === "Some") {
          const iface = $match$338;
          return $makeVariant("Some", "Option", ["value"], [iface.f[0]]);
        }
        if ($match$338.$t === "None") {
          return (() => {
            return (($match$347) => {
              if ($match$347.$t === "Some") {
                const iface2 = $match$347;
                return $makeVariant("Some", "Option", ["value"], [iface2.f[0]]);
              }
              if ($match$347.$t === "None") {
                return $makeVariant("None", "Option", [], []);
              }
              throw $matchFail("src/check/check.pf", 347);
            })(tryIfaceKey(ifaces, rawPath));
          })();
        }
        throw $matchFail("src/check/check.pf", 338);
      })(tryIfaceKey(ifaces, path));
    }
    function ifaceForEdge(ifaces, edge) {
      return (($match$359) => {
        if ($match$359.$t === "BuiltinPath") {
          const b = $match$359;
          return ifaceForBuiltin(ifaces, b.f[0], $field(edge, "rawPath"));
        }
        if ($match$359.$t === "UserPath") {
          const u = $match$359;
          return ifaceForUserPath(ifaces, u.f[0], $field(edge, "rawPath"));
        }
        throw $matchFail("src/check/check.pf", 359);
      })($field(edge, "resolved"));
    }
    function putDepAlias(deps, edge, iface) {
      const deps1 = $field(IMS, "imsPut")(deps, $field(edge, "rawPath"), iface);
      return $field(IMS, "imsPut")(deps1, $field(M, "resolvedPathToStr")($field(edge, "resolved")), iface);
    }
    function depsForEdges(globalIfaces, edges, acc) {
      return (($match$398) => {
        if ($match$398.$t === "None") {
          return acc;
        }
        if ($match$398.$t === "Some") {
          const cell = $match$398;
          return (() => {
            const edge = cell.f[0].f[0];
            const rest = cell.f[0].f[1];
            return (($match$413) => {
              if ($match$413.$t === "Some") {
                const iface = $match$413;
                return depsForEdges(globalIfaces, rest, putDepAlias(acc, edge, iface.f[0]));
              }
              if ($match$413.$t === "None") {
                return depsForEdges(globalIfaces, rest, acc);
              }
              throw $matchFail("src/check/check.pf", 413);
            })(ifaceForEdge(globalIfaces, edge));
          })();
        }
        throw $matchFail("src/check/check.pf", 398);
      })($field(Compat, "uncons")(edges));
    }
    function depsForRawModule(globalIfaces, raw) {
      return depsForEdges(globalIfaces, $field(raw, "edges"), globalIfaces);
    }
    function putCheckedIface(ifaces, raw, unit) {
      const ifaces1 = $field(IMS, "imsPut")(ifaces, $field($field(unit, "iface"), "path"), $field(unit, "iface"));
      const ifaces2 = $field(IMS, "imsPut")(ifaces1, $field(raw, "path"), $field(unit, "iface"));
      return $field(IMS, "imsPut")(ifaces2, $field($field(raw, "ast"), "path"), $field(unit, "iface"));
    }
    function resolvedUserFailed(edge, failedPaths) {
      return (($match$474) => {
        if ($match$474.$t === "BuiltinPath") {
          return false;
        }
        if ($match$474.$t === "UserPath") {
          const u = $match$474;
          return strListContains(failedPaths, u.f[0]) || strListContains(failedPaths, $field(edge, "rawPath"));
        }
        throw $matchFail("src/check/check.pf", 474);
      })($field(edge, "resolved"));
    }
    function firstFailedDependency(edges, failedPaths) {
      return (($match$491) => {
        if ($match$491.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$491.$t === "Some") {
          const cell = $match$491;
          return (() => {
            const edge = cell.f[0].f[0];
            if (resolvedUserFailed(edge, failedPaths)) {
              return $makeVariant("Some", "Option", ["value"], [edge]);
            } else {
              return firstFailedDependency(cell.f[0].f[1], failedPaths);
            }
          })();
        }
        throw $matchFail("src/check/check.pf", 491);
      })($field(Compat, "uncons")(edges));
    }
    function firstMissingInterface(edges, ifaces) {
      return (($match$519) => {
        if ($match$519.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$519.$t === "Some") {
          const cell = $match$519;
          return (() => {
            const edge = cell.f[0].f[0];
            return (($match$530) => {
              if ($match$530.$t === "Some") {
                return firstMissingInterface(cell.f[0].f[1], ifaces);
              }
              if ($match$530.$t === "None") {
                return $makeVariant("Some", "Option", ["value"], [edge]);
              }
              throw $matchFail("src/check/check.pf", 530);
            })(ifaceForEdge(ifaces, edge));
          })();
        }
        throw $matchFail("src/check/check.pf", 519);
      })($field(Compat, "uncons")(edges));
    }
    function failedDependencyDiag(raw, edge) {
      return importDiag($field(raw, "path"), $field(edge, "span"), $concatS($concatS($concatS($concatS("Skipping module '", $field(raw, "path")), "' because imported dependency '"), $field(M, "resolvedPathToStr")($field(edge, "resolved"))), "' failed to check."));
    }
    function missingInterfaceDiag(raw, edge) {
      return importDiag($field(raw, "path"), $field(edge, "span"), $concatS($concatS($concatS($concatS("Skipping module '", $field(raw, "path")), "' because imported dependency '"), $field(M, "resolvedPathToStr")($field(edge, "resolved"))), "' has no checked interface."));
    }
    function skipUnit(raw, diag) {
      return emptyCheckedUnit($field(raw, "path"), $field(raw, "ast"), [diag]);
    }
    function addFailedRawPaths(failedPaths, raw) {
      const f1 = addUniqueStr(failedPaths, $field(raw, "path"));
      return addUniqueStr(f1, $field($field(raw, "ast"), "path"));
    }
    function checkedGraphLoop(mods, ifaces, checkedAcc, diagAcc, failedPaths) {
      return (($match$614) => {
        if ($match$614.$t === "None") {
          return mkCheckGraphResult($reverse(checkedAcc), ifaces, diagAcc);
        }
        if ($match$614.$t === "Some") {
          const cell = $match$614;
          return (() => {
            const raw = cell.f[0].f[0];
            const rest = cell.f[0].f[1];
            return (($match$635) => {
              if ($match$635.$t === "Some") {
                const badDep = $match$635;
                return (() => {
                  const diag = failedDependencyDiag(raw, badDep.f[0]);
                  const unit = skipUnit(raw, diag);
                  const failed2 = addFailedRawPaths(failedPaths, raw);
                  return checkedGraphLoop(rest, ifaces, $cons(unit, checkedAcc), appendOne(diagAcc, diag), failed2);
                })();
              }
              if ($match$635.$t === "None") {
                return (() => {
                  return (($match$673) => {
                    if ($match$673.$t === "Some") {
                      const missing = $match$673;
                      return (() => {
                        const diag = missingInterfaceDiag(raw, missing.f[0]);
                        const unit = skipUnit(raw, diag);
                        const failed2 = addFailedRawPaths(failedPaths, raw);
                        return checkedGraphLoop(rest, ifaces, $cons(unit, checkedAcc), appendOne(diagAcc, diag), failed2);
                      })();
                    }
                    if ($match$673.$t === "None") {
                      return (() => {
                        const deps = depsForRawModule(ifaces, raw);
                        const unit = checkModule($field(raw, "ast"), deps);
                        const diagAcc2 = appendList(diagAcc, unit.f[4]);
                        if (hasBlockingDiags(unit.f[4])) {
                          const failed2 = addFailedRawPaths(failedPaths, raw);
                          return checkedGraphLoop(rest, ifaces, $cons(unit, checkedAcc), diagAcc2, failed2);
                        } else {
                          const ifaces2 = putCheckedIface(ifaces, raw, unit);
                          return checkedGraphLoop(rest, ifaces2, $cons(unit, checkedAcc), diagAcc2, failedPaths);
                        }
                      })();
                    }
                    throw $matchFail("src/check/check.pf", 673);
                  })(firstMissingInterface($field(raw, "edges"), ifaces));
                })();
              }
              throw $matchFail("src/check/check.pf", 635);
            })(firstFailedDependency($field(raw, "edges"), failedPaths));
          })();
        }
        throw $matchFail("src/check/check.pf", 614);
      })($field(Compat, "uncons")(mods));
    }
    function checkGraph(mods, builtinIfaces) {
      return checkedGraphLoop(mods, builtinIfaces, [], [], []);
    }
    function checkGraphNoBuiltins(mods) {
      return checkGraph(mods, $field(IMS, "imsEmpty")());
    }
    function checkTopo(topo, builtinIfaces) {
      return (($match$789) => {
        if ($match$789.$t === "TopoOk") {
          const ok = $match$789;
          return checkGraph(ok.f[0], builtinIfaces);
        }
        if ($match$789.$t === "TopoErr") {
          const bad = $match$789;
          return mkCheckGraphResult([], builtinIfaces, bad.f[0]);
        }
        throw $matchFail("src/check/check.pf", 789);
      })(topo);
    }
    exports["mkCheckedUnit"] = mkCheckedUnit;
    exports["mkCheckGraphResult"] = mkCheckGraphResult;
    exports["checkModule"] = checkModule;
    exports["checkOneModule"] = checkOneModule;
    exports["checkGraph"] = checkGraph;
    exports["checkGraphNoBuiltins"] = checkGraphNoBuiltins;
    exports["checkTopo"] = checkTopo;
  });
  $registerSchemas([{name: "PlatformAll", union: "BuiltinPlatform", fields: [], variant: true}, {name: "PlatformNode", union: "BuiltinPlatform", fields: [], variant: true}, {name: "PlatformBrowser", union: "BuiltinPlatform", fields: [], variant: true}, {name: "BuiltinEntry", union: null, fields: ["name", "kind", "scheme", "platform", "intrinsic"], variant: false}, {name: "BuiltinUnion", union: null, fields: ["name", "variants"], variant: false}, {name: "BuiltinModuleSpec", union: null, fields: ["path", "exports", "unions"], variant: false}]);
  $maps["src/builtins/spec"] = {"../syntax/ast": "src/syntax/ast", "../check/iface": "src/check/iface", "../check/types": "src/check/types", "../data/imaps": "src/data/imaps", "../compat": "src/compat"};
  $mods["src/builtins/spec"] = ((exports, $require) => {
    const A = $require("../syntax/ast");
    const I = $require("../check/iface");
    const TY = $require("../check/types");
    const IMS = $require("../data/imaps");
    const Compat = $require("../compat");
    const PlatformAll = $makeVariant("PlatformAll", "BuiltinPlatform", [], []);
    const PlatformNode = $makeVariant("PlatformNode", "BuiltinPlatform", [], []);
    const PlatformBrowser = $makeVariant("PlatformBrowser", "BuiltinPlatform", [], []);
    function platformAll() {
      return PlatformAll;
    }
    function platformNode() {
      return PlatformNode;
    }
    function platformBrowser() {
      return PlatformBrowser;
    }
    function builtinEntry(name, kind, scheme, platform, intrinsic) {
      return $makeRecord("BuiltinEntry", ["name", "kind", "scheme", "platform", "intrinsic"], [name, kind, scheme, platform, intrinsic]);
    }
    function builtinUnion(name, variants) {
      return $makeRecord("BuiltinUnion", ["name", "variants"], [name, variants]);
    }
    function builtinModule(path, exports, unions) {
      return $makeRecord("BuiltinModuleSpec", ["path", "exports", "unions"], [path, exports, unions]);
    }
    function tv(n) {
      return $field(TY, "tVar")(n);
    }
    function listOf(t) {
      return $field(TY, "tList")(t);
    }
    function arrayOf(t) {
      return $field(TY, "tArray")(t);
    }
    function dictOf(k, v) {
      return $field(TY, "tDict")(k, v);
    }
    function optionOf(t) {
      return $field(TY, "tNamed")("Option", [t]);
    }
    function resultOf(v, e) {
      return $field(TY, "tNamed")("Result", [v, e]);
    }
    function pairOf(k, v) {
      return $field(TY, "tNamed")("Pair", [k, v]);
    }
    function ioResult(t) {
      return resultOf(t, $field(TY, "tStr")());
    }
    function sch(vars, body) {
      return $field(I, "mkScheme")(vars, [], $field(TY, "typeToIface")(body));
    }
    function pure(name, scheme, intrinsic) {
      return builtinEntry(name, $field(I, "kFun")(), scheme, PlatformAll, intrinsic);
    }
    function nodePure(name, scheme, intrinsic) {
      return builtinEntry(name, $field(I, "kFun")(), scheme, PlatformNode, intrinsic);
    }
    function browserPure(name, scheme, intrinsic) {
      return builtinEntry(name, $field(I, "kFun")(), scheme, PlatformBrowser, intrinsic);
    }
    function procEntry(name, scheme, intrinsic) {
      return builtinEntry(name, $field(I, "kProc")(), scheme, PlatformAll, intrinsic);
    }
    function nodeProc(name, scheme, intrinsic) {
      return builtinEntry(name, $field(I, "kProc")(), scheme, PlatformNode, intrinsic);
    }
    function browserProc(name, scheme, intrinsic) {
      return builtinEntry(name, $field(I, "kProc")(), scheme, PlatformBrowser, intrinsic);
    }
    function fn1(a, r) {
      return $field(TY, "tFun")([a], r);
    }
    function fn2(a, b, r) {
      return $field(TY, "tFun")([a, b], r);
    }
    function fn3(a, b, c, r) {
      return $field(TY, "tFun")([a, b, c], r);
    }
    function proc0(r, isAsync) {
      return $field(TY, "tProc")([], r, isAsync);
    }
    function proc1(a, r, isAsync) {
      return $field(TY, "tProc")([a], r, isAsync);
    }
    function proc2(a, b, r, isAsync) {
      return $field(TY, "tProc")([a, b], r, isAsync);
    }
    function proc3(a, b, c, r, isAsync) {
      return $field(TY, "tProc")([a, b, c], r, isAsync);
    }
    function optionVariants() {
      return [$field(A, "mkVariantDecl")("None", []), $field(A, "mkVariantDecl")("Some", [$field(A, "mkFieldDecl")("value", true)])];
    }
    function resultVariants() {
      return [$field(A, "mkVariantDecl")("Ok", [$field(A, "mkFieldDecl")("value", true)]), $field(A, "mkVariantDecl")("Err", [$field(A, "mkFieldDecl")("message", true)])];
    }
    function readResultVariants() {
      return [$field(A, "mkVariantDecl")("Ok", [$field(A, "mkFieldDecl")("value", true)]), $field(A, "mkVariantDecl")("Eof", []), $field(A, "mkVariantDecl")("Err", [$field(A, "mkFieldDecl")("message", true)])];
    }
    function fileModeVariants() {
      return [$field(A, "mkVariantDecl")("Read", []), $field(A, "mkVariantDecl")("Write", []), $field(A, "mkVariantDecl")("Append", [])];
    }
    function bufferModeVariants() {
      return [$field(A, "mkVariantDecl")("ByteMode", []), $field(A, "mkVariantDecl")("CharMode", [])];
    }
    function dbValueVariants() {
      return [$field(A, "mkVariantDecl")("DbText", [$field(A, "mkFieldDecl")("value", false)]), $field(A, "mkVariantDecl")("DbInt", [$field(A, "mkFieldDecl")("value", false)]), $field(A, "mkVariantDecl")("DbFloat", [$field(A, "mkFieldDecl")("value", false)]), $field(A, "mkVariantDecl")("DbBool", [$field(A, "mkFieldDecl")("value", false)]), $field(A, "mkVariantDecl")("DbBytes", [$field(A, "mkFieldDecl")("value", false)]), $field(A, "mkVariantDecl")("DbNull", [])];
    }
    function slotVarIds(slotCount) {
      if ($leI(slotCount, 0)) {
        return [];
      } else {
        return $range(0, $subI(slotCount, 1));
      }
    }
    function slotVarTypes(slotCount) {
      return $map((n) => tv(n), slotVarIds(slotCount));
    }
    function putBuiltinType(iface, name, slotCount) {
      const vars = slotVarIds(slotCount);
      const body = $field(TY, "tNamed")(name, slotVarTypes(slotCount));
      return $field(I, "putType")($field(I, "putKind")(iface, name, $field(I, "kType")()), name, sch(vars, body));
    }
    function putBuiltinUnion(iface, name, variants, slotCount) {
      const iface1 = putBuiltinType(iface, name, slotCount);
      return $field(I, "putUnion")(iface1, name, variants);
    }
    function coreTypeIface() {
      const iface0 = $field(I, "emptyIface")("$builtin/core");
      const iface1 = putBuiltinUnion(iface0, "Option", optionVariants(), 1);
      const iface2 = putBuiltinUnion(iface1, "Result", resultVariants(), 2);
      const iface3a = putBuiltinType(iface2, "Pair", 2);
      const iface3 = $field(I, "putRecord")(iface3a, "Pair", [$field(A, "mkFieldDecl")("key", true), $field(A, "mkFieldDecl")("value", true)]);
      const iface4 = putBuiltinType(iface3, "NonZero", 0);
      return iface4;
    }
    function coreExports() {
      const a = tv(0);
      const b = tv(1);
      const c = tv(2);
      return [pure("__str__", sch([0], fn1(a, $field(TY, "tStr")())), "$str"), pure("str", sch([0], fn1(a, $field(TY, "tStr")())), "$str"), pure("length", sch([], fn1($field(TY, "tAny")(), $field(TY, "tInt")())), "$length"), pure("reverse", sch([0], fn1(listOf(a), listOf(a))), "$reverse"), pure("cons", sch([0], fn2(a, listOf(a), listOf(a))), "$cons"), pure("nth", sch([0], fn2(listOf(a), $field(TY, "tInt")(), optionOf(a))), "$nth"), pure("nthU", sch([0], fn2(listOf(a), $field(TY, "tInt")(), a)), "$nthU"), pure("slice", sch([], fn3($field(TY, "tInt")(), $field(TY, "tInt")(), $field(TY, "tAny")(), $field(TY, "tAny")())), "$slice"), pure("take", sch([0], fn2($field(TY, "tInt")(), listOf(a), listOf(a))), "$take"), pure("range", sch([], fn2($field(TY, "tInt")(), $field(TY, "tInt")(), listOf($field(TY, "tInt")()))), "$range"), pure("find", sch([], fn2($field(TY, "tAny")(), $field(TY, "tAny")(), optionOf($field(TY, "tInt")()))), "$find"), pure("findSlice", sch([], fn2($field(TY, "tAny")(), $field(TY, "tAny")(), optionOf($field(TY, "tInt")()))), "$findSlice"), pure("map", sch([0, 1], fn2($field(TY, "tFun")([a], b), listOf(a), listOf(b))), "$map"), pure("filter", sch([0], fn2($field(TY, "tFun")([a], $field(TY, "tBool")()), listOf(a), listOf(a))), "$filter"), pure("reduce", sch([0, 1], fn3($field(TY, "tFun")([a, b], a), a, listOf(b), a)), "$reduce"), pure("split", sch([], fn2($field(TY, "tStr")(), $field(TY, "tStr")(), listOf($field(TY, "tStr")()))), "$split"), pure("join", sch([0], fn2(listOf(a), $field(TY, "tStr")(), $field(TY, "tStr")())), "$join"), pure("asc", sch([], fn1($field(TY, "tChar")(), $field(TY, "tInt")())), "$asc"), pure("chr", sch([], fn1($field(TY, "tInt")(), optionOf($field(TY, "tChar")()))), "$chr"), pure("chrU", sch([], fn1($field(TY, "tInt")(), $field(TY, "tChar")())), "$chrU"), pure("charBytes", sch([], fn1($field(TY, "tChar")(), listOf($field(TY, "tByte")()))), "$charBytes"), pure("bytesToChar", sch([], fn1(listOf($field(TY, "tByte")()), optionOf($field(TY, "tChar")()))), "$bytesToChar"), pure("floor", sch([], fn1($field(TY, "tFloat")(), $field(TY, "tInt")())), "$floor"), pure("ceil", sch([], fn1($field(TY, "tFloat")(), $field(TY, "tInt")())), "$ceil"), pure("round", sch([], fn1($field(TY, "tFloat")(), $field(TY, "tInt")())), "$round"), pure("isNaN", sch([], fn1($field(TY, "tFloat")(), $field(TY, "tBool")())), "$isNaN"), pure("isFinite", sch([], fn1($field(TY, "tFloat")(), $field(TY, "tBool")())), "$isFinite"), pure("nonZero", sch([], fn1($field(TY, "tInt")(), optionOf($field(TY, "tNonZero")()))), "$nonZero"), pure("safeDiv", sch([], fn2($field(TY, "tInt")(), $field(TY, "tInt")(), optionOf($field(TY, "tInt")()))), "$safeDiv"), pure("safeMod", sch([], fn2($field(TY, "tInt")(), $field(TY, "tInt")(), optionOf($field(TY, "tInt")()))), "$safeMod")];
    }
    function ioExports() {
      return [procEntry("print", sch([0], proc1(tv(0), $field(TY, "tUnit")(), false)), "$print"), procEntry("println", sch([0], proc1(tv(0), $field(TY, "tUnit")(), false)), "$println"), nodeProc("eprint", sch([0], proc1(tv(0), $field(TY, "tUnit")(), false)), "$eprint"), nodeProc("eprintln", sch([0], proc1(tv(0), $field(TY, "tUnit")(), false)), "$eprintln"), procEntry("flushStdout", sch([], proc0($field(TY, "tUnit")(), false)), "$flushStdout"), nodeProc("scanln", sch([], proc0(optionOf($field(TY, "tStr")()), false)), "$scanln"), nodeProc("scanChar", sch([], proc0(optionOf($field(TY, "tChar")()), false)), "$scanChar"), nodeProc("scriptArgs", sch([], proc0(listOf($field(TY, "tStr")()), false)), "$scriptArgs"), nodeProc("getEnv", sch([], proc1($field(TY, "tStr")(), optionOf($field(TY, "tStr")()), false)), "$getEnv"), nodeProc("runNodeBundle", sch([], proc2($field(TY, "tStr")(), listOf($field(TY, "tStr")()), ioResult($field(TY, "tInt")()), false)), "$runNodeBundle"), nodeProc("exit", sch([], proc1($field(TY, "tInt")(), $field(TY, "tUnit")(), false)), "$exit"), nodeProc("envVars", sch([], proc0(dictOf($field(TY, "tStr")(), $field(TY, "tStr")()), false)), "$envVars")];
    }
    function fileExports() {
      const handle = $field(TY, "tNamed")("FileHandle", []);
      const mode = $field(TY, "tNamed")("FileMode", []);
      const buffer = $field(TY, "tNamed")("Buffer", []);
      const bufferMode = $field(TY, "tNamed")("BufferMode", []);
      const charRead = $field(TY, "tNamed")("ReadResult", [$field(TY, "tChar")(), $field(TY, "tStr")()]);
      const lineRead = $field(TY, "tNamed")("ReadResult", [$field(TY, "tStr")(), $field(TY, "tStr")()]);
      const byteRead = $field(TY, "tNamed")("ReadResult", [$field(TY, "tByte")(), $field(TY, "tStr")()]);
      const bytesRead = $field(TY, "tNamed")("ReadResult", [listOf($field(TY, "tByte")()), $field(TY, "tStr")()]);
      return [nodeProc("readFile", sch([], proc1($field(TY, "tStr")(), ioResult($field(TY, "tStr")()), false)), "$readFile"), nodeProc("writeFile", sch([], proc2($field(TY, "tStr")(), $field(TY, "tStr")(), ioResult($field(TY, "tUnit")()), false)), "$writeFile"), nodeProc("fileExists", sch([], proc1($field(TY, "tStr")(), $field(TY, "tBool")(), false)), "$fileExists"), nodeProc("mkdirP", sch([], proc1($field(TY, "tStr")(), ioResult($field(TY, "tUnit")()), false)), "$mkdirP"), nodeProc("removeFile", sch([], proc1($field(TY, "tStr")(), ioResult($field(TY, "tUnit")()), false)), "$removeFile"), nodeProc("fileOpen", sch([], proc2($field(TY, "tStr")(), mode, ioResult(handle), false)), "$fileOpen"), nodeProc("fileClose", sch([], proc1(handle, ioResult($field(TY, "tUnit")()), false)), "$fileClose"), nodeProc("readChar", sch([], proc1(handle, charRead, false)), "$readChar"), nodeProc("readLine", sch([], proc1(handle, lineRead, false)), "$readLine"), nodeProc("readByte", sch([], proc1(handle, byteRead, false)), "$readByte"), nodeProc("readBytes", sch([], proc2(handle, $field(TY, "tInt")(), bytesRead, false)), "$readBytes"), nodeProc("writeChar", sch([], proc2(handle, $field(TY, "tChar")(), ioResult($field(TY, "tUnit")()), false)), "$writeChar"), nodeProc("writeLine", sch([], proc2(handle, $field(TY, "tStr")(), ioResult($field(TY, "tUnit")()), false)), "$writeLine"), nodeProc("writeByte", sch([], proc2(handle, $field(TY, "tByte")(), ioResult($field(TY, "tUnit")()), false)), "$writeByte"), nodeProc("writeBytes", sch([], proc2(handle, listOf($field(TY, "tByte")()), ioResult($field(TY, "tUnit")()), false)), "$writeBytes"), nodeProc("readBuffer", sch([], proc3(handle, $field(TY, "tInt")(), bufferMode, ioResult(buffer), false)), "$readBuffer"), nodeProc("writeBuffer", sch([], proc2(handle, buffer, ioResult($field(TY, "tUnit")()), false)), "$writeBuffer"), nodeProc("makeBuffer", sch([], proc1(bufferMode, buffer, false)), "$makeBuffer"), nodeProc("makeStringBuffer", sch([], proc0(buffer, false)), "$makeStringBuffer"), nodeProc("appendBuffer", sch([], proc2(buffer, $field(TY, "tByte")(), $field(TY, "tUnit")(), false)), "$appendBuffer"), nodeProc("appendChar", sch([], proc2(buffer, $field(TY, "tChar")(), $field(TY, "tUnit")(), false)), "$appendChar"), nodeProc("appendString", sch([], proc2(buffer, $field(TY, "tStr")(), $field(TY, "tUnit")(), false)), "$appendString"), nodePure("bufferLength", sch([], fn1(buffer, $field(TY, "tInt")())), "$bufferLength"), nodePure("bufferToBytes", sch([], fn1(buffer, listOf($field(TY, "tByte")()))), "$bufferToBytes"), nodePure("bufferToString", sch([], fn1(buffer, $field(TY, "tStr")())), "$bufferToString")];
    }
    function jsonExports() {
      return [pure("jsonSerialize", sch([0], fn1(tv(0), optionOf($field(TY, "tStr")()))), "$jsonSerialize"), pure("jsonDeserialize", sch([0], fn1($field(TY, "tStr")(), optionOf(tv(0)))), "$jsonDeserialize"), pure("jsonDeserializeAs", sch([0], fn2($field(TY, "tStr")(), tv(0), optionOf(tv(0)))), "$jsonDeserialize")];
    }
    function asyncExports() {
      return [procEntry("sleep", sch([], proc1($field(TY, "tInt")(), $field(TY, "tUnit")(), true)), "$sleep")];
    }
    function mathExports() {
      return [pure("pi", sch([], fn1($field(TY, "tUnit")(), $field(TY, "tFloat")())), "$pi"), pure("e", sch([], fn1($field(TY, "tUnit")(), $field(TY, "tFloat")())), "$e"), pure("tau", sch([], fn1($field(TY, "tUnit")(), $field(TY, "tFloat")())), "$tau"), pure("sqrt", sch([], fn1($field(TY, "tFloat")(), $field(TY, "tFloat")())), "$sqrt"), pure("pow", sch([], fn2($field(TY, "tFloat")(), $field(TY, "tFloat")(), $field(TY, "tFloat")())), "$pow"), pure("abs", sch([], fn1($field(TY, "tInt")(), $field(TY, "tInt")())), "$absInt"), pure("min", sch([], fn2($field(TY, "tInt")(), $field(TY, "tInt")(), $field(TY, "tInt")())), "$minInt"), pure("max", sch([], fn2($field(TY, "tInt")(), $field(TY, "tInt")(), $field(TY, "tInt")())), "$maxInt")];
    }
    function coreModuleSpec() {
      return builtinModule("$builtin/core", coreExports(), [builtinUnion("Option", optionVariants()), builtinUnion("Result", resultVariants())]);
    }
    function ioModuleSpec() {
      return builtinModule("io", ioExports(), []);
    }
    function fileModuleSpec() {
      return builtinModule("file", fileExports(), [builtinUnion("FileMode", fileModeVariants()), builtinUnion("BufferMode", bufferModeVariants()), builtinUnion("ReadResult", readResultVariants()), builtinUnion("Result", resultVariants())]);
    }
    function jsonModuleSpec() {
      return builtinModule("json", jsonExports(), []);
    }
    function asyncModuleSpec() {
      return builtinModule("async", asyncExports(), []);
    }
    function mathModuleSpec() {
      return builtinModule("math", mathExports(), []);
    }
    function allModuleSpecs() {
      return [coreModuleSpec(), ioModuleSpec(), fileModuleSpec(), jsonModuleSpec(), asyncModuleSpec(), mathModuleSpec()];
    }
    function addEntryToIface(iface, entry) {
      const iface1 = $field(I, "putKind")(iface, $field(entry, "name"), $field(entry, "kind"));
      return $field(I, "putType")(iface1, $field(entry, "name"), $field(entry, "scheme"));
    }
    function addEntriesToIface(entries, iface) {
      return (($match$2094) => {
        if ($match$2094.$t === "None") {
          return iface;
        }
        if ($match$2094.$t === "Some") {
          const cell = $match$2094;
          return (() => {
            const p = cell.f[0];
            return addEntriesToIface(p.f[1], addEntryToIface(iface, p.f[0]));
          })();
        }
        throw $matchFail("src/builtins/spec.pf", 2094);
      })($field(Compat, "uncons")(entries));
    }
    function addUnionToIface(iface, uni) {
      return $field(I, "putUnion")($field(I, "putKind")(iface, $field(uni, "name"), $field(I, "kType")()), $field(uni, "name"), $field(uni, "variants"));
    }
    function addUnionsToIface(unions, iface) {
      return (($match$2134) => {
        if ($match$2134.$t === "None") {
          return iface;
        }
        if ($match$2134.$t === "Some") {
          const cell = $match$2134;
          return (() => {
            const p = cell.f[0];
            return addUnionsToIface(p.f[1], addUnionToIface(iface, p.f[0]));
          })();
        }
        throw $matchFail("src/builtins/spec.pf", 2134);
      })($field(Compat, "uncons")(unions));
    }
    function ifaceOfSpec(spec) {
      const iface0 = $field(spec, "path") === "$builtin/core" ? coreTypeIface() : $field(I, "emptyIface")($field(spec, "path"));
      const iface1 = addEntriesToIface($field(spec, "exports"), iface0);
      return addUnionsToIface($field(spec, "unions"), iface1);
    }
    function putSpecIface(m, spec) {
      const iface = ifaceOfSpec(spec);
      const m1 = $field(IMS, "imsPut")(m, spec.f[0], iface);
      const m2 = spec.f[0] === "$builtin/core" ? $field(IMS, "imsPut")(m1, "core", iface) : m1;
      return m2;
    }
    function allBuiltinIfaces() {
      return $reduce((m, spec) => putSpecIface(m, spec), $field(IMS, "imsEmpty")(), allModuleSpecs());
    }
    function builtinNames() {
      return $map((spec) => spec.f[0], allModuleSpecs());
    }
    function lookupBuiltinIface(name) {
      return $field(IMS, "imsGet")(allBuiltinIfaces(), name);
    }
    function ambientIntrinsics() {
      return (($match$2245) => {
        if ($match$2245.$t === "None") {
          return $field(IMS, "imsEmpty")();
        }
        if ($match$2245.$t === "Some") {
          const spec = $match$2245;
          return intrinsicsOfExports($field(spec.f[0], "exports"), $field(IMS, "imsEmpty")());
        }
        throw $matchFail("src/builtins/spec.pf", 2245);
      })(findModuleSpec("$builtin/core"));
    }
    function intrinsicsOfExports(exports, acc) {
      return (($match$2263) => {
        if ($match$2263.$t === "None") {
          return acc;
        }
        if ($match$2263.$t === "Some") {
          const cell = $match$2263;
          return (() => {
            const e = cell.f[0].f[0];
            return intrinsicsOfExports(cell.f[0].f[1], $field(IMS, "imsPut")(acc, $field(e, "name"), $field(e, "intrinsic")));
          })();
        }
        throw $matchFail("src/builtins/spec.pf", 2263);
      })($field(Compat, "uncons")(exports));
    }
    function intrinsicName(moduleName, exportName) {
      return (($match$2290) => {
        if ($match$2290.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$2290.$t === "Some") {
          const spec = $match$2290;
          return findIntrinsic($field(spec.f[0], "exports"), exportName);
        }
        throw $matchFail("src/builtins/spec.pf", 2290);
      })(findModuleSpec(moduleName));
    }
    function findModuleSpec(name) {
      return findModuleSpecLoop(allModuleSpecs(), name);
    }
    function findModuleSpecLoop(specs, name) {
      return (($match$2311) => {
        if ($match$2311.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$2311.$t === "Some") {
          const cell = $match$2311;
          return (() => {
            const p = cell.f[0];
            if ($field(p.f[0], "path") === name) {
              return $makeVariant("Some", "Option", ["value"], [p.f[0]]);
            } else {
              return findModuleSpecLoop(p.f[1], name);
            }
          })();
        }
        throw $matchFail("src/builtins/spec.pf", 2311);
      })($field(Compat, "uncons")(specs));
    }
    function findIntrinsic(entries, name) {
      return (($match$2339) => {
        if ($match$2339.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$2339.$t === "Some") {
          const cell = $match$2339;
          return (() => {
            const p = cell.f[0];
            if ($eq($field(p.f[0], "name"), name)) {
              return $makeVariant("Some", "Option", ["value"], [$field(p.f[0], "intrinsic")]);
            } else {
              return findIntrinsic(p.f[1], name);
            }
          })();
        }
        throw $matchFail("src/builtins/spec.pf", 2339);
      })($field(Compat, "uncons")(entries));
    }
    exports["PlatformAll"] = PlatformAll;
    exports["PlatformNode"] = PlatformNode;
    exports["PlatformBrowser"] = PlatformBrowser;
    exports["platformAll"] = platformAll;
    exports["platformNode"] = platformNode;
    exports["platformBrowser"] = platformBrowser;
    exports["builtinEntry"] = builtinEntry;
    exports["builtinUnion"] = builtinUnion;
    exports["builtinModule"] = builtinModule;
    exports["coreModuleSpec"] = coreModuleSpec;
    exports["ioModuleSpec"] = ioModuleSpec;
    exports["fileModuleSpec"] = fileModuleSpec;
    exports["jsonModuleSpec"] = jsonModuleSpec;
    exports["asyncModuleSpec"] = asyncModuleSpec;
    exports["mathModuleSpec"] = mathModuleSpec;
    exports["allModuleSpecs"] = allModuleSpecs;
    exports["ifaceOfSpec"] = ifaceOfSpec;
    exports["allBuiltinIfaces"] = allBuiltinIfaces;
    exports["builtinNames"] = builtinNames;
    exports["lookupBuiltinIface"] = lookupBuiltinIface;
    exports["ambientIntrinsics"] = ambientIntrinsics;
    exports["intrinsicName"] = intrinsicName;
  });
  $registerSchemas([{name: "JsProp", union: null, fields: ["name", "value"], variant: false}, {name: "JNum", union: "JsExpr", fields: ["raw"], variant: true}, {name: "JBig", union: "JsExpr", fields: ["digits"], variant: true}, {name: "JStr", union: "JsExpr", fields: ["s"], variant: true}, {name: "JBool", union: "JsExpr", fields: ["b"], variant: true}, {name: "JNull", union: "JsExpr", fields: [], variant: true}, {name: "JId", union: "JsExpr", fields: ["name"], variant: true}, {name: "JArr", union: "JsExpr", fields: ["elems"], variant: true}, {name: "JObj", union: "JsExpr", fields: ["props"], variant: true}, {name: "JArrow", union: "JsExpr", fields: ["params", "body", "isAsync"], variant: true}, {name: "JCall", union: "JsExpr", fields: ["callee", "args"], variant: true}, {name: "JNew", union: "JsExpr", fields: ["callee", "args"], variant: true}, {name: "JMember", union: "JsExpr", fields: ["obj", "fname"], variant: true}, {name: "JIndex", union: "JsExpr", fields: ["obj", "idx"], variant: true}, {name: "JBin", union: "JsExpr", fields: ["op", "l", "r"], variant: true}, {name: "JLogic", union: "JsExpr", fields: ["op", "l", "r"], variant: true}, {name: "JUn", union: "JsExpr", fields: ["op", "e"], variant: true}, {name: "JCond", union: "JsExpr", fields: ["c", "t", "e"], variant: true}, {name: "JAssignE", union: "JsExpr", fields: ["target", "value"], variant: true}, {name: "JAwait", union: "JsExpr", fields: ["e"], variant: true}, {name: "JbExpr", union: "JsBody", fields: ["e"], variant: true}, {name: "JbBlock", union: "JsBody", fields: ["stmts"], variant: true}, {name: "JsExprS", union: "JsStmt", fields: ["e"], variant: true}, {name: "JsConst", union: "JsStmt", fields: ["name", "init"], variant: true}, {name: "JsLet", union: "JsStmt", fields: ["name", "init"], variant: true}, {name: "JsAssign", union: "JsStmt", fields: ["target", "value"], variant: true}, {name: "JsIf", union: "JsStmt", fields: ["c", "thenB", "elseB"], variant: true}, {name: "JsWhile", union: "JsStmt", fields: ["c", "body"], variant: true}, {name: "JsRet", union: "JsStmt", fields: ["value"], variant: true}, {name: "JsFun", union: "JsStmt", fields: ["name", "params", "body", "isAsync"], variant: true}, {name: "JsTry", union: "JsStmt", fields: ["body", "catchName", "handler"], variant: true}, {name: "JsThrow", union: "JsStmt", fields: ["e"], variant: true}, {name: "JsBreak", union: "JsStmt", fields: [], variant: true}, {name: "JsContinue", union: "JsStmt", fields: [], variant: true}, {name: "JsBlock", union: "JsStmt", fields: ["body"], variant: true}, {name: "JsLabel", union: "JsStmt", fields: ["name", "body"], variant: true}]);
  $maps["src/compile/js"] = {"../data/strx": "src/data/strx"};
  $mods["src/compile/js"] = ((exports, $require) => {
    const StrX = $require("../data/strx");
    function JNum(raw) {
      return $makeVariant("JNum", "JsExpr", ["raw"], [raw]);
    }
    function JBig(digits) {
      return $makeVariant("JBig", "JsExpr", ["digits"], [digits]);
    }
    function JStr(s) {
      return $makeVariant("JStr", "JsExpr", ["s"], [s]);
    }
    function JBool(b) {
      return $makeVariant("JBool", "JsExpr", ["b"], [b]);
    }
    const JNull = $makeVariant("JNull", "JsExpr", [], []);
    function JId(name) {
      return $makeVariant("JId", "JsExpr", ["name"], [name]);
    }
    function JArr(elems) {
      return $makeVariant("JArr", "JsExpr", ["elems"], [elems]);
    }
    function JObj(props) {
      return $makeVariant("JObj", "JsExpr", ["props"], [props]);
    }
    function JArrow(params, body, isAsync) {
      return $makeVariant("JArrow", "JsExpr", ["params", "body", "isAsync"], [params, body, isAsync]);
    }
    function JCall(callee, args) {
      return $makeVariant("JCall", "JsExpr", ["callee", "args"], [callee, args]);
    }
    function JNew(callee, args) {
      return $makeVariant("JNew", "JsExpr", ["callee", "args"], [callee, args]);
    }
    function JMember(obj, fname) {
      return $makeVariant("JMember", "JsExpr", ["obj", "fname"], [obj, fname]);
    }
    function JIndex(obj, idx) {
      return $makeVariant("JIndex", "JsExpr", ["obj", "idx"], [obj, idx]);
    }
    function JBin(op, l, r) {
      return $makeVariant("JBin", "JsExpr", ["op", "l", "r"], [op, l, r]);
    }
    function JLogic(op, l, r) {
      return $makeVariant("JLogic", "JsExpr", ["op", "l", "r"], [op, l, r]);
    }
    function JUn(op, e) {
      return $makeVariant("JUn", "JsExpr", ["op", "e"], [op, e]);
    }
    function JCond(c, t, e) {
      return $makeVariant("JCond", "JsExpr", ["c", "t", "e"], [c, t, e]);
    }
    function JAssignE(target, value) {
      return $makeVariant("JAssignE", "JsExpr", ["target", "value"], [target, value]);
    }
    function JAwait(e) {
      return $makeVariant("JAwait", "JsExpr", ["e"], [e]);
    }
    function JbExpr(e) {
      return $makeVariant("JbExpr", "JsBody", ["e"], [e]);
    }
    function JbBlock(stmts) {
      return $makeVariant("JbBlock", "JsBody", ["stmts"], [stmts]);
    }
    function JsExprS(e) {
      return $makeVariant("JsExprS", "JsStmt", ["e"], [e]);
    }
    function JsConst(name, init) {
      return $makeVariant("JsConst", "JsStmt", ["name", "init"], [name, init]);
    }
    function JsLet(name, init) {
      return $makeVariant("JsLet", "JsStmt", ["name", "init"], [name, init]);
    }
    function JsAssign(target, value) {
      return $makeVariant("JsAssign", "JsStmt", ["target", "value"], [target, value]);
    }
    function JsIf(c, thenB, elseB) {
      return $makeVariant("JsIf", "JsStmt", ["c", "thenB", "elseB"], [c, thenB, elseB]);
    }
    function JsWhile(c, body) {
      return $makeVariant("JsWhile", "JsStmt", ["c", "body"], [c, body]);
    }
    function JsRet(value) {
      return $makeVariant("JsRet", "JsStmt", ["value"], [value]);
    }
    function JsFun(name, params, body, isAsync) {
      return $makeVariant("JsFun", "JsStmt", ["name", "params", "body", "isAsync"], [name, params, body, isAsync]);
    }
    function JsTry(body, catchName, handler) {
      return $makeVariant("JsTry", "JsStmt", ["body", "catchName", "handler"], [body, catchName, handler]);
    }
    function JsThrow(e) {
      return $makeVariant("JsThrow", "JsStmt", ["e"], [e]);
    }
    const JsBreak = $makeVariant("JsBreak", "JsStmt", [], []);
    const JsContinue = $makeVariant("JsContinue", "JsStmt", [], []);
    function JsBlock(body) {
      return $makeVariant("JsBlock", "JsStmt", ["body"], [body]);
    }
    function JsLabel(name, body) {
      return $makeVariant("JsLabel", "JsStmt", ["name", "body"], [name, body]);
    }
    function jsTypeWitness() {
      const id = $makeVariant("JId", "JsExpr", ["name"], ["x"]);
      const prop = $makeRecord("JsProp", ["name", "value"], ["p", id]);
      const body = $makeVariant("JbExpr", "JsBody", ["e"], [id]);
      const stmt = JsBreak;
      const expressions = [$makeVariant("JNum", "JsExpr", ["raw"], ["0"]), $makeVariant("JBig", "JsExpr", ["digits"], ["0"]), $makeVariant("JStr", "JsExpr", ["s"], [""]), $makeVariant("JBool", "JsExpr", ["b"], [false]), JNull, id, $makeVariant("JArr", "JsExpr", ["elems"], [[id]]), $makeVariant("JObj", "JsExpr", ["props"], [[prop]]), $makeVariant("JArrow", "JsExpr", ["params", "body", "isAsync"], [["x"], body, false]), $makeVariant("JCall", "JsExpr", ["callee", "args"], [id, [id]]), $makeVariant("JNew", "JsExpr", ["callee", "args"], [id, [id]]), $makeVariant("JMember", "JsExpr", ["obj", "fname"], [id, "p"]), $makeVariant("JIndex", "JsExpr", ["obj", "idx"], [id, id]), $makeVariant("JBin", "JsExpr", ["op", "l", "r"], ["+", id, id]), $makeVariant("JLogic", "JsExpr", ["op", "l", "r"], ["&&", id, id]), $makeVariant("JUn", "JsExpr", ["op", "e"], ["!", id]), $makeVariant("JCond", "JsExpr", ["c", "t", "e"], [id, id, id]), $makeVariant("JAssignE", "JsExpr", ["target", "value"], [id, id]), $makeVariant("JAwait", "JsExpr", ["e"], [id])];
      const bodies = [body, $makeVariant("JbBlock", "JsBody", ["stmts"], [[stmt]])];
      return [$makeVariant("JsExprS", "JsStmt", ["e"], [id]), $makeVariant("JsConst", "JsStmt", ["name", "init"], ["x", id]), $makeVariant("JsLet", "JsStmt", ["name", "init"], ["x", id]), $makeVariant("JsAssign", "JsStmt", ["target", "value"], [id, id]), $makeVariant("JsIf", "JsStmt", ["c", "thenB", "elseB"], [id, [stmt], [stmt]]), $makeVariant("JsWhile", "JsStmt", ["c", "body"], [id, [stmt]]), $makeVariant("JsRet", "JsStmt", ["value"], [id]), $makeVariant("JsFun", "JsStmt", ["name", "params", "body", "isAsync"], ["f", ["x"], [stmt], false]), $makeVariant("JsTry", "JsStmt", ["body", "catchName", "handler"], [[stmt], "e", [stmt]]), $makeVariant("JsThrow", "JsStmt", ["e"], [id]), JsBreak, JsContinue, $makeVariant("JsBlock", "JsStmt", ["body"], [[stmt]]), $makeVariant("JsLabel", "JsStmt", ["name", "body"], ["label", [stmt]])];
    }
    function jsProp(name, value) {
      return $makeRecord("JsProp", ["name", "value"], [name, value]);
    }
    function jsNum(raw) {
      return $makeVariant("JNum", "JsExpr", ["raw"], [raw]);
    }
    function jsBig(digits) {
      return $makeVariant("JBig", "JsExpr", ["digits"], [digits]);
    }
    function jsStr(s) {
      return $makeVariant("JStr", "JsExpr", ["s"], [s]);
    }
    function jsBool(b) {
      return $makeVariant("JBool", "JsExpr", ["b"], [b]);
    }
    function jsNull() {
      return JNull;
    }
    function jsId(name) {
      return $makeVariant("JId", "JsExpr", ["name"], [name]);
    }
    function jsArr(elems) {
      return $makeVariant("JArr", "JsExpr", ["elems"], [elems]);
    }
    function jsObj(props) {
      return $makeVariant("JObj", "JsExpr", ["props"], [props]);
    }
    function jsExprBody(e) {
      return $makeVariant("JbExpr", "JsBody", ["e"], [e]);
    }
    function jsBlockBody(stmts) {
      return $makeVariant("JbBlock", "JsBody", ["stmts"], [stmts]);
    }
    function jsArrow(params, body, isAsync) {
      return $makeVariant("JArrow", "JsExpr", ["params", "body", "isAsync"], [params, body, isAsync]);
    }
    function jsCall(callee, args) {
      return $makeVariant("JCall", "JsExpr", ["callee", "args"], [callee, args]);
    }
    function jsNew(callee, args) {
      return $makeVariant("JNew", "JsExpr", ["callee", "args"], [callee, args]);
    }
    function jsMember(obj, fname) {
      return $makeVariant("JMember", "JsExpr", ["obj", "fname"], [obj, fname]);
    }
    function jsIndex(obj, idx) {
      return $makeVariant("JIndex", "JsExpr", ["obj", "idx"], [obj, idx]);
    }
    function jsBin(op, l, r) {
      return $makeVariant("JBin", "JsExpr", ["op", "l", "r"], [op, l, r]);
    }
    function jsLogic(op, l, r) {
      return $makeVariant("JLogic", "JsExpr", ["op", "l", "r"], [op, l, r]);
    }
    function jsUn(op, e) {
      return $makeVariant("JUn", "JsExpr", ["op", "e"], [op, e]);
    }
    function jsCond(c, t, e) {
      return $makeVariant("JCond", "JsExpr", ["c", "t", "e"], [c, t, e]);
    }
    function jsAssignExpr(target, value) {
      return $makeVariant("JAssignE", "JsExpr", ["target", "value"], [target, value]);
    }
    function jsAwait(e) {
      return $makeVariant("JAwait", "JsExpr", ["e"], [e]);
    }
    function jsExprStmt(e) {
      return $makeVariant("JsExprS", "JsStmt", ["e"], [e]);
    }
    function jsConst(name, init) {
      return $makeVariant("JsConst", "JsStmt", ["name", "init"], [name, init]);
    }
    function jsLet(name, init) {
      return $makeVariant("JsLet", "JsStmt", ["name", "init"], [name, init]);
    }
    function jsAssign(target, value) {
      return $makeVariant("JsAssign", "JsStmt", ["target", "value"], [target, value]);
    }
    function jsIf(c, thenB, elseB) {
      return $makeVariant("JsIf", "JsStmt", ["c", "thenB", "elseB"], [c, thenB, elseB]);
    }
    function jsWhile(c, body) {
      return $makeVariant("JsWhile", "JsStmt", ["c", "body"], [c, body]);
    }
    function jsRet(value) {
      return $makeVariant("JsRet", "JsStmt", ["value"], [value]);
    }
    function jsFun(name, params, body, isAsync) {
      return $makeVariant("JsFun", "JsStmt", ["name", "params", "body", "isAsync"], [name, params, body, isAsync]);
    }
    function jsTry(body, catchName, handler) {
      return $makeVariant("JsTry", "JsStmt", ["body", "catchName", "handler"], [body, catchName, handler]);
    }
    function jsThrow(e) {
      return $makeVariant("JsThrow", "JsStmt", ["e"], [e]);
    }
    function jsBreak() {
      return JsBreak;
    }
    function jsContinue() {
      return JsContinue;
    }
    function jsBlock(body) {
      return $makeVariant("JsBlock", "JsStmt", ["body"], [body]);
    }
    function jsLabel(name, body) {
      return $makeVariant("JsLabel", "JsStmt", ["name", "body"], [name, body]);
    }
    function jsIsDigit(c) {
      return c >= "0" && c <= "9";
    }
    function jsIsLower(c) {
      return c >= "a" && c <= "z";
    }
    function jsIsUpper(c) {
      return c >= "A" && c <= "Z";
    }
    function jsIsIdentStart(c) {
      return jsIsLower(c) || jsIsUpper(c) || c === "_" || c === "$";
    }
    function jsIsIdentPart(c) {
      return jsIsIdentStart(c) || jsIsDigit(c);
    }
    function jsValidIdentFrom(name, i) {
      while (true) {
        if ($geI(i, $length(name))) {
          return true;
        } else {
          const c = $slice(i, 1, name);
          const ok = $eqI(i, 0) ? jsIsIdentStart(c) : jsIsIdentPart(c);
          if (ok) {
            const $tc$422$0 = name;
            const $tc$422$1 = $addI(i, 1);
            name = $tc$422$0;
            i = $tc$422$1;
            continue;
          } else {
            return false;
          }
        }
      }
    }
    function jsIsIdentifierName(name) {
      return $gtI($length(name), 0) && jsValidIdentFrom(name, 0);
    }
    function jsStartsWith(name, prefix) {
      if ($gtI($length(prefix), $length(name))) {
        return false;
      } else {
        return $eq($slice(0, $length(prefix), name), prefix);
      }
    }
    function jsIsReserved(name) {
      return name === "await" || name === "break" || name === "case" || name === "catch" || name === "class" || name === "const" || name === "continue" || name === "debugger" || name === "default" || name === "delete" || name === "do" || name === "else" || name === "enum" || name === "export" || name === "extends" || name === "false" || name === "finally" || name === "for" || name === "function" || name === "if" || name === "implements" || name === "import" || name === "in" || name === "instanceof" || name === "interface" || name === "let" || name === "new" || name === "null" || name === "package" || name === "private" || name === "protected" || name === "public" || name === "return" || name === "static" || name === "super" || name === "switch" || name === "this" || name === "throw" || name === "true" || name === "try" || name === "typeof" || name === "var" || name === "void" || name === "while" || name === "with" || name === "yield" || name === "arguments" || name === "eval";
    }
    function jsFindCharCode(c, code, last) {
      while (true) {
        if ($gtI(code, last)) {
          return $negI(1);
        } else {
          if (c === $str($chrU(code))) {
            return code;
          } else {
            const $tc$676$0 = c;
            const $tc$676$1 = $addI(code, 1);
            const $tc$676$2 = last;
            c = $tc$676$0;
            code = $tc$676$1;
            last = $tc$676$2;
            continue;
          }
        }
      }
    }
    function jsAsciiCode(c) {
      const code = jsFindCharCode(c, 0, 127);
      return $geI(code, 0) ? code : 63;
    }
    function jsEncodeName(name) {
      if ($eqI($length(name), 0)) {
        return "$pf$empty";
      } else {
        return $concatS("$pf$", $join($map((c) => $str(jsAsciiCode(c)), $split(name, "")), "_"));
      }
    }
    function mangle(name) {
      if (jsIsIdentifierName(name) && !jsIsReserved(name) && !jsStartsWith(name, "$pf$")) {
        return name;
      } else {
        return jsEncodeName(name);
      }
    }
    function jsHexDigit(n) {
      if ($ltI(n, 10)) {
        return $str(n);
      } else {
        if ($eqI(n, 10)) {
          return "a";
        } else {
          if ($eqI(n, 11)) {
            return "b";
          } else {
            if ($eqI(n, 12)) {
              return "c";
            } else {
              if ($eqI(n, 13)) {
                return "d";
              } else {
                if ($eqI(n, 14)) {
                  return "e";
                } else {
                  return "f";
                }
              }
            }
          }
        }
      }
    }
    function jsHex4(n) {
      return $concatS($concatS($concatS(jsHexDigit($modI($divI(n, 4096), 16)), jsHexDigit($modI($divI(n, 256), 16))), jsHexDigit($modI($divI(n, 16), 16))), jsHexDigit($modI(n, 16)));
    }
    function jsControlCode(c) {
      const code = jsFindCharCode(c, 0, 31);
      if ($geI(code, 0)) {
        return code;
      } else {
        if (c === $str($chrU(127))) {
          return 127;
        } else {
          return $negI(1);
        }
      }
    }
    function jsEscapeChar(c) {
      if (c === "\\") {
        return "\\\\";
      } else {
        if (c === "\"") {
          return "\\\"";
        } else {
          if (c === "\n") {
            return "\\n";
          } else {
            if (c === "\t") {
              return "\\t";
            } else {
              if (c === $str($chrU(13))) {
                return "\\r";
              } else {
                if (c === $str($chrU(8))) {
                  return "\\b";
                } else {
                  if (c === $str($chrU(12))) {
                    return "\\f";
                  } else {
                    const control = jsControlCode(c);
                    if ($geI(control, 0)) {
                      return $concatS("\\u", jsHex4(control));
                    } else {
                      if (c === $str($chrU(8232))) {
                        return "\\u2028";
                      } else {
                        if (c === $str($chrU(8233))) {
                          return "\\u2029";
                        } else {
                          return c;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    function jsQuoteString(s) {
      return $concatS($concatS("\"", $join($map(jsEscapeChar, $split(s, "")), "")), "\"");
    }
    function jsNormalizeNumber(raw) {
      if (jsStartsWith(raw, ".")) {
        return $concatS("0", raw);
      } else {
        if (jsStartsWith(raw, "-.")) {
          return $concatS("-0", $slice(1, $subI($length(raw), 1), raw));
        } else {
          if (jsStartsWith(raw, "+.")) {
            return $concatS("+0", $slice(1, $subI($length(raw), 1), raw));
          } else {
            return raw;
          }
        }
      }
    }
    function jsLogicPrec(op) {
      if (op === "||" || op === "??") {
        return 4;
      } else {
        return 5;
      }
    }
    function jsBinPrec(op) {
      if (op === "|") {
        return 6;
      } else {
        if (op === "^") {
          return 7;
        } else {
          if (op === "&") {
            return 8;
          } else {
            if (op === "==" || op === "!=" || op === "===" || op === "!==") {
              return 9;
            } else {
              if (op === "<" || op === ">" || op === "<=" || op === ">=" || op === "in" || op === "instanceof") {
                return 10;
              } else {
                if (op === "<<" || op === ">>" || op === ">>>") {
                  return 11;
                } else {
                  if (op === "+" || op === "-") {
                    return 12;
                  } else {
                    if (op === "*" || op === "/" || op === "%") {
                      return 13;
                    } else {
                      if (op === "**") {
                        return 14;
                      } else {
                        return 12;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    function prec(e) {
      return (($match$1121) => {
        if ($match$1121.$t === "JArrow") {
          return 1;
        }
        if ($match$1121.$t === "JAssignE") {
          return 2;
        }
        if ($match$1121.$t === "JCond") {
          return 3;
        }
        if ($match$1121.$t === "JLogic") {
          const x = $match$1121;
          return jsLogicPrec(x.f[0]);
        }
        if ($match$1121.$t === "JBin") {
          const x = $match$1121;
          return jsBinPrec(x.f[0]);
        }
        if ($match$1121.$t === "JUn") {
          return 15;
        }
        if ($match$1121.$t === "JAwait") {
          return 15;
        }
        if ($match$1121.$t === "JCall") {
          return 18;
        }
        if ($match$1121.$t === "JNew") {
          return 18;
        }
        if ($match$1121.$t === "JMember") {
          return 19;
        }
        if ($match$1121.$t === "JIndex") {
          return 19;
        }
        if (true) {
          return 20;
        }
        throw $matchFail("src/compile/js.pf", 1121);
      })(e);
    }
    function jsNeedsNumericReceiverParens(e) {
      return (($match$1143) => {
        if ($match$1143.$t === "JNum") {
          return true;
        }
        if ($match$1143.$t === "JBig") {
          return true;
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/compile/js.pf", 1143);
      })(e);
    }
    function jsExprStartsWithObject(e) {
      while (true) {
        const $match$1150 = e;
        if ($match$1150.$t === "JObj") {
          return true;
        }
        if ($match$1150.$t === "JMember") {
          const x = $match$1150;
          const $tc$1156$0 = x.f[0];
          e = $tc$1156$0;
          continue;
        }
        if ($match$1150.$t === "JIndex") {
          const x = $match$1150;
          const $tc$1160$0 = x.f[0];
          e = $tc$1160$0;
          continue;
        }
        if ($match$1150.$t === "JCall") {
          const x = $match$1150;
          const $tc$1164$0 = x.f[0];
          e = $tc$1164$0;
          continue;
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/compile/js.pf", 1150);
      }
    }
    function jsExprStmtNeedsParens(e) {
      return jsExprStartsWithObject(e);
    }
    function jsExponentLeftNeedsParens(e) {
      return (($match$1173) => {
        if ($match$1173.$t === "JUn") {
          return true;
        }
        if ($match$1173.$t === "JAwait") {
          return true;
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/compile/js.pf", 1173);
      })(e);
    }
    function jsUnaryNeedsSpace(op, e) {
      if (op === "typeof" || op === "void" || op === "delete") {
        return true;
      } else {
        return (($match$1193) => {
          if ($match$1193.$t === "JUn") {
            const child = $match$1193;
            return (() => {
              return op === "+" && child.f[0] === "+" || op === "-" && child.f[0] === "-";
            })();
          }
          if (true) {
            return false;
          }
          throw $matchFail("src/compile/js.pf", 1193);
        })(e);
      }
    }
    function jsPrintUnary(op, e, indent) {
      const sep = jsUnaryNeedsSpace(op, e) ? " " : "";
      return $concatS($concatS(op, sep), jsPrintExprAt(e, 15, false, indent));
    }
    function jsPrintParams(params) {
      return $concatS($concatS("(", $join($map(mangle, params), ", ")), ")");
    }
    function jsPrintPropName(name) {
      if (name === "__proto__") {
        return $concatS($concatS("[", jsQuoteString(name)), "]");
      } else {
        if (jsIsIdentifierName(name)) {
          return name;
        } else {
          return jsQuoteString(name);
        }
      }
    }
    function jsPrintProp(prop, indent) {
      return $concatS($concatS(jsPrintPropName(prop.f[0]), ": "), jsPrintExprAt(prop.f[1], 0, false, indent));
    }
    function jsPrintBlock(stmts, indent) {
      if ($eqI($length(stmts), 0)) {
        return "{}";
      } else {
        return $concatS($concatS($concatS($concatS("{\n", $join($map((s) => printStmt(s, $addI(indent, 1)), stmts), "\n")), "\n"), $field(StrX, "strRepeat")(" ", $mulI(indent, 2))), "}");
      }
    }
    function jsPrintArrowBody(body, indent) {
      return (($match$1329) => {
        if ($match$1329.$t === "JbExpr") {
          const b = $match$1329;
          return (() => {
            return (($match$1332) => {
              if ($match$1332.$t === "JObj") {
                return $concatS($concatS("(", jsPrintExprAt(b.f[0], 0, false, indent)), ")");
              }
              if (true) {
                return jsPrintExprAt(b.f[0], 1, false, indent);
              }
              throw $matchFail("src/compile/js.pf", 1332);
            })(b.f[0]);
          })();
        }
        if ($match$1329.$t === "JbBlock") {
          const b = $match$1329;
          return jsPrintBlock(b.f[0], indent);
        }
        throw $matchFail("src/compile/js.pf", 1329);
      })(body);
    }
    function jsPrintBinaryLeft(op, l, own, indent) {
      if (op === "**" && jsExponentLeftNeedsParens(l)) {
        return $concatS($concatS("(", jsPrintExprAt(l, 0, false, indent)), ")");
      } else {
        return jsPrintExprAt(l, own, op === "**", indent);
      }
    }
    function jsPrintBinary(op, l, r, indent) {
      const own = jsBinPrec(op);
      const rightEqualNeedsParens = !(op === "**");
      return $concatS($concatS($concatS($concatS(jsPrintBinaryLeft(op, l, own, indent), " "), op), " "), jsPrintExprAt(r, own, rightEqualNeedsParens, indent));
    }
    function jsLogicMixNeedsParens(parentOp, child) {
      return (($match$1419) => {
        if ($match$1419.$t === "JLogic") {
          const x = $match$1419;
          return (() => {
            return parentOp === "??" && !(x.f[0] === "??") || !(parentOp === "??") && x.f[0] === "??";
          })();
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/compile/js.pf", 1419);
      })(child);
    }
    function jsPrintLogicChild(parentOp, child, own, parenOnEqual, indent) {
      if (jsLogicMixNeedsParens(parentOp, child)) {
        return $concatS($concatS("(", jsPrintExprAt(child, 0, false, indent)), ")");
      } else {
        return jsPrintExprAt(child, own, parenOnEqual, indent);
      }
    }
    function jsPrintLogic(op, l, r, indent) {
      const own = jsLogicPrec(op);
      return $concatS($concatS($concatS($concatS(jsPrintLogicChild(op, l, own, false, indent), " "), op), " "), jsPrintLogicChild(op, r, own, true, indent));
    }
    function jsPrintExprRaw(e, indent) {
      return (($match$1496) => {
        if ($match$1496.$t === "JNum") {
          const x = $match$1496;
          return jsNormalizeNumber(x.f[0]);
        }
        if ($match$1496.$t === "JBig") {
          const x = $match$1496;
          return $concatS(x.f[0], "n");
        }
        if ($match$1496.$t === "JStr") {
          const x = $match$1496;
          return jsQuoteString(x.f[0]);
        }
        if ($match$1496.$t === "JBool") {
          const x = $match$1496;
          return x.f[0] ? "true" : "false";
        }
        if ($match$1496.$t === "JNull") {
          return "null";
        }
        if ($match$1496.$t === "JId") {
          const x = $match$1496;
          return mangle(x.f[0]);
        }
        if ($match$1496.$t === "JArr") {
          const x = $match$1496;
          return (() => {
            return $concatS($concatS("[", $join($map((item) => jsPrintExprAt(item, 0, false, indent), x.f[0]), ", ")), "]");
          })();
        }
        if ($match$1496.$t === "JObj") {
          const x = $match$1496;
          return (() => {
            return $concatS($concatS("{", $join($map((prop) => jsPrintProp(prop, indent), x.f[0]), ", ")), "}");
          })();
        }
        if ($match$1496.$t === "JArrow") {
          const x = $match$1496;
          return (() => {
            const asyncPrefix = x.f[2] ? "async " : "";
            return $concatS($concatS($concatS(asyncPrefix, jsPrintParams(x.f[0])), " => "), jsPrintArrowBody(x.f[1], indent));
          })();
        }
        if ($match$1496.$t === "JCall") {
          const x = $match$1496;
          return (() => {
            return $concatS($concatS($concatS(jsPrintExprAt(x.f[0], 18, false, indent), "("), $join($map((arg) => jsPrintExprAt(arg, 0, false, indent), x.f[1]), ", ")), ")");
          })();
        }
        if ($match$1496.$t === "JNew") {
          const x = $match$1496;
          return (() => {
            return $concatS($concatS($concatS($concatS("new ", jsPrintExprAt(x.f[0], 19, false, indent)), "("), $join($map((arg) => jsPrintExprAt(arg, 0, false, indent), x.f[1]), ", ")), ")");
          })();
        }
        if ($match$1496.$t === "JMember") {
          const x = $match$1496;
          return (() => {
            const receiver = jsNeedsNumericReceiverParens(x.f[0]) ? $concatS($concatS("(", jsPrintExprAt(x.f[0], 0, false, indent)), ")") : jsPrintExprAt(x.f[0], 19, false, indent);
            if (jsIsIdentifierName(x.f[1])) {
              return $concatS($concatS(receiver, "."), x.f[1]);
            } else {
              return $concatS($concatS($concatS(receiver, "["), jsQuoteString(x.f[1])), "]");
            }
          })();
        }
        if ($match$1496.$t === "JIndex") {
          const x = $match$1496;
          return (() => {
            return $concatS($concatS($concatS(jsPrintExprAt(x.f[0], 19, false, indent), "["), jsPrintExprAt(x.f[1], 0, false, indent)), "]");
          })();
        }
        if ($match$1496.$t === "JBin") {
          const x = $match$1496;
          return jsPrintBinary(x.f[0], x.f[1], x.f[2], indent);
        }
        if ($match$1496.$t === "JLogic") {
          const x = $match$1496;
          return jsPrintLogic(x.f[0], x.f[1], x.f[2], indent);
        }
        if ($match$1496.$t === "JUn") {
          const x = $match$1496;
          return jsPrintUnary(x.f[0], x.f[1], indent);
        }
        if ($match$1496.$t === "JCond") {
          const x = $match$1496;
          return (() => {
            return $concatS($concatS($concatS($concatS(jsPrintExprAt(x.f[0], 4, false, indent), " ? "), jsPrintExprAt(x.f[1], 2, false, indent)), " : "), jsPrintExprAt(x.f[2], 3, false, indent));
          })();
        }
        if ($match$1496.$t === "JAssignE") {
          const x = $match$1496;
          return (() => {
            return $concatS($concatS(jsPrintExprAt(x.f[0], 3, false, indent), " = "), jsPrintExprAt(x.f[1], 2, false, indent));
          })();
        }
        if ($match$1496.$t === "JAwait") {
          const x = $match$1496;
          return (() => {
            return $concatS("await ", jsPrintExprAt(x.f[0], 15, false, indent));
          })();
        }
        throw $matchFail("src/compile/js.pf", 1496);
      })(e);
    }
    function jsPrintExprAt(e, parentPrec, parenOnEqual, indent) {
      const own = prec(e);
      const text = jsPrintExprRaw(e, indent);
      if ($ltI(own, parentPrec) || parenOnEqual && $eqI(own, parentPrec)) {
        return $concatS($concatS("(", text), ")");
      } else {
        return text;
      }
    }
    function printExpr(e, parentPrec) {
      return jsPrintExprAt(e, parentPrec, false, 0);
    }
    function jsIndent(indent) {
      return $field(StrX, "strRepeat")(" ", $mulI(indent, 2));
    }
    function printStmt(s, indent) {
      const pad = jsIndent(indent);
      return (($match$1843) => {
        if ($match$1843.$t === "JsExprS") {
          const x = $match$1843;
          return (() => {
            const text = jsPrintExprAt(x.f[0], 0, false, indent);
            const safe = jsExprStmtNeedsParens(x.f[0]) ? $concatS($concatS("(", text), ")") : text;
            return $concatS($concatS(pad, safe), ";");
          })();
        }
        if ($match$1843.$t === "JsConst") {
          const x = $match$1843;
          return (() => {
            return $concatS($concatS($concatS($concatS($concatS(pad, "const "), mangle(x.f[0])), " = "), jsPrintExprAt(x.f[1], 0, false, indent)), ";");
          })();
        }
        if ($match$1843.$t === "JsLet") {
          const x = $match$1843;
          return (() => {
            return $concatS($concatS($concatS($concatS($concatS(pad, "let "), mangle(x.f[0])), " = "), jsPrintExprAt(x.f[1], 0, false, indent)), ";");
          })();
        }
        if ($match$1843.$t === "JsAssign") {
          const x = $match$1843;
          return (() => {
            return $concatS($concatS($concatS($concatS(pad, jsPrintExprAt(x.f[0], 3, false, indent)), " = "), jsPrintExprAt(x.f[1], 2, false, indent)), ";");
          })();
        }
        if ($match$1843.$t === "JsIf") {
          const x = $match$1843;
          return (() => {
            const base = $concatS($concatS($concatS($concatS(pad, "if ("), jsPrintExprAt(x.f[0], 0, false, indent)), ") "), jsPrintBlock(x.f[1], indent));
            if ($eqI($length(x.f[2]), 0)) {
              return base;
            } else {
              return $concatS($concatS(base, " else "), jsPrintBlock(x.f[2], indent));
            }
          })();
        }
        if ($match$1843.$t === "JsWhile") {
          const x = $match$1843;
          return (() => {
            return $concatS($concatS($concatS($concatS(pad, "while ("), jsPrintExprAt(x.f[0], 0, false, indent)), ") "), jsPrintBlock(x.f[1], indent));
          })();
        }
        if ($match$1843.$t === "JsRet") {
          const x = $match$1843;
          return (() => {
            return $concatS($concatS($concatS(pad, "return "), jsPrintExprAt(x.f[0], 0, false, indent)), ";");
          })();
        }
        if ($match$1843.$t === "JsFun") {
          const x = $match$1843;
          return (() => {
            const asyncPrefix = x.f[3] ? "async " : "";
            return $concatS($concatS($concatS($concatS($concatS($concatS(pad, asyncPrefix), "function "), mangle(x.f[0])), jsPrintParams(x.f[1])), " "), jsPrintBlock(x.f[2], indent));
          })();
        }
        if ($match$1843.$t === "JsTry") {
          const x = $match$1843;
          return (() => {
            return $concatS($concatS($concatS($concatS($concatS($concatS(pad, "try "), jsPrintBlock(x.f[0], indent)), " catch ("), mangle(x.f[1])), ") "), jsPrintBlock(x.f[2], indent));
          })();
        }
        if ($match$1843.$t === "JsThrow") {
          const x = $match$1843;
          return (() => {
            return $concatS($concatS($concatS(pad, "throw "), jsPrintExprAt(x.f[0], 0, false, indent)), ";");
          })();
        }
        if ($match$1843.$t === "JsBreak") {
          return $concatS(pad, "break;");
        }
        if ($match$1843.$t === "JsContinue") {
          return $concatS(pad, "continue;");
        }
        if ($match$1843.$t === "JsBlock") {
          const x = $match$1843;
          return $concatS(pad, jsPrintBlock(x.f[0], indent));
        }
        if ($match$1843.$t === "JsLabel") {
          const x = $match$1843;
          return (() => {
            return $concatS($concatS($concatS(pad, mangle(x.f[0])), ": "), jsPrintBlock(x.f[1], indent));
          })();
        }
        throw $matchFail("src/compile/js.pf", 1843);
      })(s);
    }
    function printJs(stmts) {
      if ($eqI($length(stmts), 0)) {
        return "";
      } else {
        return $concatS($join($map((s) => printStmt(s, 0), stmts), "\n"), "\n");
      }
    }
    exports["JNum"] = JNum;
    exports["JBig"] = JBig;
    exports["JStr"] = JStr;
    exports["JBool"] = JBool;
    exports["JNull"] = JNull;
    exports["JId"] = JId;
    exports["JArr"] = JArr;
    exports["JObj"] = JObj;
    exports["JArrow"] = JArrow;
    exports["JCall"] = JCall;
    exports["JNew"] = JNew;
    exports["JMember"] = JMember;
    exports["JIndex"] = JIndex;
    exports["JBin"] = JBin;
    exports["JLogic"] = JLogic;
    exports["JUn"] = JUn;
    exports["JCond"] = JCond;
    exports["JAssignE"] = JAssignE;
    exports["JAwait"] = JAwait;
    exports["JbExpr"] = JbExpr;
    exports["JbBlock"] = JbBlock;
    exports["JsExprS"] = JsExprS;
    exports["JsConst"] = JsConst;
    exports["JsLet"] = JsLet;
    exports["JsAssign"] = JsAssign;
    exports["JsIf"] = JsIf;
    exports["JsWhile"] = JsWhile;
    exports["JsRet"] = JsRet;
    exports["JsFun"] = JsFun;
    exports["JsTry"] = JsTry;
    exports["JsThrow"] = JsThrow;
    exports["JsBreak"] = JsBreak;
    exports["JsContinue"] = JsContinue;
    exports["JsBlock"] = JsBlock;
    exports["JsLabel"] = JsLabel;
    exports["jsProp"] = jsProp;
    exports["jsNum"] = jsNum;
    exports["jsBig"] = jsBig;
    exports["jsStr"] = jsStr;
    exports["jsBool"] = jsBool;
    exports["jsNull"] = jsNull;
    exports["jsId"] = jsId;
    exports["jsArr"] = jsArr;
    exports["jsObj"] = jsObj;
    exports["jsExprBody"] = jsExprBody;
    exports["jsBlockBody"] = jsBlockBody;
    exports["jsArrow"] = jsArrow;
    exports["jsCall"] = jsCall;
    exports["jsNew"] = jsNew;
    exports["jsMember"] = jsMember;
    exports["jsIndex"] = jsIndex;
    exports["jsBin"] = jsBin;
    exports["jsLogic"] = jsLogic;
    exports["jsUn"] = jsUn;
    exports["jsCond"] = jsCond;
    exports["jsAssignExpr"] = jsAssignExpr;
    exports["jsAwait"] = jsAwait;
    exports["jsExprStmt"] = jsExprStmt;
    exports["jsConst"] = jsConst;
    exports["jsLet"] = jsLet;
    exports["jsAssign"] = jsAssign;
    exports["jsIf"] = jsIf;
    exports["jsWhile"] = jsWhile;
    exports["jsRet"] = jsRet;
    exports["jsFun"] = jsFun;
    exports["jsTry"] = jsTry;
    exports["jsThrow"] = jsThrow;
    exports["jsBreak"] = jsBreak;
    exports["jsContinue"] = jsContinue;
    exports["jsBlock"] = jsBlock;
    exports["jsLabel"] = jsLabel;
    exports["mangle"] = mangle;
    exports["printJs"] = printJs;
  });
  $registerSchemas([{name: "EmitOpts", union: null, fields: ["moduleId", "singletons", "browserSafe", "schemaFields", "intrinsics"], variant: false}, {name: "HostReq", union: "Require", fields: [], variant: true}, {name: "BuiltinReq", union: "Require", fields: ["mname"], variant: true}, {name: "UserReq", union: "Require", fields: ["path"], variant: true}, {name: "EmitSchema", union: null, fields: ["runtimeName", "unionName", "fields", "isVariant"], variant: false}, {name: "EmittedModule", union: null, fields: ["moduleId", "body", "exportNames", "requires", "schemas"], variant: false}, {name: "EmitNoTail", union: "EmitTailCtx", fields: [], variant: true}, {name: "EmitTailOf", union: "EmitTailCtx", fields: ["name", "params"], variant: true}, {name: "EmitCtx", union: null, fields: ["types", "opts", "asyncDepth", "paramTypes", "tailCtx", "locals", "starImports", "schemaFields"], variant: false}, {name: "EmitSplitLast", union: null, fields: ["prefix", "last"], variant: false}, {name: "EmitArmPlan", union: null, fields: ["condition", "bindings", "armCtx"], variant: false}]);
  $maps["src/compile/emit"] = {"../syntax/ast": "src/syntax/ast", "../check/types": "src/check/types", "../data/imapi": "src/data/imapi", "../data/imaps": "src/data/imaps", "../compat": "src/compat", "./js": "src/compile/js"};
  $mods["src/compile/emit"] = ((exports, $require) => {
    const A = $require("../syntax/ast");
    const TY = $require("../check/types");
    const IMI = $require("../data/imapi");
    const IMS = $require("../data/imaps");
    const Compat = $require("../compat");
    const J = $require("./js");
    const HostReq = $makeVariant("HostReq", "Require", [], []);
    function BuiltinReq(mname) {
      return $makeVariant("BuiltinReq", "Require", ["mname"], [mname]);
    }
    function UserReq(path) {
      return $makeVariant("UserReq", "Require", ["path"], [path]);
    }
    function emitOpts(moduleId, singletons, browserSafe) {
      return $makeRecord("EmitOpts", ["moduleId", "singletons", "browserSafe", "schemaFields", "intrinsics"], [moduleId, singletons, browserSafe, $field(IMS, "imsEmpty")(), $field(IMS, "imsEmpty")()]);
    }
    function withIntrinsics(opts, intrinsics) {
      return $makeRecord("EmitOpts", ["moduleId", "singletons", "browserSafe", "schemaFields", "intrinsics"], [$field(opts, "moduleId"), $field(opts, "singletons"), $field(opts, "browserSafe"), $field(opts, "schemaFields"), intrinsics]);
    }
    function emitOptsWithSchemas(moduleId, singletons, browserSafe, schemaFields) {
      return $makeRecord("EmitOpts", ["moduleId", "singletons", "browserSafe", "schemaFields", "intrinsics"], [moduleId, singletons, browserSafe, schemaFields, $field(IMS, "imsEmpty")()]);
    }
    function emitOptsGroundingWitness() {
      return $makeRecord("EmitOpts", ["moduleId", "singletons", "browserSafe", "schemaFields", "intrinsics"], ["", $field(IMS, "imsPut")($field(IMS, "imsEmpty")(), "", ""), false, $field(IMS, "imsPut")($field(IMS, "imsEmpty")(), "", [""]), $field(IMS, "imsPut")($field(IMS, "imsEmpty")(), "", "")]);
    }
    function hostReq() {
      return HostReq;
    }
    function builtinReq(mname) {
      return $makeVariant("BuiltinReq", "Require", ["mname"], [mname]);
    }
    function userReq(path) {
      return $makeVariant("UserReq", "Require", ["path"], [path]);
    }
    function emitSchema(runtimeName, unionName, fields, isVariant) {
      return $makeRecord("EmitSchema", ["runtimeName", "unionName", "fields", "isVariant"], [runtimeName, unionName, fields, isVariant]);
    }
    function emittedModule(moduleId, body, exportNames, requires, schemas) {
      return $makeRecord("EmittedModule", ["moduleId", "body", "exportNames", "requires", "schemas"], [moduleId, body, exportNames, requires, schemas]);
    }
    function emittedModuleGroundingWitness() {
      return $makeRecord("EmittedModule", ["moduleId", "body", "exportNames", "requires", "schemas"], ["", [$field(J, "jsConst")("", $field(J, "jsStr")(""))], [""], [HostReq], [$makeRecord("EmitSchema", ["runtimeName", "unionName", "fields", "isVariant"], ["", $makeVariant("None", "Option", [], []), [""], false])]]);
    }
    const EmitNoTail = $makeVariant("EmitNoTail", "EmitTailCtx", [], []);
    function EmitTailOf(name, params) {
      return $makeVariant("EmitTailOf", "EmitTailCtx", ["name", "params"], [name, params]);
    }
    function appendJsStmts(a, b) {
      return $reduce((acc, x) => $cons(x, acc), b, $reverse(a));
    }
    function appendStrings(a, b) {
      return $reduce((acc, x) => $cons(x, acc), b, $reverse(a));
    }
    function appendRequires(a, b) {
      return $reduce((acc, x) => $cons(x, acc), b, $reverse(a));
    }
    function appendSchemas(a, b) {
      return $reduce((acc, x) => $cons(x, acc), b, $reverse(a));
    }
    function appendInts(a, b) {
      return $reduce((acc, x) => $cons(x, acc), b, $reverse(a));
    }
    function appendOneString(xs, x) {
      return $reverse($cons(x, $reverse(xs)));
    }
    function appendOneRequire(xs, x) {
      return $reverse($cons(x, $reverse(xs)));
    }
    function appendOneSchema(xs, x) {
      return $reverse($cons(x, $reverse(xs)));
    }
    function appendOneInt(xs, x) {
      return $reverse($cons(x, $reverse(xs)));
    }
    function splitLastStmt(stmts) {
      return (($match$246) => {
        if ($match$246.$t === "None") {
          return $makeRecord("EmitSplitLast", ["prefix", "last"], [[], $makeVariant("None", "Option", [], [])]);
        }
        if ($match$246.$t === "Some") {
          const cell = $match$246;
          return (() => {
            return $makeRecord("EmitSplitLast", ["prefix", "last"], [$reverse(cell.f[0].f[1]), $makeVariant("Some", "Option", ["value"], [cell.f[0].f[0]])]);
          })();
        }
        throw $matchFail("src/compile/emit.pf", 246);
      })($field(Compat, "uncons")($reverse(stmts)));
    }
    function emptyCtx(types, opts) {
      return $makeRecord("EmitCtx", ["types", "opts", "asyncDepth", "paramTypes", "tailCtx", "locals", "starImports", "schemaFields"], [types, opts, 0, $field(IMS, "imsEmpty")(), EmitNoTail, $field(IMS, "imsEmpty")(), [], $field(opts, "schemaFields")]);
    }
    function withAsyncDepth(ctx, asyncDepth) {
      return $makeRecord("EmitCtx", ["types", "opts", "asyncDepth", "paramTypes", "tailCtx", "locals", "starImports", "schemaFields"], [ctx.f[0], ctx.f[1], asyncDepth, ctx.f[3], ctx.f[4], ctx.f[5], ctx.f[6], ctx.f[7]]);
    }
    function withTailCtx(ctx, tailCtx) {
      return $makeRecord("EmitCtx", ["types", "opts", "asyncDepth", "paramTypes", "tailCtx", "locals", "starImports", "schemaFields"], [ctx.f[0], ctx.f[1], ctx.f[2], ctx.f[3], tailCtx, ctx.f[5], ctx.f[6], ctx.f[7]]);
    }
    function withLocalsMap(ctx, locals) {
      return $makeRecord("EmitCtx", ["types", "opts", "asyncDepth", "paramTypes", "tailCtx", "locals", "starImports", "schemaFields"], [ctx.f[0], ctx.f[1], ctx.f[2], ctx.f[3], ctx.f[4], locals, ctx.f[6], ctx.f[7]]);
    }
    function withStars(ctx, starImports) {
      return $makeRecord("EmitCtx", ["types", "opts", "asyncDepth", "paramTypes", "tailCtx", "locals", "starImports", "schemaFields"], [ctx.f[0], ctx.f[1], ctx.f[2], ctx.f[3], ctx.f[4], ctx.f[5], starImports, ctx.f[7]]);
    }
    function withSchemaFields(ctx, schemaFields) {
      return $makeRecord("EmitCtx", ["types", "opts", "asyncDepth", "paramTypes", "tailCtx", "locals", "starImports", "schemaFields"], [ctx.f[0], ctx.f[1], ctx.f[2], ctx.f[3], ctx.f[4], ctx.f[5], ctx.f[6], schemaFields]);
    }
    function putLocal(locals, name) {
      return $field(IMS, "imsPut")(locals, name, true);
    }
    function putLocals(locals, names) {
      return (($match$384) => {
        if ($match$384.$t === "None") {
          return locals;
        }
        if ($match$384.$t === "Some") {
          const cell = $match$384;
          return (() => {
            return putLocals(putLocal(locals, cell.f[0].f[0]), cell.f[0].f[1]);
          })();
        }
        throw $matchFail("src/compile/emit.pf", 384);
      })($field(Compat, "uncons")(names));
    }
    function addLocals(ctx, names) {
      return withLocalsMap(ctx, putLocals(ctx.f[5], names));
    }
    function hasLocal(ctx, name) {
      return $field(IMS, "imsHas")(ctx.f[5], name);
    }
    function typeOfId(ctx, id) {
      return (($match$423) => {
        if ($match$423.$t === "None") {
          return $field(TY, "tUnknown")();
        }
        if ($match$423.$t === "Some") {
          const found = $match$423;
          return found.f[0];
        }
        throw $matchFail("src/compile/emit.pf", 423);
      })($field(IMI, "imiGet")(ctx.f[0], id));
    }
    function typeOfExpr(ctx, expr) {
      return typeOfId(ctx, $field(A, "exprId")(expr));
    }
    function schemaFieldsFor(ctx, name) {
      return $field(IMS, "imsGet")(ctx.f[7], name);
    }
    function stringContains(xs, value) {
      return (($match$454) => {
        if ($match$454.$t === "None") {
          return false;
        }
        if ($match$454.$t === "Some") {
          const cell = $match$454;
          return (() => {
            if (cell.f[0].f[0] === value) {
              return true;
            } else {
              return stringContains(cell.f[0].f[1], value);
            }
          })();
        }
        throw $matchFail("src/compile/emit.pf", 454);
      })($field(Compat, "uncons")(xs));
    }
    function uniqueStrings(xs) {
      return $reverse($reduce((acc, x) => stringContains(acc, x) ? acc : $cons(x, acc), [], xs));
    }
    function requireKey(req) {
      return (($match$497) => {
        if ($match$497.$t === "HostReq") {
          return "host:";
        }
        if ($match$497.$t === "BuiltinReq") {
          const r = $match$497;
          return $concatS("builtin:", r.f[0]);
        }
        if ($match$497.$t === "UserReq") {
          const r = $match$497;
          return $concatS("user:", r.f[0]);
        }
        throw $matchFail("src/compile/emit.pf", 497);
      })(req);
    }
    function requireContains(reqs, req) {
      const key = requireKey(req);
      return (($match$514) => {
        if ($match$514.$t === "None") {
          return false;
        }
        if ($match$514.$t === "Some") {
          const cell = $match$514;
          return (() => {
            if (requireKey(cell.f[0].f[0]) === key) {
              return true;
            } else {
              return requireContains(cell.f[0].f[1], req);
            }
          })();
        }
        throw $matchFail("src/compile/emit.pf", 514);
      })($field(Compat, "uncons")(reqs));
    }
    function uniqueRequires(reqs) {
      return $reverse($reduce((acc, req) => requireContains(acc, req) ? acc : $cons(req, acc), [], reqs));
    }
    function startsWithText(s, prefix) {
      if ($gtI($length(prefix), $length(s))) {
        return false;
      } else {
        return $eq($slice(0, $length(prefix), s), prefix);
      }
    }
    function isUserImportPath(path) {
      return startsWithText(path, ".") || startsWithText(path, "/") || startsWithText(path, "$PFUN_HOME/") || startsWithText(path, "<generated:");
    }
    function requireOfPath(path) {
      if (isUserImportPath(path)) {
        return $makeVariant("UserReq", "Require", ["path"], [path]);
      } else {
        return $makeVariant("BuiltinReq", "Require", ["mname"], [path]);
      }
    }
    function importTemp(id) {
      return $concatS("$imp$", $str(id));
    }
    function starTemp(id) {
      return $concatS("$star$", $str(id));
    }
    function tailTemp(id, index) {
      return $concatS($concatS($concatS("$tc$", $str(id)), "$"), $str(index));
    }
    function matchSubjectName(id) {
      return $concatS("$match$", $str(id));
    }
    function startsUpper(name) {
      if ($eqI($length(name), 0)) {
        return false;
      } else {
        const c = $slice(0, 1, name);
        return c >= "A" && c <= "Z";
      }
    }
    function importBoundNames(spec) {
      return (($match$669) => {
        if ($match$669.$t === "INames") {
          const s = $match$669;
          return (() => {
            return $map((item) => (() => {
              return (($match$674) => {
                if ($match$674.$t === "None") {
                  return $field(item, "name");
                }
                if ($match$674.$t === "Some") {
                  const alias = $match$674;
                  return alias.f[0];
                }
                throw $matchFail("src/compile/emit.pf", 674);
              })($field(item, "alias"));
            })(), s.f[0]);
          })();
        }
        if ($match$669.$t === "INamespace") {
          const s = $match$669;
          return [s.f[0]];
        }
        if ($match$669.$t === "IStar") {
          return [];
        }
        throw $matchFail("src/compile/emit.pf", 669);
      })(spec);
    }
    function typeDeclBoundNames(decl) {
      return (($match$693) => {
        if ($match$693.$t === "RecordDecl") {
          return [];
        }
        if ($match$693.$t === "UnionDecl") {
          const u = $match$693;
          return $map((variant) => $field(variant, "vname"), u.f[1]);
        }
        throw $matchFail("src/compile/emit.pf", 693);
      })(decl);
    }
    function boundNamesOfStmt(stmt) {
      while (true) {
        const $match$705 = stmt;
        if ($match$705.$t === "SLet") {
          const s = $match$705;
          return [s.f[1]];
        }
        if ($match$705.$t === "SVar") {
          const s = $match$705;
          return [s.f[1]];
        }
        if ($match$705.$t === "SFun") {
          const s = $match$705;
          return [s.f[1]];
        }
        if ($match$705.$t === "SType") {
          const s = $match$705;
          return typeDeclBoundNames(s.f[1]);
        }
        if ($match$705.$t === "SImport") {
          const s = $match$705;
          return importBoundNames(s.f[1]);
        }
        if ($match$705.$t === "SExtern") {
          const s = $match$705;
          return [$field(s.f[1], "name")];
        }
        if ($match$705.$t === "SExport") {
          const s = $match$705;
          const $tc$731$0 = s.f[1];
          stmt = $tc$731$0;
          continue;
        }
        if (true) {
          return [];
        }
        throw $matchFail("src/compile/emit.pf", 705);
      }
    }
    function boundNamesOfStmts(stmts) {
      return $reduce((acc, stmt) => appendStrings(acc, boundNamesOfStmt(stmt)), [], stmts);
    }
    function starImportsOfStmt(stmt) {
      while (true) {
        const $match$748 = stmt;
        if ($match$748.$t === "SImport") {
          const s = $match$748;
          return (() => {
            return (($match$751) => {
              if ($match$751.$t === "IStar") {
                return [starTemp(s.f[0])];
              }
              if (true) {
                return [];
              }
              throw $matchFail("src/compile/emit.pf", 751);
            })(s.f[1]);
          })();
        }
        if ($match$748.$t === "SExport") {
          const s = $match$748;
          const $tc$764$0 = s.f[1];
          stmt = $tc$764$0;
          continue;
        }
        if (true) {
          return [];
        }
        throw $matchFail("src/compile/emit.pf", 748);
      }
    }
    function starImportsOfStmts(stmts) {
      return $reduce((acc, stmt) => appendStrings(acc, starImportsOfStmt(stmt)), [], stmts);
    }
    function fieldDeclNames(fields) {
      return $map((field) => $field(field, "fname"), fields);
    }
    function schemasOfTypeDecl(decl) {
      return (($match$789) => {
        if ($match$789.$t === "RecordDecl") {
          const r = $match$789;
          return (() => {
            return [$makeRecord("EmitSchema", ["runtimeName", "unionName", "fields", "isVariant"], [r.f[0], $makeVariant("None", "Option", [], []), fieldDeclNames(r.f[1]), false])];
          })();
        }
        if ($match$789.$t === "UnionDecl") {
          const u = $match$789;
          return (() => {
            return $map((variant) => (() => {
              return $makeRecord("EmitSchema", ["runtimeName", "unionName", "fields", "isVariant"], [$field(variant, "vname"), $makeVariant("Some", "Option", ["value"], [u.f[0]]), fieldDeclNames($field(variant, "fields")), true]);
            })(), u.f[1]);
          })();
        }
        throw $matchFail("src/compile/emit.pf", 789);
      })(decl);
    }
    function schemasOfStmt(stmt) {
      while (true) {
        const $match$825 = stmt;
        if ($match$825.$t === "SType") {
          const s = $match$825;
          return schemasOfTypeDecl(s.f[1]);
        }
        if ($match$825.$t === "SExport") {
          const s = $match$825;
          const $tc$834$0 = s.f[1];
          stmt = $tc$834$0;
          continue;
        }
        if (true) {
          return [];
        }
        throw $matchFail("src/compile/emit.pf", 825);
      }
    }
    function schemasOfStmts(stmts) {
      return $reduce((acc, stmt) => appendSchemas(acc, schemasOfStmt(stmt)), [], stmts);
    }
    function putSchemaFields(acc, schema) {
      return $field(IMS, "imsPut")(acc, schema.f[0], schema.f[2]);
    }
    function schemaFieldMapFrom(base, schemas) {
      return $reduce(putSchemaFields, base, schemas);
    }
    function exportedNamesOfInner(stmt) {
      while (true) {
        const $match$868 = stmt;
        if ($match$868.$t === "SLet") {
          const s = $match$868;
          return [s.f[1]];
        }
        if ($match$868.$t === "SVar") {
          const s = $match$868;
          return [s.f[1]];
        }
        if ($match$868.$t === "SFun") {
          const s = $match$868;
          return [s.f[1]];
        }
        if ($match$868.$t === "SType") {
          const s = $match$868;
          return typeDeclBoundNames(s.f[1]);
        }
        if ($match$868.$t === "SExport") {
          const s = $match$868;
          const $tc$886$0 = s.f[1];
          stmt = $tc$886$0;
          continue;
        }
        if (true) {
          return [];
        }
        throw $matchFail("src/compile/emit.pf", 868);
      }
    }
    function exportNamesOfStmt(stmt) {
      return (($match$890) => {
        if ($match$890.$t === "SExport") {
          const s = $match$890;
          return exportedNamesOfInner(s.f[1]);
        }
        if (true) {
          return [];
        }
        throw $matchFail("src/compile/emit.pf", 890);
      })(stmt);
    }
    function exportNamesOfStmts(stmts) {
      return uniqueStrings($reduce((acc, stmt) => appendStrings(acc, exportNamesOfStmt(stmt)), [], stmts));
    }
    function requiresOfStmt(stmt) {
      while (true) {
        const $match$914 = stmt;
        if ($match$914.$t === "SImport") {
          const s = $match$914;
          return [requireOfPath(s.f[2])];
        }
        if ($match$914.$t === "SExport") {
          const s = $match$914;
          const $tc$924$0 = s.f[1];
          stmt = $tc$924$0;
          continue;
        }
        if (true) {
          return [];
        }
        throw $matchFail("src/compile/emit.pf", 914);
      }
    }
    function requiresOfStmts(stmts) {
      const imports = $reduce((acc, stmt) => appendRequires(acc, requiresOfStmt(stmt)), [], stmts);
      return uniqueRequires($cons(HostReq, imports));
    }
    function hostCall(name, args) {
      return $field(J, "jsCall")($field(J, "jsId")(name), args);
    }
    function schemaFieldNames(ctx, name) {
      return (($match$958) => {
        if ($match$958.$t === "None") {
          return [];
        }
        if ($match$958.$t === "Some") {
          const fields = $match$958;
          return fields.f[0];
        }
        throw $matchFail("src/compile/emit.pf", 958);
      })(schemaFieldsFor(ctx, name));
    }
    function jsStringArray(values) {
      return $field(J, "jsArr")($map((value) => $field(J, "jsStr")(value), values));
    }
    function variantObject(vname, unionName, fieldNames, fields) {
      return hostCall("$makeVariant", [$field(J, "jsStr")(vname), $field(J, "jsStr")(unionName), jsStringArray(fieldNames), $field(J, "jsArr")(fields)]);
    }
    function recordObject(tname, fieldNames, fields) {
      return hostCall("$makeRecord", [$field(J, "jsStr")(tname), jsStringArray(fieldNames), $field(J, "jsArr")(fields)]);
    }
    function singletonOf(ctx, name) {
      if (hasLocal(ctx, name)) {
        return $makeVariant("None", "Option", [], []);
      } else {
        return (($match$1025) => {
          if ($match$1025.$t === "None") {
            return $makeVariant("None", "Option", [], []);
          }
          if ($match$1025.$t === "Some") {
            const unionName = $match$1025;
            return (() => {
              return $makeVariant("Some", "Option", ["value"], [variantObject(name, unionName.f[0], [], [])]);
            })();
          }
          throw $matchFail("src/compile/emit.pf", 1025);
        })($field(IMS, "imsGet")($field(ctx.f[1], "singletons"), name));
      }
    }
    function emitVar(ctx, name) {
      return (($match$1047) => {
        if ($match$1047.$t === "Some") {
          const singleton = $match$1047;
          return singleton.f[0];
        }
        if ($match$1047.$t === "None") {
          return (() => {
            if (!hasLocal(ctx, name)) {
              return (($match$1060) => {
                if ($match$1060.$t === "Some") {
                  const intr = $match$1060;
                  return $field(J, "jsId")(intr.f[0]);
                }
                if ($match$1060.$t === "None") {
                  return emitVarNonAmbient(ctx, name);
                }
                throw $matchFail("src/compile/emit.pf", 1060);
              })($field(IMS, "imsGet")($field(ctx.f[1], "intrinsics"), name));
            } else {
              return $field(J, "jsId")(name);
            }
          })();
        }
        throw $matchFail("src/compile/emit.pf", 1047);
      })(singletonOf(ctx, name));
    }
    function emitVarNonAmbient(ctx, name) {
      return (() => {
        if ($gtI($length(ctx.f[6]), 0)) {
          return hostCall("$starGet", [$field(J, "jsArr")($map((star) => $field(J, "jsId")(star), ctx.f[6])), $field(J, "jsStr")(name)]);
        } else {
          return $field(J, "jsId")(name);
        }
      })();
    }
    function emitIntLiteral(n) {
      const maxSafe = 9007199254740991;
      const minSafe = $subI(0, maxSafe);
      if ($gtI(n, maxSafe) || $ltI(n, minSafe)) {
        return $field(J, "jsBig")($str(n));
      } else {
        return $field(J, "jsNum")($str(n));
      }
    }
    function isIntLike(t) {
      return (($match$1151) => {
        if ($match$1151.$t === "TInt") {
          return true;
        }
        if ($match$1151.$t === "TNonZero") {
          return true;
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/compile/emit.pf", 1151);
      })(t);
    }
    function isFloatType(t) {
      return (($match$1158) => {
        if ($match$1158.$t === "TFloat") {
          return true;
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/compile/emit.pf", 1158);
      })(t);
    }
    function isStringType(t) {
      return (($match$1164) => {
        if ($match$1164.$t === "TStr") {
          return true;
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/compile/emit.pf", 1164);
      })(t);
    }
    function isRawComparable(t) {
      return (($match$1170) => {
        if ($match$1170.$t === "TStr") {
          return true;
        }
        if ($match$1170.$t === "TChar") {
          return true;
        }
        if ($match$1170.$t === "TByte") {
          return true;
        }
        if ($match$1170.$t === "TBool") {
          return true;
        }
        if (true) {
          return false;
        }
        throw $matchFail("src/compile/emit.pf", 1170);
      })(t);
    }
    function promoteFloat(t, expr) {
      return isIntLike(t) ? hostCall("$toF", [expr]) : expr;
    }
    function intBinaryName(op) {
      if (op === "+") {
        return $makeVariant("Some", "Option", ["value"], ["$addI"]);
      } else {
        if (op === "-") {
          return $makeVariant("Some", "Option", ["value"], ["$subI"]);
        } else {
          if (op === "*") {
            return $makeVariant("Some", "Option", ["value"], ["$mulI"]);
          } else {
            if (op === "/") {
              return $makeVariant("Some", "Option", ["value"], ["$divI"]);
            } else {
              if (op === "%") {
                return $makeVariant("Some", "Option", ["value"], ["$modI"]);
              } else {
                if (op === "&") {
                  return $makeVariant("Some", "Option", ["value"], ["$bitAndI"]);
                } else {
                  if (op === "|") {
                    return $makeVariant("Some", "Option", ["value"], ["$bitOrI"]);
                  } else {
                    if (op === "<<") {
                      return $makeVariant("Some", "Option", ["value"], ["$shlI"]);
                    } else {
                      if (op === ">>") {
                        return $makeVariant("Some", "Option", ["value"], ["$shrI"]);
                      } else {
                        return $makeVariant("None", "Option", [], []);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    function floatRawOp(op) {
      return op === "+" || op === "-" || op === "*" || op === "/" || op === "%";
    }
    function emitFloatCompare(op, left, right) {
      const cmp = hostCall("$cmpF", [left, right]);
      if (op === "<") {
        return $field(J, "jsBin")("<", cmp, $field(J, "jsNum")("0"));
      } else {
        if (op === "<=") {
          return $field(J, "jsBin")("<=", cmp, $field(J, "jsNum")("0"));
        } else {
          if (op === ">") {
            return $field(J, "jsBin")(">", cmp, $field(J, "jsNum")("0"));
          } else {
            return $field(J, "jsBin")(">=", cmp, $field(J, "jsNum")("0"));
          }
        }
      }
    }
    function emitEqualityCore(lt, rt, left, right) {
      if (isIntLike(lt) && isIntLike(rt)) {
        return hostCall("$eqI", [left, right]);
      } else {
        if (isFloatType(lt) || isFloatType(rt)) {
          return hostCall("$eqF", [promoteFloat(lt, left), promoteFloat(rt, right)]);
        } else {
          if (isRawComparable(lt) && isRawComparable(rt)) {
            return $field(J, "jsBin")("===", left, right);
          } else {
            return hostCall("$eq", [left, right]);
          }
        }
      }
    }
    function emitEquality(ctx, op, lhs, rhs, left, right) {
      const lt = typeOfExpr(ctx, lhs);
      const rt = typeOfExpr(ctx, rhs);
      const eq = emitEqualityCore(lt, rt, left, right);
      return op === "!=" ? $field(J, "jsUn")("!", eq) : eq;
    }
    function intComparisonSuffix(op) {
      if (op === "<") {
        return "lt";
      } else {
        if (op === "<=") {
          return "le";
        } else {
          if (op === ">") {
            return "gt";
          } else {
            return "ge";
          }
        }
      }
    }
    function emitComparison(ctx, op, lhs, rhs, left, right) {
      const lt = typeOfExpr(ctx, lhs);
      const rt = typeOfExpr(ctx, rhs);
      if (isIntLike(lt) && isIntLike(rt)) {
        const suffix = intComparisonSuffix(op);
        return hostCall($concatS($concatS("$", suffix), "I"), [left, right]);
      } else {
        if (isFloatType(lt) || isFloatType(rt)) {
          return emitFloatCompare(op, promoteFloat(lt, left), promoteFloat(rt, right));
        } else {
          return $field(J, "jsBin")(op, left, right);
        }
      }
    }
    function specializeBin(ctx, op, lhs, rhs) {
      const left = emitExpr(ctx, lhs);
      const right = emitExpr(ctx, rhs);
      const lt = typeOfExpr(ctx, lhs);
      const rt = typeOfExpr(ctx, rhs);
      if (op === "++") {
        return hostCall("$concatS", [left, right]);
      } else {
        if (op === "==" || op === "!=") {
          return emitEquality(ctx, op, lhs, rhs, left, right);
        } else {
          if (op === "<" || op === "<=" || op === ">" || op === ">=") {
            return emitComparison(ctx, op, lhs, rhs, left, right);
          } else {
            if (op === "&&" || op === "||") {
              return $field(J, "jsLogic")(op, left, right);
            } else {
              if (isIntLike(lt) && isIntLike(rt)) {
                return (($match$1599) => {
                  if ($match$1599.$t === "Some") {
                    const intrinsic = $match$1599;
                    return hostCall(intrinsic.f[0], [left, right]);
                  }
                  if ($match$1599.$t === "None") {
                    return $field(J, "jsBin")(op, left, right);
                  }
                  throw $matchFail("src/compile/emit.pf", 1599);
                })(intBinaryName(op));
              } else {
                if (floatRawOp(op) && (isFloatType(lt) || isFloatType(rt))) {
                  return $field(J, "jsBin")(op, promoteFloat(lt, left), promoteFloat(rt, right));
                } else {
                  return $field(J, "jsBin")(op, left, right);
                }
              }
            }
          }
        }
      }
    }
    function emitUnary(ctx, op, operand) {
      const value = emitExpr(ctx, operand);
      const typ = typeOfExpr(ctx, operand);
      if (op === "!") {
        return $field(J, "jsUn")("!", value);
      } else {
        if (op === "-" && isIntLike(typ)) {
          return hostCall("$negI", [value]);
        } else {
          if (op === "~" && isIntLike(typ)) {
            return hostCall("$bitNotI", [value]);
          } else {
            return $field(J, "jsUn")(op, value);
          }
        }
      }
    }
    function jsonTypeDescriptor(t) {
      return (($match$1711) => {
        if ($match$1711.$t === "TInt") {
          return $field(J, "jsArr")([$field(J, "jsStr")("Int")]);
        }
        if ($match$1711.$t === "TFloat") {
          return $field(J, "jsArr")([$field(J, "jsStr")("Float")]);
        }
        if ($match$1711.$t === "TBool") {
          return $field(J, "jsArr")([$field(J, "jsStr")("Bool")]);
        }
        if ($match$1711.$t === "TStr") {
          return $field(J, "jsArr")([$field(J, "jsStr")("Str")]);
        }
        if ($match$1711.$t === "TChar") {
          return $field(J, "jsArr")([$field(J, "jsStr")("Char")]);
        }
        if ($match$1711.$t === "TByte") {
          return $field(J, "jsArr")([$field(J, "jsStr")("Byte")]);
        }
        if ($match$1711.$t === "TUnit") {
          return $field(J, "jsArr")([$field(J, "jsStr")("Unit")]);
        }
        if ($match$1711.$t === "TNonZero") {
          return $field(J, "jsArr")([$field(J, "jsStr")("NonZero")]);
        }
        if ($match$1711.$t === "TList") {
          const listType = $match$1711;
          return (() => {
            return $field(J, "jsArr")([$field(J, "jsStr")("List"), jsonTypeDescriptor(listType.f[0])]);
          })();
        }
        if ($match$1711.$t === "TNamed") {
          const named = $match$1711;
          return (() => {
            return $field(J, "jsArr")([$field(J, "jsStr")("Named"), $field(J, "jsStr")(named.f[0]), $field(J, "jsArr")($map(jsonTypeDescriptor, named.f[1]))]);
          })();
        }
        if ($match$1711.$t === "TVariant") {
          const variant = $match$1711;
          return (() => {
            return $field(J, "jsArr")([$field(J, "jsStr")("Named"), $field(J, "jsStr")(variant.f[1]), $field(J, "jsArr")($map(jsonTypeDescriptor, variant.f[2]))]);
          })();
        }
        if (true) {
          return $field(J, "jsArr")([$field(J, "jsStr")("Unsupported")]);
        }
        throw $matchFail("src/compile/emit.pf", 1711);
      })(t);
    }
    function jsonDeserializeTarget(t) {
      return (($match$1847) => {
        if ($match$1847.$t === "TNamed") {
          const named = $match$1847;
          return (() => {
            if (named.f[0] === "Option") {
              return (($match$1854) => {
                if ($match$1854.$t === "None") {
                  return $makeVariant("TUnknown", "Type", [], []);
                }
                if ($match$1854.$t === "Some") {
                  const first = $match$1854;
                  return (() => {
                    return (($match$1862) => {
                      if ($match$1862.$t === "None") {
                        return first.f[0].f[0];
                      }
                      if ($match$1862.$t === "Some") {
                        return $makeVariant("TUnknown", "Type", [], []);
                      }
                      throw $matchFail("src/compile/emit.pf", 1862);
                    })($field(Compat, "uncons")(first.f[0].f[1]));
                  })();
                }
                throw $matchFail("src/compile/emit.pf", 1854);
              })($field(Compat, "uncons")(named.f[1]));
            } else {
              return $makeVariant("TUnknown", "Type", [], []);
            }
          })();
        }
        if (true) {
          return $makeVariant("TUnknown", "Type", [], []);
        }
        throw $matchFail("src/compile/emit.pf", 1847);
      })(t);
    }
    function emitJsonSerializeCall(ctx, args) {
      return (($match$1881) => {
        if ($match$1881.$t === "None") {
          return (() => {
            return hostCall("$jsonSerialize", $map((arg) => emitExpr(ctx, arg), args));
          })();
        }
        if ($match$1881.$t === "Some") {
          const cell = $match$1881;
          return (() => {
            const first = cell.f[0];
            return (($match$1903) => {
              if ($match$1903.$t === "None") {
                return (() => {
                  const value = first.f[0];
                  return hostCall("$jsonSerialize", [emitExpr(ctx, value), jsonTypeDescriptor(typeOfExpr(ctx, value))]);
                })();
              }
              if ($match$1903.$t === "Some") {
                return (() => {
                  return hostCall("$jsonSerialize", $map((arg) => emitExpr(ctx, arg), args));
                })();
              }
              throw $matchFail("src/compile/emit.pf", 1903);
            })($field(Compat, "uncons")(first.f[1]));
          })();
        }
        throw $matchFail("src/compile/emit.pf", 1881);
      })($field(Compat, "uncons")(args));
    }
    function emitJsonDeserializeCall(ctx, id, args) {
      return (($match$1944) => {
        if ($match$1944.$t === "None") {
          return (() => {
            return hostCall("$jsonDeserialize", $map((arg) => emitExpr(ctx, arg), args));
          })();
        }
        if ($match$1944.$t === "Some") {
          const cell = $match$1944;
          return (() => {
            const first = cell.f[0];
            return (($match$1966) => {
              if ($match$1966.$t === "None") {
                return (() => {
                  const text = first.f[0];
                  return hostCall("$jsonDeserialize", [emitExpr(ctx, text), jsonTypeDescriptor(jsonDeserializeTarget(typeOfId(ctx, id)))]);
                })();
              }
              if ($match$1966.$t === "Some") {
                return (() => {
                  return hostCall("$jsonDeserialize", $map((arg) => emitExpr(ctx, arg), args));
                })();
              }
              throw $matchFail("src/compile/emit.pf", 1966);
            })($field(Compat, "uncons")(first.f[1]));
          })();
        }
        throw $matchFail("src/compile/emit.pf", 1944);
      })($field(Compat, "uncons")(args));
    }
    function emitJsonDeserializeAsFallback(ctx, args) {
      return hostCall("$jsonDeserialize", $map((arg) => emitExpr(ctx, arg), args));
    }
    function emitJsonDeserializeAsCall(ctx, args) {
      return (($match$2022) => {
        if ($match$2022.$t === "None") {
          return emitJsonDeserializeAsFallback(ctx, args);
        }
        if ($match$2022.$t === "Some") {
          const first = $match$2022;
          return (() => {
            const text = first.f[0].f[0];
            return (($match$2036) => {
              if ($match$2036.$t === "None") {
                return emitJsonDeserializeAsFallback(ctx, args);
              }
              if ($match$2036.$t === "Some") {
                const second = $match$2036;
                return (() => {
                  const witness = second.f[0].f[0];
                  return (($match$2052) => {
                    if ($match$2052.$t === "None") {
                      return (() => {
                        return hostCall("$jsonDeserialize", [emitExpr(ctx, text), jsonTypeDescriptor(typeOfExpr(ctx, witness))]);
                      })();
                    }
                    if ($match$2052.$t === "Some") {
                      return emitJsonDeserializeAsFallback(ctx, args);
                    }
                    throw $matchFail("src/compile/emit.pf", 2052);
                  })($field(Compat, "uncons")(second.f[0].f[1]));
                })();
              }
              throw $matchFail("src/compile/emit.pf", 2036);
            })($field(Compat, "uncons")(first.f[0].f[1]));
          })();
        }
        throw $matchFail("src/compile/emit.pf", 2022);
      })($field(Compat, "uncons")(args));
    }
    function namedCallParts(callee) {
      return (($match$2083) => {
        if ($match$2083.$t === "EVar") {
          const v = $match$2083;
          return $makeVariant("Some", "Option", ["value"], [v.f[1]]);
        }
        if (true) {
          return $makeVariant("None", "Option", [], []);
        }
        throw $matchFail("src/compile/emit.pf", 2083);
      })(callee);
    }
    function namedResultUnion(ctx, callId) {
      return (($match$2091) => {
        if ($match$2091.$t === "TNamed") {
          const named = $match$2091;
          return $makeVariant("Some", "Option", ["value"], [named.f[0]]);
        }
        if (true) {
          return $makeVariant("None", "Option", [], []);
        }
        throw $matchFail("src/compile/emit.pf", 2091);
      })(typeOfId(ctx, callId));
    }
    function emitCall(ctx, id, callee, args) {
      return (($match$2102) => {
        if ($match$2102.$t === "Some") {
          const calleeName = $match$2102;
          return (() => {
            if (calleeName.f[0] === "jsonSerialize") {
              return emitJsonSerializeCall(ctx, args);
            } else {
              if (calleeName.f[0] === "jsonDeserialize") {
                return emitJsonDeserializeCall(ctx, id, args);
              } else {
                if (calleeName.f[0] === "jsonDeserializeAs") {
                  return emitJsonDeserializeAsCall(ctx, args);
                } else {
                  return (($match$2135) => {
                    if ($match$2135.$t === "Some") {
                      const unionName = $match$2135;
                      return (() => {
                        if (startsUpper(calleeName.f[0])) {
                          return variantObject(calleeName.f[0], unionName.f[0], schemaFieldNames(ctx, calleeName.f[0]), $map((arg) => emitExpr(ctx, arg), args));
                        } else {
                          return $field(J, "jsCall")(emitExpr(ctx, callee), $map((arg) => emitExpr(ctx, arg), args));
                        }
                      })();
                    }
                    if ($match$2135.$t === "None") {
                      return (() => {
                        return $field(J, "jsCall")(emitExpr(ctx, callee), $map((arg) => emitExpr(ctx, arg), args));
                      })();
                    }
                    throw $matchFail("src/compile/emit.pf", 2135);
                  })(namedResultUnion(ctx, id));
                }
              }
            }
          })();
        }
        if ($match$2102.$t === "None") {
          return (() => {
            return $field(J, "jsCall")(emitExpr(ctx, callee), $map((arg) => emitExpr(ctx, arg), args));
          })();
        }
        throw $matchFail("src/compile/emit.pf", 2102);
      })(namedCallParts(callee));
    }
    function emitLambda(ctx, params, body0) {
      const lambdaCtx = addLocals(ctx, params);
      return $field(J, "jsArrow")(params, $field(J, "jsExprBody")(emitExpr(lambdaCtx, body0)), false);
    }
    function emitProcLambda(ctx, params, body0, isAsync) {
      const names = $map((param) => $field(param, "name"), params);
      const lambdaCtx = withAsyncDepth(addLocals(ctx, names), $addI(ctx.f[2], isAsync ? 1 : 0));
      return $field(J, "jsArrow")(names, $field(J, "jsBlockBody")(emitResultStmtList(lambdaCtx, body0)), isAsync);
    }
    function emitList(ctx, mode, elems) {
      return (($match$2277) => {
        if ($match$2277.$t === "StrictList") {
          return (() => {
            return $field(J, "jsArr")($map((elem) => emitExpr(ctx, elem), elems));
          })();
        }
        if ($match$2277.$t === "LazyList") {
          return (() => {
            return hostCall("$lazyList", [$field(J, "jsArr")($map((elem) => (() => {
              return $field(J, "jsArrow")([], $field(J, "jsExprBody")(emitExpr(ctx, elem)), false);
            })(), elems))]);
          })();
        }
        throw $matchFail("src/compile/emit.pf", 2277);
      })(mode);
    }
    function compVarNames(gens) {
      return $map((gen) => $field(gen, "gvar"), gens);
    }
    function emitCompSources(ctx, gens, priorNames) {
      return (($match$2329) => {
        if ($match$2329.$t === "None") {
          return [];
        }
        if ($match$2329.$t === "Some") {
          const cell = $match$2329;
          return (() => {
            const gen = cell.f[0].f[0];
            const sourceCtx = addLocals(ctx, priorNames);
            const sourceThunk = $field(J, "jsArrow")(priorNames, $field(J, "jsExprBody")(emitExpr(sourceCtx, $field(gen, "source"))), false);
            return $cons(sourceThunk, emitCompSources(ctx, cell.f[0].f[1], appendOneString(priorNames, $field(gen, "gvar"))));
          })();
        }
        throw $matchFail("src/compile/emit.pf", 2329);
      })($field(Compat, "uncons")(gens));
    }
    function compGuardExpr(ctx, guard) {
      return (($match$2376) => {
        if ($match$2376.$t === "None") {
          return $field(J, "jsBool")(true);
        }
        if ($match$2376.$t === "Some") {
          const found = $match$2376;
          return emitExpr(ctx, found.f[0]);
        }
        throw $matchFail("src/compile/emit.pf", 2376);
      })(guard);
    }
    function emitComp(ctx, gens, guard, body0, mode) {
      const names = compVarNames(gens);
      const bodyCtx = addLocals(ctx, names);
      const sources = emitCompSources(ctx, gens, []);
      const intrinsic = (($match$2404) => {
        if ($match$2404.$t === "StrictList") {
          return "$compStrict";
        }
        if ($match$2404.$t === "LazyList") {
          return "$compLazy";
        }
        throw $matchFail("src/compile/emit.pf", 2404);
      })(mode);
      return hostCall(intrinsic, [$field(J, "jsArr")(sources), $field(J, "jsArr")($map((name) => $field(J, "jsStr")(name), names)), $field(J, "jsArrow")(names, $field(J, "jsExprBody")(compGuardExpr(bodyCtx, guard)), false), $field(J, "jsArrow")(names, $field(J, "jsExprBody")(emitExpr(bodyCtx, body0)), false)]);
    }
    function emitRecord(ctx, id, tname, fields) {
      const values = $map((field) => emitExpr(ctx, $field(field, "value")), fields);
      return (($match$2464) => {
        if ($match$2464.$t === "TVariant") {
          const variant = $match$2464;
          return (() => {
            return variantObject(variant.f[0], variant.f[1], schemaFieldNames(ctx, variant.f[0]), values);
          })();
        }
        if (true) {
          return (() => {
            return recordObject(tname, schemaFieldNames(ctx, tname), values);
          })();
        }
        throw $matchFail("src/compile/emit.pf", 2464);
      })(typeOfId(ctx, id));
    }
    function stringIndexOf(names, value, index) {
      return (($match$2495) => {
        if ($match$2495.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$2495.$t === "Some") {
          const cell = $match$2495;
          return (() => {
            if (cell.f[0].f[0] === value) {
              return $makeVariant("Some", "Option", ["value"], [index]);
            } else {
              return stringIndexOf(cell.f[0].f[1], value, $addI(index, 1));
            }
          })();
        }
        throw $matchFail("src/compile/emit.pf", 2495);
      })($field(Compat, "uncons")(names));
    }
    function emitFieldBySchema(ctx, object, schemaName, fieldName) {
      return (($match$2523) => {
        if ($match$2523.$t === "Some") {
          const fields = $match$2523;
          return (() => {
            return (($match$2529) => {
              if ($match$2529.$t === "Some") {
                const index = $match$2529;
                return (() => {
                  return $field(J, "jsIndex")($field(J, "jsMember")(object, "f"), $field(J, "jsNum")($str(index.f[0])));
                })();
              }
              if ($match$2529.$t === "None") {
                return hostCall("$field", [object, $field(J, "jsStr")(fieldName)]);
              }
              throw $matchFail("src/compile/emit.pf", 2529);
            })(stringIndexOf(fields.f[0], fieldName, 0));
          })();
        }
        if ($match$2523.$t === "None") {
          return hostCall("$field", [object, $field(J, "jsStr")(fieldName)]);
        }
        throw $matchFail("src/compile/emit.pf", 2523);
      })(schemaFieldsFor(ctx, schemaName));
    }
    function emitField(ctx, object0, fname) {
      const object = emitExpr(ctx, object0);
      return (($match$2579) => {
        if ($match$2579.$t === "TNamed") {
          const named = $match$2579;
          return emitFieldBySchema(ctx, object, named.f[0], fname);
        }
        if ($match$2579.$t === "TVariant") {
          const variant = $match$2579;
          return emitFieldBySchema(ctx, object, variant.f[0], fname);
        }
        if (true) {
          return hostCall("$field", [object, $field(J, "jsStr")(fname)]);
        }
        throw $matchFail("src/compile/emit.pf", 2579);
      })(typeOfExpr(ctx, object0));
    }
    function emitIndex(ctx, object0, index0) {
      const object = emitExpr(ctx, object0);
      const index = emitExpr(ctx, index0);
      return (($match$2619) => {
        if ($match$2619.$t === "TArray") {
          return hostCall("$arrGet", [object, index]);
        }
        if ($match$2619.$t === "TDict") {
          return hostCall("$dictGet", [object, index]);
        }
        if ($match$2619.$t === "TList") {
          return hostCall("$nth", [object, index]);
        }
        if ($match$2619.$t === "TStr") {
          return hostCall("$strAt", [object, index]);
        }
        if (true) {
          return hostCall("$index", [object, index]);
        }
        throw $matchFail("src/compile/emit.pf", 2619);
      })(typeOfExpr(ctx, object0));
    }
    function emitDict(ctx, entries) {
      return hostCall("$dictFromEntries", [$field(J, "jsArr")($map((entry) => (() => {
        return $field(J, "jsArr")([emitExpr(ctx, $field(entry, "key")), emitExpr(ctx, $field(entry, "value"))]);
      })(), entries))]);
    }
    function emitArray(ctx, elems) {
      return hostCall("$newArray", [$field(J, "jsArr")($map((elem) => emitExpr(ctx, elem), elems))]);
    }
    function emitFmtPart(ctx, part) {
      return (($match$2702) => {
        if ($match$2702.$t === "FmtLit") {
          const lit = $match$2702;
          return $field(J, "jsStr")(lit.f[0]);
        }
        if ($match$2702.$t === "FmtExpr") {
          const expr = $match$2702;
          return (() => {
            return hostCall("$str", [emitExpr(ctx, expr.f[0])]);
          })();
        }
        throw $matchFail("src/compile/emit.pf", 2702);
      })(part);
    }
    function concatStringExprs(parts) {
      return (($match$2722) => {
        if ($match$2722.$t === "None") {
          return $field(J, "jsStr")("");
        }
        if ($match$2722.$t === "Some") {
          const first = $match$2722;
          return (() => {
            return $reduce((acc, part) => hostCall("$concatS", [acc, part]), first.f[0].f[0], first.f[0].f[1]);
          })();
        }
        throw $matchFail("src/compile/emit.pf", 2722);
      })($field(Compat, "uncons")(parts));
    }
    function emitFmt(ctx, parts) {
      return concatStringExprs($map((part) => emitFmtPart(ctx, part), parts));
    }
    function patternBoundNames(pattern) {
      return (($match$2762) => {
        if ($match$2762.$t === "PWild") {
          return [];
        }
        if ($match$2762.$t === "PVariant") {
          const p = $match$2762;
          return (() => {
            return (($match$2766) => {
              if ($match$2766.$t === "None") {
                return [];
              }
              if ($match$2766.$t === "Some") {
                const name = $match$2766;
                return [name.f[0]];
              }
              throw $matchFail("src/compile/emit.pf", 2766);
            })(p.f[1]);
          })();
        }
        if ($match$2762.$t === "PList") {
          const p = $match$2762;
          return (() => {
            const elemNames = $reduce((acc, elem) => (() => {
              return (($match$2777) => {
                if ($match$2777.$t === "PeBind") {
                  const b = $match$2777;
                  return appendOneString(acc, b.f[0]);
                }
                if ($match$2777.$t === "PeWild") {
                  return acc;
                }
                throw $matchFail("src/compile/emit.pf", 2777);
              })(elem);
            })(), [], p.f[0]);
            return (($match$2792) => {
              if ($match$2792.$t === "None") {
                return elemNames;
              }
              if ($match$2792.$t === "Some") {
                const rest = $match$2792;
                return (() => {
                  return (($match$2797) => {
                    if ($match$2797.$t === "PeBind") {
                      const b = $match$2797;
                      return appendOneString(elemNames, b.f[0]);
                    }
                    if ($match$2797.$t === "PeWild") {
                      return elemNames;
                    }
                    throw $matchFail("src/compile/emit.pf", 2797);
                  })(rest.f[0]);
                })();
              }
              throw $matchFail("src/compile/emit.pf", 2792);
            })(p.f[1]);
          })();
        }
        throw $matchFail("src/compile/emit.pf", 2762);
      })(pattern);
    }
    function emitListPatternBindings(ctx, subject, elems, index) {
      return (($match$2810) => {
        if ($match$2810.$t === "None") {
          return [];
        }
        if ($match$2810.$t === "Some") {
          const cell = $match$2810;
          return (() => {
            const rest = emitListPatternBindings(ctx, subject, cell.f[0].f[1], $addI(index, 1));
            return (($match$2828) => {
              if ($match$2828.$t === "PeWild") {
                return rest;
              }
              if ($match$2828.$t === "PeBind") {
                const bind = $match$2828;
                return (() => {
                  return $cons($field(J, "jsConst")(bind.f[0], hostCall("$nthU", [subject, $field(J, "jsNum")($str(index))])), rest);
                })();
              }
              throw $matchFail("src/compile/emit.pf", 2828);
            })(cell.f[0].f[0]);
          })();
        }
        throw $matchFail("src/compile/emit.pf", 2810);
      })($field(Compat, "uncons")(elems));
    }
    function emitRestBinding(subject, rest, count) {
      return (($match$2857) => {
        if ($match$2857.$t === "None") {
          return [];
        }
        if ($match$2857.$t === "Some") {
          const found = $match$2857;
          return (() => {
            return (($match$2861) => {
              if ($match$2861.$t === "PeWild") {
                return [];
              }
              if ($match$2861.$t === "PeBind") {
                const bind = $match$2861;
                return (() => {
                  return [$field(J, "jsConst")(bind.f[0], hostCall("$listRest", [subject, $field(J, "jsNum")($str(count))]))];
                })();
              }
              throw $matchFail("src/compile/emit.pf", 2861);
            })(found.f[0]);
          })();
        }
        throw $matchFail("src/compile/emit.pf", 2857);
      })(rest);
    }
    function emitArmPlan(ctx, subject, pattern) {
      const armCtx = addLocals(ctx, patternBoundNames(pattern));
      return (($match$2894) => {
        if ($match$2894.$t === "PWild") {
          return (() => {
            return $makeRecord("EmitArmPlan", ["condition", "bindings", "armCtx"], [$field(J, "jsBool")(true), [], armCtx]);
          })();
        }
        if ($match$2894.$t === "PVariant") {
          const p = $match$2894;
          return (() => {
            const bindings = (($match$2906) => {
              if ($match$2906.$t === "None") {
                return [];
              }
              if ($match$2906.$t === "Some") {
                const bind = $match$2906;
                return [$field(J, "jsConst")(bind.f[0], subject)];
              }
              throw $matchFail("src/compile/emit.pf", 2906);
            })(p.f[1]);
            return $makeRecord("EmitArmPlan", ["condition", "bindings", "armCtx"], [$field(J, "jsBin")("===", $field(J, "jsMember")(subject, "$t"), $field(J, "jsStr")(p.f[0])), bindings, armCtx]);
          })();
        }
        if ($match$2894.$t === "PList") {
          const p = $match$2894;
          return (() => {
            const count = $length(p.f[0]);
            const condition = (($match$2942) => {
              if ($match$2942.$t === "None") {
                return hostCall("$listExactLen", [subject, $field(J, "jsNum")($str(count))]);
              }
              if ($match$2942.$t === "Some") {
                return hostCall("$listMinLen", [subject, $field(J, "jsNum")($str(count))]);
              }
              throw $matchFail("src/compile/emit.pf", 2942);
            })(p.f[1]);
            const elementBindings = emitListPatternBindings(ctx, subject, p.f[0], 0);
            const bindings = appendJsStmts(elementBindings, emitRestBinding(subject, p.f[1], count));
            return $makeRecord("EmitArmPlan", ["condition", "bindings", "armCtx"], [condition, bindings, armCtx]);
          })();
        }
        throw $matchFail("src/compile/emit.pf", 2894);
      })(pattern);
    }
    function emitArmReturn(plan, arm) {
      const result = $field(J, "jsRet")(emitExpr(plan.f[2], $field(arm, "body")));
      return (($match$3003) => {
        if ($match$3003.$t === "None") {
          return appendJsStmts(plan.f[1], [result]);
        }
        if ($match$3003.$t === "Some") {
          const guard = $match$3003;
          return (() => {
            return appendJsStmts(plan.f[1], [$field(J, "jsIf")(emitExpr(plan.f[2], guard.f[0]), [result], [])]);
          })();
        }
        throw $matchFail("src/compile/emit.pf", 3003);
      })($field(arm, "guard"));
    }
    function emitMatchArms(ctx, subject, arms) {
      return (($match$3033) => {
        if ($match$3033.$t === "None") {
          return [];
        }
        if ($match$3033.$t === "Some") {
          const cell = $match$3033;
          return (() => {
            const arm = cell.f[0].f[0];
            const plan = emitArmPlan(ctx, subject, $field(arm, "pattern"));
            return $cons($field(J, "jsIf")(plan.f[0], emitArmReturn(plan, arm), []), emitMatchArms(ctx, subject, cell.f[0].f[1]));
          })();
        }
        throw $matchFail("src/compile/emit.pf", 3033);
      })($field(Compat, "uncons")(arms));
    }
    function emitMatch(ctx, id, subject0, arms0) {
      const subjectName = matchSubjectName(id);
      const subject = $field(J, "jsId")(subjectName);
      const arms = emitMatchArms(ctx, subject, arms0);
      const fail = $field(J, "jsThrow")(hostCall("$matchFail", [$field(J, "jsStr")($field(ctx.f[1], "moduleId")), $field(J, "jsNum")($str(id))]));
      return $field(J, "jsCall")($field(J, "jsArrow")([subjectName], $field(J, "jsBlockBody")(appendJsStmts(arms, [fail])), false), [emitExpr(ctx, subject0)]);
    }
    function emitBlockResult(ctx, stmts) {
      const blockCtx = addLocals(ctx, boundNamesOfStmts(stmts));
      const split = splitLastStmt(stmts);
      const prefix = emitStmtList(blockCtx, split.f[0]);
      return (($match$3149) => {
        if ($match$3149.$t === "None") {
          return appendJsStmts(prefix, [$field(J, "jsRet")($field(J, "jsNull")())]);
        }
        if ($match$3149.$t === "Some") {
          const last = $match$3149;
          return (() => {
            return (($match$3163) => {
              if ($match$3163.$t === "SExpr") {
                const s = $match$3163;
                return (() => {
                  return appendJsStmts(prefix, [$field(J, "jsRet")(emitExpr(blockCtx, s.f[1]))]);
                })();
              }
              if ($match$3163.$t === "SIf") {
                const s = $match$3163;
                return (() => {
                  const elseJs = (($match$3181) => {
                    if ($match$3181.$t === "None") {
                      return [$field(J, "jsRet")($field(J, "jsNull")())];
                    }
                    if ($match$3181.$t === "Some") {
                      const e = $match$3181;
                      return emitBlockResult(blockCtx, e.f[0]);
                    }
                    throw $matchFail("src/compile/emit.pf", 3181);
                  })(s.f[3]);
                  return appendJsStmts(prefix, [$field(J, "jsIf")(emitExpr(blockCtx, s.f[1]), emitBlockResult(blockCtx, s.f[2]), elseJs)]);
                })();
              }
              if ($match$3163.$t === "SReturn") {
                return (() => {
                  return appendJsStmts(prefix, emitStmt(blockCtx, last.f[0]));
                })();
              }
              if (true) {
                return (() => {
                  return appendJsStmts(appendJsStmts(prefix, emitStmt(blockCtx, last.f[0])), [$field(J, "jsRet")($field(J, "jsNull")())]);
                })();
              }
              throw $matchFail("src/compile/emit.pf", 3163);
            })(last.f[0]);
          })();
        }
        throw $matchFail("src/compile/emit.pf", 3149);
      })(split.f[1]);
    }
    function emitBlockExpr(ctx, stmts) {
      return $field(J, "jsCall")($field(J, "jsArrow")([], $field(J, "jsBlockBody")(emitBlockResult(ctx, stmts)), false), []);
    }
    function emitExpr(ctx, expr) {
      return (($match$3266) => {
        if ($match$3266.$t === "EInt") {
          const e = $match$3266;
          return emitIntLiteral(e.f[1]);
        }
        if ($match$3266.$t === "EFloat") {
          const e = $match$3266;
          return $field(J, "jsNum")(e.f[1]);
        }
        if ($match$3266.$t === "EBool") {
          const e = $match$3266;
          return $field(J, "jsBool")(e.f[1]);
        }
        if ($match$3266.$t === "EStr") {
          const e = $match$3266;
          return $field(J, "jsStr")(e.f[1]);
        }
        if ($match$3266.$t === "EChar") {
          const e = $match$3266;
          return $field(J, "jsStr")(e.f[1]);
        }
        if ($match$3266.$t === "EByte") {
          const e = $match$3266;
          return $field(J, "jsNum")($str(e.f[1]));
        }
        if ($match$3266.$t === "EVar") {
          const e = $match$3266;
          return emitVar(ctx, e.f[1]);
        }
        if ($match$3266.$t === "EUnary") {
          const e = $match$3266;
          return emitUnary(ctx, e.f[1], e.f[2]);
        }
        if ($match$3266.$t === "EBinary") {
          const e = $match$3266;
          return specializeBin(ctx, e.f[1], e.f[2], e.f[3]);
        }
        if ($match$3266.$t === "EIf") {
          const e = $match$3266;
          return (() => {
            return $field(J, "jsCond")(emitExpr(ctx, e.f[1]), emitExpr(ctx, e.f[2]), emitExpr(ctx, e.f[3]));
          })();
        }
        if ($match$3266.$t === "ECall") {
          const e = $match$3266;
          return emitCall(ctx, e.f[0], e.f[1], e.f[2]);
        }
        if ($match$3266.$t === "ELambda") {
          const e = $match$3266;
          return emitLambda(ctx, e.f[1], e.f[2]);
        }
        if ($match$3266.$t === "EProcLambda") {
          const e = $match$3266;
          return emitProcLambda(ctx, e.f[1], e.f[3], e.f[4]);
        }
        if ($match$3266.$t === "EBlock") {
          const e = $match$3266;
          return emitBlockExpr(ctx, e.f[1]);
        }
        if ($match$3266.$t === "EList") {
          const e = $match$3266;
          return emitList(ctx, e.f[2], e.f[1]);
        }
        if ($match$3266.$t === "EComp") {
          const e = $match$3266;
          return emitComp(ctx, e.f[2], e.f[3], e.f[1], e.f[4]);
        }
        if ($match$3266.$t === "ERecord") {
          const e = $match$3266;
          return emitRecord(ctx, e.f[0], e.f[1], e.f[2]);
        }
        if ($match$3266.$t === "EField") {
          const e = $match$3266;
          return emitField(ctx, e.f[1], e.f[2]);
        }
        if ($match$3266.$t === "EIndex") {
          const e = $match$3266;
          return emitIndex(ctx, e.f[1], e.f[2]);
        }
        if ($match$3266.$t === "EMatch") {
          const e = $match$3266;
          return emitMatch(ctx, e.f[0], e.f[1], e.f[2]);
        }
        if ($match$3266.$t === "EDict") {
          const e = $match$3266;
          return emitDict(ctx, e.f[1]);
        }
        if ($match$3266.$t === "EArray") {
          const e = $match$3266;
          return emitArray(ctx, e.f[1]);
        }
        if ($match$3266.$t === "EAwait") {
          const e = $match$3266;
          return $field(J, "jsAwait")(emitExpr(ctx, e.f[1]));
        }
        if ($match$3266.$t === "EFmt") {
          const e = $match$3266;
          return emitFmt(ctx, e.f[1]);
        }
        throw $matchFail("src/compile/emit.pf", 3266);
      })(expr);
    }
    function selfCallArgs(name, expr) {
      return (($match$3445) => {
        if ($match$3445.$t === "ECall") {
          const call = $match$3445;
          return (() => {
            return (($match$3448) => {
              if ($match$3448.$t === "EVar") {
                const callee = $match$3448;
                return (() => {
                  return callee.f[1] === name ? $makeVariant("Some", "Option", ["value"], [call.f[2]]) : $makeVariant("None", "Option", [], []);
                })();
              }
              if (true) {
                return $makeVariant("None", "Option", [], []);
              }
              throw $matchFail("src/compile/emit.pf", 3448);
            })(call.f[1]);
          })();
        }
        if (true) {
          return $makeVariant("None", "Option", [], []);
        }
        throw $matchFail("src/compile/emit.pf", 3445);
      })(expr);
    }
    function tailCallsInArms(name, arms) {
      return (($match$3467) => {
        if ($match$3467.$t === "None") {
          return [];
        }
        if ($match$3467.$t === "Some") {
          const cell = $match$3467;
          return (() => {
            return appendInts(tailCallsInExpr(name, $field(cell.f[0].f[0], "body")), tailCallsInArms(name, cell.f[0].f[1]));
          })();
        }
        throw $matchFail("src/compile/emit.pf", 3467);
      })($field(Compat, "uncons")(arms));
    }
    function tailCallsInExpr(name, expr) {
      return (($match$3492) => {
        if ($match$3492.$t === "Some") {
          return [$field(A, "exprId")(expr)];
        }
        if ($match$3492.$t === "None") {
          return (() => {
            return (($match$3503) => {
              if ($match$3503.$t === "EIf") {
                const e = $match$3503;
                return (() => {
                  return appendInts(tailCallsInExpr(name, e.f[2]), tailCallsInExpr(name, e.f[3]));
                })();
              }
              if ($match$3503.$t === "EMatch") {
                const e = $match$3503;
                return tailCallsInArms(name, e.f[2]);
              }
              if (true) {
                return [];
              }
              throw $matchFail("src/compile/emit.pf", 3503);
            })(expr);
          })();
        }
        throw $matchFail("src/compile/emit.pf", 3492);
      })(selfCallArgs(name, expr));
    }
    function tailCallsInLastStmt(name, stmt) {
      while (true) {
        const $match$3528 = stmt;
        if ($match$3528.$t === "SReturn") {
          const s = $match$3528;
          return (() => {
            return (($match$3531) => {
              if ($match$3531.$t === "None") {
                return [];
              }
              if ($match$3531.$t === "Some") {
                const value = $match$3531;
                return tailCallsInExpr(name, value.f[0]);
              }
              throw $matchFail("src/compile/emit.pf", 3531);
            })(s.f[1]);
          })();
        }
        if ($match$3528.$t === "SExpr") {
          const s = $match$3528;
          return tailCallsInExpr(name, s.f[1]);
        }
        if ($match$3528.$t === "SIf") {
          const s = $match$3528;
          return (() => {
            const elseCalls = (($match$3547) => {
              if ($match$3547.$t === "None") {
                return [];
              }
              if ($match$3547.$t === "Some") {
                const e = $match$3547;
                return tailCallsOf(name, e.f[0]);
              }
              throw $matchFail("src/compile/emit.pf", 3547);
            })(s.f[3]);
            return appendInts(tailCallsOf(name, s.f[2]), elseCalls);
          })();
        }
        if ($match$3528.$t === "SExport") {
          const s = $match$3528;
          const $tc$3570$0 = name;
          const $tc$3570$1 = s.f[1];
          name = $tc$3570$0;
          stmt = $tc$3570$1;
          continue;
        }
        if (true) {
          return [];
        }
        throw $matchFail("src/compile/emit.pf", 3528);
      }
    }
    function tailCallsOf(name, body) {
      const split = splitLastStmt(body);
      return (($match$3578) => {
        if ($match$3578.$t === "None") {
          return [];
        }
        if ($match$3578.$t === "Some") {
          const last = $match$3578;
          return tailCallsInLastStmt(name, last.f[0]);
        }
        throw $matchFail("src/compile/emit.pf", 3578);
      })(split.f[1]);
    }
    function emitTailTemps(ctx, args, callId, index) {
      return (($match$3590) => {
        if ($match$3590.$t === "None") {
          return [];
        }
        if ($match$3590.$t === "Some") {
          const cell = $match$3590;
          return (() => {
            return $cons($field(J, "jsConst")(tailTemp(callId, index), emitExpr(ctx, cell.f[0].f[0])), emitTailTemps(ctx, cell.f[0].f[1], callId, $addI(index, 1)));
          })();
        }
        throw $matchFail("src/compile/emit.pf", 3590);
      })($field(Compat, "uncons")(args));
    }
    function emitTailAssignments(params, callId, index) {
      return (($match$3625) => {
        if ($match$3625.$t === "None") {
          return [];
        }
        if ($match$3625.$t === "Some") {
          const cell = $match$3625;
          return (() => {
            return $cons($field(J, "jsAssign")($field(J, "jsId")(cell.f[0].f[0]), $field(J, "jsId")(tailTemp(callId, index))), emitTailAssignments(cell.f[0].f[1], callId, $addI(index, 1)));
          })();
        }
        throw $matchFail("src/compile/emit.pf", 3625);
      })($field(Compat, "uncons")(params));
    }
    function emitTailCall(ctx, params, expr, args) {
      const callId = $field(A, "exprId")(expr);
      const temps = emitTailTemps(ctx, args, callId, 0);
      const assignments = emitTailAssignments(params, callId, 0);
      return appendJsStmts(appendJsStmts(temps, assignments), [$field(J, "jsContinue")()]);
    }
    function emitTailArmBody(ctx, name, params, plan, arm) {
      const result = emitTailExpr(plan.f[2], name, params, $field(arm, "body"));
      return (($match$3701) => {
        if ($match$3701.$t === "None") {
          return appendJsStmts(plan.f[1], result);
        }
        if ($match$3701.$t === "Some") {
          const guard = $match$3701;
          return (() => {
            return appendJsStmts(plan.f[1], [$field(J, "jsIf")(emitExpr(plan.f[2], guard.f[0]), result, [])]);
          })();
        }
        throw $matchFail("src/compile/emit.pf", 3701);
      })($field(arm, "guard"));
    }
    function emitTailMatchArms(ctx, name, params, subject, arms) {
      return (($match$3729) => {
        if ($match$3729.$t === "None") {
          return [];
        }
        if ($match$3729.$t === "Some") {
          const cell = $match$3729;
          return (() => {
            const arm = cell.f[0].f[0];
            const plan = emitArmPlan(ctx, subject, $field(arm, "pattern"));
            return $cons($field(J, "jsIf")(plan.f[0], emitTailArmBody(ctx, name, params, plan, arm), []), emitTailMatchArms(ctx, name, params, subject, cell.f[0].f[1]));
          })();
        }
        throw $matchFail("src/compile/emit.pf", 3729);
      })($field(Compat, "uncons")(arms));
    }
    function emitTailMatch(ctx, name, params, id, subject0, arms0) {
      const subjectName = matchSubjectName(id);
      const subject = $field(J, "jsId")(subjectName);
      const arms = emitTailMatchArms(ctx, name, params, subject, arms0);
      const fail = $field(J, "jsThrow")(hostCall("$matchFail", [$field(J, "jsStr")($field(ctx.f[1], "moduleId")), $field(J, "jsNum")($str(id))]));
      return $cons($field(J, "jsConst")(subjectName, emitExpr(ctx, subject0)), appendJsStmts(arms, [fail]));
    }
    function emitTailExpr(ctx, name, params, expr) {
      return (($match$3828) => {
        if ($match$3828.$t === "Some") {
          const args = $match$3828;
          return emitTailCall(ctx, params, expr, args.f[0]);
        }
        if ($match$3828.$t === "None") {
          return (() => {
            return (($match$3841) => {
              if ($match$3841.$t === "EIf") {
                const e = $match$3841;
                return (() => {
                  return [$field(J, "jsIf")(emitExpr(ctx, e.f[1]), emitTailExpr(ctx, name, params, e.f[2]), emitTailExpr(ctx, name, params, e.f[3]))];
                })();
              }
              if ($match$3841.$t === "EMatch") {
                const e = $match$3841;
                return (() => {
                  return emitTailMatch(ctx, name, params, e.f[0], e.f[1], e.f[2]);
                })();
              }
              if (true) {
                return [$field(J, "jsRet")(emitExpr(ctx, expr))];
              }
              throw $matchFail("src/compile/emit.pf", 3841);
            })(expr);
          })();
        }
        throw $matchFail("src/compile/emit.pf", 3828);
      })(selfCallArgs(name, expr));
    }
    function emitTailLastStmt(ctx, name, params, stmt) {
      while (true) {
        const $match$3892 = stmt;
        if ($match$3892.$t === "SReturn") {
          const s = $match$3892;
          return (() => {
            return (($match$3895) => {
              if ($match$3895.$t === "None") {
                return [$field(J, "jsRet")($field(J, "jsNull")())];
              }
              if ($match$3895.$t === "Some") {
                const value = $match$3895;
                return emitTailExpr(ctx, name, params, value.f[0]);
              }
              throw $matchFail("src/compile/emit.pf", 3895);
            })(s.f[1]);
          })();
        }
        if ($match$3892.$t === "SExpr") {
          const s = $match$3892;
          return emitTailExpr(ctx, name, params, s.f[1]);
        }
        if ($match$3892.$t === "SIf") {
          const s = $match$3892;
          return (() => {
            const elseJs = (($match$3921) => {
              if ($match$3921.$t === "None") {
                return [];
              }
              if ($match$3921.$t === "Some") {
                const e = $match$3921;
                return emitTailStmtList(ctx, name, params, e.f[0]);
              }
              throw $matchFail("src/compile/emit.pf", 3921);
            })(s.f[3]);
            return [$field(J, "jsIf")(emitExpr(ctx, s.f[1]), emitTailStmtList(ctx, name, params, s.f[2]), elseJs)];
          })();
        }
        if ($match$3892.$t === "SExport") {
          const s = $match$3892;
          const $tc$3957$0 = ctx;
          const $tc$3957$1 = name;
          const $tc$3957$2 = params;
          const $tc$3957$3 = s.f[1];
          ctx = $tc$3957$0;
          name = $tc$3957$1;
          params = $tc$3957$2;
          stmt = $tc$3957$3;
          continue;
        }
        if (true) {
          return (() => {
            return appendJsStmts(emitStmt(ctx, stmt), [$field(J, "jsRet")($field(J, "jsNull")())]);
          })();
        }
        throw $matchFail("src/compile/emit.pf", 3892);
      }
    }
    function emitTailStmtList(ctx, name, params, stmts) {
      const bodyCtx = addLocals(ctx, boundNamesOfStmts(stmts));
      const split = splitLastStmt(stmts);
      const prefix = emitStmtList(bodyCtx, split.f[0]);
      return (($match$3992) => {
        if ($match$3992.$t === "None") {
          return appendJsStmts(prefix, [$field(J, "jsRet")($field(J, "jsNull")())]);
        }
        if ($match$3992.$t === "Some") {
          const last = $match$3992;
          return (() => {
            return appendJsStmts(prefix, emitTailLastStmt(bodyCtx, name, params, last.f[0]));
          })();
        }
        throw $matchFail("src/compile/emit.pf", 3992);
      })(split.f[1]);
    }
    function emitIndexAssign(ctx, object1, index1, value1) {
      const object = emitExpr(ctx, object1);
      const index = emitExpr(ctx, index1);
      const value = emitExpr(ctx, value1);
      const call = (($match$4034) => {
        if ($match$4034.$t === "TArray") {
          return hostCall("$arrSet", [object, index, value]);
        }
        if ($match$4034.$t === "TDict") {
          return hostCall("$dictSet", [object, index, value]);
        }
        if (true) {
          return hostCall("$indexSet", [object, index, value]);
        }
        throw $matchFail("src/compile/emit.pf", 4034);
      })(typeOfExpr(ctx, object1));
      return [$field(J, "jsExprStmt")(call)];
    }
    function emitResultStmtList(ctx, stmts) {
      const bodyCtx = addLocals(ctx, boundNamesOfStmts(stmts));
      const split = splitLastStmt(stmts);
      const prefix = emitStmtList(bodyCtx, split.f[0]);
      return (($match$4085) => {
        if ($match$4085.$t === "None") {
          return appendJsStmts(prefix, [$field(J, "jsRet")($field(J, "jsNull")())]);
        }
        if ($match$4085.$t === "Some") {
          const last = $match$4085;
          return (() => {
            return (($match$4099) => {
              if ($match$4099.$t === "SExpr") {
                const s = $match$4099;
                return (() => {
                  return appendJsStmts(prefix, [$field(J, "jsRet")(emitExpr(bodyCtx, s.f[1]))]);
                })();
              }
              if ($match$4099.$t === "SIf") {
                const s = $match$4099;
                return (() => {
                  const elseJs = (($match$4117) => {
                    if ($match$4117.$t === "None") {
                      return [$field(J, "jsRet")($field(J, "jsNull")())];
                    }
                    if ($match$4117.$t === "Some") {
                      const e = $match$4117;
                      return emitResultStmtList(bodyCtx, e.f[0]);
                    }
                    throw $matchFail("src/compile/emit.pf", 4117);
                  })(s.f[3]);
                  return appendJsStmts(prefix, [$field(J, "jsIf")(emitExpr(bodyCtx, s.f[1]), emitResultStmtList(bodyCtx, s.f[2]), elseJs)]);
                })();
              }
              if ($match$4099.$t === "SReturn") {
                return (() => {
                  return appendJsStmts(prefix, emitStmt(bodyCtx, last.f[0]));
                })();
              }
              if (true) {
                return (() => {
                  return appendJsStmts(appendJsStmts(prefix, emitStmt(bodyCtx, last.f[0])), [$field(J, "jsRet")($field(J, "jsNull")())]);
                })();
              }
              throw $matchFail("src/compile/emit.pf", 4099);
            })(last.f[0]);
          })();
        }
        throw $matchFail("src/compile/emit.pf", 4085);
      })(split.f[1]);
    }
    function memoFlag(kind) {
      return (($match$4184) => {
        if ($match$4184.$t === "PureFn") {
          const k = $match$4184;
          return k.f[0];
        }
        if ($match$4184.$t === "ProcFn") {
          return false;
        }
        throw $matchFail("src/compile/emit.pf", 4184);
      })(kind);
    }
    function asyncFlag(kind) {
      return (($match$4191) => {
        if ($match$4191.$t === "PureFn") {
          return false;
        }
        if ($match$4191.$t === "ProcFn") {
          const k = $match$4191;
          return k.f[0];
        }
        throw $matchFail("src/compile/emit.pf", 4191);
      })(kind);
    }
    function emitFn(ctx, name, params, body0, kind) {
      const fnCtx0 = addLocals(ctx, params);
      const fnCtx = withAsyncDepth(withTailCtx(fnCtx0, $makeVariant("EmitTailOf", "EmitTailCtx", ["name", "params"], [name, params])), $addI(ctx.f[2], asyncFlag(kind) ? 1 : 0));
      const hasTail = $gtI($length(tailCallsOf(name, body0)), 0);
      const body = hasTail ? [$field(J, "jsWhile")($field(J, "jsBool")(true), emitTailStmtList(fnCtx, name, params, body0))] : emitResultStmtList(fnCtx, body0);
      const declaration = $field(J, "jsFun")(name, params, body, asyncFlag(kind));
      if (memoFlag(kind)) {
        return [declaration, $field(J, "jsAssign")($field(J, "jsId")(name), hostCall("$memoize", [$field(J, "jsId")(name)]))];
      } else {
        return [declaration];
      }
    }
    function emitVariantDecl(unionName, variant) {
      const fieldNames = fieldDeclNames($field(variant, "fields"));
      const value = variantObject($field(variant, "vname"), unionName, fieldNames, $map((fieldName) => $field(J, "jsId")(fieldName), fieldNames));
      if ($eqI($length(fieldNames), 0)) {
        return [$field(J, "jsConst")($field(variant, "vname"), value)];
      } else {
        return [$field(J, "jsFun")($field(variant, "vname"), fieldNames, [$field(J, "jsRet")(value)], false)];
      }
    }
    function emitVariantDecls(unionName, variants) {
      return (($match$4337) => {
        if ($match$4337.$t === "None") {
          return [];
        }
        if ($match$4337.$t === "Some") {
          const cell = $match$4337;
          return (() => {
            return appendJsStmts(emitVariantDecl(unionName, cell.f[0].f[0]), emitVariantDecls(unionName, cell.f[0].f[1]));
          })();
        }
        throw $matchFail("src/compile/emit.pf", 4337);
      })($field(Compat, "uncons")(variants));
    }
    function emitTypeDecl(decl) {
      return (($match$4361) => {
        if ($match$4361.$t === "RecordDecl") {
          return [];
        }
        if ($match$4361.$t === "UnionDecl") {
          const u = $match$4361;
          return emitVariantDecls(u.f[0], u.f[1]);
        }
        throw $matchFail("src/compile/emit.pf", 4361);
      })(decl);
    }
    function requireExpr(path) {
      return hostCall("$require", [$field(J, "jsStr")(path)]);
    }
    function emitNamedImports(temp, names) {
      return (($match$4382) => {
        if ($match$4382.$t === "None") {
          return [];
        }
        if ($match$4382.$t === "Some") {
          const cell = $match$4382;
          return (() => {
            const item = cell.f[0].f[0];
            const localName = (($match$4393) => {
              if ($match$4393.$t === "None") {
                return $field(item, "name");
              }
              if ($match$4393.$t === "Some") {
                const alias = $match$4393;
                return alias.f[0];
              }
              throw $matchFail("src/compile/emit.pf", 4393);
            })($field(item, "alias"));
            return $cons($field(J, "jsConst")(localName, $field(J, "jsMember")($field(J, "jsId")(temp), $field(item, "name"))), emitNamedImports(temp, cell.f[0].f[1]));
          })();
        }
        throw $matchFail("src/compile/emit.pf", 4382);
      })($field(Compat, "uncons")(names));
    }
    function emitImport(id, spec0, rawPath) {
      return (($match$4425) => {
        if ($match$4425.$t === "INamespace") {
          const spec = $match$4425;
          return (() => {
            return [$field(J, "jsConst")(spec.f[0], requireExpr(rawPath))];
          })();
        }
        if ($match$4425.$t === "INames") {
          const spec = $match$4425;
          return (() => {
            const temp = importTemp(id);
            return $cons($field(J, "jsConst")(temp, requireExpr(rawPath)), emitNamedImports(temp, spec.f[0]));
          })();
        }
        if ($match$4425.$t === "IStar") {
          return (() => {
            return [$field(J, "jsConst")(starTemp(id), requireExpr(rawPath))];
          })();
        }
        throw $matchFail("src/compile/emit.pf", 4425);
      })(spec0);
    }
    function platformLabel(platform) {
      return (($match$4472) => {
        if ($match$4472.$t === "Some") {
          const s = $match$4472;
          return s.f[0];
        }
        if ($match$4472.$t === "None") {
          return "";
        }
        throw $matchFail("src/compile/emit.pf", 4472);
      })(platform);
    }
    function isNodePlatform(platform) {
      const label = platformLabel(platform);
      return label === "node" || label === "NodeOnly" || label === "node-only";
    }
    function browserExternBody(decl) {
      return [$field(J, "jsThrow")($field(J, "jsNew")($field(J, "jsId")("Error"), [$field(J, "jsStr")($concatS($concatS("Extern '", $field(decl, "name")), "' is unavailable in browser builds."))]))];
    }
    function emitExternDecl(ctx, decl) {
      const params = $map((param) => $field(param, "name"), $field(decl, "params"));
      if ($field(ctx.f[1], "browserSafe") && isNodePlatform($field(decl, "platform"))) {
        return [$field(J, "jsFun")($field(decl, "name"), params, browserExternBody(decl), (($match$4544) => {
          if ($match$4544.$t === "ExternFunction") {
            return false;
          }
          if ($match$4544.$t === "ExternProc") {
            const p = $match$4544;
            return p.f[0];
          }
          throw $matchFail("src/compile/emit.pf", 4544);
        })($field(decl, "kind")))];
      } else {
        return [$field(J, "jsConst")($field(decl, "name"), hostCall("$extern", [$field(J, "jsStr")(platformLabel($field(decl, "platform"))), $field(J, "jsStr")($field(decl, "name"))]))];
      }
    }
    function emitStmt(ctx, stmt) {
      while (true) {
        const $match$4577 = stmt;
        if ($match$4577.$t === "SLet") {
          const s = $match$4577;
          return [$field(J, "jsConst")(s.f[1], emitExpr(ctx, s.f[2]))];
        }
        if ($match$4577.$t === "SVar") {
          const s = $match$4577;
          return [$field(J, "jsLet")(s.f[1], emitExpr(ctx, s.f[2]))];
        }
        if ($match$4577.$t === "SAssign") {
          const s = $match$4577;
          return (() => {
            return [$field(J, "jsAssign")($field(J, "jsId")(s.f[1]), emitExpr(ctx, s.f[2]))];
          })();
        }
        if ($match$4577.$t === "SIndexAssign") {
          const s = $match$4577;
          return emitIndexAssign(ctx, s.f[1], s.f[2], s.f[3]);
        }
        if ($match$4577.$t === "SFun") {
          const s = $match$4577;
          return emitFn(ctx, s.f[1], s.f[2], s.f[3], s.f[4]);
        }
        if ($match$4577.$t === "SType") {
          const s = $match$4577;
          return emitTypeDecl(s.f[1]);
        }
        if ($match$4577.$t === "SExpr") {
          const s = $match$4577;
          return [$field(J, "jsExprStmt")(emitExpr(ctx, s.f[1]))];
        }
        if ($match$4577.$t === "SReturn") {
          const s = $match$4577;
          return (() => {
            return (($match$4651) => {
              if ($match$4651.$t === "None") {
                return [$field(J, "jsRet")($field(J, "jsNull")())];
              }
              if ($match$4651.$t === "Some") {
                const value = $match$4651;
                return [$field(J, "jsRet")(emitExpr(ctx, value.f[0]))];
              }
              throw $matchFail("src/compile/emit.pf", 4651);
            })(s.f[1]);
          })();
        }
        if ($match$4577.$t === "SIf") {
          const s = $match$4577;
          return (() => {
            const elseJs = (($match$4672) => {
              if ($match$4672.$t === "None") {
                return [];
              }
              if ($match$4672.$t === "Some") {
                const e = $match$4672;
                return emitStmtList(addLocals(ctx, boundNamesOfStmts(e.f[0])), e.f[0]);
              }
              throw $matchFail("src/compile/emit.pf", 4672);
            })(s.f[3]);
            return [$field(J, "jsIf")(emitExpr(ctx, s.f[1]), emitStmtList(addLocals(ctx, boundNamesOfStmts(s.f[2])), s.f[2]), elseJs)];
          })();
        }
        if ($match$4577.$t === "SWhile") {
          const s = $match$4577;
          return (() => {
            return [$field(J, "jsWhile")(emitExpr(ctx, s.f[1]), emitStmtList(addLocals(ctx, boundNamesOfStmts(s.f[2])), s.f[2]))];
          })();
        }
        if ($match$4577.$t === "SImport") {
          const s = $match$4577;
          return emitImport(s.f[0], s.f[1], s.f[2]);
        }
        if ($match$4577.$t === "SExport") {
          const s = $match$4577;
          const $tc$4744$0 = ctx;
          const $tc$4744$1 = s.f[1];
          ctx = $tc$4744$0;
          stmt = $tc$4744$1;
          continue;
        }
        if ($match$4577.$t === "SExtern") {
          const s = $match$4577;
          return emitExternDecl(ctx, s.f[1]);
        }
        throw $matchFail("src/compile/emit.pf", 4577);
      }
    }
    function emitStmtList(ctx, stmts) {
      return (($match$4752) => {
        if ($match$4752.$t === "None") {
          return [];
        }
        if ($match$4752.$t === "Some") {
          const cell = $match$4752;
          return (() => {
            return appendJsStmts(emitStmt(ctx, cell.f[0].f[0]), emitStmtList(ctx, cell.f[0].f[1]));
          })();
        }
        throw $matchFail("src/compile/emit.pf", 4752);
      })($field(Compat, "uncons")(stmts));
    }
    function emitExprForTest(types, opts, expr) {
      return emitExpr(emptyCtx(types, opts), expr);
    }
    function emitStmtForTest(types, opts, stmt) {
      return emitStmt(emptyCtx(types, opts), stmt);
    }
    function emitModule(cm, opts) {
      const schemas = schemasOfStmts($field($field(cm, "ast"), "stmts"));
      const locals = putLocals($field(IMS, "imsEmpty")(), boundNamesOfStmts($field($field(cm, "ast"), "stmts")));
      const ctx0 = emptyCtx($field($field(cm, "infer"), "types"), opts);
      const ctx1 = withLocalsMap(ctx0, locals);
      const ctx2 = withStars(ctx1, starImportsOfStmts($field($field(cm, "ast"), "stmts")));
      const ctx = withSchemaFields(ctx2, schemaFieldMapFrom($field(opts, "schemaFields"), schemas));
      return emittedModule($field(opts, "moduleId"), emitStmtList(ctx, $field($field(cm, "ast"), "stmts")), exportNamesOfStmts($field($field(cm, "ast"), "stmts")), requiresOfStmts($field($field(cm, "ast"), "stmts")), schemas);
    }
    exports["HostReq"] = HostReq;
    exports["BuiltinReq"] = BuiltinReq;
    exports["UserReq"] = UserReq;
    exports["emitOpts"] = emitOpts;
    exports["withIntrinsics"] = withIntrinsics;
    exports["emitOptsWithSchemas"] = emitOptsWithSchemas;
    exports["hostReq"] = hostReq;
    exports["builtinReq"] = builtinReq;
    exports["userReq"] = userReq;
    exports["emitSchema"] = emitSchema;
    exports["emittedModule"] = emittedModule;
    exports["tailCallsOf"] = tailCallsOf;
    exports["emitExprForTest"] = emitExprForTest;
    exports["emitStmtForTest"] = emitStmtForTest;
    exports["emitModule"] = emitModule;
  });
  $registerSchemas([{name: "NodeFiles", union: "Target", fields: ["outDirRel"], variant: true}, {name: "NodeBundle", union: "Target", fields: [], variant: true}, {name: "BrowserBundle", union: "Target", fields: ["page"], variant: true}, {name: "BarePage", union: "PageMode", fields: ["title"], variant: true}, {name: "ServeApp", union: "PageMode", fields: ["apiPath"], variant: true}, {name: "TeaPage", union: "PageMode", fields: ["title"], variant: true}, {name: "PlaygroundRunner", union: "PageMode", fields: [], variant: true}, {name: "HostSrc", union: null, fields: ["coreText", "platformText"], variant: false}, {name: "OutFile", union: null, fields: ["relPath", "text"], variant: false}, {name: "FileSet", union: "Artifact", fields: ["files"], variant: true}, {name: "SingleJs", union: "Artifact", fields: ["text"], variant: true}, {name: "HtmlPage", union: "Artifact", fields: ["text"], variant: true}]);
  $maps["src/compile/link"] = {"../compat": "src/compat", "../data/strx": "src/data/strx", "./js": "src/compile/js", "./emit": "src/compile/emit"};
  $mods["src/compile/link"] = ((exports, $require) => {
    const Compat = $require("../compat");
    const StrX = $require("../data/strx");
    const J = $require("./js");
    const E = $require("./emit");
    function NodeFiles(outDirRel) {
      return $makeVariant("NodeFiles", "Target", ["outDirRel"], [outDirRel]);
    }
    const NodeBundle = $makeVariant("NodeBundle", "Target", [], []);
    function BrowserBundle(page) {
      return $makeVariant("BrowserBundle", "Target", ["page"], [page]);
    }
    function BarePage(title) {
      return $makeVariant("BarePage", "PageMode", ["title"], [title]);
    }
    function ServeApp(apiPath) {
      return $makeVariant("ServeApp", "PageMode", ["apiPath"], [apiPath]);
    }
    function TeaPage(title) {
      return $makeVariant("TeaPage", "PageMode", ["title"], [title]);
    }
    const PlaygroundRunner = $makeVariant("PlaygroundRunner", "PageMode", [], []);
    function FileSet(files) {
      return $makeVariant("FileSet", "Artifact", ["files"], [files]);
    }
    function SingleJs(text) {
      return $makeVariant("SingleJs", "Artifact", ["text"], [text]);
    }
    function HtmlPage(text) {
      return $makeVariant("HtmlPage", "Artifact", ["text"], [text]);
    }
    function nodeFiles(outDirRel) {
      return $makeVariant("NodeFiles", "Target", ["outDirRel"], [outDirRel]);
    }
    function nodeBundle() {
      return NodeBundle;
    }
    function browserBundle(page) {
      return $makeVariant("BrowserBundle", "Target", ["page"], [page]);
    }
    function barePage(title) {
      return $makeVariant("BarePage", "PageMode", ["title"], [title]);
    }
    function serveApp(apiPath) {
      return $makeVariant("ServeApp", "PageMode", ["apiPath"], [apiPath]);
    }
    function teaPage(title) {
      return $makeVariant("TeaPage", "PageMode", ["title"], [title]);
    }
    function playgroundRunner() {
      return PlaygroundRunner;
    }
    function hostSrc(coreText, platformText) {
      return $makeRecord("HostSrc", ["coreText", "platformText"], [coreText, platformText]);
    }
    function outFile(relPath, text) {
      return $makeRecord("OutFile", ["relPath", "text"], [relPath, text]);
    }
    function fileSet(files) {
      return $makeVariant("FileSet", "Artifact", ["files"], [files]);
    }
    function singleJs(text) {
      return $makeVariant("SingleJs", "Artifact", ["text"], [text]);
    }
    function htmlPage(text) {
      return $makeVariant("HtmlPage", "Artifact", ["text"], [text]);
    }
    function appendStrings(a, b) {
      return $reduce((acc, x) => $cons(x, acc), b, $reverse(a));
    }
    function appendJsStmts(a, b) {
      return $reduce((acc, x) => $cons(x, acc), b, $reverse(a));
    }
    function appendOutFiles(a, b) {
      return $reduce((acc, x) => $cons(x, acc), b, $reverse(a));
    }
    function appendModules(a, b) {
      return $reduce((acc, x) => $cons(x, acc), b, $reverse(a));
    }
    function appendOneString(xs, x) {
      return $reverse($cons(x, $reverse(xs)));
    }
    function appendOneModule(xs, x) {
      return $reverse($cons(x, $reverse(xs)));
    }
    function startsWithText(s, prefix) {
      if ($gtI($length(prefix), $length(s))) {
        return false;
      } else {
        return $eq($slice(0, $length(prefix), s), prefix);
      }
    }
    function endsWithText(s, suffix) {
      if ($gtI($length(suffix), $length(s))) {
        return false;
      } else {
        return $eq($slice($subI($length(s), $length(suffix)), $length(suffix), s), suffix);
      }
    }
    function stripLeadingSlashes(s) {
      while (true) {
        if (startsWithText(s, "/")) {
          const $tc$209$0 = $slice(1, $subI($length(s), 1), s);
          s = $tc$209$0;
          continue;
        } else {
          return s;
        }
      }
    }
    function stripPfSuffix(s) {
      return endsWithText(s, ".pf") ? $slice(0, $subI($length(s), 3), s) : s;
    }
    function popPathSegment(stack) {
      return (($match$232) => {
        if ($match$232.$t === "None") {
          return [];
        }
        if ($match$232.$t === "Some") {
          const cell = $match$232;
          return cell.f[0].f[1];
        }
        throw $matchFail("src/compile/link.pf", 232);
      })($field(Compat, "uncons")(stack));
    }
    function normalizePathParts(parts, stack) {
      return (($match$243) => {
        if ($match$243.$t === "None") {
          return $reverse(stack);
        }
        if ($match$243.$t === "Some") {
          const cell = $match$243;
          return (() => {
            const part = cell.f[0].f[0];
            if (part === "" || part === ".") {
              return normalizePathParts(cell.f[0].f[1], stack);
            } else {
              if (part === "..") {
                return normalizePathParts(cell.f[0].f[1], popPathSegment(stack));
              } else {
                return normalizePathParts(cell.f[0].f[1], $cons(part, stack));
              }
            }
          })();
        }
        throw $matchFail("src/compile/link.pf", 243);
      })($field(Compat, "uncons")(parts));
    }
    function normalizePathText(path) {
      const slashPath = $join($split(path, "\\"), "/");
      const withoutHome = startsWithText(slashPath, "$PFUN_HOME/") ? $slice($length("$PFUN_HOME/"), $subI($length(slashPath), $length("$PFUN_HOME/")), slashPath) : slashPath;
      const withoutLeading = stripLeadingSlashes(withoutHome);
      return stripPfSuffix($join(normalizePathParts($split(withoutLeading, "/"), []), "/"));
    }
    function normalizeModuleId(moduleId) {
      const normalized = normalizePathText(moduleId);
      return $eqI($length(normalized), 0) ? "main" : normalized;
    }
    function normalizeOutDir(outDirRel) {
      return normalizePathText(outDirRel);
    }
    function splitLastString(xs) {
      return (($match$362) => {
        if ($match$362.$t === "None") {
          return $makeRecord("Pair", ["key", "value"], [[], $makeVariant("None", "Option", [], [])]);
        }
        if ($match$362.$t === "Some") {
          const cell = $match$362;
          return (() => {
            return $makeRecord("Pair", ["key", "value"], [$reverse(cell.f[0].f[1]), $makeVariant("Some", "Option", ["value"], [cell.f[0].f[0]])]);
          })();
        }
        throw $matchFail("src/compile/link.pf", 362);
      })($field(Compat, "uncons")($reverse(xs)));
    }
    function pathDir(path) {
      const splitPath = splitLastString($split(path, "/"));
      return $join(splitPath.f[0], "/");
    }
    function lastPathPart(path) {
      const splitPath = splitLastString($split(path, "/"));
      return (($match$407) => {
        if ($match$407.$t === "None") {
          return "";
        }
        if ($match$407.$t === "Some") {
          const part = $match$407;
          return part.f[0];
        }
        throw $matchFail("src/compile/link.pf", 407);
      })(splitPath.f[1]);
    }
    function joinPath(left, right) {
      if ($eqI($length(left), 0)) {
        return right;
      } else {
        if ($eqI($length(right), 0)) {
          return left;
        } else {
          return $concatS($concatS(left, "/"), right);
        }
      }
    }
    function resolveUserPath(importerId, rawPath) {
      if (startsWithText(rawPath, "<generated:")) {
        return rawPath;
      } else {
        if (startsWithText(rawPath, "$PFUN_HOME/") || startsWithText(rawPath, "/")) {
          return normalizeModuleId(rawPath);
        } else {
          if (startsWithText(rawPath, ".")) {
            return normalizeModuleId(joinPath(pathDir(importerId), rawPath));
          } else {
            return normalizeModuleId(rawPath);
          }
        }
      }
    }
    function containsString(xs, value) {
      return (($match$478) => {
        if ($match$478.$t === "None") {
          return false;
        }
        if ($match$478.$t === "Some") {
          const cell = $match$478;
          return (() => {
            if (cell.f[0].f[0] === value) {
              return true;
            } else {
              return containsString(cell.f[0].f[1], value);
            }
          })();
        }
        throw $matchFail("src/compile/link.pf", 478);
      })($field(Compat, "uncons")(xs));
    }
    function findExactId(ids, candidate) {
      return (($match$502) => {
        if ($match$502.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$502.$t === "Some") {
          const cell = $match$502;
          return (() => {
            if (cell.f[0].f[0] === candidate) {
              return $makeVariant("Some", "Option", ["value"], [cell.f[0].f[0]]);
            } else {
              return findExactId(cell.f[0].f[1], candidate);
            }
          })();
        }
        throw $matchFail("src/compile/link.pf", 502);
      })($field(Compat, "uncons")(ids));
    }
    function findIdByTail(ids, tailName) {
      return (($match$529) => {
        if ($match$529.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$529.$t === "Some") {
          const cell = $match$529;
          return (() => {
            if (lastPathPart(cell.f[0].f[0]) === tailName) {
              return $makeVariant("Some", "Option", ["value"], [cell.f[0].f[0]]);
            } else {
              return findIdByTail(cell.f[0].f[1], tailName);
            }
          })();
        }
        throw $matchFail("src/compile/link.pf", 529);
      })($field(Compat, "uncons")(ids));
    }
    function resolveBuiltinId(name, ids) {
      const normalized = normalizeModuleId(name);
      const configId = "";
      if ((name === "config" || name === configId) && containsString(ids, configId)) {
        return configId;
      } else {
        return (($match$579) => {
          if ($match$579.$t === "Some") {
            const exact = $match$579;
            return exact.f[0];
          }
          if ($match$579.$t === "None") {
            return (() => {
              return (($match$587) => {
                if ($match$587.$t === "Some") {
                  const publicModule = $match$587;
                  return publicModule.f[0];
                }
                if ($match$587.$t === "None") {
                  return (() => {
                    return (($match$597) => {
                      if ($match$597.$t === "Some") {
                        const publicStdlib = $match$597;
                        return publicStdlib.f[0];
                      }
                      if ($match$597.$t === "None") {
                        return (() => {
                          return (($match$607) => {
                            if ($match$607.$t === "Some") {
                              const stdlib = $match$607;
                              return stdlib.f[0];
                            }
                            if ($match$607.$t === "None") {
                              return (() => {
                                return (($match$617) => {
                                  if ($match$617.$t === "Some") {
                                    const builtin = $match$617;
                                    return builtin.f[0];
                                  }
                                  if ($match$617.$t === "None") {
                                    return (() => {
                                      return (($match$627) => {
                                        if ($match$627.$t === "Some") {
                                          const tail = $match$627;
                                          return tail.f[0];
                                        }
                                        if ($match$627.$t === "None") {
                                          return normalized;
                                        }
                                        throw $matchFail("src/compile/link.pf", 627);
                                      })(findIdByTail(ids, normalized));
                                    })();
                                  }
                                  throw $matchFail("src/compile/link.pf", 617);
                                })(findExactId(ids, $concatS("builtins/", normalized)));
                              })();
                            }
                            throw $matchFail("src/compile/link.pf", 607);
                          })(findExactId(ids, $concatS("stdlib/", normalized)));
                        })();
                      }
                      throw $matchFail("src/compile/link.pf", 597);
                    })(findExactId(ids, $concatS("src/stdlib/", normalized)));
                  })();
                }
                throw $matchFail("src/compile/link.pf", 587);
              })(findExactId(ids, $concatS("src/", normalized)));
            })();
          }
          throw $matchFail("src/compile/link.pf", 579);
        })(findExactId(ids, normalized));
      }
    }
    function moduleIds(mods) {
      return $map((mod) => normalizeModuleId(mod.f[0]), mods);
    }
    function resolveRequireForTest(importerId, req, ids) {
      return (($match$653) => {
        if ($match$653.$t === "HostReq") {
          return "";
        }
        if ($match$653.$t === "BuiltinReq") {
          const r = $match$653;
          return resolveBuiltinId(r.f[0], ids);
        }
        if ($match$653.$t === "UserReq") {
          const r = $match$653;
          return resolveUserPath(importerId, r.f[0]);
        }
        throw $matchFail("src/compile/link.pf", 653);
      })(req);
    }
    function rawRequireName(req) {
      return (($match$669) => {
        if ($match$669.$t === "HostReq") {
          return "";
        }
        if ($match$669.$t === "BuiltinReq") {
          const r = $match$669;
          return r.f[0];
        }
        if ($match$669.$t === "UserReq") {
          const r = $match$669;
          return r.f[0];
        }
        throw $matchFail("src/compile/link.pf", 669);
      })(req);
    }
    function entryModuleId(mods) {
      return (($match$678) => {
        if ($match$678.$t === "None") {
          return "main";
        }
        if ($match$678.$t === "Some") {
          const cell = $match$678;
          return normalizeModuleId($field(cell.f[0].f[0], "moduleId"));
        }
        throw $matchFail("src/compile/link.pf", 678);
      })($field(Compat, "uncons")($reverse(mods)));
    }
    function moduleFileName(moduleId) {
      return $concatS($field(J, "mangle")(normalizeModuleId(moduleId)), ".js");
    }
    function moduleFileNameForTest(moduleId) {
      return moduleFileName(moduleId);
    }
    function exportStatements(names) {
      return $map((name) => (() => {
        return $field(J, "jsAssign")($field(J, "jsIndex")($field(J, "jsId")("exports"), $field(J, "jsStr")(name)), $field(J, "jsId")(name));
      })(), names);
    }
    function moduleStatements(mod) {
      return appendJsStmts($field(mod, "body"), exportStatements($field(mod, "exportNames")));
    }
    function ownCall(object, key) {
      return $field(J, "jsCall")($field(J, "jsMember")($field(J, "jsMember")($field(J, "jsMember")($field(J, "jsId")("Object"), "prototype"), "hasOwnProperty"), "call"), [object, key]);
    }
    function bundleDependencyProps(reqs, importerId, ids) {
      return (($match$770) => {
        if ($match$770.$t === "None") {
          return [];
        }
        if ($match$770.$t === "Some") {
          const cell = $match$770;
          return (() => {
            const req = cell.f[0].f[0];
            const rest = bundleDependencyProps(cell.f[0].f[1], importerId, ids);
            return (($match$789) => {
              if ($match$789.$t === "HostReq") {
                return rest;
              }
              if (true) {
                return (() => {
                  return $cons($field(J, "jsProp")(rawRequireName(req), $field(J, "jsStr")(resolveRequireForTest(importerId, req, ids))), rest);
                })();
              }
              throw $matchFail("src/compile/link.pf", 789);
            })(req);
          })();
        }
        throw $matchFail("src/compile/link.pf", 770);
      })($field(Compat, "uncons")(reqs));
    }
    function nodeDependencyProps(reqs, importerId, ids) {
      return (($match$814) => {
        if ($match$814.$t === "None") {
          return [];
        }
        if ($match$814.$t === "Some") {
          const cell = $match$814;
          return (() => {
            const req = cell.f[0].f[0];
            const rest = nodeDependencyProps(cell.f[0].f[1], importerId, ids);
            return (($match$833) => {
              if ($match$833.$t === "HostReq") {
                return rest;
              }
              if ($match$833.$t === "BuiltinReq") {
                return (() => {
                  const target = resolveRequireForTest(importerId, req, ids);
                  if (containsString(ids, target)) {
                    return $cons($field(J, "jsProp")(rawRequireName(req), $field(J, "jsStr")($concatS("./", moduleFileName(target)))), rest);
                  } else {
                    return rest;
                  }
                })();
              }
              if ($match$833.$t === "UserReq") {
                return (() => {
                  const target = resolveRequireForTest(importerId, req, ids);
                  return $cons($field(J, "jsProp")(rawRequireName(req), $field(J, "jsStr")($concatS("./", moduleFileName(target)))), rest);
                })();
              }
              throw $matchFail("src/compile/link.pf", 833);
            })(req);
          })();
        }
        throw $matchFail("src/compile/link.pf", 814);
      })($field(Compat, "uncons")(reqs));
    }
    function optionalSchemaUnionExpr(unionName) {
      return (($match$896) => {
        if ($match$896.$t === "None") {
          return $field(J, "jsNull")();
        }
        if ($match$896.$t === "Some") {
          const found = $match$896;
          return $field(J, "jsStr")(found.f[0]);
        }
        throw $matchFail("src/compile/link.pf", 896);
      })(unionName);
    }
    function schemaDescriptorExpr(schema) {
      return $field(J, "jsObj")([$field(J, "jsProp")("name", $field(J, "jsStr")($field(schema, "runtimeName"))), $field(J, "jsProp")("union", optionalSchemaUnionExpr($field(schema, "unionName"))), $field(J, "jsProp")("fields", $field(J, "jsArr")($map((field) => $field(J, "jsStr")(field), $field(schema, "fields")))), $field(J, "jsProp")("variant", $field(J, "jsBool")($field(schema, "isVariant")))]);
    }
    function schemaRegistrationStatements(mod) {
      if ($eqI($length($field(mod, "schemas")), 0)) {
        return [];
      } else {
        return [$field(J, "jsExprStmt")($field(J, "jsCall")($field(J, "jsId")("$registerSchemas"), [$field(J, "jsArr")($map(schemaDescriptorExpr, $field(mod, "schemas")))]))];
      }
    }
    function suffixAfterMarker(moduleId, marker) {
      return (($match$987) => {
        if ($match$987.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$987.$t === "Some") {
          const found = $match$987;
          return (() => {
            const start = $addI(found.f[0], $length(marker));
            if ($geI(start, $length(moduleId))) {
              return $makeVariant("None", "Option", [], []);
            } else {
              return $makeVariant("Some", "Option", ["value"], [$slice(start, $subI($length(moduleId), start), moduleId)]);
            }
          })();
        }
        throw $matchFail("src/compile/link.pf", 987);
      })($findSlice(moduleId, marker));
    }
    function publicAliasFromId(moduleId) {
      const normalized = normalizeModuleId(moduleId);
      return (($match$1026) => {
        if ($match$1026.$t === "Some") {
          const rest = $match$1026;
          return $makeVariant("Some", "Option", ["value"], [$concatS("testing/", rest.f[0])]);
        }
        if ($match$1026.$t === "None") {
          return (() => {
            return (($match$1037) => {
              if ($match$1037.$t === "Some") {
                const rest = $match$1037;
                return $makeVariant("Some", "Option", ["value"], [$concatS("browser/", rest.f[0])]);
              }
              if ($match$1037.$t === "None") {
                return (() => {
                  return suffixAfterMarker(normalized, "src/stdlib/");
                })();
              }
              throw $matchFail("src/compile/link.pf", 1037);
            })(suffixAfterMarker(normalized, "src/browser/"));
          })();
        }
        throw $matchFail("src/compile/link.pf", 1026);
      })(suffixAfterMarker(normalized, "src/testing/"));
    }
    function availablePublicAlias(moduleId, ids) {
      return (($match$1056) => {
        if ($match$1056.$t === "None") {
          return $makeVariant("None", "Option", [], []);
        }
        if ($match$1056.$t === "Some") {
          const alias = $match$1056;
          return (() => {
            if (containsString(ids, alias.f[0])) {
              return $makeVariant("None", "Option", [], []);
            } else {
              return alias;
            }
          })();
        }
        throw $matchFail("src/compile/link.pf", 1056);
      })(publicAliasFromId(moduleId));
    }
    function publicAliasForTest(moduleId, ids) {
      return (($match$1074) => {
        if ($match$1074.$t === "None") {
          return "";
        }
        if ($match$1074.$t === "Some") {
          const alias = $match$1074;
          return alias.f[0];
        }
        throw $matchFail("src/compile/link.pf", 1074);
      })(availablePublicAlias(moduleId, ids));
    }
    function registrationForId(moduleId, depMap, factory) {
      return [$field(J, "jsAssign")($field(J, "jsIndex")($field(J, "jsId")("$maps"), $field(J, "jsStr")(moduleId)), depMap), $field(J, "jsAssign")($field(J, "jsIndex")($field(J, "jsId")("$mods"), $field(J, "jsStr")(moduleId)), factory)];
    }
    function moduleRegistrationStatements(mod, ids) {
      const moduleId = normalizeModuleId($field(mod, "moduleId"));
      const depMap = $field(J, "jsObj")(bundleDependencyProps($field(mod, "requires"), moduleId, ids));
      const factory = $field(J, "jsArrow")(["exports", "$require"], $field(J, "jsBlockBody")(moduleStatements(mod)), false);
      const base = registrationForId(moduleId, depMap, factory);
      const registrations = (($match$1153) => {
        if ($match$1153.$t === "None") {
          return base;
        }
        if ($match$1153.$t === "Some") {
          const alias = $match$1153;
          return (() => {
            return appendJsStmts(base, registrationForId(alias.f[0], depMap, factory));
          })();
        }
        throw $matchFail("src/compile/link.pf", 1153);
      })(availablePublicAlias(moduleId, ids));
      return appendJsStmts(schemaRegistrationStatements(mod), registrations);
    }
    function registrationStatements(mods, ids) {
      return (($match$1179) => {
        if ($match$1179.$t === "None") {
          return [];
        }
        if ($match$1179.$t === "Some") {
          const cell = $match$1179;
          return (() => {
            return appendJsStmts(moduleRegistrationStatements(cell.f[0].f[0], ids), registrationStatements(cell.f[0].f[1], ids));
          })();
        }
        throw $matchFail("src/compile/link.pf", 1179);
      })($field(Compat, "uncons")(mods));
    }
    function configModule(apiPath) {
      return $field(E, "emittedModule")("<generated:config>", [$field(J, "jsConst")("apiPath", $field(J, "jsStr")(apiPath))], ["apiPath"], [$field(E, "hostReq")()], []);
    }
    function modulesForPage(mods, page) {
      return (($match$1225) => {
        if ($match$1225.$t === "ServeApp") {
          const p = $match$1225;
          return (() => {
            if (containsString(moduleIds(mods), "<generated:config>")) {
              return mods;
            } else {
              return appendOneModule(mods, configModule(p.f[0]));
            }
          })();
        }
        if (true) {
          return mods;
        }
        throw $matchFail("src/compile/link.pf", 1225);
      })(page);
    }
    function ensureTrailingNewline(text) {
      if ($eqI($length(text), 0)) {
        return "";
      } else {
        if (endsWithText(text, "\n")) {
          return text;
        } else {
          return $concatS(text, "\n");
        }
      }
    }
    function indentLine(line, prefix) {
      return $eqI($length(line), 0) ? "" : $concatS(prefix, line);
    }
    function indentText(text, levels) {
      const prefix = $field(StrX, "strRepeat")(" ", $mulI(levels, 2));
      return $join($map((line) => indentLine(line, prefix), $split(text, "\n")), "\n");
    }
    function embeddedHostText(label, text, levels) {
      const prefix = $field(StrX, "strRepeat")(" ", $mulI(levels, 2));
      return $concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS(prefix, "/* "), label), " */\n"), prefix), "(function(module, exports, require) {\n"), indentText(ensureTrailingNewline(text), $addI(levels, 1))), prefix), "})(undefined, undefined, "), "typeof require === \"function\" ? require : undefined);\n");
    }
    function hostText(host, levels) {
      const prefix = $field(StrX, "strRepeat")(" ", $mulI(levels, 2));
      const abiNames = "$addI, $arrGet, $arrSet, $asc, $bitAndI, $bitNotI, $bitOrI, $bytesToChar, $ceil, $charBytes, $chr, $chrU, $cmpF, $compLazy, $compStrict, $concatS, $cons, $dictFromEntries, $dictGet, $dictSet, $divI, $eq, $eqF, $eqI, $extern, $field, $filter, $find, $findSlice, $floor, $geI, $gtI, $index, $indexSet, $isFinite, $jsonDeserialize, $jsonSerialize, $isNaN, $join, $lazyList, $leI, $length, $listExactLen, $listMinLen, $listRest, $ltI, $makeRecord, $makeVariant, $map, $matchFail, $memoize, $modI, $mulI, $negI, $newArray, $nonZero, $nth, $nthU, $range, $reduce, $registerSchemas, $reverse, $round, $safeDiv, $safeMod, $shlI, $shrI, $slice, $split, $starGet, $str, $strAt, $subI, $take, $toF";
      return $concatS($concatS($concatS($concatS($concatS($concatS($concatS(embeddedHostText("host core", host.f[0], levels), prefix), "/* PfunCore ABI bindings */\n"), prefix), "const { "), abiNames), " } = globalThis.PfunCore;\n"), embeddedHostText("host platform", host.f[1], levels));
    }
    function replaceAllText(text, needle, replacement) {
      return $eqI($length(needle), 0) ? text : $join($split(text, needle), replacement);
    }
    function escapeHtmlChar(c) {
      if (c === "&") {
        return "&amp;";
      } else {
        if (c === "<") {
          return "&lt;";
        } else {
          if (c === ">") {
            return "&gt;";
          } else {
            if (c === "\"") {
              return "&quot;";
            } else {
              if (c === "'") {
                return "&#39;";
              } else {
                return c;
              }
            }
          }
        }
      }
    }
    function escapeHtml(text) {
      return $join($map(escapeHtmlChar, $split(text, "")), "");
    }
    function escapeScript(text) {
      return replaceAllText(text, "</script", "<\\/script");
    }
    function pageTitle(page) {
      return (($match$1445) => {
        if ($match$1445.$t === "BarePage") {
          const p = $match$1445;
          return p.f[0];
        }
        if ($match$1445.$t === "ServeApp") {
          return "Pfun Application";
        }
        if ($match$1445.$t === "TeaPage") {
          const p = $match$1445;
          return p.f[0];
        }
        if ($match$1445.$t === "PlaygroundRunner") {
          return "Pfun Playground";
        }
        throw $matchFail("src/compile/link.pf", 1445);
      })(page);
    }
    function loaderText() {
      return $concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS("  const $mods = Object.create(null);\n", "  const $maps = Object.create(null);\n"), "  const $cache = Object.create(null);\n"), "  const $builtinModules = globalThis.PfunBuiltins || Object.create(null);\n"), "\n"), "  function $own(object, key) {\n"), "    return Object.prototype.hasOwnProperty.call(object, key);\n"), "  }\n"), "\n"), "  function $req(id) {\n"), "    if ($own($cache, id)) return $cache[id].exports;\n"), "    if (!$own($mods, id)) {\n"), "      if ($own($builtinModules, id)) return $builtinModules[id];\n"), "      throw new Error(\"Pfun module not found: \" + id);\n"), "    }\n"), "\n"), "    const module = { exports: {} };\n"), "    $cache[id] = module;\n"), "    const map = $maps[id] || Object.create(null);\n"), "    const $require = (raw) => {\n"), "      const target = $own(map, raw) ? map[raw] : raw;\n"), "      return $req(target);\n"), "    };\n"), "\n"), "    $mods[id](module.exports, $require);\n"), "    return module.exports;\n"), "  }\n"), "\n");
    }
    function nodeBootstrap(entryId) {
      return $field(J, "printJs")([$field(J, "jsExprStmt")($field(J, "jsCall")($field(J, "jsId")("$req"), [$field(J, "jsStr")(entryId)]))]);
    }
    function teaBootstrap(entryId) {
      const entry = $field(J, "jsId")("$entry");
      return [$field(J, "jsConst")("$entry", $field(J, "jsCall")($field(J, "jsId")("$req"), [$field(J, "jsStr")(entryId)])), $field(J, "jsIf")($field(J, "jsLogic")("||", $field(J, "jsUn")("!", entry), $field(J, "jsBin")("!==", $field(J, "jsUn")("typeof", $field(J, "jsMember")(entry, "main")), $field(J, "jsStr")("function"))), [$field(J, "jsThrow")($field(J, "jsNew")($field(J, "jsId")("Error"), [$field(J, "jsStr")("TEA entry module must export main.")]))], []), $field(J, "jsExprStmt")($field(J, "jsCall")($field(J, "jsMember")(entry, "main"), []))];
    }
    function playgroundBootstrap(entryId) {
      return [$field(J, "jsAssign")($field(J, "jsMember")($field(J, "jsId")("globalThis"), "$pfun"), $field(J, "jsObj")([$field(J, "jsProp")("require", $field(J, "jsId")("$req")), $field(J, "jsProp")("entry", $field(J, "jsStr")(entryId))]))];
    }
    function browserBootstrap(page, entryId) {
      return (($match$1649) => {
        if ($match$1649.$t === "TeaPage") {
          return $field(J, "printJs")(teaBootstrap(entryId));
        }
        if ($match$1649.$t === "PlaygroundRunner") {
          return (() => {
            return $field(J, "printJs")(playgroundBootstrap(entryId));
          })();
        }
        if (true) {
          return nodeBootstrap(entryId);
        }
        throw $matchFail("src/compile/link.pf", 1649);
      })(page);
    }
    function registryBundle(mods, host, bootstrap) {
      const ids = moduleIds(mods);
      const registrations = $field(J, "printJs")(registrationStatements(mods, ids));
      return $concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS("(function() {\n", "  \"use strict\";\n"), "\n"), hostText(host, 1)), "\n"), loaderText()), indentText(registrations, 1)), "\n"), indentText(bootstrap, 1)), "})();\n");
    }
    function nodeBundleText(mods, host) {
      return registryBundle(mods, host, nodeBootstrap(entryModuleId(mods)));
    }
    function browserBundleText(mods, page, host, entryId) {
      return registryBundle(mods, host, browserBootstrap(page, entryId));
    }
    function browserHtml(jsText, page) {
      return $concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS($concatS("<!doctype html>\n", "<html lang=\"en\">\n"), "<head>\n"), "  <meta charset=\"utf-8\">\n"), "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"), "  <title>"), escapeHtml(pageTitle(page))), "</title>\n"), "</head>\n"), "<body>\n"), "  <div id=\"app\"></div>\n"), "  <script>\n"), escapeScript(jsText)), "  </script>\n"), "</body>\n"), "</html>\n");
    }
    function emptyObjectExpr() {
      return $field(J, "jsCall")($field(J, "jsMember")($field(J, "jsId")("Object"), "create"), [$field(J, "jsNull")()]);
    }
    function nodeBuiltinModulesExpr() {
      return $field(J, "jsLogic")("||", $field(J, "jsMember")($field(J, "jsId")("globalThis"), "PfunBuiltins"), emptyObjectExpr());
    }
    function nodeRequireFunction() {
      const deps = $field(J, "jsId")("$deps");
      const builtins = $field(J, "jsId")("$builtinModules");
      const id = $field(J, "jsId")("id");
      return $field(J, "jsFun")("$require", ["id"], [$field(J, "jsIf")(ownCall(deps, id), [$field(J, "jsRet")($field(J, "jsCall")($field(J, "jsId")("require"), [$field(J, "jsIndex")(deps, id)]))], []), $field(J, "jsIf")(ownCall(builtins, id), [$field(J, "jsRet")($field(J, "jsIndex")(builtins, id))], []), $field(J, "jsRet")($field(J, "jsCall")($field(J, "jsId")("require"), [id]))], false);
    }
    function nodeModuleText(mod, ids, host) {
      const moduleId = normalizeModuleId($field(mod, "moduleId"));
      const setup = [$field(J, "jsConst")("$deps", $field(J, "jsObj")(nodeDependencyProps($field(mod, "requires"), moduleId, ids))), $field(J, "jsConst")("$builtinModules", nodeBuiltinModulesExpr()), nodeRequireFunction()];
      return $concatS($concatS($concatS($concatS("\"use strict\";\n", "\n"), hostText(host, 0)), "\n"), $field(J, "printJs")(appendJsStmts(setup, moduleStatements(mod))));
    }
    function moduleOutFiles(mods, ids, outDir, host) {
      return (($match$1935) => {
        if ($match$1935.$t === "None") {
          return [];
        }
        if ($match$1935.$t === "Some") {
          const cell = $match$1935;
          return (() => {
            const mod = cell.f[0].f[0];
            const file = $makeRecord("OutFile", ["relPath", "text"], [joinPath(outDir, $concatS("modules/", moduleFileName($field(mod, "moduleId")))), nodeModuleText(mod, ids, host)]);
            return $cons(file, moduleOutFiles(cell.f[0].f[1], ids, outDir, host));
          })();
        }
        throw $matchFail("src/compile/link.pf", 1935);
      })($field(Compat, "uncons")(mods));
    }
    function nodeMainText(mods) {
      const entry = entryModuleId(mods);
      if ($eqI($length(mods), 0)) {
        return "\"use strict\";\n";
      } else {
        return $field(J, "printJs")([$field(J, "jsExprStmt")($field(J, "jsCall")($field(J, "jsId")("require"), [$field(J, "jsStr")($concatS("./modules/", moduleFileName(entry)))]))]);
      }
    }
    function nodeFileSet(mods, outDirRel, host) {
      const outDir = normalizeOutDir(outDirRel);
      const ids = moduleIds(mods);
      const fixedFiles = [$makeRecord("OutFile", ["relPath", "text"], [joinPath(outDir, "package.json"), "{\n  \"type\": \"commonjs\"\n}\n"]), $makeRecord("OutFile", ["relPath", "text"], [joinPath(outDir, "main.js"), nodeMainText(mods)])];
      return $makeVariant("FileSet", "Artifact", ["files"], [appendOutFiles(fixedFiles, moduleOutFiles(mods, ids, outDir, host))]);
    }
    function link(mods, target, host) {
      return (($match$2049) => {
        if ($match$2049.$t === "NodeFiles") {
          const t = $match$2049;
          return nodeFileSet(mods, t.f[0], host);
        }
        if ($match$2049.$t === "NodeBundle") {
          return $makeVariant("SingleJs", "Artifact", ["text"], [nodeBundleText(mods, host)]);
        }
        if ($match$2049.$t === "BrowserBundle") {
          const t = $match$2049;
          return (() => {
            const entryId = entryModuleId(mods);
            const pageMods = modulesForPage(mods, t.f[0]);
            return $makeVariant("HtmlPage", "Artifact", ["text"], [browserHtml(browserBundleText(pageMods, t.f[0], host, entryId), t.f[0])]);
          })();
        }
        throw $matchFail("src/compile/link.pf", 2049);
      })(target);
    }
    function linkGroundingWitness() {
      const host = hostSrc("", "");
      const bundled = link([], nodeBundle(), host);
      const f = outFile("", "");
      return f.f[0];
    }
    exports["NodeFiles"] = NodeFiles;
    exports["NodeBundle"] = NodeBundle;
    exports["BrowserBundle"] = BrowserBundle;
    exports["BarePage"] = BarePage;
    exports["ServeApp"] = ServeApp;
    exports["TeaPage"] = TeaPage;
    exports["PlaygroundRunner"] = PlaygroundRunner;
    exports["FileSet"] = FileSet;
    exports["SingleJs"] = SingleJs;
    exports["HtmlPage"] = HtmlPage;
    exports["nodeFiles"] = nodeFiles;
    exports["nodeBundle"] = nodeBundle;
    exports["browserBundle"] = browserBundle;
    exports["barePage"] = barePage;
    exports["serveApp"] = serveApp;
    exports["teaPage"] = teaPage;
    exports["playgroundRunner"] = playgroundRunner;
    exports["hostSrc"] = hostSrc;
    exports["outFile"] = outFile;
    exports["fileSet"] = fileSet;
    exports["singleJs"] = singleJs;
    exports["htmlPage"] = htmlPage;
    exports["normalizeModuleId"] = normalizeModuleId;
    exports["resolveRequireForTest"] = resolveRequireForTest;
    exports["moduleFileNameForTest"] = moduleFileNameForTest;
    exports["publicAliasForTest"] = publicAliasForTest;
    exports["link"] = link;
  });
  $registerSchemas([{name: "PipelineCheckOk", union: "PipelineCheckResult", fields: ["checked"], variant: true}, {name: "PipelineCheckErr", union: "PipelineCheckResult", fields: ["diags"], variant: true}, {name: "PipelineCompileOk", union: "PipelineCompileResult", fields: ["checked", "emitted", "artifact"], variant: true}, {name: "PipelineCompileErr", union: "PipelineCompileResult", fields: ["diags"], variant: true}, {name: "PipelineSingletonState", union: null, fields: ["values", "blocked"], variant: false}]);
  $maps["src/compile/pipeline"] = {"../graph/modgraph": "src/graph/modgraph", "../check/check": "src/check/check", "../builtins/spec": "src/builtins/spec", "../data/imaps": "src/data/imaps", "../compat": "src/compat", "./emit": "src/compile/emit", "./link": "src/compile/link"};
  $mods["src/compile/pipeline"] = ((exports, $require) => {
    const MG = $require("../graph/modgraph");
    const Check = $require("../check/check");
    const Spec = $require("../builtins/spec");
    const IMS = $require("../data/imaps");
    const Compat = $require("../compat");
    const Emit = $require("./emit");
    const Link = $require("./link");
    function PipelineCheckOk(checked) {
      return $makeVariant("PipelineCheckOk", "PipelineCheckResult", ["checked"], [checked]);
    }
    function PipelineCheckErr(diags) {
      return $makeVariant("PipelineCheckErr", "PipelineCheckResult", ["diags"], [diags]);
    }
    function PipelineCompileOk(checked, emitted, artifact) {
      return $makeVariant("PipelineCompileOk", "PipelineCompileResult", ["checked", "emitted", "artifact"], [checked, emitted, artifact]);
    }
    function PipelineCompileErr(diags) {
      return $makeVariant("PipelineCompileErr", "PipelineCompileResult", ["diags"], [diags]);
    }
    function hasDiags(diags) {
      return $gtI($length(diags), 0);
    }
    function singletonState(values, blocked) {
      return $makeRecord("PipelineSingletonState", ["values", "blocked"], [values, blocked]);
    }
    function emptySingletonState() {
      return singletonState($field(IMS, "imsEmpty")(), $field(IMS, "imsEmpty")());
    }
    function browserSafeForTarget(target) {
      return (($match$35) => {
        if ($match$35.$t === "NodeFiles") {
          return false;
        }
        if ($match$35.$t === "NodeBundle") {
          return false;
        }
        if ($match$35.$t === "BrowserBundle") {
          return true;
        }
        throw $matchFail("src/compile/pipeline.pf", 35);
      })(target);
    }
    function putSingletonName(st, name, unionName) {
      if ($field(IMS, "imsHas")(st.f[1], name)) {
        return st;
      } else {
        return (($match$51) => {
          if ($match$51.$t === "None") {
            return singletonState($field(IMS, "imsPut")(st.f[0], name, unionName), st.f[1]);
          }
          if ($match$51.$t === "Some") {
            const existing = $match$51;
            return (() => {
              if (existing.f[0] === unionName) {
                return st;
              } else {
                return singletonState($field(IMS, "imsRemove")(st.f[0], name), $field(IMS, "imsPut")(st.f[1], name, true));
              }
            })();
          }
          throw $matchFail("src/compile/pipeline.pf", 51);
        })($field(IMS, "imsGet")(st.f[0], name));
      }
    }
    function singletonVariantsLoop(variants, unionName, st) {
      return (($match$96) => {
        if ($match$96.$t === "None") {
          return st;
        }
        if ($match$96.$t === "Some") {
          const cell = $match$96;
          return (() => {
            const variant = cell.f[0].f[0];
            const rest = cell.f[0].f[1];
            const next = $eqI($length($field(variant, "fields")), 0) ? putSingletonName(st, $field(variant, "vname"), unionName) : st;
            return singletonVariantsLoop(rest, unionName, next);
          })();
        }
        throw $matchFail("src/compile/pipeline.pf", 96);
      })($field(Compat, "uncons")(variants));
    }
    function singletonUnionEntriesLoop(entries, st) {
      return (($match$134) => {
        if ($match$134.$t === "None") {
          return st;
        }
        if ($match$134.$t === "Some") {
          const cell = $match$134;
          return (() => {
            const entry = cell.f[0].f[0];
            const next = singletonVariantsLoop($field(entry, "value"), $field(entry, "key"), st);
            return singletonUnionEntriesLoop(cell.f[0].f[1], next);
          })();
        }
        throw $matchFail("src/compile/pipeline.pf", 134);
      })($field(Compat, "uncons")(entries));
    }
    function singletonIfaceEntriesLoop(entries, st) {
      return (($match$162) => {
        if ($match$162.$t === "None") {
          return st;
        }
        if ($match$162.$t === "Some") {
          const cell = $match$162;
          return (() => {
            const iface = $field(cell.f[0].f[0], "value");
            const next = singletonUnionEntriesLoop($field(IMS, "imsEntries")($field(iface, "unions")), st);
            return singletonIfaceEntriesLoop(cell.f[0].f[1], next);
          })();
        }
        throw $matchFail("src/compile/pipeline.pf", 162);
      })($field(Compat, "uncons")(entries));
    }
    function singletonsFromIfaces(ifaces) {
      return (singletonIfaceEntriesLoop($field(IMS, "imsEntries")(ifaces), emptySingletonState())).f[0];
    }
    function fieldNames(fields) {
      return $map((field) => $field(field, "fname"), fields);
    }
    function putRecordSchemaEntries(entries, acc) {
      return (($match$212) => {
        if ($match$212.$t === "None") {
          return acc;
        }
        if ($match$212.$t === "Some") {
          const cell = $match$212;
          return (() => {
            const entry = cell.f[0].f[0];
            return putRecordSchemaEntries(cell.f[0].f[1], $field(IMS, "imsPut")(acc, $field(entry, "key"), fieldNames($field(entry, "value"))));
          })();
        }
        throw $matchFail("src/compile/pipeline.pf", 212);
      })($field(Compat, "uncons")(entries));
    }
    function putVariantSchemas(variants, acc) {
      return (($match$241) => {
        if ($match$241.$t === "None") {
          return acc;
        }
        if ($match$241.$t === "Some") {
          const cell = $match$241;
          return (() => {
            const variant = cell.f[0].f[0];
            return putVariantSchemas(cell.f[0].f[1], $field(IMS, "imsPut")(acc, $field(variant, "vname"), fieldNames($field(variant, "fields"))));
          })();
        }
        throw $matchFail("src/compile/pipeline.pf", 241);
      })($field(Compat, "uncons")(variants));
    }
    function putUnionSchemaEntries(entries, acc) {
      return (($match$270) => {
        if ($match$270.$t === "None") {
          return acc;
        }
        if ($match$270.$t === "Some") {
          const cell = $match$270;
          return (() => {
            const entry = cell.f[0].f[0];
            return putUnionSchemaEntries(cell.f[0].f[1], putVariantSchemas($field(entry, "value"), acc));
          })();
        }
        throw $matchFail("src/compile/pipeline.pf", 270);
      })($field(Compat, "uncons")(entries));
    }
    function putIfaceSchemas(iface, acc) {
      const records = putRecordSchemaEntries($field(IMS, "imsEntries")($field(iface, "records")), acc);
      return putUnionSchemaEntries($field(IMS, "imsEntries")($field(iface, "unions")), records);
    }
    function schemaIfaceEntriesLoop(entries, acc, seen) {
      return (($match$313) => {
        if ($match$313.$t === "None") {
          return acc;
        }
        if ($match$313.$t === "Some") {
          const cell = $match$313;
          return (() => {
            const iface = $field(cell.f[0].f[0], "value");
            if ($field(IMS, "imsHas")(seen, $field(iface, "path"))) {
              return schemaIfaceEntriesLoop(cell.f[0].f[1], acc, seen);
            } else {
              return schemaIfaceEntriesLoop(cell.f[0].f[1], putIfaceSchemas(iface, acc), $field(IMS, "imsPut")(seen, $field(iface, "path"), true));
            }
          })();
        }
        throw $matchFail("src/compile/pipeline.pf", 313);
      })($field(Compat, "uncons")(entries));
    }
    function schemaFieldsFromIfaces(ifaces) {
      return schemaIfaceEntriesLoop($field(IMS, "imsEntries")(ifaces), $field(IMS, "imsEmpty")(), $field(IMS, "imsEmpty")());
    }
    function checkWithBuiltins(raws, builtinIfaces) {
      return (($match$374) => {
        if ($match$374.$t === "TopoErr") {
          const bad = $match$374;
          return $makeVariant("PipelineCheckErr", "PipelineCheckResult", ["diags"], [bad.f[0]]);
        }
        if ($match$374.$t === "TopoOk") {
          const ordered = $match$374;
          return (() => {
            const checked = $field(Check, "checkGraph")(ordered.f[0], builtinIfaces);
            if (hasDiags(checked.f[2])) {
              return $makeVariant("PipelineCheckErr", "PipelineCheckResult", ["diags"], [checked.f[2]]);
            } else {
              return $makeVariant("PipelineCheckOk", "PipelineCheckResult", ["checked"], [checked]);
            }
          })();
        }
        throw $matchFail("src/compile/pipeline.pf", 374);
      })($field(MG, "toposort")(raws));
    }
    function checkProgram(raws) {
      return checkWithBuiltins(raws, $field(Spec, "allBuiltinIfaces")());
    }
    function emitCheckedLoop(modules, singletons, schemaFields, browserSafe, acc) {
      return (($match$414) => {
        if ($match$414.$t === "None") {
          return $reverse(acc);
        }
        if ($match$414.$t === "Some") {
          const cell = $match$414;
          return (() => {
            const checked = cell.f[0].f[0];
            const emitted = $field(Emit, "emitModule")(checked, $field(Emit, "withIntrinsics")($field(Emit, "emitOptsWithSchemas")($field(checked, "path"), singletons, browserSafe, schemaFields), $field(Spec, "ambientIntrinsics")()));
            return emitCheckedLoop(cell.f[0].f[1], singletons, schemaFields, browserSafe, $cons(emitted, acc));
          })();
        }
        throw $matchFail("src/compile/pipeline.pf", 414);
      })($field(Compat, "uncons")(modules));
    }
    function emitChecked(checked, target) {
      const singletons = singletonsFromIfaces(checked.f[1]);
      const schemaFields = schemaFieldsFromIfaces(checked.f[1]);
      return emitCheckedLoop(checked.f[0], singletons, schemaFields, browserSafeForTarget(target), []);
    }
    function compileWithBuiltins(raws, builtinIfaces, target, host) {
      return (($match$484) => {
        if ($match$484.$t === "PipelineCheckErr") {
          const bad = $match$484;
          return $makeVariant("PipelineCompileErr", "PipelineCompileResult", ["diags"], [bad.f[0]]);
        }
        if ($match$484.$t === "PipelineCheckOk") {
          const good = $match$484;
          return (() => {
            const emitted = emitChecked(good.f[0], target);
            const artifact = $field(Link, "link")(emitted, target, host);
            return $makeVariant("PipelineCompileOk", "PipelineCompileResult", ["checked", "emitted", "artifact"], [good.f[0], emitted, artifact]);
          })();
        }
        throw $matchFail("src/compile/pipeline.pf", 484);
      })(checkWithBuiltins(raws, builtinIfaces));
    }
    function compileProgram(raws, target, host) {
      return compileWithBuiltins(raws, $field(Spec, "allBuiltinIfaces")(), target, host);
    }
    exports["PipelineCheckOk"] = PipelineCheckOk;
    exports["PipelineCheckErr"] = PipelineCheckErr;
    exports["PipelineCompileOk"] = PipelineCompileOk;
    exports["PipelineCompileErr"] = PipelineCompileErr;
    exports["browserSafeForTarget"] = browserSafeForTarget;
    exports["singletonsFromIfaces"] = singletonsFromIfaces;
    exports["schemaFieldsFromIfaces"] = schemaFieldsFromIfaces;
    exports["checkWithBuiltins"] = checkWithBuiltins;
    exports["checkProgram"] = checkProgram;
    exports["emitChecked"] = emitChecked;
    exports["compileWithBuiltins"] = compileWithBuiltins;
    exports["compileProgram"] = compileProgram;
  });
  $registerSchemas([{name: "HostReadOk", union: "HostReadResult", fields: ["host"], variant: true}, {name: "HostReadErr", union: "HostReadResult", fields: ["message"], variant: true}, {name: "ArtifactWriteOk", union: "ArtifactWriteResult", fields: [], variant: true}, {name: "ArtifactWriteErr", union: "ArtifactWriteResult", fields: ["message"], variant: true}, {name: "CliCheckOk", union: "CliCheckResult", fields: ["entry"], variant: true}, {name: "CliCheckErr", union: "CliCheckResult", fields: ["message"], variant: true}, {name: "CliRunOk", union: "CliRunResult", fields: ["code"], variant: true}, {name: "CliRunErr", union: "CliRunResult", fields: ["message"], variant: true}, {name: "CliBuildOk", union: "CliBuildResult", fields: ["output"], variant: true}, {name: "CliBuildErr", union: "CliBuildResult", fields: ["message"], variant: true}]);
  $maps["src/drivers/cli"] = {"./cliargs": "src/drivers/cliargs", "../compat": "src/compat", "./iofloor": "src/drivers/iofloor", "./load": "src/drivers/load", "../compile/pipeline": "src/compile/pipeline", "../compile/link": "src/compile/link", "../graph/modgraph": "src/graph/modgraph", "../builtins/spec": "src/builtins/spec", "../check/diag": "src/check/diag", "../data/resultx": "src/data/resultx"};
  $mods["src/drivers/cli"] = ((exports, $require) => {
    const CliArgs = $require("./cliargs");
    const Compat = $require("../compat");
    const IO = $require("./iofloor");
    const Load = $require("./load");
    const Pipeline = $require("../compile/pipeline");
    const Link = $require("../compile/link");
    const MG = $require("../graph/modgraph");
    const Spec = $require("../builtins/spec");
    const Diag = $require("../check/diag");
    const $star$10 = $require("../data/resultx");
    function HostReadOk(host) {
      return $makeVariant("HostReadOk", "HostReadResult", ["host"], [host]);
    }
    function HostReadErr(message) {
      return $makeVariant("HostReadErr", "HostReadResult", ["message"], [message]);
    }
    const ArtifactWriteOk = $makeVariant("ArtifactWriteOk", "ArtifactWriteResult", [], []);
    function ArtifactWriteErr(message) {
      return $makeVariant("ArtifactWriteErr", "ArtifactWriteResult", ["message"], [message]);
    }
    function CliCheckOk(entry) {
      return $makeVariant("CliCheckOk", "CliCheckResult", ["entry"], [entry]);
    }
    function CliCheckErr(message) {
      return $makeVariant("CliCheckErr", "CliCheckResult", ["message"], [message]);
    }
    function CliRunOk(code) {
      return $makeVariant("CliRunOk", "CliRunResult", ["code"], [code]);
    }
    function CliRunErr(message) {
      return $makeVariant("CliRunErr", "CliRunResult", ["message"], [message]);
    }
    function CliBuildOk(output) {
      return $makeVariant("CliBuildOk", "CliBuildResult", ["output"], [output]);
    }
    function CliBuildErr(message) {
      return $makeVariant("CliBuildErr", "CliBuildResult", ["message"], [message]);
    }
    function searchEnv(home) {
      return $field(MG, "mkSearchEnv")($field(CliArgs, "joinPath")(home, "src/stdlib"), home, $field(Spec, "builtinNames")());
    }
    function noSource(_path) {
      return $makeVariant("None", "Option", [], []);
    }
    function renderDiags(diags) {
      const rendered = $field(Diag, "renderAll")(diags, noSource);
      if ($eqI($length(rendered), 0)) {
        return "Compilation failed.";
      } else {
        return rendered;
      }
    }
    function hostCorePath(home) {
      return $field(CliArgs, "joinPath")(home, "host/core.js");
    }
    function hostNodePath(home) {
      return $field(CliArgs, "joinPath")(home, "host/node.js");
    }
    function hostBrowserPath(home) {
      return $field(CliArgs, "joinPath")(home, "host/browser.js");
    }
    function readHostSources(home) {
      return (($match$74) => {
        if ($match$74.$t === "BErr") {
          const coreErr = $match$74;
          return $makeVariant("HostReadErr", "HostReadResult", ["message"], [$concatS("Could not read Node host core: ", coreErr.f[0])]);
        }
        if ($match$74.$t === "BOk") {
          const core = $match$74;
          return (() => {
            return (($match$87) => {
              if ($match$87.$t === "BErr") {
                const nodeErr = $match$87;
                return $makeVariant("HostReadErr", "HostReadResult", ["message"], [$concatS("Could not read Node platform host: ", nodeErr.f[0])]);
              }
              if ($match$87.$t === "BOk") {
                const node = $match$87;
                return $makeVariant("HostReadOk", "HostReadResult", ["host"], [$field(Link, "hostSrc")(core.f[0], node.f[0])]);
              }
              throw $matchFail("src/drivers/cli.pf", 87);
            })($field(IO, "readTextFile")(hostNodePath(home)));
          })();
        }
        throw $matchFail("src/drivers/cli.pf", 74);
      })($field(IO, "readTextFile")(hostCorePath(home)));
    }
    function readBrowserHostSources(home) {
      return (($match$110) => {
        if ($match$110.$t === "BErr") {
          const coreErr = $match$110;
          return (() => {
            return $makeVariant("HostReadErr", "HostReadResult", ["message"], [$concatS("Could not read browser host core: ", coreErr.f[0])]);
          })();
        }
        if ($match$110.$t === "BOk") {
          const core = $match$110;
          return (() => {
            return (($match$125) => {
              if ($match$125.$t === "BErr") {
                const browserErr = $match$125;
                return (() => {
                  return $makeVariant("HostReadErr", "HostReadResult", ["message"], [$concatS("Could not read browser platform host: ", browserErr.f[0])]);
                })();
              }
              if ($match$125.$t === "BOk") {
                const browser = $match$125;
                return (() => {
                  return $makeVariant("HostReadOk", "HostReadResult", ["host"], [$field(Link, "hostSrc")(core.f[0], browser.f[0])]);
                })();
              }
              throw $matchFail("src/drivers/cli.pf", 125);
            })($field(IO, "readTextFile")(hostBrowserPath(home)));
          })();
        }
        throw $matchFail("src/drivers/cli.pf", 110);
      })($field(IO, "readTextFile")(hostCorePath(home)));
    }
    function writeSingleJs(output, text) {
      const dir = $field(CliArgs, "outputDir")(output);
      return (($match$157) => {
        if ($match$157.$t === "BErr") {
          const mkdirErr = $match$157;
          return (() => {
            return $makeVariant("ArtifactWriteErr", "ArtifactWriteResult", ["message"], [$concatS($concatS($concatS("Could not create output directory '", dir), "': "), mkdirErr.f[0])]);
          })();
        }
        if ($match$157.$t === "BOk") {
          return (() => {
            return (($match$174) => {
              if ($match$174.$t === "BErr") {
                const writeErr = $match$174;
                return (() => {
                  return $makeVariant("ArtifactWriteErr", "ArtifactWriteResult", ["message"], [$concatS($concatS($concatS("Could not write output file '", output), "': "), writeErr.f[0])]);
                })();
              }
              if ($match$174.$t === "BOk") {
                return ArtifactWriteOk;
              }
              throw $matchFail("src/drivers/cli.pf", 174);
            })($field(IO, "writeTextFile")(output, text));
          })();
        }
        throw $matchFail("src/drivers/cli.pf", 157);
      })($field(IO, "ensureDir")(dir));
    }
    function writeOutFile(file) {
      const dir = $field(CliArgs, "outputDir")($field(file, "relPath"));
      return (($match$201) => {
        if ($match$201.$t === "BErr") {
          const mkdirErr = $match$201;
          return (() => {
            return $makeVariant("ArtifactWriteErr", "ArtifactWriteResult", ["message"], [$concatS($concatS($concatS("Could not create output directory '", dir), "': "), mkdirErr.f[0])]);
          })();
        }
        if ($match$201.$t === "BOk") {
          return (() => {
            return (($match$218) => {
              if ($match$218.$t === "BErr") {
                const writeErr = $match$218;
                return (() => {
                  return $makeVariant("ArtifactWriteErr", "ArtifactWriteResult", ["message"], [$concatS($concatS($concatS("Could not write output file '", $field(file, "relPath")), "': "), writeErr.f[0])]);
                })();
              }
              if ($match$218.$t === "BOk") {
                return ArtifactWriteOk;
              }
              throw $matchFail("src/drivers/cli.pf", 218);
            })($field(IO, "writeTextFile")($field(file, "relPath"), $field(file, "text")));
          })();
        }
        throw $matchFail("src/drivers/cli.pf", 201);
      })($field(IO, "ensureDir")(dir));
    }
    function writeOutFiles(files) {
      return (($match$242) => {
        if ($match$242.$t === "None") {
          return ArtifactWriteOk;
        }
        if ($match$242.$t === "Some") {
          const cell = $match$242;
          return (() => {
            return (($match$249) => {
              if ($match$249.$t === "ArtifactWriteErr") {
                const failed = $match$249;
                return (() => {
                  return $makeVariant("ArtifactWriteErr", "ArtifactWriteResult", ["message"], [failed.f[0]]);
                })();
              }
              if ($match$249.$t === "ArtifactWriteOk") {
                return (() => {
                  return writeOutFiles(cell.f[0].f[1]);
                })();
              }
              throw $matchFail("src/drivers/cli.pf", 249);
            })(writeOutFile(cell.f[0].f[0]));
          })();
        }
        throw $matchFail("src/drivers/cli.pf", 242);
      })($field(Compat, "uncons")(files));
    }
    function writeArtifact(artifact, output) {
      return (($match$270) => {
        if ($match$270.$t === "SingleJs") {
          const js = $match$270;
          return (() => {
            return writeSingleJs(output, js.f[0]);
          })();
        }
        if ($match$270.$t === "FileSet") {
          const files = $match$270;
          return (() => {
            return writeOutFiles(files.f[0]);
          })();
        }
        if ($match$270.$t === "HtmlPage") {
          const html = $match$270;
          return (() => {
            return writeSingleJs(output, html.f[0]);
          })();
        }
        throw $matchFail("src/drivers/cli.pf", 270);
      })(artifact);
    }
    function check(entry, home) {
      const env = searchEnv(home);
      return (($match$298) => {
        if ($match$298.$t === "LoadErr") {
          const failed = $match$298;
          return (() => {
            return $makeVariant("CliCheckErr", "CliCheckResult", ["message"], [renderDiags(failed.f[0])]);
          })();
        }
        if ($match$298.$t === "LoadOk") {
          const loaded = $match$298;
          return (() => {
            return (($match$312) => {
              if ($match$312.$t === "PipelineCheckErr") {
                const failed = $match$312;
                return (() => {
                  return $makeVariant("CliCheckErr", "CliCheckResult", ["message"], [renderDiags(failed.f[0])]);
                })();
              }
              if ($match$312.$t === "PipelineCheckOk") {
                return (() => {
                  return $makeVariant("CliCheckOk", "CliCheckResult", ["entry"], [entry]);
                })();
              }
              throw $matchFail("src/drivers/cli.pf", 312);
            })($field(Pipeline, "checkProgram")(loaded.f[0]));
          })();
        }
        throw $matchFail("src/drivers/cli.pf", 298);
      })($field(Load, "loadGraph")(entry, env));
    }
    function buildTarget(targetName, output, page) {
      if (targetName === "node") {
        return $field(Link, "nodeFiles")(output);
      } else {
        if (targetName === "browser") {
          return $field(Link, "browserBundle")($field(Link, "barePage")(page));
        } else {
          return $field(Link, "nodeBundle")();
        }
      }
    }
    function readBuildHostSources(targetName, home) {
      if (targetName === "browser") {
        return readBrowserHostSources(home);
      } else {
        return readHostSources(home);
      }
    }
    function compileLoaded(raws, targetName, output, page, home) {
      const target = buildTarget(targetName, output, page);
      return (($match$378) => {
        if ($match$378.$t === "HostReadErr") {
          const hostErr = $match$378;
          return (() => {
            return $makeVariant("CliBuildErr", "CliBuildResult", ["message"], [hostErr.f[0]]);
          })();
        }
        if ($match$378.$t === "HostReadOk") {
          const hostOk = $match$378;
          return (() => {
            return (($match$389) => {
              if ($match$389.$t === "PipelineCompileErr") {
                const failed = $match$389;
                return (() => {
                  return $makeVariant("CliBuildErr", "CliBuildResult", ["message"], [renderDiags(failed.f[0])]);
                })();
              }
              if ($match$389.$t === "PipelineCompileOk") {
                const compiled = $match$389;
                return (() => {
                  return (($match$405) => {
                    if ($match$405.$t === "ArtifactWriteErr") {
                      const writeErr = $match$405;
                      return (() => {
                        return $makeVariant("CliBuildErr", "CliBuildResult", ["message"], [writeErr.f[0]]);
                      })();
                    }
                    if ($match$405.$t === "ArtifactWriteOk") {
                      return (() => {
                        return $makeVariant("CliBuildOk", "CliBuildResult", ["output"], [output]);
                      })();
                    }
                    throw $matchFail("src/drivers/cli.pf", 405);
                  })(writeArtifact(compiled.f[2], output));
                })();
              }
              throw $matchFail("src/drivers/cli.pf", 389);
            })($field(Pipeline, "compileProgram")(raws, target, hostOk.f[0]));
          })();
        }
        throw $matchFail("src/drivers/cli.pf", 378);
      })(readBuildHostSources(targetName, home));
    }
    function build(entry, targetName, output, page, home) {
      const env = searchEnv(home);
      return (($match$428) => {
        if ($match$428.$t === "LoadErr") {
          const failed = $match$428;
          return (() => {
            return $makeVariant("CliBuildErr", "CliBuildResult", ["message"], [renderDiags(failed.f[0])]);
          })();
        }
        if ($match$428.$t === "LoadOk") {
          const loaded = $match$428;
          return (() => {
            return compileLoaded(loaded.f[0], targetName, output, page, home);
          })();
        }
        throw $matchFail("src/drivers/cli.pf", 428);
      })($field(Load, "loadGraph")(entry, env));
    }
    function runLoaded(raws, args, home) {
      return (($match$454) => {
        if ($match$454.$t === "HostReadErr") {
          const hostErr = $match$454;
          return (() => {
            return $makeVariant("CliRunErr", "CliRunResult", ["message"], [hostErr.f[0]]);
          })();
        }
        if ($match$454.$t === "HostReadOk") {
          const hostOk = $match$454;
          return (() => {
            return (($match$464) => {
              if ($match$464.$t === "PipelineCompileErr") {
                const failed = $match$464;
                return (() => {
                  return $makeVariant("CliRunErr", "CliRunResult", ["message"], [renderDiags(failed.f[0])]);
                })();
              }
              if ($match$464.$t === "PipelineCompileOk") {
                const compiled = $match$464;
                return (() => {
                  return (($match$482) => {
                    if ($match$482.$t === "SingleJs") {
                      const js = $match$482;
                      return (() => {
                        return (($match$486) => {
                          if ($match$486.$t === "BErr") {
                            const failure = $match$486;
                            return (() => {
                              return $makeVariant("CliRunErr", "CliRunResult", ["message"], [failure.f[0]]);
                            })();
                          }
                          if ($match$486.$t === "BOk") {
                            const completed = $match$486;
                            return (() => {
                              return $makeVariant("CliRunOk", "CliRunResult", ["code"], [completed.f[0]]);
                            })();
                          }
                          throw $matchFail("src/drivers/cli.pf", 486);
                        })($field(IO, "executeNodeBundle")(js.f[0], args));
                      })();
                    }
                    if ($match$482.$t === "FileSet") {
                      return (() => {
                        return $makeVariant("CliRunErr", "CliRunResult", ["message"], [$concatS($concatS("Internal compiler error: run expected a ", "single JavaScript artifact, but the linker "), "returned a file set.")]);
                      })();
                    }
                    if ($match$482.$t === "HtmlPage") {
                      return (() => {
                        return $makeVariant("CliRunErr", "CliRunResult", ["message"], [$concatS($concatS("Internal compiler error: run expected a ", "single JavaScript artifact, but the linker "), "returned an HTML page.")]);
                      })();
                    }
                    throw $matchFail("src/drivers/cli.pf", 482);
                  })(compiled.f[2]);
                })();
              }
              throw $matchFail("src/drivers/cli.pf", 464);
            })($field(Pipeline, "compileProgram")(raws, $field(Link, "nodeBundle")(), hostOk.f[0]));
          })();
        }
        throw $matchFail("src/drivers/cli.pf", 454);
      })(readHostSources(home));
    }
    function run(entry, args, home) {
      const env = searchEnv(home);
      return (($match$528) => {
        if ($match$528.$t === "LoadErr") {
          const failed = $match$528;
          return (() => {
            return $makeVariant("CliRunErr", "CliRunResult", ["message"], [renderDiags(failed.f[0])]);
          })();
        }
        if ($match$528.$t === "LoadOk") {
          const loaded = $match$528;
          return (() => {
            return runLoaded(loaded.f[0], args, home);
          })();
        }
        throw $matchFail("src/drivers/cli.pf", 528);
      })($field(Load, "loadGraph")(entry, env));
    }
    function runPlan(plan, home) {
      return (($match$552) => {
        if ($match$552.$t === "CliUsage") {
          const usage = $match$552;
          return $field(IO, "fail")(usage.f[0], 2);
        }
        if ($match$552.$t === "CliCheck") {
          const command = $match$552;
          return (() => {
            return (($match$561) => {
              if ($match$561.$t === "CliCheckErr") {
                const failed = $match$561;
                return (() => {
                  return $field(IO, "fail")(failed.f[0], 1);
                })();
              }
              if ($match$561.$t === "CliCheckOk") {
                const checked = $match$561;
                return (() => {
                  $field(IO, "printLines")([$concatS("Checked ", checked.f[0])]);
                  return $field(IO, "exitOk")();
                })();
              }
              throw $matchFail("src/drivers/cli.pf", 561);
            })(check(command.f[0], home));
          })();
        }
        if ($match$552.$t === "CliRun") {
          const command = $match$552;
          return (() => {
            return (($match$591) => {
              if ($match$591.$t === "CliRunErr") {
                const failed = $match$591;
                return (() => {
                  return $field(IO, "fail")(failed.f[0], 1);
                })();
              }
              if ($match$591.$t === "CliRunOk") {
                const completed = $match$591;
                return (() => {
                  return $field(IO, "exitWith")(completed.f[0]);
                })();
              }
              throw $matchFail("src/drivers/cli.pf", 591);
            })(run(command.f[0], command.f[1], home));
          })();
        }
        if ($match$552.$t === "CliBuild") {
          const command = $match$552;
          return (() => {
            return (($match$616) => {
              if ($match$616.$t === "CliBuildErr") {
                const failed = $match$616;
                return (() => {
                  return $field(IO, "fail")(failed.f[0], 1);
                })();
              }
              if ($match$616.$t === "CliBuildOk") {
                const built = $match$616;
                return (() => {
                  $field(IO, "printLines")([$concatS("Built ", built.f[0])]);
                  return $field(IO, "exitOk")();
                })();
              }
              throw $matchFail("src/drivers/cli.pf", 616);
            })(build(command.f[0], command.f[1], command.f[2], command.f[3], home));
          })();
        }
        throw $matchFail("src/drivers/cli.pf", 552);
      })(plan);
    }
    function main() {
      const rawArgs = $field(IO, "args")();
      const homeValue = $field(IO, "env")("PFUN_HOME");
      const home = $field(CliArgs, "homeFromEnv")(homeValue);
      const plan = $field(CliArgs, "parseArgs")(rawArgs);
      return runPlan(plan, home);
    }
    main();
    exports["CliCheckOk"] = CliCheckOk;
    exports["CliCheckErr"] = CliCheckErr;
    exports["CliRunOk"] = CliRunOk;
    exports["CliRunErr"] = CliRunErr;
    exports["CliBuildOk"] = CliBuildOk;
    exports["CliBuildErr"] = CliBuildErr;
    exports["check"] = check;
    exports["build"] = build;
    exports["run"] = run;
  });

  $req("src/drivers/cli");
})();
