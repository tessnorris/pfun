# The Pfun Programming Language — Reference Manual

*A practical reference and learning guide for the Procedural‑FUNctional language.*

---

## Table of Contents

- [Introduction](#introduction)
  - [What Pfun is](#what-pfun-is)
  - [The central idea: the purity boundary](#the-central-idea-the-purity-boundary)
  - [Two paradigms, one language](#two-paradigms-one-language)
  - [The type system at a glance](#the-type-system-at-a-glance)
  - [Functional vs. procedural at a glance](#functional-vs-procedural-at-a-glance)
  - [How to read this manual](#how-to-read-this-manual)
- [Part I — Functional Programming](#part-i--functional-programming)
  - [1. Lexical foundations](#1-lexical-foundations)
  - [2. Values, types, and the type system](#2-values-types-and-the-type-system)
  - [3. Expressions and operators](#3-expressions-and-operators)
  - [4. Strings and characters](#4-strings-and-characters)
  - [5. Pure functions and lambdas](#5-pure-functions-and-lambdas)
  - [6. Immutable collections](#6-immutable-collections)
  - [7. Lazy and infinite lists](#7-lazy-and-infinite-lists)
  - [8. Records and the Pair type](#8-records-and-the-pair-type)
  - [9. Discriminated unions and Option](#9-discriminated-unions-and-option)
  - [10. Pattern matching with `match`](#10-pattern-matching-with-match)
  - [11. Modules and imports](#11-modules-and-imports)
- [Part II — Procedural Programming](#part-ii--procedural-programming)
  - [12. Procedures](#12-procedures)
  - [13. Mutable bindings and assignment](#13-mutable-bindings-and-assignment)
  - [14. Statement control flow](#14-statement-control-flow)
  - [15. Mutable collections: dictionaries and arrays](#15-mutable-collections-dictionaries-and-arrays)
  - [16. Console input and output](#16-console-input-and-output)
  - [17. Result-based error handling](#17-result-based-error-handling)
  - [18. Asynchronous procedures](#18-asynchronous-procedures)
- [Part III — Standard Libraries](#part-iii--standard-libraries)
  - [19. Core built-in functions](#19-core-built-in-functions)
  - [20. Built-in types](#20-built-in-types)
  - [21. `io` — console I/O](#21-io--console-io)
  - [22. `file` — files and binary I/O](#22-file--files-and-binary-io)
  - [23. `math`](#23-math)
  - [24. `json`](#24-json)
  - [25. `async`](#25-async)
  - [26. `http`](#26-http)
  - [27. `db/postgresql` and `db/mariadb`](#27-dbpostgresql-and-dbmariadb)
  - [28. Bundled libraries: the web stack](#28-bundled-libraries-the-web-stack)
- [Appendix A — Reserved words and symbols](#appendix-a--reserved-words-and-symbols)
- [Appendix B — Known gaps and ambiguities](#appendix-b--known-gaps-and-ambiguities)

---

# Introduction

## What Pfun is

Pfun — short for **Procedural‑FUNctional** — is a general‑purpose programming
language built around a single, opinionated design decision: **the pure
functional world and the effectful procedural world are kept rigorously
separate, and the separation is enforced by the language rather than left to
discipline.**

A Pfun program is, in effect, a *lazy, immutable, statically‑checked functional
core* wrapped in a *strict, mutable, side‑effecting procedural shell*. You write
the parts of your program that compute values — parsing, transformation,
business rules, rendering — as **pure functions**. You write the parts that
touch the outside world — printing, reading files, serving HTTP, mutating
state — as **procedures**. The compiler knows which is which and refuses to let
them blur together.

The corpus shows Pfun running in two execution modes from a single source
language:

- A command‑line interpreter (`pfun program.pf`) and an ahead‑of‑time compiler
  (`pfc build program.pf -o program`) that must produce byte‑identical output
  (see `golden.pf`, the conformance program).
- A browser/server mode (`pfun --serve app.pf`) that compiles a program to a
  JavaScript bundle and serves it, enabling full‑stack single‑page applications
  written entirely in Pfun.

## The central idea: the purity boundary

Every callable in Pfun is declared with one of three keywords, and the keyword
fixes its capabilities:

| Keyword | Kind | Side effects? | Evaluation of arguments | Memoizable | May call... |
|---|---|---|---|---|---|
| `function` | pure function | **No** | lazy | with `memo` | other `function`s / `fn`s |
| `fn` | anonymous pure lambda | **No** | lazy | — | other `function`s / `fn`s |
| `proc` | procedure | **Yes** | strict | never | functions **and** procedures |

The rules that make the boundary real (all quoted behavior is stated explicitly
in `example.pf`):

- A `function` **cannot** use `print`, **cannot** declare a `var`, and
  **cannot call a procedure**. Violating any of these is a compile‑time error
  (`"Functions cannot use 'print'"`, `"Functions cannot use 'var'"`).
- A `proc` may do anything: print, mutate, call other procedures, *and* call
  pure functions.
- Therefore **calls flow one way**: procedures may call functions, but functions
  may never call procedures.

This one‑way boundary is what gives the functional core its guarantees. Because a
pure function cannot observe or cause effects, the language is free to evaluate
its arguments lazily, cache its results (`memo`), eliminate its tail calls, and
reorder or skip work — all without changing observable behavior. The procedural
shell is where ordering, mutation, and I/O actually happen, in a predictable
top‑to‑bottom sequence.

The Pfun web framework (`tea.pf`) states the philosophy in one line:

> `view` and `update` stay pure. `run()` is the one proc that owns all mutation.

## Two paradigms, one language

Pfun is genuinely multiparadigmatic, but the two paradigms are not peers sitting
side by side — they are **layered**. The functional layer is the *inside* (values,
types, transformations); the procedural layer is the *outside* (effects,
sequencing, the connection to the real world). Idiomatic Pfun pushes as much
logic as possible into the pure layer and keeps the procedural shell thin.

**Features that support the functional paradigm**

- Pure `function`/`fn` with lazy arguments and referential transparency.
- Immutable `let` bindings and immutable lists and records.
- First‑class functions, closures, currying / partial application.
- Tail‑call optimization (TCO) and `memo` memoization.
- Lazy evaluation, including genuinely infinite lists.
- Algebraic data types (records and discriminated unions) and `match`
  expressions with exhaustiveness checking.
- `Option`/`Result` for total, exception‑free error handling.
- List comprehensions and a rich higher‑order function library
  (`map`/`filter`/`reduce`/`iterate`/…).

**Features that support the procedural paradigm**

- `proc` and `async proc` with arbitrary side effects.
- Mutable `var` bindings and assignment.
- Mutable collections: `dict` and `array`.
- Statement sequencing, `if` without `else`, and early `return`.
- Console, file, network, and database I/O.
- `async`/`await` cooperative concurrency.

Recursion — not loops — is the universal iteration mechanism in **both** layers;
Pfun has no `while` or C‑style `for` statement. Deep recursion is made practical
by tail‑call optimization.

## The type system at a glance

Pfun is statically typed with **Hindley–Milner‑style type inference**: you rarely
write a type annotation, yet the compiler reconstructs and checks types
throughout. Several characteristics give the type system its particular flavor:

- **Inferred‑but‑fixed nominal data types.** A `type` declaration lists only
  *names* — field names for a record, variant names for a union — never field
  types. The compiler infers each field's type from first use and then enforces
  it everywhere. Once `Square { 10 }` fixes `side` to be an integer, a later
  `Square { "ten" }` is a *Type mismatch* error.
- **Monomorphic data constructors.** Inference unifies the payload type of a
  given constructor across a module. The database libraries note this directly:
  using the built‑in `Ok`/`Err` for several functions that return *different*
  payload types in one file makes inference "unify all `Ok.value` types," so the
  idiom is to declare a dedicated named result union per distinct payload (see
  [§17](#17-result-based-error-handling)). Generic constructors like `Some`/`Ok`
  are perfectly usable when the payload type is consistent within an inference
  context.
- **Exhaustiveness checking.** `match` on a union must handle every variant (or
  carry a wildcard); `match` on a known scalar must be provably total. Missing
  cases are caught at compile time where statically determinable.
- **Enforced purity.** The function/procedure boundary described above is part
  of the static checking, not a runtime convention.
- **No implicit numeric coercions between distinct scalar types.** `Int`,
  `Float`, `Byte`, and `Char` are distinct; conversions are explicit
  (`toInt`, `toFloat`, `toByte`, `toChar`, `asc`, `chr`). The one automatic
  promotion is mixing `Int` and `Float` in arithmetic, which yields `Float`.

The practical guarantee: if a Pfun program compiles, every `match` is complete,
every record field has a consistent type, no pure function secretly performs
I/O, and no immutable binding is reassigned.

## Functional vs. procedural at a glance

| Concern | Functional layer | Procedural layer |
|---|---|---|
| Declaration | `function`, `fn`, `memo function` | `proc`, `async proc` |
| Binding | `let` (immutable, lazy) | `var` (mutable, strict) |
| Effects | forbidden | allowed |
| Collections | lists, records (immutable) | `dict`, `array` (mutable) |
| Error handling | return `Option`/`Result` values | `match` on `Result`, print/branch |
| Iteration | recursion, HOFs, comprehensions | recursion, sequenced statements |
| `match` | an expression that yields a value | also usable as a statement |
| `if` | requires `else` (must yield a value) | `else` optional (statement) |
| Memoization | available (`memo`) | never |

## How to read this manual

Part I documents the **pure expression language** — the functional core. Because
values, types, and expressions are themselves pure, this is also where the
foundational material (lexical structure, the type system, literals, modules)
lives. Part II documents the **procedural shell** — the constructs that add
mutation, sequencing, and effects on top of that core. Part III is a systematic
**library reference**: every built‑in function and every standard module.

Throughout, examples are drawn from the Pfun source corpus and adapted where a
smaller illustration is clearer. Where the corpus does not pin down a detail,
the text says so rather than guessing.

---

# Part I — Functional Programming

This part describes the pure, value‑oriented core of Pfun: the lexical rules,
the data model, expressions, pure functions, immutable collections, lazy
evaluation, algebraic data types, and pattern matching. Everything here is
usable inside a `function` because none of it performs side effects.

## 1. Lexical foundations

### 1.1 Comments

Pfun has C‑style comments:

```pfun
// single-line comment

/*
  multi-line comment
*/
```

Multi‑line comments are used heavily for documentation blocks in the corpus.

### 1.2 Statements, blocks, and semicolons

Statements and expression‑statements are terminated with `;`. A block is a
brace‑delimited sequence of statements whose value is its final expression:

```pfun
let g = fn (y) => {
  let z = y * y;
  z + 2;          // value of the block (and of the lambda)
};
```

A function or procedure body is such a block. The value of the body is the value
of its last expression, so an explicit `return` is optional in tail position
(see [§5.2](#52-returning-values)).

### 1.3 Identifiers and naming conventions

Identifiers are case‑sensitive. The corpus follows consistent conventions you
will see throughout:

- `camelCase` for functions, procedures, and bindings (`safeDivide`,
  `mutableCounter`, `renderBlock`).
- `PascalCase` for `type` names, record constructors, and union variants
  (`Point`, `Shape`, `Circle`, `ServerPong`).
- Leading‑and‑trailing double underscores for compiler/runtime built‑ins
  (`__str__`, and the `__type`/`__pfun`/`__union` tags used by JSON
  serialization).

### 1.4 Literals

| Kind | Examples | Notes |
|---|---|---|
| Integer (`Int`) | `0`, `42`, `10000` | arbitrary precision (see [§2](#2-values-types-and-the-type-system)) |
| Hex integer | `0xFF`, `0x20AC`, `0xF0` | |
| Float | `2.0`, `12.5`, `0.0`, `0.25` | |
| Byte | `0b`, `128b`, `255b`, `0xFFb`, `0x00b` | suffix `b`; decimal or hex |
| Char | `'a'`, `'\n'`, `'\t'`, `'\\'`, `'\''` | single‑quoted, one character |
| String | `"hello"`, `"He said \"hi\""` | double‑quoted; supports escapes |
| Raw string | `@"C:\Users\Alice"` | `@` prefix; no escape processing |
| Format string | `$"Name: {name}"` | `$` prefix; interpolates `{…}` holes |
| Boolean | `true`, `false` | |
| List | `[1, 2, 3]`, `[]` | immutable |

Strings, raw strings, and format strings are covered in detail in
[§4](#4-strings-and-characters).

## 2. Values, types, and the type system

Pfun's data model is small and orthogonal. This section catalogs the value kinds
and the guarantees the type system provides.

### 2.1 Scalar types

- **`Int`** — an **arbitrary‑precision** integer. Integer literals have no width
  limit; `golden.pf` computes `factorial(30)` =
  `265252859812191058636308480000000` and `square(1000000000000)` = 10²⁴
  directly. Integer division **truncates** toward zero (`10 / 4` → `2`), and
  `%` is the remainder (`17 % 5` → `2`).
- **`Float`** — a double‑precision floating‑point number. Mixing an `Int` and a
  `Float` in arithmetic promotes the result to `Float` (`2.0 + 3` → `5.0`). This
  is the only implicit numeric coercion.
- **`Byte`** — a distinct 8‑bit value in the range 0–255, written with a `b`
  suffix. `Byte` is separate from `Int` and `Char`; there are no implicit
  conversions. Byte arithmetic is range‑checked and errors on overflow or
  underflow. `0b` is falsy and any non‑zero `Byte` is truthy. (See
  [§4.6](#46-bytes) and [§22](#22-file--files-and-binary-io).)
- **`Char`** — a single Unicode character (`'A'`), distinct from a one‑character
  string. Convert with `asc` (char → code point) and `chr` (code point → char).
- **`Bool`** — `true` or `false`.

### 2.2 Composite types

- **String** — semantically a *list of `Char`* (see [§4](#4-strings-and-characters)).
- **List** — an immutable, possibly lazy sequence (see
  [§6](#6-immutable-collections) and [§7](#7-lazy-and-infinite-lists)).
- **Record** — a named product type with named fields (see
  [§8](#8-records-and-the-pair-type)).
- **Discriminated union** — a named sum type with named variants (see
  [§9](#9-discriminated-unions-and-option)).
- **Dictionary** and **Array** — mutable collections; procedural, covered in
  [§15](#15-mutable-collections-dictionaries-and-arrays).

### 2.3 How the inferred nominal type system works

A `type` declaration provides only the *shape* — the field or variant names:

```pfun
type Point = { x, y, z };          // field names only, no field types
type Shape = {                     // variant names (+ their field names)
  | Square: side
  | Circle: radius
  | Rectangle: x, y
}
```

The compiler infers the type of each field from the way the constructor is first
used, then **fixes** it and checks every other use against it. From `example.pf`:

> Type consistency is enforced per variant: once the first `Square` is
> constructed with a bigint side, all future `Square`s must also have a bigint
> side. Different variants are completely independent.

```pfun
var sq  = Square { 10 };       // fixes Square.side : Int
// var bad = Square { "ten" }; // ERROR: field 'side' expected bigint, got string
```

This yields nominal typing (two record types with the same field names are still
different types) with the ergonomics of inference (you never spell the field
types out).

### 2.4 Monomorphic constructors (an important subtlety)

Because inference unifies the payload type of a constructor across a module,
**a given union constructor effectively has one payload type per module.** The
`dbschema` sources call this out explicitly:

> Using `Ok`/`Err` directly causes HM inference to unify all `Ok.value` types
> across the file. Dedicated result types keep each return type separate.

The practical consequences and the idiom:

- Using a built‑in generic constructor (`Some`, `Ok`, …) is fine when every use
  in the relevant inference context carries the same payload type.
- When several functions in one module must return *different* payloads, declare
  a distinct named union for each, instead of reusing `Ok`/`Err`:

```pfun
// Each loader returns a different payload, so each gets its own result union:
export type ColsResult  = { | ColsOk  : columns | ColsErr  : message }
export type ConsResult  = { | ConsOk  : cons    | ConsErr  : message }
export type TableResult = { | TableOk : table   | TableErr : message }
```

Based on available examples, this is the single most important type‑system habit
to internalize when writing larger Pfun modules.

### 2.5 Guarantees provided

If a program type‑checks, Pfun guarantees:

- Every `match` is exhaustive (or has a wildcard) — see
  [§10](#10-pattern-matching-with-match).
- Every record/variant field has a single consistent type program‑wide.
- No `function`/`fn` performs I/O, mutation, or calls a procedure.
- No `let` binding is reassigned.
- Arrays are homogeneous (enforced at construction and on every mutation).
- `Byte` values stay in range (range‑checked arithmetic; `toByte` errors out of
  range).

## 3. Expressions and operators

### 3.1 Arithmetic and bitwise

| Operator | Meaning | Notes |
|---|---|---|
| `+` `-` `*` | add, subtract, multiply | `Int`, `Float`, `Byte` |
| `/` | division | integer division truncates; `Byte/Byte` truncates |
| `%` | remainder | |
| `&` `\|` | bitwise AND / OR | `Int` and `Byte` |
| `<<` `>>` | left / right shift | `Int`; `Byte` masks the shift amount to 3 bits |

`+` is also string concatenation and, when either operand is a string, converts
the other operand to a string automatically (see [§4](#4-strings-and-characters)).

```pfun
println(10 / 4);        // 2   (integer division truncates)
println(2.0 + 3);       // 5.0 (mixed -> float)
println(17 % 5);        // 2
println(0xF0b | 0x0Fb); // 255 (byte bitwise OR)
println(1 << 10);       // 1024 (int shift)
println(0xFF & 0x0F);   // 15
```

### 3.2 Comparison and logical

`==` `!=` `<` `>` `<=` `>=` compare and yield `Bool`. Equality is **deep value
equality**, not reference identity — this is what makes `find` work on records
and what lets `find(pts, SearchPt { 3, 4 })` locate a structurally equal record.

Logical operators are `&&`, `||`, and unary `!`:

```pfun
let is_equal   = (a == b);
let is_greater = (b > a);
println(a < counter && counter > 0);
```

### 3.3 The ternary operator

`cond ? then_value : else_value` is a pure conditional expression, usable
anywhere — including inside pure functions. It nests:

```pfun
function clamp(lo, hi, x) {
  return x < lo ? lo : (x > hi ? hi : x);
}
```

### 3.4 `if`/`then`/`else` as an expression

`if cond then a else b` is also an expression and is interchangeable with the
ternary form in pure code:

```pfun
function pgTypeFromString(s) {
  if s == "text"             then PgText
  else if s == "integer"     then PgInteger
  else if s == "boolean"     then PgBoolean
  else PgOther { s };
}
```

In a pure (value‑producing) context, the `else` branch is mandatory — the
expression must yield a value on every path. (In procedural code, `if` may be
used as a statement with no `else`; see [§14](#14-statement-control-flow).)

### 3.5 Observed precedence

Precedence, as evidenced by unparenthesized usage in the corpus, from highest to
lowest:

1. unary `!`, unary `-`
2. `*` `/` `%`
3. `+` `-`
4. comparisons `<` `>` `<=` `>=`
5. equality `==` `!=`
6. `&&`
7. `||`
8. ternary `? :`

The relative precedence of the bitwise operators (`&`, `|`, `<<`, `>>`) against
the comparison operators is **not** clearly fixed by the corpus, which always
writes bitwise expressions in isolation or in parentheses (e.g.,
`0xF0b | 0x0Fb`). When mixing bitwise operators with arithmetic or comparison,
parenthesize explicitly.

## 4. Strings and characters

### 4.1 Strings are lists of characters

A string is, semantically, a list of `Char`. Every list operation that makes
sense on a sequence of characters works on strings, and returns a string when
the result is itself a sequence of characters:

```pfun
let greeting = "hello";
println(head(greeting));               // h
println(tail(greeting));               // ello
println(cons('H', tail(greeting)));    // Hello
println(filter(fn c => c != 'l', "hello")); // heo
println(reverse("hello"));             // olleh
println(length("hello"));              // 5
println(slice(1, 3, "hello"));         // ell
println(nth("hello", 1));              // e
```

### 4.2 Escapes

String escapes: `\"`, `\\`, `\n`, `\t`. Char escapes: `'\n'`, `'\t'`, `'\\'`,
`'\''`. For example, `asc('\n')` is `10` and `asc('\t')` is `9`.

### 4.3 Raw string literals (`@"…"`)

A string prefixed with `@` is a **raw** literal: backslash sequences are taken
literally, character for character. This is ideal for Windows paths, regular
expressions, and help text:

```pfun
let winPath = @"C:\Users\Alice\Documents\notes.txt";
let pattern = @"\d+\.\d+";
let normal = "newline: \n";    // contains an actual newline
let raw    = @"newline: \n";   // contains the two characters '\' and 'n'
println(length(normal));       // 10
println(length(raw));          // 11
```

### 4.4 Format strings (`$"…"`)

A string prefixed with `$` interpolates `{expression}` holes into the surrounding
text, auto‑converting each value to a string. It is **pure** syntactic sugar for
concatenation — no printing is implied — so it is usable inside `function`s:

```pfun
let name = "Alice";
let age  = 30;
let line = $"Name: {name}, Age: {age}";   // "Name: Alice, Age: 30"

type Vec = { x, y, z }
let v = Vec { 1, 2, 3 };
let desc = $"Vec({v.x}, {v.y}, {v.z})";   // "Vec(1, 2, 3)"

// Escaped braces produce literal { and }:
let tmpl = $"template: \{value\}";        // "template: {value}"
```

Record‑field holes (`{rec.field}`) are supported, as are the usual escapes. A
common pattern is to build a string with `$` and hand it to `print`/`println`:
`print($"x1 = {x1}\n")`. (The corpus also references a legacy interpolating
`printf("…{x}…")`, but `$` format strings are the form used throughout and the
recommended approach.)

### 4.5 `split` and `join`

```pfun
split(str, delimiter)   // -> list of strings; "" delimiter splits into chars
join(list, delimiter)   // -> string; elements auto-converted to strings
```

Both are pure:

```pfun
println(split("one two three", " ")); // [one, two, three]
println(split("hello", ""));          // [h, e, l, l, o]
println(join(["a", "b", "c"], "-"));  // a-b-c
println(join([1, 2, 3], ", "));       // 1, 2, 3
```

`htmllib.pf` uses `split`/`join` to build a pure HTML‑escaper — a good
illustration of string processing without any mutable state:

```pfun
export function escapeHtml(s) {
  let s1 = join(split(s,  "&"),  "&amp;");
  let s2 = join(split(s1, "<"),  "&lt;");
  let s3 = join(split(s2, ">"),  "&gt;");
  join(split(s3, "\""), "&quot;");
}
```

### 4.6 Bytes and characters

`Char`↔`Byte` and `Char`↔UTF‑8 conversions are pure:

```pfun
asc('A');                 // 65   (Char -> Int code point)
chr(65);                  // 'A'  (Int -> Char)
charBytes('€');           // [0xE2b, 0x82b, 0xACb]  (Char -> UTF-8 bytes)
bytesToChar([0xE2b, 0x82b, 0xACb]); // '€'

function roundTrip(c) {   // pure: Char -> bytes -> Char
  return bytesToChar(charBytes(c));
}
```

## 5. Pure functions and lambdas

### 5.1 Named functions

`function` declares a pure function. Its arguments are evaluated lazily, it may
not perform side effects, and it returns the value of its body:

```pfun
function add(x, y) {
  return x + y;
}

function describe(shape) {       // returns the value of the match expression
  return match shape with
    | Square s    -> "Square with side " + s.side
    | Circle c    -> "Circle with radius " + c.radius
    | Rectangle r -> "Rectangle " + r.x + "x" + r.y;
}
```

Functions may be **recursive** and **mutually recursive**. The `tiny-lisp.pf`
evaluator is a set of mutually recursive pure functions
(`evalLisp`/`evalList`/`evalSpecialOrCall`/`applyLisp`).

### 5.2 Returning values

There are two equivalent ways to return:

- An explicit `return expr;` — including from one branch of an `if`:
  ```pfun
  function countdown(n) {
    if n <= 0 then return "Liftoff!" else countdown(n - 1);
  }
  ```
- An implicit return of the block's final expression:
  ```pfun
  function init() { Model { 0 }; }   // returns Model { 0 }
  ```

### 5.3 Anonymous lambdas (`fn`)

`fn` introduces an anonymous pure lambda. It is pure by construction. Parameter
forms seen in the corpus:

```pfun
let double   = fn x => x * 2;          // one param, expression body
let multiply = fn x, y => x * y;       // several params, no parentheses
let g = fn (y) => {                     // parenthesized params, block body
  let z = y * y;
  z + 2;
};
```

Lambdas are the workhorse arguments to higher‑order functions:
`map(fn x => x * x, nums)`, `filter(fn c => c.value == selected, choices)`, etc.

### 5.4 Closures

Lambdas and functions capture their surrounding bindings:

```pfun
function adder(n) { return fn x => x + n; }  // captures n
println(adder(5)(10));                       // 15
```

### 5.5 Currying and partial application

Calling a function with **fewer** arguments than it expects returns a new
function awaiting the rest. This works for user functions *and* built‑ins:

```pfun
function clamp(lo, hi, x) { return x < lo ? lo : (x > hi ? hi : x); }
let clamp0to100 = clamp(0)(100);   // bind lo=0, hi=100
println(clamp0to100(150));         // 100

// Built-ins curry too:
let double = map(fn x => x * 2);          // map with just the function
let evens  = filter(fn x => x % 2 == 0);  // filter with just the predicate
let addAll = reduce(fn a, x => a + x, 0); // reduce with f and seed
let first5 = take(5);                      // take with just the count

println(double([1, 2, 3]));   // [2, 4, 6]
println(addAll([10, 20, 30])); // 60
```

### 5.6 Tail‑call optimization (TCO)

Pfun eliminates tail calls, so deep — even unbounded — recursion runs in constant
stack space. This is what makes recursion a complete replacement for loops:

```pfun
function sumTo(n, acc) {                  // from golden_helper.pf
  if n <= 0 then return acc else sumTo(n - 1, acc + n);
}
println(sumTo(100000, 0));                // 5000050000 — no stack overflow
```

`countdown(10000)` and `factHelper(n, acc)` rely on the same guarantee.

### 5.7 Memoization (`memo`)

Prefixing a function with `memo` caches its results: repeated calls with the same
arguments return instantly. Use it for expensive pure computations; omit it for
simple helpers:

```pfun
memo function fib(n) {
  if n <= 1 then n else fib(n - 1) + fib(n - 2);
}
println(fib(30));   // 832040, computed in linear time thanks to memo
```

Memoization is only sound *because* functions are pure — there is no observable
difference between recomputing and returning a cached value.

### 5.8 Functions as first‑class values

Functions (and procedures) are ordinary values: they can be bound, passed,
returned, and stored in records, then called dynamically. From `proctest.pf`:

```pfun
type operation = { op, a, b };
function sub(x, y) { return x - y }
let newOp = operation { sub, 25, 16 };
println(newOp.op(newOp.a, newOp.b));   // 9 — calls the stored function
```

## 6. Immutable collections

### 6.1 Lists

A list literal is `[…]`; the empty list is `[]`. Lists are immutable: operations
produce new lists rather than mutating in place.

Core list operations (all pure, all usable in functions):

```pfun
let numbers = [1, 2, 3, 4, 5];
head(numbers);             // 1
tail(numbers);             // [2, 3, 4, 5]
cons(0, numbers);          // [0, 1, 2, 3, 4, 5]
length(numbers);           // 5
reverse(numbers);          // [5, 4, 3, 2, 1]
slice(1, 3, numbers);      // [2, 3, 4]   (3 items starting at index 1)
nth(numbers, 2);           // 3           (false if out of bounds)
```

`nth` returns `false` when the index is out of bounds, so it doubles as a bounds
check; `find`/`findSlice` (below) return `Option` for a cleaner result.

### 6.2 Higher‑order list functions

```pfun
map(fn x => x * 2, numbers);                 // [2, 4, 6, 8, 10]
filter(fn x => x % 2 == 0, numbers);         // [2, 4]
reduce(fn acc, x => acc + x, 0, numbers);    // 15
```

`reduce(f, seed, list)` folds left. It requires a **finite** list — materialize
a lazy list with `take` first.

### 6.3 Searching

```pfun
find(list, item)        // Some { value: index } | None   (deep equality)
findSlice(list, slice)  // Some { value: index } | None   (sublist/substring)
```

Both use deep value equality and work on strings and finite lists. Unwrap with
`match`:

```pfun
println(match find([10, 20, 30], 30) with | Some s -> s.value | None -> -1); // 2
println(match findSlice("hello world", "world") with
        | Some s -> s.value | None -> -1);                                    // 6
```

### 6.4 List comprehensions

A comprehension builds a list from one or more generators with an optional
filter:

```
[ <body> for <var> <- <source> [for <var2> <- <source2>] [where <guard>] ]
```

- `for x <- list` binds each element of `list` to `x` in turn.
- Multiple `for` clauses produce a cartesian product.
- `where <expr>` keeps only elements for which the boolean guard is true; combine
  conditions with `&&`.
- The body is evaluated for each surviving binding.

```pfun
[ x * 2 for x <- [1,2,3,4,5] ];                     // [2, 4, 6, 8, 10]
[ x * 2 for x <- [1,2,3,4,5] where x % 2 == 0 ];    // [4, 8]
[ x + y for x <- [1,2] for y <- [10,20] ];          // [11, 21, 12, 22]
[ x for x <- range(1, 10) where x > 3 && x < 8 ];   // [4, 5, 6, 7]

// Flatten one level with two generators:
let matrix = [[1, 2], [3, 4], [5, 6]];
[ x for row <- matrix for x <- row ];               // [1, 2, 3, 4, 5, 6]
```

Comprehensions are pure expressions and may appear anywhere a list may, including
inside a `function`.

## 7. Lazy and infinite lists

Pfun lists can be **lazy**: an infinite list is a descriptor that computes
elements only as they are demanded. Nothing is evaluated until a *materializer*
such as `take` forces it.

### 7.1 Constructors

```pfun
iterate(f, seed)   // [seed, f(seed), f(f(seed)), ...]
repeat(x)          // [x, x, x, ...]
cycle(list)        // [a, b, c, a, b, c, ...]
```

### 7.2 Lazy operations and materialization

`map`, `filter`, `cons`, and `tail` over an infinite list return new infinite
descriptors. `take(n, list)` forces the first `n` elements into a finite list and
works on finite lists too. `isInfinite(x)` reports whether a value is a lazy
list.

```pfun
let nats = iterate(fn x => x + 1, 1);   // 1, 2, 3, ...
println(take(5, nats));                 // [1, 2, 3, 4, 5]

let powers = iterate(fn x => x * 2, 1);
println(take(8, powers));               // [1, 2, 4, 8, 16, 32, 64, 128]

let ones = repeat(1);
println(take(4, ones));                 // [1, 1, 1, 1]

let traffic = cycle(["red", "green", "blue"]);
println(take(7, traffic));              // [red, green, blue, red, green, blue, red]

// Compose lazily, force once at the end:
println(take(5, filter(fn x => x % 3 == 0, map(fn x => x * 2, nats)))); // [6,12,18,24,30]

println(isInfinite(nats));     // true
println(isInfinite([1,2,3]));  // false
```

Because pure functions are referentially transparent, returning an infinite list
from a `function` is perfectly safe:

```pfun
function multiplesOf(n) { return iterate(fn x => x + n, n); }
println(take(5, multiplesOf(7))); // [7, 14, 21, 28, 35]
```

> **Note.** `reverse`, `reduce`, `find`, and `length` require finite lists. Call
> `take` first if you start from a lazy list.

## 8. Records and the Pair type

### 8.1 Declaring and constructing records

A record is a named product type. The declaration lists field names; field types
are inferred (see [§2.3](#23-how-the-inferred-nominal-type-system-works)).

```pfun
type Point = { x, y, z };
type User  = { name, age, active };
```

There are three construction syntaxes, all equivalent:

```pfun
let p1 = Point { 10, 20, 30 };                       // positional
let u1 = User(name="Alice", age=30, active=true);    // named, parentheses
let u2 = User(age=25, active=false, name="Bob");     // named args, any order
let c  = Circle { radius = 5 };                       // named, braces
```

Fields are read with dot notation:

```pfun
println(p1.x);                 // 10
println(u1.name + " is " + u1.age);
```

Records are **immutable**. To "change" a record you build a new one — the
standard functional update idiom, used pervasively in the TEA applications:

```pfun
| Increment -> Model { model.page, model.count + 1 }   // new Model, old untouched
```

### 8.2 The built‑in `Pair` type

`Pair` is a built‑in generic record with fields `key` and `value`. Different
lists of pairs may carry different key/value types:

```pfun
let p = Pair(key="lang", value="Pfun");
println(p.key);    // lang
println(p.value);  // Pfun

let pairs = [Pair { "name", "Alice" }, Pair { "role", "admin" }];
```

`Pair` is the currency of dictionary conversions (`dictToList`/`listToDict`,
[§15](#15-mutable-collections-dictionaries-and-arrays)) and of database rows
(each row is a `list<Pair<String, DbValue>>`, [§27](#27-dbpostgresql-and-dbmariadb)).

## 9. Discriminated unions and Option

### 9.1 Declaring unions

A discriminated union groups several named variants under one type. Each variant
is introduced with `|`, a name, and an optional `: field, field, …` list:

```pfun
type Shape = {
  | Square: side
  | Circle: radius
  | Rectangle: x, y
}
```

Variants may also have **no fields** (enumerations):

```pfun
type Msg = { | Increment | Decrement | Reset }
type Page = { | PageAbout | PageComputed | PageContact | PageCounter }
```

### 9.2 Constructing variants

Field‑carrying variants use the same three syntaxes as records; zero‑field
variants are written as a bare identifier:

```pfun
var sq = Square { 10 };          // positional
var ci = Circle { radius = 5 };  // named, braces
var re = Rectangle(x=3, y=4);    // named, parentheses
let inc = Increment;             // zero-field variant — no braces
```

The runtime type tag (`__type`) is set to the **variant** name, not the union
name. Field type consistency is enforced **per variant**, and variants are
independent of one another.

### 9.3 Unions as a modeling tool

Unions are the primary way Pfun models alternatives. The corpus uses them for
shapes, AST nodes (`tiny-lisp.pf`'s `LispVal`), UI messages, wire protocols
(`protocol.pf`), HTML content (`htmllib.pf`), command effects (`tea.pf`'s `Cmd`),
and database metadata (`dbschema.pf`'s `PgType`, `Constraint`). A representative
"closed protocol" example:

```pfun
export type ClientMsg = {
  | ClientPing
  | ClientEcho : text
  | ClientAdd  : a, b
}
```

Because `match` is exhaustive, sharing such a type between a client and server
(as `protocol.pf` is shared by `client.pf` and `server.pf`) turns "added a
message variant but forgot to handle it on one side" into a **compile error**.

### 9.4 The built‑in `Option` type

`Option` is a built‑in union, always available without declaration, representing
a value that may be absent:

```
Some { value }   // wraps a value
None             // absence (bare identifier, no braces)
```

It is the idiomatic return type for partial pure functions:

```pfun
function safeDivide(a, b) {
  return b == 0 ? None : Some { a / b };
}
```

Unwrap with `match` (see [§10](#10-pattern-matching-with-match)):

```pfun
println(match safeDivide(10, 2) with
  | Some s -> "Result: " + s.value
  | None   -> "Division by zero");        // Result: 5
```

`Some`/`None` interoperate with the rest of the language: they go in lists, are
returned by `find`/`findSlice`/`readln`/`jsonSerialize`, and are folded over with
`reduce`. (`Result`, the I/O sibling of `Option`, is covered in
[§17](#17-result-based-error-handling) and [§20](#20-built-in-types).)

## 10. Pattern matching with `match`

`match` is the primary control‑flow construct of the functional layer. It is an
**expression**: it produces a value and may appear anywhere an expression is
valid (including nested inside another expression, or as the body a `function`
returns).

### 10.1 Syntax

```
match <expr> with
  | <VariantName> <binding> [where <guard>] -> <result>   // bind the variant payload
  | <VariantName> _                         -> <result>   // discard the binding
  | <VariantName>                           -> <result>   // zero-field variant
  | <binding> where <guard>                 -> <result>   // bare binding: match the subject itself
  | _                                       -> <result>   // wildcard
```

The bound name refers to the matched value; its fields are read with dot
notation (`s.side`, `c.radius`):

```pfun
let area = match sq with
  | Square s    -> s.side * s.side
  | Circle c    -> c.radius * c.radius
  | Rectangle r -> r.x * r.y;
```

### 10.2 Rules

- **Order matters.** Arms are tried top to bottom; the first match wins.
- **`where` guards.** A guard is an optional boolean filter on the binding. If it
  is false, the arm is skipped and the next is tried:
  ```pfun
  let classify = match ci with
    | Circle c where c.radius > 10 -> "big circle"
    | Circle c where c.radius > 2  -> "medium circle"
    | Circle _                     -> "small circle"
    | Square s                     -> "square"
    | Rectangle r                  -> "rectangle";
  ```
- **`_` binding** discards the matched value; **`| _ ->`** is a wildcard arm
  matching any variant.
- **Bare‑binding arms** carry *no* constructor tag and bind the subject's own
  value directly, enabling guard‑routed dispatch on plain `Int`/`Bool`/etc., not
  just on union variants:
  ```pfun
  function classify_number(n) {
    return match n with
      | n where n >= 100 -> "big"
      | n where n >= 0   -> "small non-negative"
      | n where n < 0    -> "negative";
  }
  ```

### 10.3 Exhaustiveness

- **Union subject:** every variant must appear as an arm, unless a wildcard arm
  is present. A missing variant is a compile error:
  `Non-exhaustive match on 'Shape': missing arm(s) for 'Rectangle'.`
- **Other known subject** (`Bool`, `Int`, `Float`, `Byte`, `Str`, `Char`, or a
  plain non‑union record): the last arm must be unconditional, *unless* the
  guards are provably total. Pfun recognizes provable totality for `Bool`
  (`true`/`false`) and for numeric ranges whose guards' intervals cover the whole
  domain — e.g. `n >= 0` together with `n < 0` need no catch‑all:
  ```pfun
  function sign_of(n) {
    return match n with
      | n where n >= 0 -> "non-negative"
      | n where n < 0  -> "negative";
  }
  ```

### 10.4 Matching multi‑variant results

The same constructor name may appear in more than one union (e.g. both `Result`
and `ReadResult` have `Ok`/`Err`). `match` resolves which variants are required
from the **type of the subject**: matching a `Result` requires `Ok | Err`, while
matching a `ReadResult` requires `Ok | Eof | Err`. (See
[§20](#20-built-in-types).)

### 10.5 Match in pure vs. procedural code

Because `match` is an expression, it is equally at home producing a value in a
`function` and selecting a branch of effects in a `proc`:

```pfun
// pure: yields a value
function area(sh) {
  match sh with
  | Circle c -> c.radius * c.radius * 3
  | Rect r   -> r.w * r.h;
}

// procedural: each arm runs effects
match readFile(path) with
| Ok o  -> println(o.value)
| Err e -> println("Read error: " + e.message);
```

## 11. Modules and imports

Pfun supports TypeScript‑style modules for multi‑file projects. Modules apply to
both paradigms — you can export functions, procedures, types, and values.

### 11.1 Exporting

Prefix any top‑level declaration with `export`:

```pfun
export function add(x, y) { return x + y; }
export let tau = 6;
export proc printResult(label, value) { println(label + ": " + value); }
export type Cmd = { | CmdNone | Send : msg, onReply, url }
```

Only explicitly exported names are importable.

### 11.2 Importing

```pfun
import { add, multiply } from "./mathutils";          // named
import { add as mathAdd, fact as mathFact } from "./mathutils"; // named + alias
import * as Math from "./mathutils";                   // namespace
import * from "io";                                    // bring all exports into scope
```

A namespace import is accessed with dot notation (`Math.multiply(6, 7)`,
`Math.tau`).

### 11.3 Resolution rules

- Paths beginning with `./` or `../` are **relative to the importing file**
  (`"./mathutils"`, `"../dbschema"`).
- Bare names (no leading `./`) are resolved from the standard library — the
  built‑in modules `io`, `file`, `math`, `json`, `async`, `http`, and the `db/*`
  drivers (`"io"`, `"db/postgresql"`).
- Modules are executed **once** and cached.
- **Circular imports are detected** and raise an error.

### 11.4 Re‑declaring shared types across modules

A recurring pattern in the database examples is to re‑declare a union type
locally in a module that needs its variants in scope (e.g. `dbschema_demo.pf`
re‑declares `MaybeId`, `MutResult`, etc.). This is a practical consequence of the
monomorphic, per‑module nature of constructors described in
[§2.4](#24-monomorphic-constructors-an-important-subtlety): re‑declaring ensures
the variant tags are registered in that module's type context.

---

# Part II — Procedural Programming

This part describes the effectful shell: procedures, mutable state, statement
control flow, mutable collections, I/O, error handling against `Result`, and
asynchronous concurrency. Everything here is *unavailable* inside a pure
`function` and *available* inside a `proc` (and at the top level of a program,
which is itself a procedural context).

## 12. Procedures

### 12.1 Declaring procedures

`proc` declares a procedure: side effects are allowed, arguments are evaluated
strictly, and it is never memoized.

```pfun
proc printResult(label, value) {
  println(label + ": " + value);
}

proc printDescriptions(a, b, c) {
  println(describe(a));      // procedures may call pure functions
  println(describe(b));
  println(describe(c));
}
```

A procedure may call other procedures and pure functions; a pure function may
call **neither** a procedure nor `print`. This is the purity boundary from the
introduction, viewed from the procedural side.

### 12.2 The top level is procedural

Statements written directly at the top level of a file run in sequence as a
procedure‑like context: they may print, mutate, open files, and call procedures.
This is why `hello.pf` is simply:

```pfun
println("Hello world!");
```

and why programs end by *calling* their entry procedure (`main();`,
`run(init(), view, update);`, `demo();`).

### 12.3 Procedures are first‑class too

Like functions, procedures are values. `proctest.pf` stores a `proc` in a record
field and calls it through the field — at the top level (a procedural context),
which is what makes calling a stored proc legal there:

```pfun
proc add(x, y) { return x + y }
let myOp = operation { add, 16, 9 };
println(myOp.op(myOp.a, myOp.b));   // 25
```

### 12.4 Return and early return

Procedures support `return expr;`, implicit last‑expression return, and **early
return** for guard clauses:

```pfun
proc printRow(row) {
  if length(row) == 0 then return 0;   // early return
  printPair(head(row));
  printRow(tail(row));
}
```

## 13. Mutable bindings and assignment

### 13.1 `var` vs. `let`

- `let` — immutable and lazily evaluated. Reassignment is a compile error
  (`"Cannot assign to immutable variable"`). Usable everywhere.
- `var` — mutable and **strictly** evaluated. Usable only in procedural contexts;
  a `function` that declares a `var` is rejected at compile time.

```pfun
let lazy_constant = 100;
var mutable_counter = 0;

mutable_counter = 10;        // OK — var is mutable
// lazy_constant = 200;      // ERROR: cannot assign to immutable variable
```

### 13.2 Assignment

Assignment (`=`) is a **statement**, not an expression. The assignable targets
are:

- `var` bindings: `counter = counter + 5;`
- dictionary entries: `scores["Bob"] = 90;`
- array elements: `arr[0] = 99;`

Records and lists are immutable and have no field/element assignment; you build
new values instead.

## 14. Statement control flow

### 14.1 `if` as a statement

In procedural code `if` may be used as a statement, and the `else` branch is
optional (there is no value to produce):

```pfun
if has(counts, word) then {
  counts[word] = counts[word] + 1;
} else {
  counts[word] = 1;
}

if length(cs) > 0 then {     // no else needed
  printConstraint(head(cs));
  printConstraints(tail(cs));
}
```

`then` may be followed by a single statement or a brace‑delimited block. This is
the key contrast with the functional layer, where `if` is an expression that
*must* yield a value and therefore requires `else` (see [§3.4](#34-ifthenelse-as-an-expression)).

### 14.2 Iteration is recursion

Pfun has **no `while` or C‑style `for` statement**. Procedural iteration is
expressed with recursion — made practical by tail‑call optimization — often with
a locally defined helper procedure:

```pfun
proc readAllLines(path) {
  match fileOpen(path, Read) with
    | Err e -> println("Could not open " + path + ": " + e.message)
    | Ok o  -> {
        var handle = o.value;
        proc readLoop(lineNum) {          // nested helper proc
          match readLine(handle) with
            | Ok  l -> { println($"  {lineNum}: {l.value}"); readLoop(lineNum + 1); }
            | Eof _ -> 0
            | Err e -> println("Read error: " + e.message);
        }
        readLoop(1);
        fileClose(handle);
      }
}
```

Note that procedures may be **nested** inside other procedures (`readLoop` inside
`readAllLines`, `loop` inside `replLoop` in `tiny-lisp.pf`), capturing the
enclosing procedure's bindings.

### 14.3 Sequencing and blocks

Within a procedure, statements execute top to bottom. A `{ … }` block groups
statements; in a `match` arm a block lets an arm perform several effects:

```pfun
match writeFile(dst, o.value) with
| Ok _  -> 0
| Err e -> println("Write failed: " + e.message);
```

## 15. Mutable collections: dictionaries and arrays

These two collection types are inherently imperative. Both must be declared with
`var`, and their mutating operations are procedure‑only.

### 15.1 Dictionaries

A dictionary is a mutable key→value store. Keys are primitives (string, integer,
or boolean) compared by value; values may be anything.

```pfun
var scores = dict { "Alice" -> 95, "Bob" -> 87, "Carol" -> 92 };
var empty  = dict {};

println(scores["Alice"]);     // 95          (access)
scores["Bob"] = 90;           //             (update)
scores["Dave"] = 88;          //             (insert)
```

Dictionary built‑ins:

| Call | Effect |
|---|---|
| `has(d, key)` | `true` if `key` is present |
| `remove(d, key)` | delete `key` (mutates) |
| `keys(d)` | list of keys |
| `values(d)` | list of values |
| `dictToList(d)` | immutable list of `Pair { key, value }` |
| `listToDict(pairs)` | build a dict from a list of `Pair`s |

```pfun
println(has(scores, "Dave"));   // true
remove(scores, "Dave");
println(keys(scores));          // [Alice, Bob, Carol]
println(values(scores));        // [95, 90, 92]
```

`dictToList`/`listToDict` enable a round‑trip "transform a dictionary
functionally, then rebuild it" idiom:

```pfun
let bumped = map(fn p => Pair { p.key, p.value + 1 }, dictToList(scores));
var scores2 = listToDict(bumped);
```

A dictionary is the natural choice for a frequency counter, cache, or
environment table (`tiny-lisp.pf` keeps user definitions in a `dict`).

### 15.2 Arrays

An array is a mutable, zero‑indexed, contiguous, **homogeneous** sequence — all
elements share one type, enforced at construction and on every mutation. Arrays
are strict (unlike lazy lists).

```pfun
var employees = array { "Alice", "Bob", "Carol" };
var empty     = array {};

println(employees[0]);          // Alice                 (access)
employees[0] = "Alicia";        //                       (assignment)
```

**Mutating** operations (procedure‑only):

| Call | Effect |
|---|---|
| `append(a, value)` | add to the end |
| `removeAt(a, index)` | remove at `index`, shifting later elements down |
| `insertAt(a, index, value)` | insert before `index` (index in `[0, arrayLength(a)]`) |

**Non‑mutating** operations (usable anywhere, including pure functions):

| Call | Result |
|---|---|
| `arrayLength(a)` | element count |
| `find(a, item)` | `Some { value: index }` or `None` (deep equality) |
| `toList(a)` | copy to an immutable list |
| `toArray(list)` | copy a list or string into a new array |
| `toDict(a)` | copy to a dict with integer keys `0, 1, 2, …` |

```pfun
append(employees, "Dave");
removeAt(employees, 1);                 // removes "Bob"
insertAt(employees, 2, "Charlie");
println(arrayLength(employees));        // 4
let snap = toList(employees);           // immutable snapshot
```

> **`length` vs. `arrayLength`.** `length()` operates on immutable lists and
> strings and does **not** accept arrays; use `arrayLength()` for arrays.

## 16. Console input and output

Console I/O is effectful and therefore procedure‑only. (The underlying functions
live in the `io` module — [§21](#21-io--console-io) — and are documented there;
this section covers their *use*.)

### 16.1 Output

```pfun
println(x);   // print x (auto-converted to string) followed by a newline
print(x);     // print x with no trailing newline
```

Values are formatted automatically: lists print as `[1, 2, 3]`, strings in a list
print without quotes, booleans as `true`/`false`. To build a string yourself,
use `$"…"` interpolation or `__str__(x)`:

```pfun
proc printPoints(a, b) {
  let fa = square(a);
  print($"p1 = ({a}, {fa})\n");
}
```

### 16.2 Input

```pfun
readln()    // Option<String>  — one line, newline stripped; None at EOF
readChar()  // Option<Char>    — one character; None at EOF
```

Both return an `Option`, so you handle end‑of‑input with `match` rather than an
exception. `flushStdout()` forces buffered output (such as a prompt) to appear
before a blocking read:

```pfun
proc greet() {
  print("Enter your name: ");
  flushStdout();                       // ensure the prompt shows first
  var input = readln();
  let userName = match input with
    | Some s -> s.value
    | None   -> "stranger";
  print($"Hello, {userName}!\n");
}
```

## 17. Result-based error handling

Pfun does not use exceptions for recoverable errors. Operations that can fail
return a **`Result`** (or `Option`) value, and the caller `match`es on it. This
keeps error handling explicit and total.

### 17.1 The `Result` and `ReadResult` types

```
Result      = Ok  { value }   | Err { message }
ReadResult  = Ok  { value }   | Eof | Err { message }
```

`Result` is returned by file writes, `fileOpen`/`fileClose`, the database
drivers, and HTTP calls. `ReadResult` is returned by the streaming file readers
(`readChar`, `readLine`, `readByte`, …), which add an `Eof` case for a clean
end‑of‑file.

```pfun
proc copyFile(src, dst) {
  match readFile(src) with
  | Ok o  -> {
      match writeFile(dst, o.value) with
      | Ok _  -> 0
      | Err e -> println("Write failed: " + e.message);
    }
  | Err e -> println("Read failed: " + e.message);
}
```

### 17.2 Choosing `Option` vs. `Result` vs. a custom union

- Use **`Option`** when absence carries no explanation (a lookup miss).
- Use **`Result`** when failure has a message (I/O, parsing, the network).
- Use a **dedicated named union** when a module has several fallible operations
  with *different* success payloads, to avoid the monomorphic‑constructor
  unification described in [§2.4](#24-monomorphic-constructors-an-important-subtlety).
  `dbschema.pf` does exactly this, returning `ColsResult`, `ConsResult`,
  `TableResult`, and `SchemaResult` from its different loaders.

## 18. Asynchronous procedures

Pfun offers cooperative concurrency through `async`/`await`. Per the language
documentation, both `async function` and `async proc` may use `await`; the corpus
demonstrates `async proc` throughout (and uses `await` for genuinely effectful
operations).

### 18.1 `async` and `await`

`async` marks a declaration as able to use `await`. `await <expr>` suspends until
a Promise‑returning native call (`sleep`, `httpGet`, `dbQuery`, …) resolves,
**without blocking other tasks**:

```pfun
async proc delayedDouble(x) {
  await sleep(10);
  return x * 2;
}

async proc demoAwait() {
  let result = await delayedDouble(21);
  println("delayedDouble(21) = " + result);  // 42
}
demoAwait();
```

### 18.2 The concurrency model

Tasks interleave at `await` points. An HTTP handler, for instance, is run "once
per incoming request as its own task — multiple in‑flight requests interleave at
`await` points, so a slow handler doesn't block other requests." This is
cooperative, not preemptive: a task yields only where it `await`s.

```pfun
async proc handleRequest(req, res) {
  if req.path == "/slow" then {
    await sleep(200);                    // other requests proceed meanwhile
    res.text(200, "That took a while, but here I am.");
  } else {
    res.text(404, "Not found: " + req.path);
  }
}
```

`await` chains naturally with `match`, since the awaited value is an ordinary
`Result`/`Option`:

```pfun
let conn = await dbConnect(CONNECTION_STRING);
match conn with
| Err e -> println("Could not connect: " + e.message)
| Ok c  -> { /* ... use c.value ... */ };
```

---

# Part III — Standard Libraries

This part is the library reference. It documents the **interface** of every
built‑in function and standard module — what to call and what you get back — not
the internals.

Conventions used below:

- *Always available* means usable with no import (e.g. `map`, `length`, `Some`).
- *Module* functions require `import * from "<module>";` (or a named import).
- "proc‑only" marks an effectful operation that may not be used inside a pure
  `function`.

## 19. Core built-in functions

These functions and constructors are part of the language core and are available
without any import. (`htmllib.pf` and `viewlib.pf`, which import nothing but each
other, rely entirely on these — confirming their global availability.)

### 19.1 Sequence functions (lists and strings)

| Function | Signature → result | Notes |
|---|---|---|
| `head(seq)` | first element/char | |
| `tail(seq)` | sequence without its head | |
| `cons(x, seq)` | prepend `x` | works on lazy lists |
| `length(seq)` | element count (`Int`) | lists & strings only, not arrays |
| `reverse(seq)` | reversed copy | errors on infinite lists |
| `slice(n, k, seq)` | `k` items from index `n` | strings, finite & lazy lists |
| `nth(seq, n)` | element at `n`, or `false` if out of bounds | strings & lazy lists |
| `map(f, seq)` | apply `f` to each element | curries; works on lazy lists |
| `filter(pred, seq)` | keep elements where `pred` is true | curries; works on lazy lists |
| `reduce(f, seed, seq)` | left fold to a single value | curries; **finite** lists only |
| `find(seq, item)` | `Some { value: index }` / `None` | deep equality |
| `findSlice(seq, sub)` | `Some { value: index }` / `None` | sublist/substring search |
| `range(lo, hi)` | list `[lo … hi]` inclusive | e.g. `range(1, 10)` → 10 elements |
| `take(n, seq)` | first `n` as a finite list | curries; finite or infinite input |
| `iterate(f, seed)` | infinite `[seed, f(seed), …]` | |
| `repeat(x)` | infinite `[x, x, …]` | |
| `cycle(list)` | infinite repetition of `list` | |
| `isInfinite(x)` | `true` if `x` is a lazy list | |

### 19.2 String/character functions

| Function | Signature → result | Notes |
|---|---|---|
| `asc(char)` | `Int` code point | |
| `chr(int)` | `Char` | e.g. `chr(0x20AC)` → `'€'` |
| `split(str, delim)` | list of strings | `""` delimiter → individual chars |
| `join(list, delim)` | string | elements auto‑converted to strings |

(`head`/`tail`/`cons`/`map`/`filter`/`slice`/`nth`/`reverse`/`length` also apply
to strings, as described in [§4.1](#41-strings-are-lists-of-characters).)

### 19.3 Conversions

| Function | Signature → result | Notes |
|---|---|---|
| `toInt(x)` | `Int` | truncates a `Float`; `Byte`/numeric → `Int` |
| `toFloat(x)` | `Float` | converts `Int`→`Float`; **parses a numeric string** (`"3"` → `3.0`) |
| `toByte(x)` | `Byte` | from `Int` or `Char`; errors if out of 0–255 |
| `toChar(b)` | `Char` | from `Byte` (always valid) |
| `charBytes(c)` | `List<Byte>` | UTF‑8 encoding of a `Char` |
| `bytesToChar(bytes)` | `Char` | inverse of `charBytes`; must be valid UTF‑8 |
| `__str__(x)` | `String` | explicit value‑to‑string conversion |

`toInt`/`toFloat` compose to parse user input: `toInt(toFloat(model.addA))` turns
the string `"3"` into the integer `3` in `client.pf`.

### 19.4 Dictionary functions

`has`, `remove` (proc‑only), `keys`, `values`, `dictToList`, `listToDict`, plus
the `dict { … }` literal and `d[key]` access/assignment — see
[§15.1](#151-dictionaries).

### 19.5 Array functions

`append`/`removeAt`/`insertAt` (proc‑only), `arrayLength`, `find`, `toList`,
`toArray`, `toDict`, plus the `array { … }` literal and `a[i]` access/assignment
— see [§15.2](#152-arrays).

## 20. Built-in types

Four union/record types are built in and always available.

| Type | Variants / fields | Used by |
|---|---|---|
| `Option` | `Some { value }` \| `None` | `find`, `findSlice`, `readln`, `readChar`, `jsonSerialize`, `jsonDeserialize`, user code |
| `Result` | `Ok { value }` \| `Err { message }` | `file`, `http`, `db/*` |
| `ReadResult` | `Ok { value }` \| `Eof` \| `Err { message }` | streaming file reads |
| `Pair` | `{ key, value }` (generic record) | `dictToList`/`listToDict`, db rows |

Because `Ok`/`Err` are shared by `Result` and `ReadResult`, `match` uses the
subject's type to decide which variants are required (see
[§10.4](#104-matching-multi-variant-results)).

## 21. `io` — console I/O

`import * from "io";`

| Function | Signature | Effect |
|---|---|---|
| `println(x)` | any → () | print `x` and a newline |
| `print(x)` | any → () | print `x`, no newline |
| `flushStdout()` | () → () | flush buffered stdout |
| `readln()` | () → `Option<String>` | read a line (newline stripped); `None` at EOF — proc‑only |
| `readChar()` | () → `Option<Char>` | read one character; `None` at EOF — proc‑only |

> **Availability note.** `println` is used in `hello.pf` with *no* import, so
> basic output appears to be globally available; nevertheless every multi‑file
> program in the corpus conventionally writes `import * from "io";`, which is also
> where the interactive input procedures (`readln`, `readChar`, `flushStdout`)
> come from. The corpus also references a legacy interpolating `printf("…{x}…")`,
> but it is never actually called — prefer `$"…"` with `print`/`println`.

> **Name overload.** A handle‑taking `readChar(handle)` that returns a
> `ReadResult` belongs to the `file` module ([§22](#22-file--files-and-binary-io));
> the no‑argument `readChar()` here reads from stdin and returns an `Option`. They
> are distinguished by argument and module.

## 22. `file` — files and binary I/O

`import * from "file";`

All file operations are impure (proc/top‑level only). They report success through
`Result`/`ReadResult` rather than exceptions.

### 22.1 Modes and result types

- **`FileMode`**: `Read` (must exist), `Write` (create/overwrite), `Append`
  (create/append).
- **`Result`** `Ok { value } | Err { message }` — non‑read operations.
- **`ReadResult`** `Ok { value } | Eof | Err { message }` — streaming reads.

### 22.2 Convenience functions (no handle management)

| Function | Result |
|---|---|
| `readFile(path)` | `Result` — `Ok { value }` is the file contents |
| `writeFile(path, content)` | `Result` — `Ok { value }` is the character count |
| `fileExists(path)` | `Bool` (no handle needed) |

```pfun
match writeFile(tmpPath, "Hello from Pfun!") with
  | Ok o  -> println($"Wrote {o.value} chars")
  | Err e -> println("Write error: " + e.message);
```

### 22.3 Handle‑based functions (explicit open/close)

| Function | Result |
|---|---|
| `fileOpen(path, mode)` | `Result { value: handle }` |
| `fileClose(handle)` | `Result` |
| `readChar(handle)` | `ReadResult` (a `Char`) |
| `readLine(handle)` | `ReadResult` (a `String`) |
| `writeChar(handle, char)` | `Result` |
| `writeLine(handle, string)` | `Result` |
| `mkdirP(path)` | `Result` (create directory, including parents) |

### 22.4 Binary and buffer I/O

`Byte`‑level operations and buffered bulk reads:

| Function | Result |
|---|---|
| `readByte(handle)` | `ReadResult` — `Ok { Byte }` \| `Eof` \| `Err` |
| `writeByte(handle, byte)` | `Result` — `Ok { 1 }` \| `Err` |
| `readBytes(handle, n)` | `ReadResult` — `Ok { List<Byte> }` \| `Eof` \| `Err` |
| `writeBytes(handle, list)` | `Result` — `Ok { n }` \| `Err` |
| `readBuffer(handle, n, mode)` | `Result` — `Ok { Buffer }` \| `Err` |
| `writeBuffer(handle, buffer)` | `Result` — `Ok { n }` \| `Err` |
| `makeBuffer(mode)` | an empty `Buffer` (`mode` = `ByteMode` \| `CharMode`) |
| `bufferToBytes(buf)` | `List<Byte>` |
| `bufferToString(buf)` | `String` (UTF‑8 decode) |
| `bufferLength(buf)` | `Int` |

```pfun
proc byte_io_demo() {
  match fileOpen("./bytes.bin", Write) with
  | Ok o -> { writeBytes(o.value, [0xDEb, 0xADb, 0xBEb, 0xEFb]); fileClose(o.value); }
  | Err e -> println("open failed: " + e.message);
}
```

## 23. `math`

`import * from "math";`

| Function | Signature → result |
|---|---|
| `sqrt(x)` | square root (`Float`) |
| `pow(base, exp)` | `base` raised to `exp` (`Float`) |
| `abs(x)` | absolute value |
| `round(x)` | round a `Float` to the nearest integer |
| `lerp(a, b, t)` | linear interpolation between `a` and `b` by `t` |

```pfun
println(sqrt(2.0));                    // 1.41421356...
println(pow(2.0, 16.0));               // 65536
println(abs(-7));                      // 7
println(round(lerp(0.0, 100.0, 0.25))); // 25
```

(Arbitrary‑precision integer arithmetic — `factorial(30)`, `square(10^12)` — needs
no library; it is built into the `Int` type. See [§2.1](#21-scalar-types).)

## 24. `json`

`import * from "json";`

A pure encoder/decoder for Pfun's immutable data — records, union variants, and
arbitrarily nested lists.

| Function | Signature → result |
|---|---|
| `jsonSerialize(value)` | `Some { string }` / `None` on failure |
| `jsonDeserialize(string)` | `Some { value }` / `None` on failure |

Both are pure; they perform no file I/O. To persist, compose with `file`:

```pfun
match jsonSerialize(cfg) with
| Some s -> writeFile(path, s.value)
| None   -> println("could not serialize");
```

The wire format is `__pfun`‑tagged JSON so that Pfun‑specific values round‑trip
exactly:

| Pfun value | JSON |
|---|---|
| `Int` | `{ "__pfun": "int", "v": "123" }` |
| `Char` | `{ "__pfun": "char", "v": "x" }` |
| record / variant | `{ "__pfun": "record", "__type": "Circle", "__union": "Shape", …fields }` |
| string, boolean, null, list | native JSON |

This tagged format is also the wire protocol used by the HTTP client/server stack
(`server.pf` deserializes the request body and serializes the reply).

## 25. `async`

`import * from "async";`

| Function | Signature → result |
|---|---|
| `sleep(ms)` | a Promise that resolves after `ms` milliseconds — `await` it |

`await` is a keyword usable inside an `async` declaration (see
[§18](#18-asynchronous-procedures)). `sleep` is the primitive delay; other
modules (`http`, `db/*`) contribute their own Promise‑returning functions that
`await` consumes the same way.

## 26. `http`

`import * from "http";`

### 26.1 Server

```pfun
httpListen(port, handler)   // start an HTTP server; handler is an async proc(req, res)
```

The handler runs once per request as its own task. The `req` and `res` objects:

- **`req`** — fields `method`, `path`, `query` (a dict), `headers`, `body`
  (request body decoded as UTF‑8 text), and `bodyBytes` (the same body as raw
  `List<Byte>`, undecoded — use it for binary uploads).
- **`res`** — response methods:
  - `res.text(status, body)`
  - `res.json(status, value)` — serializes `value` as `__pfun`‑tagged JSON
  - `res.bytes(status, byteList, contentType)` — raw binary

```pfun
async proc handleRequest(req, res) {
  if req.path == "/greet" then {
    let name = has(req.query, "name") ? req.query["name"] : "stranger";
    res.json(200, dict { "message" -> "Hello, " + name + "!" });
  } else {
    res.text(404, "Not found: " + req.path);
  }
}
httpListen(7999, handleRequest);
```

### 26.2 Client

| Function | Result | Body type |
|---|---|---|
| `httpGet(url)` | Promise of `Ok { value }` / `Err { message }` | `value.body` is UTF‑8 text |
| `httpGetBytes(url)` | same | `value.body` is a `List<Byte>` |
| `httpPost(url, value)` | same | sends `value` as `__pfun`‑tagged JSON |

On success, `value` has fields `status`, `headers`, and `body`. These calls
**never reject** — failure is reported as `Err`, so you always `match` rather than
catch:

```pfun
let home = await httpGet("http://localhost:7999/");
match home with
| Ok r  -> println("GET / -> " + r.value.status + ": " + r.value.body)
| Err e -> println("GET / failed: " + e.message);
```

## 27. `db/postgresql` and `db/mariadb`

`import * from "db/postgresql";` — or — `import * from "db/mariadb";`

Both drivers expose the **same interface**; they differ only in connection‑string
scheme and SQL placeholder syntax.

### 27.1 Connection and query functions

| Function | Result |
|---|---|
| `dbConnect(connectionString)` | Promise of `Result { value: connection }` |
| `dbQuery(conn, sql, params)` | Promise of `Result { value: { rows, rowCount } }` |
| `dbClose(conn)` | Promise of `Result` |

- A **query result** has `rows` (a list of rows) and `rowCount` (affected/returned
  count). Each **row** is a `list<Pair<String, DbValue>>` — column name to value.
- **Parameters** are passed as a list of `DbValue`s. PostgreSQL uses positional
  `$1, $2, …` placeholders; MariaDB/MySQL uses `?`.

### 27.2 The `DbValue` type

A union covering the SQL value domain:

```
DbText { value } | DbInt { value } | DbFloat { value }
| DbBool { value } | DbBytes { value } | DbNull
```

You build `DbValue`s for parameters and `match` on them when reading rows:

```pfun
let selected = await dbQuery(
  connection,
  "SELECT name, balance, active, notes FROM users WHERE balance >= $1 ORDER BY name",
  [DbFloat { 0.0 }]
);
match selected with
| Ok r  -> { println("rowCount = " + __str__(r.value.rowCount)); printRows(r.value.rows); }
| Err e -> println("Select failed: " + e.message);

proc printPair(pair) {
  match pair.value with
  | DbInt n   -> println("  " + pair.key + " = " + __str__(n.value) + " (int)")
  | DbFloat n -> println("  " + pair.key + " = " + __str__(n.value) + " (float)")
  | DbText s  -> println("  " + pair.key + " = " + s.value + " (text)")
  | DbBool b  -> println("  " + pair.key + " = " + __str__(b.value) + " (bool)")
  | DbBytes b -> println("  " + pair.key + " = <" + __str__(length(b.value)) + " bytes>")
  | DbNull    -> println("  " + pair.key + " = NULL");
}
```

### 27.3 Driver differences

- **Connection strings**: `postgres://user:pass@host:port/db` vs.
  `mysql://user:pass@host:port/db`.
- **Placeholders**: `$1, $2, …` (PostgreSQL) vs. `?` (MariaDB).
- **Type mapping**: per the corpus notes, MySQL's `BOOLEAN` (an alias for
  `TINYINT(1)`) comes back as `DbInt`, not `DbBool`; the MariaDB driver returns
  `DECIMAL` columns as `DbText` to avoid floating‑point precision loss (convert
  with `toFloat` when you need to compute).

All database calls are asynchronous — use them inside an `async proc` and `await`
each one (see [§18](#18-asynchronous-procedures)).

## 28. Bundled libraries: the web stack

Pfun ships a set of **reusable libraries** for building browser applications in
The Elm Architecture (TEA) style. These are ordinary Pfun modules imported by
relative path (`import * from "./htmllib";`), not built‑in `lib/` modules, but
they are general‑purpose and reusable, so their interfaces are documented here.
(The programs that *use* them — `counter.pf`, `hello_web.pf`, `client.pf` — are
applications and are out of scope.)

The division of labor: **htmllib** models static document content,
**viewlib** models interactive UI, **tea** is the runtime loop, and **domlib**
attaches rendered HTML to the page.

### 28.1 `htmllib` — semantic HTML content ADT

`htmllib` represents HTML as algebraic data so that malformed documents are
*unrepresentable*. Block and inline content are separate unions (a paragraph can
never appear inside a sentence), and each form field kind is its own variant
(an "email input that is also checked" cannot be expressed). Heading levels are
computed from nesting depth, so a broken `h1→h4` jump is structurally impossible.

Exported types (variant lists abbreviated):

- `Inline` — `Text`, `Emph`, `Strong`, `InlineCode`, `Link`, `HtmlLineBreak`.
- `Block` — `Para`, `BulletList`, `OrderedList`, `BlockQuote`, `CodeBlock`,
  `ThematicBreak`, `Section`, `Article`, `Aside`, `Nav`, `Form`, `RawHtml`,
  `Attributed`.
- `Field` — `TextField`, `EmailField`, `PasswordField`, `NumberField`,
  `TextArea`, `Checkbox`, `RadioGroup`, `Dropdown`, `SubmitButton`,
  `ResetButton`, `HiddenField`.
- `Choice` `{ value, label }`, `Attrs` `{ id, classes, style }`,
  `Document` `{ title, body }`.

Exported convenience constructors (pure functions returning the variants above):
`text`, `emph`, `strong`, `code`, `link`; `choice`, `textField`, `emailField`,
`passwordField`, `numberField`, `textArea`, `checkbox`, `radioGroup`, `dropdown`,
`submitButton`, `resetButton`, `hiddenField`, `form`; the attribute helpers
`noAttrs`, `withId`, `withClass`, `withStyle`.

Exported pure renderers (ADT → HTML string), of which the top‑level entry points
are:

| Function | Renders |
|---|---|
| `renderDocument(doc)` | a whole `Document` |
| `renderBlock(node, depth)` | one `Block` |
| `renderBlocks(nodes, depth)` | a list of `Block`s |
| `renderInline(node)` / `renderInlines(nodes)` | inline content |
| `renderField(field)` / `renderFields(fields)` | form fields |
| `escapeHtml(s)` / `escapeAttr(s)` | HTML/attribute escaping |

```pfun
let aboutContent = Section {
  [text("Hello from Pfun")],
  [ Para { [text("A lazy, purely functional language with a procedural shell.")] } ]
};
let html = renderBlock(aboutContent, 0);
```

### 28.2 `viewlib` — interactive view ADT

A `View` is what a pure `view` function returns. It describes *interactive* UI:
buttons that emit messages, inputs that transform their value into a message, and
containers. Static `htmllib` blocks embed via `VContent`.

Exported `View` variants: `VText`, `VEl`, `VButton`, `VTextInput`, `VCheckbox`,
`VSelect`, `VContent`.

Exported constructors: `vtext`, `vbutton`, `vbuttonClass`, `vdiv`, `vspan`, `vp`,
`vh`, `vdivClass`, `vdivId`, `vspanId`, `vinput`, `vcheckbox`, `vselect`,
`vcontent`; renderers `renderView`, `renderViews`, `renderViewChoice`; helper
`boolStr`.

Event sites carry either a message value or a transformer function
(`fn Str -> Msg`):

```pfun
function view(model) {
  vdiv([
    vbutton("-", Decrement),
    vtext(" " + __str__(model.count) + " "),
    vbutton("+", Increment)
  ]);
}
```

### 28.3 `tea` — The Elm Architecture runtime

`tea` provides the loop that connects a pure `view`/`update` to the browser. The
application supplies three pure pieces — `init`, `view`, `update` — and `tea`
owns *all* mutation in a single `run` procedure.

Exported interface:

| Name | Kind | Purpose |
|---|---|---|
| `Cmd` | type | effects the runtime can perform: `CmdNone` \| `Send { msg, onReply, url }` |
| `cmdNone()` | function | the no‑effect command |
| `Handler` | type | `{ key, handler }` — an event binding |
| `collectHandlers(view)` | function | gather event handlers from a view tree |
| `run(init, viewFn, updateFn)` | proc | entry point; renders and starts the loop |

`update` returns `{ model, cmd }`; `Send` posts a message as JSON to a URL and
dispatches the reply back through `update`. The framework's own summary captures
the design: *`view` and `update` stay pure; `run()` is the one proc that owns all
mutation.*

```pfun
function update(msg, model) {
  match msg with
  | Increment -> Model { model.count + 1 }
  | Decrement -> Model { model.count - 1 }
  | Reset     -> Model { 0 };
}

run(init(), view, update);
```

### 28.4 `domlib` — mounting rendered HTML

`domlib` attaches rendered HTML to the page. It depends on `htmllib` for the
render functions. Its procedures are no‑ops under the command‑line interpreter
and take effect in the browser.

| Procedure | Effect |
|---|---|
| `mount(doc)` | render a `Document` and attach it |
| `mountBlock(b)` | render one `Block` and attach it |
| `mountBlocks(blocks)` | render a list of `Block`s and attach them |

These build on a small set of **browser‑runtime procedures** used internally by
the web stack — `mountHtml(html)`, `clearOutput()`, and
`attachDomHandler(key, fn)` — which are available in browser execution mode and
are the bridge between rendered strings and the live DOM.

---

# Appendix A — Reserved words and symbols

**Declaration & module keywords:** `function`, `fn`, `proc`, `memo`, `async`,
`let`, `var`, `type`, `export`, `import`, `from`, `as`.

**Control & expression keywords:** `if`, `then`, `else`, `match`, `with`,
`where`, `for`, `return`, `await`, `true`, `false`.

**Built‑in constructors always in scope:** `Some`, `None`, `Ok`, `Err`, `Eof`,
`Pair`; the literal keywords `dict` and `array`.

**Literal affixes:** `b` (byte suffix, `255b`), `0x` (hex prefix), `@` (raw
string prefix), `$` (format string prefix).

**Operators:** `+ - * / %` · `== != < > <= >=` · `&& || !` · `& | << >>` ·
`? :` · `=` (assignment) · `->` (match arm) · `=>` (lambda) · `<-` (comprehension
generator) · `|` (variant / union separator) · `.` (field access) · `[]`
(index / list) · `{}` (block / record).

# Appendix B — Known gaps and ambiguities

The following points are not fully determined by the available corpus; they are
flagged so readers do not over‑rely on them:

- **Bitwise operator precedence.** Bitwise expressions always appear isolated or
  parenthesized; the precedence of `& | << >>` relative to comparison/arithmetic
  is not demonstrated. Parenthesize when mixing. (See [§3.5](#35-observed-precedence).)
- **`async function`.** The documentation states both `async function` and
  `async proc` may use `await`, but only `async proc` is demonstrated. Treat
  async functions as supported‑but‑unexercised.
- **General truthiness.** Only `Byte` truthiness is documented explicitly (`0b`
  falsy, non‑zero truthy). All other conditionals in the corpus use boolean
  expressions; whether other types have an implicit truthiness is not shown.
- **`println` without import.** `hello.pf` uses `println` with no import, while
  every other program imports `io`. Basic output appears globally available, but
  the corpus is not explicit about exactly which I/O names are global versus
  module‑scoped. The safe convention is to `import * from "io";`.
- **Monomorphic constructors.** The precise scope over which a constructor's
  payload type unifies (whole file vs. connected inference cluster) is described
  by the database modules' guidance but not formally specified. When in doubt,
  follow their idiom: declare a dedicated named result union per distinct payload
  type. (See [§2.4](#24-monomorphic-constructors-an-important-subtlety).)
- **Legacy `printf`.** Referenced in comments as a former interpolating print, but
  never called in the corpus. Use `$"…"` format strings.

*End of manual.*
