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
- Use a **dedicated named union** when a module has a few fallible operations
  with *different* success payloads, to avoid the constructor unification
  described in [§2.4](#24-constructor-monomorphism-and-generic-types).
  `dbschema.pf` does this with `ColsResult`, `ConsResult`, `TableResult`, and
  `SchemaResult` for its metadata loaders.
- Use a **`generic type`** result union when one result shape must wrap *many*
  different payloads across the module (as generated model code does):
  `dbschema.pf`'s `generic type InsertResult`/`FindResult`/`MutResult` each wrap
  whatever model record a given generated function returns. See
  [§2.4](#24-constructor-monomorphism-and-generic-types).

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
| `Result` | `Ok { value }` \| `Err { message }` | in scope once you `import` a module that uses it | `file`, `http`, `db/*` |
| `ReadResult` | `Ok { value }` \| `Eof` \| `Err { message }` | in scope once you `import "file"` | streaming file reads |

`Option` and `Pair` are registered globally, so you can construct and match
`Some`/`None`/`Pair` in any program. **`Ok`/`Err`/`Eof` are *not* standalone
globals** — they enter scope through the module that defines them. Importing
`file`, `http`, or a `db/*` driver makes `Ok`/`Err` (and, for `file`, `Eof`)
available for both matching *and* construction; without such an import,
`Ok { … }` reports *"Unknown type 'Ok'."* This is why library modules that want
to return `Ok`/`Err` themselves **re-declare** the type locally (see the note
below and [§29](#29-data-model-persistence)).

Because `Ok`/`Err` are shared by `Result` and `ReadResult`, `match` uses the
subject's type to decide which variants are required (see
[§10.4](#104-matching-multi-variant-results)).

> **Constructing `Ok`/`Err` in your own module.** If a module needs to *build*
> `Ok`/`Err` values (rather than only match ones returned by `file`/`db`), the
> reliable idiom — used throughout the corpus — is to declare the type in that
> module:
> ```pfun
> generic type Result = { | Ok : value | Err : message }
> ```
> Declaring it `generic` also sidesteps the payload‑unification described in
> [§2.4](#24-constructor-monomorphism-and-generic-types); a *plain* re‑declaration
> makes `Ok`'s payload monomorphic within that module.

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

**Built‑in constructors always in scope:** `Some`, `None`, `Pair`; the literal
keywords `dict` and `array`. (`Ok`, `Err`, and `Eof` are *not* unconditional
globals — they come into scope by importing a module that defines them, `file` /
`http` / `db/*`, or by a local `type Result`/`ReadResult` declaration; see
[§20](#20-built-in-types).)

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
