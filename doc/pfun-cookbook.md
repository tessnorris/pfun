# The Pfun Programming Cookbook

*A problem-and-solution reference for the Pfun language*

---

## Introduction

Pfun is a small, expression-oriented language that **transpiles to JavaScript** — to the
browser DOM on the client and to Node.js on the server. It blends two worlds on purpose:

* A **pure functional core**, written with `function`, lambdas (`fn`), immutable `let`
  bindings, algebraic data types, and pattern matching. This is where the *logic* of a
  program is expected to live. Pure functions take values and return values; they never read
  the clock, touch the disk, mutate global state, or talk to the network.

* A thin **procedural wrapper**, written with `proc` and `async proc`, that owns *state and
  side effects*. Procedures may hold `var` state, mutate arrays and dictionaries, read input,
  write files, perform HTTP requests, and call the database.

The central design rule of idiomatic Pfun is:

> **Decide in the core, act in the wrapper.**
> Pure functions compute a *description* of what should happen (a value), and a procedure
> *interprets* that description and performs the actual effects.

The clearest example in the corpus is the TEA (The Elm Architecture) runtime in `tea.pf`. The
application's `view` and `update` are **pure functions**: `update` takes a message and the
current model and returns a new model plus a `Cmd` — a *value* that merely **describes** a side
effect such as "POST this message to this URL." A single `proc` (`executeCmd`) interprets the
`Cmd` and performs the real network call and DOM mutation:

```pfun
// from tea.pf — the declarative effect type (a value, not an action)
export type Cmd = {
  | CmdNone
  | Send    : msg, onReply, url
}

// the interpreter: the ONLY place the effect actually happens
async proc executeCmd(cmd, model, viewFn, updateFn) {
  match cmd with
  | CmdNone  -> {}
  | Send s   -> {
      let result = await httpPost(s.url, s.msg);   // the real effect
      match result with
      | Ok response -> { /* feed reply back into pure update */ }
      | Err e -> println("Server error: " + e.message);
    };
}
```

This separation — pure data describing effects, procedural code performing them — recurs
throughout this book. When you reach a problem that needs the outside world, the recommended
shape is almost always *"a pure function builds a plan; a `proc` runs it."*

### Why this matters

Because the functional core is referentially transparent, it is trivially testable, cacheable
(`memo`), and safe to reuse. Because effects are funneled through a small number of procedures,
the surface area where things can go wrong (I/O failure, missing files, network errors) is
small and explicit. Pfun reinforces this by representing failures as **values** — the `Response`
and `Option` types — rather than throwing exceptions.

---

## How to read this book

Each recipe has four parts: a **problem** statement, a **solution** in Pfun, and an
**explanation** of how and why it works, and where relevant a note about which parts are pure
and which are effectful.

* Code that is part of a **reusable library** in the corpus (for example `mathutils.pf`,
  `htmllib.pf`, `viewlib.pf`, `tea.pf`, `dbschema.pf`) is called as a dependency where useful.
* Code from **programs and applications** (for example `example.pf`, `golden.pf`,
  `tiny-lisp.pf`, the client/server demos, the database demos) is used as illustration.
* When a recipe needs a capability that the corpus never demonstrates, it calls a **foreign
  wrapper** whose signature is defined in **Appendix A**. These wrappers bridge to a JavaScript
  or Node library through Pfun's foreign-function interface and return a `Response`.
* Where the corpus is **silent or ambiguous** about a language feature, the text says so
  plainly and points to **Appendix B**.

---

## A short tour of the language

### Bindings and mutation

```pfun
let lazy_constant = 100;   // immutable binding (cannot be reassigned)
var mutable_counter = 0;   // mutable variable
mutable_counter = 10;      // reassignment is allowed only for `var`
```

`let` introduces an immutable name; `var` introduces a mutable one. Module-level and
procedure-local `var`s may be reassigned with `=`. Idiomatic Pfun keeps `var` inside `proc`s and
prefers `let` everywhere else.

### Primitive data

| Kind | Examples | Notes |
|------|----------|-------|
| Int | `10`, `-7`, `1000000000000` | Arbitrary precision; `square(1000000000000)` works in `golden.pf`. |
| Float | `2.0`, `12.5`, `0.0` | `2.0 + 3` mixes float and int. |
| Byte | `0b`, `128b`, `0xFFb`, `0xF0b` | Suffix `b`; supports `& | << >>`. |
| Char | `'A'`, `'\n'`, `'\t'`, `'€'` | Single quotes; `asc`/`chr` convert to/from code points. |
| String | `"hello"`, `"He said \"hi\""` | Double quotes with escapes. |
| Raw string | `@"C:\Users\Alice"`, `@"\d+\.\d+"` | No escape processing — ideal for paths and regex. |
| Interpolated | `$"Name: {name}, Age: {age}\n"` | `{expr}` splices; `\{` and `\}` are literal braces. |
| Bool | `true`, `false` | |

`+` is overloaded: it adds numbers, concatenates strings (coercing numbers, though `__str__` is
often used for clarity), and concatenates lists.

### Functions, procedures, and lambdas

```pfun
function add(x, y) { return x + y; }          // pure; explicit return
function noCmd(model) { UpdateResult { model, cmdNone() }; }  // pure; implicit last-expression return
let multiply = fn x, y => x * y;              // lambda
let blockFn  = fn (y) => { let z = y * y; z + 2; };  // lambda with block body
proc printResult(label, value) {              // procedure: may perform effects
  println(label + ": " + value);
}
async proc demoAwait() {                      // async procedure
  let result = await delayedDouble(21);
  println("delayedDouble(21) = " + result);
}
memo function fib(n) {                         // memoized pure function
  if n <= 1 then n else fib(n - 1) + fib(n - 2);
}
```

* A function body returns either via `return` or by ending with an expression statement.
* Functions are **curried / partially applicable**: `clamp(0)(100)` and `map(fn x => x*2)` both
  yield new functions awaiting the remaining arguments.
* `memo` caches results by argument — used in the corpus for `fib`.
* `proc`/`async proc` are the only places effects (printing, files, network, mutation) appear.

### Control flow is expression-based

```pfun
let max_val = is_greater ? b : a;             // ternary

if a < b then { println("less"); } else { println("more or equal"); }

if n <= 0 then return "Liftoff!" else countdown(n - 1);   // if as expression / early return
```

There is **no `while` or `for` statement** in the corpus. Iteration is expressed with
recursion, higher-order functions (`map`/`filter`/`reduce`), and **list comprehensions**:

```pfun
let even_doubled = [ x * 2 for x <- nums where x % 2 == 0 ];
let pairs_sum    = [ x + y for x <- xs for y <- ys ];
let flat         = [ x for row <- matrix for x <- row ];
```

A `proc` that needs to "loop" defines a **recursive inner `proc`** (see `readAllLines` and
`replLoop` in the corpus, reused in Chapter 5).

### Records and discriminated unions

```pfun
type Point = { x, y, z };
let p1 = Point { 10, 20, 30 };                 // positional
let u1 = User(name="Alice", age=30, active=true);  // named, order-independent
println(p1.x);

type Shape = {
  | Square    : side
  | Circle    : radius
  | Rectangle : x, y
}
let sq = Square { 10 };
let ci = Circle { radius = 5 };
let re = Rectangle(x=3, y=4);
```

Records are product types with named fields; unions (a.k.a. discriminated unions / ADTs) have
one or more **variants**, each with zero or more fields. Construction may be positional
(`Square { 10 }`) or named (`Circle { radius = 5 }`).

### Pattern matching

```pfun
let area = match sq with
  | Square s    -> s.side * s.side
  | Circle c    -> c.radius * c.radius
  | Rectangle r -> r.x * r.y;

let classify = match ci with
  | Circle c where c.radius > 10 -> "big circle"
  | Circle c where c.radius > 2  -> "medium circle"
  | Circle _                     -> "small circle"
  | _                            -> "not a circle";
```

`match` is an expression. Each arm binds the variant payload to a name (`Square s`, then
`s.side`), ignores it with `_`, and may carry a `where` **guard**. Bare variable patterns with
guards work too (`| n where n >= 100 -> "big"`). A `_` arm is the catch-all.

### Errors are values: `Option` and `Response`

Pfun does not use exceptions for control flow. Two built-in polymorphic unions model
absence and failure:

```pfun
// Conceptually (both are built in and generic over their payloads):
generic type Option   = { | Some value | None };
generic type Response = { | Ok value   | Err err };
```

`Option` models a value that may be missing; `Response` models an operation that may fail.
Foreign and I/O calls return `Response`: on success `Ok` carries the value, and on failure
`Err` carries an error whose **`message`** field is the underlying exception text. The corpus
reads it everywhere as `e.message`:

```pfun
match readFile(path) with
| Ok o  -> println(o.value)
| Err e -> println("Read error: " + e.message);
```

> **Naming note.** The corpus consistently spells the failure variant `Err` and reads
> `e.message`. The language overview also refers to it as the `Error`/`err` variant of the
> generic `Response`. This book uses the form the code uses — `Err` with `e.message`.

Some streaming reads (`readLine`, `readBytes`) return a **three-way** result that adds an `Eof`
variant:

```pfun
match readLine(handle) with
| Ok  l -> { println(l.value); readLoop(); }
| Eof _ -> 0
| Err e -> println("Read error: " + e.message);
```

> **Monomorphization caveat (important).** Although `Option` and `Response` are generic, the
> corpus's code generator (`dbschema_gen.pf`) deliberately avoids reusing one generic union
> across many different payload types in the same module, with comments such as *"avoids Option
> monomorphism"* and *"Per-table result types to avoid monomorphism unification."* The practical
> idiom is therefore to declare **specialized** result unions (for example
> `type FindCustomerResult = { | FindCustomerOk : model | FindCustomerErr : message }`) when a
> single generic type would otherwise be unified across incompatible payloads. This is revisited
> in Chapter 8 and Appendix B.

### Modules

```pfun
import * from "io";                                  // pull in a standard module
import * from "./mathutils";                          // relative import (whole module)
import { add as mathAdd, clamp as mathClamp } from "./mathutils";  // named, with aliases
import * as Math from "./mathutils";                  // namespaced: Math.multiply(6, 7)

export function add(x, y) { return x + y; }            // exported from a module
export let tau = 6;
export proc printResult(label, value) { println(label + ": " + value); }
```

Standard modules seen in the corpus include `io`, `file`, `json`, `http`, `async`, `math`, and
the database drivers `db/postgresql` and `db/mariadb`. Sequence and collection helpers
(`map`, `filter`, `reduce`, `head`, `tail`, `cons`, `length`, `nth`, `take`, `iterate`,
`split`, `join`, …) behave as an always-available prelude.

### The foreign-function interface (FFI)

Pfun reaches JavaScript and Node libraries through a foreign interface that **wraps each call
in try/catch and returns a `Response`** — `Ok value` on success, `Err { message }` on a thrown
exception. The corpus exposes this indirectly through the standard modules (`file`, `http`,
`json`, `db/*`), all of which return `Response`. The individual low-level FFI primitives are not
themselves documented in the corpus.

This book follows the language's intent: when a recipe needs a capability the standard modules
do not provide (regular expressions, crypto, dates, compression, …), it calls a small
**Pfun-idiomatic wrapper** that returns a `Response`, and **Appendix A** records that wrapper's
signature and the exact JavaScript/Node API it wraps. The recommended pattern mirrors the rest
of the language: keep the wrapper thin and effectful, and keep the decision-making in pure
functions around it.

---


## Table of Contents

1. **String & Text Processing** — trim/normalize whitespace · parse CSV with quoted fields ·
   camel/snake/kebab case · truncate without splitting words · extract URLs · slugify ·
   detect/convert line endings · mask sensitive data · wrap long lines · diff two strings
2. **Numbers & Math** — round without drift · thousands separators & currency · clamp ·
   random int in range · percentage label · unit conversion · compound interest · safe divide ·
   fuzzy equality · running average
3. **Dates & Times** — parse unknown format · "time ago" · date difference · business days ·
   timezone conversion · all dates in a month · weekend/holiday · start/end of week · locale
   formatting · parse a duration string
4. **Collections & Data Structures** — dedup preserving order · group by field · flatten nested ·
   chunk · rotate · set operations · multi-key sort · top-N · deep-merge · partition
5. **Files & I/O** — read large file line by line · recursive file listing · watch a directory ·
   atomic write · JSON config with defaults · log rotation · gzip · size by file type ·
   copy a tree with exclusions · parse INI
6. **Networking & HTTP** — GET + JSON · POST with auth headers · retries with backoff · chunked
   download with progress · request timeouts · parse/construct URLs · scrape an HTML table ·
   poll until condition · multipart upload · validate/normalize email
7. **Databases** — batch insert · upsert · cursor pagination · dynamic filters · transactions ·
   soft delete · column migration · find duplicates · JSON/blob columns · seed from a fixture
8. **Error Handling & Resilience** — retry N times · time out a call · enrich & re-raise ·
   expected errors vs. bugs · graceful degradation · accumulate validation errors · circuit breaker ·
   clean async error propagation · structured logging · partial batch failures
9. **Concurrency & Performance** — parallel requests · throttle · debounce · TTL cache ·
   worker threads · producer/consumer queue · race-condition guard · lazy initialization ·
   streaming results · profiling
10. **Security & Encoding** — salted password hashing · secure tokens · Base64 & padding ·
    HMAC sign/verify · HTML sanitization · secrets from env/vault · time-limited tokens ·
    symmetric encryption · per-user rate limiting · audit logging

**Appendices** — A: Foreign-Function Wrappers (the FFI bridges every recipe relies on) ·
B: Missing or Undocumented Language Features · C: Built-in Quick Reference

---


## Chapter 1 — String & Text Processing

Pfun strings are immutable sequences of characters. The sequence prelude works on them
directly: `head`, `tail`, `cons`, `nth`, `length`, `reverse`, `slice`, `map`, `filter`, and
`reduce` all accept a string and (for the sequence-returning ones) give a string back. Two
subtleties from the corpus are worth fixing in your mind before reading on:

* Iterating a string **directly** (`map(f, s)`, `filter(p, s)`, `reduce(f, z, s)`, `nth(s, i)`)
  yields **characters** (`'h'`).
* `split(s, "")` yields a list of **one-character strings** (`"h"`). The corpus's
  `dbschema_gen.pf` relies on this, calling `head(c)` on each element. Both styles appear; this
  chapter uses each where it reads most clearly.

All recipes in this chapter import `stringlib.pf`, which provides `trim`, `trimLeft`,
`trimRight`, `startsWith`, `endsWith`, `replace`, `replaceAll`, `contains`, `strRepeat`,
`padLeft`, `padRight`, `indexOf`, and several others. See §E.1 for the full reference.

```pfun
import * from "$PFUN_HOME/lib/stringlib";
```

Several recipes share these small helpers, which are not in `stringlib` and are defined
locally:

```pfun
// Whitespace test (extended from tiny-lisp.pf's isSpace).
function isSpace(c) { c == ' ' || c == '\n' || c == '\t' || c == '\r'; }

// Code point of a one-character string, and character-class tests on one-char strings.
function charCode(cs) { asc(head(cs)); }
function isUpperS(cs) { let k = charCode(cs); k >= 65 && k <= 90; }
function isLowerS(cs) { let k = charCode(cs); k >= 97 && k <= 122; }
function isAlnumS(cs) { isLowerS(cs) || isUpperS(cs) || (charCode(cs) >= 48 && charCode(cs) <= 57); }
```

> **Note on `replaceAll` and `contains`:** the chapter intro originally defined inline
> helpers `replaceAll` and `hasSub`. Both now come from `stringlib`:
> `replaceAll(s, from, to)` replaces every occurrence of `from` with `to`;
> `contains(s, sub)` returns `true` if `sub` appears anywhere in `s`. Using the library
> versions avoids name collisions if you later import `stringlib` into the same module.

---

### 1. Trim whitespace and normalize internal spacing

Text that arrives from users, files, or the network is rarely clean: it has leading and
trailing blanks, tabs and newlines mixed in, and runs of several spaces between words. A common
requirement is to produce a *canonical* form — no surrounding whitespace and exactly one space
between words. Because this is pure transformation with no I/O, it belongs entirely in the
functional core.

```pfun
function normalizeWs(s) {
  // 1. turn tabs, carriage returns and newlines into spaces
  let spaced = replaceAll(replaceAll(replaceAll(s, "\t", " "), "\r", " "), "\n", " ");
  // 2. split on space, drop the empty pieces (collapses runs and trims the ends), rejoin
  join(filter(fn w => w != "", split(spaced, " ")), " ");
}

println(normalizeWs("   hello   \t world\n\n  again  "));  // "hello world again"
```

**How it works.** The first step normalizes every whitespace character to a plain space using
`replaceAll` from `stringlib`. Splitting the result on `" "` produces empty strings wherever
two delimiters were adjacent and at each end; `filter`-ing those out simultaneously collapses
internal runs *and* trims the edges. `join(…, " ")` reassembles the words with single spaces.
The whole pipeline is built from `stringlib` and prelude functions and is referentially
transparent. Note that `stringlib` also exports `trim`, `trimLeft`, and `trimRight` if you only
need edge whitespace removed without internal collapsing.

---

### 2. Parse a CSV line handling quoted fields with commas inside

A naive `split(line, ",")` breaks as soon as a field contains a comma inside quotes, such as
`"Smith, John",42`. Correct CSV parsing is a small state machine: it must track whether the
scanner is currently inside a quoted field, and treat a doubled quote (`""`) as an escaped
literal quote. This is exactly the shape of the character scanner in `tiny-lisp.pf`'s
`tokenizeFrom`, so we reuse that recursive, index-driven style here.

```pfun
function parseCsvLine(line) { reverse(csvScan(line, 0, "", [], false)); }

function csvScan(s, i, field, acc, inQ) {
  if i >= length(s) then cons(field, acc)               // flush the final field
  else {
    let c  = nth(s, i);        // the character, for comparisons
    let ch = slice(i, 1, s);   // the same character as a 1-char string, for accumulation
    if inQ then
      (if c == '"' then
         (if i + 1 < length(s) && nth(s, i + 1) == '"'
            then csvScan(s, i + 2, field + "\"", acc, true)   // "" -> literal quote
            else csvScan(s, i + 1, field, acc, false))        // closing quote
       else csvScan(s, i + 1, field + ch, acc, true))
    else
      (if c == '"'      then csvScan(s, i + 1, field, acc, true)             // opening quote
       else if c == ',' then csvScan(s, i + 1, "", cons(field, acc), false) // field boundary
       else                  csvScan(s, i + 1, field + ch, acc, false));
  }
}

println(parseCsvLine("Alice,30,true"));            // ["Alice", "30", "true"]
println(parseCsvLine("\"Smith, John\",42,\"a\"\"b\""));  // ["Smith, John", "42", "a\"b"]
```

**How it works.** `csvScan` carries five threads of state through the recursion: the source
`s`, the cursor `i`, the field being built (`field`), the accumulated fields (`acc`, reversed),
and the quote flag `inQ`. Outside quotes, a comma flushes the current field with `cons` and
resets; inside quotes, commas are ordinary characters. The two-character lookahead
(`nth(s, i + 1) == '"'`) collapses `""` into one quote and stays inside the quoted region. We
accumulate with the one-character substring `slice(i, 1, s)` to avoid any char-to-string
conversion. Building `acc` in reverse and calling `reverse` once at the end is the standard
Pfun accumulator pattern (seen in `tokenize`/`parseList`).

---

### 3. Convert between camelCase, snake_case, and kebab-case

Code generators, ORMs, and API layers constantly translate between identifier styles — a
database column `customer_id` becomes a field `customerId`, a CSS class `customer-id`, or a type
`CustomerId`. The same character-case helpers (`toUpper`, `toLower`, `capitalise`, `toCamel`,
`toPascal`) appear in `dbschema_gen.pf` for its own use, but they are not exported as a library.
The recipe defines them locally alongside a style-agnostic word splitter, so we can go *between*
any of the three conventions.

```pfun
// Self-contained character-case helpers (same logic as dbschema_gen.pf's internal copies,
// not importable from a library — define them locally in any module that needs them).
function toUpper(c) { let code = asc(head(c)); if code >= 97 && code <= 122 then __str__(chr(code - 32)) else c; }
function toLower(c) { let code = asc(head(c)); if code >= 65 && code <= 90 then __str__(chr(code + 32)) else c; }
function capitalise(s) {
  if length(s) == 0 then s else {
    let chars = split(s, "");
    toUpper(head(chars)) + join(tail(chars), "");
  }
}

// --- new: split ANY identifier style into lowercase words ---
function wordsOf(s) { splitWordsAcc(split(s, ""), "", []); }
function splitWordsAcc(chars, cur, acc) {
  if length(chars) == 0 then
    (if cur == "" then reverse(acc) else reverse(cons(cur, acc)))
  else {
    let cs = head(chars);
    if cs == "_" || cs == "-" || cs == " " then
      (if cur == "" then splitWordsAcc(tail(chars), "", acc)
       else splitWordsAcc(tail(chars), "", cons(cur, acc)))
    else if isUpperS(cs) && cur != "" then
      splitWordsAcc(tail(chars), toLower(cs), cons(cur, acc))   // boundary before a capital
    else
      splitWordsAcc(tail(chars), cur + toLower(cs), acc);
  }
}

function toSnake(s)  { join(wordsOf(s), "_"); }
function toKebab(s)  { join(wordsOf(s), "-"); }
function toCamel(s)  { let ws = wordsOf(s); if length(ws) == 0 then "" else head(ws) + join(map(capitalise, tail(ws)), ""); }
function toPascal(s) { join(map(capitalise, wordsOf(s)), ""); }

println(toSnake("customerId"));     // "customer_id"
println(toKebab("CustomerId"));     // "customer-id"
println(toCamel("customer_id"));    // "customerId"
println(toPascal("customer-id"));   // "CustomerId"
```

**How it works.** `wordsOf` reduces any input to a canonical list of lowercase words by walking
the characters once: underscores, hyphens, and spaces are explicit separators, and a capital
letter following an existing word also starts a new word (so `customerId` splits into
`customer`/`id`). Each emitter then re-joins those words: `toSnake`/`toKebab` simply insert the
separator, while `toCamel`/`toPascal` reuse the corpus's `capitalise`. Because everything funnels
through one neutral representation, you never need a separate function for every *pair* of
styles.

---

### 4. Truncate text to N characters without splitting words

Summaries, previews, and table cells often need a hard length limit, but cutting in the middle
of a word ("inform…" from "information") looks broken. The better behavior is to include only
whole words that fit within the budget. This is a pure fold over the word list that stops as
soon as the next word would overflow.

```pfun
function truncateWords(s, n) { truncAcc(filter(fn w => w != "", split(s, " ")), n, ""); }

function truncAcc(ws, n, acc) {
  if length(ws) == 0 then acc
  else {
    let w = head(ws);
    let candidate = if acc == "" then w else acc + " " + w;
    if length(candidate) > n then
      (if acc == "" then slice(0, n, w) else acc)   // first word too long -> hard cut
    else truncAcc(tail(ws), n, candidate);
  }
}

println(truncateWords("the quick brown fox jumps", 15));  // "the quick brown"
println(truncateWords("supercalifragilistic", 6));        // "superc"
```

**How it works.** `truncAcc` tries to extend the accumulated string `acc` by one word at a time.
The moment the tentative `candidate` exceeds `n`, it returns what it already had. The single edge
case is a first word longer than the whole budget, which we resolve with a hard `slice(0, n, w)`
so the function always returns *something* no longer than `n`. Add `+ "…"` to the truncated
branches if you want an ellipsis.

---

### 5. Extract all URLs from a block of text

Scanning prose for links — in chat messages, log lines, or scraped pages — is a job for a
regular expression, and the corpus's standard modules do not include one. We therefore call the
`regexFindAll` foreign wrapper (Appendix A), which bridges to JavaScript's native `RegExp` and
returns every match. Keeping the pattern in a raw string (`@"…"`) avoids a storm of backslash
escaping.

```pfun
// regexFindAll : (String pattern, String flags, String text) -> List<String>   [Appendix A]
let urlPattern = @"https?://[^\s)]+";

function extractUrls(text) { regexFindAll(urlPattern, "g", text); }

let blob = "See https://example.com/docs and http://a.test/x?y=1 (also https://b.io).";
println(extractUrls(blob));
// ["https://example.com/docs", "http://a.test/x?y=1", "https://b.io"]
```

**How it works.** `regexFindAll` runs the pattern with the global (`"g"`) flag and returns the
list of matched substrings; the raw-string pattern matches an `http`/`https` scheme followed by
any run of non-whitespace, non-`)` characters. Because the underlying foreign call is wrapped in
try/catch and returns a `Response`, the Appendix A wrapper collapses the (practically impossible)
compile-failure case to an empty list so callers get a clean `List<String>`. If you need the
match positions too, use `regexMatchGroups` (also Appendix A). The decision of *what counts as a
URL* stays in one pure function you can test in isolation.

---

### 6. Slugify a string for use in a URL

A slug turns an arbitrary title like *"Hello, World! (v2)"* into a clean,
lowercase, hyphen-separated token (`hello-world-v2`) safe to drop into a path. The rules are:
fold to lowercase, keep only letters and digits, and turn every run of other characters into a
single hyphen with no leading or trailing hyphens. This is pure text manipulation, reusing the
character-class helpers from the top of the chapter.

```pfun
function slugify(s) {
  // map each character to itself (lowercased) if alphanumeric, else to a space
  let cleaned = join(map(fn cs => if isAlnumS(cs) then toLower(cs) else " ", split(s, "")), "");
  // collapse runs of spaces and join with hyphens (same trick as normalizeWs)
  join(filter(fn w => w != "", split(cleaned, " ")), "-");
}

println(slugify("Hello, World! (v2)"));      // "hello-world-v2"
println(slugify("  Récipé   #3  "));         // "r-cip-3"   (non-ASCII dropped)
```

**How it works.** Each character is classified by `isAlnumS`; non-alphanumerics become spaces,
which the second stage (split / filter-empties / join-with-hyphen) collapses into single
separators while trimming the ends. The result is deterministic and dependency-free. Note that
this ASCII-only version drops accented letters; for transliteration ("é" → "e") you would route
through a Unicode-normalization foreign wrapper, but the everyday case needs no FFI at all.

---

### 7. Detect and convert line endings (CRLF ↔ LF)

Files authored on Windows use `\r\n` (CRLF) line endings while Unix tools expect `\n` (LF);
mixing them causes spurious diffs and broken parsing. You frequently need to detect which
convention a blob uses and normalize in either direction. The `replaceAll` idiom handles the
conversions, and `contains` (from `stringlib`) handles detection — both pure.

```pfun
function toLf(s)   { replaceAll(s, "\r\n", "\n"); }
function toCrlf(s) { replaceAll(toLf(s), "\n", "\r\n"); }   // normalize first so we never double up

function detectEnding(s) {
  if contains(s, "\r\n") then "CRLF"
  else if contains(s, "\n") then "LF"
  else "none";
}

println(detectEnding("a\r\nb"));   // "CRLF"
println(length(toLf("a\r\nb")));   // 3   (the \r is gone)
println(length(toCrlf("a\nb")));   // 4
```

**How it works.** `toLf` deletes carriage returns by replacing `\r\n` with `\n`.
`toCrlf` is written defensively: it first folds everything to LF, *then* expands to CRLF, so a
string that already contains CRLF will not become `\r\r\n`. `detectEnding` uses `contains`
from `stringlib` and checks for `\r\n` before bare `\n` because every CRLF contains an LF.
Both `replaceAll` and `contains` come from `stringlib` (imported at the top of the chapter).

---

### 8. Mask sensitive data (show only the last 4 digits)

Logs, receipts, and admin screens routinely need to show enough of a card number, account
number, or token for a human to recognize it without exposing the secret in full. The standard
treatment keeps the final four characters and replaces the rest with a fixed mask character.
This is a pure function, and keeping it pure means it is safe to call from anywhere — including
inside log formatting (Chapter 8).

```pfun
// strRepeat(s, n) is provided by stringlib — no need to define it locally.

function maskAllButLast4(s) {
  let n = length(s);
  if n <= 4 then s
  else strRepeat("*", n - 4) + slice(n - 4, 4, s);
}

println(maskAllButLast4("4111111111111234"));  // "************1234"
println(maskAllButLast4("99"));                // "99"  (too short to mask)
```

**How it works.** `slice(n - 4, 4, s)` extracts the last four characters (start index `n-4`,
length `4`), and `strRepeat("*", n - 4)` from `stringlib` builds a mask of the appropriate
width. Strings of four or fewer characters are returned unchanged. To preserve formatting such as
`**** **** **** 1234`, mask first and then reinsert separators with the grouping helper from
Recipe 12.

---

### 9. Wrap long lines at a column width

Console output, emails, and code comments read better when wrapped to a fixed column width such
as 72 or 80. Greedy word wrapping packs as many whole words as will fit on each line, then breaks.
The algorithm is a fold that emits a line whenever the next word would push it past the limit.

```pfun
function wrap(s, width) {
  join(wrapAcc(filter(fn w => w != "", split(s, " ")), width, "", []), "\n");
}
function wrapAcc(ws, width, line, lines) {
  if length(ws) == 0 then
    (if line == "" then reverse(lines) else reverse(cons(line, lines)))
  else {
    let w = head(ws);
    let candidate = if line == "" then w else line + " " + w;
    if length(candidate) > width && line != "" then
      wrapAcc(ws, width, "", cons(line, lines))         // flush current line, retry word
    else
      wrapAcc(tail(ws), width, candidate, lines);        // word fits: keep packing
  }
}

println(wrap("the quick brown fox jumps over the lazy dog", 15));
// the quick brown
// fox jumps over
// the lazy dog
```

**How it works.** `wrapAcc` builds the current `line` word by word. When appending the next word
would exceed `width` *and* the line is non-empty, it commits the line to `lines` and retries the
same word on a fresh line (note that `ws` is **not** advanced in that branch). Otherwise the word
is added and the recursion advances. Reversing `lines` at the end restores order, and
`join(…, "\n")` produces the wrapped block. Words longer than `width` occupy their own
(over-long) line — extend the overflow branch with `slice` if you must hard-break them.

---

### 10. Diff two strings and show what changed

Showing a user *what changed* between two versions of a string — a config value, a name, a line
of text — makes edits reviewable. A full Myers/LCS diff is involved, but a great deal of value
comes from the simple observation that most edits share a common prefix and suffix; the change is
the differing middle. The pure function below computes that decomposition, and a `proc` renders
it.

```pfun
type Diff = { prefix, removed, added, suffix }

function commonPrefixLen(a, b, i) {
  if i >= length(a) || i >= length(b) then i
  else if nth(a, i) == nth(b, i) then commonPrefixLen(a, b, i + 1)
  else i;
}
function commonSuffixLen(a, b, k, limit) {
  if k >= limit then k
  else if nth(a, length(a) - 1 - k) == nth(b, length(b) - 1 - k) then commonSuffixLen(a, b, k + 1, limit)
  else k;
}

function diffStrings(a, b) {
  let p     = commonPrefixLen(a, b, 0);
  let limit = (length(a) - p) < (length(b) - p) ? (length(a) - p) : (length(b) - p);
  let s     = commonSuffixLen(a, b, 0, limit);
  Diff {
    slice(0, p, a),                       // shared start
    slice(p, length(a) - p - s, a),       // text only in a (removed)
    slice(p, length(b) - p - s, b),       // text only in b (added)
    slice(length(a) - s, s, a)            // shared end
  };
}

// effectful renderer (the wrapper); the diff itself is pure
proc showDiff(a, b) {
  let d = diffStrings(a, b);
  println(d.prefix + "[-" + d.removed + "-][+" + d.added + "+]" + d.suffix);
}

showDiff("color: red", "color: green");   // color: [-red-][+green+]
```

**How it works.** `commonPrefixLen` walks forward while characters match; `commonSuffixLen` walks
backward, capped by `limit` so the prefix and suffix can never overlap on the shorter string. The
four `slice`s carve the inputs into a shared head, the removed middle (from `a`), the added middle
(from `b`), and a shared tail. `diffStrings` returns a plain `Diff` record — a *description* of the
change — and the `showDiff` `proc` is the only part that performs output, faithful to
"decide in the core, act in the wrapper." This handles single contiguous edits cleanly; multiple
scattered edits would need a true line- or token-level LCS, which you could build on the same
recursive scaffolding.

---


## Chapter 2 — Numbers & Math

Pfun has three numeric kinds in the corpus: arbitrary-precision **Int** (`factorial(30, 1)` and
`square(1000000000000)` compute exact results in `golden.pf`), **Float** (`2.0`, `sqrt(2.0)`), and
**Byte** (`0xFFb`). The `math` module supplies `sqrt`, `pow`, `abs`, `lerp`, `clamp`, `sign`,
`min`, `max`, `cbrt`, `exp`, `log`, `log2`, `log10`, `hypot`, `fmod`, `formatFixed`, the
trigonometric functions, and the constants `pi`, `e`, `tau`, `inf`, `nan`. Note that `round`,
`floor`, and `ceil` are **prelude builtins** (always in scope, no import needed), not part of the
`math` module. `toInt`, `toFloat`, `toByte`, and `toChar` convert between numeric kinds.

`mathutils.pf` is a small reusable library that exports `clamp(value, lo, hi)`,
`safeDivide(a, b)` (returning `Option`), `add`, `subtract`, `multiply`, `fact`, and `countdown`.
`random.pf` exports `randomInt(min, max)` (inclusive both ends, CSPRNG), `randomFloat()`,
`randomBytes`, `randomUUID`, and more (see §E.3). `locale.pf` exports
`formatLocalNumber(n)`, `formatLocalCurrency(n)`, and `formatLocalCurrencyWith(n, currencyCode)`
for locale-sensitive display (see §E.4).

> **A note on `/`.** The corpus shows `10 / 4` and `7b / 2b` but never prints the result, and
> `tiny-lisp.pf` treats `/` as integer arithmetic (`LInt { a.n / b.n }`). Whether integer `/`
> truncates or yields a float is therefore not fully settled by the examples. Where a fractional
> result matters, convert explicitly with `toFloat` first (as `client.pf` does:
> `toInt(toFloat(model.addA))`). See Appendix B.

---

### 11. Round a float to N decimal places without floating-point drift

`0.1 + 0.2` is the canonical reminder that binary floats cannot represent most decimals exactly,
so naively rounding for display can show `2.6750000000000003`. For money and reports you want a
value rounded to a fixed number of decimals with no drift. The reliable way to *display* such a
value is to format it as a string with a fixed precision; to keep computing with it, scale by a
power of ten, round to an integer, and scale back.

```pfun
import * from "math";   // for pow and formatFixed

// Display form: exact decimal string, no drift.
// formatFixed(x, decimals) is in the math module — no FFI needed.
function money(x) { formatFixed(x, 2); }

// Numeric form: round to n decimals via integer scaling.
// round is a prelude builtin (always in scope); pow comes from math.
function roundTo(x, n) {
  let p = pow(10.0, toFloat(n));
  toFloat(round(x * p)) / p;
}

println(money(2.675));        // "2.68"   (string, drift-free for display)
println(roundTo(2.675, 2));   // 2.68     (Float; see note)
```

**How it works.** `formatFixed(x, decimals)` from the `math` module formats a float as a
correctly rounded decimal **string** — the right choice whenever the number is about to be shown
to a human, written to a file, or sent as JSON. `roundTo` multiplies by `10^n`, rounds to the
nearest integer with the prelude's `round` (eliminating the fractional noise), and divides back;
the final division reintroduces float representation, so prefer the string form for anything
user-facing and keep `roundTo` for intermediate arithmetic where a small epsilon is acceptable.
Keeping both in pure functions means they compose freely and never surprise a caller with hidden
state.

---

### 12. Format a number with thousands separators and a currency symbol

Large numbers are unreadable without digit grouping: `1234567` should render as `1,234,567` and a
price as `$1,234.50`. There are two routes in Pfun: a small pure function that groups digits with
no dependencies, or a locale-aware foreign wrapper around JavaScript's `Intl.NumberFormat`. The
pure version below is self-contained and reuses the string helpers from Chapter 1.

```pfun
import * from "math";   // for formatFixed

// group an integer string into 3-digit clusters from the right
function groupThousands(digits) {
  let n = length(digits);
  if n <= 3 then digits
  else groupThousands(slice(0, n - 3, digits)) + "," + slice(n - 3, 3, digits);
}

function formatCurrencyPure(symbol, amount) {
  let fixed = formatFixed(amount, 2);          // "1234567.50"  (math module)
  let dot   = match findSlice(fixed, ".") with | Some p -> p.value | None -> length(fixed);
  let whole = slice(0, dot, fixed);
  let frac  = slice(dot, length(fixed) - dot, fixed);  // includes the "."
  symbol + groupThousands(whole) + frac;
}

println(groupThousands("1234567"));               // "1,234,567"
println(formatCurrencyPure("$", 1234567.5));      // "$1,234,567.50"

// Locale-aware alternative: locale.pf exports formatLocalCurrency(n) and
// formatLocalCurrencyWith(n, currencyCode) using the system locale.
// import * from "$PFUN_HOME/lib/locale";
// println(formatLocalCurrencyWith(1234567.5, "USD"));   // locale-dependent
```

**How it works.** `groupThousands` peels three digits off the right end and recurses on the rest,
inserting a comma between, until three or fewer digits remain. `formatCurrencyPure` first renders
a drift-free two-decimal string with `formatFixed` (from the `math` module), then uses `findSlice` (which returns the
`Some { value: index }` of the decimal point) to split the whole and fractional parts, groups only
the whole part, and prepends the symbol. When you need locale-correct grouping, decimal marks, and
symbol placement, use `formatLocalCurrencyWith(n, currencyCode)` from `locale.pf` (§E.4) rather
than reimplementing locale rules by hand.

---

### 13. Clamp a value between a min and max

Clamping forces a value into a `[lo, hi]` range — essential for slider positions, RGB channels,
retry caps, and array indices. This is such a fundamental operation that `mathutils.pf` exports it,
so the idiomatic answer is simply to import and call it. The recipe also shows the **curried**
form, which lets you bake in the bounds and reuse the result as a one-argument function.

```pfun
import { clamp as mathClamp } from "./mathutils";
// mathutils.clamp(value, lo, hi) = value < lo ? lo : (value > hi ? hi : x)
// Note: the math module also exports clamp with the same signature.

println(mathClamp(15, 0, 10));   // 10
println(mathClamp(-3, 0, 10));   // 0
println(mathClamp(7, 0, 10));    // 7

// Bounds-first argument order, enabling partial application:
function clampBounds(lo, hi, x) { x < lo ? lo : (x > hi ? hi : x); }
let clamp0to100 = clampBounds(0)(100);   // a reusable [0,100] clamp
println(clamp0to100(150));               // 100
println(clamp0to100(-5));                // 0
```

**How it works.** Clamping is two nested ternaries: below `lo` snaps up to `lo`, above `hi` snaps
down to `hi`, otherwise the value passes through. `mathutils` puts the value first
(`clamp(value, lo, hi)`), which reads naturally at the call site; `clampBounds` puts the bounds
first specifically so that `clampBounds(0)(100)` produces a specialized `clamp0to100`. Both are
correct — choose the argument order by whether you call ad hoc or want to pre-configure a reusable
clamp. Pfun's automatic partial application makes the second style free. Note that `return` is not
a Pfun keyword — functions return the value of their last expression implicitly.

---

### 14. Generate a random integer in a range (inclusive)

Tests, sampling, and simple games need a uniform random integer between `lo` and `hi` *inclusive*.
`random.pf` provides `randomInt(min, max)` directly — it uses a cryptographically secure RNG and
is inclusive on both ends. For anything security-sensitive (tokens, passwords) use `randomBytes`
or `randomUUID` from the same module (Chapter 10).

```pfun
import * from "$PFUN_HOME/lib/random";

println(randomInt(1, 6));     // a die roll: 1..6 inclusive
println(randomInt(0, 0));     // always 0

// randomFloat() is also available when you need a Float in [0, 1)
let f = randomFloat();
println(f >= 0.0);            // true
```

**How it works.** `randomInt(min, max)` in `random.pf` calls an internal CSPRNG helper
(`cryptoRandomInt(min, max + 1)`) so that both endpoints are included in the range. This is
stronger than `Math.random`-based approaches: the entropy comes from the platform's secure random
source rather than a predictable PRNG, so the same function is safe for non-security sampling
*and* usable as a building block for security-sensitive code. `randomFloat()` from the same module
gives a Float in `[0, 1)` when you need it, also backed by the CSPRNG.

---

### 15. Compute a percentage and display it as "X of Y (Z%)"

Progress indicators and reports want a compact "completed 37 of 50 (74%)" style label. The
calculation must guard against a zero total (no division by zero) and round the percentage for
readability. Keeping it pure makes it trivial to drop into any view or log line.

```pfun
// round is a prelude builtin — no import needed.
function percentLabel(part, total) {
  if total == 0 then __str__(part) + " of 0 (n/a)"
  else {
    let pct = round(toFloat(part) / toFloat(total) * 100.0);
    __str__(part) + " of " + __str__(total) + " (" + __str__(pct) + "%)";
  }
}

println(percentLabel(37, 50));   // "37 of 50 (74%)"
println(percentLabel(1, 3));     // "1 of 3 (33%)"
println(percentLabel(5, 0));     // "5 of 0 (n/a)"
```

**How it works.** Both operands are promoted with `toFloat` before dividing so the ratio is a
genuine fraction regardless of how integer `/` behaves (see the chapter note), then multiplied by
100 and rounded to a whole percent with the prelude's `round`. The zero-total branch returns a
sensible `"n/a"` instead of crashing or producing `NaN`. `__str__` renders each number for
concatenation; using it explicitly (rather than relying on `+` coercion) matches the corpus style
seen in `counter.pf` and the database demos.

---

### 16. Convert between units (miles ↔ km, Celsius ↔ Fahrenheit)

Unit conversions are pure, total functions — perfect functional-core material. Defining each
direction as its own small function (rather than one over-configurable converter) keeps call
sites self-documenting and lets the compiler and reader see exactly which way the conversion
goes.

```pfun
function milesToKm(mi) { mi * 1.609344; }
function kmToMiles(km) { km / 1.609344; }

function cToF(c) { c * 9.0 / 5.0 + 32.0; }
function fToC(f) { (f - 32.0) * 5.0 / 9.0; }

println(milesToKm(26.2));   // 42.16...
println(cToF(100.0));       // 212
println(fToC(32.0));        // 0
```

**How it works.** Each function encodes one linear relationship with float literals so the
arithmetic is unambiguously floating-point. They are total (defined for every input) and
referentially transparent, so they compose: `kmToMiles(milesToKm(x))` returns `x` up to float
precision. For a larger unit system, group related conversions in a module and `export` them, the
way `mathutils.pf` exports its arithmetic — callers then `import` exactly the conversions they
need.

---

### 17. Calculate compound interest over time

Compound interest answers "what will a principal grow to?" given a rate, a compounding frequency,
and a number of years: `A = P · (1 + r/n)^(n·t)`. The formula is pure and depends only on
`math.pow`, so it slots straight into the functional core, and you can layer rounding (Recipe 11)
and currency formatting (Recipe 12) on top for presentation.

```pfun
import * from "math";

// principal P, annual rate r (e.g. 0.05), compounds per year n, years t
function compound(p, r, n, t) {
  p * pow(1.0 + r / toFloat(n), toFloat(n) * toFloat(t));
}

println(money(compound(1000.0, 0.05, 12, 10)));   // "1647.01"  (money from Recipe 11)
println(money(compound(1000.0, 0.05, 1, 10)));    // "1628.89"  (annual compounding)
```

**How it works.** `r / toFloat(n)` is the per-period rate and `toFloat(n) * toFloat(t)` is the
total number of periods; `pow` raises the growth factor to that exponent and multiplying by `p`
gives the final amount. Promoting `n` and `t` with `toFloat` keeps the exponent floating-point.
Because the function returns a raw Float, the caller decides how to present it — here we pipe it
through the `money` formatter so the result reads as currency without the calculation knowing or
caring about display.

---

### 18. Safely divide, returning a default on division by zero

Division by zero must never blow up a calculation pipeline. Pfun's value-based error style gives
two clean options: return an `Option` (`None` for "undefined") so the caller decides what to do,
or collapse to a caller-supplied default. `mathutils.pf` already exports the `Option` form, which
we reuse, then build the default-returning variant on top.

```pfun
import { safeDivide as mathSafeDivide } from "./mathutils";
// mathutils.safeDivide(a, b) = b == 0 ? None : Some { a / b }

// caller-decides form
println(match mathSafeDivide(20, 4) with | Some s -> __str__(s.value) | None -> "undefined");  // "5"
println(match mathSafeDivide(20, 0) with | Some s -> __str__(s.value) | None -> "undefined");  // "undefined"

// default-returning form, built on the Option form
function divOr(a, b, fallback) {
  match mathSafeDivide(a, b) with
  | Some s -> s.value
  | None   -> fallback;
}
println(divOr(20, 4, 0));   // 5
println(divOr(20, 0, 0));   // 0
```

**How it works.** `safeDivide` inspects the divisor and returns `None` instead of dividing by
zero, so the danger is encoded in the type — callers *cannot* forget to handle it, because they
must `match` to get at the value. `divOr` is a thin adapter that supplies a default for the `None`
case, which is convenient when "0" (or any sentinel) is a perfectly fine answer. This mirrors the
`Option` discipline used throughout the corpus (`find`, `jsonDeserialize`, `readln`): make the
absence explicit rather than papering over it.

---

### 19. Check if a number is within a tolerance of another (fuzzy equality)

Because floats accumulate rounding error, `a == b` is the wrong test for computed quantities;
`0.1 + 0.2 == 0.3` is false. The robust comparison asks whether the two numbers are within a small
tolerance `eps` of each other. `math.abs` makes this a one-liner that belongs in the functional
core wherever floats are compared.

```pfun
import * from "math";

function approxEq(a, b, eps) { abs(a - b) <= eps; }

println(approxEq(0.1 + 0.2, 0.3, 0.000001));   // true
println(approxEq(1.0, 1.5, 0.000001));         // false
```

**How it works.** `abs(a - b)` is the absolute distance between the values; comparing it to `eps`
treats numbers "close enough" as equal. This *absolute* tolerance is ideal when the magnitudes are
known and bounded (as with most measurements and currency). For values spanning many orders of
magnitude, switch to a relative tolerance by dividing the difference by `abs(a)` or
`abs(a) + abs(b)` before the comparison. Either way, never use exact `==` on the result of float
arithmetic.

---

### 20. Compute a running average without storing all values

When values arrive one at a time — sensor samples, request latencies, a stream of prices — you
often cannot or should not keep them all in memory just to average them. The trick is to carry a
tiny piece of state (the count and the current mean) and update it incrementally. This is a
textbook case of a **pure update function** driven by an effectful loop: the math is pure, the
feeding of values is the wrapper's job.

```pfun
type RunningAvg = { count, mean }

function emptyAvg() { RunningAvg { 0, 0.0 }; }

// pure: fold one new sample into the running state
function pushAvg(state, x) {
  let n = state.count + 1;
  RunningAvg { n, state.mean + (x - state.mean) / toFloat(n) };
}

// pure: average a whole list by folding pushAvg
function averageOf(xs) { reduce(pushAvg, emptyAvg(), xs).mean; }

println(averageOf([10.0, 20.0, 30.0]));   // 20

// effectful driver: the wrapper owns the var; the math stays pure
proc averageStream(xs) {
  var state = emptyAvg();
  proc loop(rest) {
    if length(rest) == 0 then println("avg = " + __str__(state.mean))
    else { state = pushAvg(state, head(rest)); loop(tail(rest)); }
  }
  loop(xs);
}
averageStream([10.0, 20.0, 30.0]);   // avg = 20
```

**How it works.** `pushAvg` uses the numerically stable update
`mean + (x - mean) / n` rather than tracking a running sum (which can overflow or lose precision
for long streams). Because `pushAvg` is pure and shaped like a reducer, `averageOf` can fold it
over a list with `reduce` and the whole computation is testable in isolation. The `averageStream`
`proc` demonstrates the wrapper role: it holds the mutable `state` in a `var`, advances through the
input with a recursive inner `proc` (the corpus's substitute for a loop), and calls the pure
`pushAvg` to do the actual work. Swap the list for live input — `readln`, a socket, a queue — and
the pure core does not change at all.

---


## Chapter 3 — Dates & Times

The corpus contains **no** date or time functionality, so every recipe here bridges to
JavaScript through foreign wrappers defined in **Appendix A**. The chapter follows one
discipline rigorously, because it is what keeps date code testable:

* **Reading the clock is an effect.** `now()` (epoch milliseconds, wrapping `Date.now()`) is the
  only genuinely effectful call — its result depends on *when* you run it. It belongs in a `proc`.
* **Everything else is deterministic.** Parsing, formatting, and field extraction
  (`dateParse`, `datePartsUtc`, `dateFromPartsUtc`, `weekdayUtc`, `dateFormatInZone`) are pure
  *foreign queries*: given the same input they always return the same output. Date **arithmetic**
  is done in plain Pfun on integer milliseconds and needs no FFI at all.

A few shared constants and helpers used throughout the chapter:

```pfun
let DAY  = 86400000;   // ms per day
let HOUR = 3600000;
let MIN  = 60000;

function pad2(n) { if n < 10 then "0" + __str__(n) else __str__(n); }

// Inclusive integer range (unambiguous; see the range note in Appendix B).
function rangeIncl(lo, hi) { if lo > hi then [] else cons(lo, rangeIncl(lo + 1, hi)); }
```

The `DateParts` record returned by `datePartsUtc` (Appendix A) has fields
`{ year, month, day, hour, minute, second, weekday }`, with `month` in `1..12` and `weekday` in
`0..6` (0 = Sunday).

---

### 21. Parse a date string in an unknown but common format

Dates arrive as text in a bewildering variety of shapes — ISO 8601, `2024-01-15`, RFC strings,
locale forms — and you often cannot dictate the format. JavaScript's `Date.parse` already
recognizes the common ones, so the pragmatic approach is to wrap it and surface failure as a
`Response` rather than the silent `NaN` JavaScript would otherwise produce. That turns "did this
parse?" into something the type system forces you to handle.

```pfun
// dateParse : (String) -> Response<Int>   epoch ms, Err if unparseable   (Appendix A)
proc showParsed(s) {
  match dateParse(s) with
  | Ok ms -> println(s + " -> " + dateFormatIso(ms.value));   // dateFormatIso: Appendix A
  | Err e -> println(s + " -> could not parse: " + e.message);
}

showParsed("2024-01-15");
showParsed("2024-01-15T09:30:00Z");
showParsed("not a date");     // -> could not parse: ...
```

**How it works.** `dateParse` calls `Date.parse` inside the FFI's try/catch and additionally
treats a `NaN` result as an `Err`, so the caller receives a clean `Ok ms` or an explanatory
`Err`. Because the result is a `Response`, the `match` is mandatory — you cannot accidentally
propagate an unparsed date. Internally everything is reduced to an absolute instant (epoch
milliseconds), which is the canonical, timezone-free representation the rest of the chapter
computes on. When you control the format, prefer an exact parser; `Date.parse` is for the
"unknown but common" case named in the problem.

---

### 22. Display a "time ago" label (e.g., "3 hours ago")

Feeds and dashboards read more naturally with relative timestamps ("just now", "3 hours ago")
than absolute ones. The label is a pure function of the elapsed milliseconds; only the *current*
time is effectful. Splitting it this way means you can unit-test every threshold by passing a
fixed delta, with no clock involved.

```pfun
// pure: turn an elapsed duration (ms) into a human label
function timeAgoLabel(deltaMs) {
  if deltaMs < MIN        then "just now"
  else if deltaMs < HOUR  then plural(deltaMs / MIN,  "minute")
  else if deltaMs < DAY   then plural(deltaMs / HOUR, "hour")
  else                         plural(deltaMs / DAY,  "day");
}
function plural(n, unit) {
  __str__(n) + " " + unit + (n == 1 ? "" : "s") + " ago";
}

// effectful: read the clock, then defer to the pure label
proc timeAgo(thenMs) { println(timeAgoLabel(now() - thenMs)); }   // now(): Appendix A

println(timeAgoLabel(3 * HOUR));     // "3 hours ago"
println(timeAgoLabel(45 * 1000));    // "just now"
println(timeAgoLabel(1 * MIN));      // "1 minute ago"
```

**How it works.** `timeAgoLabel` compares the delta against ascending thresholds and divides into
the largest unit that fits, delegating wording to `plural` (which also fixes the "1 minute" vs "2
minutes" agreement). The single effect — `now()` — is isolated in the `timeAgo` `proc`, which
simply computes `now() - thenMs` and hands the pure function a number. This is the recurring
pattern of the chapter: the wrapper supplies "now," the core decides everything else.

---

### 23. Find the difference between two dates in days/hours/minutes

Given two instants you frequently need their gap broken into days, hours, and minutes — for
"time remaining" displays or duration reports. Once both dates are absolute milliseconds, this is
pure integer arithmetic with `/` and `%`. No timezone reasoning is required because the difference
between two instants is timezone-independent.

```pfun
type Span = { days, hours, minutes }

function diffSpan(msA, msB) {
  let d = abs(msA - msB);                      // math.abs; order-independent
  Span { d / DAY, (d % DAY) / HOUR, (d % HOUR) / MIN };
}

proc showGap(a, b) {
  match dateParse(a) with
  | Err e -> println("bad date: " + e.message)
  | Ok ma -> match dateParse(b) with
    | Err e -> println("bad date: " + e.message)
    | Ok mb -> {
        let s = diffSpan(ma.value, mb.value);
        println(__str__(s.days) + "d " + __str__(s.hours) + "h " + __str__(s.minutes) + "m");
      };
}

showGap("2024-01-01T00:00:00Z", "2024-01-03T05:30:00Z");   // 2d 5h 30m
```

**How it works.** `diffSpan` takes the absolute difference (so argument order does not matter),
then carves it into units: integer division by `DAY` gives whole days, the remainder divided by
`HOUR` gives leftover hours, and so on. The arithmetic is exact because we operate on integer
milliseconds. `showGap` is the effect-free-then-effectful sandwich again: pure `diffSpan` wrapped
by a `proc` that does the parsing and printing, threading the two `Response`s with nested `match`
(Chapter 8 shows how to flatten such chains).

---

### 24. Add or subtract business days (skipping weekends)

"Three business days from now" must skip Saturdays and Sundays, which a fixed `+ 3*DAY` cannot do.
The clean formulation steps one calendar day at a time, only counting a step when it lands on a
weekday. `weekdayUtc` (a deterministic foreign query) tells us the day of week; the stepping logic
is pure recursion.

```pfun
// weekdayUtc : (Int ms) -> Int   0=Sun .. 6=Sat   (Appendix A, wraps Date.getUTCDay)
function isWeekend(ms) { let d = weekdayUtc(ms); d == 0 || d == 6; }

function addBusinessDays(ms, n) {
  if n == 0 then ms
  else if n > 0 then {
      let next = ms + DAY;
      if isWeekend(next) then addBusinessDays(next, n) else addBusinessDays(next, n - 1);
    }
  else {
      let prev = ms - DAY;
      if isWeekend(prev) then addBusinessDays(prev, n) else addBusinessDays(prev, n + 1);
    };
}

// Friday 2024-01-12 + 1 business day = Monday 2024-01-15
match dateParse("2024-01-12T12:00:00Z") with
| Ok fri -> println(dateFormatIso(addBusinessDays(fri.value, 1)));
| Err _  -> 0;
```

**How it works.** The function recurses on the remaining count `n`. Each step moves the instant by
one `DAY`; if the new day is a weekend it recurses **without** changing `n` (the day "doesn't
count"), otherwise it decrements (or increments, for negative `n`) toward zero. When `n` reaches 0
the current instant is the answer. To also skip public holidays, combine this with the holiday
check from Recipe 27 — treat a holiday exactly like a weekend in `isWeekend`.

---

### 25. Convert a timestamp between time zones

A single instant in time looks like different wall-clock readings in different zones: 14:30 UTC is
09:30 in New York. Because an instant is stored as absolute milliseconds, "conversion" is really
*formatting that instant in a target zone* — work that `Intl.DateTimeFormat` does correctly,
including daylight-saving rules. We wrap it as `dateFormatInZone`.

```pfun
// dateFormatInZone : (Int ms, String tz, String locale) -> String   (Appendix A, Intl.DateTimeFormat)
proc showZones(iso) {
  match dateParse(iso) with
  | Err e -> println("bad date: " + e.message)
  | Ok m  -> {
      println("UTC:      " + dateFormatInZone(m.value, "UTC",              "en-GB"));
      println("New York: " + dateFormatInZone(m.value, "America/New_York", "en-US"));
      println("Tokyo:    " + dateFormatInZone(m.value, "Asia/Tokyo",       "ja-JP"));
    };
}

showZones("2024-06-01T14:30:00Z");
```

**How it works.** All three lines format the *same* `m.value` instant; only the IANA time-zone
argument differs, so `Intl.DateTimeFormat` renders each zone's local wall-clock time and applies
the correct DST offset for that date. There is no mutation of the instant — converting "to a zone"
in Pfun means choosing a zone at *format* time, never altering the underlying number. Keep storing
and computing in UTC milliseconds and only introduce a zone at the display boundary; this avoids
the classic bugs that come from storing zone-local times.

---

### 26. Generate all dates in a given month

Calendars, billing cycles, and reports need every day of a month. The number of days depends on
the month and on leap years, both of which are pure rules. We compute the day count without any
FFI and then turn each day number into an absolute instant with `dateFromPartsUtc`.

```pfun
function isLeap(y) { (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0); }
function daysInMonth(y, m) {
  if m == 2 then (if isLeap(y) then 29 else 28)
  else if m == 4 || m == 6 || m == 9 || m == 11 then 30
  else 31;
}

// dateFromPartsUtc : (Int y, Int m, Int d) -> Int ms   (Appendix A, wraps Date.UTC)
function datesInMonth(y, m) {
  [ dateFromPartsUtc(y, m, d) for d <- rangeIncl(1, daysInMonth(y, m)) ];
}

let feb2024 = datesInMonth(2024, 2);
println(length(feb2024));                         // 29 (leap year)
println(dateFormatIso(head(feb2024)));            // 2024-02-01T00:00:00.000Z
```

**How it works.** `isLeap` encodes the Gregorian leap-year rule and `daysInMonth` uses it for
February. The list comprehension iterates the inclusive day range `1..daysInMonth` and maps each
day to an instant at midnight UTC via `dateFromPartsUtc`. The result is a plain list of
milliseconds you can format, filter (e.g. drop weekends with Recipe 27), or diff. The only foreign
call is the pure `dateFromPartsUtc`; the calendar arithmetic is entirely Pfun.

---

### 27. Check if a date falls on a weekend or holiday

Scheduling logic must recognize non-working days: weekends always, plus a configurable list of
public holidays. Weekends come from `weekdayUtc` (Recipe 24); holidays are best modeled as a set
of `YYYY-MM-DD` strings so the check is a simple membership test after formatting the instant to a
date key. Keeping the holiday list as data (not code) lets each deployment supply its own.

```pfun
function dateKey(ms) {
  let p = datePartsUtc(ms);                                  // Appendix A
  __str__(p.year) + "-" + pad2(p.month) + "-" + pad2(p.day);
}
function isHoliday(ms, holidays) {
  match find(holidays, dateKey(ms)) with | Some _ -> true | None -> false;
}
function isNonWorkingDay(ms, holidays) { isWeekend(ms) || isHoliday(ms, holidays); }

let holidays2024 = ["2024-01-01", "2024-07-04", "2024-12-25"];

match dateParse("2024-07-04T10:00:00Z") with
| Ok m -> println(isNonWorkingDay(m.value, holidays2024) ? "off" : "working");   // "off"
| Err _ -> 0;
```

**How it works.** `dateKey` formats an instant to a stable `YYYY-MM-DD` string using `datePartsUtc`
and the `pad2` helper, giving a canonical key that ignores the time of day. `isHoliday` uses the
prelude `find` (which returns `Some { value }` or `None`) to test membership in the holiday list,
and `isNonWorkingDay` ORs that with the weekend test. Because holidays are passed in as a list, the
same pure functions serve any country or company calendar — supply the data, reuse the logic.

---

### 28. Find the start and end of a week given a date

Weekly rollups need the boundaries of "the week containing this date," and teams disagree on
whether weeks start on Sunday or Monday — so the start day must be a parameter. Both boundaries are
pure arithmetic on milliseconds once you can find the day-of-week and truncate to midnight. The
midnight truncation works because the Unix epoch begins exactly at a UTC day boundary.

```pfun
function dayStartUtc(ms) { ms - (ms % DAY); }             // floor to 00:00:00 UTC

function startOfWeek(ms, weekStart) {                      // weekStart: 0=Sun, 1=Mon
  let back = (weekdayUtc(ms) - weekStart + 7) % 7;
  dayStartUtc(ms) - back * DAY;
}
function endOfWeek(ms, weekStart) { startOfWeek(ms, weekStart) + 7 * DAY - 1; }

match dateParse("2024-01-17T12:00:00Z") with     // a Wednesday
| Ok m -> {
    println("week start: " + dateFormatIso(startOfWeek(m.value, 1)));  // Mon 2024-01-15
    println("week end:   " + dateFormatIso(endOfWeek(m.value, 1)));    // Sun 2024-01-21 23:59:59.999
  }
| Err _ -> 0;
```

**How it works.** `dayStartUtc` removes the time-of-day by subtracting `ms % DAY` (milliseconds
since midnight UTC). `startOfWeek` computes how many days to step back so the result lands on the
chosen first day: `(weekday - weekStart + 7) % 7` is that offset for any start day. `endOfWeek`
adds seven days and subtracts one millisecond to get the inclusive last instant of the week. All of
this is pure integer math; `weekdayUtc` is the only (deterministic) foreign touch.

---

### 29. Format a date for a locale (DD/MM/YYYY vs MM/DD/YYYY)

The same date renders as `15/01/2024` in much of the world and `01/15/2024` in the United States.
For full locale correctness — month names, separators, ordering — `Intl.DateTimeFormat` (Recipe
25's `dateFormatInZone`) is the right tool, but for the common numeric layouts a tiny pure
formatter over `DateParts` is clearer and dependency-free.

```pfun
function formatDate(parts, style) {
  let dd = pad2(parts.day); let mm = pad2(parts.month); let yyyy = __str__(parts.year);
  if style == "DMY"      then dd + "/" + mm + "/" + yyyy
  else if style == "MDY" then mm + "/" + dd + "/" + yyyy
  else                        yyyy + "-" + mm + "-" + dd;   // ISO fallback
}

match dateParse("2024-01-15T00:00:00Z") with
| Ok m -> {
    let p = datePartsUtc(m.value);
    println(formatDate(p, "DMY"));   // 15/01/2024
    println(formatDate(p, "MDY"));   // 01/15/2024
  }
| Err _ -> 0;
```

**How it works.** `datePartsUtc` extracts the calendar fields once, and `formatDate` selects an
ordering by a `style` tag, zero-padding day and month with `pad2`. Keeping the layout choice as a
string parameter makes it trivial to drive from configuration or a user preference. When you need
localized month names ("January", "janvier") or right-to-left scripts, switch to the
`Intl`-backed `dateFormatInZone` wrapper, which knows every locale's conventions; the pure version
is for fixed numeric formats.

---

### 30. Parse a duration string like "1h 30m" into seconds

Configuration and CLIs often express durations as friendly strings — `"1h 30m"`, `"45s"`,
`"2d 4h"` — which must become a number of seconds for timers and TTLs. This is a pure parser: split
into tokens, interpret each token's numeric prefix and unit suffix, and sum. It reuses the
digit-folding trick from `tiny-lisp.pf`'s `parseInt`.

```pfun
function parseDigits(s) { reduce(fn acc, c => acc * 10 + (asc(c) - asc('0')), 0, s); }

function tokenSeconds(tok) {
  let unit = slice(length(tok) - 1, 1, tok);              // last char as a string
  let num  = parseDigits(slice(0, length(tok) - 1, tok)); // everything before it
  if unit == "d"      then num * 86400
  else if unit == "h" then num * 3600
  else if unit == "m" then num * 60
  else if unit == "s" then num
  else 0;
}

function parseDuration(s) {
  reduce(fn acc, tok => acc + tokenSeconds(tok), 0, filter(fn t => t != "", split(s, " ")));
}

println(parseDuration("1h 30m"));   // 5400
println(parseDuration("2d 4h"));    // 187200
println(parseDuration("45s"));      // 45
```

**How it works.** `parseDuration` splits the string on spaces, drops empty pieces, and folds
`tokenSeconds` over the tokens with `reduce`, accumulating a total. `tokenSeconds` splits each
token into its unit (the final character) and its number (the rest), converts the number with the
`parseDigits` fold (`asc(c) - asc('0')` maps a digit character to its value), and scales by the
unit. Unknown units contribute zero, which you could tighten into an `Option`-returning parser if
you need to reject malformed input (see Chapter 8's validation recipe).

---


## Chapter 4 — Collections & Data Structures

Pfun offers three collection types with different trade-offs, all visible in the corpus:

* **Lists** `[1, 2, 3]` — immutable, the functional workhorse. They support `map`, `filter`,
  `reduce`, `head`, `tail`, `cons`, `nth`, `length`, `reverse`, `slice`, `take`, comprehensions,
  and `+` concatenation. They may be **lazy/infinite** (`iterate`, `repeat`, `cycle`).
* **Arrays** `array { ... }` — mutable, indexed: `arr[i]`, `arr[i] = v`, `append`, `insertAt`,
  `removeAt`, `arrayLength`.
* **Dicts** `dict { k -> v }` — mutable maps: `d[k]`, `d[k] = v`, `has`, `remove`, `keys`,
  `values`, `dictToList`, `listToDict`.

Everything in this chapter is pure unless it explicitly uses a `var`, an array, or a dict.
The corpus provides no built-in `sort`, so Recipe 37 builds one. Two small helpers are reused
across the chapter:

```pfun
// Unambiguous integer division (sidesteps the `/` question from Chapter 2).
function idiv(a, b) { toInt(toFloat(a) / toFloat(b)); }

// Structural membership test, built on the prelude `find` (works for records too).
function member(xs, x) { match find(xs, x) with | Some _ -> true | None -> false; }
```

---

### 31. Deduplicate a list while preserving order

Removing duplicates is routine, but `set`-style dedup loses the original order, which matters for
things like recent-items lists or ordered tag sets. The goal is to keep the *first* occurrence of
each element and drop later repeats. A fold that remembers what it has already emitted does this
in one left-to-right pass.

```pfun
function dedup(xs) { reverse(dedupAcc(xs, [], [])); }
function dedupAcc(xs, seen, acc) {
  if length(xs) == 0 then acc
  else {
    let x = head(xs);
    if member(seen, x) then dedupAcc(tail(xs), seen, acc)
    else dedupAcc(tail(xs), cons(x, seen), cons(x, acc));
  }
}

println(dedup([3, 1, 3, 2, 1, 4]));               // [3, 1, 2, 4]
println(dedup(["a", "b", "a", "c"]));             // ["a", "b", "c"]
```

**How it works.** `dedupAcc` threads a `seen` list and a reversed output `acc`. For each element it
checks `member(seen, x)` (structural equality via the prelude `find`, so it also works for records
and tuples) and either skips the element or records it in both `seen` and `acc`. One final
`reverse` restores input order. This is `O(n²)` because membership is linear; when your elements are
strings or ints, swap `seen` for a `dict` used as a set (`has`/`d[x] = true`) to get `O(n)` — at the
cost of moving the work into a `proc`, since dicts are mutable.

---

### 32. Group a list of objects by a field (e.g., orders by customer)

Reporting and aggregation constantly need "all the orders for each customer" — a list reshaped
into buckets keyed by some field. The purely functional version accumulates an *association list*
(a list of `Pair { key, items }`), which keeps the operation referentially transparent and avoids
a mutable dict. The key extractor is a parameter, so the same `groupBy` works for any field.

```pfun
type Order = { id, customer, total }

function groupBy(keyOf, xs) { reduce(fn acc, x => addToGroup(acc, keyOf(x), x), [], xs); }

function addToGroup(groups, k, x) {
  if length(filter(fn g => g.key == k, groups)) > 0
    then map(fn g => g.key == k ? Pair { g.key, g.items + [x] } : g, groups)
    else groups + [Pair { k, [x] }];
}

let orders = [
  Order { 1, "alice", 30 }, Order { 2, "bob", 10 },
  Order { 3, "alice", 5 },  Order { 4, "carol", 7 }
];
let byCustomer = groupBy(fn o => o.customer, orders);
println(map(fn g => g.key + ": " + __str__(length(g.items)), byCustomer));
// ["alice: 2", "bob: 1", "carol: 1"]
```

**How it works.** `groupBy` folds the input into a growing list of `Pair`s. For each element,
`addToGroup` either appends to the matching bucket (via `map` that rebuilds only the matching pair)
or starts a new bucket at the end. Because nothing mutates, the result is deterministic and the
function is trivial to test. For large inputs where the linear bucket scan hurts, build a `dict`
inside a `proc` instead — the corpus's `countWords` shows the pattern: `if has(counts, k) then
counts[k] = counts[k] + 1 else counts[k] = 1`.

---

### 33. Flatten a nested list to arbitrary depth

Flattening `[[1], [2, [3, 4]]]` into `[1, 2, 3, 4]` is easy for a fixed depth — `example.pf`
already does one level with a comprehension: `[ x for row <- matrix for x <- row ]`. *Arbitrary*
depth is harder in Pfun because the corpus documents **no runtime type test** to ask "is this
element itself a list?" (see Appendix B). The idiomatic, type-safe answer is to model the nesting
explicitly with a union, so the structure is known to the compiler and the recursion is total.

```pfun
type Nested = { | Leaf : value | Branch : items }   // items : List<Nested>

function flatten(n) {
  match n with
  | Leaf l   -> [l.value]
  | Branch b -> reduce(fn acc, child => acc + flatten(child), [], b.items);
}

let tree = Branch { [
  Leaf { 1 },
  Branch { [ Leaf { 2 }, Branch { [ Leaf { 3 }, Leaf { 4 } ] } ] },
  Leaf { 5 }
] };
println(flatten(tree));   // [1, 2, 3, 4, 5]
```

**How it works.** A `Nested` value is either a `Leaf` holding one value or a `Branch` holding a list
of further `Nested` values. `flatten` pattern-matches: a leaf becomes a one-element list, and a
branch folds `flatten` over its children, concatenating with `+`. Because the tree's shape is in the
type, no "is it a list?" test is needed and the recursion provably terminates. If you must flatten a
genuinely *untyped* heterogeneous array, you would need the `isList` predicate from Appendix A
(wrapping `Array.isArray`) — but prefer the typed model; it is what the corpus does everywhere else
(see `LispVal`, `Block`, `Inline`).

---

### 34. Chunk a list into batches of size N

Batching turns one long list into a list of fixed-size sublists — indispensable for paging UI rows,
sending bulk database inserts (Chapter 7), or rate-limited API calls. The final chunk may be
smaller than `N`. Slicing off `N` at a time and recursing expresses this directly.

```pfun
function chunk(xs, n) {
  let len = length(xs);
  if len == 0 then []
  else {
    let take = n < len ? n : len;             // clamp so the last chunk is exact
    cons(slice(0, take, xs), chunk(slice(take, len - take, xs), n));
  }
}

println(chunk([1, 2, 3, 4, 5, 6, 7], 3));   // [[1,2,3], [4,5,6], [7]]
println(chunk([1, 2], 5));                   // [[1, 2]]
```

**How it works.** Each step takes the first `take` elements (`slice(0, take, xs)`) as one chunk and
recurses on the remainder (`slice(take, len - take, xs)`). Clamping `take` to the remaining length
keeps the final, short chunk correct without relying on any particular out-of-range `slice`
behavior. The result is a list of lists you can `map` over — for example `map(insertBatch, chunk(rows, 500))`
to push 500 rows per database round-trip.

---

### 35. Rotate a list left or right by N positions

Rotation shifts every element by `N`, wrapping around the ends — useful for round-robin scheduling,
carousel UIs, and circular buffers. The clean implementation splits the list at the rotation point
and swaps the two halves, after normalizing `N` so that over-large or negative shifts behave
sensibly. List concatenation with `+` does the reassembly.

```pfun
function rotateLeft(xs, k) {
  let len = length(xs);
  if len == 0 then xs
  else {
    let s = ((k % len) + len) % len;          // normalize into 0 .. len-1
    slice(s, len - s, xs) + slice(0, s, xs);
  }
}
function rotateRight(xs, k) { rotateLeft(xs, 0 - k); }

println(rotateLeft([1, 2, 3, 4, 5], 2));    // [3, 4, 5, 1, 2]
println(rotateRight([1, 2, 3, 4, 5], 1));   // [5, 1, 2, 3, 4]
```

**How it works.** `((k % len) + len) % len` reduces any `k` — including negatives and values larger
than the length — to an equivalent shift in `0 … len-1`. The list is then cut into the part from `s`
onward and the part before `s`, and the two are concatenated in swapped order to rotate left.
`rotateRight` is defined as a left rotation by `-k`, so the two share one implementation and one set
of edge cases.

---

### 36. Compute the intersection, union, and difference of two lists/sets

Set algebra answers everyday questions: which tags do two posts share (intersection), what is the
combined permission set (union), which items are new (difference). With the `member` helper and
`filter`, each operation is a one-liner, and `union` reuses the order-preserving `dedup` from
Recipe 31 so results stay tidy.

```pfun
function intersect(a, b)  { filter(fn x => member(b, x), a); }
function difference(a, b) { filter(fn x => !member(b, x), a); }
function union(a, b)      { dedup(a + b); }

let xs = [1, 2, 3, 4];
let ys = [3, 4, 5, 6];
println(intersect(xs, ys));    // [3, 4]
println(difference(xs, ys));   // [1, 2]
println(union(xs, ys));        // [1, 2, 3, 4, 5, 6]
```

**How it works.** `intersect` keeps elements of `a` that also appear in `b`; `difference` keeps
those that do not (note the `!`); `union` concatenates and then removes duplicates while preserving
first-seen order. All three rely on structural equality through `member`/`find`, so they work for
records and strings, not just numbers. As with Recipe 31, switch the membership test to a `dict`
set if the inputs are large and the elements are strings or ints.

---

### 37. Sort a list of objects by multiple fields with mixed sort orders

"Sort by age descending, then by name ascending" is the canonical multi-key sort, and Pfun has no
built-in `sort` — so this recipe builds a reusable, comparator-driven **merge sort** (stable,
`O(n log n)`, purely functional) and a small algebra for *composing* comparators. The result reads
almost like a SQL `ORDER BY`.

```pfun
function mergeSort(cmp, xs) {
  let n = length(xs);
  if n <= 1 then xs
  else {
    let mid = idiv(n, 2);
    merge(cmp, mergeSort(cmp, slice(0, mid, xs)), mergeSort(cmp, slice(mid, n - mid, xs)));
  }
}
function merge(cmp, a, b) {
  if length(a) == 0 then b
  else if length(b) == 0 then a
  else if cmp(head(a), head(b)) <= 0 then cons(head(a), merge(cmp, tail(a), b))
  else cons(head(b), merge(cmp, a, tail(b)));
}

// comparators return negative / zero / positive
function cmpInt(a, b) { a < b ? -1 : (a > b ? 1 : 0); }
function cmpStr(a, b) { if a == b then 0 else cmpStrAt(a, b, 0); }
function cmpStrAt(a, b, i) {
  if i >= length(a) then (i >= length(b) ? 0 : -1)
  else if i >= length(b) then 1
  else { let ca = asc(nth(a, i)); let cb = asc(nth(b, i));
         if ca < cb then -1 else if ca > cb then 1 else cmpStrAt(a, b, i + 1); }
}

// build comparators from field accessors; order = 1 (asc) or -1 (desc)
function byInt(getF, order) { fn a, b => order * cmpInt(getF(a), getF(b)); }
function byStr(getF, order) { fn a, b => order * cmpStr(getF(a), getF(b)); }
function thenBy(c1, c2)     { fn a, b => { let r = c1(a, b); r != 0 ? r : c2(a, b); }; }

type Person = { name, age };
let people = [Person { "Bob", 30 }, Person { "Alice", 30 }, Person { "Carol", 25 }];

let order = thenBy(byInt(fn p => p.age, -1), byStr(fn p => p.name, 1));   // age desc, then name asc
println(map(fn p => p.name + "/" + __str__(p.age), mergeSort(order, people)));
// ["Alice/30", "Bob/30", "Carol/25"]
```

**How it works.** `mergeSort` splits the list in half (`idiv` gives an honest integer midpoint),
recursively sorts each half, and `merge` interleaves them by comparator; because `merge` prefers the
left element on ties (`<= 0`), the sort is **stable**, which is exactly what makes multi-key sorting
work. `byInt`/`byStr` turn a field accessor and a direction into a comparator (multiplying by `-1`
reverses it), and `thenBy` chains two comparators so the second only breaks ties left by the first.
`cmpStr` compares by code point rather than relying on `<` for strings (which the corpus does not
demonstrate — see Appendix B). Compose as many `thenBy` layers as you have sort keys.

---

### 38. Find the top-N items by a given key

Leaderboards and "most recent" lists want only the highest few items by some score, not a full
ordering you then slice. Built on the sort from Recipe 37 and the prelude's lazy-friendly `take`,
`topN` is a two-line composition. Sorting descending and taking the front is clearest; for very
large inputs a partial selection would be faster, but this is correct and concise.

```pfun
function topN(xs, getKey, n) { take(n, mergeSort(byInt(getKey, -1), xs)); }

type Score = { player, points };
let scores = [
  Score { "ann", 42 }, Score { "bo", 88 }, Score { "cy", 71 }, Score { "di", 88 }
];
println(map(fn s => s.player + "=" + __str__(s.points), topN(scores, fn s => s.points, 2)));
// ["bo=88", "di=88"]
```

**How it works.** `byInt(getKey, -1)` builds a descending comparator on the chosen key, `mergeSort`
orders the whole list with it (stably, so equal scores keep input order), and `take(n, …)` keeps the
first `n`. Because `take` short-circuits, the same code works on a lazy list, returning only `n`
elements. To rank ascending (smallest N), pass `1` instead of `-1` to `byInt`.

---

### 39. Deep-merge two dictionaries/maps

Layered configuration — defaults overlaid by environment overrides overlaid by per-request settings
— requires a *deep* merge where nested objects are combined recursively rather than replaced
wholesale. As with flattening (Recipe 33), distinguishing a nested map from a scalar at runtime is
not something the corpus documents, so the robust approach models configuration as a typed tree and
merges by pattern matching.

```pfun
type Conf = { | CObj : entries | CVal : value }   // entries : List<Pair{ key, Conf }>

function assocGet(entries, k) {
  let hit = filter(fn p => p.key == k, entries);
  if length(hit) == 0 then None else Some { head(hit).value };
}

function mergeConf(base, over) {
  match base with
  | CVal _ -> over                                  // scalar: override wins
  | CObj b -> match over with
    | CVal _ -> over                                // type changed: override wins
    | CObj o -> CObj { mergeEntries(b.entries, o.entries) };
}
function mergeEntries(baseE, overE) {
  let merged = map(fn p =>
    match assocGet(overE, p.key) with
    | Some s -> Pair { p.key, mergeConf(p.value, s.value) }   // present in both: recurse
    | None   -> p, baseE);
  let added = filter(fn p =>
    match assocGet(baseE, p.key) with | Some _ -> false | None -> true, overE);
  merged + added;
}

let defaults = CObj { [ Pair { "host", CVal { "localhost" } },
                        Pair { "db", CObj { [ Pair { "port", CVal { 5432 } },
                                              Pair { "ssl",  CVal { false } } ] } } ] };
let override = CObj { [ Pair { "db", CObj { [ Pair { "ssl", CVal { true } } ] } } ] };
let merged = mergeConf(defaults, override);
// host stays "localhost"; db.port stays 5432; db.ssl becomes true
```

**How it works.** `mergeConf` recurses only when *both* sides are objects (`CObj`); a scalar on
either side means the override replaces the base, which is the conventional deep-merge rule.
`mergeEntries` rebuilds the base entries (recursing into keys that also appear in the override) and
then appends the override-only keys. Because the structure is a typed union, the recursion is total
and needs no runtime reflection. To deep-merge raw `dict` values instead, you would test each value
with the Appendix A `isDict` wrapper and build a fresh `dict` in a `proc`; the typed version is
preferred for the reasons given in Recipe 33.

---

### 40. Partition a list into items that pass and fail a condition

Many workflows split a list in two by a predicate: valid versus invalid rows, paid versus unpaid
invoices, items to keep versus to archive. Returning *both* halves at once (rather than filtering
twice at the call site) makes the intent obvious and the two results impossible to mismatch. A
`Pair` carries the two lists.

```pfun
function partition(pred, xs) { Pair { filter(pred, xs), filter(fn x => !pred(x), xs) }; }

let nums = [1, 2, 3, 4, 5, 6];
let parts = partition(fn x => x % 2 == 0, nums);
println(parts.key);     // [2, 4, 6]   (passed)
println(parts.value);   // [1, 3, 5]   (failed)
```

**How it works.** `partition` returns a `Pair` whose `key` holds the elements satisfying `pred` and
whose `value` holds the rest. The two `filter` passes are the most readable form and stay purely
functional. If a single traversal matters (the predicate is expensive, or the list is huge), fold
once into a `Pair` of reversed accumulators and `reverse` both at the end — but the two-pass version
is what most code should use, and it composes naturally with the validation recipe in Chapter 8.

---


## Chapter 5 — Files & I/O

File access is pure effect, so it lives in `proc`s. The `file` module (and `io`) provide the
building blocks the corpus uses directly:

* Whole-file: `readFile(path)` and `writeFile(path, content)`, each returning a
  `Result<_, NativeError>` (`Ok o` with `o.value`, or `Err e` whose
  `e.message` is a structured native error).
* Streaming: `fileOpen(path, mode)` with modes `Read`/`Write`/`Append`, then `readLine`,
  `writeLine`, `writeBytes`, `readBytes`, `readBuffer`, and `fileClose`. Line/byte reads return a
  three-way `ReadOk` / `ReadEof` / `ReadErr` result.
* Existence and directories: `fileExists(path)` returns
  `Result<Bool, NativeError>`; `mkdirP(path)` returns
  `Result<Unit, NativeError>`.

Anything the corpus lacks — directory listing, file metadata, rename, watch, compression — is a
foreign wrapper from **Appendix A** (built on Node's `fs`, `path`, `os`, and `zlib`). Two reused
helpers:

```pfun
// from dbschema.pf (exported there); reused throughout this chapter
function endsWith(s, suffix) {
  let sl = length(s); let xl = length(suffix);
  if xl > sl then false else slice(sl - xl, xl, s) == suffix;
}

// trim leading/trailing whitespace (preserving internal spaces); isSpace is from Chapter 1
function trimLeft(s)  { if length(s) > 0 && isSpace(nth(s, 0)) then trimLeft(slice(1, length(s) - 1, s)) else s; }
function trimRight(s) { let n = length(s); if n > 0 && isSpace(nth(s, n - 1)) then trimRight(slice(0, n - 1, s)) else s; }
function trimStr(s)   { trimRight(trimLeft(s)); }
```

---

### 41. Read a large file line by line without loading it all into memory

A multi-gigabyte log will not fit in memory, so `readFile` (which returns the whole content) is the
wrong tool — you need to stream one line at a time. The corpus already demonstrates the exact
pattern in `example.pf`'s `readAllLines`: open the file, then recurse with `readLine`, stopping on
`Eof`. We generalize it to fold a **pure** per-line function over the file, so the streaming
machinery is reused and the logic stays testable.

```pfun
import * from "io";
import * from "file";

// process a file line-by-line, folding a pure step(acc, line) -> acc
proc foldLines(path, step, seed) {
  match fileOpen(path, Read) with
  | Err e -> { println("open failed: " + e.message); seed; }
  | Ok o  -> {
      var acc = seed;
      proc loop() {
        match readLine(o.value) with
        | Ok l  -> { acc = step(acc, l.value); loop(); }
        | Eof _ -> 0
        | Err e -> println("read error: " + e.message);
      }
      loop();
      fileClose(o.value);
      acc;
    };
}

// count non-blank lines without ever holding the whole file
let nonBlank = foldLines("./big.log", fn n, line => line == "" ? n : n + 1, 0);
println("non-blank lines: " + __str__(nonBlank));
```

**How it works.** `foldLines` opens the file once and drives a recursive inner `proc loop` — Pfun's
substitute for a `while` — that reads exactly one line per iteration. Only the current line and the
running `acc` are in memory at any moment, so memory use is constant regardless of file size. The
per-line `step` is an ordinary pure function (here a counter), which means the *what to do with each
line* logic can be tested with a plain list and reused on any source. `fileClose` runs after the
loop returns on `Eof`, and the accumulated value is the `proc`'s result.

---

### 42. Recursively list all files matching a pattern in a directory tree

Build tools, linters, and bulk processors need every file under a root that matches some pattern —
all `.pf` files, say. The corpus has no directory API, so we use the `readDir` and `isDirectory`
wrappers (Appendix A) and recurse into subdirectories ourselves. The *match* test is a pure
predicate passed in, so the same walker serves any pattern.

```pfun
// readDir : (String) -> Response<List<String>>      isDirectory : (String) -> Bool
// pathJoin : (String, String) -> String             (all Appendix A)

proc walkDir(dir, keep) {
  match readDir(dir) with
  | Err _      -> []
  | Ok entries -> walkEntries(dir, entries.value, keep);
}
proc walkEntries(dir, names, keep) {
  if length(names) == 0 then []
  else {
    let full = pathJoin(dir, head(names));
    let here = if isDirectory(full) then walkDir(full, keep)
               else if keep(full) then [full] else [];
    here + walkEntries(dir, tail(names), keep);
  }
}

let pfFiles = walkDir("./src", fn p => endsWith(p, ".pf"));
println(pfFiles);
```

**How it works.** `walkDir` lists a directory's entries and hands them to `walkEntries`, which
processes one name at a time: directories recurse via `walkDir`, plain files are kept if `keep`
returns true, and everything is concatenated with `+`. Failures to read a directory degrade to an
empty list rather than aborting the whole walk (swap that for an `Err`-propagating version if you
need strictness). The predicate `keep` is pure — `endsWith(p, ".pf")` here — so matching by
extension, prefix, or a regex (`regexTest`, Appendix A) is just a different function.

---

### 43. Watch a directory for file changes and react to them

Dev servers, asset pipelines, and live reloaders must respond when files change on disk. This is an
inherently callback-driven, long-running effect, so it belongs entirely in the procedural layer. The
`watchDir` wrapper (Appendix A, over Node's `fs.watch`) registers a `proc` that the runtime invokes
with an event record each time something changes.

```pfun
// watchDir : (String path, proc(ev) onEvent) -> Response<WatcherHandle>   (Appendix A)
// ev : { kind, path }   kind is "change" | "rename"

proc onChange(ev) {
  println("[" + ev.kind + "] " + ev.path);
  if endsWith(ev.path, ".pf") then println("  -> would recompile " + ev.path) else 0;
}

proc startWatching(dir) {
  match watchDir(dir, onChange) with
  | Ok _  -> println("Watching " + dir + " ... (Ctrl-C to stop)")
  | Err e -> println("watch failed: " + e.message);
}

startWatching("./src");
```

**How it works.** `watchDir` installs the watcher and returns immediately with a `Response`; the
program keeps running and the runtime calls `onChange` for every filesystem event, passing an `ev`
record with the event `kind` and affected `path`. The reaction policy — here, log the event and
flag `.pf` files for recompilation — is plain Pfun you can keep as small as possible. Because the
event arrives as data, you can route it into a pure decision function (e.g. "should this path
trigger a rebuild?") and keep `onChange` a thin dispatcher, exactly as the TEA runtime turns DOM
events into `Msg` values.

---

### 44. Atomically write a file (write to temp, then rename)

If a program crashes (or is killed) midway through `writeFile`, readers can observe a truncated,
corrupt file. The standard fix is to write the full content to a temporary file and then *rename* it
over the target — rename is atomic on the same filesystem, so readers see either the old file or the
new one, never a half-written one. This composes the corpus's `writeFile` with the `rename` and
`tempFilePath` wrappers (Appendix A).

```pfun
// tempFilePath : (String) -> String      rename : (String, String) -> Response   (Appendix A)
proc writeAtomic(path, content) {
  let tmp = tempFilePath(path);
  match writeFile(tmp, content) with
  | Err e -> Err e                          // propagate the write failure
  | Ok _  -> rename(tmp, path);             // atomic swap; returns its own Response
}

match writeAtomic("./config.json", "{ \"ready\": true }") with
| Ok _  -> println("saved atomically")
| Err e -> println("save failed: " + e.message);
```

**How it works.** `writeAtomic` returns a `Response`, threading the two fallible steps: if the
temp write fails it returns that `Err` and never touches the destination; only on success does it
`rename` the temp file onto the target and return rename's `Response`. Because `rename` within one
filesystem is atomic, concurrent readers of `path` always see a complete file. `tempFilePath`
derives a sibling temp name (so the rename stays on the same filesystem); place the temp next to the
target rather than in `/tmp`, which may be a different device where rename would fall back to a
non-atomic copy.

---

### 45. Read and write a JSON config file with defaults for missing keys

Config files should be optional and forgiving: a missing file, an unparseable file, or a file that
omits some keys should all fall back to sensible defaults rather than crash. The corpus's
`json4`/`json5` examples show the core pattern — `readFile` then `jsonDeserialize` (which returns an
`Option`) into a typed record, with a default record for the `None` case. We extend that with
per-key defaulting.

```pfun
import * from "json";

type Config = { host, port, debug };
let defaultConfig = Config(host="localhost", port=8080, debug=false);

// whole-file fallback (the json4 pattern): bad/missing file -> defaults
proc loadConfig(path) {
  match fileExists(path) with
  | Err _ -> defaultConfig
  | Ok found -> if !found.value then defaultConfig else {
      match readFile(path) with
      | Err _ -> defaultConfig
      | Ok c  -> match jsonDeserialize(c.value) with
        | Some s -> s.value
        | None   -> defaultConfig;
    }
}

proc saveConfig(path, cfg) {
  match jsonSerialize(cfg) with
  | Some s -> writeFile(path, s.value)
  | None   -> Err { "could not serialize config" };
}

let cfg = loadConfig("./config.json");
println("host=" + cfg.host + " port=" + __str__(cfg.port));
```

**How it works.** `loadConfig` returns the default `Config` for every failure mode — absent file,
read error, or `None` from `jsonDeserialize` — and otherwise returns the parsed record. `saveConfig`
serializes with `jsonSerialize` (also `Option`-returning) and writes the JSON string. For *per-key*
defaults (a file that sets only `port`), deserialize into a `dict` instead and fill each missing key
in a `proc`: `if has(loaded, "host") then loaded["host"] else "localhost"`, repeating per key — this
relies on a JSON object deserializing to a `dict`, which is consistent with `dict` being a
first-class type but is not shown verbatim in the corpus (see Appendix B). The typed-record form
above *is* shown and is preferred when the schema is known.

---

### 46. Append to a log file with rotation when it exceeds a size

Long-running services append to a log indefinitely, which eventually fills the disk; rotation caps
each file by renaming it aside once it grows past a threshold. The pieces are the corpus's
`fileOpen(path, Append)` / `writeLine` / `fileClose`, plus the `statSize` and `rename` wrappers
(Appendix A). The size check runs before each append.

```pfun
// statSize : (String) -> Response<Int>     (Appendix A)
proc rotateIfNeeded(path, maxBytes) {
  match fileExists(path) with
  | Err _ -> 0
  | Ok found -> if found.value then {
      match statSize(path) with
      | Ok s  -> if s.value >= maxBytes then { rename(path, path + ".1"); 0 } else 0
      | Err _ -> 0;
    } else 0;
}

proc logLine(path, line, maxBytes) {
  rotateIfNeeded(path, maxBytes);
  match fileOpen(path, Append) with
  | Ok o  -> { writeLine(o.value, line); fileClose(o.value); }
  | Err e -> println("log open failed: " ++ nativeErrorMessage(e.message));
}

logLine("./app.log", "service started", 1048576);   // rotate at 1 MiB
```

**How it works.** `rotateIfNeeded` stats the current log and, if it has reached `maxBytes`, renames
it to `path.1` so the next `fileOpen(path, Append)` starts a fresh empty file. `logLine` rotates,
then opens in append mode, writes one line, and closes the handle. This keeps a single rolled-over
file; for a ring of `app.log.1 … app.log.N` you would cascade the renames (rename `.N-1` to `.N`
downward) before moving the live file — a small recursive `proc` over the index range. Pair this
with the structured-log formatter in Chapter 8 to control what each line contains.

---

### 47. Compress and decompress files (gzip/zip)

Backups, log archival, and network payloads all benefit from compression. Node's `zlib` provides
gzip, exposed here as the `gzipFile`/`gunzipFile` wrappers (Appendix A) for the file-to-file case and
`gzipBytes`/`gunzipBytes` for in-memory data. Each returns a `Response`, so failures surface as
values.

```pfun
// gzipFile / gunzipFile : (String src, String dst) -> Response   (Appendix A, wraps zlib)
proc archive(src) {
  match gzipFile(src, src + ".gz") with
  | Ok _  -> println("compressed -> " + src + ".gz")
  | Err e -> println("gzip failed: " + e.message);
}

proc restore(gzPath, dst) {
  match gunzipFile(gzPath, dst) with
  | Ok _  -> println("restored -> " + dst)
  | Err e -> println("gunzip failed: " + e.message);
}

archive("./app.log");
restore("./app.log.gz", "./app.log.restored");
```

**How it works.** `gzipFile` streams `src` through zlib's gzip and writes the compressed result to
`dst`; `gunzipFile` reverses it. Streaming inside the wrapper means even large files compress with
bounded memory. When you already have the data in memory (for example a JSON string about to be
sent over HTTP), use `gzipBytes(charBytes-or-bytes)` to get back a `List<Byte>` you can hand to
`res.bytes` (Chapter 6) or `writeBytes`. True multi-file `.zip` archives need a richer wrapper
(Appendix A notes the `archiver`/`adm-zip` option); gzip handles the common single-stream case.

---

### 48. Walk a directory tree and compute total size by file type

"How much disk does each file type use under this folder?" combines the recursive walk from Recipe
42 with file sizes and a tally keyed by extension. The walk and sizing are effects; the tally is a
`dict` built in a `proc`. Grouping by extension reuses `pathExtname` (Appendix A).

```pfun
// pathExtname : (String) -> String   (e.g. ".pf"; Appendix A)
proc sizeByExt(dir) {
  var totals = dict {};
  let files = walkDir(dir, fn _ => true);     // walkDir from Recipe 42
  proc loop(fs) {
    if length(fs) == 0 then 0
    else {
      let f   = head(fs);
      let ext = pathExtname(f);
      let sz  = match statSize(f) with | Ok s -> s.value | Err _ -> 0;
      if has(totals, ext) then totals[ext] = totals[ext] + sz else totals[ext] = sz;
      loop(tail(fs));
    }
  }
  loop(files);
  totals;
}

let totals = sizeByExt("./project");
map(fn k => println(k + ": " + __str__(totals[k]) + " bytes"), keys(totals));
```

**How it works.** `walkDir(dir, fn _ => true)` collects every file (the always-true predicate keeps
all of them), and the recursive `loop` adds each file's size into the `totals` dict under its
extension, initializing the bucket on first sight with `has`. The dict accumulation mirrors the
corpus's `countWords`. The `proc` returns the dict, which the caller iterates with `keys`/index. If a
file cannot be stat-ed, its size counts as `0` rather than aborting the scan — appropriate for a
best-effort report.

---

### 49. Copy a directory tree, excluding certain patterns

Deploy scripts and scaffolding tools copy a tree while skipping junk like `node_modules`, `.git`, or
`*.tmp`. This is the recursive walk again, but it *mirrors* structure into a destination, creating
directories with `mkdirP` and copying files with the same read/write pair `example.pf` uses in its
`copyFile`. The exclusion test is a pure predicate.

```pfun
import * from "file";

proc copyFileOnce(src, dst) {
  match readFile(src) with
  | Ok o  -> { match writeFile(dst, o.value) with | Ok _ -> 0 | Err e -> println("write failed: " + e.message); }
  | Err e -> println("read failed: " + e.message);
}

proc copyTree(srcDir, dstDir, exclude) {
  match readDir(srcDir) with
  | Err e -> println("read dir failed: " + e.message)
  | Ok entries -> { mkdirP(dstDir); copyEntries(srcDir, dstDir, entries.value, exclude); };
}
proc copyEntries(srcDir, dstDir, names, exclude) {
  if length(names) == 0 then 0
  else {
    let name = head(names);
    if exclude(name) then 0
    else {
      let src = pathJoin(srcDir, name);
      let dst = pathJoin(dstDir, name);
      if isDirectory(src) then copyTree(src, dst, exclude) else copyFileOnce(src, dst);
    }
    copyEntries(srcDir, dstDir, tail(names), exclude);
  }
}

copyTree("./project", "./backup",
         fn name => name == "node_modules" || name == ".git" || endsWith(name, ".tmp"));
```

**How it works.** `copyTree` ensures the destination directory exists (`mkdirP`) and then walks the
source entries. `copyEntries` skips any name the `exclude` predicate rejects, recurses into
subdirectories (recreating them on the way down), and copies plain files via `copyFileOnce` — which
is `example.pf`'s `copyFile` logic, reading the whole file and writing it back. Because `copyFileOnce`
uses `readFile`/`writeFile`, it is fine for text and modest files; for large or binary files, copy
in chunks with `fileOpen`/`readBytes`/`writeBytes` (the byte-I/O pattern from `example.pf`'s
`byte_io_demo`). The `exclude` predicate keeps the policy declarative and easy to change.

---

### 50. Parse an INI or TOML config file into a structured object

INI files (`key = value` under `[section]` headers) are a common, line-oriented config format that
a pure parser handles cleanly — no FFI required. The parser folds over the lines, tracking the
current section, and returns a list of sections each holding its key/value pairs. It reuses the
`trimStr` helper and the `findSlice` index trick from earlier chapters.

```pfun
function isComment(line) { length(line) == 0 || nth(line, 0) == ';' || nth(line, 0) == '#'; }
function isHeader(line)  { length(line) >= 2 && nth(line, 0) == '[' && nth(line, length(line) - 1) == ']'; }
function headerName(line){ slice(1, length(line) - 2, line); }

// returns a list of Pair { sectionName, entries },  entries : list of Pair { key, value }
function parseIni(text) {
  reverse(iniFold(split(replaceAll(text, "\r\n", "\n"), "\n"), "", [], []));
}
function iniFold(lines, curName, curEntries, done) {
  if length(lines) == 0 then cons(Pair { curName, reverse(curEntries) }, done)
  else {
    let raw  = trimStr(head(lines));
    let rest = tail(lines);
    if isComment(raw) then iniFold(rest, curName, curEntries, done)
    else if isHeader(raw) then
      iniFold(rest, headerName(raw), [], cons(Pair { curName, reverse(curEntries) }, done))
    else match findSlice(raw, "=") with
      | None   -> iniFold(rest, curName, curEntries, done)            // skip malformed
      | Some p -> {
          let key = trimStr(slice(0, p.value, raw));
          let val = trimStr(slice(p.value + 1, length(raw) - p.value - 1, raw));
          iniFold(rest, curName, cons(Pair { key, val }, curEntries), done);
        };
  }
}

let ini = "[server]\nhost = localhost\nport = 8080\n\n[flags]\ndebug = true\n";
let sections = parseIni(ini);
println(map(fn s => s.key + " (" + __str__(length(s.value)) + " keys)", sections));
// ["" (0 keys), "server" (2 keys), "flags" (1 keys)]
```

**How it works.** `iniFold` walks the lines once, carrying the current section name, that section's
accumulated entries (reversed), and the list of completed sections. Comments and blank lines are
skipped; a `[header]` line flushes the current section and starts a new one; any other line is split
at the first `=` (located with `findSlice`'s returned index) into a trimmed key and value. The
leading `Pair { "", [] }` represents keys that appear before any section header (the "global"
section). TOML's richer grammar — typed values, nested tables, arrays — exceeds a line-by-line fold;
parse it either with a fuller recursive-descent parser (the `tiny-lisp.pf` structure scales to this)
or a foreign `tomlParse` wrapper (Appendix A) when you need full TOML fidelity.

---


## Chapter 6 — Networking & HTTP

The `http` module supplies both sides of the wire, and the corpus exercises all of it:

* **Server:** `httpListen(port, handler)` where `handler` is an `async proc handleRequest(req, res)`.
  The request exposes `req.method`, `req.path`, `req.query` (a dict), `req.body` (string), and
  `req.bodyBytes`; the response is written with `res.text(status, s)`, `res.json(status, value)`,
  or `res.bytes(status, bytes, contentType)` (see `server.pf` and `http_example.pf`).
* **Client:** `httpGet(url)`, `httpGetBytes(url)`, and `httpPost(url, value)`, each `await`-ed and
  each returning a `Response` whose `Ok r` carries `r.value.status` and `r.value.body`.

Networking is asynchronous, so client recipes are `async proc`s using `await` and `sleep` from the
`async` module. Capabilities the built-in module does not expose — custom headers, timeouts,
streaming downloads, multipart, URL parsing — are foreign wrappers in **Appendix A**. As always,
keep decisions (what to retry, when to stop polling, what counts as "done") in pure functions and
let the `async proc` perform the I/O.

---

### 51. Make an HTTP GET request and parse a JSON response

Consuming a JSON API is the most common client task: fetch a URL, then turn the body into a usable
value. The corpus's `http_example.pf` already shows `await httpGet(url)` and matching on its
`Response`; we add the `jsonDeserialize` step and fold both fallible operations into a single
`Response` the caller can handle in one place.

```pfun
import * from "io";
import * from "async";
import * from "http";
import * from "json";

async proc fetchJson(url) {
  match await httpGet(url) with
  | Err e -> Err e
  | Ok r  -> match jsonDeserialize(r.value.body) with
    | Some v -> Ok { v.value }
    | None   -> Err { "invalid JSON from " + url };
}

async proc demo() {
  match await fetchJson("http://localhost:7999/greet?name=Pfun") with
  | Ok v  -> println("parsed ok")
  | Err e -> println("fetch failed: " + e.message);
}
demo();
```

**How it works.** `fetchJson` first awaits the GET; a transport failure short-circuits as `Err e`.
On success it feeds `r.value.body` to `jsonDeserialize`, which returns an `Option`, and re-wraps the
two outcomes as `Ok { value }` or a descriptive `Err`. Collapsing "network error" and "bad JSON"
into one `Response` means callers write a single `match` instead of nesting two. The function is an
`async proc` because it performs I/O, but notice the decision logic ("invalid JSON") is trivial and
could be lifted into a pure helper if it grew.

---

### 52. POST JSON data to an API with auth headers

Most real APIs require an `Authorization` header and a `Content-Type`, but the built-in
`httpPost(url, value)` does not take headers. We therefore call the `httpPostJson` wrapper (Appendix
A), which accepts a header dict and serializes the body. The headers are ordinary data — a `dict` —
so they are easy to build conditionally.

```pfun
// httpPostJson : (String url, Dict headers, value) -> Response<{ status, body }>   (Appendix A)
async proc createWidget(token, widget) {
  let headers = dict {
    "Authorization" -> "Bearer " + token,
    "Content-Type"  -> "application/json"
  };
  match await httpPostJson("https://api.example.com/widgets", headers, widget) with
  | Ok r  -> if r.value.status == 201 then Ok { r.value.body } else Err { "unexpected status " + __str__(r.value.status) }
  | Err e -> Err e;
}
```

**How it works.** The `headers` dict carries the bearer token and content type; `httpPostJson`
serializes `widget` to a JSON body, attaches the headers, and performs the POST, returning a
`Response` with the status and body. The recipe treats only `201 Created` as success and turns any
other status into an `Err`, so the caller's `match` distinguishes "created" from "server said no"
from "network failed." Build the header dict conditionally (omit `Authorization` for anonymous
calls) — because it is just a value, no special API is needed.

---

### 53. Handle HTTP retries with exponential backoff

Transient failures (a flaky network, a brief 503) are best handled by retrying a few times with
increasing delays so you neither give up too soon nor hammer a struggling server. The exemplary
Pfun design separates the **policy** (a pure list of delays) from the **mechanism** (an `async proc`
that performs the action and sleeps between attempts) — the same "describe, then interpret" split
as TEA's `Cmd`.

```pfun
// pure: the backoff schedule is just data
function backoffDelays(base, factor, attempts) {
  if attempts <= 0 then [] else cons(base, backoffDelays(base * factor, factor, attempts - 1));
}

// mechanism: run `action` (an async proc returning a Response), retrying per the schedule
async proc withRetries(action, delays) {
  match await action() with
  | Ok r  -> Ok { r.value }
  | Err e -> if length(delays) == 0 then Err e
             else { await sleep(head(delays)); await withRetries(action, tail(delays)); };
}

async proc demo() {
  let schedule = backoffDelays(100, 2, 5);     // [100, 200, 400, 800, 1600] ms
  match await withRetries(fn () => httpGet("http://localhost:7999/flaky"), schedule) with
  | Ok r  -> println("succeeded: " + r.value.status)
  | Err e -> println("gave up: " + e.message);
}
demo();
```

**How it works.** `backoffDelays` produces the delay schedule as a plain list — `base`, then
`base*factor`, and so on — which you can inspect, test, or cap without running anything.
`withRetries` calls `action`, returns immediately on `Ok`, and on `Err` either gives up (no delays
left) or sleeps for the head delay and recurses on the tail. Passing `action` as a zero-argument
function value (`fn () => httpGet(...)`) lets the retry loop re-invoke it; this leans on procedures
being first-class values (as in `proctest.pf`) and on `await`-ing the returned promise. Because the
schedule is data, switching to jittered or capped backoff means changing one pure function, not the
control flow.

---

### 54. Download a large file in chunks and show progress

A large download must not be buffered entirely in memory, and users want a progress indicator. The
`httpDownload` wrapper (Appendix A, over Node's streaming HTTP and `fs`) streams the response
straight to disk and invokes a progress `proc` as bytes arrive. The reaction to progress is your
code; the streaming is the wrapper's job.

```pfun
// httpDownload : (String url, String destPath, proc(p) onProgress) -> Response   (Appendix A)
// p : { received, total }   (total may be 0 if the server sends no Content-Length)
proc onProgress(p) {
  if p.total > 0 then println(percentLabel(p.received, p.total))    // percentLabel from Chapter 2
  else println(__str__(p.received) + " bytes...");
}

async proc download(url, dest) {
  match await httpDownload(url, dest, onProgress) with
  | Ok _  -> println("saved to " + dest)
  | Err e -> println("download failed: " + e.message);
}
download("https://example.com/big.iso", "./big.iso");
```

**How it works.** `httpDownload` opens the response as a stream and pipes it to the destination
file, calling `onProgress` with a running `{ received, total }` after each chunk; memory stays
bounded no matter how large the file. The progress display reuses Chapter 2's `percentLabel`,
illustrating how pure formatting plugs into an effectful callback. If the server omits a
`Content-Length`, `total` is `0` and we fall back to showing raw bytes — handle the unknown-total
case explicitly rather than dividing by zero.

---

### 55. Set timeouts on HTTP requests and handle them gracefully

A request to a hung server must not hang your program forever; every outbound call needs a deadline.
The `httpRequest` wrapper (Appendix A) takes a request record that includes `timeoutMs` and turns a
timeout into an ordinary `Err`, so a slow dependency degrades to a handled value instead of a stuck
coroutine.

```pfun
// httpRequest : (HttpReq) -> Response<{ status, headers, body }>   (Appendix A)
// HttpReq = { method, url, headers, body, timeoutMs }
async proc getWithTimeout(url, ms) {
  let req = HttpReq { "GET", url, dict {}, "", ms };
  match await httpRequest(req) with
  | Ok r  -> Ok { r.value.body }
  | Err e -> Err { "request to " + url + " failed: " + e.message };
}

async proc demo() {
  match await getWithTimeout("http://localhost:7999/slow", 500) with
  | Ok body -> println("got " + __str__(length(body.value)) + " bytes")
  | Err e   -> println(e.message);     // includes "timed out" when the deadline is hit
}
demo();
```

**How it works.** The `HttpReq` record bundles everything about the call, including `timeoutMs`; the
wrapper arms a timer and aborts the request if the deadline passes, reporting it as `Err` with a
timeout message. The caller handles a timeout exactly like any other failure — one `match` arm — so
graceful degradation (serve a cached value, show a fallback) is uniform. For a generic
"time-out *any* slow operation," see the `withTimeout` combinator in Chapter 9, Recipe 72.

---

### 56. Parse and construct URLs (query params, path segments)

Building a URL by string-concatenating query parameters invites injection and encoding bugs;
parsing one by hand is worse. For construction, a small pure builder over `Pair`s plus the
`urlEncode` wrapper (percent-encoding via `encodeURIComponent`) is enough; for parsing, the
`urlParse` wrapper (Node's `URL`) returns a structured record. Both are in Appendix A.

```pfun
// urlEncode : (String) -> String        urlParse : (String) -> Response<{ scheme, host, port, path, query }>
function buildQuery(params) {
  join(map(fn p => urlEncode(p.key) + "=" + urlEncode(p.value), params), "&");
}
function buildUrl(base, params) {
  if length(params) == 0 then base else base + "?" + buildQuery(params);
}

let url = buildUrl("https://api.example.com/search",
                   [ Pair { "q", "blue widgets" }, Pair { "page", "2" } ]);
println(url);   // https://api.example.com/search?q=blue%20widgets&page=2

match urlParse(url) with
| Ok u  -> println("host=" + u.value.host + " path=" + u.value.path)
| Err e -> println("bad url: " + e.message);
```

**How it works.** `buildQuery` maps each `Pair` to a percent-encoded `key=value` and joins with
`&`; `buildUrl` appends the query string only when there are parameters. Encoding every key and value
through `urlEncode` keeps spaces, ampersands, and Unicode safe. `urlParse` does the inverse,
returning the scheme, host, port, path, and query as a record so you can route on `path` or read
individual query values without fragile string surgery. The construction half is pure and testable;
only `urlEncode`/`urlParse` cross into foreign code.

---

### 57. Scrape a table from an HTML page

Extracting tabular data from a web page means fetching the HTML and walking its DOM — work for a
real parser, not a regex, because HTML nesting defeats regular expressions. The `htmlParseTable`
wrapper (Appendix A, over `jsdom`/`cheerio`) returns a table as a list of rows, each a list of cell
strings, which then flows through the ordinary list tools.

```pfun
// htmlParseTable : (String html, String selector) -> List<List<String>>   (Appendix A)
async proc scrapeTable(url, selector) {
  match await httpGet(url) with
  | Err e -> { println("fetch failed: " + e.message); []; }
  | Ok r  -> htmlParseTable(r.value.body, selector);
}

async proc demo() {
  let rows = await scrapeTable("https://example.com/prices", "table#prices");
  map(fn row => println(join(row, " | ")), rows);
}
demo();
```

**How it works.** `scrapeTable` fetches the page with `httpGet` and passes the body and a CSS
selector to `htmlParseTable`, which parses the document, finds the matching `<table>`, and returns
its rows and cells as nested lists of strings. From there it is plain Pfun: `map` over rows,
`join` cells, `filter` out headers, or feed the data into the database recipes of Chapter 7. Keeping
the messy DOM work behind one wrapper means your scraping logic is just list processing — pure and
testable once you have the rows.

---

### 58. Poll an endpoint until a condition is met or a timeout occurs

Asynchronous jobs often expose a status endpoint you must poll until it reports "done" — but never
forever. The robust loop checks a **pure** predicate against each response, sleeps between attempts,
and gives up once a deadline computed from `now()` passes. Policy (the predicate, the interval) is
data; the loop is the mechanism.

```pfun
async proc pollUntil(url, isDone, intervalMs, deadlineMs) {
  match await httpGet(url) with
  | Ok r  -> if isDone(r.value.body) then Ok { r.value.body }
             else if now() >= deadlineMs then Err { "timed out polling " + url }
             else { await sleep(intervalMs); await pollUntil(url, isDone, intervalMs, deadlineMs); }
  | Err e -> if now() >= deadlineMs then Err e
             else { await sleep(intervalMs); await pollUntil(url, isDone, intervalMs, deadlineMs); };
}

async proc waitForJob(url) {
  let deadline = now() + 30000;                          // 30s budget; now() from Appendix A
  match await pollUntil(url, fn body => hasSub(body, "\"status\":\"done\""), 1000, deadline) with
  | Ok _  -> println("job finished")
  | Err e -> println(e.message);
}
```

**How it works.** `pollUntil` GETs the URL, applies the pure `isDone` predicate to the body, and
returns `Ok` the moment the condition holds. Otherwise it compares `now()` against the precomputed
`deadlineMs`, returning `Err` if the budget is spent or sleeping `intervalMs` and recursing if not —
and it treats transport errors the same way, retrying until the deadline. The caller computes the
deadline once as `now() + budget` so the timeout is absolute, not per-attempt. The "done" test
(`hasSub` from Chapter 1) is a pure function you can unit-test against sample bodies with no network
at all.

---

### 59. Send a multipart form upload (file + fields)

Uploading a file alongside text fields uses `multipart/form-data`, whose boundary formatting is
fiddly to hand-roll. The `httpPostMultipart` wrapper (Appendix A, over the `form-data` package)
takes the fields and files as plain data and builds the request body correctly, streaming file
contents from disk.

```pfun
// httpPostMultipart : (String url, List<Pair> fields, List<FilePart> files) -> Response<{ status, body }>
// FilePart = { fieldName, filePath }       (Appendix A)
async proc uploadReport(url, title, path) {
  let fields = [ Pair { "title", title }, Pair { "visibility", "private" } ];
  let files  = [ FilePart { "document", path } ];
  match await httpPostMultipart(url, fields, files) with
  | Ok r  -> if r.value.status == 200 then Ok { "uploaded" } else Err { "status " + __str__(r.value.status) }
  | Err e -> Err e;
}
uploadReport("https://example.com/upload", "Q3 Report", "./q3.pdf");
```

**How it works.** The text fields are a list of `Pair { name, value }` and each file is a `FilePart`
naming a form field and a path on disk; `httpPostMultipart` assembles the multipart body — generating
the boundary, setting `Content-Type`, and streaming each file — and performs the POST. The server
sees a normal multipart form (the corpus's `/upload` handler in `http_example.pf` reads
`req.bodyBytes`). Because fields and files are ordinary lists, building an upload conditionally
(optional fields, several files) is just list construction.

---

### 60. Validate and normalize an email address

Before storing or comparing email addresses you should normalize them (trim surrounding spaces,
lowercase the domain) and reject obviously invalid ones. Normalization is pure string work; the
structural check is a regular expression via `regexTest` (Appendix A). Doing both keeps your data
consistent and your "is this an email?" rule in one place.

```pfun
function lowerCharC(c) { let k = asc(c); if k >= 65 && k <= 90 then chr(k + 32) else c; }
function toLowerStr(s) { map(lowerCharC, s); }

function normalizeEmail(s) { toLowerStr(trimStr(s)); }            // trimStr from Chapter 5
function isValidEmail(s)   { regexTest(@"^[^@\s]+@[^@\s]+\.[^@\s]+$", "", s); }

let raw = "  Alice@Example.COM  ";
let norm = normalizeEmail(raw);
println(norm);                     // "alice@example.com"
println(isValidEmail(norm));       // true
println(isValidEmail("nope@"));    // false
```

**How it works.** `normalizeEmail` trims whitespace (Chapter 5's `trimStr`) and lowercases every
character (`map` over the string yields chars), giving a canonical form so `alice@example.com` and
`Alice@Example.COM` compare equal. `isValidEmail` applies a deliberately simple pattern — one
`@`, a dot in the domain, no spaces — through `regexTest`, which returns a plain `Bool`. Email
validation is famously impossible to do perfectly with a regex; this catches the overwhelming
majority of typos, and true deliverability can only be confirmed by sending mail. Keep the pattern
in a raw string so its backslashes survive intact.

---


## Chapter 7 — Databases

The corpus ships two real database drivers, `db/postgresql` and `db/mariadb`, with an identical API
(only the placeholder style differs — Postgres `$1` versus MariaDB `?`). The examples in
`dblibPostgresql.example.pf` and the schema tooling in `dbschema*.pf` establish the conventions used
throughout this chapter:

* `await dbConnect(connString)` → `Response<Connection>`; `await dbClose(conn)` → `Response`.
* `await dbQuery(conn, sql, params)` → `Response<{ rowCount, rows }>`. `params` is a list of typed
  values: `DbText`, `DbInt`, `DbFloat`, `DbBool`, `DbBytes`, `DbNull`.
* Each row is a **list of `Pair { key, value }`** where `key` is the column name and `value` is one
  of the `Db*` variants — so reading a column means matching that variant. `dbschema.pf` provides
  the reusable accessors `getStr`/`getBool`/`getOptStr`, and `dbschema_gen.pf` shows `getInt`/`getFloat`.

For brevity these recipes assume a `conn`; in a full program it comes from the connect/close
sandwich the corpus demonstrates:

```pfun
import * from "io";
import * from "async";
import * from "db/postgresql";

// reusable row accessors (from dbschema.pf / dbschema_gen.pf)
function getStr(row, col) { let ps = filter(fn p => p.key == col, row);
  if length(ps) == 0 then "" else match head(ps).value with | DbText t -> t.value | DbNull -> "" | _ -> ""; }
function getInt(row, col) { let ps = filter(fn p => p.key == col, row);
  if length(ps) == 0 then 0 else match head(ps).value with | DbInt n -> n.value | DbNull -> 0 | _ -> 0; }

async proc withConn(connStr, body) {
  match await dbConnect(connStr) with
  | Err e -> println("connect failed: " + e.message)
  | Ok c  -> { await body(c.value); let _ = await dbClose(c.value); 0; };
}
```

The recipes pair a **pure SQL/parameter builder** with an **effectful `dbQuery`**, the database
analogue of "decide in the core, act in the wrapper."

---

### 61. Insert a batch of records efficiently

Inserting rows one statement at a time means one network round-trip per row, which is painfully slow
for bulk loads. A single multi-row `INSERT … VALUES (…),(…),(…)` collapses them into one round-trip.
The placeholder string and the flat parameter list are produced by **pure** builders (echoing
`dbschema_gen.pf`'s `genPlaceholders`), then handed to `dbQuery`.

```pfun
function rangeIncl(lo, hi) { if lo > hi then [] else cons(lo, rangeIncl(lo + 1, hi)); }

// "($1, $2), ($3, $4), ..." for rowCount rows of colCount columns each
function placeholdersFor(rowCount, colCount) {
  join(map(fn r =>
    "(" + join(map(fn c => "$" + __str__(r * colCount + c + 1), rangeIncl(0, colCount - 1)), ", ") + ")",
    rangeIncl(0, rowCount - 1)), ", ");
}

async proc insertUsers(conn, users) {                 // users: records { name, balance }
  if length(users) == 0 then Ok { 0 }
  else {
    let cols = ["name", "balance"];
    let sql  = "INSERT INTO users (" + join(cols, ", ") + ") VALUES " +
               placeholdersFor(length(users), length(cols));
    let params = reduce(fn acc, u => acc + [DbText { u.name }, DbFloat { u.balance }], [], users);
    await dbQuery(conn, sql, params);
  };
}
```

**How it works.** `placeholdersFor` generates the `($1, $2), ($3, $4) …` tuple list, numbering each
placeholder by its position so it lines up with a flattened parameter array. The parameters are
built by folding each record into two typed values (`DbText`, `DbFloat`) and concatenating, in the
same order. One `dbQuery` then inserts every row. For very large batches, chunk the input with
Chapter 4's `chunk` and insert each chunk (databases cap the number of parameters per statement) —
`map(insertChunk, chunk(users, 500))` keeps each statement within limits.

---

### 62. Upsert a record (insert or update if it exists)

"Insert this row, or update it if the key already exists" is the upsert, and doing it as two
statements (SELECT then INSERT/UPDATE) races under concurrency. PostgreSQL's
`INSERT … ON CONFLICT … DO UPDATE` performs it atomically in one statement, with `EXCLUDED`
referring to the values you tried to insert.

```pfun
async proc upsertCustomer(conn, id, name, email) {
  let sql =
    "INSERT INTO customers (id, name, email) VALUES ($1, $2, $3) " +
    "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email";
  match await dbQuery(conn, sql, [DbInt { id }, DbText { name }, DbText { email }]) with
  | Ok r  -> { println("upserted " + __str__(r.value.rowCount) + " row(s)"); Ok { r.value.rowCount }; }
  | Err e -> Err e;
}
```

**How it works.** The single statement attempts the insert; if a row with the same primary key
exists, the `ON CONFLICT (id)` clause turns it into an update of the named columns using the
would-be-inserted values (`EXCLUDED.*`). Because the database resolves the conflict internally, two
concurrent upserts cannot both insert a duplicate or clobber each other half-way. On MariaDB the
equivalent is `INSERT … ON DUPLICATE KEY UPDATE` with `?` placeholders — the surrounding Pfun is
identical, only the SQL dialect changes.

---

### 63. Paginate through a large result set using cursor-based pagination

`OFFSET`-based paging gets slower as the offset grows and can skip or repeat rows when data changes
between pages. Cursor (keyset) pagination instead remembers the last key seen and asks for rows
*after* it — constant time per page and stable under inserts. Each page is one `dbQuery`; a small
loop walks the cursor forward.

```pfun
async proc fetchPage(conn, afterId, limit) {
  await dbQuery(conn,
    "SELECT id, name FROM customers WHERE id > $1 ORDER BY id LIMIT $2",
    [DbInt { afterId }, DbInt { limit }]);
}

async proc forEachPage(conn, afterId, limit, onRow) {
  match await fetchPage(conn, afterId, limit) with
  | Err e -> println("page failed: " + e.message)
  | Ok r  -> {
      if length(r.value.rows) == 0 then 0
      else {
        map(onRow, r.value.rows);
        let lastId = getInt(nth(r.value.rows, length(r.value.rows) - 1), "id");
        await forEachPage(conn, lastId, limit, onRow);   // advance the cursor
      }
    };
}

// drive it: start before the first id, 100 rows per page
async proc demo(conn) { await forEachPage(conn, 0, 100, fn row => println(getStr(row, "name"))); }
```

**How it works.** `fetchPage` selects rows whose `id` is strictly greater than the cursor, ordered by
`id`, capped by `limit`. `forEachPage` processes the page, reads the last row's `id` as the new
cursor, and recurses until a page comes back empty. Because the `WHERE id > $1` uses the indexed
primary key, every page costs the same regardless of how deep you are, and rows inserted with larger
ids simply appear on later pages. The cursor must be a unique, monotonic column (here the serial
`id`); for composite ordering, carry a tuple cursor and compare lexicographically.

---

### 64. Run a query with dynamic filters built at runtime

Search screens compose a query from whichever filters the user supplied — name, minimum balance,
active flag — in any combination. Building that SQL by string concatenation with inline values is a
SQL-injection waiting to happen. The safe, idiomatic approach makes each filter a **data variant**
and folds them into a parameterized `WHERE` clause plus a matching parameter list, entirely in pure
code.

```pfun
type Filter = { | ByName : v | ByMinBalance : v | ByActive : v }
type QB     = { clauses, params, n }

function applyFilter(qb, f) {
  match f with
  | ByName v       -> QB { qb.clauses + ["name = $"     + __str__(qb.n)], qb.params + [DbText  { v.v }], qb.n + 1 }
  | ByMinBalance v -> QB { qb.clauses + ["balance >= $" + __str__(qb.n)], qb.params + [DbFloat { v.v }], qb.n + 1 }
  | ByActive v     -> QB { qb.clauses + ["active = $"   + __str__(qb.n)], qb.params + [DbBool  { v.v }], qb.n + 1 };
}

// pure: filters -> Pair { sql, params }
function buildQuery(base, filters) {
  let qb = reduce(applyFilter, QB { [], [], 1 }, filters);
  let where = length(qb.clauses) == 0 ? "" : " WHERE " + join(qb.clauses, " AND ");
  Pair { base + where, qb.params };
}

async proc search(conn, filters) {
  let q = buildQuery("SELECT name, balance FROM users", filters);
  await dbQuery(conn, q.key, q.value);          // q.key = SQL, q.value = params
}

// search(conn, [ ByMinBalance { 0.0 }, ByActive { true } ])
```

**How it works.** Each `Filter` variant knows its own SQL fragment and parameter type. `applyFilter`
folds one filter into the `QB` accumulator, appending a `column = $n` clause, the correctly-typed
parameter, and incrementing the placeholder counter `n` so numbers and parameters stay in lockstep.
`buildQuery` assembles the final SQL and returns it with the parameter list as a `Pair` — a complete
*description* of the query that you can log or test without a database. Only `search` touches the
connection. Because values only ever travel as `Db*` parameters, never interpolated text, the query
is injection-safe by construction.

---

### 65. Use a transaction to ensure two operations succeed or both fail

A funds transfer must debit one account and credit another *atomically* — if the second update
fails, the first must be undone. Wrapping the statements in `BEGIN` / `COMMIT`, with a `ROLLBACK` on
any error, guarantees all-or-nothing. The `Response` from each step drives the decision to commit or
roll back.

```pfun
async proc transfer(conn, fromId, toId, amount) {
  match await dbQuery(conn, "BEGIN", []) with
  | Err e -> Err e
  | Ok _  -> {
      let debit = await dbQuery(conn,
        "UPDATE accounts SET balance = balance - $1 WHERE id = $2", [DbFloat { amount }, DbInt { fromId }]);
      match debit with
      | Err e -> { let _ = await dbQuery(conn, "ROLLBACK", []); Err e; }
      | Ok _  -> {
          let credit = await dbQuery(conn,
            "UPDATE accounts SET balance = balance + $1 WHERE id = $2", [DbFloat { amount }, DbInt { toId }]);
          match credit with
          | Err e -> { let _ = await dbQuery(conn, "ROLLBACK", []); Err e; }
          | Ok _  -> await dbQuery(conn, "COMMIT", []);
        };
    };
}
```

**How it works.** `BEGIN` opens the transaction; the debit and credit run inside it. If either
`dbQuery` returns `Err`, the code issues `ROLLBACK` and propagates the error, so the database is left
exactly as it was before `BEGIN`. Only when both updates succeed does `COMMIT` make them permanent.
The nesting here is real but mechanical; Chapter 8, Recipe 78 shows an `andThen` helper that flattens
these `Response` chains into a linear pipeline, which is worth adopting once a transaction has more
than two steps.

---

### 66. Soft-delete a record (mark as deleted, don't remove)

Audit requirements and "undo" features often forbid truly deleting rows; instead you mark them
deleted and exclude them from normal queries. A nullable `deleted_at` timestamp is the usual design:
deleting sets it, and every read filters `WHERE deleted_at IS NULL`. The database stamps the time, so
no clock access is needed in Pfun.

```pfun
async proc softDelete(conn, id) {
  await dbQuery(conn, "UPDATE customers SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL",
                [DbInt { id }]);
}

async proc listActive(conn) {
  await dbQuery(conn, "SELECT id, name FROM customers WHERE deleted_at IS NULL ORDER BY id", []);
}

async proc restore(conn, id) {
  await dbQuery(conn, "UPDATE customers SET deleted_at = NULL WHERE id = $1", [DbInt { id }]);
}
```

**How it works.** `softDelete` sets `deleted_at` to the server's `now()` only if the row is not
already deleted (the extra `AND deleted_at IS NULL` makes it idempotent). Every read path — here
`listActive` — filters out soft-deleted rows, so they vanish from the application's view while
remaining in the table for audit and recovery. `restore` simply nulls the column. Add a
`WHERE deleted_at IS NULL` to your unique indexes (as a partial index) if you want to allow a new row
to reuse the email of a soft-deleted one.

---

### 67. Migrate a schema column (add, rename, or drop safely)

Schema migrations must be *idempotent* — safe to run twice — and should not fail if a column already
exists or is already gone. The reusable `dbschema.pf` library can introspect the live schema, so a
migration can check the current state before issuing `ALTER TABLE`. This reuses `loadColumns`, which
returns the table's columns as `Column` records.

```pfun
import * from "../dbschema";    // loadColumns, Column, ColsOk/ColsErr

async proc ensureColumn(conn, schema, table, colName, colDef) {
  match await loadColumns(conn, schema, table) with
  | ColsErr e -> println("introspect failed: " + e.message)
  | ColsOk c  -> {
      let present = length(filter(fn col => col.name == colName, c.columns)) > 0;
      if present then println(colName + " already present")
      else match await dbQuery(conn, "ALTER TABLE " + schema + "." + table +
                                      " ADD COLUMN " + colName + " " + colDef, []) with
        | Ok _  -> println("added column " + colName)
        | Err e -> println("add failed: " + e.message);
    };
}

// ensureColumn(conn, "public", "customers", "deleted_at", "TIMESTAMP")
```

**How it works.** `loadColumns` queries `information_schema.columns` and returns `ColsOk { columns }`;
the migration checks whether `colName` is among them before adding it, so re-running the migration is
a no-op rather than an error. The same shape covers the other operations: guard a `RENAME COLUMN`
with a check that the *old* name still exists (and the new one does not), and use
`DROP COLUMN IF EXISTS` for drops. Performing the check in code keeps migrations safe even on
databases (or against object types) where `IF NOT EXISTS` is unavailable. Pair this with
`dbschema_utils.pf`'s schema fingerprint to detect drift, as `dbschema_demo.pf` does.

---

### 68. Find duplicate rows by a set of fields

Data cleanups need to surface rows that share a value that should be unique — duplicate emails,
repeated SKUs. `GROUP BY` on the candidate key with `HAVING COUNT(*) > 1` returns exactly the
offending groups and how many rows each has. The result is processed with the standard row
accessors.

```pfun
async proc findDuplicateEmails(conn) {
  match await dbQuery(conn,
    "SELECT email, COUNT(*) AS n FROM customers GROUP BY email HAVING COUNT(*) > 1 ORDER BY n DESC",
    []) with
  | Err e -> println("query failed: " + e.message)
  | Ok r  -> {
      if length(r.value.rows) == 0 then println("no duplicates")
      else map(fn row => println(getStr(row, "email") + " x" + __str__(getInt(row, "n"))), r.value.rows);
    };
}
```

**How it works.** Grouping by `email` collapses identical addresses into one group, `COUNT(*)` counts
the rows per group, and `HAVING COUNT(*) > 1` keeps only the groups with collisions. Each result row
has the duplicated value and its count, read back with `getStr`/`getInt`. To dedupe by a *combination*
of fields, list them all in the `GROUP BY` (e.g. `GROUP BY first_name, last_name, dob`). Once you have
the duplicate keys, a follow-up query selecting the full rows with `ORDER BY` lets you choose which
copy to keep.

---

### 69. Store and query JSON/blob data in a relational DB

Sometimes a row needs a flexible, schemaless payload alongside its structured columns — event
metadata, user preferences, API snapshots. PostgreSQL's `jsonb` column (which `dbschema.pf` already
recognizes as `PgJsonb`) stores it efficiently and lets you query inside it. Pfun serializes the
value with `jsonSerialize` and stores the text; queries use the `->>` operators.

```pfun
import * from "json";

async proc recordEvent(conn, kind, payload) {
  let json = match jsonSerialize(payload) with | Some s -> s.value | None -> "{}";
  await dbQuery(conn, "INSERT INTO events (kind, data) VALUES ($1, $2::jsonb)",
                [DbText { kind }, DbText { json }]);
}

async proc eventsOnPlan(conn, plan) {
  await dbQuery(conn,
    "SELECT id, data->>'user' AS who FROM events WHERE data->>'plan' = $1 ORDER BY id",
    [DbText { plan }]);
}
```

**How it works.** `recordEvent` turns any Pfun value into a JSON string with `jsonSerialize` and binds
it as text, with `$2::jsonb` casting it to a `jsonb` column on the way in. `eventsOnPlan` reaches into
the stored JSON with `->>` (which extracts a field as text), both to filter (`data->>'plan' = $1`) and
to project (`data->>'user'`). The extracted values come back as ordinary text columns, read with
`getStr`. Index the JSON paths you query often (`CREATE INDEX … ON events ((data->>'plan'))`) so these
lookups stay fast. The same `DbBytes` parameter type stores raw binary blobs when the payload is not
JSON.

---

### 70. Seed a database with test data from a fixture file

Tests and demos need a known starting dataset, best kept in a JSON fixture file under version
control rather than hard-coded. Seeding reads the fixture (`readFile` + `jsonDeserialize`) and feeds
the records to the batch insert from Recipe 61 — composing two recipes into a tiny, repeatable setup
step.

```pfun
import * from "file";

async proc seedUsers(conn, fixturePath) {
  match readFile(fixturePath) with
  | Err e -> println("read failed: " + e.message)
  | Ok c  -> match jsonDeserialize(c.value) with
    | None   -> println("fixture is not valid JSON")
    | Some d -> {
        let users = d.value;                          // list of { name, balance } records
        match await insertUsers(conn, users) with     // insertUsers from Recipe 61
        | Ok _  -> println("seeded " + __str__(length(users)) + " users")
        | Err e -> println("seed failed: " + e.message);
      };
}

// fixture users.json: [ { "name": "Alice", "balance": 12.5 }, { "name": "Bob", "balance": 0.0 } ]
```

**How it works.** `seedUsers` reads the fixture file, deserializes it into a list of records, and
hands that list to `insertUsers`, which performs a single batch insert. Every step that can fail
returns a value (`Response`/`Option`) that is matched, so a missing or malformed fixture produces a
clear message rather than a crash. Keeping fixtures as JSON means non-programmers can edit them and
they diff cleanly in code review; truncate the tables first (or wrap the seed in a transaction from
Recipe 65) if you need a pristine state every run.

---


## Chapter 8 — Error Handling & Resilience

Pfun has **no exceptions at the language level**. Failure is a value: `Option` for "might be
absent" and `Response` (`Ok` / `Err`) for "might fail." The foreign interface is what converts a
thrown JavaScript exception into an `Err { message }` at the boundary, so once you are inside Pfun
you are always handling a value, never catching a throw. This makes error paths explicit and
type-checked — you cannot read `o.value` from a `Response` without first matching `Ok`.

One corpus-derived idiom shapes this whole chapter. Because reusing a single generic union (like
`Option` or `Response`) across many different payload types in one module can run into
monomorphization/unification limits, `dbschema_gen.pf` deliberately generates **specialized result
unions** — `InsertCustomerResult`, `FindOrderResult`, and so on — each with its own `Ok`/`Err`
variants. Its comments say it plainly: *"avoids Option monomorphism"* and *"Per-table result types
to avoid monomorphism unification."* So the idiomatic way to model a domain error in Pfun is often a
small named union rather than a reused generic one (see Appendix B for the full caveat). You will
see that pattern below.

---

### 71. Retry a flaky operation N times before giving up

Some operations fail intermittently — a momentarily-locked row, a transient socket error — and
simply trying again often succeeds. A bounded retry attempts the action up to `N` times and returns
the first success or the last failure, so a transient glitch is invisible while a persistent fault
still surfaces. This is the no-delay sibling of Chapter 6's backoff retry.

```pfun
async proc retry(action, n) {
  match await action() with
  | Ok r  -> Ok { r.value }
  | Err e -> if n <= 1 then Err e else await retry(action, n - 1);
}

async proc demo(conn) {
  match await retry(fn () => dbQuery(conn, "SELECT 1", []), 3) with
  | Ok _  -> println("ok")
  | Err e -> println("failed after retries: " + e.message);
}
```

**How it works.** `retry` invokes the zero-argument action, returns immediately on `Ok`, and on
`Err` either gives up when the attempt budget is exhausted (`n <= 1`) or recurses with one fewer
attempt. Passing the operation as a function value (`fn () => …`) lets the loop re-run it. For a
struggling dependency, add the backoff schedule from Recipe 53 so retries are spaced out; the
structure is the same, with a `sleep` before the recursive call. Only retry operations that are safe
to repeat (idempotent) — retrying a non-idempotent POST can double-charge a customer.

---

### 72. Time out a slow function call

An operation that normally takes milliseconds but occasionally hangs will stall everything waiting on
it; every potentially-slow call needs an upper bound. The `withTimeout` wrapper (Appendix A) races an
async action against a timer and returns an `Err` if the timer wins, converting "hangs forever" into
"fails in a bounded time" — a value you can handle.

```pfun
// withTimeout : (proc() action, Int ms) -> Response   (Appendix A; races action vs. a timer)
async proc slowOp() { await sleep(5000); Ok { "eventually" }; }

async proc demo() {
  match await withTimeout(fn () => slowOp(), 1000) with
  | Ok r  -> println("got: " + r.value)
  | Err e -> println("aborted: " + e.message);     // "timed out after 1000ms"
}
demo();
```

**How it works.** `withTimeout` starts the action and a timeout timer; whichever settles first
decides the result, and a timeout becomes `Err { "timed out after …" }`. Because the outcome is an
ordinary `Response`, the caller treats a timeout like any other failure — fall back, retry, or report
it. Note an important limitation of the single-threaded model: the timer *abandons waiting* on the
slow action, but it cannot forcibly stop CPU-bound JavaScript that never yields; timeouts work for
I/O-bound waits (network, disk, `sleep`). For genuinely cancelable work, the underlying operation
must support cancellation (e.g. an HTTP abort signal, as in Recipe 55).

---

### 73. Catch, log, and re-raise an exception with added context

A low-level error like `connection reset` is useless without context — *which* operation, for *which*
input, failed. In a value-based world, "re-raising with context" means **enriching the `Err` and
returning it**, optionally logging on the way. The pure `withContext` helper prepends context to an
error message; the surrounding `proc` adds the logging side effect.

```pfun
function withContext(ctx, result) {
  match result with
  | Ok v  -> Ok { v.value }
  | Err e -> Err { ctx + ": " + e.message };
}

async proc loadUser(conn, id) {
  let r = await dbQuery(conn, "SELECT id, name FROM customers WHERE id = $1", [DbInt { id }]);
  match r with
  | Ok _  -> r
  | Err e -> { emitLog("error", "loadUser failed", [ Pair { "id", __str__(id) }, Pair { "cause", e.message } ]);  // emitLog: Recipe 79
               withContext("loadUser id=" + __str__(id), r); };
}
```

**How it works.** `withContext` rewraps an `Err` with extra prose while passing `Ok` through
untouched, so the error that bubbles up reads `loadUser id=42: connection reset` instead of the bare
driver message. The `proc` logs a structured entry (Recipe 79) for the failure and then returns the
enriched `Response`, so the caller still gets a value to handle — there is no throw to propagate. This
"log here, enrich, return" pattern preserves the full causal chain as messages accumulate context at
each layer, which is exactly what stack traces give you in exception-based languages.

---

### 74. Distinguish between expected errors and programmer bugs

Not all failures are equal: an invalid user input is an *expected* error you must handle gracefully,
whereas indexing past the end of a list you *believed* was non-empty is a *bug* that should crash
loudly so you find and fix it. Pfun encodes this distinction in the types — expected errors are
`Option`/`Response`/named result unions that callers must handle, while bugs are left to fail fast
via partial functions like `head([])`. `dbschema_gen.pf` uses exactly this split.

```pfun
// EXPECTED error: part of the domain, modeled as a result the caller must handle
type ParseAge = { | AgeOk : value | AgeBad : reason }
function parseAge(s) {
  let digitsOnly = length(filter(fn c => asc(c) < asc('0') || asc(c) > asc('9'), s)) == 0;
  if s == "" then AgeBad { "empty" }
  else if !digitsOnly then AgeBad { "not a number: " + s }
  else { let n = parseDigits(s); if n > 150 then AgeBad { "implausible" } else AgeOk { n }; }
}

// PROGRAMMER BUG: an invariant we assert; if it's false, crash (don't paper over it)
function unwrapOrCrash(opt, why) {
  match opt with | Some s -> s.value | None -> { println("BUG: " + why); head([]); };
}
```

**How it works.** `parseAge` returns a `ParseAge` union — `AgeBad` is a normal outcome the caller
must `match`, because untrusted input failing is *expected*. `unwrapOrCrash` is for invariants the
programmer believes always hold: if the `Option` is unexpectedly `None`, it logs the violated
assumption and calls `head([])` to crash, surfacing the bug instead of masking it with a default.
`dbschema_gen.pf` codifies this: its generated `unwrapParse` says *"FK constraint guarantees this is
always valid; parse failure = schema drift,"* and on failure prints a diagnostic and evaluates
`head([])`. The rule of thumb: handle what the outside world can do to you; crash on what your own
code got wrong.

---

### 75. Gracefully degrade when an external service is down

When a non-critical dependency is unavailable, the user experience should soften, not collapse — show
cached prices, a default config, or reduced functionality rather than an error page. Because a failed
call is just an `Err`, degradation is a single `match` arm that substitutes a fallback. This keeps the
"happy path" and the "degraded path" side by side and obvious.

```pfun
async proc getRates(url, cachedRates) {
  match await fetchJson(url) with                 // fetchJson from Chapter 6
  | Ok v  -> v.value
  | Err e -> { emitLog("warn", "rates service down, using cache", [ Pair { "cause", e.message } ]);
               cachedRates; };
}
```

**How it works.** On success the live rates are returned; on any failure the code logs a warning and
returns the `cachedRates` the caller supplied, so downstream logic always receives a usable value and
never has to know the service was down. The decision of *what* the fallback is stays with the caller
(it might be a cache, a constant, or empty data), keeping `getRates` reusable. Combine this with the
circuit breaker (Recipe 77) so that once the service is known to be down you skip the call entirely
and degrade immediately, instead of paying the timeout on every request.

---

### 76. Validate user input and collect all errors before returning

Form validation that stops at the first error frustrates users, who fix one field only to discover
the next. Better validation checks every field and returns *all* problems at once. This is a natural
fit for pure functional accumulation: build a list of error messages, and report success only if the
list is empty. Note this is the opposite of the fail-fast `Response` chaining used elsewhere.

```pfun
type Validated = { | Valid : value | Invalid : errors }

function validateUser(name, email, age) {
  let errs =
      (name == "" ? ["name is required"] : []) +
      (isValidEmail(email) ? [] : ["email is invalid"]) +       // isValidEmail from Chapter 6
      (age < 0 || age > 150 ? ["age out of range"] : []);
  if length(errs) == 0 then Valid { User(name=name, email=email, age=age) } else Invalid { errs };
}

match validateUser("", "bad@", 200) with
| Valid u   -> println("ok")
| Invalid v -> map(println, v.errors);   // prints all three problems
```

**How it works.** Each check contributes either an empty list (passed) or a one-element list (failed),
and `+` concatenates them into a complete error list in one expression. Only when nothing failed does
`validateUser` build the `User` and return `Valid`; otherwise it returns `Invalid` with every message.
Because it is pure and total, you can test each rule independently and trust that the function never
throws. This *accumulating* style — collect then decide — contrasts with the *sequencing* style of
Recipe 78, where the first failure short-circuits; choose accumulation when the checks are independent
and the user benefits from seeing them together.

---

### 77. Use a circuit breaker to stop hammering a failing dependency

When a dependency is failing, retrying every request just piles load on a sick service and makes
callers wait through repeated timeouts. A circuit breaker watches the failure rate and, once it
crosses a threshold, "opens" — short-circuiting calls instantly for a cooldown period before
cautiously trying again. The state machine is **pure**; a `proc` holds the mutable breaker state and
reads the clock.

```pfun
type BState  = { | Closed | Open | HalfOpen }
type Breaker = { state, failures, openedAt }

let threshold = 5;
let cooldownMs = 30000;

function onSuccess(b)        { Breaker { Closed, 0, 0 }; }
function onFailure(b, nowMs) { let f = b.failures + 1;
  if f >= threshold then Breaker { Open, f, nowMs } else Breaker { Closed, f, 0 }; }
function canRequest(b, nowMs) {
  match b.state with
  | Closed   -> true
  | HalfOpen -> true
  | Open     -> nowMs - b.openedAt >= cooldownMs;       // cooldown elapsed -> allow one trial
}

var breaker = Breaker { Closed, 0, 0 };                  // the wrapper's mutable state

async proc guardedFetch(url) {
  if !canRequest(breaker, now()) then Err { "circuit open for " + url }
  else match await fetchJson(url) with
    | Ok v  -> { breaker = onSuccess(breaker); Ok { v.value }; }
    | Err e -> { breaker = onFailure(breaker, now()); Err e; };
}
```

**How it works.** The three pure functions are a transition table: `onFailure` increments the failure
count and trips to `Open` (recording *when*) at the threshold; `onSuccess` resets to `Closed`; and
`canRequest` decides whether a call is allowed — always when closed/half-open, and when open only
after the cooldown has elapsed. The single `var breaker` and the `now()` reads live in the
`guardedFetch` `proc`, which consults `canRequest` before spending a network call and updates the
breaker from the outcome. Because the logic is pure, you can unit-test the entire open/close/cooldown
behavior by feeding timestamps to the transition functions — no network, no clock. This is the
declarative-state-machine pattern that `tea.pf` uses for UI, applied to resilience.

---

### 78. Propagate errors through an async call chain cleanly

A multi-step async workflow — begin a transaction, debit, credit, commit — produces a `Response` at
every step, and naive handling nests `match` after `match` until it marches off the right margin. A
small `andThen` combinator sequences steps so that the first `Err` short-circuits the rest, flattening
the chain into a readable pipeline. This is the fail-fast counterpart to Recipe 76's accumulation.

```pfun
// run `next` only if the previous step succeeded; otherwise pass the error straight through
async proc andThen(result, next) {
  match result with | Err e -> Err e | Ok v -> await next(v.value);
}

async proc transfer(conn, fromId, toId, amount) {
  let begun = await dbQuery(conn, "BEGIN", []);
  let r = await andThen(begun, fn _ =>
            andThen(dbQuery(conn, "UPDATE accounts SET balance = balance - $1 WHERE id = $2", [DbFloat { amount }, DbInt { fromId }]), fn _ =>
              dbQuery(conn, "UPDATE accounts SET balance = balance + $1 WHERE id = $2", [DbFloat { amount }, DbInt { toId }])));
  match r with
  | Ok _  -> await dbQuery(conn, "COMMIT", [])
  | Err e -> { let _ = await dbQuery(conn, "ROLLBACK", []); Err e; };
}
```

**How it works.** `andThen` takes a settled `Response` and a continuation `next`; on `Ok` it awaits
`next(value)`, and on `Err` it returns the error without running `next` — so once any step fails, the
remaining steps are skipped. Chaining `andThen` calls expresses "do this, then this, then this, but
stop on the first failure" without deepening the indentation per step, and the final `match` performs
the commit-or-rollback. (This relies on async procedures being first-class values that can be passed
and awaited, consistent with `proctest.pf` and the `await` usage across the corpus.) Compare with the
hand-nested version in Chapter 7, Recipe 65 — same behavior, far less nesting.

---

### 79. Write a structured log entry with level, timestamp, and metadata

Logs that are plain prose are hard to search and aggregate; structured logs (JSON with a level,
timestamp, message, and arbitrary fields) can be filtered and indexed by tooling. The clean split is
a **pure** function that builds the entry value and serializes it, wrapped by a tiny `proc` that
supplies the timestamp and writes the line. This reuses the `json` module and the `now()` wrapper.

```pfun
import * from "json";

type LogEntry = { level, message, timestamp, fields };   // fields: list of Pair { key, value }

function buildEntry(level, message, nowMs, fields) { LogEntry { level, message, nowMs, fields }; }
function entryToJson(e) { match jsonSerialize(e) with | Some s -> s.value | None -> "{}"; }

proc emitLog(level, message, fields) {
  println(entryToJson(buildEntry(level, message, now(), fields)));
}

emitLog("info", "user signed up", [ Pair { "userId", "42" }, Pair { "plan", "pro" } ]);
// {"level":"info","message":"user signed up","timestamp":...,"fields":[...]}
```

**How it works.** `buildEntry` assembles a `LogEntry` record and `entryToJson` serializes it with
`jsonSerialize`, both pure — given the same inputs they produce the same JSON, so you can assert on log
output in tests. The only effects, `now()` and `println`, are isolated in `emitLog`, which the rest of
this chapter calls. Carrying `fields` as a list of `Pair` lets each call attach whatever context is
relevant without changing the type. Swap `println` for the rotating-file `logLine` from Chapter 5, or
an HTTP shipper, to send structured logs wherever they need to go.

---

### 80. Handle partial failures in a batch operation (track successes and failures)

When processing many items — sending emails, importing rows, calling an API per record — some will
succeed and some will fail, and aborting on the first failure abandons work that would have
succeeded. The resilient approach processes every item and returns a report of both outcomes, so the
caller can retry only the failures. The result is a record holding the successes and the
failure-with-reason pairs.

```pfun
type BatchOutcome = { succeeded, failed };    // failed: list of Pair { item, reason }

async proc processAll(items, action) { await processAcc(items, action, BatchOutcome { [], [] }); }
async proc processAcc(items, action, acc) {
  if length(items) == 0 then acc
  else {
    let item = head(items);
    let next = match await action(item) with
      | Ok _  -> BatchOutcome { acc.succeeded + [item], acc.failed }
      | Err e -> BatchOutcome { acc.succeeded, acc.failed + [Pair { item, e.message }] };
    await processAcc(tail(items), action, next);
  };
}

async proc demo(emails) {
  let outcome = await processAll(emails, fn addr => sendEmail(addr));
  println(__str__(length(outcome.succeeded)) + " sent, " + __str__(length(outcome.failed)) + " failed");
  map(fn f => emitLog("warn", "send failed", [ Pair { "to", f.key }, Pair { "why", f.value } ]), outcome.failed);
}
```

**How it works.** `processAcc` walks the items one at a time, awaiting `action(item)` and routing the
result into the `succeeded` list or the `failed` list (paired with its error message), never aborting
the loop on a failure. The final `BatchOutcome` is a complete ledger: the caller can report counts,
log each failure, and feed `outcome.failed` back into another `processAll` to retry just those. This
is the batch-scale version of Recipe 40's partition and Recipe 76's error accumulation — collect every
result, then decide — and it keeps a single bad item from sinking an otherwise successful batch.

---


## Chapter 9 — Concurrency & Performance

Pfun transpiles to JavaScript, so it inherits JavaScript's **single-threaded, event-loop**
concurrency model. The corpus demonstrates this directly: `async proc`, `await`, and `sleep` (from
the `async` module) schedule work cooperatively, and `tea.pf` weaves async HTTP into a UI loop. Two
consequences run through this chapter:

* There is **no preemptive multithreading** of Pfun code. Two async tasks never execute Pfun
  statements *simultaneously*; they only interleave at `await` points. This eliminates classic data
  races but introduces *logical* races across awaits (Recipe 87).
* True parallelism — using multiple CPU cores — requires Node worker threads or processes, which the
  corpus never shows. Recipes 81 and 85 use foreign wrappers (Appendix A) and say so plainly.

For performance, Pfun offers `memo` (memoized pure functions, used for `fib` in
`golden_helper.pf`) and **lazy/infinite lists** (`iterate`, `repeat`, `cycle`, consumed by `take`),
both of which appear in `example.pf` and `golden.pf`.

---

### 81. Run multiple HTTP requests in parallel and collect results

Fetching ten independent URLs one after another wastes time when they could overlap; issuing them
together and waiting for all to finish can be an order of magnitude faster. JavaScript expresses this
with `Promise.all`, surfaced here as the `awaitAll` wrapper (Appendix A). The corpus only ever awaits
requests sequentially, so this builds on a capability beyond what it demonstrates.

```pfun
// awaitAll : (List<Promise>) -> Response<List>   (Appendix A, wraps Promise.all)
async proc fetchAll(urls) {
  let started = map(fn u => httpGet(u), urls);    // launch every request without awaiting
  await awaitAll(started);
}

async proc demo() {
  match await fetchAll(["http://localhost:7999/", "http://localhost:7999/greet?name=a"]) with
  | Ok rs -> println("got " + __str__(length(rs.value)) + " responses")
  | Err e -> println("one failed: " + e.message);
}
demo();
```

**How it works.** `map(fn u => httpGet(u), urls)` calls `httpGet` for each URL *without* `await`,
producing a list of in-flight operations; `awaitAll` then waits for all of them and collects the
results (failing if any one fails, like `Promise.all`). Because the requests are I/O-bound, the event
loop overlaps their waiting time even on one thread. **Caveat:** this assumes an un-awaited async call
yields a first-class awaitable value that `map` can collect — behavior the corpus does not explicitly
demonstrate (see Appendix B). If it does not, fall back to a sequential loop, or to `spawnWorker`
(Recipe 85) when parallelism is essential. For "all-or-nothing vs. collect-what-succeeded" semantics,
combine with the partial-failure recipe (Chapter 8, Recipe 80).

---

### 82. Throttle a function to run at most N times per second

Event handlers that fire rapidly — scroll, resize, mousemove, or a chatty API client — can overwhelm
a downstream system. Throttling enforces a minimum interval between executions, dropping (or
deferring) calls that arrive too soon. The "may I run now?" decision is pure; the timestamp state and
the clock read live in a `proc`.

```pfun
function shouldRun(lastMs, nowMs, intervalMs) { nowMs - lastMs >= intervalMs; }

let minIntervalMs = 200;          // at most 5 calls/second
var lastRun = 0;

proc throttled(action) {
  let t = now();
  if shouldRun(lastRun, t, minIntervalMs) then { lastRun = t; action(); } else 0;
}
```

**How it works.** `shouldRun` is a pure predicate comparing the elapsed time since the last execution
against the interval — trivially testable with fixed timestamps. The `throttled` `proc` holds the
`lastRun` time in a `var`, and on each invocation either runs `action` and records the time, or drops
the call. With `minIntervalMs = 200`, no more than five executions happen per second regardless of how
often `throttled` is called. To instead *defer* the trailing call rather than drop it, schedule it
with `setTimeoutId` (Recipe 83) for the remaining time — that variation is debouncing's close cousin.

---

### 83. Debounce input (wait until the user stops typing)

Search-as-you-type should not fire a query on every keystroke; it should wait until the user pauses.
Debouncing resets a timer on each event and only runs the action once the events stop for a quiet
period. This needs cancellable timers — the `setTimeoutId`/`clearTimeoutId` wrappers (Appendix A) —
plus a `var` holding the pending timer id.

```pfun
// setTimeoutId : (Int ms, proc() action) -> Int      clearTimeoutId : (Int id) -> ...   (Appendix A)
var pending = 0;

proc debounce(ms, action) {
  clearTimeoutId(pending);              // cancel the previous, not-yet-fired timer
  pending = setTimeoutId(ms, action);   // (re)arm
}

// in an input handler (cf. tea.pf's onInput), debounce the search:
proc onSearchInput(text) {
  debounce(300, fn () => runSearch(text));
}
```

**How it works.** Each call to `debounce` first cancels any timer still waiting (`clearTimeoutId`),
then schedules a fresh one (`setTimeoutId`) for `ms` into the future. As long as events keep arriving
within the window, the timer keeps getting reset and the action never runs; once `ms` passes with no
new event, the last-scheduled timer fires and `action` runs exactly once. Storing the timer id in a
`var` is what makes cancellation possible. In a TEA-style app you would drive this from the
`onInput` handler so that only a settled query reaches the server.

---

### 84. Cache the result of an expensive function call with a TTL

Expensive results — a slow computation, a remote lookup — are worth caching, but stale data must
eventually expire. A time-to-live (TTL) cache stores each result with an expiry timestamp and
recomputes only after it lapses. Unlike `memo` (which caches forever), this needs the clock, so it is
a `proc` with a `dict` cache; the staleness check itself is pure.

```pfun
type Cached = { value, expiresAt };
var cache = dict {};

function isFresh(entry, nowMs) { entry.expiresAt > nowMs; }

proc cachedCompute(key, ttlMs, compute) {
  let t = now();
  if has(cache, key) && isFresh(cache[key], t) then cache[key].value
  else { let v = compute(key); cache[key] = Cached { v, t + ttlMs }; v; };
}

// let rates = cachedCompute("usd", 60000, fn k => fetchRateSync(k));   // recompute at most once a minute
```

**How it works.** `cachedCompute` looks up `key`; if an entry exists and `isFresh` (its `expiresAt`
is still in the future), it returns the cached value with no recomputation. Otherwise it calls
`compute`, stores the fresh value with an expiry of `now() + ttlMs`, and returns it. The dict acts as
the store and the `var`/`now()` are the only effects; `isFresh` is pure and unit-testable. Use this
when data may change (prices, config); use `memo` (Recipe 88) when a pure function's result is
permanently valid for given arguments.

---

### 85. Process a large list in parallel worker threads/processes

CPU-bound work — hashing a million records, image processing — cannot be sped up by the async event
loop, which is single-threaded; it needs real parallelism across cores. In the Node target that means
worker threads, exposed here as the `spawnWorker` wrapper (Appendix A). This is **not** demonstrated
anywhere in the corpus, so treat it as an extension and verify it against your runtime.

```pfun
// spawnWorker : (String scriptPath, message) -> Response<result>   (Appendix A, worker_threads)
async proc parallelProcess(scriptPath, items, workers) {
  let batches = chunk(items, idiv(length(items) + workers - 1, workers));   // chunk from Chapter 4
  match await awaitAll(map(fn b => spawnWorker(scriptPath, b), batches)) with
  | Ok results -> Ok { reduce(fn acc, r => acc + r, [], results.value) }     // flatten per-worker results
  | Err e      -> Err e;
}
```

**How it works.** The work is split into roughly equal batches (one per worker) with Chapter 4's
`chunk`, each batch is dispatched to a worker running `scriptPath` via `spawnWorker`, and `awaitAll`
collects the per-worker results, which are then concatenated. Each worker runs its own Pfun program on
its own thread, so the batches genuinely execute in parallel. The trade-off is overhead: spawning
workers and serializing messages costs time, so this pays off only for substantial CPU work, not for
I/O (use Recipe 81 for that). Because the corpus does not exercise worker threads, confirm message
serialization and the worker entry-point convention before relying on this.

---

### 86. Use a queue to decouple a producer from a slow consumer

When a fast producer outpaces a slow consumer (incoming events vs. a rate-limited API), a queue
buffers the difference so the producer is not blocked. A mutable array serves as the queue; an async
consumer loop drains it, sleeping briefly when it is empty. On the single-threaded loop, producer and
consumer interleave at `await` points rather than running truly concurrently.

```pfun
var queue = array { };

proc enqueue(item) { append(queue, item); }

async proc consume(handle) {
  if arrayLength(queue) > 0 then {
    let item = queue[0];
    removeAt(queue, 0);
    await handle(item);              // process one item (may be slow)
    await consume(handle);
  } else {
    await sleep(50);                 // idle: yield, then check again
    await consume(handle);
  };
}
```

**How it works.** `enqueue` appends to the shared array; `consume` repeatedly takes the front item
(`queue[0]` then `removeAt`), processes it with the async `handle`, and recurses. When the queue is
empty it `sleep`s briefly to yield the event loop before polling again, so it does not busy-spin.
Because everything is single-threaded, an `await` in `handle` is exactly where the producer gets a
chance to `enqueue` more — there is no lock needed on the array itself, only awareness that state can
change across awaits. To apply backpressure, have `enqueue` reject (or the producer pause) when
`arrayLength(queue)` exceeds a bound.

---

### 87. Detect and prevent a race condition on a shared resource

Even single-threaded, async code races *logically*: if two tasks each `read-modify-write` a shared
value with an `await` in between, one can clobber the other's update. The fix is to serialize the
critical section with a simple lock flag, so only one task holds the resource across its awaits at a
time. Understanding *why* this works in Pfun is half the recipe.

```pfun
var locked = false;

async proc withLock(action) {
  if locked then { await sleep(5); await withLock(action); }       // wait and retry
  else {
    locked = true;
    let r = await action();      // critical section: no other withLock body runs across this await
    locked = false;
    r;
  };
}

// two tasks safely incrementing a shared counter that lives behind an awaiting update:
async proc bump(by) { await withLock(fn () => incrementSharedCounter(by)); }
```

**How it works.** Because Pfun runs on one thread, setting `locked = true` and starting the action is
*atomic* — no other code runs until the first `await`. If a second task calls `withLock` while the
flag is set, it `sleep`s and retries, so the two critical sections cannot interleave across their
awaits; the second waits for `locked = false`. This guards the read-modify-write hazard that the event
loop would otherwise allow at the `await` inside `action`. Note this is a cooperative lock, not a true
mutex: it only protects code that *goes through* `withLock`, and it relies on every accessor opting in.
For shared resources accessed across worker threads (Recipe 85), you need real synchronization
primitives, which are beyond what the corpus shows.

---

### 88. Lazily load / compute a value only when first accessed

Expensive initialization — reading a large config, building a lookup table — should happen on first
use, not at startup, and then be reused. Pfun gives two tools: `memo` for pure functions (cache keyed
by arguments, demonstrated by `fib` in `golden_helper.pf`) and a `var`-plus-`Option` cell for an
effectful singleton computed once on demand.

```pfun
// pure & permanently memoized (corpus pattern): cached per argument value
memo function expensiveTable(seed) { buildBigTable(seed); }

// effectful singleton: computed on first access, then reused
var cachedConfig = None;
proc getConfig() {
  match cachedConfig with
  | Some s -> s.value
  | None   -> { let c = loadConfigExpensive(); cachedConfig = Some { c }; c; };
}
```

**How it works.** `memo` makes Pfun cache `expensiveTable`'s result per distinct `seed`, so the second
call with the same seed returns instantly — ideal for pure functions whose output never changes for a
given input. The `getConfig` `proc` covers the effectful case: it holds an `Option` cell, returns the
stored value if present, and otherwise computes it once, stores it as `Some`, and returns it — a
classic lazy singleton. (The exact lifetime and eviction policy of `memo`'s cache is not documented in
the corpus; see Appendix B.) For lazily streaming many values rather than one, use infinite lists
(Recipe 89), which compute each element only when demanded.

---

### 89. Stream results back to a caller instead of buffering everything

Returning a giant list forces the whole result into memory before the caller sees any of it. Lazy
sequences let a producer yield values on demand, so the consumer can process — and stop — without
materializing everything. `example.pf` and `golden.pf` lean on this: `iterate` builds an infinite
list, and `take`/`filter`/`map` pull from it only as far as needed.

```pfun
// infinite, lazy: nothing is computed until something pulls
let nats = iterate(fn x => x + 1, 1);

function isPrime(n) {
  if n < 2 then false else length(filter(fn d => n % d == 0, rangeIncl(2, idiv(n, 2)))) == 0;
}

let primes = filter(isPrime, nats);     // a lazy stream of primes
println(take(5, primes));               // [2, 3, 5, 7, 11] — only the first 5 are computed
```

**How it works.** `iterate(fn x => x + 1, 1)` is an unbounded stream that produces each natural number
only when asked. `filter(isPrime, nats)` is itself lazy, and `take(5, …)` pulls exactly five primes
and then stops — the millionth natural number is never computed. This is *streaming* in the functional
sense: the pipeline is a description, and demand at the end drives just enough production at the front.
For effectful streams (database rows, file lines), use the demand-driven callbacks from earlier
chapters — `forEachPage` (Chapter 7) and `foldLines` (Chapter 5) — which hand the caller one chunk at
a time instead of buffering the whole result set.

---

### 90. Profile a slow function to find the bottleneck

Optimizing without measuring is guesswork; you need to know which part is actually slow. A high-
resolution timer around a section of code gives elapsed milliseconds, and wrapping candidate
implementations lets you compare them directly. The `hrtimeMs` wrapper (Appendix A, over
`performance.now`) provides the clock; the `money`/`numberToFixed` formatter from Chapter 2 makes the
output readable.

```pfun
// hrtimeMs : () -> Float   high-resolution milliseconds   (Appendix A)
proc timeIt(label, thunk) {
  let start = hrtimeMs();
  let result = thunk();
  println(label + ": " + numberToFixed(hrtimeMs() - start, 2) + " ms");
  result;
}

// compare two implementations of the same work:
proc profile() {
  timeIt("naive fib(30)",  fn () => fibNaive(30));
  timeIt("memo  fib(30)",  fn () => fib(30));         // memo fib from golden_helper.pf
}
profile();
```

**How it works.** `timeIt` records `hrtimeMs()` before and after invoking the zero-argument `thunk`,
prints the difference to two decimals, and returns the thunk's result so it can be dropped into an
expression non-invasively. Wrapping each candidate (`fibNaive` vs. the `memo`-ized `fib`) shows the
real cost difference rather than a guess — here, exponential recomputation versus cached subproblems.
Profile the *suspected* hotspots first, then drill down by nesting `timeIt` around inner sections;
because `timeIt` is just a `proc` taking a thunk, you can sprinkle it anywhere without restructuring
the code. Remember the single-threaded model: wall-clock time includes any `await`ed I/O, so separate
CPU timing from I/O timing when interpreting the numbers.

---


## Chapter 10 — Security & Encoding

Security work needs cryptography, which the corpus does not include, so this chapter relies on
foreign wrappers (Appendix A) over Node's `crypto` and `Buffer`. It keeps one distinction from
Chapter 3 in mind:

* **Effectful** wrappers depend on something outside their arguments: `randomBytes` (reads the OS
  entropy pool), `getEnv` (reads the environment), and `now()` (reads the clock). These belong in
  `proc`s.
* **Deterministic** wrappers are referentially transparent even though they call JavaScript:
  `hmacSha256Hex`, `pbkdf2`, `base64Encode`/`base64Decode`, `bytesToHex`/`hexToBytes`,
  `timingSafeEqual`. Given the same inputs they always produce the same output, so they may be used
  inside pure `function`s (with the clock and entropy passed in as parameters).

One security primitive *is* already in the corpus and worth celebrating: `htmllib.pf`'s `escapeHtml`
and `escapeAttr`, used by Recipe 95.

---

### 91. Hash a password with a salt and verify it later

Passwords must never be stored in plaintext or with a fast hash; you store a slow, salted key
derivation so that a leaked database is expensive to crack and identical passwords produce different
hashes. PBKDF2 with a per-password random salt and many iterations is a solid, widely-available
choice. Hashing reads entropy (effect); verification is a deterministic recompute-and-compare.

```pfun
// randomBytes : (Int) -> Response<List<Byte>>           pbkdf2 : (String,List<Byte>,Int,Int,String) -> Response<List<Byte>>
// bytesToHex/hexToBytes : conversions     timingSafeEqual : (List<Byte>,List<Byte>) -> Bool       (all Appendix A)
let iterations = 120000;

proc hashPassword(pw) {
  match randomBytes(16) with
  | Err e   -> Err e
  | Ok salt -> match pbkdf2(pw, salt.value, iterations, 32, "sha256") with
    | Err e    -> Err e
    | Ok derived -> Ok { bytesToHex(salt.value) + ":" + bytesToHex(derived.value) };
}

proc verifyPassword(pw, stored) {
  let parts = split(stored, ":");
  if length(parts) != 2 then false
  else {
    let salt = hexToBytes(nth(parts, 0));
    let want = hexToBytes(nth(parts, 1));
    match pbkdf2(pw, salt, iterations, 32, "sha256") with
    | Err _  -> false
    | Ok got -> timingSafeEqual(got.value, want);
  };
}
```

**How it works.** `hashPassword` generates a fresh 16-byte salt, derives a 32-byte key from the
password and salt over 120 000 iterations, and stores `salt:hash` as hex — the salt is not secret, it
just guarantees uniqueness. `verifyPassword` splits the stored string, re-derives the key with the
*same* salt and parameters, and compares with `timingSafeEqual`, whose constant-time comparison
avoids leaking how many leading bytes matched (a timing side-channel that `==` would expose). The cost
factor (iterations) should be tuned upward as hardware improves; bump it and re-hash on next login.

---

### 92. Generate a cryptographically secure random token

Session ids, API keys, and reset tokens must be unguessable, which rules out `Math.random` (Recipe
14) — that is fine for dice, not for secrets. A secure token is random bytes from the OS CSPRNG,
encoded as URL-safe text. `randomBytes` provides the entropy; `base64UrlEncode` makes it safe to put
in URLs and headers.

```pfun
// base64UrlEncode : (List<Byte>) -> String   (Appendix A; URL-safe, no padding)
proc secureToken(nBytes) {
  match randomBytes(nBytes) with
  | Ok b  -> Ok { base64UrlEncode(b.value) }
  | Err e -> Err e;
}

match secureToken(32) with    // 256 bits of entropy
| Ok t  -> println("token: " + t.value)
| Err e -> println("rng failed: " + e.message);
```

**How it works.** `randomBytes(32)` draws 256 bits from the operating system's cryptographically
secure generator — the same source `crypto.randomBytes` uses — and `base64UrlEncode` renders them as
a compact, URL-safe string with no `+`, `/`, or `=` to escape. Thirty-two bytes is the usual floor for
session tokens; use more for long-lived secrets. The only effect is reading entropy, isolated in the
`proc`; everything downstream treats the token as an opaque string. Never derive security tokens from
timestamps, counters, or `Math.random`, all of which are predictable.

---

### 93. Encode and decode Base64 (handling padding edge cases)

Base64 turns binary into ASCII for embedding in JSON, URLs, or data URIs, but it has two gotchas:
standard Base64 uses `+`/`/` and `=` padding (unsafe in URLs), while the URL-safe variant uses `-`/`_`
and usually drops the padding. Decoding must restore the padding the encoder removed. The wrappers
handle the alphabet; this recipe handles the padding.

```pfun
// base64Encode : (String) -> String        base64Decode : (String) -> Response<String>   (Appendix A, via Buffer)
function padBase64(s) {                                   // re-add '=' so length is a multiple of 4
  let r = length(s) % 4;
  if r == 0 then s else s + strRepeat("=", 4 - r);        // strRepeat from stringlib
}
function base64UrlDecode(s) {
  base64Decode(padBase64(replaceAll(replaceAll(s, "-", "+"), "_", "/")));
}

println(base64Encode("Hello, World"));            // "SGVsbG8sIFdvcmxk"
match base64Decode("SGVsbG8sIFdvcmxk") with | Ok s -> println(s.value) | Err e -> println(e.message);
match base64UrlDecode("SGVsbG8sIFdvcmxk") with | Ok s -> println(s.value) | Err _ -> 0;
```

**How it works.** `base64Encode`/`base64Decode` defer to `Buffer`, which produces and accepts standard
padded Base64. `base64UrlDecode` bridges the URL-safe form back to standard: it swaps `-`/`_` for
`+`/`/` and calls `padBase64`, which re-appends the `=` characters so the length is a multiple of four
(the padding rule Base64 requires for decoding). Because `base64Decode` returns a `Response`,
malformed input becomes an `Err` rather than throwing. Pair `base64UrlEncode` (Recipe 92) with
`base64UrlDecode` here for a clean round trip through URLs.

---

### 94. Sign a payload with HMAC and verify the signature

To prove a payload came from you and was not tampered with (webhook bodies, signed cookies, API
requests), attach an HMAC computed with a shared secret key. Verification recomputes the HMAC and
compares it in constant time. Because HMAC is deterministic, signing and verifying can be pure
functions over the key, payload, and signature.

```pfun
// hmacSha256Hex : (String key, String msg) -> Response<String>   (deterministic; Appendix A)
function timingSafeEqualHex(a, b) { timingSafeEqual(hexToBytes(a), hexToBytes(b)); }

function sign(key, payload) { hmacSha256Hex(key, payload); }       // Response<String>
function verify(key, payload, sig) {
  match hmacSha256Hex(key, payload) with
  | Ok h  -> timingSafeEqualHex(h.value, sig)
  | Err _ -> false;
}

match sign("s3cret", "amount=100&to=bob") with
| Ok mac -> println(verify("s3cret", "amount=100&to=bob", mac.value) ? "valid" : "tampered")
| Err e  -> println(e.message);
```

**How it works.** `sign` computes the SHA-256 HMAC of the payload under the secret key, returning it as
a hex string. `verify` recomputes the HMAC from the (untrusted) payload and key, then compares it to
the supplied signature with `timingSafeEqualHex`, which decodes both to bytes and compares in constant
time so an attacker cannot probe the secret byte-by-byte via timing. Any difference — a flipped bit in
the payload or a forged signature — fails verification. The secret key must come from a secure source
(Recipe 96), never the codebase, and the same payload must be reconstructed identically on both sides
(canonicalize field order, encoding, etc.).

---

### 95. Sanitize HTML input to prevent XSS

Rendering untrusted text into a page without escaping lets an attacker inject `<script>` and run code
in your users' browsers (XSS). Pfun's own `htmllib.pf` already solves the common case: it models HTML
as typed ADTs and **escapes every text node on render** via `escapeHtml`/`escapeAttr`, so text simply
*cannot* become markup. The primary defense is to use that pipeline and reuse `escapeHtml` for any raw
string interpolation.

```pfun
import { escapeHtml, escapeAttr } from "./htmllib";

// Reusing the corpus's escaper for ad-hoc string building:
function userBadge(name) { "<span class=\"badge\">" + escapeHtml(name) + "</span>"; }

println(userBadge("<script>steal()</script>"));
// <span class="badge">&lt;script&gt;steal()&lt;/script&gt;</span>   (inert text)

// For rich, user-authored HTML where SOME tags are allowed, use an allowlist sanitizer:
// sanitizeHtml : (String html, List<String> allowedTags) -> String   (Appendix A)
// let safe = sanitizeHtml(commentHtml, ["b", "i", "a", "p", "code"]);
```

**How it works.** `escapeHtml` (from `htmllib.pf`) replaces `&`, `<`, `>`, and `"` with their entities
using the `join(split(...))` idiom, turning `<script>` into harmless text; `escapeAttr` additionally
escapes `'` for attribute contexts. Because `viewlib`/`htmllib` route *all* text through these on
render (`renderInline` of a `Text` node calls `escapeHtml`), an app built on those ADTs is XSS-safe by
construction — you never concatenate untrusted text into markup yourself. When you must *accept* a
subset of HTML (a comment with bold and links), escaping is too strong; use the allowlist
`sanitizeHtml` wrapper, which parses the HTML and strips any tag or attribute not on the allowlist.
Never trust a regex to sanitize HTML.

---

### 96. Store and retrieve a secret from an environment variable or vault

Secrets — database passwords, API keys, signing keys — must not live in source code (the corpus's
demo connection strings like `postgres://postgres:postgres@localhost` are illustrative only). The
twelve-factor approach reads them from the environment; `getEnv` (Appendix A, over `process.env`)
exposes that as an `Option`, and a `requireEnv` variant fails fast when a mandatory secret is missing.

```pfun
// getEnv : (String) -> Option<String>     (Appendix A, process.env)
function getEnvOr(name, fallback) { match getEnv(name) with | Some s -> s.value | None -> fallback; }

proc requireEnv(name) {
  match getEnv(name) with
  | Some s -> Ok { s.value }
  | None   -> Err { "missing required secret: " + name };
}

proc connectDb() {
  match requireEnv("DATABASE_URL") with
  | Err e  -> { println(e.message); Err e; }
  | Ok url -> await dbConnect(url.value);
}
```

**How it works.** `getEnv` returns `Some` when the variable is set and `None` when it is not, so the
type forces you to decide what a missing value means: `getEnvOr` supplies a default for optional
settings, while `requireEnv` turns a missing mandatory secret into an `Err` that aborts startup
loudly rather than connecting with a blank password. The secret never appears in code, logs, or error
messages (note `requireEnv` prints only the variable *name*). For production-grade secret management —
rotation, leases, audit — front a secrets manager with the same `Option`/`Response` shape via a
`vaultGet` wrapper (Appendix A); call sites do not change.

---

### 97. Generate and validate a time-limited token (password reset link)

A password-reset link must be unforgeable and expire. Rather than store reset tokens in a database,
you can make a self-contained token: the payload (user id and expiry) plus an HMAC over it. Validation
recomputes the HMAC and checks the expiry — no storage needed, and tampering invalidates the
signature. Because HMAC is deterministic and the clock is passed in, both functions are pure.

```pfun
type TokenResult = { | TokenValid : userId | TokenExpired | TokenInvalid }

function makeToken(key, userId, expiresAt) {
  let payload = __str__(userId) + "." + __str__(expiresAt);
  match hmacSha256Hex(key, payload) with
  | Ok sig -> Ok { payload + "." + sig.value }
  | Err e  -> Err e;
}

function validateToken(key, token, nowMs) {
  let parts = split(token, ".");
  if length(parts) != 3 then TokenInvalid
  else {
    let payload = nth(parts, 0) + "." + nth(parts, 1);
    match hmacSha256Hex(key, payload) with
    | Err _  -> TokenInvalid
    | Ok sig -> if !timingSafeEqualHex(sig.value, nth(parts, 2)) then TokenInvalid
                else if nowMs > parseDigits(nth(parts, 1)) then TokenExpired
                else TokenValid { parseDigits(nth(parts, 0)) };
  };
}

// proc layer supplies the clock:
proc issueReset(key, userId) { makeToken(key, userId, now() + 3600000); }   // valid 1 hour
```

**How it works.** `makeToken` builds `userId.expiry` and appends its HMAC, yielding
`userId.expiry.signature`. `validateToken` splits the three parts, recomputes the HMAC over the
payload, and rejects the token if the signature does not match in constant time (`TokenInvalid`),
then checks the expiry against the supplied `nowMs` (`TokenExpired`), and only otherwise returns
`TokenValid` with the user id. Modeling the outcome as a three-way union — not a bare bool — lets the
caller tell "forged" from "expired" and respond appropriately. The `issueReset` `proc` is the only
part that reads the clock (`now()`); `validateToken` stays pure by taking `nowMs`, so you can test
expiry logic deterministically.

---

### 98. Encrypt and decrypt a string with a symmetric key

Storing or transmitting confidential data (a stored OAuth refresh token, a private note) calls for
authenticated symmetric encryption. AES-256-GCM both encrypts and produces an authentication tag that
detects tampering. Each encryption needs a fresh random IV (so identical plaintexts differ), which
makes encryption effectful; decryption is deterministic given the key, IV, ciphertext, and tag.

```pfun
// aesGcmEncrypt : (List<Byte> key, List<Byte> iv, String plain) -> Response<{ cipher, tag }>
// aesGcmDecrypt : (List<Byte> key, List<Byte> iv, List<Byte> cipher, List<Byte> tag) -> Response<String>   (Appendix A)
proc encryptString(key, plain) {
  match randomBytes(12) with                       // 96-bit IV, recommended for GCM
  | Err e  -> Err e
  | Ok iv  -> match aesGcmEncrypt(key, iv.value, plain) with
    | Err e   -> Err e
    | Ok enc  -> Ok { base64UrlEncode(iv.value) + "." +
                      base64UrlEncode(enc.value.cipher) + "." +
                      base64UrlEncode(enc.value.tag) };
}

proc decryptString(key, blob) {
  let parts = split(blob, ".");
  if length(parts) != 3 then Err { "malformed ciphertext" }
  else aesGcmDecrypt(key, b64uBytes(nth(parts, 0)), b64uBytes(nth(parts, 1)), b64uBytes(nth(parts, 2)));
}
```

**How it works.** `encryptString` generates a 12-byte IV, encrypts the plaintext under the key, and
packs the IV, ciphertext, and authentication tag as three URL-safe Base64 fields joined by dots — the
IV and tag are not secret and must travel with the ciphertext. `decryptString` unpacks the three
fields (via a `b64uBytes` helper that URL-decodes to bytes) and calls `aesGcmDecrypt`, which returns an
`Err` if the tag does not verify — meaning the data was altered or the wrong key was used. The key is
32 random bytes from a secure source (Recipe 96), never a password directly; if you only have a
password, derive a key with `pbkdf2` (Recipe 91) first. Never reuse an IV with the same key.

---

### 99. Rate-limit requests per user/IP to prevent abuse

Public endpoints need rate limiting so one client cannot exhaust your capacity. A fixed-window counter
per user/IP is simple and effective: count requests within each time window and reject once the limit
is reached. The accept/reject decision and window roll-over are **pure**; a `proc` holds the per-key
counters in a dict and reads the clock.

```pfun
type Window = { count, windowStart };
let limit = 100;
let windowMs = 60000;

// pure: given the current window and time, decide and produce the next window
function step(w, nowMs) {
  if nowMs - w.windowStart >= windowMs then Pair { true,  Window { 1, nowMs } }           // new window
  else if w.count < limit       then Pair { true,  Window { w.count + 1, w.windowStart } } // under limit
  else                               Pair { false, w };                                    // blocked
}

var buckets = dict { };
proc allowRequest(id) {
  let t = now();
  let w = if has(buckets, id) then buckets[id] else Window { 0, t };
  let r = step(w, t);
  buckets[id] = r.value;          // store the new window
  r.key;                          // Bool: allowed?
}

// in a request handler:  if allowRequest(req.clientIp) then serve(req) else res.text(429, "slow down")
```

**How it works.** `step` is the entire policy as a pure function: if the window has elapsed it starts a
fresh one (count 1), if the client is under the limit it increments, and otherwise it denies — returning
a `Pair` of the decision and the updated window. `allowRequest` looks up (or initializes) the client's
window in the `buckets` dict, applies `step`, stores the result, and returns whether to allow the
request. Keeping `step` pure means the limit logic — including the trickier window-rollover — is unit
testable with synthetic timestamps. For smoother limiting that tolerates bursts, swap `step` for a
token-bucket version; the `proc` and dict scaffolding stay the same.

---

### 100. Audit-log sensitive actions with who did what and when

Compliance and forensics require an append-only record of sensitive actions: who performed them, what
they did, to what, and when. This builds directly on the structured logger from Chapter 8, adding the
actor/target metadata and an authoritative timestamp, and persisting to a tamper-evident sink. The
event is built purely; the `proc` stamps the time and writes it.

```pfun
proc auditLog(actor, action, target) {
  emitLog("audit", action, [                       // emitLog from Chapter 8, Recipe 79
    Pair { "actor",  actor },
    Pair { "target", target },
    Pair { "at",     dateFormatIso(now()) }         // human-readable UTC timestamp
  ]);
  // also persist append-only for durability:
  logLine("./audit.log", auditLine(actor, action, target, now()), 10485760);   // logLine from Chapter 5
}

function auditLine(actor, action, target, nowMs) {
  dateFormatIso(nowMs) + "\t" + actor + "\t" + action + "\t" + target;
}

auditLog("alice@corp", "role.grant", "bob@corp:admin");
```

**How it works.** `auditLog` emits a structured `"audit"`-level log entry with the actor, target, and
an ISO timestamp, and *also* appends a tab-separated line to a dedicated, rotating `audit.log` so there
is a durable, greppable record independent of the general log stream. The line is composed by the pure
`auditLine` (testable with a fixed timestamp); only `now()` and the file write are effects. Audit logs
should be **append-only** and shipped off the host promptly (to a write-once store or a separate
logging service) so that an attacker who compromises the application cannot rewrite history — store
them somewhere the application itself cannot delete or edit. For stronger tamper evidence, chain each
entry's HMAC over the previous one (Recipe 94), turning the log into a verifiable hash chain.

---


## Appendix A — Foreign-Function Wrappers

Several recipes call capabilities the corpus's standard modules (`io`, `file`, `json`, `http`,
`async`, `math`, `db/*`) do not provide. Per the language's design, these are reached through the
**foreign-function interface (FFI)**, which wraps each JavaScript/Node call in try/catch and returns
a `Response` (`Ok value` on success, `Err { message }` on a thrown exception). This appendix collects
every wrapper referenced in the book, with its Pfun-idiomatic signature, whether it is effectful or
deterministic, and the exact JavaScript or Node API it wraps.

### The inferred FFI surface

> **Important:** the corpus exposes the FFI only *indirectly*, through the standard modules — the
> low-level primitives are **not documented**. The primitive names below are an **inferred** model
> used to sketch the wrapper bodies; treat the spellings as illustrative and confirm them against
> your toolchain. What *is* certain from the corpus and the language overview is the *contract*:
> foreign calls are try/catch-wrapped and yield a `Response`, and `Err` carries a `.message`.

```pfun
// Inferred primitives (names illustrative; semantics per the language description).
foreignRequire(moduleName)        // -> Response   load a Node module (e.g. "crypto", "fs", "zlib")
foreignGlobal(name)               // -> Response   a runtime global (Buffer, Math, Date, process, ...)
foreignGet(target, prop)          // -> Response   read target.prop
foreignCall(target, method, args) // -> Response   invoke target.method(...args)
foreignInvoke(fnRef, args)        // -> Response   invoke fnRef(...args)
foreignNew(ctor, args)            // -> Response   new ctor(...args)
```

### Wrapper authoring pattern

A wrapper is a thin `proc`/`function` that performs the foreign call and reshapes the `Response`.
Three representative bodies:

```pfun
// Deterministic: Base64 encode a string via Buffer.from(s, "utf8").toString("base64")
function base64Encode(s) {
  match foreignGlobal("Buffer") with
  | Err e   -> Err e
  | Ok buf  -> match foreignCall(buf.value, "from", [s, "utf8"]) with
    | Err e -> Err e
    | Ok b  -> foreignCall(b.value, "toString", ["base64"]);
}
// (convenience: the recipes call a String-returning form that unwraps Ok and falls back to "")

// Effectful: read the wall clock via Date.now()
proc now() {
  match foreignGlobal("Date") with
  | Ok d  -> match foreignCall(d.value, "now", []) with | Ok ms -> ms.value | Err _ -> 0
  | Err _ -> 0;
}

// Deterministic: find all regex matches via RegExp + String.match
function regexFindAll(pattern, flags, text) {
  match foreignNew("RegExp", [pattern, flags]) with
  | Err _ -> []
  | Ok re -> match foreignCall(text, "match", [re.value]) with
    | Ok m  -> m.value          // a List<String> of matches (or [] if none)
    | Err _ -> [];
}
```

The convention used throughout the book: wrappers whose failure is meaningful (I/O, crypto, parsing)
return `Response<T>`; wrappers that essentially cannot fail (formatting, classification) return the
bare value and absorb the impossible error case, as `regexFindAll` does above.

---

### Regular expressions — JavaScript `RegExp`

| Wrapper | Returns | Wraps | Kind |
|---|---|---|---|
| `regexTest(pattern, flags, text)` | `Bool` | `new RegExp(pattern, flags).test(text)` | deterministic |
| `regexFindAll(pattern, flags, text)` | `List<String>` | `text.match(/…/g)` | deterministic |
| `regexReplace(pattern, flags, text, repl)` | `String` | `text.replace(new RegExp(…), repl)` | deterministic |
| `regexMatchGroups(pattern, flags, text)` | `Option<List<String>>` | first `RegExp.exec` match + capture groups | deterministic |

Used in Recipes 5 (extract URLs), 60 (email validation), and available for 42/57.

---

### Numbers, randomness, time — `Math`, `Number`, `performance`

| Wrapper | Returns | Wraps | Kind |
|---|---|---|---|
| `randomFloat()` | `Float` in `[0,1)` | `Math.random()` | effectful (non-crypto) |
| `numberToFixed(x, decimals)` | `String` | `Number(x).toFixed(decimals)` | deterministic |
| `mathFloor(x)` / `mathCeil(x)` | `Int` | `Math.floor` / `Math.ceil` | deterministic |
| `hrtimeMs()` | `Float` | `performance.now()` | effectful |

Used in Recipes 11, 12, 14, 90. (`mathFloor`/`mathCeil` may already exist in the `math` module
alongside `sqrt`/`pow`/`abs`/`round`/`lerp`; provided here for completeness.)

---

### Locale formatting — `Intl`

| Wrapper | Returns | Wraps | Kind |
|---|---|---|---|
| `formatCurrency(amount, currencyCode, locale)` | `String` | `new Intl.NumberFormat(locale, { style:"currency", currency }).format(amount)` | deterministic |
| `formatNumberGrouped(x, locale)` | `String` | `Intl.NumberFormat(locale).format(x)` | deterministic |

Used in Recipe 12 (locale-aware alternative).

---

### Dates & times — JavaScript `Date` and `Intl.DateTimeFormat`

| Wrapper | Returns | Wraps | Kind |
|---|---|---|---|
| `now()` | `Int` (epoch ms) | `Date.now()` | **effectful** |
| `dateParse(s)` | `Response<Int>` | `Date.parse(s)` (`Err` if `NaN`) | deterministic |
| `dateFormatIso(ms)` | `String` | `new Date(ms).toISOString()` | deterministic |
| `datePartsUtc(ms)` | `DateParts` | `Date` UTC getters | deterministic |
| `dateFromPartsUtc(y, m, d)` | `Int` (epoch ms) | `Date.UTC(y, m-1, d)` | deterministic |
| `weekdayUtc(ms)` | `Int` (0=Sun..6=Sat) | `new Date(ms).getUTCDay()` | deterministic |
| `dateFormatInZone(ms, tz, locale)` | `String` | `new Intl.DateTimeFormat(locale, { timeZone: tz, … }).format(new Date(ms))` | deterministic |

`DateParts = { year, month, day, hour, minute, second, weekday }` with `month` in `1..12`. Used
throughout Chapter 3 and in Recipes 58, 97, 100.

---

### Cryptography — Node `crypto`

| Wrapper | Returns | Wraps | Kind |
|---|---|---|---|
| `randomBytes(n)` | `Response<List<Byte>>` | `crypto.randomBytes(n)` | **effectful** (entropy) |
| `pbkdf2(pw, salt, iters, keyLen, digest)` | `Response<List<Byte>>` | `crypto.pbkdf2Sync(...)` | deterministic |
| `hmacSha256Hex(key, msg)` | `Response<String>` | `crypto.createHmac("sha256", key).update(msg).digest("hex")` | deterministic |
| `timingSafeEqual(a, b)` | `Bool` | `crypto.timingSafeEqual(Buffer(a), Buffer(b))` | deterministic |
| `aesGcmEncrypt(key, iv, plain)` | `Response<{ cipher, tag }>` | `crypto.createCipheriv("aes-256-gcm", key, iv)` | deterministic |
| `aesGcmDecrypt(key, iv, cipher, tag)` | `Response<String>` | `crypto.createDecipheriv("aes-256-gcm", key, iv)` (`Err` if tag fails) | deterministic |
| `sha256Hex(s)` | `String` | `crypto.createHash("sha256").update(s).digest("hex")` | deterministic |

Used in Recipes 91, 92, 94, 97, 98, 100.

---

### Bytes & Base64 — Node `Buffer`

| Wrapper | Returns | Wraps | Kind |
|---|---|---|---|
| `base64Encode(s)` | `String` | `Buffer.from(s,"utf8").toString("base64")` | deterministic |
| `base64Decode(s)` | `Response<String>` | `Buffer.from(s,"base64").toString("utf8")` | deterministic |
| `base64UrlEncode(bytes)` | `String` | `Buffer.from(bytes).toString("base64url")` | deterministic |
| `base64UrlToBytes(s)` | `Response<List<Byte>>` | `Buffer.from(s,"base64url")` → byte list | deterministic |
| `bytesToHex(bytes)` | `String` | `Buffer.from(bytes).toString("hex")` | deterministic |
| `hexToBytes(s)` | `List<Byte>` | `Buffer.from(s,"hex")` → byte list | deterministic |

Used in Recipes 91–94, 97, 98. (Recipe 98's `b64uBytes` is a one-line convenience that unwraps
`base64UrlToBytes` to a `List<Byte>`, returning `[]` on error.)

---

### Filesystem, paths, compression — Node `fs`, `path`, `os`, `zlib`

| Wrapper | Returns | Wraps | Kind |
|---|---|---|---|
| `readDir(path)` | `Response<List<String>>` | `fs.readdirSync(path)` | effectful |
| `isDirectory(path)` | `Bool` | `fs.statSync(path).isDirectory()` | effectful |
| `statSize(path)` | `Response<Int>` | `fs.statSync(path).size` | effectful |
| `statMtime(path)` | `Response<Int>` | `fs.statSync(path).mtimeMs` | effectful |
| `rename(src, dst)` | `Response` | `fs.renameSync(src, dst)` | effectful |
| `removeFile(path)` | `Response` | `fs.rmSync(path)` | effectful |
| `tempFilePath(forPath)` | `String` | sibling temp name (e.g. `forPath + "." + rnd + ".tmp"`) | effectful (uses randomness) |
| `watchDir(path, onEvent)` | `Response<WatcherHandle>` | `fs.watch(path, cb)` → calls `onEvent({ kind, path })` | effectful |
| `pathJoin(a, b)` | `String` | `path.join(a, b)` | deterministic |
| `pathExtname(p)` | `String` | `path.extname(p)` | deterministic |
| `gzipFile(src, dst)` | `Response` | stream `src` → `zlib.createGzip()` → `dst` | effectful |
| `gunzipFile(src, dst)` | `Response` | stream `src` → `zlib.createGunzip()` → `dst` | effectful |
| `gzipBytes(bytes)` / `gunzipBytes(bytes)` | `Response<List<Byte>>` | `zlib.gzipSync` / `zlib.gunzipSync` | deterministic |

Used in Chapter 5 (Recipes 42–49) and 44/46. The corpus already provides
`mkdirP`, `fileExists`, `readFile`/`writeFile`, and the `fileOpen` family; all
fallible native file operations return `Result<_, NativeError>`.

---

### HTTP extras and URLs — `fetch`/Node `http(s)`, `URL`, `form-data`

| Wrapper | Returns | Wraps | Kind |
|---|---|---|---|
| `httpPostJson(url, headers, value)` | `Response<{ status, body }>` | `fetch(url, { method:"POST", headers, body: JSON })` | effectful |
| `httpRequest(req)` | `Response<{ status, headers, body }>` | `fetch` with `AbortController` timeout | effectful |
| `httpDownload(url, destPath, onProgress)` | `Response` | streamed GET → file, `onProgress({received,total})` | effectful |
| `httpPostMultipart(url, fields, files)` | `Response<{ status, body }>` | `form-data` package + POST | effectful |
| `urlEncode(s)` | `String` | `encodeURIComponent(s)` | deterministic |
| `urlParse(s)` | `Response<{ scheme, host, port, path, query }>` | `new URL(s)` | deterministic |

`HttpReq = { method, url, headers, body, timeoutMs }`; `FilePart = { fieldName, filePath }`. Used in
Chapter 6 (Recipes 52, 54, 55, 56, 59). The corpus already provides `httpGet`, `httpGetBytes`,
`httpPost`, and the server-side `httpListen`/`req`/`res`.

---

### HTML parsing & sanitization — `jsdom`/`cheerio`, `sanitize-html`

| Wrapper | Returns | Wraps | Kind |
|---|---|---|---|
| `htmlParseTable(html, selector)` | `List<List<String>>` | parse DOM, read `<table>` rows/cells | deterministic |
| `htmlSelectAll(html, selector)` | `List<String>` | `querySelectorAll` → text contents | deterministic |
| `sanitizeHtml(html, allowedTags)` | `String` | `sanitize-html` with an allowlist | deterministic |

Used in Recipes 57 and 95. For escaping (not allowlisting), reuse `htmllib.pf`'s `escapeHtml`.

---

### Concurrency & timers — `Promise`, timers, `worker_threads`

| Wrapper | Returns | Wraps | Kind |
|---|---|---|---|
| `awaitAll(promises)` | `Response<List>` | `Promise.all(promises)` | effectful |
| `withTimeout(action, ms)` | `Response` | `Promise.race([action(), timeout(ms)])` | effectful |
| `setTimeoutId(ms, action)` | `Int` | `setTimeout(action, ms)` → timer id | effectful |
| `clearTimeoutId(id)` | — | `clearTimeout(id)` | effectful |
| `spawnWorker(scriptPath, message)` | `Response<result>` | `new Worker(scriptPath)` + message passing | effectful |

Used in Chapter 9 (Recipes 81–85) and Chapter 8 (Recipe 72). `awaitAll`, `spawnWorker`, and
first-class promise collection go beyond what the corpus demonstrates — see Appendix B.

---

### Environment & secrets — `process`, secrets manager

| Wrapper | Returns | Wraps | Kind |
|---|---|---|---|
| `getEnv(name)` | `Option<String>` | `process.env[name]` (`None` if undefined) | effectful |
| `vaultGet(path)` | `Response<String>` | a secrets-manager client (Vault/AWS/etc.) | effectful |

Used in Recipe 96. `requireEnv` (Recipe 96) is built in Pfun on top of `getEnv`.

---

### Runtime type tests & misc parsers

| Wrapper | Returns | Wraps | Kind |
|---|---|---|---|
| `isList(x)` | `Bool` | `Array.isArray(x)` | deterministic |
| `isDict(x)` | `Bool` | `typeof x === "object" && !Array.isArray(x)` | deterministic |
| `tomlParse(s)` | `Response<value>` | a TOML parser package | deterministic |

`isList`/`isDict` would be needed only to flatten or deep-merge *untyped* data (Recipes 33, 39); the
book prefers typed unions, which need no such test. See Appendix B for why no built-in type test
appears in the corpus.

---


## Appendix B — Missing or Undocumented Language Features

This appendix records places where the corpus is silent or ambiguous about a **language feature** (as
opposed to a library function, which Appendix A covers). Where a recipe leaned on one of these, it
flagged the dependency. Each entry states what the corpus *does* show, what remains uncertain, and the
plausible interpretations — in keeping with the instruction to demonstrate apparent behavior while
being explicit about the limits of the evidence.

### B1. No imperative loop statement (`while` / `for`)

**Observed.** The corpus contains no `while` or `for` *statement*. Every iteration is expressed by
recursion (often a recursive inner `proc`, e.g. `readAllLines`/`replLoop` in `example.pf` and
`tiny-lisp.pf`), by higher-order functions (`map`/`filter`/`reduce`), or by **list comprehensions**
(`[ e for x <- xs where p ]`, including multiple generators).
**Uncertain.** Whether an imperative loop keyword exists at all.
**Guidance.** This book uses recursion and comprehensions exclusively, matching the corpus. There is
no evidence a loop statement is missing from the language so much as *unused*; treat recursion as the
idiom regardless.

### B2. No record-update ("with") syntax

**Observed.** Updated records are rebuilt field by field. The TEA `update` functions in `client.pf`
and `counter.pf` construct an entirely new `Model { … }` listing every field, even to change one.
**Uncertain.** Whether a functional-update form (something like `Model { m | count = m.count + 1 }`)
exists.
**Guidance.** Assume not; rebuild records explicitly. This is the single biggest source of verbosity
in TEA-style code, so keep records small or group rarely-changed fields into sub-records.

### B3. Record field mutation

**Observed.** Mutation is shown for `var` bindings (`mutable_counter = 10`), dict entries
(`scores["Bob"] = 90`), and array elements (`arr[0] = 99`). A record may be bound with `var`
(`var r = Rect { 3, 4 };`).
**Uncertain.** Whether `r.w = 5` (in-place field assignment) is legal. The corpus never does it.
**Possibilities.** Either record fields are immutable (you must rebuild, per B2), or field assignment
on a `var` record is allowed but simply unused. **This book assumes records are immutable** and always
rebuilds them.

### B4. No runtime type reflection / type-test predicates

**Observed.** There is no `typeof`, `isList`, `isDict`, or pattern like `match x with | Int _ -> …`
on built-in types. Code that must distinguish shapes uses **discriminated unions** (e.g. `LispVal`,
`Block`/`Inline`, the `Db*` value variants) so the tag is explicit.
**Uncertain.** Whether any runtime type test exists for built-in types.
**Guidance.** Model heterogeneity with your own union types (Recipes 33, 39). Only reach for the
`isList`/`isDict` FFI wrappers (Appendix A) when forced to inspect genuinely untyped data.

### B5. Polymorphic types and "monomorphism" (the most important caveat)

**Observed.** `Option`, `Response`, and `Pair` are used polymorphically across many payload types. But
`dbschema_gen.pf` **deliberately avoids** reusing one generic union across different payloads in a
module, generating specialized result types instead, with explicit comments: *"avoids Option
monomorphism"*, *"Per-table result types to avoid monomorphism unification"*, and *"ParseResult —
avoids Option monomorphism. parse functions return this directly."* The language overview states
polymorphic unions are declared with a `generic type` keyword (e.g.
`generic type Response = { | Ok value | Err err };`).
**Uncertain.** The exact rule. The evidence suggests the type system **monomorphizes** union types and
can **unify** distinct uses of the same generic type, so reusing, say, `Option<A>` and `Option<B>` (or
a hand-rolled generic `Result`) in one module may cause a type error unless the type is declared
`generic`. It is unclear whether user types are polymorphic only when declared `generic`, or whether
even `generic` types have practical limits that motivated the generated per-type unions.
**Guidance.** Follow the corpus's lead: use the built-in `Option`/`Response`/`Pair` freely, but when a
*domain* result would otherwise reuse a generic union across incompatible payloads, **declare a
specialized union** (`type FindCustomerResult = { | FindCustomerOk : model | FindCustomerErr : message }`).
Chapter 8 is built around this idiom. If your toolchain supports `generic type`, prefer it for
genuinely reusable polymorphic types and fall back to specialization when unification bites.

### B6. Type annotations on bindings and parameters

**Observed.** No executable code annotates a binding or parameter with a type; types are **inferred**.
Type *names* appear only in generated comments in `dbschema_gen.pf`: `String`, `Int`, `Float`, `Bool`,
`Byte`, `List<Byte>`, `Option<String>` — implying named primitive types and a `Type<Param>` generic
syntax.
**Uncertain.** The syntax (if any) for annotating a `let`, a parameter, or a return type.
**Guidance.** Rely on inference, as the corpus does. The type names above are safe to reference in
prose and comments; do not invent annotation syntax.

### B7. Errors are values; no `try`/`catch`/`throw` in Pfun

**Observed.** All error handling uses `Option`, `Response` (`Ok`/`Err`), and specialized result
unions. The FFI converts a thrown JavaScript exception into `Err { message }` at the boundary. The
`Err` payload is read as `e.message` everywhere.
**Uncertain.** Whether Pfun has any exception construct of its own. None appears. The "crash" path for
programmer bugs is taken by evaluating a partial function such as `head([])` (used intentionally in
`dbschema_gen.pf`'s `unwrapParse`).
**Naming note.** The overview calls the failure variant `Error`/`err`; the corpus uniformly uses
`Err` and `e.message`. This book uses `Err`/`.message` to match the code.

### B8. First-class promises and parallel async

**Observed.** `async proc`, `await`, and `sleep` appear; every awaited call is awaited *immediately*
and *sequentially* (`http_example.pf`, `tea.pf`, the db demos). Procedures are first-class values
(`proctest.pf` stores and calls one), which is why this book passes `fn () => httpGet(url)` thunks to
retry/timeout helpers.
**Uncertain.** Whether an *un-awaited* `async proc` call yields a first-class awaitable value that can
be stored in a list and awaited later (needed for `Promise.all`-style parallelism), and whether any
parallel-combinator exists.
**Possibilities.** Either un-awaited async calls are first-class promises (so `map(httpGet, urls)`
launches them concurrently and `awaitAll` collects them — Recipe 81), or they are not, in which case
parallelism needs an explicit FFI primitive. Recipe 81 flags this; verify against your runtime.

### B9. Concurrency model: single-threaded, no built-in threads

**Observed.** The runtime is JavaScript's single-threaded event loop. No threads, workers, locks, or
shared-memory primitives appear in the corpus.
**Uncertain.** Whether Pfun surfaces Node's `worker_threads` natively.
**Guidance.** Treat Pfun as cooperatively concurrent (interleaving only at `await`). Recipe 87's lock
is a cooperative flag, not a mutex. True parallelism uses the `spawnWorker` FFI wrapper (Recipe 85),
which the corpus does not demonstrate.

### B10. `memo` semantics

**Observed.** `memo function` memoizes by argument; `fib` uses it in `example.pf` and
`golden_helper.pf`. All corpus uses take at least one argument.
**Uncertain.** Cache lifetime and eviction (per-process? bounded?), behavior for multi-argument keys,
and whether a zero-argument `memo function` works as a lazy singleton.
**Guidance.** Use `memo` for pure functions whose results are stable for given arguments. For a
lazily-initialized *singleton* with effects, use the `var`-plus-`Option` cell of Recipe 88 rather than
relying on unspecified zero-arg `memo` behavior. For time-bounded caching, use the TTL dict of Recipe
84 (`memo` has no expiry).

### B11. Division semantics of `/`

**Observed.** `10 / 4` and `7b / 2b` appear but results are never printed; `tiny-lisp.pf` uses `/` as
integer arithmetic (`LInt { a.n / b.n }`); `mathutils.safeDivide` returns `a / b`.
**Uncertain.** Whether `/` on two integers truncates or yields a float.
**Guidance.** For fractional results, convert with `toFloat` first (as `client.pf` does:
`toInt(toFloat(model.addA))`). This book defines an explicit `idiv(a, b) = toInt(toFloat(a)/toFloat(b))`
(Chapter 4) wherever integer division is intended, to avoid the ambiguity entirely.

### B12. `nth` / `head` out-of-bounds and partial functions

**Observed.** `nth(nums2, 99)` (out of range) is printed in `example.pf` but its value is not shown;
`head([])` is used intentionally to crash in `dbschema_gen.pf`.
**Uncertain.** Whether `nth` out-of-range returns a sentinel, `None`, or crashes; `head([])` appears
to crash (used as a deliberate failure).
**Guidance.** Bounds-check before `nth`/`head`, or use `find`/`Option`-returning helpers for safety.
Reserve `head([])`-style crashes for asserting invariants (Recipe 74).

### B13. Truthiness beyond `Bool`

**Observed.** `if flag then …` with `flag = 0xFFb` works in `example.pf` (a non-zero byte is truthy);
guards like `| b where b -> …` and `| b where !b -> …` are used on bools.
**Uncertain.** The full truthiness rules (are `0`, `""`, `[]`, `None` falsy?).
**Guidance.** Use explicit `Bool` conditions. Relying on non-`Bool` truthiness is evidenced only for
bytes; do not assume JavaScript-style truthiness for other types.

### B14. Constructing nullary union variants: bare name vs. lowercase constructor

**Observed.** Nullary variants are used as **bare values**: `ServerPong`, `CmdNone`, `None`,
`ClientPing`, `PageAbout`. They are also matched bare (`| ClientPing -> …`) or with an ignored payload
(`| ClientPing _ -> …`). Separately, `server_a.pf`/`client_a.pf` call **lowercase functions**
`serverPong()` and `clientPing()` that are not defined in the imported `protocol.pf`.
**Uncertain.** Whether Pfun auto-generates a lowercase constructor function per variant, or whether
those are helpers defined elsewhere. (`cmdNone()` in `tea.pf` *is* a hand-written
`function cmdNone() { CmdNone; }`, suggesting the lowercase forms might be a manual convention rather
than automatic.)
**Possibilities.** (a) The compiler generates a lowercase zero-arg constructor for each variant; or
(b) the `_a` files rely on hand-written helpers analogous to `cmdNone`. This book uses the **bare
variant name** (`ServerPong`, `CmdNone`), which is unambiguously evidenced, and notes that `match`
accepts both `| Foo` and `| Foo _` for nullary variants.

### B15. Is `let` lazy?

**Observed.** `example.pf` names a binding `let lazy_constant = 100;`. `let` is otherwise used as a
plain immutable binding everywhere.
**Uncertain.** Whether the name hints at lazy evaluation of `let` bindings, or is merely a variable
name.
**Guidance.** Treat `let` as an **eager, immutable** binding (the overwhelming usage). Laziness in the
corpus is a property of **lists** (`iterate`/`take`), not of `let`. Do not assume `let` is lazy
without further evidence.

### B16. String ordering with relational operators

**Observed.** `<`/`>` are used on numbers (and bytes); string equality uses `==`. No code uses `<`/`>`
to order strings.
**Uncertain.** Whether `<`/`>` are defined (lexicographically) on strings.
**Guidance.** This book's `cmpStr` (Chapter 4) compares by code point via `asc(nth(...))` rather than
assuming string `<`, so multi-key sorting works regardless of whether relational operators support
strings.

### B17. Whole-collection equality and `dict`/`array` value identity

**Observed.** `==` works structurally on records (`find(pts, SearchPt { 3, 4 })`), lists/strings
(`s == reverse(s)`, `remaining == []`), and primitives.
**Uncertain.** Equality semantics for `dict` and `array` (structural vs. reference), and ordering
guarantees of `keys`/`values`/`dictToList`.
**Guidance.** Do not rely on `dict`/`array` `==` or on a particular key ordering; if you need ordered
iteration, sort `keys` explicitly (Chapter 4).

---


## Appendix C — Built-in Quick Reference

A consolidated reference of the syntax, prelude functions, standard modules, and reusable libraries
evidenced in the corpus. Items whose details are uncertain are marked “(?)” and cross-referenced to
Appendix B.

### Literals

```pfun
42            -7            1000000000000      // Int (arbitrary precision)
3.14          0.0           2.0                // Float
0b   128b     0xFFb   0xF0b                    // Byte (suffix b; hex with 0x)
'A'  '\n' '\t' '€'                             // Char (code points via asc/chr)
"text\n"      "he said \"hi\""                 // String (escapes)
@"C:\re\gex"  @"\d+\.\d+"                       // Raw string (no escapes)
$"hi {name}, {1 + 2}"   $"brace \{ \}"          // Interpolated string
true   false                                   // Bool
[1, 2, 3]                                       // List (immutable; may be lazy/infinite)
array { "a", "b" }                              // Array (mutable)
dict { "k" -> 1, "j" -> 2 }     dict { }        // Dict (mutable)
```

### Declarations & keywords

```pfun
let x = 1;                 // immutable binding
var y = 0;  y = y + 1;     // mutable binding (reassignable)
function f(a, b) { ... }   // pure function (return or implicit last expression)
fn a, b => a + b           // lambda;  fn (x) => { ...; expr; } for a block body
proc p(a) { ... }          // procedure (effects)
async proc q(a) { await ...; }   // async procedure
memo function m(n) { ... } // memoized pure function (B10)
type T = { a, b }                          // record type
type U = { | V1 : f | V2 : g, h | V3 }     // discriminated union (V3 is nullary)
generic type Response = { | Ok value | Err err };   // polymorphic union (B5)
import * from "io";        import * from "./local";
import { a as b } from "./m";   import * as M from "./m";
export function ...        export let ...   export proc ...   export type ...
```

### Operators & forms

```pfun
+  -  *  /  %                  // arithmetic ( / division semantics: see B11 )
== != <  >  <=  >=             // comparison (structural == on records/lists/strings)
&& || !                        // logical
&  |  << >>                    // bitwise (Int and Byte)
cond ? a : b                   // ternary
+                              // also concatenates Strings and Lists
a[i]      a[i] = v             // index read / write (array, dict)
rec.field                      // field / variant-payload access
if c then e else e             // expression; also `if c then { } else { }` and `if c then return x`
match v with | Pat -> e | Pat where guard -> e | _ -> e ;   // pattern match (expression)
[ e for x <- xs where p ]      // list comprehension (multiple `for`/`where` allowed)
```

### Prelude — sequences (work on Lists *and* Strings)

`head` · `tail` · `cons` · `nth(seq, i)` · `length` · `reverse` · `slice(start, len, seq)` ·
`map(fn, seq)` · `filter(pred, seq)` · `reduce(fn(acc,x), init, seq)` · `take(n, seq)` ·
`iterate(fn, seed)` · `repeat(x)` · `cycle(list)` · `find(seq, x) -> Option{value=elem}` ·
`findSlice(seq, sub) -> Option{value=index}` · `isInfinite(seq)`

> All of the above are curried/partially-applicable (e.g. `map(f)`, `take(5)`, `reduce(f, 0)`).
> Iterating a String directly yields **chars**; `split(s, "")` yields **one-char strings** (Ch. 1).

### Prelude — strings, numbers, conversions

`split(s, delim)` · `join(list, delim)` · `asc(char)` · `chr(int)` · `__str__(x)` ·
`toInt` · `toFloat` · `toByte` · `toChar` · `charBytes(char)` · `bytesToChar(bytes)` ·
`range(lo, hi)` (list; inclusivity (?), see B-note in Ch. 3)

### Prelude — arrays & dicts

Arrays: `arrayLength` · `append(arr, x)` · `insertAt(arr, i, x)` · `removeAt(arr, i)` ·
`toList(arr)` · `toArray(list)` · `toDict(arr)`
Dicts: `has(d, k)` · `remove(d, k)` · `keys(d)` · `values(d)` · `dictToList(d)` (→ list of `Pair`) ·
`listToDict(pairs)`

### Built-in types

```pfun
Option   = { | Some value | None }                  // s.value
Response = { | Ok value | Err err }                 // o.value / e.message  (B7)
Pair     = { key, value }                            // Pair { k, v } or Pair(key=, value=)
// file line/byte reads add a third variant: { | Ok value | Eof | Err err }
```

### Standard modules

| Module | Provides |
|---|---|
| `io` | `print(s)`, `println(s)`, `readln() -> Option<String>`, `flushStdout()` |
| `file` | `readFile -> Result<_, NativeError>`, `writeFile -> Result<_, NativeError>`, `fileOpen(path, Read\|Write\|Append) -> Result<_, NativeError>`, `fileClose`, `readLine -> ReadOk/ReadEof/ReadErr`, `writeLine`, `readBytes(h,n) -> ReadOk/ReadEof/ReadErr`, `writeBytes(h, bytes)`, `readBuffer(h, n, CharMode\|ByteMode)`, `bufferToString`, `bufferLength`, `bufferToBytes`, `fileExists -> Result<Bool, NativeError>`, `mkdirP -> Result<_, NativeError>` |
| `json` | `jsonSerialize(v) -> Option<String>`, `jsonDeserialize(s) -> Option<value>` (uses `__pfun` tags to round-trip records/unions) |
| `http` | client: `httpGet(url)`, `httpGetBytes(url)`, `httpPost(url, v)` (all `Response`, awaited); server: `httpListen(port, handler)`, `req.{method,path,query,body,bodyBytes}`, `res.text(s,b)` / `res.json(s,v)` / `res.bytes(s,bytes,ct)` |
| `async` | `sleep(ms) -> Result<Unit, NativeError>`, `await`, `async proc` |
| `math` | `sqrt`, `pow`, `abs`, `round`, `lerp` |
| `db/postgresql`, `db/mariadb` | `dbConnect(connStr) -> Response<Conn>`, `dbQuery(conn, sql, params) -> Response<{rowCount, rows}>`, `dbClose(conn) -> Response`; params/values: `DbText` · `DbInt` · `DbFloat` · `DbBool` · `DbBytes` · `DbNull`; a row is a list of `Pair { key=column, value=Db* }` (Postgres `$1` placeholders; MariaDB `?`) |

### Reusable libraries in the corpus (callable from your code)

| Library | Highlights |
|---|---|
| `mathutils.pf` | `add`, `subtract`, `multiply`, `fact`, `countdown`, `safeDivide` (→ `Option`), `clamp(value, lo, hi)`, `tau`, `printResult` (proc) |
| `htmllib.pf` | HTML ADTs `Inline`/`Block`/`Field`/`Document`; `escapeHtml`, `escapeAttr`; `renderBlock`/`renderInline`/`renderDocument`; constructors `text`, `emph`, `strong`, `code`, `link`, `form`, fields |
| `viewlib.pf` | interactive `View` ADT; `vtext`, `vbutton`, `vdiv`, `vspan`, `vinput`, `vcheckbox`, `vselect`, `vcontent`, `vdivClass`; `renderView` |
| `tea.pf` | The Elm Architecture runtime; `Cmd` (`CmdNone`/`Send`), `cmdNone()`, `run(init, view, update)`, `render`, `executeCmd`, `collectHandlers` |
| `domlib.pf` | `mount(doc)`, `mountBlock(b)`, `mountBlocks(bs)` |
| `protocol.pf` | shared `ClientMsg` / `ServerMsg` unions for client+server |
| `dbschema.pf` | schema introspection: `loadSchema`, `loadTable`, `loadColumns`, `loadConstraints`; types `PgType`, `Column`, `Constraint`, `Table`; row helpers `getStr`, `getBool`, `getOptStr`; `endsWith` |
| `dbschema_utils.pf` | `fingerprintSchema`, `fingerprintTable`, `loadLookupValues`, `loadAllLookupValues` |
| `golden_helper.pf` | `square`, `add`, `sumTo`, `fib` (memoized), `greeting` |

### Programs & applications (illustrative, not libraries)

`hello.pf`, `example.pf`, `golden.pf` (language tours); `tiny-lisp.pf` (parser/evaluator —
tokenizer, recursive descent, environments); `counter.pf`, `hello_web.pf`, `client.pf`/`client_a.pf`,
`server.pf`/`server_a.pf`, `http_example.pf` (web/HTTP demos); `dblib*.example.pf`, `dbschema_demo.pf`,
`dbschema_gen.pf` (database demos and a code generator); `proctest.pf` (procedures as values);
`app.pf`, `dbschema_config.pf` (configuration); `schema_setup.sql` (the demo database schema).

---

*End of the Pfun Programming Cookbook.*
