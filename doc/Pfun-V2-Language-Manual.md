# The Pfun Programming Language V2

## Language Manual and Reference

**Design reconciliation:** July 30, 2026  
**Audited implementation baseline:** `2caf48874c670a39bc998ea843266df6c1907ec8`

Pfun—short for **Procedural-FUNctional**—is a statically checked,
compiled language with a strict pure functional core and an explicit
procedural shell. Pure functions describe values and transformations.
Procedures own mutation, asynchronous work, I/O, and interaction with the
outside world. The compiler enforces the boundary.

This manual describes the intended completed V2 language. It is
future-facing: it states the language users should ultimately program
against, including whole-program field inference, executable invariants and
contracts, explicit lazy lists, unified `Result` errors, first-class proc
values, and the Node, browser, HTTP, and database surfaces.

It is not an implementation-status ledger. The separate V2 completion
specification records what has and has not yet shipped.

Some exact public names remain design-closure decisions. Those few places
are marked **Provisional surface**. The semantics around them are settled;
only their final spelling, module home, or precise handle shape remains to
be frozen.

---

## Contents

- [Introduction](#introduction)
- [Part I — The Functional Core](#part-i--the-functional-core)
  - [1. Source text and lexical structure](#1-source-text-and-lexical-structure)
  - [2. Evaluation, statements, and blocks](#2-evaluation-statements-and-blocks)
  - [3. Values and the type system](#3-values-and-the-type-system)
  - [4. Expressions and operators](#4-expressions-and-operators)
  - [5. Functions and callable values](#5-functions-and-callable-values)
  - [6. Records, unions, Option, and Result](#6-records-unions-option-and-result)
  - [7. Pattern matching](#7-pattern-matching)
  - [8. Lists and explicit laziness](#8-lists-and-explicit-laziness)
  - [9. Strings, characters, bytes, and numbers](#9-strings-characters-bytes-and-numbers)
- [Part II — The Procedural Shell](#part-ii--the-procedural-shell)
  - [10. Modules, exports, and native boundaries](#10-modules-exports-and-native-boundaries)
  - [11. Procedures, mutation, and asynchronous work](#11-procedures-mutation-and-asynchronous-work)
  - [12. Absence, expected failure, and invariant defects](#12-absence-expected-failure-and-invariant-defects)
  - [13. Executable contracts and validated data](#13-executable-contracts-and-validated-data)
  - [14. Resource safety and mutable facilities](#14-resource-safety-and-mutable-facilities)
  - [15. Effects as data and application architecture](#15-effects-as-data-and-application-architecture)
- [Part III — Libraries and Platforms](#part-iii--libraries-and-platforms)
  - [16. Ambient core reference](#16-ambient-core-reference)
  - [17. Standard Pfun modules](#17-standard-pfun-modules)
  - [18. Platform modules](#18-platform-modules)
  - [19. Browser applications and TEA](#19-browser-applications-and-tea)
- [Part IV — Toolchain and Guarantees](#part-iv--toolchain-and-guarantees)
  - [20. Compilation model and command line](#20-compilation-model-and-command-line)
  - [21. Diagnostics, manifests, and invariant reports](#21-diagnostics-manifests-and-invariant-reports)
  - [22. Portability and host conformance](#22-portability-and-host-conformance)
- [Appendix A — V2 grammar](#appendix-a--v2-grammar)
- [Appendix B — Quick reference tables](#appendix-b--quick-reference-tables)
- [Appendix C — Changes from V1](#appendix-c--changes-from-v1)
- [Appendix D — Deliberate non-goals and later work](#appendix-d--deliberate-non-goals-and-later-work)

---

# Introduction

## What Pfun is

A Pfun program has two deliberately different regions:

| Region | Main declarations | Capabilities |
|---|---|---|
| Functional core | `function`, `fn`, immutable values | Pure computation only |
| Procedural shell | `proc`, `async proc`, top level | I/O, mutation, callbacks, waiting, resources |

The split is semantic, not stylistic. A pure function cannot print, mutate,
wait, call a proc, or catch an invariant defect. A proc may call pure
functions and other procs.

The intended application shape is:

1. Decode or acquire data at a procedural boundary.
2. Convert it into ordinary Pfun values.
3. Perform most program logic with pure functions.
4. Represent expected negative outcomes with `Option` or `Result`.
5. Return to procedures only to perform effects or manage resources.

This makes ordinary application logic easy to reason about without turning
Pfun into a purely academic language. Files, servers, databases, timers,
mutable buffers, browser events, and callbacks remain available; they simply
live on the side of the language where their consequences are explicit.

## Compiled-only execution

V2 has one language pipeline:

```text
load -> lex -> parse -> graph -> check -> emit -> link
```

The same checker serves checking, building, running, Node targets, browser
targets, server programs, and the browser playground. V2 has no interpreter
and no REPL in its core architecture. Running a source program means compiling
it and executing the compiled artifact.

## Strict evaluation with local list laziness

Pfun is strict:

- a `let` initializer runs once when the binding is reached;
- call arguments run once, left to right, before the call;
- list elements and record fields run once in source order;
- ordinary bindings are never hidden thunks.

Only explicitly lazy list production defers work. Lazy cells are memoized
after they are forced. Strict and lazy lists share the same logical
`List<T>` type; laziness is a representation mode, not a second collection
type. There is no general `eval` or force expression.

## Annotation-light static typing

Ordinary Pfun code does not spell parameter, local, result, or normal-field
types. The compiler infers them. Explicit type expressions appear only where
the source genuinely needs a declared boundary:

- private `extern` declarations;
- proc-lambda parameters and results;
- type expressions in compiler- or host-facing declarations.

Pfun is monomorphic by default. `generic function`, `generic proc`, and a
`generic` record or variant field opt into distinct forms of polymorphism.

## Four ways a computation can fail to continue

Pfun distinguishes four categories:

| Category | Meaning | Representation |
|---|---|---|
| Static rejection | The source is ill-typed, impure, inaccessible, non-exhaustive, or unsupported | Compiler diagnostic |
| Expected absence or failure | The program and state are valid, but an operation has an ordinary negative outcome | `Option` or `Result` |
| Invariant defect | The program reached a state declared impossible | `InvariantViolation` abandonment |
| Host catastrophe | Runtime/compiler defect, corrupt ABI, resource exhaustion, or unrecoverable initialization failure | System handler or host termination |

A pure function may return, diverge, or abandon through an invariant defect.
It cannot catch that defect or convert it into ordinary data.

## A first example

```pfun
import * from "io";
import { parseInt, trim } from "string";

type ParseError = {
	| EmptyInput: message
	| InvalidNumber: message
}

function parsePositive(text) {
	let cleaned = trim(text);

	if length(cleaned) == 0 then {
		Err { EmptyInput { "a number is required" } }
	} else {
		match parseInt(cleaned) with
		| None -> Err { InvalidNumber { "not an integer" } }
		| Some parsed -> {
			if parsed.value > 0 then {
				Ok { parsed.value }
			} else {
				Err { InvalidNumber { "expected a positive number" } }
			}
		};
	}
}

proc main() {
	match scanln() with
	| Err failure ->
		eprintln(nativeErrorMessage(failure.message))
	| Ok input -> {
		match input.value with
		| None -> println("end of input")
		| Some line -> {
			match parsePositive(line.value) with
			| Ok number -> println($"accepted {number.value}")
			| Err problem -> println(problem.message.message);
		}
	};
}

main();
```

The example keeps parsing pure, uses `Result` for a valid but unsuccessful
parse, uses `Option` for end-of-input, and performs console I/O only in a
proc.

---

# Part I — The Functional Core

# 1. Source text and lexical structure

## 1.1 Source files

Pfun source files conventionally use the `.pf` extension and UTF-8 text.
Source paths participate in module identity, diagnostics, and stable
whole-program field identity. Source offsets and columns follow UTF-16 code
units so compiler spans agree with the string-indexing model and generated
JavaScript tooling.

## 1.2 Comments and whitespace

```pfun
// A line comment runs to the newline.

/*
	A block comment may span lines.
	Block comments do not nest.
*/
```

Spaces, tabs, carriage returns, and newlines separate tokens. Outside literals,
whitespace otherwise has no semantic meaning.

## 1.3 Identifiers

An identifier begins with a letter or `_`, followed by letters, digits, or
underscores. A lone `_` is the wildcard in parameter and pattern positions.

Conventional naming:

- `lowerCamel` for values, functions, procs, and fields;
- `UpperCamel` for types and variants;
- short `UpperCamel` aliases for imported module namespaces.

## 1.4 Reserved and contextual words

The globally reserved words are:

```text
let var type generic if then else function proc memo async await return fn
for while dict array import export opaque as from match with where extern lazy
true false
```

The verification spellings are contextual, not globally reserved:

```text
invariant requires ensures handling invariants protect complete unwind
```

They remain legal field and binding names outside their clause positions.

## 1.5 Literals

| Kind | Examples | Notes |
|---|---|---|
| Integer | `42`, `0xFF` | Arbitrary precision |
| Float | `1.5`, `2e10`, `6.02e+23` | IEEE-754 double |
| Byte | `200b`, `0xAB_b` | Must be from 0 through 255 |
| Boolean | `true`, `false` | |
| Character | `'a'`, `'\n'` | Exactly one Unicode scalar value |
| String | `"hello\n"` | Escaped text |
| Raw string | `@"C:\path\file"` | No escapes |
| Format string | `$"x = {x}"` | Full expression inside braces |
| Empty block | `{}` | The `Unit` value |

Recognized escapes are:

```text
\n  \t  \\  \"  \'  \{  \}
```

Raw strings end at the next `"`. Format-string interpolation is brace- and
literal-aware; nested format strings inside an interpolation are rejected.

## 1.6 Tokenization

The lexer uses longest match. For example:

- `|?>` and `|!>` are recognized before `|>`;
- `++` is recognized before `+`;
- `=>`, `->`, and `<-` are distinct tokens;
- `<<` and `>>` are shift operators in expressions.

---

# 2. Evaluation, statements, and blocks

## 2.1 Strict, left-to-right evaluation

```pfun
let first = loadA();
let second = loadB(first);
let result = combine(first, second);
```

`loadA()` finishes before `loadB(first)` begins. In a call, the first argument
is evaluated before the second. Record fields, variant payloads, collection
elements, and named constructor arguments follow source order.

This order is part of the language. It is especially important for proc
lambdas, resource operations, contracts, and field predicates.

## 2.2 Statements and semicolons

These statements require a semicolon:

```pfun
let x = expression;
var y = expression;
y = expression;
array[index] = expression;
```

An expression statement may end with a semicolon. `return` accepts an optional
semicolon. Declarations and blocks do not take a semicolon after their closing
brace.

## 2.3 Blocks and block values

A block is a statement sequence:

```pfun
{
	let x = 10;
	x * 2
}
```

Its value is the value of its final expression or value-producing conditional.
If no value is produced, the result is `Unit`. The empty block `{}` is the
ordinary `Unit` value.

## 2.4 `let` and lexical scope

`let` creates an immutable lexical binding:

```pfun
let width = 10;
let area = width * height;
```

Bindings may shadow names from an outer scope. Each binding has its own
identity even when the displayed name is the same. This distinction matters
to contract fact analysis and captured closures.

## 2.5 Conditional expressions

An `if` with both branches may produce a value:

```pfun
let label = if count == 1 then {
	"item"
} else {
	"items"
};
```

Both branch values must unify. In statement position, branch values are
discarded and need not have the same type.

`else if` chains are allowed:

```pfun
if score >= 90 then {
	"A"
} else if score >= 80 then {
	"B"
} else {
	"C"
}
```

The ternary operator is the compact expression form:

```pfun
let label = count == 1 ? "item" : "items";
```

## 2.6 `while`

`while` is available only in proc context:

```pfun
while (hasWork(queue)) {
	process(nextWork(queue));
}
```

The condition is parenthesized. Pure code iterates with recursion or
higher-order list operations.

## 2.7 Assignment

Assignment is a statement, never an expression:

```pfun
count = count + 1;
```

This prevents accidental assignment in conditions and keeps mutation
syntactically visible.

---

# 3. Values and the type system

## 3.1 Scalar and core types

The core scalar types are:

| Type | Meaning |
|---|---|
| `Int` | Arbitrary-precision integer |
| `Float` | IEEE-754 double with Pfun total ordering |
| `Bool` | Boolean |
| `Str` | Immutable UTF-16-indexed Unicode text |
| `Char` | Exactly one Unicode scalar value |
| `Byte` | Integer from 0 through 255 with wrapping arithmetic |
| `Unit` | No meaningful value |
| `NonZero` | Opaque proof that an `Int` is nonzero |

Important composite types include:

```text
List<T>
Option<T>
Result<Value, Error>
Pair<Key, Value>
Array<T>
Dict<Key, Value>
proc(A, B) -> R
async proc(A, B) -> R
```

Records and discriminated unions introduce nominal application-specific types.

## 3.2 Nominal typing

Two declarations with the same fields are still different types:

```pfun
type ScreenPoint = { x, y }
type MapPoint = { x, y }
```

A `ScreenPoint` is not a `MapPoint`. The same nominal rule applies to unions
and opaque types.

## 3.3 Inference rather than annotations

Ordinary declarations omit type annotations:

```pfun
function area(width, height) {
	width * height
}
```

The operators and uses in the body constrain both parameters and the result.
The compiler reports an error when the evidence conflicts or remains
operationally unresolved.

Pfun does not use ordinary source annotations to patch ambiguous field
inference. Real program uses, declaration structure, and explicit generic
markers provide the evidence.

## 3.4 Monomorphic by default

A normal declaration is inferred once and has one type across the complete
program:

```pfun
function identity(value) {
	value
}

let a = identity(1);
let b = identity(2);
```

Both calls agree on `Int`. Calling the same monomorphic `identity` with a
`Str` in that program would conflict.

## 3.5 `generic function`

`generic function` explicitly generalizes a pure function:

```pfun
generic function identity(value) {
	value
}

let number = identity(1);
let text = identity("hello");
```

Each call instantiates the generalized signature independently. `generic`
does not disable inference. Body operations still impose constraints on every
instantiation.

```pfun
generic function incrementField(item) {
	item.count + 1
}
```

Every accepted instantiation must have a compatible `count` field, and that
field must be numeric in the required way.

## 3.6 Normal and generic fields

Normal and `generic` fields deliberately mean opposite things.

```pfun
type Token = {
	text,
	line
}

type Box = {
	generic value
}
```

- `Token.text` has one monomorphic type across the complete program.
- `Token.line` has one monomorphic type across the complete program.
- `Box.value` is a hidden type slot instantiated separately for each `Box`
  value.

Therefore these values are valid:

```pfun
let numberBox = Box { 42 };
let textBox = Box { "pfun" };
```

They have different instantiations of `Box`.

Each `generic` field introduces an independent hidden slot. A `generic` field
is not a dynamic field and never contains arbitrary unchecked values.

## 3.7 Whole-program normal-field inference

Every normal nominal field has one rigid identity across the complete imported
program. The complete program is:

- the transitive source-import closure of every requested entry or generated
  root;
- the builtin interfaces used by that closure;
- every checked body in every module in that closure.

It is not the call graph. Uncalled code in an imported module is still checked,
and dead-code elimination cannot alter type meaning.

For:

```pfun
export type Module = {
	path,
	stmts,
	nextId
}
```

construction, projection, pattern matching, operators, function flow,
containers, and executable predicates throughout the import closure all
contribute evidence to the same three field identities.

The consequences are:

- a field never changes type because a generic helper instantiated it twice;
- nested variables are rigid too: if `Container.items` becomes `List<a>`,
  later generic code cannot instantiate that same field once as `List<Str>`
  and once as `List<Int>`;
- evidence may live outside the declaring module;
- contradictory uses report the relevant declaration and use sites;
- unused “witness” code is never required to teach the compiler a field type;
- adding or removing an import may legitimately change the complete program's
  schema.

## 3.8 Operational groundedness

A type must be concrete enough for every operation the compiler has to emit.
Examples:

- arithmetic needs a selected numeric type;
- field access needs a real nominal shape;
- equality needs `Equatable`;
- comparison needs `Comparable`;
- overloaded builtins need one selected case;
- boundary encoders need a concrete schema.

A value may remain abstract only where its representation is irrelevant, such
as moving it from one polymorphic parameter to a result without inspecting it.

`Any`, `Unknown`, or a nested occurrence such as `List<Any>` never counts as
grounding evidence.

## 3.9 `Any` is not an ordinary user type

`Any` is not Pfun's dynamic escape hatch. It may exist only as a quarantined
token inside a private native boundary that immediately passes the value to a
typed decoder or wraps it in an opaque handle.

It may not:

- finalize a normal field;
- appear in an ordinary exported interface;
- discharge numeric, callable, field, indexing, equality, comparison, or
  encoding requirements;
- hide inside a generic slot and masquerade as a completed schema.

The language prefers removing `Any` entirely wherever opaque handles and typed
decoders can express the boundary.

## 3.10 Overloaded builtins

Some ambient operations have a small declared set of cases:

```text
length : List<a>    -> Int
length : Str        -> Int
length : Array<a>   -> Int
length : Dict<k,v>  -> Int

slice : Int, Int, List<a> -> List<a>
slice : Int, Int, Str     -> Str
```

The checker selects one real case. It does not approximate the operation with
`Any`. An unresolved or ambiguous case is a type error.

Overload cases also carry capability metadata. The `List` and `Str` cases are
pure. Observing the state of a mutable `Array` or `Dict` handle requires proc
context even though the selected result type is still `Int`.

The same principle applies to `find` and `findSlice`, including the
`Equatable` requirement on list elements.

## 3.11 `Equatable` and `Comparable`

`==` and `!=` require `Equatable`. A value is not equatable when a function or
proc value occurs anywhere inside it.

Ordering operators and general sorting require `Comparable`. V2 comparable
values are:

- `Int`, `Float`, `Bool`, `Str`, `Char`, and `Byte`;
- lists whose element type is `Comparable`.

Records and variants are not generally ordered. Dictionary keys require
`Equatable`.

Constraints may travel with a generalized function and are checked again at
each instantiation.

## 3.12 Opaque types

An opaque export reveals a nominal identity without revealing its
representation:

```pfun
export opaque type PositiveInt = {
	value
}
```

Outside its defining module, an opaque value may be stored, passed, returned,
and consumed by exported operations. It may not be:

- constructed;
- field-accessed;
- matched through its variants;
- included into another union by representation;
- fabricated through `Any`.

Opaque types support smart constructors, resource handles, validated values,
database connections, file handles, timer handles, and other capabilities.
Public observer functions expose only properties deliberately chosen by the
defining module.

## 3.13 Function and proc types

Pure and procedural callables have distinct types:

```text
(A, B) -> R
proc(A, B) -> R
async proc(A, B) -> R
```

Sync and async proc types do not unify. A proc value may flow through pure
code, but invoking it requires proc context.

---

# 4. Expressions and operators

## 4.1 Precedence

From loosest to tightest:

| Level | Operators | Associativity |
|---:|---|---|
| 1 | `|>`, `|?>`, `|!>` | Left |
| 2 | `? :` | Right |
| 3 | `||` | Left |
| 4 | `&&` | Left |
| 5 | `==`, `!=` | Left |
| 6 | `<`, `>`, `<=`, `>=` | Left |
| 7 | `|` | Left |
| 8 | `&` | Left |
| 9 | `<<`, `>>` | Left |
| 10 | `+`, `-`, `++` | Left |
| 11 | `*`, `/`, `%` | Left |
| 12 | unary `-`, `!`, `await` | Right |
| 13 | calls, indexing, field access | Left |

Parentheses override precedence.

## 4.2 Arithmetic

`+`, `-`, `*`, `/`, and `%` are numeric operators.

```pfun
1 + 2        // Int
1.5 + 2      // Float
5 / 2        // Int: 2
5 / 2.0      // Float: 2.5
```

Mixed `Int` and `Float` arithmetic promotes to `Float`. Integer division
truncates toward zero.

Integer division and modulo require a `NonZero` divisor:

```pfun
let half = value / 2;        // a nonzero literal coerces

match nonZero(divisor) with
| None -> fallback
| Some proven -> value / proven.value;
```

For data-dependent division without keeping the proof value:

```pfun
safeDiv(value, divisor)      // Option<Int>
safeMod(value, divisor)      // Option<Int>
```

Float arithmetic follows IEEE-754 and does not use `NonZero`.

## 4.3 String concatenation

`++` concatenates strings and only strings:

```pfun
"hello" ++ " world"
```

It does not coerce:

```pfun
"count: " ++ str(count)
$"count: {count}"
```

`+` never concatenates text, and `++` never concatenates lists. Lists use
named functions such as `concat`.

## 4.4 Equality and ordering

Equality is structural for `Equatable` values:

```pfun
[1, 2] == [1, 2]
```

Ordering uses the declared `Comparable` model. Float equality and comparison
use Pfun's total order:

- all NaNs compare equal to each other;
- NaN sorts after positive infinity;
- `-0.0 == 0.0`.

This gives deterministic sorting, dictionary keys, and memoization in the
presence of IEEE special values.

## 4.5 Boolean operators

`!`, `&&`, and `||` operate on `Bool`. `&&` and `||` short-circuit:

```pfun
index >= 0 && index < length(items)
```

Short-circuiting also establishes contract-safety facts while the right
operand is checked. For example:

```pfun
!isLazy(items) && length(items) > 0
```

is safe as one predicate because the right side runs only after strictness is
known.

## 4.6 Ternary selection

```pfun
let plural = count == 1 ? "item" : "items";
```

Only the selected branch is evaluated. Branch types must unify.

## 4.7 Ordinary pipelines

`value |> callable` calls the right side with exactly the left value:

```pfun
3 |> addOne |> double
```

The right operand must accept exactly one argument. A proc may appear on the
right only in proc context.

## 4.8 Option pipelines

`|?>` propagates `None` and unwraps `Some`:

```pfun
let result = text
	|?> parseOptional
	|?> normalize
	|?> validate;
```

The chain is transparent until an `Option` first appears:

- a raw input is passed normally;
- a raw result keeps the chain raw;
- the first `Option` result starts wrapped mode;
- `None` skips all remaining stages;
- `Some.value` is passed to the next stage;
- a raw result in wrapped mode is rewrapped as `Some`;
- an `Option` result in wrapped mode is flattened.

`|?>` handles only `Option`. It does not catch invariant defects or convert
`Result`.

## 4.9 Result pipelines

`|!>` propagates `Err` and unwraps `Ok`:

```pfun
let transformed = rows
	|!> transpose
	|!> reverse
	|!> slide
	|!> transpose;
```

It follows the same transparent-until-wrapped rule:

- raw stages behave like `|>`;
- `Ok.value` continues;
- `Err` stops the chain;
- raw results in wrapped mode become `Ok`;
- returned `Result` values are flattened.

When fallible stages use different domain-error unions, the checker joins them
through the unique smallest declared combined union. It never nests one
`Result` merely because another stage is fallible.

## 4.10 Postfix expressions

Postfix operations bind most tightly:

```pfun
call(arg)
items[index]
record.field
namespace.member
```

Public indexing is total and returns `Option`. Field access is checked against
the nominal shape or deferred until whole-program inference can resolve it.

- list indexing returns `Option<element>`;
- string indexing returns `Option<Char>`;
- dictionary lookup returns `Option<value>` and requires proc context;
- mutable-array access also requires proc context.

---

# 5. Functions and callable values

## 5.1 Named pure functions

```pfun
function area(width, height) {
	width * height
}
```

The final value is the result. `return expression;` performs an early return.
Calls use exact arity; Pfun does not implicitly curry a missing argument.

Partial application is explicit:

```pfun
let double = fn value => scale(2, value);
```

## 5.2 Pure lambdas

Pure lambdas use `fn`:

```pfun
let square = fn value => value * value;

let clamp = fn low, high, value => {
	let bounded = value < low ? low : value;
	bounded > high ? high : bounded
};
```

Parentheses around parameters are optional for pure lambdas:

```pfun
fn x => x + 1
fn (x, y) => x + y
```

The body is an expression or block. Lambdas close over lexical bindings.

## 5.3 Procedure lambdas

Procedure lambdas are explicitly typed and monomorphic:

```pfun
let onLine = proc (line: Str) -> Unit {
	println(line);
	{}
};

let delayed = async proc (value: Int) -> Int {
	match await sleep(10) with
	| Ok _ -> value + 1
	| Err _ -> value;
};
```

Their explicit signatures mark a callable native/effect boundary without
introducing general annotations into ordinary functions.

Pure code may create, bind, store, select, import, export, pass, and return a
proc value. It may not invoke one:

```pfun
type Handler = { generic action }

function wrap(action) {
	Handler { action }
}

proc use(handler) {
	handler.action("event");
}
```

## 5.4 Closures and captured mutation

A closure captures `let` values immutably. A proc lambda may capture a `var`;
the closure and its enclosing proc share one lexical cell:

```pfun
proc makeCounter() {
	var count = 0;

	proc () -> Int {
		count = count + 1;
		count
	}
}
```

Facts established about a mutable captured binding are not assumed inside a
later callback invocation. Immutable captures may carry facts that were valid
when the closure was created.

## 5.5 Generic callables

`generic function` is the polymorphic pure form:

```pfun
export generic function firstOr(fallback, items) {
	match items with
	| [] -> fallback
	| [first, ...rest] -> first;
}
```

`generic proc` generalizes a named proc signature:

```pfun
export generic proc dispatchAll(commands, dispatch) {
	match commands with
	| [] -> {}
	| [command, ...rest] -> {
		dispatch(command);
		dispatchAll(rest, dispatch);
	};
}
```

Proc lambdas remain monomorphic; use a named `generic proc` when the callable
itself must be instantiated at multiple types.

## 5.6 Memoized functions

`memo function` caches normally returned values by argument:

```pfun
memo function fibonacci(n) {
	n <= 1 ? n : fibonacci(n - 1) + fibonacci(n - 2)
}
```

Memoization observes Pfun equality rules, including total float equality.
Invariant violations are never memoized. A later call that violates receives
the later call's own site metadata rather than a replayed sentinel.

## 5.7 Tail-call optimization

Direct self-calls in eligible tail position compile as loops:

```pfun
function sumLoop(items, total) {
	match items with
	| [] -> total
	| [first, ...rest] -> sumLoop(rest, total + first);
}
```

Mutual tail recursion is not promised.

Dynamic cleanup and defect-handling boundaries are not crossed by synthesized
tail-loop transfers. A self-call lexically enclosed by any of these is not
eligible:

- `protect`;
- `handling invariants`;
- a handler arm;
- `complete`;
- `unwind`.

A callable with `ensures` is initially not eligible for TCO because each
logical recursive frame has its own postcondition and parameter values.
Preconditions on otherwise eligible tail recursion run again at the top of
every logical iteration.

## 5.8 Purity

Inside `function` and `fn`, the compiler rejects:

- `var` and assignment;
- `while`;
- proc invocation, including through a field or pipeline;
- `await`;
- I/O and mutable-resource operations;
- `handling invariants` and `protect`.

Pure code may still build descriptor data and transport proc values. Purity is
about performing an effect, not mentioning a value whose eventual consumer
may perform one.

---

# 6. Records, unions, Option, and Result

## 6.1 Records

```pfun
type Span = {
	start,
	end
}
```

Construction may be all positional:

```pfun
let span = Span { 10, 20 };
```

or all named:

```pfun
let span = Span {
	start = 10,
	end = 20
};
```

Named and positional initialization are not mixed in one constructor. Field
expressions run once from left to right.

## 6.2 No record-update expression

V2 has no special functional record-update syntax. Construct a complete new
record:

```pfun
function withEnd(span, newEnd) {
	Span {
		start = span.start,
		end = newEnd
	}
}
```

Complete reconstruction is important for field predicates: every new value
runs the complete validation sequence.

## 6.3 The builtin `Pair`

`Pair` is a nominal record with two generic fields:

```pfun
let entry = Pair {
	key = "name",
	value = "Ada"
};
```

The fields are `key` and `value`. List zipping, enumeration, dictionaries,
and helpers returning two values commonly use it.

## 6.4 Discriminated unions

```pfun
type Shape = {
	| Circle: radius
	| Rectangle: width, height
	| Point
}
```

Variants may be nullary or carry fields:

```pfun
let origin = Point;
let circle = Circle { radius = 5 };
let rectangle = Rectangle { 3, 4 };
```

Variant values are nominal. A specifically constructed variant widens to its
owning union when required.

## 6.5 Generic variant payloads

```pfun
type Option = {
	| None
	| Some: generic value
}

type Result = {
	| Ok: generic value
	| Err: generic message
}
```

The `generic` payload fields are hidden type slots belonging to the union.
There is one ambient `Option` and one ambient `Result` in a program.

The type parameter traditionally called `Error` is stored in the `Err`
variant's `message` payload field:

```pfun
match result with
| Ok success -> success.value
| Err failure -> renderError(failure.message);
```

## 6.6 Combined unions

A union may include all variants of another union:

```pfun
type FileError = {
	| FileMissing: message
	| FileDenied: message
}

type DecodeError = {
	| InvalidData: message
}

type AppError = {
	...FileError
	...DecodeError
	| InvalidConfig: message
}
```

Inclusion gives directional widening:

- `FileError` may widen to `AppError`;
- `DecodeError` may widen to `AppError`;
- an arbitrary `AppError` may not narrow to either component.

The checker finds the unique smallest combined union that contains values from
different branches or pipeline stages. Ambiguous least upper bounds are
diagnosed rather than chosen by declaration order.

Matching the combined union is exhaustive over the flattened variant set.
A field may be read directly from a combined error only when every included
variant has a compatible field of that name.

## 6.7 Constructor identity

**Provisional surface.** V2's final public model resolves constructors through
their declaring module/import identity rather than relying permanently on one
program-global variant-name namespace. Until the qualified/import-resolved
surface is frozen, examples use distinct variant names where collisions would
otherwise occur.

Whichever syntax is selected, constructor ownership remains nominal: importing
or including a union does not create unrelated constructors with the same
spelling.

## 6.8 `Option`

Use `Option<T>` for ordinary absence:

```pfun
function first(items) {
	match items with
	| [] -> None
	| [value, ...rest] -> Some { value };
}
```

Typical examples:

- no list element at an index;
- no dictionary value for a key;
- no input because the stream reached EOF;
- a conversion that is undefined for a particular value.

Absence is not an error and carries no explanation.

## 6.9 `Result`

Use `Result<Value, Error>` when failure information matters:

```pfun
type LoadError = {
	| MissingFile: path, message
	| InvalidConfig: path, message
}

function loadConfig(path) {
	...
}
```

Every package reuses the ambient `Result`; packages define domain error unions
for its error slot. Do not redeclare `Ok` and `Err` merely to create
`FileResult`, `ParseResult`, or package-local result types.

A genuinely different outcome shape may still have its own union. Streaming
reads, for example, distinguish successful data, clean EOF, and failure:

```pfun
type ReadResult = {
	| ReadOk: generic value
	| ReadEof
	| ReadErr: generic message
}
```

## 6.10 Choosing between `Option`, `Result`, and invariant

Use:

- `Option` when absence is routine and needs no explanation;
- `Result` when the caller may reasonably respond to a failed operation;
- an invariant when reaching the state means the program's own logic is
  defective.

Do not use an invariant for malformed network input, a missing file, a rejected
database query, or an unavailable platform capability. Those are boundary
results.

---

# 7. Pattern matching

## 7.1 Basic form

```pfun
match shape with
| Circle circle -> circle.radius * circle.radius
| Rectangle rectangle -> rectangle.width * rectangle.height
| Point -> 0;
```

A match is an expression. Arms are tried in source order.

## 7.2 Variant binders

```pfun
| Some found -> found.value
```

The binder receives the whole specific variant value, not merely its first
payload. Payload fields are accessed on that value.

`Variant _` ignores the payload. A nullary variant needs no binder.

## 7.3 Wildcards

`_` matches anything and binds nothing:

```pfun
match result with
| Ok value -> use(value.value)
| _ -> fallback;
```

On a union subject, a lowercase identifier is not a binding catch-all. Use `_`
or bind the subject before the match.

## 7.4 Guards

```pfun
match shape with
| Circle circle where circle.radius > 10 -> "large"
| Circle _ -> "small"
| Rectangle _ -> "rectangle"
| Point -> "point";
```

The guard is pure and runs only after its pattern matches.

Guarded arms never count toward exhaustiveness. Every variant still needs an
unguarded arm or wildcard.

## 7.5 List patterns

```pfun
match items with
| [] -> 0
| [only] -> only
| [first, _, ...rest] -> first + length(rest);
```

List-pattern elements are binders or wildcards. `...rest` appears only in tail
position and only after at least one explicit element. Patterns do not nest.

Matching a lazy list forces only the bounded prefix needed to decide the
pattern.

## 7.6 Exhaustiveness

The compiler proves every match complete:

- a union match covers every variant;
- a list match covers every possible length;
- a match over another type has an unguarded wildcard or equivalent complete
  coverage;
- guarded arms contribute no coverage.

For lists, exact patterns cover one length and a rest pattern covers a range.
The diagnostic reports the smallest missing length.

An emitted match-failure path is an internal compiler assertion. If it is
reached by a checked program, that is a compiler or ABI defect rather than an
expected program failure.

---

# 8. Lists and explicit laziness

## 8.1 Strict lists

A list is immutable and homogeneous:

```pfun
let values = [1, 2, 3];
let more = cons(0, values);
```

Strict lists are materialized finite values. Their length and indexed storage
use the host's array-backed representation, so strict-list `length` is
constant-time.

## 8.2 Comprehensions

```pfun
let pairs = [
	Pair { x, y }
	for x <- xs
	for y <- ys
	where x < y
];
```

A comprehension has one or more generator clauses and an optional final
`where` guard. Its body and guard are pure contexts even when the
comprehension appears inside a proc.

## 8.3 Total access

Potentially absent access returns `Option`:

```pfun
nth(values, index)
head(values)
tail(values)
```

`nth` is ambient; `head` and `tail` are exported by `"list"`.

List patterns are usually clearer when the algorithm naturally separates
empty and nonempty cases.

Raw unchecked accessors such as `nthU` are compiler-only intrinsics, not
ordinary user APIs.

## 8.4 Explicit lazy production

`lazy` applies only to list literals and comprehensions:

```pfun
let transformed = lazy [
	transform(value)
	for value <- source
	where keep(value)
];
```

The logical type remains `List<T>`. Production is deferred, and each forced
cell is memoized.

Lazy bodies and guards are always pure. Their execution time depends on future
consumers and cannot safely contain effects.

## 8.5 Infinite and generated lists

**Provisional surface.** The completed standard library places representation
inspection and unbounded constructors in an explicit `"lazy"` module:

```pfun
import {
	isLazy,
	repeat,
	iterate,
	cycle
} from "lazy";
```

Intended semantics:

- `repeat(value)` produces the value without end;
- `iterate(step, seed)` produces successive values;
- `cycle(items)` repeats a nonempty finite list;
- empty-cycle behavior is reported explicitly rather than silently spinning;
- `isLazy(value)` is an O(1) representation predicate.

`isLazy` does not answer whether a sequence is mathematically infinite:

- `false` means fully materialized and finite;
- `true` means lazily represented and possibly finite or infinite.

This predicate exists because executable contract safety sometimes needs a
boundedness fact. It is not a revival or rename of V1's `isInfinite`.

## 8.6 Forcing classes

Every list operation has a forcing class:

| Class | Meaning |
|---|---|
| `NONE` | Does not force the input |
| `PREFIX` | Forces a finite runtime-bounded prefix |
| `MODE` | Preserves strict/lazy result mode |
| `MATERIALIZE` | Forces a bounded prefix and returns a strict finite list |
| `SEARCH` | Scans until decided and may inspect an unbounded prefix |
| `FULL` | May need the complete input and therefore requires strictness in contracts |

Typical classification:

| Operation | Class |
|---|---|
| `cons`, lazy constructors | `NONE` |
| list patterns, `head`, `tail`, `nth`, `drop` | `PREFIX` |
| `map`, `filter`, lazy append | `MODE` |
| `take` | `MATERIALIZE` |
| `any`, `all`, `find` | `SEARCH` |
| `length`, `reverse`, `reduce`, sorting, equality, stringify, JSON encode | `FULL` |

`FULL` describes forcing, not time complexity. `length` is still O(1) on a
strict array-backed list.

## 8.7 `take` materializes

```pfun
let firstHundred = take(100, infiniteValues);
```

`take` returns a strict finite list. It does not return a lazy view, and its
meaning does not change based on the input representation.

A separately named lazy prefix operation may be added only if its retention
and forcing behavior are explicit. It does not replace `take`.

## 8.8 Whole-list operations and contracts

Ordinary program code may call a full-forcing operation on a lazy list; if the
list is infinite, that computation does not finish.

Executable contracts are stricter because the compiler must ensure the check
it inserts is itself bounded. A predicate using `length(items)` therefore
needs a fact that `items` is strict:

```pfun
invariant !isLazy(items) && length(items) >= 0;
```

## 8.9 Resource-backed lazy sources

A lazy source backed by a file, socket, database cursor, or other native
resource must have explicit lifecycle behavior. It uses one of:

- a scoped consumer;
- an opaque handle with explicit close or cancel;
- another design that guarantees release on every exit.

Garbage collection is never the resource-management contract.

---

# 9. Strings, characters, bytes, and numbers

## 9.1 Strings

`Str` is an immutable scalar text value, not `List<Char>`.

```pfun
let greeting = "hello" ++ " world";
let pieces = split(greeting, " ");
let rebuilt = join(pieces, "-");
```

String offsets, `length`, and `slice` use UTF-16 code units. This matches
JavaScript storage and stable source offsets.

## 9.2 Characters and scalar integrity

`Char` contains exactly one Unicode scalar value. It can represent a
supplementary character even though that character occupies two UTF-16 code
units in a `Str`.

```pfun
asc(character)          // Char -> Int
chr(codePoint)          // Int -> Option<Char>
```

`chr` returns `None` for values outside the Unicode scalar range, including
surrogate code points.

String indexing at the trailing code unit of a surrogate pair returns `None`;
it never manufactures a lone surrogate typed as `Char`.

Compiler-only unchecked construction such as `chrU` is not part of the
ordinary user surface.

## 9.3 UTF-8 and bytes

```pfun
charBytes(character)    // Char -> List<Byte>
bytesToChar(bytes)      // List<Byte> -> Option<Char>
```

`bytesToChar` accepts exactly one valid encoded scalar and rejects invalid or
multi-character sequences.

## 9.4 Byte arithmetic

`Byte` values range from 0 through 255. Arithmetic and bit operations wrap
modulo 256:

```pfun
255b + 1b       // 0b
```

The checker and emitter preserve `Byte`; byte operations do not silently
become integer operations.

## 9.5 Integers

`Int` is arbitrary precision. Implementations may use host numbers for a safe
range and promote on overflow, but this is not observable as a type change.

Integer division truncates toward zero. `/` and `%` use the `NonZero` rules in
§4.2.

## 9.6 Floats

`Float` is IEEE-754 double. Arithmetic is total and may produce `NaN` or
infinity.

```pfun
isNaN(value)
isFinite(value)
floatToInt(value)       // Option<Int>
```

`floatToInt` returns `None` exactly when the input is non-finite.

**Provisional surface.** `floor`, `ceil`, and `round` use
`Option<Int>` for non-finite input rather than allowing a host `NaN` or
infinity to inhabit static type `Int`.

## 9.7 Formatting

Prefer format strings for mixed values:

```pfun
$"point = ({point.x}, {point.y})"
```

`str(value)` performs the language's ordinary string rendering. Full-list
rendering is a `FULL` forcing operation when the value contains a list.

---

# Part II — The Procedural Shell

# 10. Modules, exports, and native boundaries

## 10.1 Imports

Pfun supports named, namespace, and star imports:

```pfun
import { trim, splitLines as lines } from "string";
import * as List from "list";
import * from "io";
import { parse } from "./parser";
```

- Relative paths resolve from the importing source file.
- Bare names resolve through the installed V2 standard-library and builtin
  module map.
- A missing `.pf` extension may be supplied by the loader.
- The root V1 `lib/` archive is not part of V2 module resolution.

Namespace imports avoid accidental flat-scope collisions and are preferred
for larger modules.

## 10.2 Exports

```pfun
export let defaultWidth = 80;
export function render(document) { ... }
export generic function mapOption(f, option) { ... }
export proc flush() { ... }
export type Token = { ... }
export opaque type Handle = { ... }
```

`var` and `extern` declarations cannot be exported.

An ordinary exported value must have a completed type and no unresolved
operational constraints. Public interfaces never contain `Any`, recovery
`Unknown`, unselected builtin overloads, or an unresolved field schema.

## 10.3 Module checking

The loader constructs the complete import graph. The checker:

1. collects declarations and provisional nominal identities;
2. infers bodies and field evidence over the complete import closure;
3. finalizes schemas, overloads, constraints, and public interfaces;
4. checks purity, exhaustiveness, contracts, and boundary requirements.

If one module fails, dependents receive a concise dependency diagnostic rather
than a misleading cascade.

## 10.4 Cycles and declaration identity

Provisional interfaces give records, unions, constructors, and normal fields
stable identities before every dependent body is inferred. This allows legal
module cycles to share nominal declarations without making inference depend on
graph traversal or hash-map order.

The final public interface is produced only after whole-program finalization.

## 10.5 Opaque exports

```pfun
export opaque type Connection = {
	nativeHandle
}
```

The declaring module retains representation access. Importers see only nominal
identity, hidden generic arity, public observers, and exported operations.

A public contract on an opaque type uses a public observer:

```pfun
export function height(matrix) {
	matrix.height
}

export function at(matrix, row, column)
	requires row >= 0 && row < height(matrix);
{
	...
}
```

It does not expose private fields in the contract itself.

## 10.6 Private native declarations

Native bindings use explicit signatures:

```pfun
extern function hostDecode(raw: Any) -> DecodeToken
extern proc writeSocket(handle: Socket, data: Str) -> Result<Unit, NativeError>
extern async proc waitReadable(handle: Socket) -> Result<Unit, NativeError>
```

`extern` declarations:

- are private to their module;
- are the main place where explicit parameter/result types appear;
- may not be re-exported directly;
- must be wrapped in ordinary Pfun values and error types;
- declare their target capabilities to the linker.

## 10.7 The native-boundary rule

A native wrapper may return only:

- ordinary Pfun values;
- opaque handles;
- `Option`;
- `Result`;
- declared domain unions.

It may not leak:

- a raw JavaScript object;
- `undefined`;
- an undocumented promise rejection;
- a host exception as an ordinary application outcome;
- a forged opaque representation.

Every broad host catch rethrows an invariant sentinel before translating
ordinary host failures.

## 10.8 Target capabilities

Builtins and extern wrappers declare whether they are:

- platform-neutral;
- Node-only;
- browser-only;
- provided by another explicit target capability.

A browser build that imports a Node-only file or process operation fails
during checking or linking. It does not emit a bundle that reaches an
undefined host name at runtime.

---

# 11. Procedures, mutation, and asynchronous work

## 11.1 Named procedures

```pfun
proc main() {
	println("hello");
}

main();
```

A proc may:

- call pure functions;
- call sync procs;
- create and mutate `var` bindings;
- use mutable modules and resources;
- perform I/O;
- handle invariant defects;
- protect cleanup;
- invoke first-class proc values.

The top level is procedural context. Statements run in source order.

## 11.2 `var`

`var` creates a mutable lexical binding:

```pfun
proc countTo(limit) {
	var current = 0;

	while (current < limit) {
		current = current + 1;
	}

	current
}
```

`var` is legal only at top level or inside proc context. It cannot be exported.
Expose explicit reader and updater procs instead of public module mutation.

## 11.3 Assignment targets

The language admits binding assignment and target-specific mutable assignment:

```pfun
count = count + 1;
```

Mutable collection modules may provide indexed assignment syntax as a
convenience, but it remains proc-only and follows the collection's total
failure contract.

## 11.4 Return

```pfun
return;
return value;
```

`return` leaves the current function or proc. A `complete` or `unwind` cleanup
arm may not return from the enclosing callable because that could replace the
original transfer.

## 11.5 Async procs

```pfun
async proc fetchText(url) {
	let response = await httpGet(url);
	response
}
```

Only procs may be async. `await` is legal only in an `async proc` body.
Asynchrony never appears on a pure function type.

Sync and async proc values are distinct:

```text
proc(Str) -> Unit
async proc(Str) -> Unit
```

## 11.6 Awaited and detached calls

Awaiting an async proc keeps the result in the current logical call chain:

```pfun
let result = await load();
```

Calling an async proc without `await` starts detached work:

```pfun
refreshCache();
continueImmediately();
```

Detached work creates a task root. It receives its own invariant handler and
failure-observation policy. An invariant defect may never escape as a raw
unhandled rejection.

Use detached calls only when their completion and failure policy are
deliberate. Application descriptors are often clearer for work whose lifecycle
belongs to an event loop.

## 11.7 Sleep

The `"async"` module provides:

```text
sleep : Int -> async proc Result<Unit, NativeError>
```

Durations are milliseconds from 0 through 2,147,483,647. Invalid durations or
scheduler failures return `NativeTimerError`.

## 11.8 One-shot timers

The `"timer"` module separates sync and async callbacks:

```pfun
setTimer(
	100,
	proc () -> Unit {
		println("timer fired");
		{}
	}
)

setAsyncTimer(
	100,
	async proc () -> Unit {
		await refresh();
		{}
	}
)
```

The basic operations are:

```text
setTimer      : Int, proc() -> Unit       -> Result<TimerHandle, NativeError>
setAsyncTimer : Int, async proc() -> Unit -> Result<TimerHandle, NativeError>
clearTimer    : TimerHandle               -> Result<Unit, NativeError>
```

Timers are one-shot. Clearing a pending timer prevents the callback.
Clearing a timer that already fired or was already cleared is an idempotent
`Ok`.

The scheduling result covers validation and host setup. The callback runs
later, after that result exists.

**Provisional surface.** The completed timer API adds an observable
completion/failure channel to the handle, or deliberately restricts timers
whose detached callback cannot be observed. Callback failure is never silently
discarded.

## 11.9 Callback roots

Timer callbacks, HTTP request handlers, browser events, database stream
callbacks, and other native callbacks each begin at a defined task root.
The root:

- installs invariant handling;
- translates recoverable host failures to `Result`;
- reports unexpected callback failure;
- owns cleanup and cancellation;
- prevents one callback's defect from corrupting unrelated work.

---

# 12. Absence, expected failure, and invariant defects

## 12.1 Expected negative outcomes

Expected negative outcomes are values:

```pfun
Option<T>
Result<T, E>
```

They are handled with `match`, `|?>`, `|!>`, or standard-library combinators.
They do not unwind the call stack.

Examples:

- `nth(items, index)` returns `None` when the index is absent;
- `readFile(path)` returns `Err` when the operating system rejects the read;
- an HTTP response with status 404 is still a valid response value, not
  necessarily a transport error;
- invalid untrusted data returns a validation `Err`.

## 12.2 Invariant defects

An invariant defect means the program's own logic reached a state declared
impossible:

```pfun
invariant balance >= 0;
```

The expression:

- is checked as a pure `Bool`;
- runs exactly once;
- continues normally when true;
- raises an opaque `InvariantViolation` when false;
- establishes facts for later contract-safety analysis when true.

It is legal in pure and proc code.

## 12.3 Explicit violation

```pfun
violation("unreachable parser state")
```

This raises the same defect sentinel with explicit-violation metadata. It is
appropriate only when continuing would claim a false internal assumption.

Do not use it as a replacement for `Err`.

## 12.4 Violation metadata

Every defect site carries stable information:

```text
path
line
column
callable
kind
canonical predicate or explicit message
```

The runtime value is branded and opaque. Application code cannot construct,
pattern-match, or inspect its host representation. Proc handlers may use
dedicated public observers such as `violationMessage`.

## 12.5 Abandonment

Raising an invariant violation abandons the current logical computation and
transfers control to the nearest active invariant handler.

Abandonment is not expected error handling:

- pure code may raise but not catch;
- it is not converted to `Result`;
- a broad native `catch` must rethrow it;
- the outer system handler aborts the affected root if no application handler
  consumes it.

## 12.6 Handling invariant defects

Proc code may establish a handler:

```pfun
handling invariants {
	processRequest(request);
} with failure -> {
	logInvariant(violationMessage(failure));
}
```

The handler:

- catches only `InvariantViolation`;
- dynamically encloses awaited work in the same call chain;
- does not catch ordinary host exceptions;
- may consume the defect;
- runs in proc context.

A violation raised inside the handler arm propagates to the next outer
handler.

Consuming a defect does not prove shared mutable state is valid. Use
`protect`, ownership, or transactional boundaries when abandoned work may have
partially mutated shared state.

## 12.7 System handlers

Every application has an outer handler:

- a Node process renders a stable report to stderr and exits with software
  error status 70;
- a browser application reports visibly and to developer tools, then stops
  dispatch into the affected invalid model;
- an HTTP request root logs and returns 500 when possible, abandoning only
  that request by default;
- detached tasks report through their owning runtime channel.

These policies are root behavior, not alternative defect types.

## 12.8 Optimization consequences

A strict pure call cannot be removed merely because its returned value is
unused. The call may diverge or raise an invariant defect.

Dead-call elimination requires proof that the call terminates normally and
cannot violate. Memoization caches normal results only.

---

# 13. Executable contracts and validated data

## 13.1 Dynamic-first contracts

V2 contracts are executable language semantics before they are proof
obligations. The compiler:

1. infers and checks the predicate as ordinary pure code;
2. proves the predicate is safe to execute as a bounded check;
3. emits the check;
4. optionally removes a residual check only after a later verifier proves it.

The optional solver is not required to use contracts.

## 13.2 Preconditions

```pfun
function nthV(items, index)
	requires !isLazy(items);
	requires index >= 0 && index < length(items);
{
	nthInternal(items, index)
}
```

The semicolon after every `requires` clause is mandatory. It disambiguates the
clause from an `IDENT { ... }` record constructor at the callable body.

Rules:

- a callable may have multiple preconditions;
- they run in source order;
- a successful clause establishes facts for later clauses and the body;
- checks run at the callee boundary;
- aliases and proc-valued fields cannot bypass the checks;
- eligible tail recursion reruns them on every logical invocation;
- failure raises an invariant defect.

## 13.3 Postconditions

```pfun
function clamp(value, low, high)
	requires low <= high;
	ensures result {
		low <= result && result <= high
	}
{
	value < low ? low : (value > high ? high : value)
}
```

A callable has at most one `ensures` clause. Use Boolean connectives for a
compound postcondition.

The result binder:

- exists only inside the clause;
- may not shadow a parameter;
- is bound to each normal return value.

Every normal return, including early return, passes through the check.
Failure raises an invariant defect. A direct call may use the successful
postcondition as a fact afterward.

An indirect alias still runs the callee's postcondition but does not
automatically give the caller a static postcondition fact unless the callable
identity is known.

## 13.4 Contracts and tail recursion

Preconditions fit inside an emitted self-tail-call loop and run at every
iteration.

Postconditions may refer to each logical frame's parameters. Checking only the
last mutated loop parameters would be wrong. Therefore a callable with
`ensures` is not tail-call optimized in the initial contract implementation.

A later optimization may preserve per-frame obligations explicitly, but it
cannot weaken the contract.

## 13.5 Field predicates

A record or variant field may declare a predicate:

```pfun
type Bounds = {
	low,
	high where low <= high
}
```

Construction:

1. evaluates field expressions once from left to right into temporaries;
2. evaluates predicates in declaration order;
3. constructs the nominal value after all predicates succeed.

An internal constructor that violates a field predicate raises an invariant
defect.

There is no record-update expression. Reconstructing a changed value reruns
the complete predicate sequence.

An executable predicate may constrain a normal field, parameter, local, or
result. It may not specialize an intentionally `generic` field slot in the
first contract system; use a normal field or an opaque smart constructor when
the predicate requires a specific representation.

## 13.6 Self-guarding predicates

Field-predicate safety depends only on the finalized schema and earlier
declaration predicates, never on facts at a particular construction site.

This is safe:

```pfun
type NonEmptyItems = {
	items where !isLazy(items) && length(items) > 0
}
```

This is rejected unless an earlier declaration predicate already proves
strictness:

```pfun
type NonEmptyItems = {
	items where length(items) > 0
}
```

The declaration therefore means the same thing for internal constructors,
JSON decoders, HTTP decoders, and database row decoders.

## 13.7 Untrusted construction

Untrusted data is not allowed to trigger an application invariant merely
because it fails validation.

The boundary adapter performs:

```text
parse raw data
  -> validate base types
  -> validate field predicates
  -> construct nominal value
  -> Ok
```

A failed predicate returns a structured validation error containing:

```text
path
field
predicate
message
```

Nested collections retain element paths. The predicate implementation is
shared with internal construction, but the failure adapter is different.

## 13.8 Contract predicate safety

Before any solver, the compiler asks:

> Can this predicate execute as a bounded pure Boolean computation under the
> facts known here?

The initial accepted subset includes:

- scalar literals and already-total scalar arithmetic;
- immutable locals, parameters, and field projections;
- Boolean connectives and comparisons;
- the chosen lazy-representation predicate;
- bounded-prefix operations;
- full-list operations only when strictness is known;
- compiler-declared safe builtin cases;
- pure, acyclic, non-higher-order observer functions with finalized safety
  summaries.

Initially rejected:

- effects, mutation, `await`, or proc calls;
- arbitrary recursion;
- unknown higher-order calls;
- mutable collections, buffers, handles, or raw foreign values;
- full traversal without a strictness fact;
- floating predicates until their exact contract policy is frozen.

An unsafe predicate is a contract-safety diagnostic. It is not a residual
proof obligation.

## 13.9 Flow facts

The first fact domain is deliberately small:

```text
StrictList(valuePath)
LazyList(valuePath)
NonNegative(valuePath)
```

Facts follow lexical binding identity rather than displayed variable names.

Transfer rules:

- facts from the true side of `left && right` enter `right`;
- facts from the false side of `left || right` enter `right`;
- a branch receives facts implied by its selecting condition;
- a join keeps only facts present on every incoming path;
- an immutable alias inherits stable facts;
- assigning a binding kills every fact rooted there;
- a loop header kills facts for every binding assigned anywhere in the loop;
- shadowing introduces a new binding identity;
- a lambda imports only valid immutable-capture facts;
- a lambda imports no facts rooted in captured `var` bindings.

These are compile-time safety facts, not hidden runtime state.

## 13.10 Safe observer functions

A contract on an opaque value uses an exported pure observer. An observer is
allowed in a predicate when its transitive summary proves that it:

- is outside a recursive call-graph component;
- performs only bounded scalar or record work;
- calls only safe builtin cases or already safe observers;
- has no unknown higher-order calls;
- receives every strictness fact it requires.

Only finalized module interfaces export a positive safety summary.

## 13.11 Trusted host contracts

Ordinary Pfun preconditions and postconditions execute.

Trusted host intrinsics are a narrow exception:

- host preconditions execute dynamically;
- host postconditions are axioms available after normal return;
- host postconditions are not redundantly checked after every call;
- a cross-host conformance suite validates every trusted postcondition.

The builtin manifest records whether a postcondition is executable or a
trusted host axiom.

## 13.12 Higher-order limit

The first contract system does not express latent contracts on arbitrary
function-valued parameters or propagate caller facts through unknown callable
values.

Aliasing a contracted function never bypasses its runtime checks. Only
caller-side fact propagation is limited to statically resolved direct
callables.

## 13.13 Optional static discharge

A later verifier may prove some contract sites unreachable or always true and
remove their checks. It consumes already-typed predicates and facts; it never
influences type inference.

Unproved checks remain executable. Solver availability or timeout cannot make
an otherwise valid program fail to build.

---

# 14. Resource safety and mutable facilities

## 14.1 `protect`

`protect` gives a proc an explicit normal/abnormal cleanup boundary:

```pfun
protect {
	updateAccount(connection, account);
} complete {
	commit(connection);
} unwind {
	rollback(connection);
}
```

Semantics:

- `complete` runs once on every normal transfer leaving the body;
- `unwind` runs once on every thrown abnormal exit;
- abnormal exit includes invariant defects and ordinary host throws;
- `Result` and `Option` values are normal values;
- the original normal transfer continues after `complete`;
- the original failure continues after `unwind`;
- cleanup cannot consume or replace the original transfer;
- cleanup arms may perform proc operations;
- cleanup arms may not return from the enclosing callable or transfer out of
  an enclosing loop.

If `unwind` itself fails, the root reports both the primary and cleanup causes
as a fatal resource failure.

## 14.2 What `protect` does not guarantee

`protect` guarantees cleanup ordering. It does not magically make arbitrary
effects transactional.

Charging a payment, sending mail, or publishing a message may require:

- idempotency;
- post-commit sequencing;
- compensation;
- a domain-specific transaction protocol.

## 14.3 Transactions

Database transaction helpers use `protect`:

- normal completion commits once;
- every abnormal exit rolls back once;
- an invariant handler inside the protected body may consume a defect, after
  which the body may complete normally and therefore commit;
- one request's abandoned transaction does not corrupt another request.

## 14.4 Files and handles

Opaque file handles are opened and closed in proc context. Convenience
functions handle the common whole-file cases. Streaming APIs make EOF distinct
from failure.

Any scope that owns a handle uses explicit close or `protect`. The host and
standard library do not make garbage collection the close mechanism.

## 14.5 Mutable arrays

Public arrays are opaque mutable handles parameterized by element type. Their
operations:

- require proc context for creation, reads, and writes;
- preserve element type in module interfaces;
- return `Option` for an absent index;
- return `Result` for recoverable host failure;
- do not expose raw JavaScript arrays.

Literal syntax, when retained as a convenience, creates the same opaque value
and obeys the same proc-context rules:

```pfun
let values = array { 10, 20, 30 };
```

## 14.6 Mutable dictionaries

Public dictionaries are opaque mutable handles parameterized by key and value
types. Keys require `Equatable`.

The API specifies iteration order wherever it is observable. Lookup returns
`Option`; recoverable native failures return `Result`. Raw JavaScript maps or
objects never cross the boundary.

```pfun
let counts = dict {
	"alpha" -> 1,
	"beta" -> 2
};
```

## 14.7 Buffers

Buffers are opaque growable builders for binary and text-adjacent work. A typed
mode distinguishes byte and character behavior.

Operations cover:

- creating a byte or string buffer;
- appending bytes, characters, and strings;
- reading or writing through file handles;
- obtaining length;
- converting to a strict byte list or string.

Invalid mode, range, encoding, or conversion conditions return
`NativeBufferError`; no raw host range exception escapes.

## 14.8 Lifecycle-safe streaming

HTTP bodies, database cursors, file streams, watchers, and other long-lived
sources use:

- a scoped consumer;
- or an opaque handle with explicit close/cancel and observable completion.

Losing interest in a stream does not silently leak the underlying resource.

---

# 15. Effects as data and application architecture

## 15.1 Why describe effects as data

First-class proc values are ideal for callbacks and handlers whose future
invocation is already understood to be effectful.

Descriptors solve a different problem: pure code needs to request an effect
without performing it.

```pfun
type Command = {
	| NoCommand
	| BatchCommands: commands
	| HttpGet: url, generic toMessage
	| Delay: milliseconds, generic message
}
```

An application's pure update logic returns descriptor values. One proc owns
execution.

## 15.2 Exhaustive dispatch

```pfun
proc dispatch(command) {
	match command with
	| NoCommand -> {}
	| BatchCommands batch -> dispatchAll(batch.commands)
	| HttpGet request -> fetchInto(request.url, request.toMessage)
	| Delay delayed -> schedule(delayed.milliseconds, delayed.message);
}
```

Adding a descriptor variant breaks every incomplete dispatcher at compile
time. This makes effect coverage explicit and auditable.

## 15.3 Shared protocol unions

A shared nominal union may describe a client/server protocol. Both ends match
it exhaustively. Adding a request or response variant forces every relevant
dispatcher and decoder to update.

Untrusted wire decoding still returns `Result`; a peer cannot manufacture an
invariant defect merely by sending invalid data.

## 15.4 TEA-shaped applications

The Elm Architecture fits Pfun's boundary:

```text
init   : Flags -> Pair<Model, Command>
update : Message, Model -> Pair<Model, Command>
view   : Model -> View<Message>
```

The runtime proc owns:

- the current model;
- message dispatch;
- command execution;
- subscriptions;
- DOM mutation;
- browser task roots.

Application `init`, `update`, and `view` remain pure.

## 15.5 Proc callbacks versus descriptors

Use a proc callback when:

- an API requires a handler;
- invocation time is inherently procedural;
- ownership and completion belong to the registering proc.

Use a descriptor when:

- pure business logic should request the effect;
- effects need exhaustive dispatch;
- application tests should compare requested effects as data;
- the same protocol drives multiple runtimes.

The two techniques coexist.

---

# Part III — Libraries and Platforms

# 16. Ambient core reference

The ambient core is always in scope. Everything larger belongs to an explicit
module.

## 16.1 Core types and constructors

| Type or constructor | Meaning |
|---|---|
| `Option<T>` | `None` or `Some.value` |
| `Result<T, E>` | `Ok.value` or `Err.message` |
| `Pair<K, V>` | Record with generic `key` and `value` |
| `NonZero` | Opaque proof for integer division |
| `NativeError` | Combined recoverable host-error family |

## 16.2 Rendering

```text
str(value)     -> Str
__str__(value) -> Str
```

`str` is the ordinary public spelling. `__str__` exists for compiler and
format-string lowering.

Rendering a complete lazy list is a full-forcing operation.

## 16.3 Length and slicing

`length` is overloaded:

```text
length : List<a>   -> Int
length : Str       -> Int
length : Array<a>  -> Int
length : Dict<k,v> -> Int
```

The list and string cases are pure. Array and dictionary length observe
mutable handles and are therefore legal only in proc context.

`slice` is overloaded:

```text
slice : Int, Int, List<a> -> List<a>
slice : Int, Int, Str     -> Str
```

Arguments are `(start, count, subject)`. List slicing preserves the appropriate
strict/lazy behavior for the selected operation; string slicing uses UTF-16
code-unit offsets.

The checker selects a real overload case. There is no `Any` fallback.

## 16.4 Core list operations

| Function | Contract |
|---|---|
| `cons(value, items)` | Prepend without forcing the tail |
| `reverse(items)` | Return a strict reversed list; full-forcing |
| `nth(items, index)` | `Option<element>` |
| `take(count, items)` | Strict finite prefix |
| `range(low, high)` | Inclusive integer range |
| `map(f, items)` | Transform while preserving list mode |
| `filter(pred, items)` | Filter while preserving list mode |
| `reduce(f, initial, items)` | Left fold; full-forcing |
| `find(needle, subject)` | `Option<Int>` index |
| `findSlice(needle, subject)` | `Option<Int>` start index |

`find` and `findSlice` have real list and string overload cases. List cases
require equatable elements.

Unsafe `nthU` is compiler-internal and does not belong to the public ambient
surface.

## 16.5 Core string and character operations

| Function | Contract |
|---|---|
| `split(text, separator)` | `List<Str>` |
| `join(items, separator)` | `Str` |
| `asc(character)` | Unicode scalar integer |
| `chr(codePoint)` | `Option<Char>` |
| `charBytes(character)` | UTF-8 bytes |
| `bytesToChar(bytes)` | One decoded scalar or `None` |

Unchecked `chrU` remains compiler-only.

## 16.6 Numeric operations

| Function | Contract |
|---|---|
| `isNaN(value)` | Float NaN test |
| `isFinite(value)` | Finite-float test |
| `floatToInt(value)` | `Option<Int>`; `None` for non-finite |
| `floor(value)` | **Provisional:** `Option<Int>` |
| `ceil(value)` | **Provisional:** `Option<Int>` |
| `round(value)` | **Provisional:** `Option<Int>` |
| `nonZero(value)` | `Option<NonZero>` |
| `safeDiv(a, b)` | `Option<Int>` |
| `safeMod(a, b)` | `Option<Int>` |

## 16.7 Native-error observers

Every native error variant has stable operation and message information:

```text
nativeErrorOperation(error) -> Str
nativeErrorMessage(error)   -> Str
```

Match the variant when category-specific handling matters. Use the observers
for common logging.

---

# 17. Standard Pfun modules

Standard-library modules are ordinary checked Pfun code wherever possible.
They follow the same inference, purity, contract, and `Result` rules as
application modules.

## 17.1 `"list"`

The list module supplies safe decomposition and extended operations. The
completed surface includes:

```text
head, tail
sum, product
count, any, all
minimum, maximum, minBy, maxBy
elem, notElem, lookup
concat, flatMap
zip, zipWith, unzip, enumerate
sort, sortDesc, sortBy
```

Representative use:

```pfun
import { enumerate, sort, zip } from "list";

let indexed = enumerate(["alpha", "beta"]);
let ordered = sort([5, 1, 4, 2, 3]);
let paired = zip([1, 2], ["a", "b"]);
```

Operations declare their forcing class. Sorting and whole-list aggregates
fully force their input.

## 17.2 `"list/verified"`

Verified direct access exposes preconditioned operations:

```pfun
import { nthV } from "list/verified";

function firstKnown(items)
	requires !isLazy(items);
	requires length(items) > 0;
{
	nthV(items, 0)
}
```

Before static discharge, the preconditions execute. A later verifier may erase
them for proved callers. The underlying unchecked intrinsic stays unavailable
to ordinary code.

## 17.3 `"string"`

The string module includes:

```text
isWhitespace
trim, trimLeft, trimRight
startsWith, endsWith, contains
replace, replaceAll
takeWhile, dropWhile
strRepeat
padLeft, padRight
indexOf
nullOrEmpty
quote
indentLine, indent
joinLines, splitLines
commaList
surround
```

It also owns explicit text-to-number parsing operations that return
`Option` or a typed parse `Result`; parsing never throws.

## 17.4 `"char/verified"`

```pfun
import { chrV } from "char/verified";
```

This module gives preconditioned direct scalar construction for code whose
range has already been established. The ordinary `chr` remains
`Option`-returning.

## 17.5 `"option"` and `"result"`

Named combinators complement the pipeline operators:

```text
Option:
withDefault, mapOption, andThenOption, orElseOption,
fromBool, optionToList

Result:
mapResult, mapErr, andThenResult, collect, combine,
toOption, fromOption
```

Use the named functions when passing the transformation itself as a value or
when the resulting code is clearer than a pipeline.

## 17.6 `"toml"`

The TOML module parses and emits strict Pfun values:

```text
tomlParse : Str -> Result<List<SettingGroup>, TomlError>
tomlEmit  : List<SettingGroup> -> Result<Str, TomlError>
```

Its data model distinguishes setting values, settings, and groups. Parse and
emit failures are typed domain errors.

## 17.7 `"lazy"`

**Provisional surface.** The explicit lazy-list module contains:

```text
isLazy
repeat
iterate
cycle
```

and any separately justified lazy-view operations. It documents forcing and
retention for every export. `take` remains the ambient strict materializer.

## 17.8 Compression and cryptography

Compression uses strict byte values or lifecycle-safe streams and returns
typed binary `Result` errors.

Cryptography exposes reviewed primitives and secure platform randomness. It
does not implement home-grown protocol layers in ordinary library code.
Secrets and binary data use explicit buffer/byte values rather than strings
by accident.

## 17.9 Randomness

Randomness is split into:

- a deterministic pure PRNG that threads explicit state;
- secure platform randomness in a proc module returning `Result`.

This preserves reproducible pure tests without pretending secure randomness is
pure.

## 17.10 Date, time, and locale

Date/time values distinguish instants, local representations, zones, and
durations. Locale-sensitive formatting takes an explicit locale or platform
policy.

Host lookup and unsupported-zone/locale conditions return typed errors. The
V1 implicit-local-time surface is not carried forward unchanged.

## 17.11 HTML, view, and theme values

The web libraries represent semantic content as nominal data:

- HTML content and attributes are typed values;
- `parseHtml` returns a Pfun HTML ADT and follows ordinary tolerant HTML
  parsing rules for malformed markup;
- interactive views associate events with message values or proc handlers at
  an explicit boundary;
- themes express semantic roles rather than raw application-wide string CSS;
- rendering is pure;
- mounting and event registration are procedural.

These modules share the server and browser value model rather than maintaining
unrelated HTML representations.

## 17.12 Library design rules

Every public V2 module:

- uses current V2 syntax and module interfaces;
- uses the ambient `Result`;
- defines domain-specific error unions rather than host message parsing;
- avoids V1 thunk and representation assumptions;
- keeps native declarations private;
- declares forcing and resource behavior;
- includes tested examples;
- does not expose ambient unsafe operations.

---

# 18. Platform modules

## 18.1 Native error family

The completed native error family covers:

| Variant/family | Use |
|---|---|
| `NativeIoError` | Console, file, directory, metadata, and watch failures |
| `NativeProcessError` | Child/runtime launch and process-boundary failures |
| `NativeTimerError` | Scheduling, cancellation, and observed callback failure |
| `NativeJsonError` | Parse and encode failure |
| `NativeBufferError` | Mode, range, encoding, and conversion failure |
| `NativeNumericError` | Selected checked host numeric conversions |
| `NativePlatformError` | Unsupported capability or initialization |
| `NativeHttpError` | Transport, timeout, cancellation, limits, and protocol setup |
| `NativeDbError` | Connection, transaction, query, driver, and row decode failure |

These are recoverable values. Invariant defects are not members of this union.

## 18.2 `"io"`

Console output returns `Result`:

```text
print(value)       -> Result<Unit, NativeError>
println(value)     -> Result<Unit, NativeError>
eprint(value)      -> Result<Unit, NativeError>
eprintln(value)    -> Result<Unit, NativeError>
flushStdout()      -> Result<Unit, NativeError>
```

Input distinguishes EOF from failure:

```text
scanln()    -> Result<Option<Str>, NativeError>
scanChar()  -> Result<Option<Char>, NativeError>
```

`Ok { None }` means clean EOF.

Process/environment operations include:

```text
scriptArgs() -> List<Str>
getEnv(name) -> Option<Str>
envVars()    -> Dict<Str, Str>
exit(code)   -> Unit
```

Target availability is enforced.

## 18.3 `"file"`

Whole-file operations:

```text
readFile(path)            -> Result<Str, NativeError>
writeFile(path, text)     -> Result<Unit, NativeError>
appendFile(path, text)    -> Result<Unit, NativeError>
fileExists(path)          -> Result<Bool, NativeError>
mkdirP(path)              -> Result<Unit, NativeError>
removeFile(path)          -> Result<Unit, NativeError>
renamePath(from, to)      -> Result<Unit, NativeError>
```

Metadata and directory operations cover:

- file-versus-directory tests;
- size and modification time;
- directory listing and creation;
- explicit deletion semantics;
- optional watching with observable lifecycle and errors.

Handle-based operations use opaque `FileHandle` and typed `FileMode` values:

```text
Read
Write
Append
```

Streaming reads return:

```text
ReadOk<T>
ReadEof
ReadErr<E>
```

Binary operations use `Byte`, strict byte lists, or opaque buffers. Closing a
handle is explicit and suitable for `protect`.

## 18.4 `"json"`

JSON parse and encode use typed `Result`, not an `Option` that loses failure
information:

```text
jsonSerialize(value)              -> Result<Str, NativeError>
jsonDeserializeAs(text, witness)  -> Result<Value, JsonDecodeError>
```

`JsonDecodeError` is a combined domain union covering JSON syntax/native
failure and path-aware Pfun schema validation.

The witness identifies the finalized target schema; it is not a dynamic
`Any` value and is not returned as application data.

Decoding:

1. parses JSON syntax;
2. validates the requested Pfun schema;
3. validates field predicates;
4. constructs the nominal value.

Invalid untrusted data returns a path-aware validation error. JSON encoding a
lazy list is a full-forcing operation and therefore contract-safe only when
strictness is known.

## 18.5 `"math"`

The math module provides constants and floating operations:

```text
pi(), e(), tau()
sqrt, pow
exp, log, log10
sin, cos, tan
asin, acos, atan, atan2
sinh, cosh, tanh
```

Float-domain results follow IEEE-754. Integer `abs`, `min`, and `max` retain
integer types; generalized numeric forms use real overload cases rather than
`Any`.

## 18.6 HTTP client

The HTTP client value model includes:

```text
HttpMethod
HttpRequest
HttpResponse
HttpHeaders
HttpBody
HttpError
Cancellation
```

A request specifies:

- method and URL;
- headers;
- strict or explicitly owned streaming body;
- timeout;
- redirect policy;
- response-size limit;
- cancellation.

The response contains a status, headers, and body. A valid non-2xx response is
still a response. `Err` represents transport, timeout, cancellation,
configured-limit, or protocol-boundary failure.

## 18.7 HTTP server

The server surface provides:

- an opaque listener handle;
- explicit startup through `listen`;
- a first-class proc request handler;
- typed request and response values;
- orderly shutdown;
- per-request invariant roots;
- explicit detached-work policy;
- lifecycle-safe streaming.

**Provisional surface.** `listen` returns a setup `Result` containing an
observable listener handle. Shutdown is an explicit proc operation on that
handle. The exact handler and response-writer shape is frozen before the
`serve` command becomes public.

One request's invariant defect abandons that request, logs the defect, and
returns 500 when possible. It does not terminate unrelated requests.

Each request handler runs as its own async task root. Handlers interleave at
`await` points, so one slow request does not block unrelated request logic.

## 18.8 Database common model

Database modules share:

```text
DbValue
DbRow
DbError
DbConnection
DbTransaction
```

`DbValue` represents:

- null;
- Boolean;
- integer;
- the chosen float/decimal policy;
- text;
- bytes;
- explicit temporal values.

Raw driver objects never enter Pfun values.

## 18.9 PostgreSQL and MariaDB

Driver modules provide:

- connection acquisition and release;
- parameterized queries;
- strict row materialization by default;
- optional lifecycle-safe streaming;
- transaction helpers based on `protect`;
- schema introspection;
- portable metadata;
- driver-specific extensions in driver-specific modules.

Typical homes are:

```pfun
import * as Pg from "db/postgresql";
import * as Maria from "db/mariadb";
```

Transactions commit once after normal completion and roll back once on every
abnormal exit.

## 18.10 Schema and model tooling

Schema tools convert database metadata into ordinary Pfun values. Data-model
generation produces parameterized CRUD modules and preserves the distinction
between new and persisted identity, for example with an explicit nominal state
such as:

```pfun
type MaybeId = {
	| New
	| Id: value
}
```

Schema drift can be checked at application startup or by an explicit command.
Generated source is checked by the same V2 compiler and contracts as handwritten
source.

---

# 19. Browser applications and TEA

## 19.1 Browser target

The browser target contains:

- platform-neutral core helpers;
- browser-safe I/O and diagnostics;
- DOM and event glue;
- browser fetch using the HTTP value model;
- invariant handling at application and event roots;
- no Node-only filesystem or process code.

## 19.2 Mount lifecycle

Mounting is procedural. A mount owns:

- the target DOM root;
- registered event handlers;
- active subscriptions;
- browser tasks;
- cleanup on replacement or shutdown.

Unmounting releases every owned listener and resource.

## 19.3 Deterministic message processing

A TEA runtime processes one message at a time:

```text
event -> message -> pure update -> new model + commands -> render -> dispatch
```

Commands may start async work, whose later completion posts another message.
The ordering policy is documented and deterministic for the same event/task
completion sequence.

## 19.4 Browser invariant roots

Each event and detached browser task begins at a root handler. An invariant
defect:

- receives a source-linked report;
- appears visibly in development;
- is written to developer tools;
- stops dispatch into the affected invalid model;
- does not become a normal application message.

## 19.5 The playground

The V2 playground uses the real compiler with an in-memory loader. It supports:

- multiple source files;
- the production checker;
- structured source-linked diagnostics;
- browser-safe build and run;
- replaceable worker or iframe execution;
- stop/restart for runaway code;
- output and invariant reports;
- reproducible import/export or share bundles.

It is not a second interpreter. The first version is not required to be a
package manager, debugger, or deployment service.

---

# Part IV — Toolchain and Guarantees

# 20. Compilation model and command line

## 20.1 One pipeline

Every command uses the production source pipeline:

```text
source files
  -> load and lex
  -> parse
  -> build import graph
  -> collect declarations
  -> infer and finalize types
  -> check purity, exhaustiveness, and contracts
  -> emit typed JavaScript
  -> link for a selected target
```

There is no interpreter shortcut.

## 20.2 Checking

```text
pfc check <entry.pf>
```

`check` loads the full import closure and performs all static checks. It does
not emit, link, or write an artifact.

## 20.3 Running

```text
pfc run <entry.pf> [args...]
```

`run` compiles a Node bundle to a temporary location, executes it with
forwarded arguments and inherited standard streams, returns the program's exit
status, and removes the temporary artifact.

## 20.4 Building

```text
pfc build <entry.pf>
  [--target node|node-bundle|browser]
  [-o <path>]
  [--page <title>]
```

Targets:

| CLI target | Artifact |
|---|---|
| `node` | Multi-file Node program; default `build/` |
| `node-bundle` | One self-contained Node JavaScript bundle; default `pfc.js` |
| `browser` | Browser page artifact; default `index.html` |

`--page` applies only to browser output. The linker escapes the supplied title
before inserting it into HTML.

## 20.5 Serving

```text
pfc serve <entry.pf>
```

`serve` is a thin driver over the public HTTP listener API. It is added only
after listener setup, shutdown, request roots, and streaming ownership are
stable. It does not inject undocumented host globals into an arbitrary proc.

## 20.6 Installation

A release contains:

- an installed compiler launcher;
- the checked-in self-hosting seed;
- required host files;
- the V2 standard library;
- stable runtime-root discovery;
- documented supported Node/browser versions.

An installation does not depend on a source-repository checkout layout.

**Provisional surface.** The final package decides whether `pfc` remains the
public compiler executable or is invoked through a `pfun` launcher. Command
semantics do not depend on that packaging name.

## 20.7 Exit behavior

The command-line contract distinguishes:

- success;
- source/check/build failure;
- usage failure;
- child program exit status for `run`;
- invariant-root software error status 70.

Diagnostics go to stderr. Normal program output remains on stdout.

## 20.8 Self-hosting and fixed points

The compiler is written in Pfun and built by a checked-in V2 seed. A semantic
compiler change is accepted only with an explicit bootstrap checkpoint:

1. build generation 1 with the checked-in seed;
2. build generation 2 with generation 1;
3. compare generated compilers;
4. compare field-schema and invariant manifests for the same source;
5. run the acceptance suites;
6. refresh the checked-in seed deliberately.

Byte-identical output is the normal fixed-point expectation.

---

# 21. Diagnostics, manifests, and invariant reports

## 21.1 Source diagnostics

A diagnostic carries:

```text
severity
code/class
message
path
span
notes
```

Rendered form:

```text
path.pf:line:column: error[Type]: message
```

The CLI includes source excerpts and caret underlining where source text is
available.

## 21.2 Diagnostic classes

The stable classes include:

```text
Lex
Parse
Name
Import
Arity
Type
Purity
Exhaust
Contract
Boundary
Runtime
```

Messages identify a remedy when one is clear. Whole-program field conflicts
name both the declaration identity and relevant evidence sites.

## 21.3 Cascade suppression

An earlier body error may prevent reliable field or overload inference.
The compiler suppresses dependent unresolved-field and groundedness noise
instead of emitting a page of secondary errors.

An explicit dynamic `Any` flow receives its own diagnostic; an ordinary
recovery `Unknown` from a previous error usually does not.

## 21.4 Canonical field-schema manifest

A successful check may emit a deterministic schema manifest containing:

- canonical field identity;
- finalized type;
- generic slot structure;
- provenance summary;
- opaque/public boundary information;
- field predicates.

The manifest:

- uses canonical source/import order;
- is independent of hash iteration and worker scheduling;
- contains no unstable fresh variable identifiers;
- contains no `Any`, `Unknown`, or unresolved operational type;
- is compared across bootstrap generations.

## 21.5 Invariant report

The compiler emits a conservative invariant report containing:

- every executable invariant and contract site;
- a stable site identifier;
- whether the check remains residual;
- possible abandonment boundaries;
- task-root and process-root reachability;
- uncertainty introduced by higher-order or detached flow.

The report does not claim exact runtime path counts. When the analysis is
uncertain, it includes the process/application root rather than making an
unsafe optimistic claim.

## 21.6 Runtime defect reports

A rendered invariant failure includes:

- source path and position;
- callable;
- kind;
- canonical predicate or explicit message;
- relevant handler/root context.

The renderer does not depend on the original whitespace inside a predicate.

## 21.7 Stable generated output

Generated ordering, field keys, predicate rendering, diagnostics, manifests,
and linked module order are deterministic. This is a language-toolchain
guarantee because the self-hosted compiler uses its own output as a fixed-point
artifact.

---

# 22. Portability and host conformance

## 22.1 Shared language behavior

Node-file, Node-bundle, and browser targets agree on:

- strict evaluation and ordering;
- numeric and Unicode semantics;
- list forcing;
- `Option` and `Result`;
- invariant raising and contract checks;
- pure/proc boundaries;
- deterministic generated values.

## 22.2 Platform differences

Platform-specific capabilities are explicit:

- Node supplies files, process facilities, server sockets, and database
  drivers;
- browsers supply DOM, events, browser fetch, and application mounting;
- unsupported imports fail before late runtime reference errors.

`NativePlatformError` is used for a capability that is validly requested
through a portable wrapper but unavailable at runtime. A statically known
wrong-target import is rejected earlier.

## 22.3 Trusted-host conformance

Every trusted host postcondition is tested across all hosts that implement the
intrinsic. Coverage includes:

- integer safe-range edges and bigint promotion;
- float NaN, infinities, and negative zero;
- byte wraparound;
- Unicode supplementary scalars and surrogate offsets;
- lazy finite and infinite lists;
- JSON and buffer failure paths;
- timer and callback roots;
- invariant preservation through broad catches.

## 22.4 Resource behavior

Each platform implementation proves by tests that:

- a resource is released exactly once;
- cancellation is observable;
- cleanup runs on every abnormal exit;
- an invariant sentinel is not translated into a native error;
- detached work cannot leak a raw unhandled rejection;
- one request/event defect cannot corrupt unrelated roots.

---

# Appendix A — V2 grammar

This appendix gives the completed language grammar. It includes the accepted
post-bootstrap additions: proc lambdas, combined unions, all three pipeline
operators, whole-program field predicates, invariants, handlers, protection,
and callable contracts.

Notation:

- `{x}` means zero or more repetitions;
- `[x]` means optional;
- `|` separates alternatives;
- quoted text is a terminal;
- `context("word")` means an identifier token recognized by text only in that
  grammar position.

## A.1 Lexical grammar

```ebnf
comment      ::= "//" { any-not-newline }
               | "/*" { any } "*/"

whitespace   ::= " " | "\t" | "\r" | "\n"

IDENT        ::= (letter | "_") { letter | digit | "_" }
WILDCARD     ::= "_"

keyword      ::= "let" | "var" | "type" | "generic"
               | "if" | "then" | "else"
               | "function" | "proc" | "memo"
               | "async" | "await" | "return" | "fn"
               | "for" | "while" | "dict" | "array"
               | "import" | "export" | "opaque"
               | "as" | "from"
               | "match" | "with" | "where"
               | "extern" | "lazy"
               | "true" | "false"

contextual   ::= "invariant" | "requires" | "ensures"
               | "handling" | "invariants"
               | "protect" | "complete" | "unwind"

INT          ::= digit { digit }
               | "0x" hexdigit { hexdigit }

FLOAT        ::= digit { digit } "." digit { digit } [exponent]
               | digit { digit } exponent

exponent     ::= ("e" | "E") ["+" | "-"] digit { digit }

BYTE         ::= digit { digit } "b"
               | "0x" hexdigit { hexdigit } "_b"

STRING       ::= '"' { strchar | escape } '"'
RAWSTRING    ::= '@"' { any-not-dquote } '"'
FORMATSTRING ::= '$"' { fmtchar | escape | "{" expr "}" } '"'
CHAR         ::= "'" (charchar | escape) "'"

escape       ::= "\\" ("n" | "t" | "\\" | "\"" | "'" | "{" | "}")
```

Block comments do not nest. A byte literal must be from 0 through 255. A
character literal must decode to exactly one Unicode scalar.

Operators and punctuation:

```text
+ + - * / % = == != < > <= >= ! && || & |
|> |?> |!> << >> ( ) { } [ ] , ; : ? . -> => <-
```

## A.2 Programs and statements

```ebnf
program        ::= { stmt }

stmt           ::= importStmt
                 | exportStmt
                 | functionDecl
                 | procDecl
                 | externDecl
                 | letStmt
                 | varStmt
                 | typeDecl
                 | returnStmt
                 | ifStmt
                 | whileStmt
                 | invariantStmt
                 | handlingStmt
                 | protectStmt
                 | assignStmt
                 | exprStmt
                 | ";"

letStmt        ::= "let" IDENT "=" expr ";"
varStmt        ::= "var" IDENT "=" expr ";"

assignStmt     ::= assignTarget "=" expr ";"
assignTarget   ::= IDENT
                 | postfixExpr indexSuffix

exprStmt       ::= expr [";"]
returnStmt     ::= "return" [expr] [";"]

block          ::= "{" { stmt } "}"

ifStmt         ::= "if" expr "then" block
                   ["else" (block | ifStmt)]

whileStmt      ::= "while" "(" expr ")" block [";"]

invariantStmt  ::= context("invariant") expr ";"

handlingStmt   ::= context("handling") context("invariants")
                   block
                   "with" IDENT "->" block

protectStmt    ::= context("protect") block
                   context("complete") block
                   context("unwind") block
```

`var`, assignment, `while`, handlers, and protection are checked as proc-only
forms.

## A.3 Callable declarations

```ebnf
functionDecl   ::= ["generic"] ["memo"]
                   "function" IDENT "(" [params] ")"
                   { requiresClause }
                   [ensuresClause]
                   block

procDecl       ::= ["generic"] ["async"]
                   "proc" IDENT "(" [params] ")"
                   { requiresClause }
                   [ensuresClause]
                   block

params         ::= param { "," param }
param          ::= IDENT | WILDCARD

requiresClause ::= context("requires") expr ";"

ensuresClause  ::= context("ensures") IDENT
                   "{" expr "}"
```

There may be multiple preconditions and at most one postcondition. The
postcondition binder may not shadow a parameter.

## A.4 Types

```ebnf
typeDecl       ::= "type" IDENT "="
                   "{" (recordBody | unionBody) "}"
                   [";"]

recordBody     ::= [fieldDecl { "," fieldDecl }]

fieldDecl      ::= ["generic"] IDENT
                   ["where" expr]

unionBody      ::= unionItem { unionItem }

unionItem      ::= variant | include

include        ::= "..." IDENT [","]

variant        ::= "|" IDENT
                   [":" variantField { "," variantField }]

variantField   ::= ["generic"] IDENT
                   ["where" expr]

typeExpr       ::= namedType
                 | functionType
                 | procType

namedType      ::= IDENT
                   ["<" typeExpr { "," typeExpr } ">"]

functionType   ::= "(" [typeExpr { "," typeExpr }] ")"
                   "->" typeExpr

procType       ::= ["async"] "proc"
                   "(" [typeExpr { "," typeExpr }] ")"
                   "->" typeExpr
```

Normal field predicates may contribute normal type evidence. They may not
specialize an intentionally generic field slot.

## A.5 Imports, exports, and externs

```ebnf
importStmt     ::= "import" importSpec "from" STRING [";"]

importSpec     ::= "{" importName { "," importName } "}"
                 | "*" ["as" IDENT]

importName     ::= IDENT ["as" IDENT]

exportStmt     ::= "export"
                   ( letStmt
                   | functionDecl
                   | procDecl
                   | ["opaque"] typeDecl
                   )

externDecl     ::= "extern"
                   ( "function"
                   | ["async"] "proc"
                   )
                   IDENT
                   "(" [typedParams] ")"
                   "->" typeExpr
                   [";"]

typedParams    ::= typedParam { "," typedParam }
typedParam     ::= IDENT ":" typeExpr
```

An `extern` or `var` declaration cannot appear under `export`.

## A.6 Expressions

```ebnf
expr           ::= pipeExpr

pipeExpr       ::= ternaryExpr
                   { ("|>" | "|?>" | "|!>") ternaryExpr }

ternaryExpr    ::= orExpr
                   ["?" expr ":" ternaryExpr]

orExpr         ::= andExpr { "||" andExpr }
andExpr        ::= equalityExpr { "&&" equalityExpr }

equalityExpr   ::= comparisonExpr
                   { ("==" | "!=") comparisonExpr }

comparisonExpr ::= bitorExpr
                   { ("<" | ">" | "<=" | ">=") bitorExpr }

bitorExpr      ::= bitandExpr { "|" bitandExpr }
bitandExpr     ::= shiftExpr { "&" shiftExpr }

shiftExpr      ::= additiveExpr
                   { ("<<" | ">>") additiveExpr }

additiveExpr   ::= multExpr
                   { ("+" | "-" | "++") multExpr }

multExpr       ::= unaryExpr
                   { ("*" | "/" | "%") unaryExpr }

unaryExpr      ::= ("-" | "!" | "await") unaryExpr
                 | postfixExpr

postfixExpr    ::= primary
                   { callSuffix | indexSuffix | fieldSuffix }

callSuffix     ::= "(" [expr { "," expr }] ")"
indexSuffix    ::= "[" expr "]"
fieldSuffix    ::= "." IDENT

primary        ::= INT | FLOAT | BYTE
                 | STRING | RAWSTRING | FORMATSTRING | CHAR
                 | "true" | "false"
                 | IDENT
                 | recordExpr
                 | listExpr
                 | lazyListExpr
                 | dictExpr
                 | arrayExpr
                 | lambdaExpr
                 | procLambdaExpr
                 | ifExpr
                 | matchExpr
                 | blockExpr
                 | "(" expr ")"
```

## A.7 Constructors and collections

```ebnf
recordExpr     ::= IDENT
                   "{" [fieldInit { "," fieldInit }] "}"

fieldInit      ::= IDENT "=" expr
                 | expr

listExpr       ::= "[" [listContent] "]"
lazyListExpr   ::= "lazy" "[" [listContent] "]"

listContent    ::= expr { "," expr }
                 | expr genClause { genClause } ["where" expr]

genClause      ::= "for" IDENT "<-" expr

dictExpr       ::= "dict"
                   "{" [dictEntry { "," dictEntry }] "}"

dictEntry      ::= expr "->" expr

arrayExpr      ::= "array"
                   "{" [expr { "," expr }] "}"
```

Record/variant initialization is all named or all positional.

## A.8 Lambdas and conditionals

```ebnf
lambdaExpr     ::= "fn"
                   ( params | "(" [params] ")" )
                   "=>"
                   (expr | blockExpr)

procLambdaExpr ::= ["async"] "proc"
                   "(" [typedParams] ")"
                   "->" typeExpr
                   block

ifExpr         ::= "if" expr "then" block
                   "else" block

blockExpr      ::= block
```

Pure lambdas infer their types. Proc lambdas require explicit parameter and
result types and are monomorphic.

## A.9 Matching

```ebnf
matchExpr      ::= "match" expr "with"
                   matchArm { matchArm }

matchArm       ::= "|" pattern
                   ["where" expr]
                   "->" expr

pattern        ::= WILDCARD
                 | IDENT [IDENT | WILDCARD]
                 | listPattern

listPattern    ::= "[" [patternElements] "]"

patternElements
               ::= patternElement
                   { "," patternElement }
                   ["," "..." patternElement]

patternElement ::= IDENT | WILDCARD
```

List patterns do not nest and contain no literal patterns. A rest binder
appears only at the tail and only after at least one explicit element.

## A.10 Semantic restrictions

The grammar intentionally accepts some forms whose legality depends on
context. Static checks enforce:

- `var`, assignment, `while`, proc calls, and `await` capability;
- exact call arity;
- pure comprehension bodies;
- union/list exhaustiveness;
- guarded-arm coverage rules;
- operator types;
- `NonZero` integer divisors;
- `Equatable` and `Comparable`;
- opaque representation access;
- whole-program field grounding;
- contract predicate safety;
- cleanup control-flow restrictions;
- target capability restrictions.

---

# Appendix B — Quick reference tables

## B.1 Callable capability matrix

| Capability | `function` / `fn` | `proc` | `async proc` |
|---|---:|---:|---:|
| Pure calls | Yes | Yes | Yes |
| Create/store proc values | Yes | Yes | Yes |
| Invoke proc values | No | Yes | Yes |
| `var` / assignment | No | Yes | Yes |
| `while` | No | Yes | Yes |
| I/O and mutable modules | No | Yes | Yes |
| `await` | No | No | Yes |
| Raise invariant defect | Yes | Yes | Yes |
| Handle invariant defect | No | Yes | Yes |
| `protect` | No | Yes | Yes |

## B.2 Failure-channel selection

| Situation | Use |
|---|---|
| No element for a valid lookup | `Option` |
| Invalid user or peer input | `Result<_, ValidationError>` |
| File/HTTP/DB/platform failure | `Result<_, DomainError or NativeError>` |
| Clean streaming EOF | `ReadEof` or equivalent explicit state |
| Program state declared impossible | `invariant` / `violation` |
| Compiler/ABI/resource catastrophe | System handler |

## B.3 Field kinds

| Field form | Meaning |
|---|---|
| `field` | One rigid monomorphic type across the complete import closure |
| `generic field` | Hidden type slot instantiated per containing value |
| `field where predicate` | Normal field plus executable validation |
| `generic field where ...` | Initially restricted; predicate may not specialize the slot |

## B.4 Pipelines

| Operator | Wrapper | Stops on | Wrapped success input |
|---|---|---|---|
| `|>` | None | Never | Raw value |
| `|?>` | `Option` | `None` | `Some.value` |
| `|!>` | `Result` | `Err` | `Ok.value` |

All three are transparent before their wrapper first appears.

## B.5 List forcing

| Class | Bounded on an infinite list? | Example |
|---|---:|---|
| `NONE` | Yes | `cons` |
| `PREFIX` | Yes for each finite runtime bound | `nth`, pattern |
| `MODE` | Produces lazily | `map`, `filter` |
| `MATERIALIZE` | Yes for a finite requested count | `take` |
| `SEARCH` | Not necessarily | `find`, `any` |
| `FULL` | No | `reverse`, `reduce`, encode |

## B.6 Visibility

| Declaration | Outside module |
|---|---|
| Private value/type | Invisible |
| `export let/function/proc/type` | Visible |
| `export opaque type` | Nominal identity visible; representation hidden |
| `extern` | Always private |
| `var` | Never exported |
| Compiler unsafe intrinsic | Not in ordinary user interface |

## B.7 Numeric summary

| Type | Division | Overflow/special behavior |
|---|---|---|
| `Int` | Truncates toward zero; divisor must be `NonZero` | Arbitrary precision |
| `Float` | IEEE-754 | NaN and infinity are values |
| `Byte` | Integer-like | Wraps modulo 256 |

## B.8 Root invariant policy

| Root | Default response |
|---|---|
| Node process | Report to stderr; exit 70 |
| Browser app/event | Visible report; stop affected invalid model |
| HTTP request | Log; return 500 if possible; abandon request |
| Detached task/timer | Report through owner/runtime observation channel |

---

# Appendix C — Changes from V1

V2 preserves Pfun's central pure/procedural idea while replacing the original
implementation model.

| Area | V1 | V2 |
|---|---|---|
| Execution | Interpreter and compiler | Compiled only |
| REPL | Present | Not part of core |
| Evaluation | Generally lazy functional core | Strict; explicit lazy lists only |
| String concatenation | `+` overload | `++` string-only |
| List concatenation | Operator-oriented in places | Named functions |
| Functions | Broad implicit polymorphism/currying | Monomorphic and exact-arity by default |
| Polymorphism | Often implicit | `generic` opt-in |
| Proc values | Runtime-oriented purity model | First-class transport; statically effectful invocation |
| Assignment | Could act expression-like | Statement only |
| Errors | Multiple package result shapes and host throws | One ambient `Result`, domain error unions |
| Variant composition | Separate unions | Combined nominal unions |
| Partial reads | Could fail at runtime | `Option` or exhaustive patterns |
| Integer zero division | Runtime risk | `NonZero` or `Option` helper |
| Float ordering | Host-style edge cases | Total order |
| Lazy-list inspection | `isInfinite` | No mathematical infinitude test; scoped `isLazy` representation fact |
| `take` | Historically ambiguous across docs | Strict materializing prefix |
| Fields | Declaration-module/witness-dependent inference | Whole-program rigid normal-field inference |
| `Any` | Permissive boundary behavior | Quarantined and never grounding evidence |
| Invariants/contracts | Not a unified language layer | Executable defects, handlers, cleanup, contracts, field predicates |
| `extern` | Could leak into APIs | Private wrapper boundary |
| Opaque types | Partly conventional | Enforced nominal representation hiding |
| Type runtime | Runtime registry/checks | Static checker and type-directed emission |
| Browser/server | Separate or partial stacks | Shared compiled values, roots, and boundary rules |

## C.1 Porting principles

When porting V1 code:

1. Replace string `+` with `++` or a format string.
2. Replace implicit partial application with an explicit lambda.
3. Add `generic` only where actual polymorphism is intended.
4. Replace unsafe reads with `Option`, patterns, or verified access.
5. Replace package-local results with the ambient `Result`.
6. Put package-specific failures in a domain union.
7. Move effects into procs and keep pure callbacks pure.
8. Replace representation assumptions about lazy values with declared forcing
   behavior.
9. Wrap native code privately and translate every recoverable exception.
10. Remove field witness code after whole-program inference supplies real
    evidence.

---

# Appendix D — Deliberate non-goals and later work

## D.1 Not part of V2

V2 completion deliberately does not add:

- object-oriented classes, inheritance, or method dispatch;
- general lazy evaluation;
- automatic currying from incomplete calls;
- ordinary user-written type annotations for parameters, locals, results, or
  normal fields;
- typeclasses, traits, interfaces, or general row polymorphism;
- exceptions for expected failure;
- a functional record-update expression;
- cached list-length machinery;
- solver-directed type inference;
- a proof that every pure function terminates;
- a requirement that a generic promise-style combinator aggregate every
  sibling failure into one value;
- an interpreter or REPL as a completion requirement.

## D.2 Optional later verification

A later solver may:

- translate safe typed predicates into verification conditions;
- prove some executable checks redundant;
- emit proof and residual-check reports;
- grow from scalar/record reasoning into richer verified libraries.

It never chooses types. A solver timeout or unknown result leaves the dynamic
check in place.

## D.3 Other intentionally later work

These are not V2 completion blockers:

- latent higher-order contracts through arbitrary callable values;
- proof-certificate formats;
- optimizer work beyond correctness-preserving transforms;
- a native-code backend;
- a package registry and dependency solver;
- a debugger;
- an interactive REPL;
- multi-process compiler execution;
- advanced HTTP/2 or HTTP/3 features;
- an ORM policy beyond schema metadata and generated data models.

## D.4 Surface decisions to freeze before publication

The manual adopts the completion specification's default direction for each
remaining API decision:

| Area | Default direction used here |
|---|---|
| `Any` | Remove from ordinary typing; keep only a narrowly audited private boundary token if indispensable |
| `isLazy` | Explicit `"lazy"` module |
| Lazy constructors | Explicit `"lazy"` module with retention/empty-cycle rules |
| Lazy prefix | Keep `take` materializing; add a distinct lazy-view name only for demonstrated use |
| `floor`/`ceil`/`round` | `Option<Int>` on non-finite input |
| Variant constructors | Import-resolved or module-qualified identity |
| Timer completion | Observable handle/task result |
| HTTP listener | Setup `Result` with observable opaque handle and explicit shutdown |
| Streaming | Scoped consumer or explicit close/cancel handle |
| Extern capability | Private declaration plus manifest/linker target capability |
| Installation | Stable launcher and runtime-root discovery independent of checkout |
| Compiler executable | Preserve `pfc` semantics; decide whether installation exposes it directly or through `pfun` |

If one of these defaults changes before the relevant public surface ships, the
corresponding manual section must change with it. No implementation phase may
silently choose a conflicting API.

---

## Closing perspective

Pfun V2 is designed to keep ordinary program logic direct:

- values are strict unless a list is explicitly lazy;
- functions are pure;
- procs own effects;
- absence and expected failure are values;
- invariant defects are loud and structurally contained;
- types and normal field schemas come from real program evidence;
- native code is private and translated;
- resources have explicit lifecycles;
- Node, browser, server, and database programs share one checked language.

The result is a functional language without a requirement to think like a
compiler theorist during ordinary application work—and a procedural language
whose effects cannot quietly leak into everything else.
