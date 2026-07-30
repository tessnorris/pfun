# The Pfun Programming Language V2 — Reference Manual

*Draft — tracks the V2 bootstrap compiler. This manual is deliberately written
ahead of the implementation: it documents the language as designed, and marks
each feature with its build status so it doubles as the target list for
everything still to be built.*

**Status legend**, used throughout:

- **[Implemented]** — works in the bootstrap compiler today (parsed, checked, emitted).
- **[Partial]** — some layers exist (usually syntax and checking) but the behavior described is not yet complete end to end. The text describes the target; a note describes the gap.
- **[Planned]** — specified here and in the architecture document, not yet built.

Unmarked text describes semantics shared by every status, or prose that has no
implementation surface.

---

## Table of Contents

- Introduction — what Pfun is, the purity boundary, what changed from V1
- **Part I — The Functional Core**
  - 1. Lexical structure
  - 2. Values and the type system
  - 3. Expressions and operators
  - 4. Strings, characters, and bytes
  - 5. Pure functions and lambdas
  - 6. Lists, comprehensions, and lazy lists
  - 7. Records and the Pair type
  - 8. Unions, Option, and Result
  - 9. Pattern matching
  - 10. Modules, imports, and interfaces
- **Part II — The Procedural Shell**
  - 11. Procedures
  - 12. Mutable bindings and assignment
  - 13. Statement control flow
  - 14. Dictionaries, arrays, and buffers
  - 15. Console and file I/O
  - 16. Asynchronous procedures
  - 17. Effects as data: descriptors and dispatch
- **Part III — Guarantees and Libraries**
  - 18. Totality: why pure code cannot fail
  - 19. Core builtins reference
  - 20. Builtin modules
  - 21. The Pfun standard library
- **Part IV — The Toolchain**
  - 22. The compiler pipeline
  - 23. Command line
  - 24. Diagnostics
  - 25. Build roadmap

---

# Introduction

## What Pfun is

Pfun — short for **Procedural-FUNctional** — is a general-purpose programming
language built around a single, opinionated design decision: **the pure
functional world and the effectful procedural world are kept rigorously
separate, and the separation is enforced by the language rather than left to
discipline.**

A V2 Pfun program is a *strict, immutable, statically-checked functional core*
wrapped in a *mutable, side-effecting procedural shell*. You write the parts of
your program that compute values — parsing, transformation, business rules,
rendering — as **pure functions**. You write the parts that touch the outside
world — printing, reading files, serving HTTP, mutating state — as
**procedures**. The compiler knows which is which and refuses to let them blur
together.

V2 is compiled-only. One compiler front end checks every program; one emitter
lowers it to JavaScript; one linker assembles it for a target:

- `pfc build program.pf -o program.js` — an ahead-of-time Node bundle. **[Implemented]**
- `pfun check` / `pfun run` / `pfun serve` — check-only, build-and-execute, and full-stack server targets. **[Planned]**
- A browser playground that runs the compiler itself in a sandbox. **[Planned]**

There is no interpreter and no REPL in V2. One semantics, one pipeline.

## The central idea: the purity boundary

Every callable is declared with one of three keywords, and the keyword fixes
its capabilities:

| Keyword | Kind | Side effects? | First-class value? | Memoizable |
|---|---|---|---|---|
| `function` | pure function | **No** | Yes | with `memo` |
| `fn` | anonymous pure lambda | **No** | Yes | — |
| `proc` | procedure / anonymous proc lambda | **Yes** | Yes | never |

The rules that make the boundary real:

- A `function` cannot print, cannot declare a `var`, cannot assign, cannot
  `await`, and cannot call a procedure. Each violation is a compile-time
  purity diagnostic. **[Implemented]**
- A `proc` may do anything: print, mutate, call other procedures, *and* call
  pure functions. Calls flow one way. **[Implemented]**
- **Proc values are first-class, but invocation is always effectful.** Pure code
  may create, bind, store, pass, import, export, and return a proc value; it may
  not call one. Anonymous proc values use explicitly typed
  `proc (...) -> R { ... }` or `async proc (...) -> R { ... }` syntax. The
  checker follows inferred `TProc` values through bindings and fields so the
  call boundary remains static. **[Implemented]**

Effectful *intent* still travels through pure code — as plain data. Pure code
constructs **descriptor** values (a union pairing each effect with a pure
continuation); one procedure per application executes them with an exhaustive
`match`. Chapter 17 develops this pattern; it is the foundation of the TEA
browser target and shared client/server contracts.

## Static checks are the authority

V2 removes V1's runtime type registry and its runtime purity net. Everything
the compiler promises, it proves before emitting:

- **Type inference** is Hindley-Milner with nominal records and unions,
  deferred field constraints, and an explicit `generic` opt-in for
  polymorphism. There are no type annotations on ordinary code. **[Implemented]**
- **Purity** is checked by a name-based pass with no dynamic fallback. **[Implemented]**
- **Exhaustiveness** covers unions *and list lengths*, and guarded arms do not
  count toward coverage. A match that checks is a match that cannot fail. **[Implemented]**
- **Totality**: pure code cannot raise at runtime — no division by zero, no
  out-of-range index, no partial reads. Chapter 18 explains the four failure
  classes and the mechanisms (`NonZero`, `Option`-returning reads, IEEE
  floats with a total order, list patterns) that make the first three
  compile-time concerns. **[Partial** — the checker rules exist; several
  Option-returning builtins and the `NonZero` literal coercion are still being
  wired through the builtin manifest and emitter**]**

## Evaluation is strict

V1 evaluated the functional core lazily through thunks. **V2 evaluates
strictly**: arguments are evaluated left to right before a call; a `let` runs
its initializer exactly once at the binding.

```pfun
let x = expensive();
let y = x + x;        // expensive() ran once, at the let
```

Laziness did not disappear — it became explicit and local. The `lazy` keyword
requests a lazily-produced *list* (and only a list):

```pfun
let evens = lazy [n * 2 for n <- range(1, 1000000) where n % 2 == 0];
```

The logical type is still `List<Int>`; the runtime may represent it as a
sequence thunk. Chapter 6 covers the rules. **[Partial** — parsed and checked;
lazy runtime representation is Phase 15 host work**]**

## What changed from V1

A one-table map for readers who know V1. Each row is expanded in the chapter
noted.

| Area | V1 | V2 | Chapter |
|---|---|---|---|
| Execution | Interpreter + compiler, byte-identical | Compiled only; no interpreter, no REPL | 22 |
| Evaluation | Lazy functional core | **Strict**; `lazy` only for list literals/comprehensions | 6 |
| String concat | `+` overloaded | **`++`, string-only**; `+` is numeric-only; lists use named functions | 3, 4 |
| `if` as expression | `if c then { a } else { b }` in expression position | **Removed.** Use `? :` inline, or a block whose *trailing* `if` statement is its value | 3 |
| Polymorphism | Broad implicit generics | **Monomorphic by default**; explicit `generic function` / `generic proc` / `generic` fields | 2 |
| Procs | First-class values, runtime purity check | **Second-class names**; purity fully static; effects travel as descriptors | 11, 17 |
| Assignment | Expression | **Statement**; `=` in expression position is a syntax error | 12 |
| Division | Runtime error on zero | `/` and `%` require a **`NonZero`** divisor, proven statically | 2, 18 |
| `head`/`tail`/`nth`/indexing | Partial, runtime error | Return **`Option`**; list *patterns* are the canonical total decomposition | 6, 9, 18 |
| Floats | Domain errors possible | **IEEE-754, total**, with a total order (NaN participates in `==`/sort) | 2, 18 |
| Match guards | Counted toward exhaustiveness conservatively | **Guarded arms never count**; every variant/length needs unguarded coverage | 9 |
| `extern` | Exportable | **Private** to the declaring module; wrap it in Pfun to export | 10 |
| Type registry | Runtime registry, runtime checks | Removed; checks are static, emission is type-directed | 22 |
| Opaque types | Convention | `export opaque type` — importers cannot construct, match, or field-access | 10 |
| Equality on functions | Runtime crash risk | `Equatable`/`Comparable` constraints checked statically | 2, 18 |

Everything else you know from V1 — the purity boundary itself, records and
unions, `match`, format strings, modules, the TEA pattern — carries forward
with the refinements described in each chapter.

## How to read this manual

Parts I and II describe the language. Part III describes the guarantees and
the library surface. Part IV describes the toolchain and, importantly for a
manual written ahead of its implementation, the **build roadmap** — chapter 25
collects every **[Partial]** and **[Planned]** marker into one ordered list.

Code samples use the V2 house style found throughout the bootstrap compiler's
own sources: tabs for indentation, one construct per line for long forms,
`match` preferred over conditional chains, and helper functions preferred over
deep nesting.

---

# Part I — The Functional Core

# 1. Lexical structure

## 1.1 Comments and whitespace **[Implemented]**

```pfun
// line comment
/* block comment — does not nest */
```

Whitespace is space, tab, carriage return, and newline. Tokenization uses
longest match; `++` is recognized as one token before `+`, `=>` before `=`,
`<-` before `<`.

## 1.2 Statements, blocks, and semicolons **[Implemented]**

A statement list is a sequence of statements. `let`, `var`, and assignment
statements end with `;`. An expression statement's `;` is optional; by
convention the compiler sources write it. A block `{ ... }` takes no `;`
after the closing brace.

The value of a block is the value of its final expression statement — or of
its final *trailing `if` statement* (§3.6). Blocks ending in any other
statement form have the unit value.

## 1.3 Identifiers and keywords **[Implemented]**

Identifiers begin with a letter or `_` followed by letters, digits, and `_`.
A lone `_` is the wildcard, legal only where the grammar says so (parameters
and patterns). The reserved words are:

```text
let var type generic if then else function proc memo async await return fn
for while dict array import export as from match with where extern lazy
true false
```

Note that `fn` and `as` are keywords and therefore unavailable as parameter
or binding names — a frequent V1-porting stumble.

Conventions used by the standard sources: `lowerCamel` for bindings and
functions, `UpperCamel` for types and variants, module-namespace imports as
short `UpperCamel` aliases (`import * as StrX from "./strx"`).

## 1.4 Literals **[Implemented]**

| Form | Examples | Notes |
|---|---|---|
| Int | `42`, `0xFF` | Arbitrary precision |
| Float | `1.5`, `2e10`, `6.02e+23` | IEEE-754 double |
| Byte | `200b`, `0xAB_b` | Value must be 0–255; `_b` suffix disambiguates hex |
| Bool | `true`, `false` | |
| Char | `'a'`, `'\n'` | One Unicode scalar value |
| String | `"hi\n"` | Escapes: `\n \t \\ \" \' \{ \}` |
| Raw string | `@"C:\path\{literal}"` | No escapes; ends at the next `"` |
| Format string | `$"n = {count + 1}"` | Full expression grammar inside `{}`; nested format strings are rejected |

A format string evaluates to `Str`. Interpolated expressions are converted
with the same rules as `str(...)`.

# 2. Values and the type system

Pfun V2 is statically typed with **no type annotations on ordinary code**.
Types are inferred by a Hindley-Milner core extended with nominal records and
unions, deferred field constraints, and explicit generalization. This chapter
states the model; the normative details are the architecture document's
typing commitments T1–T4.

## 2.1 Scalar types **[Implemented]**

`Int` (arbitrary precision), `Float` (IEEE-754 double), `Bool`, `Str`,
`Char`, `Byte`, and the unit value of statement-valued blocks.

Two scalar refinements exist for totality:

- **`NonZero`** — an opaque builtin proving an `Int` is not zero. Int `/` and
  `%` require a `NonZero` divisor. A nonzero integer *literal* in divisor
  position coerces automatically (`x / 2` just works); a data-dependent
  divisor is proven with `nonZero : Int -> Option<NonZero>`, or skipped with
  `safeDiv`/`safeMod : Int, Int -> Option<Int>`. A literal `0` divisor is a
  type error at the call site. `NonZero` erases to `Int` at runtime; the
  emitter performs no zero check because the type system already did.
  **[Partial** — `nonZero`/`safeDiv`/`safeMod` are in the builtin manifest and
  `NonZero` is in the type model; the divisor requirement and literal
  coercion are not yet enforced by the checker**]**
- **Float totality** — no float operation raises. `NaN` and `±Inf` are
  ordinary values; `x / 0.0` is `±Inf` or `NaN`. Equality and ordering use a
  total order: all NaNs are equal to each other and greater than `+Inf`, and
  `-0 == +0`. `isNaN`/`isFinite` give loud checks; `floatToInt : Float ->
  Option<Int>` is `None` exactly on non-finite input. **[Partial** — emitter
  routes float comparison through the host's total-order `$cmpF`; host
  intrinsics land in Phase 15**]**

## 2.2 Composite types **[Implemented]**

- `List<T>` — immutable, homogeneous, the workhorse (chapter 6).
- Records — nominal, declared with `type` (chapter 7).
- Unions — nominal sums with payload fields (chapter 8).
- `Dict<K, V>` and `Array<T>` — mutable, procedural-only mutation (chapter 14).
- Function types `(<params>) -> ret` and procedure types
  `proc(<params>) -> ret` / `async proc(<params>) -> ret` are values. Sync and
  async proc types are distinct.

## 2.3 Monomorphic by default, `generic` by declaration **[Implemented]**

A normal `function` is inferred once and must have **one** monomorphic type
across all call sites in the checking scope:

```pfun
function getValue(item) { item.value }

let v1 = getValue(i1);
let v2 = getValue(i2);   // error if i2 instantiates item differently than i1
```

A `generic function` is inferred once, then generalized; each call site gets
its own instantiation:

```pfun
generic function getValue2(item) { item.value }
```

`generic` does not disable checking — it only generalizes what remains
polymorphic after inference. A body that constrains a parameter keeps the
constraint at every instantiation:

```pfun
generic function tagged(item, suffix) {
	trim(item.value) ++ suffix;    // item.value is Str at every call site
}
```

`generic proc` generalizes a named proc's signature the same way. Anonymous
proc values remain monomorphic. It exists for library procs over
per-application descriptor unions — see chapter 17.

## 2.4 Generic record and payload fields **[Implemented]**

A `generic` field creates an independent hidden type variable for the
containing type:

```pfun
type Indexed = { index, generic value };
type Option  = { | None | Some: generic value };
type Result  = { | Ok: generic value | Err: generic error };
```

`Indexed { index = 1, value = "x" }` and `Indexed { index = 2, value = 9 }`
are `Indexed<Str>` and `Indexed<Int>` — distinct instantiations of one
nominal type. Each generic payload field of a union introduces one slot on
the union; slots collapse through ordinary unification. Recursive fields
(`CBatch.cmds : List<Cmd<...>>`) recurse at the declaration's own slots.

## 2.5 Field access is a deferred constraint **[Implemented]**

`item.value` on an unannotated parameter is not typeable in textbook HM.
Pfun defers it: the access emits a `HasField` constraint that discharges when
the subject's type becomes concrete — usually at the first call:

```pfun
function bump(item) { item.index + 1 }
let a = bump(Indexed { index = 1, value = "x" });   // discharges against Indexed
```

If two record types share a field name and nothing ever decides between
them, the constraint stays pending and is an **error, not a silent guess**.
For `generic` declarations, undischarged constraints over quantified
variables move into the scheme and re-check at each instantiation.

## 2.6 Exports must be ground **[Implemented]**

When a module finishes checking, every exported binding not declared
`generic` must have a type with no free variables and no pending constraints.
The diagnostic states the remedy: *add a constraining use, or declare it
generic.* This is what makes module interfaces frozen data and checking
order-independent. Two refinements:

- Exported type declarations obey the same rule for their non-generic fields.
- A residual variable occurring *only* as a hidden slot of a named type
  defaults to `Unit` (slot defaulting) — it corresponds to variants the
  module never constructs. **[Planned]**
- A private, unreferenced binding with pending constraints is dead code: the
  compiler warns and does not emit it. **[Planned** — warning severity exists
  in the diagnostic model; the dead-binding analysis does not yet**]**

## 2.7 `Equatable` and `Comparable` **[Implemented]**

`==`/`!=` require both operands `Equatable`: no function type anywhere inside
the value. `<`/`<=`/`>`/`>=` and `sort` require `Comparable`: `Int`, `Float`,
`Str`, `Char`, `Byte`, `Bool`, and `List` of `Comparable`. Records and
variants are not `Comparable` in V2 (they may be admitted later). Dict keys
require `Equatable`. Both constraints ride the deferred-constraint machinery:
concrete types discharge immediately; constraints over quantified variables
move into schemes.

## 2.8 Opaque types **[Implemented syntax, Planned enforcement]**

`export opaque type` exports a type's identity and generic arity but not its
constructors, variants, or fields. Outside the defining module the type
cannot be constructed, matched, or field-accessed — smart constructors become
proofs rather than conventions. `NonZero` is the canonical example.

# 3. Expressions and operators

## 3.1 Precedence **[Implemented]**

Loosest to tightest:

```text
1  pipelines         |> |?> |!>
2  ternary           ? :          right-assoc
3  or                ||
4  and               &&
5  equality          == !=
6  comparison        < > <= >=
7  bitor             |
8  bitand            &
9  shift             << >>
10 additive          + - ++
11 multiplicative    * / %
12 unary             - ! await
13 postfix           call, index, field
14 primary
```

`&&`, `||`, and `? :` short-circuit. Evaluation order is strict,
left-to-right, innermost-first.

## 3.2 Arithmetic **[Implemented]**

`+ - * / %` are numeric-only. Mixed `Int`/`Float` operands promote to
`Float`:

```pfun
1 + 2        // Int
1.5 + 2      // Float — promotes
"a" + "b"    // type error: '+' requires numeric operands
```

Int division and modulo require a `NonZero` divisor (§2.1). Float arithmetic
is total (§2.1). Bitwise `& | << >>` operate on `Int`.

## 3.3 String concatenation: `++` **[Implemented]**

`++` concatenates strings and **only** strings:

```pfun
"hi" ++ "!"          // "hi!"
"count: " ++ 3       // type error: '++' requires Str operands
"count: " ++ str(3)  // explicit conversion
$"count: {3}"        // preferred mixed formatting
```

`++` is not list concatenation. Lists use named functions (`append`,
`concat`, and the ListX library).

## 3.4 Comparison, equality, logic **[Implemented]**

`==`/`!=` are structural on `Equatable` values; `<`-family requires
`Comparable` (§2.7). Emission is type-directed: integer comparisons,
total-order float comparisons, raw scalar identity, and structural equality
are selected by the checker's types, not probed at runtime.

## 3.5 The ternary operator **[Implemented]**

The inline conditional expression:

```pfun
let label = n == 1 ? "item" : "items";
```

Right-associative; chains read like `else if` ladders. Style: the compiler
sources use `? :` for short value selections and `match`/blocks for anything
with structure.

## 3.6 Conditionals in value position: the trailing `if` **[Implemented]**

V1's `if`-expression is removed. In V2, `if ... then ... else ...` is a
*statement* whose branches are blocks — but a block whose **final statement
is an `if`** takes the unified branch value as its own value. This is the
V2 house form for multi-line conditionals in value position:

```pfun
export generic function countWhere(pred, xs) {
	reduce(fn n, x => {
		if pred(x) then { n + 1 } else { n }
	}, 0, xs)
}
```

Rules:

- In trailing (value) position, both branches are type-unified and the `if`
  yields that value. An `else`-less trailing `if` yields unit.
- In any other statement position, branch values are discarded and the
  branches are **not** unified — `if c then { log(1); } else { log("x"); }`
  is fine mid-body.
- `if` cannot appear as a `let` initializer or inside an expression; use
  `? :` there, or bind through a helper.

## 3.7 Pipeline operators **[Implemented]**

`x |> f` applies `f` to `x`; pipes chain left to right:

```pfun
raw |> trim |> parse |> render
```

The right operand must be callable with exactly the piped value. A proc value
may be used on the right only in proc context because the pipe desugars to an
effectful call.

`|?>` is the Option-aware pipeline and `|!>` is the Result-aware pipeline.
Both are **transparent until their wrapper first appears**, so a chain may
start from ordinary data and use one operator throughout:

```pfun
let transformed = rows
	|!> transpose       // raw rows -> Result<Rows, ShapeError>
	|!> reverse         // a raw Rows return is automatically rewrapped as Ok
	|!> slide           // a Result return is flattened, never nested
	|!> reverse
	|!> transpose;
```

The rules are:

- Before a stage returns the relevant wrapper, `x |?> f` and `x |!> f`
  behave like `x |> f`. A raw return keeps the chain raw; an `Option` or
  `Result` return starts wrapped mode for the following stage.
- `None |?> f` and `Err { error } |!> f` return unchanged without invoking
  `f`.
- `Some { value } |?> f` invokes `f(value)`. A raw `B` return becomes
  `Some<B>`; an `Option<B>` return is flattened.
- `Ok { value } |!> f` invokes `f(value)`. A raw `B` return becomes
  `Ok<B, E>`; a `Result<B, F>` return is flattened. The checker joins `E`
  and `F` through the smallest declared combined union.
- The operators do not recover failures and do not cross wrappers: `|?>`
  handles only `Option`, and `|!>` handles only `Result`.

All three operators have the same low precedence and associate left to right.
Their right operand must be callable with exactly one argument. Invoking a proc
through any pipeline follows the same purity rule as a direct proc call.

## 3.8 Indexing and field access **[Partial]**

`xs[i]` indexes lists and strings; `d[k]` looks up a dict. All indexing
returns `Option` — there is no out-of-range error in pure code (chapter 18).
`r.field` accesses a record field, checked against the nominal declaration
(or deferred, §2.5). **[Partial** — grammar and checking exist; the
`Option`-returning read contract is not yet wired through all builtins and
the emitter**]**

## 3.9 Block expressions **[Implemented]**

`{ stmts }` in expression position evaluates its statements and yields the
final expression (or trailing-`if`) value. Lambda bodies are the most common
site:

```pfun
let clamp = fn lo, hi, x => {
	let bounded = x < lo ? lo : x;
	bounded > hi ? hi : bounded
};
```

# 4. Strings, characters, and bytes

## 4.1 The string model **[Implemented]**

`Str` is a scalar type — an immutable sequence of Unicode text. It is not a
`List<Char>`; character-level work goes through explicit functions:

```pfun
split("abc", "")            // ["a", "b", "c"] : List<Str>
join(["a", "b"], "-")       // "a-b"
length("héllo")             // 5
slice(1, 3, "abcdef")       // "bcd"  (start, count, subject)
```

`Char` is a distinct scalar holding exactly one Unicode scalar value.
`chr : Int -> Option<Char>` is `None` outside the scalar-value range, so an
invalid `Char` cannot exist; `asc` gives a `Char`'s code point.
**[Partial** — the manifest currently types `chr` as total `Int -> Char`; the
`Option` form is the V2 target**]**

## 4.2 Format strings **[Implemented]**

`$"..."` interpolates full expressions:

```pfun
let msg = $"module {name}: {length(diags)} diagnostic(s)";
```

Interpolations use the whole expression grammar; nested format strings inside
an interpolation are rejected. `\{` and `\}` escape literal braces.

## 4.3 Raw strings **[Implemented]**

`@"..."` disables escapes entirely — the literal runs to the next `"`.
Useful for regex-like content, Windows paths, and embedded JS/HTML snippets.

## 4.4 Bytes **[Implemented syntax, Partial semantics]**

`Byte` literals are `200b` or `0xAB_b` (0–255). Byte arithmetic wraps modulo
256, keeping it total. `charBytes : Char -> List<Byte>` and
`bytesToChar : List<Byte> -> Option<Char>` convert at the UTF-8 boundary.
Buffer I/O over bytes is chapter 14/15 territory. **[Partial** — literals,
type, and conversions exist; wrapping-arithmetic emission is Phase 15 host
work**]**

# 5. Pure functions and lambdas

## 5.1 Named functions **[Implemented]**

```pfun
function area(w, h) {
	w * h
}

export generic function mapOption(f, o) {
	match o with
	| Some s -> Some { f(s.value) }
	| None -> None;
}
```

The final expression (or trailing `if`) is the return value. `return expr;`
exists for early exit and is legal in pure functions. Parameters may be `_`
to ignore an argument.

Calls are **exact arity**. V1's automatic currying and partial application
are gone; partial application is spelled with a lambda:

```pfun
let double = fn x => scale(2, x);
```

## 5.2 Lambdas **[Implemented]**

`fn params => expr` or `fn params => { block }` creates an inferred pure
lambda. An anonymous procedure uses an explicit monomorphic signature and a
block body:

```pfun
import * from "async";
import * from "io";

let inRange = fn lo, hi => fn x => x >= lo && x <= hi;
let isDigit = inRange(48, 57);

type Handler = { generic action }

// Pure code may pass and store a proc value. It may not invoke one.
function makeHandler(action) {
	Handler { action = action }
}

async proc demonstrateProcLambdas() {
	let prefix = "event";
	var count = 0;
	let onLine = proc (line: Str) -> Unit {
		count = count + 1;
		println(prefix ++ " " ++ str(count) ++ ": " ++ line);
	};

	let handler = makeHandler(onLine);
	handler.action("first");
	handler.action("second");

	let delayed = async proc (value: Int) -> Int {
		match await sleep(0) with
		| Ok _ -> value + count
		| Err failure -> {
			println(nativeErrorMessage(failure.message));
			value + count
		}
	};
	println("async result = " ++ str(await delayed(40)));
}
```

Creating or transporting a proc lambda is pure; invoking it is not. Captured
`let` values are immutable. A captured `var` is a shared lexical cell, so
mutations are visible to the enclosing proc and later callback invocations.
Sync and async proc lambdas have distinct `TProc` types. Proc lambdas are not
generic; named `generic proc` declarations remain the polymorphic form.

Here `makeHandler` is pure: it transports the proc value into a record without
calling it. The two `handler.action` calls are legal because they occur inside
an async proc, and both calls update the same captured `count` cell. The
`delayed` value has an async proc type and must be invoked from proc context;
`await` keeps its result in sequence with the surrounding example.

## 5.3 Memoized functions **[Implemented syntax, Planned runtime]**

`memo function` caches results by argument. Because pure functions cannot
observe effects, memoization is always sound. Float keys use the total order
(all NaNs collapse to one cache entry). **[Planned** — parsed and checked;
the memo cache is Phase 15 host work**]**

## 5.4 Tail calls **[Partial]**

Direct self-tail-calls compile to loops — the recursive house style
(`loop(rest, acc)` helpers) runs in constant stack:

```pfun
function sumLoop(xs, acc) {
	match xs with
	| [] -> acc
	| [x, ...rest] -> sumLoop(rest, acc + x);
}
```

**[Partial** — the emitter lowers self-tail-calls in `return`/trailing-`if`
positions today; tail calls in *match arms* (the dominant shape above) are
not yet lowered and remain the top emitter work item. Mutual tail recursion
is not optimized and is not promised.**]**

# 6. Lists, comprehensions, and lazy lists

## 6.1 Lists **[Implemented]**

Immutable, homogeneous:

```pfun
let xs = [1, 2, 3];
let ys = cons(0, xs);        // [0, 1, 2, 3]
let n  = length(xs);
```

Element access is total: `xs[i]`, `head(xs)`, `tail(xs)`, and
`nth(xs, i)` all return `Option`. The canonical decomposition is a list
*pattern* (§9.3), which needs no `Option` at all. **[Partial** — the manifest
currently types `nth` as total and lacks `head`/`tail`/`getOr`; the
`Option`-returning family is the V2 target**]**

## 6.2 Higher-order functions **[Implemented]**

`map`, `filter`, `reduce` are ambient builtins:

```pfun
let total = reduce(fn acc, x => acc + x, 0, xs);
let evens = filter(fn x => x % 2 == 0, xs);
```

`reduce(f, init, xs)` folds left with `f(acc, x)`. The ListX library
(chapter 21) supplies `append`, `concat`, `foldLeft`, `zip`, `sortBy`,
`takeL`, `splitAt`, and friends — all `generic` exports.

## 6.3 Searching **[Implemented]**

`find(x, xs) : Option<Int>` and `findSlice(needle, s) : Option<Int>` return
positions; `ListX.findBy`, `containsBy`, `indexOfBy` take predicates.

## 6.4 List comprehensions **[Implemented]**

```pfun
let pairs = [Pair { x, y } for x <- xs for y <- ys where x < y];
```

One or more `for name <- listExpr` clauses, an optional trailing `where`
guard. Comprehension bodies and guards are pure contexts even inside procs.

## 6.5 Lazy lists **[Partial]**

`lazy` before a list literal or comprehension requests lazy production:

```pfun
let naturals = lazy [n for n <- range(0, 1000000000)];
let firstTen = take(10, naturals);
```

The logical type is still `List<T>`. Rules:

- `lazy` is not a general expression modifier — list forms only.
- Lazy comprehension bodies and guards are pure contexts *always*, because
  their evaluation time is unpredictable.
- Operations divide into PREFIX class (force a bounded prefix: `take`, list
  patterns, `head`) and FULL class (force everything: `length`, `reduce`,
  `reverse`). FULL-forcing an infinite list is an engineering fault, not a
  type error (chapter 18).

**[Partial** — parsed and purity-checked; the thunked runtime representation
and PREFIX/FULL classification are Phase 15 host work. Until then `lazy`
lists evaluate strictly.**]**

# 7. Records and the Pair type

## 7.1 Declaring and constructing records **[Implemented]**

```pfun
type Span = { start, end };
type Indexed = { index, generic value };

let s = Span { start = p1, end = p2 };      // all-named
let t = Span { p1, p2 };                    // all-positional, declaration order
```

Construction is all-named or all-positional — never mixed. Records are
nominal: two declarations with identical fields are distinct types. Field
access is `r.start`. There is no record-update syntax; functional update is
reconstruction:

```pfun
function withEnd(s, p) { Span { start = s.start, end = p } }
```

House style: modules export `mk*` constructor functions (`mkSpan(start,
end)`) rather than expecting importers to construct records by name — see
§10.6 for why this is currently load-bearing.

## 7.2 The builtin `Pair` **[Implemented]**

`Pair { key, value }` — both fields generic — is the runtime's fold and
uncons cell and the workhorse for returning two values:

```pfun
let both = Pair { lo, hi };
let span = both.value - both.key;
```

# 8. Unions, Option, and Result

## 8.1 Declaring unions **[Implemented]**

```pfun
type Shape = {
	| Circle: radius
	| Rect: w, h
	| Point
}
```

Variants may carry named payload fields (optionally `generic`, §2.4) or be
nullary. A nullary variant's bare name is a value:

```pfun
let origin = Point;
```

## 8.2 Constructing variants **[Implemented]**

Payload variants construct like records — all-named or all-positional:

```pfun
let c = Circle { radius = 2 };
let r = Rect { 3, 4 };
```

A constructed variant is statically known to *be* that variant: `c.radius`
type-checks directly, and passing `c` where a `Shape` is expected widens it
to the union (§9.4 explains the model).

## 8.3 Combined unions and unified errors **[Implemented]**

A union may include the variants of one or more other unions:

```pfun
type FileError = {
	| FileMissing: message, code
	| FileDenied: message, code
}

type DecodeError = {
	| InvalidData: message, code
}

type AppError = {
	...FileError
	...DecodeError
	| InvalidConfig: message, code
}
```

The original unions keep their identities and constructors. Inclusion adds a
safe widening conversion: a `FileError` or `DecodeError` may flow wherever an
`AppError` is required, but an arbitrary `AppError` may not flow back to either
component union. Inclusion may be transitive.

Branch and collection inference finds the smallest combined union that contains
all produced component variants. This works through generic containers, so
branches returning `Result<Value, FileError>` and `Result<Value, DecodeError>`
join as `Result<Value, AppError>`. If two unrelated combined unions are equally
good candidates, inference reports the ambiguity instead of selecting one by
declaration order.

Matching an `AppError` is exhaustive over the flattened set: every included and
locally declared variant needs an unguarded arm. A field is directly available
on the combined value only when every flattened variant has that field with a
compatible type. In the example, `failure.message` and `failure.code` are safe
without first matching the variant.

Includes are written inside the union body as `...UnionName`; a trailing comma
is optional. The checker rejects unknown or non-union includes, duplicate
includes or variants, and inclusion cycles.

## 8.4 `Option` and `Result` **[Implemented]**

Builtin, ambient, and the backbone of totality:

```pfun
type Option = { | None | Some: generic value };
type Result = { | Ok: generic value | Err: generic error };
```

`Option` is for absence; `Result` is for failure with information. Every
partial read in the language returns `Option` (chapter 18); every host
boundary that can fail returns `Result` or a domain union like the file
module's `ReadResult` (chapter 15). The OptionX/ResultX libraries (chapter
21) supply `withDefault`, `mapOption`, `andThenResult`, `collect`, and
friends.

For linear transformations, `|?>` and `|!>` provide the same map/flat-map
behavior inline while preserving `None`/`Err`; see §3.7. Result pipelines also
join differing domain-error unions as the chain crosses fallible stages.

There is exactly one `Result` declaration, owned by the ambient core module.
Compiler packages, standard-library modules, and applications all reuse it;
they do not redeclare `FileResult`, `ParseResult`, or package-local `Ok`/`Err`
constructors merely to avoid collisions. Put a domain-specific union in the
error slot instead:

```pfun
type LoadError = {
	| MissingSource: message
	| InvalidSource: message
}

function load(kind) {
	if kind == 0 then { Ok { "source" } }
	else { Err { MissingSource { "not found" } } }
}
```

A genuinely different outcome shape may still have its own union. Its
constructors must be distinct: streaming file reads use
`ReadOk`/`ReadEof`/`ReadErr`, because clean end-of-file is a third state rather
than an ordinary failure.

## 8.5 Variant names are program-global **[Implemented — current model]**

In the current model every variant name lives in one program-wide namespace:
two unions in one program may not both declare a variant `Ok` and expect
them to stay distinct — the later registration wins. The standard sources
work within this by giving `Result` sole ownership of `Ok`/`Err` and giving
the three-state `ReadResult` distinct `ReadOk`/`ReadEof`/`ReadErr`
constructors. Unrelated unions likewise pick distinct names, e.g. `TokInt` vs
`TInt`. A module-scoped variant model is future work; until then, treat
variant names like exported names and prefix where collision is plausible.

# 9. Pattern matching

## 9.1 Syntax **[Implemented]**

```pfun
match shape with
| Circle c where c.radius > 0 -> area(c)
| Circle _ -> 0
| Rect r -> r.w * r.h
| Point -> 0;
```

A match is an expression. Arms are tried in order; the first arm whose
pattern matches *and* whose `where` guard (if any) is true produces the
value. Patterns are one of:

- `_` — wildcard, matches anything, binds nothing.
- `VariantName` — matches that variant; a nullary variant needs nothing
  more, and a payload variant matched this way simply ignores its payload.
- `VariantName binder` — matches the variant and binds the **whole variant
  value** to `binder`.
- `VariantName _` — matches the variant, ignores it.
- A list pattern (§9.3).

Patterns do not nest, and there are no literal patterns; guards cover those
cases (`| Some s where s.value == 0 -> ...`).

## 9.2 Binders bind the variant, payloads are fields **[Implemented]**

A binder receives the entire matched variant value, statically typed as
*that variant*. Payload access is field access on the binder:

```pfun
match uncons(xs) with
| Some cell -> cell.value      // Some's payload field
| None -> fallback;
```

Because the binder's type is the specific variant, accessing a sibling's
field is a compile-time error (`b.radius` where `b` matched `Rect` fails).
When the binder flows onward — into a call, a list, a merged branch — it
widens to the union automatically. The rule of thumb: **payload access
happens where you matched**; after the value travels, it is the union again.

## 9.3 List patterns **[Implemented]**

`match` decomposes lists directly, and this is the canonical total
decomposition:

```pfun
match xs with
| [] -> 0
| [x] -> x
| [x, _, ...rest] -> x + length(rest);
```

Rules: elements are binders or wildcards only; `...rest` only in tail
position and only after at least one element (a bare `[...rest]` is not a
pattern — bind the subject instead). Matching a lazy list forces at most
(explicit elements + 1) cells, so list patterns are total on infinite lists.

## 9.4 Exhaustiveness **[Implemented]**

The checker requires every match to be provably complete:

- **Union subjects**: every variant needs coverage. `_` covers everything
  remaining. A lone lowercase name is *not* a binding catch-all on a union
  subject — it is an unknown-variant error; bind the subject before the
  match if you need the whole value.
- **List subjects**: coverage is a length algebra — exact patterns cover one
  length, rest patterns cover a ray, and every length from 0 up must be
  covered. The diagnostic reports the smallest missing length.
- **Other/unknown subjects**: an unguarded wildcard or binding arm is
  required.
- **The guard rule**: guarded arms count for nothing. Every variant and
  every length needs *unguarded* coverage. Guards keep their power; the
  guarantee keeps its teeth.

Consequently match failure is statically unreachable; the emitted
`matchFail` is an internal assertion whose firing means a compiler bug, not
a program error.

A nested match on a variant binder must still cover the binder's full union
— the checker does not yet narrow a binder's coverage domain to its known
variant. **[Partial** — narrowing is a noted future refinement**]**

# 10. Modules, imports, and interfaces

## 10.1 Exporting **[Implemented]**

```pfun
export function render(doc) { ... }
export generic function mapOption(f, o) { ... }
export proc flush() { ... }
export type Token = { ... }
export opaque type Handle = { ... }
export let defaultWidth = 80;
```

Not exportable, by design: `extern` declarations (wrap them in a Pfun
function or proc) and `var` bindings (module mutable state is private —
expose readers and updaters).

## 10.2 Importing **[Implemented]**

```pfun
import { render, mkDoc as newDoc } from "./doc";
import * as StrX from "../data/strx";
import * from "io";
```

Three forms: named (with optional `as`), namespace, and star. Star-importing
into a flat scope collides with any name already bound — prefer namespace
imports for anything nontrivial.

## 10.3 Resolution **[Implemented]**

Paths resolve in order: relative to the importing file (`./`, `../`); the
library root `$PFUN_HOME/lib`; and the builtin module names (`io`, `file`,
`json`, `async`, `timer`, `math`). A missing `.pf` extension is appended. The core
builtin surface (chapter 19) is ambient — never imported.

## 10.4 Interfaces and checking order **[Implemented]**

Modules are checked once, in dependency order. A checked module freezes into
an interface — its exported names, types, and unions — and importers check
against that frozen data. This is why exports must be ground (§2.6): open
types would make checking graph-order dependent. If a module fails, its
dependents are skipped with a diagnostic naming the failed dependency rather
than a cascade of confusing errors.

## 10.5 `extern` — native interop **[Implemented syntax, Partial pipeline]**

```pfun
extern function parseJson(s: Str) -> Any
extern proc writeSocket(h: Handle, data: Str) -> Result
```

Extern declarations are the only annotated signatures in the language, and
they are **private** to the declaring module: raw host values never become
part of an ordinary Pfun API. Export a Pfun wrapper that normalizes the
result into real types. Extern procs may be `async`. Browser-safe targets
replace Node-only extern access with a deterministic runtime diagnostic.

## 10.6 Current interface limitations **[Partial]**

Interfaces carry exported values, type names, and **union declarations** —
imported unions are fully constructible and matchable. They do not yet carry
**record shapes**: a record constructed by name across a module boundary is
unknown to the importer's checker. The `mk*` constructor-function convention
(§7.1) covers this today; record-carrying interfaces are on the roadmap.

---

# Part II — The Procedural Shell

# 11. Procedures

## 11.1 Declaring and calling procs **[Implemented]**

```pfun
proc main() {
	let cfg = loadConfig();       // calling another proc
	println(render(cfg));         // calling a pure function
}
main();
```

A proc may print, mutate, call procs and functions, and `await` (if
`async`). The top level of a program is a proc context: statements run in
order, and the conventional entry is a `main()` proc invoked at the bottom
of the entry file.

Named procs and proc lambdas are ordinary `TProc` values. They may flow through
pure code and data structures. Calling one directly or through `|>` is legal
only in top-level or proc context; a call from `function` or `fn` produces a
purity diagnostic.

## 11.2 Return **[Implemented]**

`return;` and `return expr;` exit a proc early; the final statement's value
is otherwise the result, exactly as in functions.

## 11.3 `generic proc` **[Implemented]**

Generalizes a named proc's *signature* the way `generic function` generalizes a
function's. Proc lambdas are deliberately monomorphic. Generic named procs are
needed for library procedures whose parameters are instantiated per
application (chapter 17).

# 12. Mutable bindings and assignment

## 12.1 `var` vs `let` **[Implemented]**

`let` is an immutable binding, legal everywhere. `var` is a mutable binding,
legal only in proc bodies and at the top level:

```pfun
proc count(xs) {
	var n = 0;
	var rest = xs;
	while (!isEmpty(rest)) {
		n = n + 1;
		rest = drop(1, rest);
	}
	n;
}
```

`var` cannot be exported; expose readers and updaters instead.

## 12.2 Assignment is a statement **[Implemented]**

`name = expr;` and `xs[i] = expr;` are statements, legal in proc context
only. Assignment is not an expression — `=` in expression position is a
syntax error, which also eliminates the `=`/`==` hazard in conditions.

# 13. Statement control flow

## 13.1 `if` statements **[Implemented]**

```pfun
if ready then {
	launch();
} else if retries < 3 then {
	requeue();
} else {
	abort();
}
```

Branches are blocks; `else if` chains freely; there is no dangling-else
ambiguity. In statement position the branch values are discarded and need
not agree in type. In trailing (value) position the same syntax is the
multi-line conditional expression (§3.6).

## 13.2 `while` loops **[Implemented]**

```pfun
while (hasNext(cursor)) {
	process(next(cursor));
}
```

Proc context only. The condition is parenthesized. Pure code iterates by
recursion (with self-tail-call optimization, §5.4) or by `reduce`.

## 13.3 Sequencing **[Implemented]**

Proc bodies run top to bottom, strictly. There is no `eval`/forcing
construct in V2 — strict evaluation removed the need for it.

# 14. Dictionaries, arrays, and buffers

Mutable collections live on the procedural side: constructing one is pure,
but every mutation is a proc-only operation.

## 14.1 Dictionaries **[Implemented syntax, Planned runtime]**

```pfun
let ages = dict { "ada" -> 36, "grace" -> 45 };
```

Keys require `Equatable` (float keys use the total order). Lookup `d[k]`
returns `Option`. Mutation (`dictPut`, `dictRemove`, ...) is proc-only.
**[Planned** — literal syntax and typing exist; the host dict intrinsics and
the proc-only mutation surface are Phase 15 work**]**

## 14.2 Arrays **[Implemented syntax, Planned runtime]**

```pfun
let buf = array { 0, 0, 0 };
```

Fixed-element mutable storage with total accessors: `arrGet : Array<A>, Int
-> Option<A>`; `arrSet : Array<A>, Int, A -> Bool` (false on out-of-range).
Reads *and* writes are proc-only. **[Planned** — as dictionaries**]**

## 14.3 Buffers **[Planned]**

Growable byte and string builders for I/O-adjacent code, provided by the
host floor with a proc-only API. Specified in the host ABI phase.

# 15. Console and file I/O

## 15.1 `io` — console **[Implemented]**

```pfun
import * from "io";

proc main() {
	match println("name?") with
	| Err failure -> {
		nativeErrorMessage(failure.message);
		{}
	}
	| Ok _ -> {}

	match scanln() with
	| Err failure -> println(
		"input error: " ++ nativeErrorMessage(failure.message)
	)
	| Ok input -> match input.value with
		| Some line -> println("hello, " ++ line.value)
		| None -> println("eof");
}
```

`println`/`print`/`eprintln`/`eprint` and `flushStdout` return
`Result<Unit, NativeError>`. `scanln` returns
`Result<Option<Str>, NativeError>` and `scanChar` returns
`Result<Option<Char>, NativeError>`: `Ok(None)` means clean end of input, while
`Err(NativeIoError)` means the read failed. `scriptArgs()` returns the argument list;
`getEnv(name)` returns `Option<Str>`; `exit(code)` terminates.

## 15.2 `file` — files **[Implemented core, Partial surface]**

```pfun
import * from "file";

proc load(path) {
	match readFile(path) with
	| Ok r -> parse(r.value)
	| Err e -> fail(nativeErrorMessage(e.message));
}
```

Convenience functions (`readFile`, `writeFile`, `fileExists`, `mkdirP`)
return the ambient `Result<T, NativeError>`; notably, `fileExists` returns
`Ok { true }`, `Ok { false }`, or an `Err` for a real native failure. The file
module's three-state `ReadResult<T, NativeError>` uses `ReadOk`, `ReadEof`, and
`ReadErr` for streaming reads. Handle-based streaming
(`fileOpen`/`fileClose` plus read/write/seek over handles) and binary buffer I/O
are specified but thin today. **[Partial** — the convenience surface drives
the bootstrap compiler itself; the handle/binary surface is Phase 15**]**

`NativeError` is an ambient union with `NativeIoError`,
`NativeProcessError`, `NativeTimerError`, `NativeBufferError`,
`NativeJsonError`, `NativeNumericError`, and `NativePlatformError` variants.
Every variant carries `operation` and `message` fields. Use an exhaustive match
when the category matters, or the ambient `nativeErrorOperation(error)` and
`nativeErrorMessage(error)` accessors for category-independent reporting.

# 16. Asynchronous procedures

## 16.1 `async` and `await` **[Implemented]**

```pfun
async proc fetchBoth(a, b) {
	let x = await httpGet(a);
	let y = await httpGet(b);
	Pair { x, y };
}
```

Only procs can be async; `await` is legal only inside `async proc` bodies.
`TFun` has no async form — asynchrony, like every other effect, cannot leak
into the pure core.

## 16.2 Fire-and-forget **[Implemented semantics]**

Calling an `async proc` *without* `await` from proc context is legal and
means fire-and-forget: the callee starts, control continues immediately.
Dispatchers rely on this so slow effects never block an event loop.

The `async` builtin module provides `sleep(ms)`, which completes with
`Result<Unit, NativeError>` after a non-negative duration of at most
`2147483647` milliseconds. Invalid durations and scheduler failures resolve as
`NativeTimerError`; they do not reject the awaited operation.

## 16.3 Cancellable one-shot timers **[Implemented]**

```pfun
import * from "async";
import * from "io";
import * from "timer";

async proc demonstrateTimers() {
	let scheduled = setTimer(100, proc () -> Unit {
		println("will not run");
	});
	match scheduled with
	| Err failure -> println(nativeErrorMessage(failure.message))
	| Ok timer -> {
		match clearTimer(timer.value) with
		| Ok _ -> println("canceled")
		| Err failure -> println(nativeErrorMessage(failure.message));
	};
}
```

`setTimer(ms, action)` accepts `proc() -> Unit`; `setAsyncTimer(ms, action)`
accepts `async proc() -> Unit`. Keeping the two entry points distinct preserves
the language's sync/async proc type distinction. Each returns
`Result<TimerHandle, NativeError>`. `clearTimer(handle)` returns
`Result<Unit, NativeError>`, prevents a pending callback, and is an idempotent
`Ok` after the handle has already been cleared or fired. Timer durations use
the same bounds as `sleep`; failures use `NativeTimerError`.

The scheduling `Result` covers validation and host scheduling. A callback runs
later, after that result already exists. Unexpected callback throws and async
rejections are contained by the host, while an observable callback-completion
channel remains a separate future API.

Scheduling and cancellation are effects and therefore require top-level or
proc context. Pure code may still construct, store, and transport the callback
proc value. Timers are one-shot; repeating application subscriptions remain
better represented as descriptor data with exhaustive dispatch.

# 17. Effects as data: descriptors and dispatch

Descriptors remain the preferred way for pure code to *request* effects as
data. First-class proc values serve a different role: callbacks, handlers,
timers, and routing tables whose eventual invocation occurs in proc context.

## 17.1 The descriptor union **[Implemented language support]**

Pure code describes effects as values. A descriptor union pairs each effect
with a pure continuation that converts the effect's result into a message:

```pfun
type Cmd = {
	| CNone
	| CBatch: cmds
	| CHttpGet: url, generic toMsg     // toMsg : Str -> Msg, pure
	| CDelay: ms, generic msg
}
```

Pure `update` logic returns `Cmd` values; it never performs anything.

## 17.2 The dispatcher **[Implemented language support]**

One proc per application executes descriptors with an exhaustive match:

```pfun
proc dispatch(cmd) {
	match cmd with
	| CNone -> unit()
	| CBatch b -> dispatchAll(b.cmds)
	| CHttpGet g -> httpGetInto(g.url, g.toMsg)
	| CDelay d -> delayInto(d.ms, d.msg);
}
```

The exhaustiveness checker guarantees **no effect goes unhandled** — adding
a `Cmd` variant breaks the build until every dispatcher handles it. The same
shared-union technique gives compile-time-total client/server contracts:
one union describes the wire protocol; both sides must match it
exhaustively.

## 17.3 TEA — The Elm Architecture target **[Planned]**

The browser target packages this pattern: a pure `init`/`update`/`view`
triple over app-defined `Msg`, `Cmd`, and `Sub` unions, with one runtime
proc owning all mutation and DOM effects. `generic proc` (§11.3) is what
lets the library's `runCore` accept each application's own descriptor
instantiations. Specified in full (Phase 14b) with slot-defaulting support
in the type system (§2.6); not yet built.

---

# Part III — Guarantees and Libraries

# 18. Totality: why pure code cannot fail

Every runtime failure falls into exactly one of four classes; the first
three are the entire story for pure code.

1. **Static** — rejected by the checker: exhaustiveness (with the guard
   rule), `Equatable`/`Comparable`, purity, groundedness, arity, opacity.
2. **Total by construction** — operations that could fail in V1 now cannot:
   - **IEEE floats with a total order.** No float operation raises; NaN and
     ±Inf are values; NaN participates coherently in equality, ordering,
     dict keys, and memo caches. `floatToInt : Float -> Option<Int>` is the
     loud exit from float-land. **[Partial — Phase 15 host]**
   - **`NonZero` divisors** for Int `/` and `%` (§2.1). **[Partial]**
   - **`Option`-returning reads**: `head`, `tail`, `nth`, `xs[i]`, `d[k]`,
     `chr`. **[Partial — several manifest entries still total-typed]**
   - **List patterns** as the canonical total decomposition (§9.3).
     **[Implemented]**
   - **Byte arithmetic wraps** modulo 256. **[Partial — Phase 15]**
3. **Boundary Results** — host failures (file, HTTP, DB, decode) surface as
   `Result`/`Option` from procs. Exceptions are trapped inside extern
   wrappers and never escape as exceptions. **[Implemented pattern]**
4. **Engineering faults** — non-termination, stack exhaustion, out-of-memory,
   FULL-forcing an infinite lazy list, wrong-platform intrinsics. No totality
   story covers resources; the `RuntimeD` diagnostic class describes only
   this class.

The practical consequence: a pure function that type-checks either returns a
value or loops — there is no third outcome to defend against, which is what
makes `memo`, tail-call elimination, and effect-free reasoning sound.

# 19. Core builtins reference

The core surface is **ambient** — always in scope, never imported. Types
below are the V2 contract; **[Partial]** rows note where the current
manifest still carries a V1-style total signature.

| Function | Type | Status |
|---|---|---|
| `str(x)`, `__str__(x)` | `a -> Str` | Implemented |
| `length(x)` | `Str or List -> Int` | Implemented |
| `reverse(xs)` | `List<a> -> List<a>` | Implemented |
| `cons(x, xs)` | `a, List<a> -> List<a>` | Implemented |
| `head(xs)` | `List<a> -> Option<a>` | Planned |
| `tail(xs)` | `List<a> -> Option<List<a>>` | Planned |
| `nth(xs, i)` | `List<a>, Int -> Option<a>` | Partial — currently total `-> a` |
| `getOr(o, d)` | `Option<a>, a -> a` | Planned |
| `slice(start, count, s)` | over `Str`/`List` | Implemented |
| `take(n, xs)` | `Int, List<a> -> List<a>` | Implemented |
| `range(lo, hi)` | `Int, Int -> List<Int>` | Implemented |
| `map(f, xs)` | `(a -> b), List<a> -> List<b>` | Implemented |
| `filter(p, xs)` | `(a -> Bool), List<a> -> List<a>` | Implemented |
| `reduce(f, init, xs)` | `(a, b -> a), a, List<b> -> a` | Implemented |
| `find(x, xs)` | `-> Option<Int>` | Implemented |
| `findSlice(needle, s)` | `-> Option<Int>` | Implemented |
| `split(s, sep)` / `join(xs, sep)` | `Str` family | Implemented |
| `asc(c)` | `Char -> Int` | Implemented |
| `chr(n)` | `Int -> Option<Char>` | Partial — currently total `-> Char` |
| `charBytes(c)` / `bytesToChar(bs)` | UTF-8 boundary | Implemented |
| `floor` / `ceil` / `round` | `Float -> Int` | Implemented |
| `isNaN` / `isFinite` | `Float -> Bool` | Implemented |
| `floatToInt(f)` | `Float -> Option<Int>` | Planned |
| `nonZero(n)` | `Int -> Option<NonZero>` | Implemented |
| `safeDiv` / `safeMod` | `Int, Int -> Option<Int>` | Implemented |
| `append` / `concat` | list joining | Planned ambient; today via ListX |
| `sort(xs)` | `List<Comparable> -> List<...>` | Planned |

"Implemented" here means present in the builtin manifest with the stated
type and wired through checking; host intrinsic completeness is Phase 15.

# 20. Builtin modules

Imported by bare name. Present in the manifest today:

- **`io`** — Result-returning `println`, `print`, `eprintln`, `eprint`, and
  `flushStdout`; `scanln : -> Result<Option<Str>, NativeError>` and
  `scanChar : -> Result<Option<Char>, NativeError>`; `scriptArgs`,
  `getEnv : -> Option<Str>`, and `exit`. **[Implemented]**
- **`file`** — `readFile`/`writeFile`/`fileExists`/`mkdirP` returning
  `Result<_, NativeError>`; `fileOpen`/`fileClose` handles. **[Partial** —
  handle read/write/seek and binary buffers are Phase 15**]**
- **`json`** — `jsonSerialize : a -> Option<Str>`,
  `jsonDeserialize : Str -> Option<a>`. **[Implemented surface]**
- **`async`** — `sleep(ms)` returning
  `Result<Unit, NativeError>` (async proc). **[Implemented]**
- **`timer`** — `setTimer`, `setAsyncTimer`, and idempotent `clearTimer`, using
  opaque `TimerHandle` values inside `Result`. **[Implemented]**
- **`math`** — `pi`/`e`/`tau` (nullary), `sqrt`, `pow` (Float); `abs`,
  `min`, `max` (Int). **[Implemented surface]**

Planned builtin modules, carrying the V1 surface forward behind the same
private-extern discipline: **`http`** (server routes + client fetch),
**`db`** adapters (`dblibPostgresql`, `dblibMariadb`), and the
browser DOM/mount floor for TEA. **[Planned]**

# 21. The Pfun standard library

Ordinary Pfun code in `$PFUN_HOME/lib`, imported by path. Ported and passing
today (all-`generic` polymorphic exports, Str-only `++`, iterative
implementations):

- **`data/listx`** — `append`, `concat`, `foldLeft`, `countWhere`, `any`,
  `all`, `zip`, `sortBy`, `splitAt`, `takeL`, `intersperse`,
  `mapWithIndex`, `filterMap`, `findBy`, `containsBy`, `indexOfBy`. **[Implemented]**
- **`data/strx`** — trimming, padding, repeat, case-insensitive search,
  `commaList`, `joinLines`, quoting. **[Implemented]**
- **`data/optionx`** / **`data/resultx`** — `withDefault`, `mapOption`,
  `andThenOption`, `orElseOption`, `fromBool`, `optionToList`; `mapResult`,
  `mapErr`, `andThenResult`, `collect`, `combine`, `toOption`,
  `fromOption`. **[Implemented]**

The larger V1 library is the porting backlog, in rough dependency order:
`datelib`, `toml`, `random`, `crypto`, `compress`, `locale`, `htmllib`,
`htmlparse`, `viewlib`, `theme`, `serverDispatch`, `dataModelGen`,
`dbschema`, and `tea` (which lands with the Phase 14b browser target).
Each port is also a language shakedown: the V1 sources predate `++`-only
concatenation, Option-returning reads, and explicit `generic`, so porting
doubles as conformance testing. **[Planned]**

---

# Part IV — The Toolchain

# 22. The compiler pipeline

One pure pipeline serves every command and target:

```text
source files
  -> loader (lex, parse, import extraction; disk or in-memory)   [Implemented]
  -> module graph + topological order                            [Implemented]
  -> checkGraph: types, purity, exhaustiveness, interfaces       [Implemented]
  -> emit: type-directed JavaScript AST per module               [Implemented]
  -> link: target assembly                                       [Implemented]
```

Design properties worth knowing as a user:

- **All-or-nothing**: any diagnostic anywhere stops emission. A failed
  module's dependents are skipped with one clear diagnostic each.
- **Type-directed emission**: the checker's types select integer/float/
  structural equality, comparison strategies, and numeric intrinsics at
  compile time. There is no runtime type registry.
- **Targets** (`link`): `NodeBundle` (single `.js` with embedded host)
  **[Implemented]**; `NodeFiles` (CommonJS file set) **[Implemented in
  linker, no driver]**; `BrowserBundle` with page shells for bare pages,
  server apps, TEA, and the playground **[Planned drivers]**.
- **Self-tail-call optimization** in the emitter (§5.4) **[Partial]**.

# 23. Command line

Today's driver is the minimal self-hosting build command:

```text
pfc build <entry.pf> [-o <output.js>]        [Implemented]
```

It loads the graph from disk (resolving `$PFUN_HOME/lib` and builtin
names), runs the full pipeline, embeds the Node host, and writes one
runnable bundle. Exit status is 0 on success, 1 with diagnostics on
failure.

Planned commands, all thin drivers over the same pipeline:

```text
pfun check <entry.pf>          type/purity/exhaustiveness only   [Planned]
pfun run <entry.pf> [args]     build to temp and execute          [Planned]
pfun serve <app.pf>            full-stack server target           [Planned]
pfun playground                browser-hosted compiler sandbox    [Planned]
```

# 24. Diagnostics

Every diagnostic carries a severity, a class, a message, a path, and a span.
The rendered format:

```text
path.pf:line:col: error[Type]: message
```

Classes: `Lex`, `Parse`, `Name`, `Type`, `Exhaust`, `Purity`, `Import`,
`Arity`, and `Runtime` — the last describing only engineering faults and
boundary failures; no pure-language operation produces one. Messages state
remedies where one exists ("add a constraining use, or declare it
generic"). Source-line excerpts with caret underlining are specified for
the renderer. **[Partial** — format and classes implemented; caret
excerpts planned**]**

# 25. Build roadmap

Everything marked **[Partial]** or **[Planned]** above, collected in
build order. This list is the manual's reason to exist ahead of the
implementation.

**Language semantics to finish wiring**

1. Option-returning reads: `head`, `tail`, `getOr` into the manifest;
   `nth`, `chr`, indexing flipped to `Option`; emitter/host support.
2. `NonZero` enforcement: literal divisor coercion, `/`/`%` divisor rule.
3. Match-arm self-tail-calls in the emitter (unblocks deep recursion in
   compiled compiler code).
4. Slot defaulting to `Unit` for unconstructed variant payloads (T2).
5. Dead-private-binding warnings (`WarnSev` analysis).
6. Nested-match narrowing for variant binders (refinement, not blocker).
7. Record shapes in module interfaces (retire the `mk*`-only convention).

**Host runtime (Phase 15)**

8. Full `$`-ABI: numeric intrinsics, structural equality/order, string/list
   performance primitives.
9. Lazy list representation with PREFIX/FULL forcing classes.
10. Dict/array/buffer intrinsics with proc-only mutation surface.
11. Memo caches; async scheduler; byte wrapping; float total-order ops.

**Toolchain (Phases 16–17)**

12. `pfun check`, `pfun run` drivers.
13. `NodeFiles` and browser targets in drivers; `pfun serve`.
14. Diagnostic caret excerpts.
15. Playground: in-memory loader is done; sandbox messaging and UI remain.

**Libraries and applications**

16. `http` and `db` builtin modules behind private externs (`timer` is done).
17. Stdlib porting backlog (§21), each port doubling as conformance tests.
18. TEA (Phase 14b): `tea.pf`, DOM floor, `Cmd`/`Sub` runtime.

**The milestone behind all of it**

19. Stage-2: `pfc` compiling itself, then the differential harness — stage-1
    and stage-2 outputs byte-identical, V1 retired.
