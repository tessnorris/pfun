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
  - [29. Data model persistence](#29-data-model-persistence)
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
- Mutable collections: `dict`, `array`, and growable byte/string buffers.
- Statement sequencing, `if` without `else`, `while` loops, and early `return`.
- Console, file, network, and database I/O.
- `async`/`await` cooperative concurrency.

Both layers can iterate by **recursion**, made practical everywhere by tail‑call
optimization. The procedural layer *additionally* has a `while` loop
([§14.3](#143-while-loops)) for straightforward imperative counting and
accumulation; `while` is rejected inside a pure `function`, where recursion
remains the only iteration mechanism. Pfun has no C‑style `for` statement — the
only `for` is the list‑comprehension generator ([§6.4](#64-list-comprehensions)).

## The type system at a glance

Pfun is statically typed with **Hindley–Milner‑style type inference**: you rarely
write a type annotation, yet the compiler reconstructs and checks types
throughout. Several characteristics give the type system its particular flavor:

- **Inferred‑but‑fixed nominal data types.** A `type` declaration lists only
  *names* — field names for a record, variant names for a union — never field
  types. The compiler infers each field's type from first use and then enforces
  it everywhere. Once `Square { 10 }` fixes `side` to be an integer, a later
  `Square { "ten" }` is a *Type mismatch* error.
- **Monomorphic data constructors — with an opt‑in generic escape hatch.**
  By default, inference unifies the payload type of a given constructor across a
  module, so a constructor effectively has one payload type per file. Marking a
  type declaration `generic` turns that off, letting each use site carry its own
  payload type — this is how the built‑in `Pair`, `Option`, and `Result` behave,
  and you can request it for your own types (see
  [§2.4](#24-constructor-monomorphism-and-generic-types)). The database
  libraries use both: a plain named result union when one payload type suffices,
  and `generic type` when one result union must wrap many different payloads.
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
| Iteration | recursion, HOFs, comprehensions | recursion, **`while`**, sequenced statements |
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
  [§4.6](#46-bytes-and-characters) and [§22](#22-file--files-and-binary-io).)
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

### 2.4 Constructor monomorphism and `generic` types

By default, inference unifies the payload type of a constructor across a module,
so **a given union constructor has one payload type per module.** The `dbschema`
sources describe the effect of ignoring this:

> Using `Ok`/`Err` directly causes HM inference to unify all `Ok.value` types
> across the file.

Concretely, if two functions in one file both return `Ok { … }` but with
different payloads (say an `Ok { columns }` and an `Ok { table }`), inference
tries to make those payloads the *same* type and reports a mismatch.

There are two ways to handle this — pick per situation:

**1. A dedicated named result union** — when a module has a *few* fallible
operations, give each its own union so their payloads never unify:

```pfun
export type ColsResult  = { | ColsOk  : columns | ColsErr  : message }
export type ConsResult  = { | ConsOk  : cons    | ConsErr  : message }
export type TableResult = { | TableOk : table   | TableErr : message }
```

**2. A `generic` type** — when one result union must wrap *many* different
payloads, declare it once with the `generic` keyword. A `generic type` opts its
constructors out of cross‑use‑site unification, so each use may carry a different
payload type — exactly like the built‑in `Pair`/`Option`/`Result`:

```pfun
// From dbschema.pf — one result union reused across every generated model:
export generic type InsertResult = { | InsertOk : model | InsertErr : message }
export generic type FindResult   = { | FindOk   : model | FindErr   : message }
export generic type MutResult    = { | MutOk            | MutErr    : message }
```

Here `insertUser` may return `InsertOk { aUserRecord }` and `insertOrder` may
return `InsertOk { anOrderRecord }` in the *same* module without their `model`
fields being forced to unify. The keyword goes before `type`, works on both
record and union declarations, and composes with `export`
(`export generic type …`).

The rule of thumb: reach for a **plain named union** when the distinct payloads
are few and worth naming; reach for **`generic type`** when a single result shape
is genuinely reused across many unrelated payloads (as generated database code
is). The built‑ins `Pair`, `Option`, and `Result` are all `generic`, which is
why you can freely mix `Some { 1 }` and `Some { "x" }` across a file.

> **Non‑generic constructors still unify per module.** If you use the built‑in
> `Ok`/`Err` (from `Result`, which *is* generic) the payloads may differ, but a
> *hand‑declared* non‑generic union's constructors will unify. When in doubt and
> the payloads vary, add `generic`.

> **When the conflict actually fires.** The clash surfaces when some code *pins*
> the payload to a concrete type — typically a `match` arm that reads a
> type‑specific sub‑field of the payload. Merely *constructing* a plain union's
> variant with different payloads in separate functions may compile on its own;
> the error appears once a use pins the field. This is why a generated model
> module full of `InsertOk { … }` constructions can compile in isolation, yet a
> consumer that inserts two different models *and* inspects `.model` on both
> triggers the mismatch. Marking the result type `generic` removes the hazard
> entirely, which is the recommendation for any result union reused across
> payloads.

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

### 3.5 Precedence

Precedence, from highest (binds tightest) to lowest:

1. postfix `.` field access, `(…)` call, `[…]` index
2. unary `!`, unary `-`
3. `*` `/` `%`
4. `+` `-`
5. shifts `<<` `>>`
6. bitwise `&`
7. bitwise `|`
8. comparisons `<` `>` `<=` `>=`
9. equality `==` `!=`
10. `&&`
11. `||`
12. ternary `? :`
13. forward pipe `|>`  (see [§3.6](#36-the-pipe-operator))
14. assignment `=`

Two consequences worth noting because they differ from C:

- **Bitwise operators bind *tighter* than comparison and equality.** In Pfun
  `x & MASK == 0` parses as `(x & MASK) == 0` — the usually‑intended reading —
  whereas C parses the same text as `x & (MASK == 0)`. Shifts bind tighter than
  `&`, which binds tighter than `|`, which binds tighter than comparison.
- **Arithmetic binds tighter than the pipe**, so `a + b |> f` means `f(a + b)`,
  and **the pipe binds looser than the ternary**, so `c ? x : y |> f` means
  `f(c ? x : y)`.

Bitwise expressions were left unparenthesized‑ambiguous in earlier drafts of this
manual; the ordering above is now fixed by the parser. You may still
parenthesize for readability, but you no longer need to.

### 3.6 The pipe operator

`x |> f` is the **forward pipe**: it desugars to `f(x)`. It reads left to right,
so a chain of transformations is written in the order they happen instead of
inside‑out:

```pfun
// instead of the inside-out  h(g(f(x))) :
x |> f |> g |> h            // f then g then h
```

`|>` is left‑associative and low‑precedence (just above assignment), so the whole
expression to its left is what gets piped:

```pfun
function double(x) { x * 2; }
function addOne(x) { x + 1; }

println(5 |> double);              // 10
println(3 |> addOne |> double);    // 8      ((3+1)*2)
println(2 + 3 |> double);          // 10     double(2 + 3), arithmetic binds tighter
println(["a","b","c"] |> length);  // 3      works with any function, built-in or not
println([1,2,3] |> reverse |> __str__);   // [3, 2, 1]
```

**Inline lambdas** pipe cleanly for one‑off steps:

```pfun
let msg = "hello"
  |> fn s => s + " world"
  |> fn s => s + "!";            // "hello world!"

// sum of squares of the even numbers in 1..10
let total = [1,2,3,4,5,6,7,8,9,10]
  |> fn xs => filter(fn x => x % 2 == 0, xs)
  |> fn xs => map(fn x => x * x, xs)
  |> fn xs => reduce(fn a, x => a + x, 0, xs);   // 220
```

**Piping into a partially applied function.** The right operand may itself be a
call that returns a function; the piped value is then applied as that function's
*next* (in practice, last) argument. Because Pfun curries
([§5.5](#55-currying-and-partial-application)), `x |> f(y)` becomes `f(y)(x)`,
i.e. `f(y, x)`:

```pfun
// addTest(t, s) takes a test and a suite; piping the suite in fills `s`:
let suite = emptySuite("math")
  |> addTest(test("adds", addsTest))       // addTest(test(...), suite)
  |> addTest(test("subs", subsTest));
```

Because `|>` is pure sugar for a call, it is usable in both `function`s and
`proc`s, and it works with lazy lists exactly as an ordinary call would.

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

A union declaration may be prefixed with `generic` to make its constructors
polymorphic in their payloads — each use site may then carry a different field
type instead of unifying module‑wide. This is the mechanism behind the built‑in
`Option`/`Result` and behind reusable result unions like `dbschema`'s
`InsertResult`; see [§2.4](#24-constructor-monomorphism-and-generic-types).

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

### 10.4 Matching multi-variant results

`Result` is the sole owner of `Ok`/`Err`. A semantically different outcome union
uses distinct constructor names: matching the file module's three-state
`ReadResult` requires `ReadOk | ReadEof | ReadErr`. (See
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
[§2.4](#24-constructor-monomorphism-and-generic-types): re‑declaring ensures
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

### 14.2 Iteration by recursion

Recursion is the primary iteration mechanism in both layers, made practical by
tail‑call optimization, and it is the *only* one available in pure functions.
Procedural loops are often written with a locally defined helper procedure:

```pfun
proc readAllLines(path) {
  match fileOpen(path, Read) with
    | Err e -> println("Could not open " + path + ": " + e.message)
    | Ok o  -> {
        var handle = o.value;
        proc readLoop(lineNum) {          // nested helper proc
          match readLine(handle) with
            | ReadOk  l -> { println($"  {lineNum}: {l.value}"); readLoop(lineNum + 1); }
            | ReadEof _ -> 0
            | ReadErr e -> println("Read error: " + e.message);
        }
        readLoop(1);
        fileClose(handle);
      }
}
```

Note that procedures may be **nested** inside other procedures (`readLoop` inside
`readAllLines`, `loop` inside `replLoop` in `tiny-lisp.pf`), capturing the
enclosing procedure's bindings.

For straightforward imperative counting and accumulation, procedural code may
also use a `while` loop, covered next.

### 14.3 `while` loops

A `while` loop is a **statement** available in procedural contexts only —
procedures and the top level. It is rejected inside a pure `function`
(`"'while' loops are not allowed in pure functions. Move the loop to a
procedure."`), where recursion remains the way to iterate.

```
while (<condition>) { <statements> }
```

- The parentheses around the condition and the braces around the body are
  **required** (the body is always a block, even for a single statement).
- The condition is re‑evaluated before every iteration; the loop runs while it
  is truthy.
- There is **no `break` or `continue`.** Exit by making the condition false —
  fold the early‑exit test into the condition itself.
- Each iteration runs its body in a fresh inner scope, so a `var` declared
  *inside* the body is recreated each pass; the loop‑control `var` lives in the
  enclosing scope and persists across iterations.

```pfun
proc countTo(n) {
  var i = 1;
  while (i <= n) {
    print(__str__(i) + " ");
    i = i + 1;
  }
  println("");
}
countTo(5);                 // 1 2 3 4 5

// "early exit" folded into the condition:
proc firstMultipleOf7(factor, limit) {
  var n = factor;
  while (n <= limit && n % 7 != 0) {
    n = n + factor;
  }
  if n <= limit then println("found: " + __str__(n))
  else println("none found");
}
firstMultipleOf7(3, 50);    // found: 21

// accumulating into a var, with nested loops:
proc collatz(n) {
  var seq = [n];
  var x   = n;
  while (x != 1) {
    if x % 2 == 0 then x = x / 2 else x = x * 3 + 1;
    seq = seq + [x];
  }
  seq;
}
println(__str__(length(collatz(6))));   // 9
```

`while` and recursion are interchangeable for most loops; choose whichever reads
better. Recursion is required in pure code and often clearer for
list‑structured traversals; `while` is frequently clearer for counter‑driven
mutation of a `var`, a `dict`, or an `array`.

### 14.4 Sequencing and blocks

Within a procedure, statements execute top to bottom. A `{ … }` block groups
statements; in a `match` arm a block lets an arm perform several effects:

```pfun
match writeFile(dst, o.value) with
| Ok _  -> 0
| Err e -> println("Write failed: " + e.message);
```

### 14.5 `eval` — forcing a value

`eval <expr>;` evaluates an expression and **fully forces** its result. It is a
statement (procedural / top‑level), distinct from a bare expression statement in
that it forces lazy structure rather than leaving unevaluated thunks in place.
Its main uses are in the REPL — where `eval` displays the forced value of an
expression — and, occasionally, to force a lazy computation purely for its
timing. In ordinary programs you rarely need it: `print`/`println` and pattern
matching already force what they consume.

```pfun
eval take(5, iterate(fn x => x + 1, 1));   // forces [1, 2, 3, 4, 5]
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

### 15.3 Growable buffers (byte and string builders)

A **buffer** is a mutable, growable sequence of bytes — Pfun's equivalent of a
byte builder or string builder. It avoids the quadratic cost of repeatedly
concatenating immutable strings in a loop. A buffer is created in one of two
modes: `ByteMode` for raw bytes, `CharMode` for UTF‑8 text.

| Call | Kind | Effect |
|---|---|---|
| `makeBuffer(mode)` | — | new empty buffer (`mode` = `ByteMode` \| `CharMode`) |
| `makeStringBuffer(str)` | — | new `CharMode` buffer pre‑filled with `str` |
| `appendChar(buf, char)` | proc‑only | UTF‑8 encode and append one `Char` |
| `appendString(buf, str)` | proc‑only | UTF‑8 encode and append a `String` |
| `appendBuffer(buf, bytes)` | proc‑only | append a `List<Byte>` |
| `bufferLength(buf)` | pure | current length in bytes |
| `bufferToBytes(buf)` | pure | snapshot as `List<Byte>` |
| `bufferToString(buf)` | pure | UTF‑8 decode to a `String` (`CharMode` buffers) |

The three `append*` operations mutate the buffer and are therefore procedure‑only
(a pure `function` that calls them is rejected: *"Functions cannot use
'appendString'"*). The read‑back operations are pure.

```pfun
proc buildCsvRow(cells) {
  var buf = makeStringBuffer("");
  proc go(cs, first) {
    if length(cs) == 0 then return bufferToString(buf);
    if !first then appendChar(buf, ',');
    appendString(buf, head(cs));
    go(tail(cs), false);
  }
  go(cells, true);
}
println(buildCsvRow(["a", "b", "c"]));   // a,b,c
```

`makeBuffer(ByteMode)` with `appendBuffer` is the byte‑oriented counterpart, used
when assembling binary output before a single `writeBytes`/`writeBuffer`
([§22.4](#224-binary-and-buffer-io)).

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
ReadResult  = ReadOk { value } | ReadEof | ReadErr { message }
```

`Result` is returned by file writes, `fileOpen`/`fileClose`, the database
drivers, and HTTP calls. `ReadResult` is returned by the streaming file readers
(`readChar`, `readLine`, `readByte`, …), which add a distinct `ReadEof` case for
a clean end‑of‑file.

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
- Put a dedicated domain-error union in `Result`'s error slot when callers need
  structured failures. Use a combined union when an operation can return errors
  from several domains.
- Use a separate outcome union only when the states are semantically different
  from success/failure, as with `ReadResult`'s clean end-of-file state. Give its
  variants distinct program-global names.

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

### 19.6 Rounding and numeric predicates

These operate on `Int`/`Float` and are always available (no import — they are
distinct from the `math` module in [§23](#23-math)):

| Function | Result | Notes |
|---|---|---|
| `floor(x)` | round toward −∞ (`Int`) | integer input returned unchanged |
| `ceil(x)` | round toward +∞ (`Int`) | integer input returned unchanged |
| `round(x)` | round to nearest, half up (`Int`) | errors on `NaN`/`Infinity` |
| `isNaN(x)` | `Bool` | `true` only for a `Float` `NaN` |
| `isFinite(x)` | `Bool` | `true` for any `Int`; for a `Float`, false on `NaN`/`Infinity` |

```pfun
println(floor(2.9));       // 2
println(ceil(2.1));        // 3
println(round(2.5));       // 3
println(isFinite(1.0));    // true
println(isNaN(0.0 / 0.0)); // true
```

(`isInfinite(x)` is unrelated: it tests whether a value is a *lazy list*, not a
floating‑point infinity — see [§7](#7-lazy-and-infinite-lists).)

## 20. Built-in types

These union/record types are defined by the standard library rather than by user
code, but they differ in how you bring them into scope:

| Type | Variants / fields | Availability | Used by |
|---|---|---|---|
| `Option` | `Some { value }` \| `None` | **always in scope** (no import) | `find`, `findSlice`, `readln`, `readChar`, `jsonSerialize`, `jsonDeserialize`, user code |
| `Pair` | `{ key, value }` (generic record) | **always in scope** (no import) | `dictToList`/`listToDict`, db rows |
| `Result` | `Ok { value }` \| `Err { message }` | **always in scope** (no import) | compiler, `file`, `http`, `db/*`, user code |
| `ReadResult` | `ReadOk { value }` \| `ReadEof` \| `ReadErr { message }` | in scope once you `import "file"` | streaming file reads |

`Option`, `Pair`, and `Result` are registered globally, so their constructors
are available in every program. There is exactly one core `Result`; modules
must not redeclare it or define collision-avoidance wrappers such as
`FileResult`. Domain-specific error unions belong in `Result`'s error slot.
`ReadResult` is a true three-state exception and deliberately uses distinct
constructors (see [§10.4](#104-matching-multi-variant-results)).

## 21. `io` — console I/O

`import * from "io";`

| Function | Signature | Effect |
|---|---|---|
| `println(x)` | any → () | print `x` and a newline |
| `print(x)` | any → () | print `x`, no newline |
| `flushStdout()` | () → () | flush buffered stdout |
| `readln()` | () → `Option<String>` | read a line (newline stripped); `None` at EOF — proc‑only |
| `readChar()` | () → `Option<Char>` | read one character; `None` at EOF — proc‑only |
| `scriptArgs()` | () → `List<String>` | command‑line arguments to the program — proc‑only |
| `getEnv(name)` | `String` → `Option<String>` | one environment variable; `None` if unset — proc‑only |
| `envVars()` | () → `Dict<String,String>` | all environment variables as a dict — proc‑only |

`scriptArgs`, `getEnv`, and `envVars` read the process environment, so they are
effectful (a pure `function` calling `getEnv` would be reading a side channel)
and are proc‑only like the input procedures.

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
- **`Result<T, NativeError>`** `Ok { value } | Err { message }` — non‑read operations.
- **`ReadResult<T, NativeError>`** `ReadOk { value } | ReadEof | ReadErr { message }` — streaming reads.

### 22.2 Convenience functions (no handle management)

| Function | Result |
|---|---|
| `readFile(path)` | `Result` — `Ok { value }` is the file contents |
| `writeFile(path, content)` | `Result` — `Ok { value }` is the character count |
| `fileExists(path)` | `Result` — `Ok { value }` is the existence Boolean |

```pfun
match writeFile(tmpPath, "Hello from Pfun!") with
  | Ok _  -> println("Wrote file")
  | Err e -> println("Write error: " ++ nativeErrorMessage(e.message));
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
| `readByte(handle)` | `ReadResult` — `ReadOk { Byte }` \| `ReadEof` \| `ReadErr` |
| `writeByte(handle, byte)` | `Result` — `Ok { 1 }` \| `Err` |
| `readBytes(handle, n)` | `ReadResult` — `ReadOk { List<Byte> }` \| `ReadEof` \| `ReadErr` |
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

**Constants** (each is a nullary function you call — `pi()`, not `pi`):

| Constant | Value |
|---|---|
| `pi()` | π |
| `e()` | Euler's number |
| `tau()` | 2π |
| `inf()` | positive infinity |
| `nan()` | not‑a‑number |

**General functions:**

| Function | Signature → result | Notes |
|---|---|---|
| `sqrt(x)` | square root (`Float`) | |
| `cbrt(x)` | cube root (`Float`) | |
| `pow(base, exp)` | `base` raised to `exp` (`Float`) | |
| `exp(x)` | eˣ | |
| `log(x)` | natural logarithm | |
| `log2(x)` / `log10(x)` | base‑2 / base‑10 logarithm | |
| `abs(x)` | absolute value | preserves `Int`/`Float` |
| `sign(x)` | −1, 0, or 1 | preserves `Int`/`Float` |
| `min(a, b)` / `max(a, b)` | smaller / larger of two | |
| `clamp(lo, hi, x)` | constrain `x` to `[lo, hi]` | |
| `fmod(x, y)` | floating‑point remainder | |
| `hypot(x, y)` | √(x²+y²) | |
| `lerp(a, b, t)` | linear interpolation `a → b` by `t` | |

**Trigonometry** (radians): `sin`, `cos`, `tan`, `asin`, `acos`, `atan`,
`atan2(y, x)`, and the hyperbolic `sinh`, `cosh`, `tanh`.

```pfun
println(sqrt(2.0));                       // 1.41421356...
println(pow(2.0, 16.0));                  // 65536
println(clamp(0, 100, 150));              // 100
println(round(lerp(0.0, 100.0, 0.25)));   // 25
println(atan2(1.0, 1.0));                 // 0.7853981... (π/4)
```

> `round`, `ceil`, `floor`, `isFinite`, and `isNaN` are **core built‑ins**, not
> part of the `math` module — they need no import. See
> [§19.6](#196-rounding-and-numeric-predicates).

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
| `sleep(ms)` | a Promise resolving to `Result<Unit, NativeError>` after `ms` milliseconds |

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

The command‑line/server HTTP client is **GET‑only**:

| Function | Result | Body type |
|---|---|---|
| `httpGet(url)` | Promise of `Ok { value }` / `Err { message }` | `value.body` is UTF‑8 text |
| `httpGetBytes(url)` | same | `value.body` is a `List<Byte>` |

On success, `value` has fields `status`, `headers`, and `body`. These calls
**never reject** — failure is reported as `Err`, so you always `match` rather than
catch:

```pfun
let home = await httpGet("http://localhost:7999/");
match home with
| Ok r  -> println("GET / -> " + r.value.status + ": " + r.value.body)
| Err e -> println("GET / failed: " + e.message);
```

> **`httpPost` is browser‑only.** There is a `httpPost(url, value)` that sends
> `value` as `__pfun`‑tagged JSON and returns the deserialized reply, but it is
> available **only in the browser target** (it uses the browser's `fetch`). Under
> the command‑line interpreter it returns `Err { "httpPost() is browser-only." }`.
> In practice you rarely call it directly: the TEA runtime's `Send` command
> ([§28.3](#283-tea--the-elm-architecture-runtime)) is what issues browser POSTs,
> and on the server side `serverDispatch`
> ([§28.5](#285-serverdispatch--declarative-server-dispatch)) receives them. For
> server‑to‑server POSTs, expose the operation over your own HTTP handler
> instead.

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

Exported `View` variants: `VText`, `VEl` (a generic container with `tag`,
`attrs`, `children`), `VButton` (with optional `attrs`), `VTextInput`,
`VCheckbox`, `VSelect`, `VColorInput`, `VRangeInput`, and `VContent` (embed a
static `htmllib` `Block`).

Exported constructors: `vtext`, `vbutton`, `vbuttonClass`, `vdiv`, `vspan`, `vp`,
`vh`, `vdivClass`, `vdivId`, `vspanId`, `vinput`, `vcheckbox`, `vselect`,
`vcolor`, `vrange`, `vcontent`; renderers `renderView`, `renderViews`,
`renderViewChoice`; helper `boolStr`.

`vcolor(name, value, onInput)` renders a color picker and `vrange(name, value,
min, max, step, onInput)` a slider; both feed their new value through an
`fn Str -> Msg` transformer, exactly like `vinput`.

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

### 28.5 `serverDispatch` — declarative server dispatch

`serverDispatch` is the **server‑side counterpart to `tea`**: where `tea` runs a
pure `update` against browser events, `serverDispatch` runs a pure `update`
against incoming requests, and owns the effectful shell (connect, parse, run the
operation, serialize the reply). It ties together `http`, `db/*`, `json`, and a
shared request/response union, and it exists precisely for the full‑stack pattern
the memory of the corpus revolves around: a `ClientMsg`/reply union shared by
client and server, matched exhaustively on both ends.

Its closed effect set mirrors `tea`'s `Cmd`:

| `ServerCmd` variant | Meaning |
|---|---|
| `Reply { msg }` | terminal — the loop ends and `msg` is sent back to the client |
| `Perform { op, onResult }` | run the typed operation `op`, then feed its typed result back through `update` via `onResult : result -> msg` |
| `NoOp` | `update` declined to act — treated as a dispatch error, since every chain must end in `Reply` |

The library never constructs or inspects `op`/`result`; the application supplies
an exhaustive `runOp` interpreter, and each `Perform`'s `onResult` closure keeps
the chain fully typed (the app's own `update` clauses pin `result`'s type by
pattern matching). This is the same closed‑union technique that makes `tea`'s
`Send` total, applied to server effects.

Exported interface:

| Name | Kind | Purpose |
|---|---|---|
| `ServerCmd` | type | `Reply` \| `Perform` \| `NoOp` |
| `runDispatch(msg, update, runOp, mkErr, conn)` | async proc | drives one request's `update`→`Perform`→…→`Reply` chain to its terminal reply |
| `dispatchHttp(req, res, wrapIncoming, update, runOp, mkErr, connectionString)` | async proc | full HTTP boundary: connects, `jsonDeserialize`s the body into the wire `ClientMsg`, lifts it with `wrapIncoming`, runs `runDispatch`, serializes the reply, and closes the connection |

`dispatchHttp` owns only the connection lifecycle and the JSON/HTTP envelope;
*what* a request does and what an error reply looks like are the application's,
supplied as `runOp` and `mkErr`. A handler is then a one‑liner:

```pfun
async proc handle(req, res) {
  dispatchHttp(
    req, res,
    fn c => Incoming { c },        // wrapIncoming: ClientMsg -> SvrMsg
    update,                        // pure: SvrMsg -> ServerCmd
    runOp,                         // async: (op, conn) -> result
    fn m => ServerErr { m },       // mkErr:  String -> reply
    CONNECTION_STRING
  );
}
httpListen(8080, handle);
```

The `announcements_*` programs (`_protocol`, `_repo`, `_server`, `_client`) are a
worked full‑stack example built on this library together with `dataModelGen`‑style
generated data access.

---

# 29. Data model persistence

Above the raw drivers of [§27](#27-dbpostgresql-and-dbmariadb) sits a schema‑driven persistence
layer that turns a live PostgreSQL schema into a strongly‑typed Pfun data‑access
module. It is a three‑stage pipeline:

1. **Introspect** — read the database's own catalog into schema metadata
   (`dbschema.pf`).
2. **Generate** — transform that metadata into a complete `.pf` module of model
   types and CRUD procedures (`dataModelGen.pf`, a *pure* function).
3. **Use** — import the generated module and call its typed `insert`/`find`/
   `update`/`delete` procedures, matching on their result unions.

Stages 1 and 2 are separated deliberately: introspection is effectful (it hits
the database), but generation is a pure `String`‑to‑`String` transform, so it is
easy to test with fixtures and produces deterministic output.

### 29.1 Schema introspection (`dbschema`)

`dbschema.pf` connects to a schema and reads `information_schema` into records —
`Table`, `Column`, `Constraint` — plus a `PgType` union classifying each column's
SQL type. Its loaders return the dedicated result unions noted in
[§17.2](#172-choosing-option-vs-result-vs-a-custom-union) (`ColsResult`, `ConsResult`,
`TableResult`, `SchemaResult`), one per payload so their success types don't
unify. It also computes a **schema fingerprint** — a hash of the structural
shape — used later for drift detection.

### 29.2 The generated module

`dataModelGen.pf`'s entry point is
`generateOutput(schemaName, tables, lookupValues, lookupTableNames)`, returning
the full text of a `.pf` file. For each table it emits:

**A model record** named in PascalCase (`order_items` → `OrderItemModel`), whose
fields are the columns in camelCase (`customer_id` → `customerId`), and whose
first field is the primary key wrapped in `MaybeId` (below). Column names that
collide with keywords are suffixed with `_` (`type` → `type_`), via
`safeFieldName`.

**Lookup enums.** A table designated a *lookup table* becomes a variant‑only
union instead of a record — `AnnouncementTypeModel = { | Event | Info | Urgent |
Warning }` — with `parseX`/`xToStr` converters. Parsing returns a purpose‑built
`ParseResult = { | ParseOk : val | ParseFail }` rather than `Option`, again to
avoid payload unification across the many generated parsers.

**Row helpers.** Typed getters (`getStr`, `getInt`, `getFloat`, `getBool`) read a
`DbValue` out of a row (a `list<Pair<String, DbValue>>`), and `rowToXModel`
assembles a model from a result row.

**CRUD procedures** (all `async proc`), described in
[§29.4](#294-the-generated-crud-contract).

**A fingerprint + `verifySchema`**, described in
[§29.5](#295-schema-drift-detection).

The generated file opens by **re‑declaring the core types locally** — `MaybeId`,
`InsertResult`, `FindResult`, `MutResult` — because `Ok`/`Err`‑style constructors
must be in scope in the module that builds them ([§20](#20-built-in-types)).

### 29.3 The `MaybeId` lifecycle

Every model's identity field has type `MaybeId = { | New | Id : value }`,
capturing whether a record has been persisted yet:

- **`New`** — an in‑memory record not yet written to the database. You construct
  models this way before inserting.
- **`Id { value }`** — a record with a database‑assigned primary key, as returned
  by `insert`/`find`.

This makes the persistence boundary explicit in the type. `update` and `delete`
pattern‑match on it and refuse an unsaved record rather than silently doing
nothing:

```pfun
export async proc updateAnnouncement(conn, m) {
  match m.maybeId with
  | New  -> MutErr { "Cannot update unsaved Announcement" }
  | Id _ -> { /* UPDATE … WHERE id = $n */ }
}
```

### 29.4 The generated CRUD contract

Each table gets five procedures with a uniform result contract:

| Procedure | Returns | Notes |
|---|---|---|
| `insertX(conn, m)` | `InsertResult` | `INSERT … RETURNING *`; on success `InsertOk { rowToXModel(row) }` — the returned model carries its new `Id` |
| `findXById(conn, id)` | `FindResult` | `FindErr { "Not found" }` when no row matches |
| `findAllX(conn)` | `list<XModel>` | returns `[]` on query error (a list, not a result union) |
| `updateX(conn, m)` | `MutResult` | requires `Id`; refreshes `updated_at`/`modified_at` to `now()` |
| `deleteX(conn, m)` | `MutResult` | requires `Id` |

The three result unions are:

```pfun
generic type InsertResult = { | InsertOk : model | InsertErr : message }
generic type FindResult   = { | FindOk   : model | FindErr   : message }
generic type MutResult    = { | MutOk            | MutErr    : message }
```

Auto‑timestamp columns (`created_at`, `updated_at`, `modified_at`,
`last_modified`) are handled for you: omitted from the `INSERT` column list and
set to `now()` on `UPDATE`, so they never appear as user‑supplied fields.

Consuming them is a `match`:

```pfun
async proc addAnnouncement(conn, draft) {
  match await insertAnnouncement(conn, draft) with
  | InsertOk saved -> println("saved a new announcement")
  | InsertErr e    -> println("insert failed: " + e.message);
}
```

> **A caveat on `generic` in generated code.** The `dbschema.pf` library declares
> `InsertResult`/`FindResult`/`MutResult` as `generic` (correct, since one union
> wraps every model's payload). The generator currently emits them **without**
> `generic` into each generated module. Such a module still compiles on its own —
> nothing inside it pins a payload ([§2.4](#24-constructor-monomorphism-and-generic-types)) —
> but it is fragile: a single consumer module that inserts *two different models*
> and inspects `.model` on both will hit the payload‑unification error. If you
> write such a consumer, the fix is to make the generated declarations `generic`
> (or split the consuming code across modules). This is a rough edge worth
> knowing about rather than a settled convention.

### 29.5 Schema drift detection

The generator embeds the fingerprint it computed and emits a `verifySchema`
procedure:

```pfun
export let SCHEMA_FINGERPRINT = "965745436";
export async proc verifySchema(conn) { /* re-hash the live schema, compare */ }
```

Calling `verifySchema(conn)` at startup re‑introspects the live database and
compares its fingerprint against the compiled‑in constant, so a schema that has
drifted from the generated model is caught immediately instead of surfacing as a
mismatched column at query time. The generated lookup parsers reinforce this: an
unrecognized enum value prints a `[Schema drift]` diagnostic.

### 29.6 Running the generator

`dbschema_gen.pf` is the effectful driver that wires the pieces together. Its
`main()` connects with the configured connection string, calls
`loadSchema(conn, schema)`, fetches lookup‑table values, calls `generateOutput`,
and writes the result to disk. Connection string, schema name, lookup tables, and
output path live in `dbschema_config.pf`, keeping credentials and targets out of
the generator. Regeneration is a single command:

```
pfun examples/db/dbschema_gen.pf
```

The generated file carries a `// Generated by dbschema_gen.pf -- do not edit by
hand.` header; treat it as a build artifact and re‑run the generator when the
schema changes.

### 29.7 Putting it together

A typical stack layers cleanly on top of the generated module:

- the **generated model module** provides typed rows and CRUD;
- a hand‑written **repository** (`announcements_repo.pf`) wraps CRUD with
  domain‑level operations and translates `XResult` values into the application's
  own reply union;
- **`serverDispatch`** ([§28.5](#285-serverdispatch--declarative-server-dispatch))
  exposes those operations over HTTP, using its closed `ServerCmd` set to run the
  effect and reply;
- a **client** shares the request/response protocol union and matches it
  exhaustively.

The `announcements_*` programs (`_schema.sql`, `_protocol`, `_repo`, `_server`,
`_client`) are the worked end‑to‑end example of exactly this layering.

---

# Appendix A — Reserved words and symbols

**Declaration & module keywords:** `function`, `fn`, `proc`, `memo`, `async`,
`let`, `var`, `type`, `generic`, `export`, `import`, `from`, `as`.

**Control & expression keywords:** `if`, `then`, `else`, `match`, `with`,
`where`, `for`, `while`, `return`, `eval`, `await`, `true`, `false`.

**Built‑in constructors always in scope:** `Some`, `None`, `Pair`, `Ok`, and
`Err`; the literal keywords `dict` and `array`. `ReadOk`, `ReadEof`, and
`ReadErr` enter scope with `import "file"`; see [§20](#20-built-in-types).

**Literal affixes:** `b` (byte suffix, `255b`), `0x` (hex prefix), `@` (raw
string prefix), `$` (format string prefix).

**Operators:** `+ - * / %` · `== != < > <= >=` · `&& || !` · `& | << >>` ·
`? :` · `|>` (forward pipe) · `=` (assignment) · `->` (match arm) · `=>` (lambda)
· `<-` (comprehension generator) · `|` (variant / union separator) · `.` (field
access) · `[]` (index / list) · `{}` (block / record).

# Appendix B — Known gaps and ambiguities

The following points are not fully determined by the available corpus; they are
flagged so readers do not over‑rely on them:

- **`async function`.** The documentation states both `async function` and
  `async proc` may use `await`, but only `async proc` is demonstrated. Treat
  async functions as supported‑but‑unexercised.
- **General truthiness.** Only `Byte` truthiness is documented explicitly (`0b`
  falsy, non‑zero truthy), and `while`/`if` conditions are forced through the
  same truthiness test the runtime uses. Whether types beyond `Bool`/`Byte` have
  a useful implicit truthiness is not exercised in the corpus; prefer explicit
  boolean conditions.
- **`println` without import.** `hello.pf` uses `println` with no import, while
  every other program imports `io`. Basic output appears globally available, but
  the corpus is not explicit about exactly which I/O names are global versus
  module‑scoped. The safe convention is to `import * from "io";`.
- **Legacy `printf`.** Referenced in comments as a former interpolating print, but
  never called in the corpus. Use `$"…"` format strings.

The following gaps flagged in earlier drafts are now **resolved** and folded into
the body of the manual:

- *Bitwise operator precedence* is fixed and documented in
  [§3.5](#35-precedence).
- *Monomorphic constructors* have an opt‑in escape hatch, the `generic` keyword,
  documented in [§2.4](#24-constructor-monomorphism-and-generic-types).

*End of manual.*

---

# Appendix C — Core language reference

Everything listed here is available without any `import` statement. These are the names seeded into the global environment at startup by the runtime before user code executes.

Functions are grouped by what they operate on. For each function, the signature uses the following conventions:

- Type variables `α`, `β` etc. denote polymorphic type parameters.
- `List<α>` means a list (strict or lazy) whose elements are of type `α`.
- `Str` is Pfun's string type — a sequence of characters.
- `Char` is a single Unicode codepoint.
- `Byte` is a value in the range 0–255.
- `Int` is a signed arbitrary-precision integer (Pfun's `BigInt`-backed integer type).
- `Float` is a 64-bit IEEE 754 double.
- `Bool` is `true` or `false`.
- `Option<α>` is `Some { value : α }` or `None`.

---

## C.1 Built-in types

These types and their constructor names are always in scope.

### `Option<α>`

```
type Option<α> = { | Some : value | None }
```

The standard optional value. Returned by `find`, `findSlice`, and any function that may produce no result. `Some { v }` wraps a value; `None` signals absence.

```pfun
match maybeValue with
| None   -> "nothing"
| Some v -> "got: " + __str__(v.value)
```

### `Pair<α, β>`

```
type Pair<α, β> = { key : α, value : β }
```

A generic two-field record. Used as the element type of `Dict<α, β>` when iterated via `dictToList` / `listToDict`, and available for any ad-hoc key-value pairing.

```pfun
let p = Pair { "name", "Pfun" };
println(p.key + " = " + p.value);
```

### `BufferMode`

```
type BufferMode = { | ByteMode | CharMode }
```

Passed to `makeBuffer` to select whether the buffer stores raw bytes (`ByteMode`) or UTF-8 text characters (`CharMode`). Both variants carry no fields.

---

## C.2 List and sequence functions

These operate on strict lists (`List<α>`), strings (`Str`), and where noted, lazy sequences.

### `head(list)`

```
head : List<α> | Str → α | Char
```

Returns the first element of a list or the first character of a string. Throws on an empty argument.

### `tail(list)`

```
tail : List<α> | Str → List<α> | Str
```

Returns everything after the first element. Throws on an empty argument.

### `cons(x, list)`

```
cons : α → List<α> | Str → List<α> | Str
```

Prepends `x` to a list. If `x` is a `Char` and the tail is a `Str`, the result is a `Str`. Fully curried — `cons(x)` returns a function.

### `map(fn, list)`

```
map : (α → β) → List<α> | Str | LazySeq<α> → List<β> | Str
```

Applies `fn` to each element. If every result is a `Char`, the output is a `Str`. Works on lazy sequences (returns a lazy sequence). Fully curried.

### `filter(pred, list)`

```
filter : (α → Bool) → List<α> | Str | LazySeq<α> → List<α> | Str
```

Keeps only elements for which `pred` returns `true`. Works on lazy sequences. Fully curried.

### `reduce(fn, init, list)`

```
reduce : (β → α → β) → β → List<α> | Str → β
```

Left-fold over a list. `init` is the starting accumulator. `fn` receives `(accumulator, element)`. Cannot be used on infinite sequences — call `take` first.

### `length(list)`

```
length : List<α> | Str → Int
```

Returns the number of elements in a strict list, or the number of characters in a string. Does not work on lazy sequences.

### `reverse(list)`

```
reverse : List<α> | Str → List<α> | Str
```

Reverses a strict list or string. Cannot be used on infinite sequences.

### `nth(list, n)`

```
nth : List<α> | Str → Int → α | Char
```

Returns the element at zero-based index `n`. Throws if `n` is out of bounds.

### `take(n, list)`

```
take : Int → List<α> | Str | LazySeq<α> → List<α> | Str
```

Returns the first `n` elements. Safe to call on infinite sequences — forces only `n` elements. Fully curried.

### `drop(n, list)`

```
drop : Int → List<α> | Str → List<α> | Str
```

Skips the first `n` elements and returns the rest. Fully curried.

### `slice(start, count, list)`

```
slice : Int → Int → List<α> | Str → List<α> | Str
```

Returns `count` elements beginning at zero-based index `start`. Equivalent to `take(count, drop(start, list))` but expressed as a single call.

### `find(list, item)`

```
find : List<α> → α → Option<Int>
```

Returns `Some { index }` of the first occurrence of `item` in `list`, or `None` if not found. Uses structural equality.

### `findSlice(list, pattern)`

```
findSlice : List<α> → List<α> → Option<Int>
```

Returns `Some { index }` of the first occurrence of the sub-list `pattern` inside `list`, or `None`. Used by `indexOf` in `stringlib`.

### `join(list, sep)`

```
join : List<α> | List<Char> → Str → Str
```

Concatenates the string representations of elements, interspersed with `sep`. When all elements are already `Char` values, joins without conversion. Note argument order: list first, separator second.

### `split(str, sep)`

```
split : Str → Str → List<Str>
```

Splits `str` on every occurrence of `sep`. If `sep` is `""`, splits into individual characters (returns a `List<Char>` rendered as a list of single-character strings).

### `range(lo, hi)`

```
range : Int → Int → List<Int>
```

Returns a strict list `[lo, lo+1, … hi-1]`. If `lo >= hi` the result is `[]`.

---

## C.3 Lazy sequence functions

These produce infinite (or potentially infinite) lazy sequences. Use `take` to materialise a finite prefix.

### `iterate(fn, seed)`

```
iterate : (α → α) → α → LazySeq<α>
```

Produces `[seed, fn(seed), fn(fn(seed)), …]` lazily. Fully curried.

```pfun
let nats = iterate(fn n => n + 1, 0);
println(__str__(take(5, nats)));   -- [0, 1, 2, 3, 4]
```

### `repeat(value)`

```
repeat : α → LazySeq<α>
```

Produces an infinite stream of `value`.

```pfun
take(3, repeat("x"))   -- ["x", "x", "x"]
```

### `cycle(list)`

```
cycle : List<α> → LazySeq<α>
```

Repeats `list` cyclically without end. The argument must be non-empty.

```pfun
take(5, cycle([1, 2, 3]))   -- [1, 2, 3, 1, 2]
```

### `isInfinite(seq)`

```
isInfinite : α → Bool
```

Returns `true` if its argument is a lazy (potentially infinite) sequence, `false` otherwise.

---

## C.4 Numeric functions

### `toInt(n)`

```
toInt : Float | Byte → Int
```

Converts a `Float` to an `Int` by truncating toward zero, or converts a `Byte` to its integer value. Does not accept strings — parse with `toFloat` first if needed.

### `toFloat(n)`

```
toFloat : Int | Float | Str → Float
```

Converts a numeric value or decimal string to `Float`. Throws if the string cannot be parsed.

### `floor(n)` / `ceil(n)` / `round(n)`

```
floor, ceil, round : Float | Int → Float
```

Standard rounding functions. All accept `Int` (promoting to `Float`) and return `Float`.

### `isNaN(n)`

```
isNaN : Float → Bool
```

Returns `true` if `n` is the IEEE 754 not-a-number value.

### `isFinite(n)`

```
isFinite : Float → Bool
```

Returns `true` if `n` is neither `Infinity`, `-Infinity`, nor `NaN`.

### `__str__(value)`

```
__str__ : α → Str
```

Converts any value to its string representation. For numbers: decimal. For booleans: `"true"` / `"false"`. For lists: `"[…]"`. For records: `"TypeName { field, … }"`. This is the underlying function the `$"…"` format-string syntax desugars to.

---

## C.5 Character and byte functions

### `asc(c)`

```
asc : Char → Int
```

Returns the Unicode code point (as an `Int`) of character `c`. For ASCII characters this equals the ASCII value.

```pfun
asc('A')   -- 65
```

### `chr(n)`

```
chr : Int → Char
```

Returns the character with Unicode code point `n`.

```pfun
chr(65)   -- 'A'
```

### `toByte(n)`

```
toByte : Int | Byte → Byte
```

Converts an `Int` in the range 0–255 to a `Byte`. Throws if the value is out of range. Returns a `Byte` unchanged.

### `toChar(b)`

```
toChar : Byte → Char
```

Converts a `Byte` value to the corresponding single-byte Unicode character.

### `charBytes(c)`

```
charBytes : Char → List<Byte>
```

Returns the UTF-8 byte sequence of character `c` as a `List<Byte>`. ASCII characters return a one-element list; non-ASCII characters return two to four bytes.

### `bytesToChar(bytes)`

```
bytesToChar : List<Byte> → Char
```

Reassembles a UTF-8 byte sequence into a single `Char`. Throws if the bytes do not form exactly one valid Unicode codepoint.

---

## C.6 Mutable array functions

Mutable arrays (`Array<α>`) are distinct from Pfun lists — they support O(1) indexed access and in-place mutation. They must be stored in `var` bindings, not `let`.

### `toArray(list)`

```
toArray : List<α> → Array<α>
```

Copies a strict list into a new mutable array.

### `toList(arr)`

```
toList : Array<α> → List<α>
```

Returns a snapshot of the array as a strict list.

### `arrayLength(arr)`

```
arrayLength : Array<α> → Int
```

Returns the number of elements currently in the array.

### `append(arr, value)`

```
append : Array<α> → α → unit
```

Appends `value` to the end of `arr` in place. Side-effecting — must be called with `eval`.

### `insertAt(arr, index, value)`

```
insertAt : Array<α> → Int → α → unit
```

Inserts `value` at zero-based `index`, shifting later elements right.

### `removeAt(arr, index)`

```
removeAt : Array<α> → Int → unit
```

Removes the element at zero-based `index`, shifting later elements left.

---

## C.7 Mutable dictionary functions

Mutable dictionaries (`Dict<Str, α>`) map string keys to values. They must be stored in `var` bindings.

### `listToDict(pairs)`

```
listToDict : List<Pair<Str, α>> → Dict<Str, α>
```

Creates a new mutable dictionary from a list of `Pair { key, value }` entries. Keys must be `Str`.

### `toDict(pairs)`

```
toDict : List<Pair<Str, α>> → Dict<Str, α>
```

Alias for `listToDict`. Both names are in scope.

### `dictToList(dict)`

```
dictToList : Dict<Str, α> → List<Pair<Str, α>>
```

Returns a snapshot of the dictionary as a list of `Pair { key, value }` entries. Order is unspecified.

### `has(dict, key)`

```
has : Dict<Str, α> → Str → Bool
```

Returns `true` if `key` is present in `dict`.

### `remove(dict, key)`

```
remove : Dict<Str, α> → Str → unit
```

Removes `key` from `dict`. No-op if the key is absent.

### `keys(dict)`

```
keys : Dict<Str, α> → List<Str>
```

Returns a snapshot of all keys. Order is unspecified.

### `values(dict)`

```
values : Dict<Str, α> → List<α>
```

Returns a snapshot of all values. Order corresponds to `keys`.

Dictionary entries can also be read and written via index syntax:

```pfun
var d = listToDict([Pair { "x", 1 }]);
let v = d["x"];       -- read: 1
d["x"] = 2;           -- write
```

---

## C.8 Buffer functions

Buffers are write-once, append-only byte or character accumulators that avoid repeated string concatenation. They must be stored in `var` bindings.

### `makeBuffer(mode)`

```
makeBuffer : BufferMode → Buffer
```

Creates a new empty buffer. Pass `ByteMode` for raw bytes or `CharMode` for UTF-8 characters.

### `makeStringBuffer()`

```
makeStringBuffer : unit → Buffer
```

Shorthand for `makeBuffer(CharMode)`.

### `appendBuffer(buf, byte)`

```
appendBuffer : Buffer → Byte → unit
```

Appends a single `Byte` to a `ByteMode` buffer.

### `appendChar(buf, char)`

```
appendChar : Buffer → Char → unit
```

Appends a single `Char` to a `CharMode` buffer.

### `appendString(buf, str)`

```
appendString : Buffer → Str → unit
```

Appends all characters of `str` to a `CharMode` buffer.

### `bufferToBytes(buf)`

```
bufferToBytes : Buffer → List<Byte>
```

Returns the accumulated contents of a `ByteMode` buffer as a `List<Byte>`.

### `bufferToString(buf)`

```
bufferToString : Buffer → Str
```

Decodes the contents of a `CharMode` buffer as a UTF-8 `Str`.

### `bufferLength(buf)`

```
bufferLength : Buffer → Int
```

Returns the number of bytes currently written to the buffer.

---

## C.9 Summary table

The table below lists every globally-available name in alphabetical order together with its arity (number of required arguments) and a brief description. Names that require a library import are excluded.

| Name | Arity | Description |
|------|-------|-------------|
| `__str__` | 1 | Convert any value to its string representation |
| `append` | 2 | Append an element to a mutable `Array` in place |
| `appendBuffer` | 2 | Append a `Byte` to a `ByteMode` buffer |
| `appendChar` | 2 | Append a `Char` to a `CharMode` buffer |
| `appendString` | 2 | Append a `Str` to a `CharMode` buffer |
| `arrayLength` | 1 | Element count of a mutable `Array` |
| `asc` | 1 | Unicode code point of a `Char` → `Int` |
| `bufferLength` | 1 | Byte count of a `Buffer` |
| `bufferToBytes` | 1 | `ByteMode` buffer → `List<Byte>` |
| `bufferToString` | 1 | `CharMode` buffer → `Str` |
| `bytesToChar` | 1 | UTF-8 `List<Byte>` → single `Char` |
| `ceil` | 1 | Round a `Float` up to the nearest integer |
| `charBytes` | 1 | `Char` → UTF-8 `List<Byte>` |
| `chr` | 1 | Code point `Int` → `Char` |
| `cons` | 2 | Prepend an element to a list |
| `cycle` | 1 | Repeat a list cyclically → lazy infinite sequence |
| `dictToList` | 1 | `Dict` → `List<Pair>` snapshot |
| `drop` | 2 | Skip first *n* elements of a list or string |
| `filter` | 2 | Keep elements satisfying a predicate |
| `find` | 2 | First index of an element → `Option<Int>` |
| `findSlice` | 2 | First index of a sub-list → `Option<Int>` |
| `floor` | 1 | Round a `Float` down to the nearest integer |
| `has` | 2 | Test key presence in a `Dict` |
| `head` | 1 | First element of a list or string |
| `insertAt` | 3 | Insert element into `Array` at an index |
| `isFinite` | 1 | `true` if a `Float` is neither ±∞ nor NaN |
| `isInfinite` | 1 | `true` if argument is a lazy sequence |
| `isNaN` | 1 | `true` if a `Float` is NaN |
| `iterate` | 2 | Unfold a lazy sequence from a seed and step function |
| `join` | 2 | Concatenate list elements with a separator |
| `keys` | 1 | `Dict` keys → `List<Str>` snapshot |
| `length` | 1 | Element count of a strict list or string |
| `listToDict` | 1 | `List<Pair>` → new mutable `Dict` |
| `makeBuffer` | 1 | Create a new empty `Buffer` |
| `makeStringBuffer` | 0 | Create a new empty `CharMode` `Buffer` |
| `map` | 2 | Apply a function to every element |
| `nth` | 2 | Element at a zero-based index |
| `range` | 2 | `[lo … hi-1]` as a strict `List<Int>` |
| `reduce` | 3 | Left-fold a list with an accumulator |
| `remove` | 2 | Remove a key from a `Dict` |
| `removeAt` | 2 | Remove element at index from an `Array` |
| `repeat` | 1 | Infinite lazy sequence of a constant value |
| `reverse` | 1 | Reverse a strict list or string |
| `round` | 1 | Round a `Float` to the nearest integer |
| `slice` | 3 | Sub-list: `slice(start, count, list)` |
| `split` | 2 | Split a `Str` on a separator |
| `tail` | 1 | All but the first element |
| `take` | 2 | First *n* elements (works on lazy sequences) |
| `toByte` | 1 | `Int` (0–255) or `Byte` → `Byte` |
| `toChar` | 1 | `Byte` → single-byte `Char` |
| `toArray` | 1 | Strict list → mutable `Array` |
| `toDict` | 1 | `List<Pair>` → new mutable `Dict` (alias for `listToDict`) |
| `toFloat` | 1 | `Int`, `Float`, or decimal `Str` → `Float` |
| `toInt` | 1 | `Float` (truncated) or `Byte` → `Int` |
| `toList` | 1 | Mutable `Array` → strict list snapshot |
| `values` | 1 | `Dict` values → `List<α>` snapshot |

*End of Appendix C.*
---

# Appendix D — Built-in library reference

Each section below documents one import namespace. All names in a section become available after `import * from "<namespace>";`. Nothing listed here is available without that import.

The same signature conventions as Appendix C apply. `Promise<α>` denotes a value that must be `await`-ed inside an `async proc`; the expression `await f(…)` has type `α`. All side-effecting functions are proc-only — calling them from a pure `function` is a compile-time purity error.

---

## D.1 `io` — Standard I/O

```pfun
import * from "io";
```

Provides terminal output, line input, command-line arguments, and environment access. All names are proc-only.

### Output

#### `print(value)`

```
print : α → α
```

Writes `__str__(value)` to stdout **without** a trailing newline, then returns `value`. Use `print` when building output incrementally across multiple calls.

#### `println(value)`

```
println : α → α
```

Writes `__str__(value)` to stdout followed by a newline, then returns `value`. The most common output function.

#### `flushStdout()`

```
flushStdout : unit → Bool
```

Flushes any buffered stdout output. Returns `true`. Normally not needed — `println` is synchronous — but useful before a blocking `readln` call in interactive programs.

### Input

#### `readChar()`

```
readChar : unit → Option<Char>
```

Reads one character from stdin. Returns `Some { char }` or `None` at end-of-file. Blocks until a character is available.

#### `readln()`

```
readln : unit → Option<Str>
```

Reads one line from stdin, stripping the trailing newline. Returns `Some { line }` or `None` at end-of-file. Blocks until a full line is available.

### Environment

#### `scriptArgs()`

```
scriptArgs : unit → List<Str>
```

Returns the command-line arguments passed to the running script — everything after the script filename. `pfun myscript.pf foo bar` gives `["foo", "bar"]`.

#### `getEnv(name)`

```
getEnv : Str → Option<Str>
```

Looks up a single environment variable by name. Returns `Some { value }` if set, `None` otherwise.

#### `envVars()`

```
envVars : unit → Dict<Str, Str>
```

Returns all environment variables visible to the process as a mutable dictionary.

---

## D.2 `file` — Filesystem I/O

```pfun
import * from "file";
```

### Types

#### `FileHandle`

```
type FileHandle = { | ReadHandle | WriteHandle }
```

An open file handle. `ReadHandle` and `WriteHandle` are zero-field variants returned by `fileOpen`.

#### `FileMode`

```
type FileMode = { | Read | Write | Append }
```

Passed to `fileOpen` to select the access mode.

#### `Result<α, ε>`

```
type Result<α, ε> = { | Ok : value | Err : message }
```

The ambient two-outcome result type used throughout `file`. `Ok { value }`
carries the success payload; `Err { message }` carries a `NativeError` for
native file operations.

`NativeError` variants carry `operation` and `message` fields. File failures
use `NativeIoError`; category-independent reporting can use
`nativeErrorOperation(error)` and `nativeErrorMessage(error)`.

#### `ReadResult<α, ε>`

```
type ReadResult<α, ε> = { | ReadOk : value | ReadEof | ReadErr : message }
```

Used by `readChar` and `readByte` to distinguish a successful read, end-of-file, and an I/O error.

#### `DirEntry`

```
type DirEntry = { name : Str, isDir : Bool }
```

One entry returned by `listDir`. `name` is the base filename (not the full path); `isDir` is `true` for directories.

#### `WatchEvent`

```
type WatchEvent = { eventType : Str, filename : Str }
```

Passed to the handler proc by `watchDir` on each filesystem event. `eventType` is `"rename"` or `"change"` (raw Node.js values). `filename` is the affected filename within the watched directory, or `""` if unavailable.

### File existence and metadata

#### `fileExists(path)`

```
fileExists : Str → Result<Bool, NativeError>
```

Returns `Ok { true }` if a file or directory exists and `Ok { false }` if the
path is absent. Permission, validation, and platform failures are
`Err { NativeIoError { ... } }`.

#### `fileSize(path)`

```
fileSize : Str → Result<Int>
```

Returns `Ok { size }` in bytes, or `Err` if the path does not exist.

#### `isDir(path)`

```
isDir : Str → Bool
```

Returns `true` if `path` exists and is a directory. Returns `false` for missing paths, files, or any error — never throws.

### File operations

#### `touchFile(path)`

```
touchFile : Str → Result<unit>
```

Creates an empty file at `path` if it does not exist, or updates its modification time if it does. Returns `Ok { 0 }` or `Err`.

#### `removeFile(path)`

```
removeFile : Str → Result<unit, NativeError>
```

Deletes the file at `path`. Returns `Ok { 0 }` or `Err`.

#### `renameFile(from, to)`

```
renameFile : Str → Str → Result<unit>
```

Renames (or moves) a file or directory. Overwrites the destination atomically if it exists (POSIX semantics). Returns `Ok { 0 }` or `Err`.

#### `mkdirP(path)`

```
mkdirP : Str → Result<unit, NativeError>
```

Creates `path` and any missing parent directories. Equivalent to `mkdir -p`. Returns `Ok { 0 }` or `Err`.

#### `readFile(path)`

```
readFile : Str → Result<Str, NativeError>
```

Reads the entire file at `path` as a UTF-8 string. Returns `Ok { contents }` or `Err`.

#### `writeFile(path, content)`

```
writeFile : Str → Str → Result<unit, NativeError>
```

Writes `content` to `path`, creating or truncating the file. Returns `Ok { 0 }` or `Err`.

### Directory operations

#### `listDir(path)`

```
listDir : Str → Result<List<DirEntry>>
```

Lists the contents of a directory. Each entry is a `DirEntry { name, isDir }`. Returns `Err` if `path` does not exist or is not a directory.

#### `watchDir(path, handler)`

```
watchDir : Str → proc(WatchEvent) → Result<unit>
```

Watches `path` for filesystem changes. `handler` is a proc called with a `WatchEvent` on each event; it runs as a spawned task. Returns `Ok { 0 }` immediately (non-blocking) or `Err` if the path cannot be watched. The watcher runs until the process exits.

### Handle-based I/O

#### `fileOpen(path, mode)`

```
fileOpen : Str → FileMode → Result<FileHandle, NativeError>
```

Opens the file at `path` in the given mode. Returns `Ok { handle }` or `Err`.

#### `fileClose(handle)`

```
fileClose : FileHandle → Result<unit, NativeError>
```

Closes an open file handle. Closing an invalid or already-closed handle returns
`Err`.

#### `readChar(handle)`

```
readChar : FileHandle → ReadResult<Char, NativeError>
```

Reads one UTF-8 character from an open `ReadHandle`. Returns `ReadOk { char }`, `ReadEof`, or `ReadErr`.

#### `readLine(handle)`

```
readLine : FileHandle → ReadResult<Str, NativeError>
```

Reads one line (stripping the trailing newline) from an open `ReadHandle`. Returns `ReadOk { line }`, `ReadEof`, or `ReadErr`.

#### `readByte(handle)`

```
readByte : FileHandle → ReadResult<Byte, NativeError>
```

Reads one raw byte from an open `ReadHandle`. Returns `ReadOk { byte }`, `ReadEof`, or `ReadErr`.

#### `readBytes(handle, n)`

```
readBytes : FileHandle → Int → ReadResult<List<Byte>, NativeError>
```

Reads up to `n` raw bytes. Returns `ReadOk { bytes }` where `bytes` may be
shorter than `n`, `ReadEof`, or `ReadErr`.

#### `writeChar(handle, char)`

```
writeChar : FileHandle → Char → Result<unit, NativeError>
```

Writes a single character to an open `WriteHandle`.

#### `writeLine(handle, str)`

```
writeLine : FileHandle → Str → Result<unit, NativeError>
```

Writes `str` followed by a newline to an open `WriteHandle`.

#### `writeByte(handle, byte)`

```
writeByte : FileHandle → Byte → Result<unit, NativeError>
```

Writes a single byte to an open `WriteHandle`.

#### `writeBytes(handle, bytes)`

```
writeBytes : FileHandle → List<Byte> → Result<unit, NativeError>
```

Writes a list of raw bytes to an open `WriteHandle`.

### Buffer I/O

The `file` namespace re-exports the buffer API (see Appendix C §C.8) and adds `readBuffer` for bulk reads.

#### `readBuffer(handle, n, mode)`

```
readBuffer : FileHandle → Int → BufferMode → Result<Buffer, NativeError>
```

Reads up to `n` bytes from `handle` into a new buffer in `ByteMode` or
`CharMode`. Returns `Ok { buffer }` or `Err`.

#### `writeBuffer(handle, buf)`

```
writeBuffer : FileHandle → Buffer → Result<unit, NativeError>
```

Writes the entire contents of `buf` to `handle`.

---

## D.3 `json` — JSON serialisation

```pfun
import * from "json";
```

### `jsonSerialize(value)`

```
jsonSerialize : α → Option<Str>
```

Serialises a Pfun value to a pretty-printed JSON string. Returns `Some { json }` on success or `None` if the value contains types that cannot be represented in JSON (functions, handles, lazy sequences). Integers are serialised as JSON numbers; records become JSON objects; lists become JSON arrays.

### `jsonDeserialize(str)`

```
jsonDeserialize : Str → Option<α>
```

Parses a JSON string into a Pfun value. Returns `Some { value }` on success or `None` if the string is not valid JSON. JSON numbers become `Float`; JSON integers that fit in a safe integer range also become `Float`. JSON arrays become lists; JSON objects become plain records.

---

## D.4 `math` — Mathematical functions

```pfun
import * from "math";
```

All functions accept both `Int` and `Float` arguments (integers are promoted to `Float` internally). Functions that can produce `NaN` or `Infinity` throw a `FloatDomain` error rather than silently propagating a bad value, with the exception of the constants `nan` and `inf` which exist specifically to test against.

### Constants

| Name | Value |
|------|-------|
| `pi()` | π ≈ 3.14159265358979 |
| `e()` | Euler's number ≈ 2.71828182845905 |
| `tau()` | 2π ≈ 6.28318530717959 |
| `inf()` | Positive infinity (IEEE 754) |
| `nan()` | Not-a-number (IEEE 754) |

Constants are zero-argument functions: `pi()`, not `pi`.

### Basic

| Signature | Description |
|-----------|-------------|
| `abs(n)` | Absolute value. Returns `Int` for `Int` input, `Float` for `Float`. |
| `sign(n)` | −1, 0, or 1 (preserving input type). |
| `min(a, b)` | Smaller of two values. |
| `max(a, b)` | Larger of two values. |
| `clamp(lo, hi, x)` | Constrain `x` to `[lo, hi]`. |

### Powers and logarithms

| Signature | Description |
|-----------|-------------|
| `sqrt(n)` | Square root. Throws on negative input. |
| `cbrt(n)` | Cube root. |
| `pow(base, exp)` | `base` raised to `exp`. |
| `exp(n)` | eⁿ |
| `log(n)` | Natural logarithm. Throws on non-positive input. |
| `log2(n)` | Base-2 logarithm. |
| `log10(n)` | Base-10 logarithm. |
| `hypot(a, b)` | √(a² + b²) — Euclidean norm. |
| `fmod(x, y)` | Floating-point remainder. Throws if `y` is 0. |
| `lerp(a, b, t)` | Linear interpolation: a + t·(b − a). |

### Trigonometry

| Signature | Description |
|-----------|-------------|
| `sin(n)` | Sine (radians). |
| `cos(n)` | Cosine (radians). |
| `tan(n)` | Tangent (radians). |
| `asin(n)` | Arcsine → [−π/2, π/2]. Throws if |n| > 1. |
| `acos(n)` | Arccosine → [0, π]. Throws if |n| > 1. |
| `atan(n)` | Arctangent → (−π/2, π/2). |
| `atan2(y, x)` | Four-quadrant arctangent of y/x. |

### Hyperbolic

| Signature | Description |
|-----------|-------------|
| `sinh(n)` | Hyperbolic sine. |
| `cosh(n)` | Hyperbolic cosine. |
| `tanh(n)` | Hyperbolic tangent. |

### Formatting

#### `formatFixed(n, decimals)`

```
formatFixed : Float | Int → Int → Str
```

Formats `n` to exactly `decimals` decimal places (0–100) using round-half-away-from-zero. Returns a `Str`. Throws on `NaN` or `Infinity` input, or if `decimals` is out of range.

```pfun
formatFixed(3.14159, 2)   -- "3.14"
formatFixed(1000.0, 2)    -- "1000.00"
formatFixed(42, 3)        -- "42.000"
formatFixed(0.1 + 0.2, 2) -- "0.30"
```

---

## D.5 `async` — Asynchronous control flow

```pfun
import * from "async";
```

### `sleep(ms)`

```
sleep : Int → Promise<Result<unit, NativeError>>
```

Suspends the current task for at least `ms` milliseconds. Must be called with
`await` inside an `async proc`. Successful completion is `Ok { unit }`;
invalid durations and scheduler failures are `Err { NativeTimerError }`.

```pfun
async proc example() {
  println("before");
  match await sleep(1000) with
  | Ok _ -> println("after one second")
  | Err failure -> println(nativeErrorMessage(failure.message));
}
```

### `asyncAll(procs)`

```
asyncAll : List<async proc() → α> → Promise<List<α>>
```

Runs a list of zero-argument async procs concurrently and waits for all of them to complete. Returns a list of results in the same order as the input. If any proc throws, the error propagates. Must be `await`-ed.

### `asyncRace(procs)`

```
asyncRace : List<async proc() → α> → Promise<α>
```

Runs a list of zero-argument async procs concurrently and returns the result of whichever finishes first. The other procs continue running but their results are discarded. Must be `await`-ed.

---

## D.6 `http` — HTTP client and server

```pfun
import * from "http";
```

### Types

#### `Result`

```
type Result<α, ε> = { | Ok : value | Err : error }
```

All HTTP functions reuse the ambient `Result`. `Ok { value }` carries a
response record; the error slot carries the HTTP module's domain error.

The response record (the `value` field of `Ok`) has these fields:

| Field | Type | Description |
|-------|------|-------------|
| `status` | `Int` | HTTP status code (e.g. `200`, `404`) |
| `headers` | `Dict<Str, Str>` | Response headers, lower-cased keys |
| `body` | `Str` or `List<Byte>` | Decoded body string (for `httpGet`, `httpRequest`) or raw bytes (for `httpGetBytes`, `httpRequestBytes`) |

### Client functions

All client functions are async procs and must be `await`-ed.

#### `httpGet(url)`

```
httpGet : Str → Promise<Result<{ status, headers, body : Str }, HttpError>>
```

Performs an HTTP GET. The response body is decoded as UTF-8.

#### `httpGetBytes(url)`

```
httpGetBytes : Str → Promise<Result<{ status, headers, body : List<Byte> }, HttpError>>
```

Same as `httpGet` but the body is returned as raw bytes — use for binary content (images, archives, etc.) where UTF-8 decoding would corrupt the data.

#### `httpRequest(method, url, headers, body)`

```
httpRequest : Str → Str → Dict<Str,Str> → Str
           → Promise<Result<{ status, headers, body : Str }, HttpError>>
```

General HTTP client. `method` is `"GET"`, `"POST"`, `"PUT"`, `"PATCH"`, `"DELETE"`, etc. Pass `listToDict([])` for no custom headers. Pass `""` for no body (required for GET and HEAD). The response body is decoded as UTF-8.

#### `httpRequestBytes(method, url, headers, body)`

```
httpRequestBytes : Str → Str → Dict<Str,Str> → Str
                → Promise<Result<{ status, headers, body : List<Byte> }, HttpError>>
```

Identical to `httpRequest` but the response body is returned as raw bytes.

#### `fetchWithTimeout(url, ms)`

```
fetchWithTimeout : Str → Int
                → Promise<Result<{ status, headers, body : Str }, HttpError>>
```

GET with an abort-on-timeout. If no response arrives within `ms` milliseconds the in-flight connection is cancelled and `Err { "timeout after Nms" }` is returned.

#### `urlEncode(s)`

```
urlEncode : Str → Str
```

Percent-encodes a string for use as a URL query parameter value (wraps `encodeURIComponent`). This is a **pure** function and may be called from both `function` and `proc` contexts.

### Server

#### `httpListen(port, handler)`

```
httpListen : Int → async proc(req, res) → unit
```

Starts an HTTP server on `port`. `handler` is called for each incoming request with a request record `req` and a response object `res`. Returns immediately; the server runs until the process exits.

**Request record fields:**

| Field | Type | Description |
|-------|------|-------------|
| `method` | `Str` | HTTP method: `"GET"`, `"POST"`, etc. |
| `path` | `Str` | URL path component (e.g. `"/api/users"`) |
| `headers` | `Dict<Str, Str>` | Request headers, lower-cased keys |
| `body` | `Str` | Request body decoded as UTF-8 |
| `bodyBytes` | `List<Byte>` | Request body as raw bytes |

**Response methods** (called on `res`):

| Call | Description |
|------|-------------|
| `res.text(status, body)` | Send a `text/plain` response |
| `res.json(status, value)` | Serialise `value` to JSON and send as `application/json` |
| `res.bytes(status, contentType, bytes)` | Send raw bytes with an explicit content-type |

---

## D.7 `timer` — One-shot timers

```pfun
import * from "timer";
```

### `setTimer(ms, action)`

```
setTimer : Int → proc() → Result<TimerHandle, NativeError>
```

Schedules a synchronous zero-argument proc to run once after `ms` milliseconds.
`Ok` carries an opaque `TimerHandle` that can be passed to `clearTimer`; `Err`
carries `NativeTimerError`.

```pfun
proc sayHello() { println("hello from timer"); }
match setTimer(500, sayHello) with
| Err failure -> println(nativeErrorMessage(failure.message))
| Ok timer -> clearTimer(timer.value);
```

### `setAsyncTimer(ms, action)`

```
setAsyncTimer : Int → async proc() → Result<TimerHandle, NativeError>
```

Schedules an async zero-argument proc. This separate entry point preserves the
language's distinction between sync and async proc types.

### `clearTimer(id)`

```
clearTimer : TimerHandle → Result<Unit, NativeError>
```

Cancels a pending timer before it fires. Calling it after the timer has fired or
twice returns idempotent `Ok`; invalid host handles and cancellation failures
return `NativeTimerError`.

---

## D.8 `foreign` — JavaScript FFI

```pfun
import * from "foreign";
```

The `foreign` module is the bridge between Pfun and raw JavaScript. It provides effect operations for crossing the boundary (all proc-only) and a set of composable decoders for safely converting JS values to Pfun types (all pure).

### Types

#### `ForeignResult`

```
type ForeignResult<α> = { | FOk : value | FErr : kind message }
```

Every effect operation returns a `ForeignResult`. `FOk { value }` carries the result; `FErr { kind, message }` carries an error. `kind` is one of:

| Kind | Meaning |
|------|---------|
| `"js_exception"` | The JS side threw an exception |
| `"marshal_error"` | Type mismatch during value conversion |
| `"type_error"` | Wrong argument type passed to an FFI op |

### Effect operations (proc-only)

All operations below are proc-only. They check `inPureContext` and throw a purity error if called from a `function`.

#### `foreignRequire(path)`

```
foreignRequire : Str → ForeignResult<Foreign>
```

Loads a Node.js module by its require path (e.g. `"fs"`, `"zlib"`, `"./mymodule"`). Returns a `Foreign` handle to the module's exports object.

#### `foreignGlobal(name)`

```
foreignGlobal : Str → ForeignResult<Foreign>
```

Reads a JavaScript global by name (e.g. `"Buffer"`, `"Math"`, `"Intl"`, `"Function"`). Returns a `Foreign` handle or `FErr` if the global does not exist.

#### `foreignGet(handle, prop)`

```
foreignGet : Foreign → Str → ForeignResult<α>
```

Reads a property from a JS object handle. The result is materialized if possible (numbers, strings, booleans, arrays, plain objects become Pfun values); otherwise it remains a `Foreign` handle.

#### `foreignSet(handle, prop, value)`

```
foreignSet : Foreign → Str → α → ForeignResult<unit>
```

Writes a value to a property of a JS object handle.

#### `foreignDelete(handle, prop)`

```
foreignDelete : Foreign → Str → ForeignResult<unit>
```

Deletes a property from a JS object handle.

#### `foreignCall(handle, method, args)`

```
foreignCall : Foreign → Str → List<α> → ForeignResult<β>
```

Calls a method on a JS object handle: `handle.method(...args)`. All elements of `args` must be the same Pfun type (heterogeneous lists are a type error — curry across multiple calls if needed).

#### `foreignInvoke(fn, args)`

```
foreignInvoke : Foreign → List<α> → ForeignResult<β>
```

Calls a JS function handle directly: `fn(...args)`. Same type homogeneity constraint as `foreignCall`.

#### `foreignNew(ctor, args)`

```
foreignNew : Foreign → List<α> → ForeignResult<β>
```

Invokes a JS constructor: `new ctor(...args)`. Same type homogeneity constraint as `foreignCall`.

#### `foreignTypeof(handle)`

```
foreignTypeof : Foreign → ForeignResult<Str>
```

Returns the JavaScript `typeof` value of a handle as a string (`"number"`, `"string"`, `"object"`, `"function"`, etc.).

#### `foreignAwait(handle)`

```
foreignAwait : Foreign → Promise<ForeignResult<α>>
```

Awaits a JS `Promise` handle. Must be used with `await` inside an `async proc`:

```pfun
match await foreignAwait(promiseHandle) with
| FErr e -> println("failed: " + e.message)
| FOk v  -> println("resolved");
```

#### `foreignCallback(proc, argsDecoder)`

```
foreignCallback : proc(List<α>) → Decoder<α> → Foreign
```

Wraps a Pfun proc as a plain JS callback function. When the returned JS function is called, its arguments are decoded with `argsDecoder` and the proc is invoked as a spawned task. Useful for registering event listeners and Node.js callbacks.

### Decoders (pure)

Decoders are composable values that describe how to convert a materialized Pfun value (or a `Foreign` handle) into a typed Pfun value. They are pure and may be used in `function` context.

#### `foreignApply(handle, decoder)`

```
foreignApply : Foreign → Decoder<α> → ForeignResult<α>
```

Applies a decoder to a `Foreign` handle. This is the primary way to extract a typed Pfun value from an FFI call result.

#### Primitive decoders

| Decoder | Input type | Output type |
|---------|------------|-------------|
| `dForeign` | any | `Foreign` handle (identity, never fails) |
| `dUnit` | any | `unit` (ignores the value, always succeeds) |
| `dBool` | JS boolean | `Bool` |
| `dInt` | JS number (integer) or bigint | `Int` |
| `dFloat` | JS number | `Float` |
| `dStr` | JS string | `Str` |

#### Composite decoders

#### `dList(elemDecoder)`

```
dList : Decoder<α> → Decoder<List<α>>
```

Decodes a JS array, applying `elemDecoder` to each element.

#### `dOption(decoder)`

```
dOption : Decoder<α> → Decoder<Option<α>>
```

Returns `None` for `null` or `undefined`; applies `decoder` and wraps in `Some` otherwise.

#### `dDict(valueDecoder)`

```
dDict : Decoder<α> → Decoder<Dict<Str, α>>
```

Decodes a plain JS object into a `Dict`, applying `valueDecoder` to each value.

#### `dField(key, decoder)`

```
dField : Str → Decoder<α> → Decoder<α>
```

Reads a single named property from a JS object and decodes it.

#### `dMap(fn, decoder)`

```
dMap : (α → β) → Decoder<α> → Decoder<β>
```

Transforms a successfully decoded value with `fn`.

#### `dAndThen(fn, decoder)`

```
dAndThen : (α → Decoder<β>) → Decoder<α> → Decoder<β>
```

Chains decoders: decodes with `decoder`, then passes the result to `fn` to obtain a second decoder and runs that too.

#### `dOneOf(decoders)`

```
dOneOf : List<Decoder<α>> → Decoder<α>
```

Tries each decoder in order and returns the first success. Fails if all decoders fail.

---

## D.9 `db/postgresql` — PostgreSQL

```pfun
import * from "db/postgresql";
```

### D.9.1 `db/mariadb` — MariaDB / MySQL

```pfun
import * from "db/mariadb";
```

Both namespaces expose the same three functions and the same types. The only difference is the driver and the connection string format.

### Types

#### `Result<α, DbError>`

```
type Result<α, ε> = { | Ok : value | Err : error }
```

The database modules reuse the ambient `Result`. `Ok { value }` carries the
success payload; the error slot carries `DbError`.

#### `DbValue`

```
type DbValue = {
  | DbInt   : value   -- Int
  | DbFloat : value   -- Float
  | DbText  : value   -- Str
  | DbBool  : value   -- Bool
  | DbBytes : value   -- List<Byte>  (binary/BYTEA/BLOB columns)
  | DbNull            -- SQL NULL
}
```

Each cell in a query result set is a `DbValue`. Match on the variant to extract the typed Pfun value.

#### `QueryResult`

```
type QueryResult = {
  rows     : List<List<DbValue>>,
  rowCount : Int,
}
```

The payload of a successful `dbQuery`. `rows` is a list of rows; each row is a list of `DbValue` cells in the order the columns appear in the query. `rowCount` is the number of rows affected (for `INSERT`/`UPDATE`/`DELETE`) or returned (for `SELECT`).

#### `Connection`

An opaque handle to an open database connection. Obtained from `dbConnect`; passed to `dbQuery` and `dbClose`. Has no user-visible fields.

### Functions

All database functions are async procs and must be `await`-ed.

#### `dbConnect(connectionString)`

```
dbConnect : Str → Promise<Result<Connection, DbError>>
```

Opens a connection to the database.

**PostgreSQL** connection string format: `"postgres://user:password@host:port/database"`.  
**MariaDB/MySQL** connection string format: `"mysql://user:password@host:port/database"`.

Returns `Ok { connection }` or `Err { message }`.

#### `dbQuery(conn, sql, params)`

```
dbQuery : Connection → Str → List<DbValue> → Promise<Result<QueryResult, DbError>>
```

Executes a parameterised SQL query. `params` is a list of `DbValue` values bound to `$1`, `$2`, … placeholders (PostgreSQL) or `?` placeholders (MariaDB). Returns `Ok { QueryResult }` or `Err { message }`.

```pfun
let result = await dbQuery(conn, "SELECT id, name FROM users WHERE id = $1",
                           [DbInt { 42 }]);
match result with
| Err e -> println("query failed: " + e.message)
| Ok  r -> {
    let row = head(r.value.rows);
    match head(row) with
    | DbInt v -> println("id: " + __str__(v.value))
    | _ -> ();
  };
```

#### `dbClose(conn)`

```
dbClose : Connection → Promise<Result<Unit, DbError>>
```

Closes the database connection and releases the underlying driver client. Returns `Ok { 0 }` or `Err`.

---

## D.10 Summary: what each import provides

| Import | Types added | Functions added |
|--------|-------------|-----------------|
| `"io"` | *(none)* | `print`, `println`, `flushStdout`, `readChar`, `readln`, `scriptArgs`, `getEnv`, `envVars` |
| `"file"` | `FileHandle` (`ReadHandle`, `WriteHandle`), `FileMode` (`Read`, `Write`, `Append`), `ReadResult` (`ReadOk`, `ReadEof`, `ReadErr`), `DirEntry`, `WatchEvent`; ambient `Result` is reused | `fileExists`, `fileSize`, `isDir`, `touchFile`, `removeFile`, `renameFile`, `mkdirP`, `readFile`, `writeFile`, `listDir`, `watchDir`, `fileOpen`, `fileClose`, `readChar`, `readLine`, `readByte`, `readBytes`, `writeChar`, `writeLine`, `writeByte`, `writeBytes`, `readBuffer`, `writeBuffer` |
| `"json"` | *(none)* | `jsonSerialize`, `jsonDeserialize` |
| `"math"` | *(none)* | `pi`, `e`, `tau`, `inf`, `nan`, `abs`, `sign`, `min`, `max`, `clamp`, `lerp`, `sqrt`, `cbrt`, `exp`, `log`, `log2`, `log10`, `pow`, `hypot`, `fmod`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `sinh`, `cosh`, `tanh`, `formatFixed` |
| `"async"` | *(none)* | `sleep`, `asyncAll`, `asyncRace` |
| `"http"` | ambient `Result` (`Ok`, `Err`) | `httpGet`, `httpGetBytes`, `httpRequest`, `httpRequestBytes`, `fetchWithTimeout`, `urlEncode`, `httpListen` |
| `"timer"` | *(none)* | `setTimer`, `clearTimer` |
| `"foreign"` | `ForeignResult` (`FOk`, `FErr`) | `foreignRequire`, `foreignGlobal`, `foreignGet`, `foreignSet`, `foreignDelete`, `foreignCall`, `foreignInvoke`, `foreignNew`, `foreignTypeof`, `foreignAwait`, `foreignCallback`, `foreignApply`, `dForeign`, `dUnit`, `dBool`, `dInt`, `dFloat`, `dStr`, `dList`, `dOption`, `dDict`, `dField`, `dMap`, `dAndThen`, `dOneOf` |
| `"db/postgresql"` | ambient `Result` (`Ok`, `Err`), `DbValue` (`DbInt`, `DbFloat`, `DbText`, `DbBool`, `DbBytes`, `DbNull`), `QueryResult`, `Connection` | `dbConnect`, `dbQuery`, `dbClose` |
| `"db/mariadb"` | *(same as db/postgresql)* | *(same as db/postgresql)* |

*End of Appendix D.*

---

# Appendix E — Pfun library reference (`lib/` and testing)

This appendix documents the pure-Pfun libraries that ship with the runtime. They are imported by file path rather than a short module name:

```pfun
import * from "$PFUN_HOME/lib/stringlib.pf";
import * from "$PFUN_HOME/lib/datelib.pf";
// etc.
```

The testing framework (`testing.pf`, `assertions.pf`, `runner.pf`) lives at the repo root and is imported by relative path:

```pfun
import * from "./testing";
import * from "./assertions";
import * from "./runner";
```

All functions are **pure** (`function`) unless stated otherwise. Procs are marked **[proc]** or **[async proc]**.

---

## E.1 `stringlib.pf` — String utilities

```pfun
import * from "$PFUN_HOME/lib/stringlib.pf";
```

All functions are pure. Predicates (`matchFn`, `pred`) have type `Str → Bool` and are applied to single-character strings, as produced by `split(s, "")`.

| Function | Signature | Description |
|----------|-----------|-------------|
| `isWhitespace` | `Str → Bool` | `true` if the character is a space, tab, or newline. |
| `trim` | `Str → Str` | Strip leading and trailing whitespace. |
| `trimLeft` | `Str → Str` | Strip leading whitespace only. |
| `trimRight` | `Str → Str` | Strip trailing whitespace only. |
| `startsWith` | `Str → Str → Bool` | `true` if `s` begins with `prefix`. |
| `endsWith` | `Str → Str → Bool` | `true` if `s` ends with `suffix`. |
| `contains` | `Str → Str → Bool` | `true` if `sub` appears anywhere in `s`. |
| `replace` | `Str → Str → Str → Str` | Replace the **first** occurrence of `s1` with `s2`. Returns `s` unchanged if `s1` is absent. |
| `replaceAll` | `Str → Str → Str → Str` | Replace **every** occurrence of `s1` with `s2`. |
| `strMatch` | `Str → (Str→Bool) → Bool` | `true` if any character in `s` satisfies `matchFn`. Named `strMatch` to avoid collision with the `match` keyword. |
| `replaceMatch` | `Str → (Str→Bool) → (Str→Str) → Str` | Replace every character satisfying `matchFn` by applying `replaceFn` to it. |
| `takeWhile` | `Str → (Str→Bool) → Str` | The longest leading substring whose characters all satisfy `pred`. |
| `dropWhile` | `Str → (Str→Bool) → Str` | Strip the longest leading substring whose characters satisfy `pred`. |
| `strRepeat` | `Str → Int → Str` | Concatenate `s` with itself `n` times. Named `strRepeat` to avoid collision with the built-in `repeat` lazy-sequence function. |
| `padLeft` | `Str → Int → Str → Str` | Pad `s` on the left with `fill` characters until it is at least `n` characters wide. |
| `padRight` | `Str → Int → Str → Str` | Pad `s` on the right with `fill` characters. |
| `indexOf` | `Str → Str → Option<Int>` | `Some { index }` of the first occurrence of `sub` in `s`, or `None`. |

---

## E.2 `datelib.pf` — Date and time

```pfun
import * from "$PFUN_HOME/lib/datelib.pf";
```

Requires `import * from "foreign"` to be visible (pulled in automatically by datelib itself — callers do not need to repeat it). Most functions return `ForeignResult` (from `foreign`) or `DateResult` (defined below); match on the result to extract the value.

### Types

```
type Date = { handle }
```
Opaque wrapper around a JavaScript `Date` object. The `handle` field is a `Foreign` and should not be used directly.

```
type DateResult = { | DateOk : date | DateErr : message }
```
The primary result type for operations that can fail (invalid date strings, FFI errors). `DateOk { d }` carries a `Date`; `DateErr { msg }` carries an error string.

```
type Weekday = { | Sunday | Monday | Tuesday | Wednesday
               | Thursday | Friday | Saturday }
```

```
type Month = { | January | February | March | April
             | May | June | July | August
             | September | October | November | December }
```

```
type DateTime = { year, month, day, hour, minute, second, millisecond, weekday }
```
A broken-down local date and time. `month` is a `Month` variant; `weekday` is a `Weekday` variant. Used for display and construction.

### Constructors [proc]

| Function | Returns | Description |
|----------|---------|-------------|
| `now()` | `DateResult` | Current local date and time. |
| `fromIso(str)` | `DateResult` | Parse an ISO 8601 string, e.g. `"2024-03-15T14:30:00Z"`. Returns `DateErr` for invalid strings. |
| `fromParts(year, month, day)` | `DateResult` | Local midnight on the given date. `month` is 1-indexed (1 = January). |
| `fromPartsTime(year, month, day, hour, minute, second, ms)` | `DateResult` | Full local datetime. `month` is 1-indexed. |
| `fromTimestamp(ms)` | `DateResult` | Construct from a Unix timestamp in milliseconds (`Float`). |
| `timestampNow()` | `ForeignResult<Float>` | Current Unix timestamp in milliseconds, without constructing a `Date`. |

### Local accessors [proc]

All return `ForeignResult<Int>` unless noted. Month values are 1-indexed (1 = January). Weekday values use the typed variants.

| Function | Returns | Description |
|----------|---------|-------------|
| `year(d)` | `ForeignResult<Int>` | Four-digit year. |
| `monthInt(d)` | `ForeignResult<Int>` | Month as integer 1–12. |
| `month(d)` | `ForeignResult<Month>` | Month as a `Month` variant. |
| `day(d)` | `ForeignResult<Int>` | Day of month 1–31. |
| `weekdayInt(d)` | `ForeignResult<Int>` | Day of week 0 (Sunday) – 6 (Saturday). |
| `weekday(d)` | `ForeignResult<Weekday>` | Day of week as a `Weekday` variant. |
| `hour(d)` | `ForeignResult<Int>` | Hour 0–23. |
| `minute(d)` | `ForeignResult<Int>` | Minute 0–59. |
| `second(d)` | `ForeignResult<Int>` | Second 0–59. |
| `millisecond(d)` | `ForeignResult<Int>` | Millisecond 0–999. |
| `timezoneOffset(d)` | `ForeignResult<Int>` | Local offset from UTC in minutes (negative east of UTC). |
| `timestamp(d)` | `ForeignResult<Float>` | Unix timestamp in milliseconds. |
| `toDateTime(d)` | `DateResult<DateTime>` | Decompose into a `DateTime` record in local time. |

### UTC accessors [proc]

Parallel to the local accessors above, reading UTC values instead: `utcYear`, `utcMonthInt`, `utcMonth`, `utcDay`, `utcWeekdayInt`, `utcWeekday`, `utcHour`, `utcMinute`, `utcSecond`, `utcMillisecond`. Same signatures — each takes a `Date` and returns `ForeignResult<Int>` (or `ForeignResult<Month>` / `ForeignResult<Weekday>` for the typed variants).

### Formatting [proc]

| Function | Returns | Description |
|----------|---------|-------------|
| `toIso(d)` | `ForeignResult<Str>` | ISO 8601 in UTC: `"2024-03-15T14:30:45.123Z"`. |
| `toUtcString(d)` | `ForeignResult<Str>` | RFC 7231 HTTP date: `"Fri, 15 Mar 2024 14:30:45 GMT"`. |
| `toDateString(d)` | `ForeignResult<Str>` | Human-readable date only: `"Fri Mar 15 2024"`. |
| `toTimeString(d)` | `ForeignResult<Str>` | Local time with timezone: `"14:30:45 GMT+0000 (…)"`. |
| `toLocaleString(d)` | `ForeignResult<Str>` | Locale-sensitive full datetime (system locale). |
| `format(d)` | `ForeignResult<Str>` | `"YYYY-MM-DD HH:MM:SS"` in local time. |
| `formatDate(d)` | `ForeignResult<Str>` | `"YYYY-MM-DD"` only. |
| `formatTime(d)` | `ForeignResult<Str>` | `"HH:MM:SS"` only. |

### Arithmetic [proc]

All return `DateResult`. Offsets may be negative.

| Function | Description |
|----------|-------------|
| `addMilliseconds(d, n)` | Add `n` milliseconds (`Float`). |
| `addSeconds(d, n)` | Add `n` seconds. |
| `addMinutes(d, n)` | Add `n` minutes. |
| `addHours(d, n)` | Add `n` hours. |
| `addDays(d, n)` | Add `n` days. |
| `addMonths(d, n)` | Add `n` calendar months. Calendar-aware: handles varying month lengths and leap years. |
| `addYears(d, n)` | Add `n` calendar years. Calendar-aware. |

### Difference [proc]

All take two `Date` values `(a, b)` and return `ForeignResult<Float>` representing `a − b`.

`diffMilliseconds`, `diffSeconds`, `diffMinutes`, `diffHours`, `diffDays`.

### Comparison [proc]

| Function | Returns | Description |
|----------|---------|-------------|
| `dateBefore(a, b)` | `ForeignResult<Bool>` | `true` if `a` is earlier than `b`. |
| `dateAfter(a, b)` | `ForeignResult<Bool>` | `true` if `a` is later than `b`. |
| `dateEqual(a, b)` | `ForeignResult<Bool>` | `true` if `a` and `b` represent the same instant. |
| `dateMin(a, b)` | `DateResult` | The earlier of the two dates. |
| `dateMax(a, b)` | `DateResult` | The later of the two dates. |
| `isSameDay(a, b)` | `Bool` | `true` if both fall on the same local calendar day. Returns `false` on FFI error. |
| `isSameMonth(a, b)` | `Bool` | `true` if both fall in the same local calendar month and year. |
| `isSameYear(a, b)` | `Bool` | `true` if both fall in the same local calendar year. |

### Calendar queries [proc]

All return `DateResult`.

| Function | Description |
|----------|-------------|
| `startOfDay(d)` | Local midnight on the same calendar day. |
| `endOfDay(d)` | `23:59:59.999` local time on the same calendar day. |
| `startOfMonth(d)` | 1st of the month at local midnight. |
| `endOfMonth(d)` | Last day of the month at `23:59:59.999`. |
| `startOfYear(d)` | January 1 at local midnight. |
| `endOfYear(d)` | December 31 at `23:59:59.999`. |

### Pure helpers

| Function | Signature | Description |
|----------|-----------|-------------|
| `monthToInt(m)` | `Month → Int` | 0-indexed month number (0 = January). |
| `monthName(m)` | `Month → Str` | Full English name: `"January"` … `"December"`. |
| `monthShort(m)` | `Month → Str` | Three-letter abbreviation: `"Jan"` … `"Dec"`. |
| `weekdayName(w)` | `Weekday → Str` | Full English name: `"Sunday"` … `"Saturday"`. |
| `weekdayShort(w)` | `Weekday → Str` | Three-letter abbreviation: `"Sun"` … `"Sat"`. |
| `isWeekend(w)` | `Weekday → Bool` | `true` for `Saturday` or `Sunday`. |
| `isWeekdayVariant(w)` | `Weekday → Bool` | `true` for Monday–Friday. |
| `isLeapYear(year)` | `Int → Bool` | Standard Gregorian leap-year test. |
| `daysInMonth(month, year)` | `Month → Int → Int` | Number of days in the month, accounting for leap years. |

---

## E.3 `random.pf` — Randomness

```pfun
import * from "$PFUN_HOME/lib/random.pf";
```

All functions are **[proc]** — they have side effects and cannot be called from pure `function` contexts. All use `crypto.randomBytes` via FFI for cryptographically strong randomness.

| Function | Returns | Description |
|----------|---------|-------------|
| `randomFloat()` | `Float` | Uniform random `Float` in `[0, 1)`. |
| `randomInt(min, max)` | `Int` | Uniform random `Int` in `[min, max]` (both bounds inclusive). |
| `randomBool()` | `Bool` | `true` or `false` with equal probability. |
| `randomElement(list)` | `Option<α>` | A uniformly random element from `list`, or `None` if the list is empty. |
| `randomShuffle(list)` | `List<α>` | A new list containing all elements of `list` in a uniformly random order (Fisher-Yates). |
| `randomBytes(n)` | `List<Byte>` | `n` cryptographically random bytes. |
| `randomUUID()` | `Str` | A random UUID v4 string in the standard `"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"` format. |

---

## E.4 `locale.pf` — Locale-sensitive number formatting

```pfun
import * from "$PFUN_HOME/lib/locale.pf";
```

All functions are **[proc]** (FFI access). They use the system locale as detected by the JavaScript runtime. Return type `ForeignResult<Str>` — match on `FOk`/`FErr` from `import * from "foreign"`.

| Function | Signature | Description |
|----------|-----------|-------------|
| `formatLocalNumber(n)` | `Float → ForeignResult<Str>` | Format a number using the locale's decimal and grouping conventions. |
| `formatLocalCurrency(n)` | `Float → ForeignResult<Str>` | Format as a monetary value using the locale's default currency. |
| `formatLocalCurrencyWith(n, code)` | `Float → Str → ForeignResult<Str>` | Format as a monetary value in a specific ISO 4217 currency code (e.g. `"USD"`, `"EUR"`). Returns `FErr` for unknown currency codes. |

---

## E.5 `compress.pf` — Gzip compression

```pfun
import * from "$PFUN_HOME/lib/compress.pf";
import * from "foreign";  -- for FOk / FErr
```

Uses Node.js's built-in `zlib` module. All functions return `ForeignResult`.

| Function | Kind | Signature | Description |
|----------|------|-----------|-------------|
| `gzip(bytes)` | proc | `List<Byte> → ForeignResult<List<Byte>>` | Compress a byte list with gzip. |
| `gunzip(bytes)` | proc | `List<Byte> → ForeignResult<List<Byte>>` | Decompress a gzip-compressed byte list. |
| `gzipFile(src, dst)` | async proc | `Str → Str → ForeignResult<unit>` | Compress the file at `src` and write the result to `dst`. |
| `gunzipFile(src, dst)` | async proc | `Str → Str → ForeignResult<unit>` | Decompress the gzip file at `src` and write to `dst`. |

---

## E.6 `crypto.pf` — Password hashing and AES-GCM encryption

```pfun
import * from "$PFUN_HOME/lib/crypto.pf";
import * from "foreign";  -- for FOk / FErr
```

Uses Node.js's built-in `crypto` module. All functions are **[proc]**.

### Password hashing

#### `hashPassword(pw)`

```
hashPassword : Str → Str
```

Derives a password hash for storage using scrypt (RFC 7914) with parameters N=16384, r=8, p=1, a 16-byte random salt, and a 64-byte derived key. Returns a self-describing storage string:

```
"scrypt:<N>:<r>:<p>:<salt_base64url>:<hash_base64url>"
```

Every call produces a different string (random salt). The embedded parameters allow future parameter upgrades without breaking stored hashes.

#### `verifyPassword(pw, stored)`

```
verifyPassword : Str → Str → Bool
```

Re-derives the key from `pw` using the salt and parameters embedded in `stored` and compares with `crypto.timingSafeEqual` to prevent timing attacks. Returns `false` (not an error) for malformed stored strings. Never throws.

### AES-GCM encryption

#### `aesGcmEncrypt(keyBytes, plaintext, aad)`

```
aesGcmEncrypt : List<Byte> → List<Byte> → List<Byte>
             → ForeignResult<List<Byte>>
```

Encrypt `plaintext` with AES-GCM. `keyBytes` must be 16, 24, or 32 bytes (AES-128, AES-192, or AES-256). `aad` (additional authenticated data) is authenticated but not encrypted — pass `[]` for none. A fresh 12-byte random IV is generated per call.

Returns `FOk { box }` where `box` is `IV(12) ++ authTag(16) ++ ciphertext`. The box is self-contained; the key must be kept secret separately.

#### `aesGcmDecrypt(keyBytes, box, aad)`

```
aesGcmDecrypt : List<Byte> → List<Byte> → List<Byte>
             → ForeignResult<List<Byte>>
```

Decrypt and authenticate a box produced by `aesGcmEncrypt`. Returns `FOk { plaintext }` or `FErr` if authentication fails (wrong key, tampered box, mismatched AAD, or truncated box). The error message is intentionally vague to avoid leaking oracle information.

---

## E.7 `toml.pf` — TOML parsing and emission

```pfun
import * from "$PFUN_HOME/lib/toml.pf";
import * from "foreign";  -- for FOk / FErr
```

### Types

```
type SettingValue = {
  | SStr   : value          -- Str
  | SInt   : value          -- Int
  | SFloat : value          -- Float
  | SBool  : value          -- Bool
  | SList  : items          -- List<SettingValue>  (inline arrays)
}

type Setting = { key, value }
  -- key : Str,  value : SettingValue

type SettingGroup = { name, settings }
  -- name : Str,  settings : List<Setting>
```

All three types are exported and visible to importers.

### `tomlParse(text)`

```
tomlParse : Str → ForeignResult<List<SettingGroup>>
```

Parse a TOML string. Top-level keys (before the first section header) go into a group with `name = ""`. Returns `FOk { groups }` or `FErr { kind, message }` on syntax errors.

**Supported subset:** section headers `[name]`, quoted strings (with `\"` `\\` `\n` escapes), integers, floats, booleans, inline arrays `[…]`, line comments `#`, and blank lines. Multi-line strings, dotted keys, inline tables, and dates are not supported.

### `tomlEmit(groups)`

```
tomlEmit : List<SettingGroup> → Str
```

Serialise a list of `SettingGroup` values back to TOML text. Groups with `name = ""` are emitted without a section header. Never fails.

---

## E.8 `htmllib.pf` — Semantic HTML document model

```pfun
import * from "$PFUN_HOME/lib/htmllib.pf";
```

Provides a typed document model for constructing and rendering HTML. Pure throughout.

### Types

#### `Attrs`

```
type Attrs = { id, classes, style }
  -- id : Option<Str>,  classes : List<Str>,  style : Option<Str>
```

HTML attribute bundle. The constant `noAttrs` provides an empty bundle: `Attrs { None, [], None }`.

#### `Inline`

```
type Inline = {
  | Text         : value          -- plain text (HTML-escaped on render)
  | Emph         : content        -- <em>
  | Strong       : content        -- <strong>
  | InlineCode   : value          -- <code>
  | Link         : href, content  -- <a href="…">
  | HtmlLineBreak                 -- <br>
}
```

#### `Choice`

```
type Choice = { value, label }   -- both Str; used by RadioGroup and Dropdown
```

#### `Field`

```
type Field = {
  | TextField     : name, label, value
  | EmailField    : name, label, value
  | PasswordField : name, label
  | NumberField   : name, label, value
  | TextArea      : name, label, value
  | Checkbox      : name, label, checked    -- checked : Bool
  | RadioGroup    : name, label, choices, selected
  | Dropdown      : name, label, choices, selected
  | SubmitButton  : text
  | ResetButton   : text
  | HiddenField   : name, value
}
```

#### `Block`

```
type Block = {
  | Para        : content
  | BulletList  : items           -- items : List<List<Block>>
  | OrderedList : items
  | BlockQuote  : content
  | CodeBlock   : language, value
  | ThematicBreak
  | Section     : heading, content
  | Article     : heading, content
  | Aside       : content
  | Nav         : content
  | Form        : action, method, fields   -- fields : List<Field>
  | RawHtml     : value
  | Attributed  : node, attrs              -- any Block + Attrs
}
```

#### `Document`

```
type Document = { title, body }
  -- title : Str,  body : List<Block>
```

### Constructor functions

**Inline constructors:** `text(s)`, `emph(content)`, `strong(content)`, `code(value)`, `link(href, content)`.

**Field constructors:** `choice(value, label)`, `textField(name, label, value)`, `emailField(name, label, value)`, `passwordField(name, label)`, `numberField(name, label, value)`, `textArea(name, label, value)`, `checkbox(name, label, checked)`, `radioGroup(name, label, choices, selected)`, `dropdown(name, label, choices, selected)`, `submitButton(text)`, `resetButton(text)`, `hiddenField(name, value)`, `form(action, method, fields)`.

**Attribute helpers:** `withId(id, node)`, `withClass(classes, node)`, `withStyle(style, node)` — return an `Attributed` block wrapping `node` with the given attribute.

### Rendering functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `renderInline(node)` | `Inline → Str` | Render one inline node to HTML. |
| `renderInlines(nodes)` | `List<Inline> → Str` | Render a list of inline nodes. |
| `renderBlock(node, depth)` | `Block → Int → Str` | Render one block to HTML. `depth` controls heading level for nested `Section`/`Article`. |
| `renderBlocks(nodes, depth)` | `List<Block> → Int → Str` | Render a list of blocks. |
| `renderDocument(doc)` | `Document → Str` | Render a full document to an HTML fragment (no `<html>` wrapper). |
| `renderField(field)` | `Field → Str` | Render a single form field including its `<label>`. |
| `renderFields(fields)` | `List<Field> → Str` | Render a list of form fields. |

### Escaping functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `escapeHtml(s)` | `Str → Str` | Escape `&`, `<`, `>` for safe embedding in HTML text content. |
| `escapeAttr(s)` | `Str → Str` | Escape for use inside an HTML attribute value (also escapes `'`). |

---

## E.9 `htmlparse.pf` — HTML parser

```pfun
import * from "$PFUN_HOME/lib/htmlparse.pf";
```

Parses raw HTML strings into a typed tree. Pure throughout.

### Types

#### `HtmlNode`

```
type HtmlNode = {
  | Element : tag, attrs, children
      -- tag : Str
      -- attrs : List<Pair<Str, Str>>  (attribute name → value)
      -- children : List<HtmlNode>
  | HtmlText : value               -- plain text between tags
  | Comment  : value               -- <!-- … -->
  | Doctype  : value               -- <!DOCTYPE …>
}
```

#### `ParseResult`

```
type ParseResult = {
  | ParseOk  : nodes    -- nodes : List<HtmlNode>
  | ParseErr : message  -- message : Str
}
```

### Functions

#### `parseHtml(text)`

```
parseHtml : Str → ParseResult
```

Parse an HTML string in lenient mode. Recovers from common errors: missing closing tags, mismatched tags (closed as best-effort), and unrecognised content. Returns `ParseOk { nodes }` with a list of top-level `HtmlNode` values, or `ParseErr { message }` for unrecoverable errors.

#### `parseStrictHtml(text)`

```
parseStrictHtml : Str → ParseResult
```

Same as `parseHtml` but treats structural errors as fatal and returns `ParseErr`. Use when the input is expected to be well-formed.

#### `getAttr(attrs, name)`

```
getAttr : List<Pair<Str,Str>> → Str → Option<Str>
```

Look up an attribute value by name in an `Element`'s attribute list. Returns `Some { value }` or `None`.

#### `hasAttr(attrs, name)`

```
hasAttr : List<Pair<Str,Str>> → Str → Bool
```

`true` if the named attribute is present, regardless of its value.

#### `toSemanticHtmlContent(nodes)`

```
toSemanticHtmlContent : List<HtmlNode> → List<Block>
```

Convert a list of `HtmlNode` values into `Block` values from `htmllib`. Recognises `<p>`, `<ul>`, `<ol>`, `<blockquote>`, `<pre>`, `<hr>`, `<section>`, `<article>`, `<aside>`, `<nav>`, `<h1>`–`<h6>`, `<em>`, `<strong>`, `<code>`, `<a>`, `<br>`, and `<form>`. Unknown tags are preserved as `RawHtml`.

#### `renderHtmlNode(node)` / `renderHtmlNodes(nodes)`

```
renderHtmlNode  : HtmlNode → Str
renderHtmlNodes : List<HtmlNode> → Str
```

Serialise one or more `HtmlNode` values back to an HTML string.

#### `renderHtmlNodeDoc(title, node)` / `renderHtmlNodesDoc(title, nodes)`

```
renderHtmlNodeDoc  : Str → HtmlNode       → Str
renderHtmlNodesDoc : Str → List<HtmlNode> → Str
```

Like `renderHtmlNode` / `renderHtmlNodes`, but wrap the output in a complete HTML document shell when the input is not already a full document.

A node list is considered a full document if it contains a top-level `Doctype` node or a top-level `Element` with `tag == "html"`. In that case the output is passed through unchanged and `title` is ignored.

Otherwise the rendered HTML is wrapped in:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>…</title>
</head>
<body>
…
</body>
</html>
```

`title` is run through `escapeHtml` so `<`, `>`, and `&` are safe. The single-node variant (`renderHtmlNodeDoc`) applies the same full-document check to the one node: a `Doctype` node or an `<html>` element passes through; any other node type is wrapped.

---

## E.10 `viewlib.pf` — TEA view layer

```pfun
import * from "$PFUN_HOME/lib/viewlib";
import * from "$PFUN_HOME/lib/htmllib";  -- for Attrs, noAttrs, Choice, Block, etc.
```

Provides the view type and rendering for the browser-side Elm Architecture (TEA). Used in conjunction with `tea.pf`. Pure throughout.

### Types

#### `OptionButtonState`

```
type OptionButtonState = {
  | OptionAvailable               -- enabled, not selected
  | OptionSelected                -- currently selected
  | OptionDisabled                -- greyed out, not clickable
  | OptionLocked : reason         -- disabled with a tooltip reason string
}
```

State for individual items in a `VChoiceButtonGroup`.

#### `View`

```
type View = {
  -- Primitive nodes
  | VText       : value                        -- plain text
  | VEl         : tag, attrs, children         -- arbitrary HTML element

  -- Buttons
  | VButton     : label, attrs, onClick        -- onClick : Msg

  -- Form controls
  | VTextInput  : name, value, placeholder, onInput
                                               -- onInput : fn Str → Msg
  | VCheckbox   : name, checked, label, onToggle
                                               -- onToggle : fn Bool → Msg
  | VSelect     : name, choices, selected, onChange
                                               -- choices : List<Choice>
                                               -- onChange : fn Str → Msg
  | VColorInput : name, value, onInput
  | VRangeInput : name, value, min, max, step, onInput
  | VFileInput  : name, label, accept, onRead  -- accept : List<Str> of MIME types
                                               -- onRead : fn Str → Msg (file content)
  | VDownloadButton : label, filename, contents, mimeType, onDownload

  -- Structured content
  | VContent    : block                        -- embed a Block from htmllib
  | VCard       : title, children             -- themed card panel
  | VField      : label, value                -- label/value display pair
  | VFieldBlock : title, fields               -- labelled group of VField rows
  | VDefinition : term, description           -- <dt>/<dd> pair
  | VDefinitionList : title, definitions      -- labelled definition list

  -- Option / choice groups (themed button sets)
  | VOptionButton      : value, label, icon
  | VOptionButtonGroup : name, options, selected, onSelect
  | VToggleButtonGroup : name, options, selected, onToggle
  | VChoiceButton      : value, label, icon, state  -- state : OptionButtonState
  | VChoiceButtonGroup : name, options, onSelect
}
```

`Msg` is the application's own message type (a union defined by the caller). `attrs` is `Attrs` from `htmllib`.

### Constructors

#### Primitive and layout

| Function | Description |
|----------|-------------|
| `vtext(value)` | Plain text node. |
| `vdiv(children)` | `<div>` with no attributes. |
| `vspan(children)` | `<span>` with no attributes. |
| `vp(children)` | `<p>` with no attributes. |
| `vh(level, label)` | Heading `<h1>`–`<h6>`. `level` is `Int` 1–6. |
| `vdivClass(classes, children)` | `<div>` with a CSS class list. |
| `vdivId(id, children)` | `<div>` with an id attribute. |
| `vspanId(id, children)` | `<span>` with an id attribute. |
| `vcontent(block)` | Embed a `Block` from `htmllib` inside a view tree. |

#### Themed layout (use with `theme.pf`)

These emit the `pf-*` CSS class names that `theme.pf`'s `renderThemeStyleTag` defines.

| Function | CSS class | Description |
|----------|-----------|-------------|
| `vpage(children)` | `pf-page` | Full-page container. |
| `vpanel(children)` | `pf-panel` | Bordered surface panel. |
| `vtoolbar(children)` | `pf-toolbar` | Flex toolbar. |
| `vsidebar(children)` | `pf-sidebar` | Aside sidebar. |
| `vcontentPanel(children)` | `pf-content-panel` | Raised content area. |
| `vcard(title, children)` | `pf-card` | Titled card. `title` is a plain `Str`. |
| `vfield(label, value)` | `pf-field` | Single label/value row. |
| `vfieldBlock(title, fields)` | `pf-panel` | Labelled group of `vfield` rows. |
| `vdefinition(term, description)` | — | One `<dt>`/`<dd>` pair. |
| `vdefinitionList(title, definitions)` | `pf-definition-list` | Labelled definition list. |

#### Buttons

| Function | CSS class | Description |
|----------|-----------|-------------|
| `vbutton(label, onClick)` | `pf-button` | Default button. |
| `vprimaryButton(label, onClick)` | `pf-button-primary` | Accent-coloured primary action. |
| `vdangerButton(label, onClick)` | `pf-button-danger` | Destructive action (red). |
| `vbuttonClass(label, classes, onClick)` | `pf-button` + extras | Button with additional CSS classes appended. |
| `vtab(label, selected, onClick)` | `pf-tab` / `pf-tab-selected` | Tab button; `selected : Bool`. |
| `vtabList(tabs)` | `pf-tab-list` | Wraps a list of `vtab` nodes in a tab bar. |

#### Form controls

| Function | Description |
|----------|-------------|
| `vinput(name, value, placeholder, onInput)` | Text input. Emits `pf-input`. |
| `vcheckbox(name, checked, label, onToggle)` | Checkbox. Emits `pf-checkbox`. |
| `vselect(name, choices, selected, onChange)` | Dropdown. `choices : List<Choice>`. Emits `pf-select`. |
| `vcolor(name, value, onInput)` | Colour picker `<input type="color">`. |
| `vrange(name, value, min, max, step, onInput)` | Range slider `<input type="range">`. |
| `vfile(name, label, accept, onRead)` | File picker. `accept` is a `List<Str>` of MIME types. |
| `vdownload(label, filename, contents, mimeType, onDownload)` | Download button; `contents` is a `Str`. |

#### Option / choice button groups

| Function | Description |
|----------|-------------|
| `voption(value, label, icon)` | Single option item (use inside a group). |
| `voptionButtonGroup(name, options, selected, onSelect)` | Single-select button group; `options : List<VOptionButton>`. |
| `vtoggleButtonGroup(name, options, selected, onToggle)` | Multi-select toggle group. |
| `vchoice(value, label, icon, state)` | Single choice item with `OptionButtonState`. |
| `vchoiceGroup(name, options, onSelect)` | Choice button group; `options : List<VChoiceButton>`. |

### Rendering

#### `renderView(view, prefix)`

```
renderView : View → Str → Str
```

Render one `View` node to an HTML string. `prefix` is a namespace string prepended to all `data-pfun-*` event-binding attributes so that multiple TEA components on the same page don't collide. Pass `""` for a single-component app.

#### `renderViews(views, prefix)`

```
renderViews : List<View> → Str → Str
```

Render a list of `View` nodes, concatenating the results.

#### `renderViewChoice(c, selected)`

```
renderViewChoice : Choice → Str → Str
```

Render one `<option>` element inside a `VSelect`. `selected` is the currently selected value string.

### Helper

#### `boolStr(cond, s)`

```
boolStr : Bool → Str → Str
```

Returns `s` if `cond` is `true`, `""` otherwise. Convenience for conditionally emitting HTML attribute strings.

#### `optionChoiceClickable(option)`

```
optionChoiceClickable : VChoiceButton → Bool
```

Returns `true` if the option's state is `OptionAvailable` or `OptionSelected` (i.e. it should respond to clicks).


---

## E.11 `tea.pf` — The Elm Architecture runtime

```pfun
import * from "./tea";
import * from "./viewlib";  -- required; tea.pf imports it internally
import * from "io";         -- required; tea.pf imports it internally
```

Implements the browser-side Elm Architecture (TEA) event loop. In TEA, the application is described by three pure functions — `init`, `view`, and `update` — and `run` owns all mutation and I/O. `tea.pf` coordinates the render/event/update cycle and executes any side-effect commands returned by `update`.

### How it works

1. `run(init, viewFn, updateFn)` renders the initial view and executes any startup command.
2. When the user interacts with a button, input, checkbox, or select, the registered handler calls `updateFn(msg, model)` to get `{ model, cmd }`.
3. `render` re-renders the view tree, replaces the DOM output, and re-attaches all handlers.
4. `executeCmd` runs any `Cmd` effect (currently: sending a JSON POST and dispatching the response as a new `Msg`).

### Types

#### `Cmd`

```
type Cmd = {
  | CmdNone
  | Send : msg, onReply, url
      -- msg     : any value — serialised as JSON and POSTed to url
      -- onReply : fn response → Msg — called with the server's response
      -- url     : Str
}
```

The closed union of effects `update` may request. `CmdNone` means no effect. `Send` causes a JSON POST to `url`; the response is passed to `onReply` to produce the next `Msg`, which is then dispatched through the update loop.

#### `Handler`

```
type Handler = { key, handler }
  -- key     : Str — encodes element type and label/name (e.g. "click_Save")
  -- handler : fn value → Msg
```

Internal record produced by `collectHandlers`. Not typically constructed directly by application code.

### Functions

#### `cmdNone()`

```
cmdNone : unit → Cmd
```

Returns `CmdNone`. Convenience alias for use in `update` return expressions:

```pfun
function update(msg, model) {
  match msg with
  | Increment -> { model = { model | count = model.count + 1 }, cmd = cmdNone() };
}
```

#### `collectHandlers(view)`

```
collectHandlers : View → List<Handler>
```

Walk a `View` tree and collect one `Handler` record per interactive element. Handled variants: `VButton`, `VTextInput`, `VCheckbox`, `VSelect`, `VColorInput`, `VRangeInput`, `VFileInput`, `VDownloadButton`, `VOptionButtonGroup`, `VToggleButtonGroup`, `VChoiceButtonGroup`. Recurses into `VEl` and `VCard` children. Used internally by `render`; exposed for testing or custom runtime implementations.

### Procs

#### `run(init, viewFn, updateFn)` [proc]

```
run : { model, cmd } → (Model → View) → (Msg → Model → { model, cmd }) → unit
```

The application entry point. `init` is any record with `model` and `cmd` fields (typically a named type like `UpdateResult`):

| Field | Type | Description |
|-------|------|-------------|
| `model` | `Model` | The initial model value. |
| `cmd` | `Cmd` | A command to execute on startup (`CmdNone` for none). |

`viewFn` and `updateFn` must be pure `function`s. `run` is a proc and must be called at top level. It does **not** apply a theme automatically — inject a theme stylesheet via `vcontent(RawHtml { renderThemeStyleTag(darkTheme) })` in your `view` function (see E.12).

```pfun
run(init(), view, update);
```

#### `render(model, viewFn, updateFn)` [proc]

```
render : Model → (Model → View) → (Msg → Model → { model, cmd }) → unit
```

Render `viewFn(model)` to HTML, replace the page's output area, and attach all DOM event handlers. Called automatically by `run` and after each update; exposed for advanced use.

#### `executeCmd(cmd, model, viewFn, updateFn)` [async proc]

```
executeCmd : Cmd → Model → (Model → View) → (Msg → Model → { model, cmd }) → unit
```

Execute one `Cmd`. For `CmdNone`, does nothing. For `Send`, POSTs `msg` as JSON to `url`, calls `onReply` on the response, and re-enters the update/render loop. Called automatically after each `render`; exposed for advanced use.

#### `attachAll(handlers, updateFn, model, viewFn, keyCounts)` [proc]

```
attachAll : List<Handler> → ... → unit
```

Wire each `Handler` to its DOM element via the runtime's `attachDomHandler` primitive, tracking occurrence counts so multiple elements with the same key are each wired to the correct DOM node. Called internally by `render`.

### Minimal application template

The idiomatic pattern is to define a named `UpdateResult` type for the `{ model, cmd }` pair so both `init` and `update` have an explicit return type, and to use `vprimaryButton`/`vdangerButton` rather than bare `vbutton` for actions that have clear intent.

```pfun
import * from "io";
import * from "$PFUN_HOME/lib/viewlib";
import * from "$PFUN_HOME/lib/tea";
import * from "$PFUN_HOME/lib/theme";    -- optional: for themed styling

type Model = { count }
type Msg   = { | Increment | Decrement }
type UpdateResult = { model, cmd }

function noCmd(m)        { UpdateResult { m, cmdNone() }; }
function withCmd(m, cmd) { UpdateResult { m, cmd }; }

function init() {
  UpdateResult { Model { 0 }, cmdNone() };
}

function view(model) {
  vpage([
    vcontent(RawHtml { renderThemeStyleTag(lightTheme) }),
    vh(1, "Counter"),
    vp([vtext(__str__(model.count))]),
    vprimaryButton("Increment", Increment),
    vbutton("Decrement", Decrement),
  ]);
}

function update(msg, model) {
  match msg with
  | Increment -> noCmd(Model { model.count + 1 })
  | Decrement -> noCmd(Model { model.count - 1 });
}

run(init(), view, update);
```

---

## E.12 `theme.pf` — Typed theme system

```pfun
import * from "$PFUN_HOME/lib/theme";
```

Defines a fully-typed semantic theme data model and renders it to CSS. A `Theme` is ordinary Pfun data — records of colours, typography, spacing, and component styles. Applications edit these records; `theme.pf` is the only place that turns them into CSS strings.

### Design

Themes use `--pf-*` CSS custom properties injected via a `<style>` block into the page. This namespace is separate from any other design system so they do not interfere. Components in `viewlib.pf` emit `pf-*` class names (e.g. `pf-button`, `pf-card`) that the theme stylesheet defines.

### Types

#### `ColorScale`

```
type ColorScale = {
  canvas, surface, surfaceRaised, overlay,
  text, textMuted, textSubtle,
  accent, accentHover, accentText,
  success, warning, danger, dangerHover,
  border, borderStrong, focus,
  disabledSurface, disabledText
}
```

All fields are CSS colour strings (hex, `rgb(...)`, etc.).

#### `TypographyScale`

```
type TypographyScale = {
  bodyFont, headingFont, monoFont,
  baseSize, smallSize, largeSize,
  weightNormal, weightMedium, weightBold,
  lineHeight
}
```

All fields are CSS value strings.

#### `SpacingScale`

```
type SpacingScale = { xs, sm, md, lg, xl, xxl }
```

CSS length strings (e.g. `"0.5rem"`), mapped to `--pf-space-*`.

#### `RadiusScale`

```
type RadiusScale = { sm, md, lg, pill }
```

Border-radius strings, mapped to `--pf-radius-*`.

#### `ShadowScale`

```
type ShadowScale = { card, popover, focus }
```

`box-shadow` strings, mapped to `--pf-shadow-*`.

#### `ComponentTheme`

```
type ComponentTheme = {
  className, display, foreground, background,
  borderColor, borderWidth, radius,
  padding, margin, fontFamily, fontSize, fontWeight,
  shadow, extra
}
```

Describes one component's CSS rule. `className` is the selector (without the `.`); `extra` is a raw CSS string for any properties not covered by the named fields.

#### `Theme`

```
type Theme = {
  name, mode,
  colors,      -- ColorScale
  typography,  -- TypographyScale
  spacing,     -- SpacingScale
  radius,      -- RadiusScale
  shadow,      -- ShadowScale
  -- component themes:
  page, panel, card, toolbar, sidebar, contentPanel,
  field, fieldLabel, fieldValue,
  button, primaryButton, dangerButton, disabledButton,
  input, select, checkbox,
  optionGroup, optionButton, optionSelected, optionDisabled,
  tabList, tab, tabSelected,
  definitionList, definitionTerm, definitionDescription,
  code, link
}
```

### Functions

#### `component(className, display, foreground, background, borderColor, borderWidth, radius, padding, margin, fontFamily, fontSize, fontWeight, shadow, extra)`

```
component : Str × ... → ComponentTheme
```

Constructor for `ComponentTheme`. Pass `""` for any field you want to omit from the generated CSS rule.

#### `renderThemeCss(theme)`

```
renderThemeCss : Theme → Str
```

Render the full theme to a CSS string: `:root` custom properties, base reset rules, and one class rule per component.

#### `renderThemeStyleTag(theme)`

```
renderThemeStyleTag : Theme → Str
```

Wrap `renderThemeCss` in a `<style>` tag. Inject this into your view:

```pfun
vcontent(RawHtml { renderThemeStyleTag(darkTheme) })
```

### Built-in colour palettes and themes

| Name | Description |
|------|-------------|
| `lightColors` | `ColorScale` — light palette (slate whites, blue accent) |
| `darkColors` | `ColorScale` — dark palette (slate navys, blue accent) |
| `lightTheme` | `Theme` — full light theme built from `lightColors` |
| `darkTheme` | `Theme` — full dark theme built from `darkColors` |

### Usage pattern

```pfun
import * from "$PFUN_HOME/lib/viewlib";
import * from "$PFUN_HOME/lib/theme";
import * from "$PFUN_HOME/lib/tea";

function view(model) {
  vpage([
    vcontent(RawHtml { renderThemeStyleTag(darkTheme) }),
    vh(1, "My App"),
    -- ... rest of view
  ]);
}
```

The `renderThemeStyleTag` call goes at the top of the outermost view node so it renders before any content. `theme.pf` exports `lightTheme` and `darkTheme` ready to use; for a custom theme, start from `lightColors`/`darkColors` and override individual fields, or build a new `ColorScale` from scratch and pass it to the internal `themeFromColors` helper (which constructs the full component set from a colour scale and base typography/spacing/radius/shadow defaults).

### CSS custom properties reference

All properties are defined on `:root` and may be used in any app-level `<style>`:

```css
/* Colours */
--pf-color-canvas          --pf-color-surface         --pf-color-surface-raised
--pf-color-text            --pf-color-text-muted       --pf-color-text-subtle
--pf-color-accent          --pf-color-accent-hover     --pf-color-accent-text
--pf-color-success         --pf-color-warning
--pf-color-danger          --pf-color-danger-hover
--pf-color-border          --pf-color-border-strong    --pf-color-focus

/* Typography */
--pf-font-body             --pf-font-heading           --pf-font-mono
--pf-font-size-base        --pf-font-size-small        --pf-font-size-large
--pf-font-weight-normal    --pf-font-weight-medium     --pf-font-weight-bold
--pf-line-height

/* Spacing */
--pf-space-xs  --pf-space-sm  --pf-space-md
--pf-space-lg  --pf-space-xl  --pf-space-xxl

/* Radius */
--pf-radius-sm  --pf-radius-md  --pf-radius-lg  --pf-radius-pill

/* Shadows */
--pf-shadow-card  --pf-shadow-popover  --pf-shadow-focus
```

---

## E.13 `listutils.pf` — List utilities

```pfun
import * from "$PFUN_HOME/lib/listutils";
```

Common list helpers that are absent from the prelude. Kept as an explicit import (rather than a prelude addition) so names like `min`, `max`, `sort`, and `count` stay opt-in and don't shadow local bindings.

### Folds and aggregates

#### `sum(list)`

```
sum : List<Number> → Number
```

Sum of all elements. Returns `0` for an empty list. Seed is `Int 0`; for a list of `Float` the result will still be numeric but if an empty-Float-list must return `0.0` add `0.0` at the call site.

#### `product(list)`

```
product : List<Number> → Number
```

Product of all elements. Returns `1` for an empty list.

#### `count(pred, list)`

```
count : (α → Bool) → List<α> → Int
```

Number of elements satisfying `pred`. Equivalent to `length(filter(pred, list))`.

#### `minBy(cmp, list)`

```
minBy : (α → α → Int) → List<α> → Option<α>
```

The smallest element under the comparator `cmp`, or `None` if the list is empty. `cmp(a, b)` must return a negative `Int` when `a < b`, `0` when equal, positive when `a > b`.

#### `maxBy(cmp, list)`

```
maxBy : (α → α → Int) → List<α> → Option<α>
```

The largest element under `cmp`, or `None` if empty.

#### `minimum(list)`

```
minimum : List<scalar> → Option<scalar>
```

Smallest scalar element (Int, Float, or String) using `compareScalar`. Returns `None` for an empty list.

#### `maximum(list)`

```
maximum : List<scalar> → Option<scalar>
```

Largest scalar element, or `None` for an empty list.

### Short-circuiting predicates

These are hand-written recursions, **not** `reduce` wrappers. They stop at the first decisive element and are safe to use on a finite prefix of a lazy list (take a slice first with `take`).

#### `any(pred, list)`

```
any : (α → Bool) → List<α> → Bool
```

`true` if at least one element satisfies `pred`. `false` for an empty list.

#### `all(pred, list)`

```
all : (α → Bool) → List<α> → Bool
```

`true` if every element satisfies `pred`. Vacuously `true` for an empty list.

#### `elem(x, list)`

```
elem : α → List<α> → Bool
```

`true` if `x` equals some element of `list` (using `==`). Stops at the first match.

#### `notElem(x, list)`

```
notElem : α → List<α> → Bool
```

Negation of `elem`.

### Association lists

#### `lookup(key, pairs)`

```
lookup : α → List<Pair> → Option
```

Value of the first `Pair` whose `.key` equals `key`, or `None`. For large or keyed data prefer a `dict`; `lookup` is for ordered or duplicate-key association lists.

### Combining

#### `concat(lists)`

```
concat : List<List<α>> → List<α>
```

Flatten a list of lists by exactly one level. `concat([[1,2],[3],[4,5]])` → `[1,2,3,4,5]`. Arbitrary-depth flatten is deliberately absent (it requires a runtime type test the language does not provide; use a typed union for heterogeneous tree structures instead).

#### `flatMap(f, list)`

```
flatMap : (α → List<β>) → List<α> → List<β>
```

Map `fn` over `list` (where `fn` returns a list) then flatten one level. Equivalent to `concat(map(fn, list))`.

#### `zip(a, b)`

```
zip : List<α> → List<β> → List<Pair>
```

Pair up elements as `Pair { key=fromA, value=fromB }`, truncating to the shorter list.

#### `zipWith(f, a, b)`

```
zipWith : (α → β → γ) → List<α> → List<β> → List<γ>
```

Combine elements pairwise with `fn`, truncating to the shorter list.

#### `unzip(pairs)`

```
unzip : List<Pair> → Pair
```

Split a `List<Pair>` into `Pair { key=keys, value=values }` — two lists from one.

#### `enumerate(list)`

```
enumerate : List<α> → List<Pair>
```

Pair each element with its 0-based index as `Pair { key=index, value=elem }`.

### Ordering

#### `compareScalar(a, b)`

```
compareScalar : scalar → scalar → Int
```

Default comparator for `Int`, `Float`, and `String`. Returns `-1` when `a < b`, `0` when equal, `1` when `a > b`. String comparison is lexicographic (code-unit order): `"Z" < "a"`. Do not mix element types in one list.

#### `sortBy(cmp, list)`

```
sortBy : (α → α → Int) → List<α> → List<α>
```

Stable sort using comparator `cmp`. The implementation is a bottom-up merge sort: equal elements keep their original relative order. `cmp(a, b)` must return a negative `Int` when `a` should come before `b`.

```pfun
// sort records by age ascending, then name alphabetically on ties:
let byCmp = fn a, b => {
  let byAge = compareScalar(a.age, b.age);
  if byAge != 0 then byAge else compareScalar(a.name, b.name);
};
let sorted = sortBy(byCmp, people);
```

#### `sort(list)`

```
sort : List<scalar> → List<scalar>
```

Stable ascending sort of scalar elements (`Int`, `Float`, `String`) using `compareScalar`.

#### `sortDesc(list)`

```
sortDesc : List<scalar> → List<scalar>
```

Stable descending sort of scalar elements.

#### `merge(cmp, a, b)`

```
merge : (α → α → Int) → List<α> → List<α> → List<α>
```

Merge two already-sorted lists into one sorted list. Exposed as a building block for merge-based algorithms (e.g. merge step of an external sort).

---

## E.14 `testing.pf` — Test model

```pfun
import * from "./testing";
```

Defines the data model for tests. Import path is relative to the test file.

### Types

```
type Fixture = { before, after }
  -- before : proc(),  after : proc()

type Test = { name, fixture, body }
  -- name : Str,  fixture : Fixture,  body : proc() → TestResult

type Suite = { name, tests }
  -- name : Str,  tests : List<Test>
```

### Values and functions

| Name | Kind | Description |
|------|------|-------------|
| `noFixture` | `Fixture` | A fixture whose `before` and `after` procs do nothing. |
| `fixture(before, after)` | function | Construct a `Fixture` from two no-argument procs. |
| `test(name, body)` | function | Construct a `Test` with `noFixture`. `body` is a `proc() → TestResult`. |
| `testUsing(name, fixture, body)` | function | Construct a `Test` with a specific `Fixture`. |
| `suite(name, tests)` | function | Construct a `Suite` from a name and a list of `Test` values. |
| `emptySuite(name)` | function | Construct a `Suite` with no tests, for use with the pipe/`addTest` pattern. |
| `addTest(t, s)` | function | Append a `Test` to a `Suite`. Designed for the pipe operator: `emptySuite("…") \|> addTest(t1) \|> addTest(t2)`. |
| `withFixture(test, fixture)` | function | Return a copy of `test` with a different `Fixture` attached. |

---

## E.15 `assertions.pf` — Assertion primitives

```pfun
import * from "./assertions";
```

Assertion functions return `Check` values. Collect them with `assertions([…])` to produce a `TestResult` for the test runner.

### Types

```
type Failure = { message, expected, actual }
  -- all fields are Str (values are stringified at assertion time)

type Check = { | Pass | Fail : failure }
  -- failure : Failure

type TestResult = { failures }
  -- failures : List<Check>  (contains only the Fail variants)
```

### Assertion functions

All are pure `function`s. All return `Check` — `Pass` on success, `Fail { Failure { … } }` on failure.

| Function | Signature | Passes when… |
|----------|-----------|-------------|
| `assertEqual(expected, actual)` | `α → α → Check` | `expected == actual` |
| `assertNotEqual(expected, actual)` | `α → α → Check` | `expected != actual` |
| `assertTrue(value)` | `Bool → Check` | `value` is `true` |
| `assertFalse(value)` | `Bool → Check` | `value` is `false` |
| `assertSome(value)` | `Option<α> → Check` | `value` is `Some _` |
| `assertNone(value)` | `Option<α> → Check` | `value` is `None` |
| `check(condition, message)` | `Bool → Str → Check` | `condition` is `true` |
| `fail(message)` | `Str → Check` | Never (always `Fail`) |

### Aggregation

#### `assertions(list)`

```
assertions : List<Check> → TestResult
```

Filter the list to only failing `Check` values and wrap in a `TestResult`. This is what a test body proc must return:

```pfun
proc myTest() {
  assertions([
    assertEqual(1 + 1, 2),
    assertTrue(length([1,2,3]) == 3),
    check(someCondition, "expected condition to hold"),
  ]);
}
```

---

## E.16 `runner.pf` — Test runner

```pfun
import * from "./runner";
```

Executes suites, prints a Jest-style summary, and re-exports the `Stats` type. Also re-imports `testing.pf` and `assertions.pf` internally, so a test file that imports `runner.pf` does not need to import those separately (though re-importing is harmless).

### Types

```
type Stats = { suitePass, suiteFail, testPass, testFail }
  -- all fields : Int
```

### Functions and procs

| Name | Kind | Description |
|------|------|-------------|
| `runSuites(suites)` | proc | Execute a list of `Suite` values sequentially. Runs `before`/`after` fixtures around each test. Continues after failures. Prints a summary to stdout with pass/fail counts and `PASS` or `FAIL` at the end. |

Typical usage in a test file:

```pfun
import * from "io";
import * from "./testing";
import * from "./assertions";
import * from "./runner";

let suite1 = suite("Arithmetic", [
  test("addition", proc() {
    assertions([assertEqual(1 + 1, 2)]);
  }),
]);

runSuites([suite1]);
```

*End of Appendix E.*
