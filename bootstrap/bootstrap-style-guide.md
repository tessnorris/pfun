# Pfun Bootstrap Style Guide

**The V1+V2-compatible subset for writing the self-hosting compiler in `bootstrap/src/`.**

Every rule here exists to preserve one property: a `.pf` source file compiled by
the extended V1 toolchain (`pfun --dialect=bootstrap`) and later by the V2
compiler must **behave identically under both**. During the bootstrap window,
the V1 build is the oracle; any construct whose behavior could differ between
the dialects is excluded, even if both accept it. The golden rule follows from
that: *when in doubt, leave it out.* A slightly more verbose source file costs
minutes; a silent V1/V2 divergence inside the compiler costs a debugging session
against a self-hosted binary.

Rules are marked by how they're enforced:

- **[LINT]** — rejected mechanically by `bootstrapLint` at compile time.
- **[STAGE2]** — accepted by V1, enforced by the V2 checker later. Violations
  compile today and explode at stage2; treat them as errors now.
- **[DISCIPLINE]** — nothing catches it. These are the dangerous ones; they are
  also the reason this document exists.

---

## 1. Syntax essentials

**Semicolons after `let` and `var`, always.** The parser requires them to
disambiguate a following `{`.

**Braces on every `if` branch.** V2's grammar makes blocks mandatory on `if`;
V1 tolerates some unbraced forms but not others (an unbraced `then Some { x }
else None` inside a block is a parse error, while `then a else b` happens to
work). Don't learn the boundary — brace everything:

```
// YES
function imsMax(a, b) {
	if a > b then { a } else { b }
}

// NO — parses in V1 by luck, rejected by V2
function imsMax(a, b) {
	if a > b then a else b
}
```

**Braces on match-arm bodies containing anything but a simple expression.** A
bare `if` after `->` is a parse error. Wrap the arm:

```
| MNode n -> {
	if k == n.k then { Some { n.v } }
	else if k < n.k then { imsGet(n.left, k) }
	else { imsGet(n.right, k) }
}
```

**`while` takes parenthesized conditions and a braced body.** `while (i < n) {
... }`. V2 does not relax this; keep the parens.

**Guards use `where`, never `when`.** Both in match arms
(`| Some v where v.value > 0 -> ...`) and comprehensions
(`[x for x <- xs where x > 0]`).

**No literal patterns in `match`.** V1 arms are variant names, bindings, or
`_` only — `| 0 -> ...` is a parse error. V2's list patterns (`[]`, `[x]`,
`[x, ...rest]`) are a stage2 feature and are **not** in the bootstrap dialect;
do not use them in bootstrap sources. Match on unions; compare scalars with
`if`/`==`.

**Hex byte literals use `_b`: `0xFF_b`.** In the bootstrap dialect `0x1B` is
the Int 27, never a byte. Decimal bytes (`200b`) work in both. [LINT-adjacent:
the dialect flag makes this unambiguous.]

---

## 2. Operators

**`++` for string concatenation; `+` never touches strings.** [LINT catches
the literal-operand cases; the rest is STAGE2.] The desugar makes `++`
byte-identical to V1's string `+` at runtime, so there is no behavioral risk —
only the source-level discipline matters.

**`+` never touches lists either.** [DISCIPLINE — the lint cannot see list
types.] V1's runtime `+` concatenates lists; V2's `+` is numeric-only. This is
a live trap because existing V1 library code (e.g. `runner.pf`'s
`s.tests + [t]`) uses it and *works*, so it looks idiomatic. In bootstrap
sources, build lists with `cons`, comprehensions, `reduce`, or an explicit
append helper.

**Comparisons (`<` `>` `<=` `>=`) are allowed on all scalars** — Int, Str,
Char, Byte — thanks to the V1 comparison extension, which matches V2's
`Comparable`. Never compare records, unions, functions, or lists with ordering
operators. String ordering is UTF-16 code-unit order in both dialects (correct
for identifiers and symbol tables; it is not Unicode collation — do not use it
for anything user-facing).

**`==` on scalars freely; on structured values, compare fields explicitly.**
[DISCIPLINE] V2's Equatable machinery and V1's structural equality do not have
a verified-identical boundary for records and unions. For the compiler this
costs little: token and AST comparisons are almost always tag-plus-scalar-field
checks anyway.

**Guard every division.** V1 throws on zero; V2's `NonZero` divisor typing is
stage2. Bootstrap sources check the divisor first and return a `Result`/default
on zero, so neither dialect's failure path is ever reached.

**No float literals, no float arithmetic.** [LINT] This is the bootstrap-scoped
ban (checklist 11): V2 carries floats as source text through the pipeline, so
compiler-internal float math risks divergence. Positions, counts, sizes, code
points — everything the compiler computes is Int. If you find yourself wanting
a float in the compiler, something is misdesigned. (The ban lapses for ordinary
V2 application code; it is permanent for the bootstrap sources only in the
sense that they never need floats.)

**Int arithmetic is safe.** V1 is bigint throughout; V2's hybrid representation
canonicalizes and preserves semantics. Compiler quantities (offsets, line
numbers, arities) are small; nothing to avoid here beyond not depending on
astronomically large intermediate values for no reason.

---

## 3. Types and data

**Records are nominal. Every record literal names its type.** There is no
anonymous-record syntax; `{ k = 1, v = 2 }` is a parse error in expression
position. Declare a type or use a builtin:

```
type Diag = { code, message, line, col }
let d = Diag { code = "E101", message = m, line = ln, col = c };
```

**Record fields separate with commas**, not semicolons.

**Positional construction is fine when field order is obvious:**
`Pair { n.k, n.v }` (Pair's fields are `key`, `value` in that order). Prefer
named fields when a record has more than two or three.

**Use the builtin `Pair` for key/value carriers** instead of inventing
one-off `Entry` types. Its accessors are `.key` and `.value`.

**Variant construction requires braces or parens — never juxtaposition.**
This one is a landmine: `Some n.v` *type-checks* in V1 and then fails at
runtime with an undefined-name error. Always:

```
Some { n.v }      // brace form (canonical)
Some(x)           // call form (fine)
Some x            // NO — parse error or runtime failure depending on context
```

**Match bindings bind the wrapper; payloads are read by field name.**
`| Some v ->` binds the whole `Some` value; the payload is `v.value` (or
whatever the field is named). This is identical in both dialects and a
recurring source of bugs when forgotten:

```
match imsGet(m, k) with
| None -> dflt
| Some v -> v.value      // NOT just `v`
```

**Write the `generic` markers V2 will require.** `generic function`,
`generic proc`, and `| Some: generic v` payload markers are accepted and
dropped by V1 [STAGE2 gives them meaning]. Annotate anything genuinely
polymorphic now — retrofitting genericity across a compiler later is misery.
Remember V1 monomorphizes: the first use site of an unannotated function fixes
its types program-wide, so under-annotation shows up as baffling
"Cannot unify" errors far from the cause.

**`opaque type` for exported types whose constructors are private.** Accepted
and ignored by V1; meaningful at stage2. Use it where the V2 design calls for
it (e.g. handles, interned symbols) so the source doesn't change later.

---

## 4. Purity, procs, and effects

**Only `fn` lambdas. Never proc lambdas. Never a proc as a value.** [LINT
catches proc lambdas; proc-names-as-values is STAGE2.] Procs are second-class
in V2: callee position only. Do not store a proc in a record field, pass one
as an argument, or return one. If you need "a behavior as a value," it must be
a pure function — or a descriptor value that a proc dispatches over (the
closed-union `Cmd` pattern).

**Assignment is a statement, never an expression.** [LINT]
`let y = (x = 5);` is rejected.

**No `export var`.** [LINT] Module-level mutable state, if you truly need it,
stays private. Prefer threading state through function arguments; the compiler
pipeline is a fold over the program, not a mutable machine.

**Never put a `fn` lambda in the same proc body as an effectful call.**
[DISCIPLINE — this is a V1 purity-checker quirk, not a language rule.] A
lambda anywhere in a proc body makes V1's checker treat the whole proc as
pure, so any effectful call in it is falsely rejected. The workaround is
mechanical: hoist the lambda-building into a pure function and keep the proc
lambda-free.

```
// NO — V1 flags scriptArgs() because of the lambda below it
proc build() {
	let n = length(scriptArgs());
	suite("s", [test("t", fn () => f(n))])
}

// YES — lambdas live in a pure function; the proc has effects only
function mkSuite(n) {
	suite("s", [test("t", fn () => f(n))])
}
proc build() {
	let n = length(scriptArgs());
	mkSuite(n)
}
```

This quirk disappears in V2, but the split shape is legal and idiomatic there
too, so write it this way permanently.

**Nothing throws; every failure is a returned value.** [DISCIPLINE, and the
central architectural rule.] V2's totality principle means the compiler's own
code must model every failure as `Result`/`Option`/error-union data. V1
supports this perfectly well — it's just union types — so write it now:

```
type LexResult = { | LexOk: tokens | LexErr: diag }
type ParseResult = { | ParseOk: ast | ParseErr: diags }
```

Each phase returns its result union; `main` matches and reports. There is no
try/catch in Pfun and there must never be a code path in the bootstrap sources
that *relies* on a builtin throwing. If a builtin can throw (empty-list `head`,
zero division, bad index), you either guard the call or don't use that builtin
at all — see §6.

**Front-load effects; keep the core pure.** File reads, `scriptArgs`, `exit`
happen in a thin proc shell (`main`, a driver proc). Everything between —
lexing, parsing, inference, checking, emission — is pure functions over
immutable data. This is both the V2 architecture and the only shape that
composes with the testing story in §8.

**Signal exit status with `exit(code)`.** The `exit` builtin (0 = success)
exists in both paths now; it is the only sanctioned way for the compiler binary
to report failure to its caller. Effectful; proc context only.

**io names: `scanChar`/`scanln`.** The `read*` names are deprecated V1 aliases
and do not exist in V2. (The bootstrap compiler probably never reads stdin, but
if it grows a REPL, these are the names.)

**No `async`.** The dialect accepts `async proc`, but the async semantics are
exactly the kind of evaluation-order-sensitive machinery the bootstrap window
should not depend on. The compiler is synchronous.

---

## 5. Laziness-indifference

[DISCIPLINE — checklist items 1–5.] V1 and V2 may force thunks at different
times. Bootstrap sources must be **insensitive to evaluation order**, which
pure total code is by construction — so this section is mostly a list of ways
to accidentally break that property:

**No `lazy` anywhere.** [LINT] V1 constructs strictly, V2 lazily; the same
source would allocate different structures.

**No infinite or self-referential data.** Everything the compiler builds is
finite: token lists, ASTs, environments.

**No effects whose *timing* matters outside a proc.** Effects only occur in
procs, where statement order defines sequence in both dialects. A "pure"
function that would misbehave if its argument were forced earlier or later is
a bug even if V1 happens to run it correctly.

**Don't lean on memoization for semantics.** `memo function` is available;
use it only as a performance hint on functions whose arguments are scalars
(V2 gates memo through Equatable), and never write code that would be *wrong*
without the memo.

---

## 6. Lists, strings, and collections — the divergence zone

This is where the dialects genuinely disagree, verified against the V1 source:

V1's `head`/`tail` **throw** on empty input. V2's return `Option`. V1's `nth`
returns the **bare element**, and out of bounds returns **`false`** — a Bool
sentinel, not `None`. V2's `nth` returns `Option`. The same call site cannot
handle both shapes, so:

**Do not call `nth`, `head`, or `tail` in bootstrap sources.** [DISCIPLINE]
Instead, route all element access and decomposition through a tiny compat
module with a dialect-stable surface:

```
// compat.pf — the ONLY file with two per-dialect implementations.
// V1 body shown; the V2 body is a trivial rewrite when V2 lands
// (listAt becomes nth directly, uncons uses list patterns).

export function listAt(xs, i) {
	if i < 0 then { None }
	else if i >= length(xs) then { None }
	else { Some { nth(xs, i) } }      // V1: nth is bare when in bounds
}

export function uncons(xs) {
	if length(xs) == 0 then { None }
	else { Some { Pair { nth(xs, 0), drop(xs, 1) } } }
}
```

Everything else imports `compat` and never mentions `nth` again. One file to
port, everything else dialect-identical. The compat module is the sanctioned
home for any future divergence you discover — keep it small and obvious.

**Prefer whole-structure operations so decomposition is rarely needed.**
`map`, `filter`, `reduce`, comprehensions, `length`, `take`, `drop`, `slice`,
`cons`, `reverse`, `join`, `split` all have identical shapes in both dialects.
A lexer written as a fold needs `uncons` almost nowhere.

**`reduce` is `foldl` with an explicit init** — accumulator first, element
second, front-to-back. There is no `foldr`; don't simulate one with `reverse`
unless the operation is genuinely direction-sensitive, and comment it if so.

**Use `imaps.pf` / `imapi.pf` for maps, never the builtin `Dict`.**
[DISCIPLINE] `dictGet`'s return shape is another V1/V2 divergence, and the
whole point of the AVL modules is that they are *your own code* — identical
source, identical behavior, `Str` and `Int` keyed respectively, one module per
key type because the language is monomorphic. Symbol tables, environments,
interning tables: all imaps/imapi.

**Avoid mutable `Array` in bootstrap sources.** V2 changes `arrSet`'s
contract (returns Bool) and array reads become Option-shaped. Immutable lists
plus imaps cover the compiler's needs; if a phase is ever provably
perf-limited, isolate the array behind a module boundary and treat it like
compat.pf — one file, two implementations.

**Strings are code-unit indexed in both dialects.** `length` on a string is
UTF-16 code units; a `Char` is one code point. `asc`/`chr` convert. For
lexing source text this is exactly what you want (and the lexer walks by
index, guarded by `length`, through the compat accessor).

---

## 7. Modules and cross-module boundaries

**Prefer named imports; use `import * as N` for wide surfaces; avoid bare
`import *`.** Flat star-imports collide with local `let` bindings ("already
defined") and make the collision surface grow with every library change.
Compiler modules should read like `import { lexFile } from "./lexer";` or
`import * as Imaps from "$PFUN_HOME/lib/imaps";`.

**Prefix module-local helpers** (the `ims*` convention) so that even where a
star-import exists, names cannot collide.

**Never re-declare an imported type.** [DISCIPLINE — this one matters.] The
V1 codebase contains a workaround pattern ("re-declare types for match
resolution in this module") that creates a local copy of an imported union.
Under V2's frozen nominal interfaces a local re-declaration is a *different
type* and every match against imported values breaks. The pattern is banned in
bootstrap sources. Cross-module `match` on imported unions works in V1 without
it — the shared-union protocol pattern (`protocol.pf` consumed by client and
server) is proof — so structure the compiler the same way: each phase's types
live in one defining module (`tokens.pf`, `ast.pf`, `diag.pf`), and consumers
import and match on them directly.

**Do not implicitly stringify foreign-typed values.** [DISCIPLINE] The one
cross-module operation verified to fail in V1 is `__str__`/display of a
user-typed value constructed in another module (this is what broke the
cross-module test aggregator). The compiler hits this exactly in diagnostics.
Rule: every type-defining module exports its own rendering function
(`tokenToStr`, `diagToStr`, `typeToStr`), and no other module ever passes a
foreign structured value to string interpolation or `__str__`. Error messages
are built from scalars and pre-rendered strings.

**One module per concern, types with their operations.** `tokens.pf` defines
the Token union, its constructors' invariants, and `tokenToStr`. `parser.pf`
imports it. This is both good design and the shape the V1 boundary rules
reward.

---

## 8. Testing

Bootstrap compiler modules are tested with the annotation-driven harness, and
the testing rules are the purity rules of §4 applied ruthlessly.

**Test files are annotated, main-less, and self-contained per file.** The
generator (`scripts/gen-test-harness.js`) emits the harness and orchestrator;
annotated files must not define `proc main` (the generator rejects it).

**Test bodies are pure functions returning `TestResult` via `assertions`.**
Never procs. Under the totality architecture there is nothing else a test
*could* be: the code under test returns values — including its failures as
`Result`/`Option` values — and the test asserts on them. `assertOk`/`assertErr`
and `assertSome`/`assertNone` are the workhorses; a test for a failure path is
structurally identical to a test for a success path.

```
//![suite("lexer")]
//![test("lexes an identifier")]
function testIdent() {
	match lexFile("foo") with
	| LexErr e -> assertions([assertTrue(false)])
	| LexOk r -> assertions([
		assertEqual(1, length(r.tokens)),
		assertEqual("IdentToken", tokenKind(listAt(r.tokens, 0)))
	])
}
```

(Note the shape: match on the phase's Result union, assert inside the arms,
access elements through compat. A lexer test never touches an effect.)

**Effectful setup goes in a `![suite]` builder proc; captured results thread
into pure tests.** The builder runs effects, returns an inputs record; every
test in that suite takes exactly one parameter (the inputs). The generator
emits the lambda-closing in a pure function precisely so the §4 fn-in-proc
quirk never fires — which is why you write the annotations and *not* the
harness by hand.

```
type GoldenInputs = { srcText, expected }

//![suite("golden files")]
proc goldenInputs() {
	let src = readWholeFile("tests/golden/arith.pf");
	let exp = readWholeFile("tests/golden/arith.expected");
	GoldenInputs { src, exp }
}

//![test("arith golden output matches")]
function testArithGolden(inputs) {
	assertions([assertEqual(inputs.expected, compileToStr(inputs.srcText))]);
}
```

**Pass/fail travels as exit status, nothing else.** `runSuites` exits 0/1;
the generated orchestrator aggregates per-file exit codes and exits nonzero on
any failure. Never scrape stdout for "PASS". Use `--mode compile` in the
orchestrator — it is the verified-reliable path and the only one V2 has.

**Differential tests are the compiler's real suite.** Unit tests cover
modules; the bootstrap gate is the differential harness: compile a corpus with
the V1 toolchain and with the bootstrap-built compiler, diff the outputs. The
per-file/process orchestrator shape extends to this directly (each corpus file
is a test file; the "assertion" is output equality). Keep golden corpus files
*in the bootstrap-safe subset themselves*, or their meaning differs between
the toolchains being compared.

**In test code, all the same rules apply.** Tests are bootstrap sources.
`++` not `+`, compat accessors not `nth`, no floats, no proc-valued anything.
One exception is *framework* code: the current `runner.pf`/`assertions.pf` are
V1-dialect (they use string `+`, list `+`, bare `head`/`tail`) and are known
porting work for V2. Do not imitate the framework internals in your tests; the
framework's contract (annotations in, exit code out) is stable even though its
implementation will be rewritten.

---

## 9. What NOT to include — consolidated, with reasons

**Float literals and arithmetic.** [LINT] Floats-as-text is a V2 pipeline
invariant; compiler-internal float math is both unnecessary and a divergence
vector.

**`lazy`, infinite structures, order-dependent "pure" code.** [LINT for the
keyword; DISCIPLINE for the rest] The dialects force at different times; only
order-insensitive code is portable.

**Proc lambdas; procs stored, passed, or returned.** [LINT / STAGE2] Procs
are second-class in V2. The descriptor-plus-dispatch pattern replaces every
legitimate use.

**Assignment in expression position; `export var`.** [LINT] Statements
mutate; expressions compute; module state is private.

**`+` on strings or lists.** [LINT partially / DISCIPLINE] `++` for strings;
`cons`/`reduce`/append helpers for lists. That V1 happily concatenates lists
with `+` is precisely why this needs stating.

**`nth`, `head`, `tail`, `dictGet`, builtin `Dict`, mutable `Array`.**
[DISCIPLINE] Verified divergent shapes (`nth` even returns `false` out of
bounds in V1). Compat module + imaps/imapi instead.

**Literal and list patterns in `match`.** Not in V1's grammar; V2's list
patterns are stage2. Unions and `if` cover the bootstrap.

**`Some x` juxtaposition; anonymous records; semicolons between record
fields.** Parse errors or — worse, for `Some x` in some positions —
type-checks-then-fails-at-runtime.

**Re-declaring imported types.** V1 workaround, V2 type-identity bug. Restructure
instead (types + renderers in the defining module).

**Implicit stringify of foreign structured values.** The verified V1
cross-module failure. Export `*ToStr` from defining modules.

**`fn` lambdas inside effectful proc bodies.** V1 checker quirk; hoist to a
pure function (the generated-harness shape).

**Guards as exhaustiveness.** V2 does not count guarded arms toward
exhaustiveness. Every match is exhaustive over variants with unguarded arms;
guards only *refine* within an arm. Consequently `matchFail` should be
unreachable by construction.

**`readln`/`readChar`, `when`, `fn` as a parameter name, bare `main()` under
`pfun -i`.** Deprecated alias, wrong keyword, reserved word, and the REPL's
pure-context quirk respectively — each has bitten once already. Tests and
scripts run via `pfun file.pf`, never `-i`.

**Exceptions as control flow.** There is no catch; a throwing builtin
reachable from compiler code is a latent crash in one dialect and a different
crash in the other. Guard or exclude.

**`async`.** Synchronous compiler; async is post-bootstrap surface.

---

## 10. Conventions

Tabs for indentation, matching the existing codebase. `PascalCase` for types
and variants; `camelCase` for functions, procs, and bindings; module-local
helpers carry a module prefix (`imsBalance`, `lexScanHex`). One type-owning
module per phase, with its rendering functions. File names lower-case
(`lexer.pf`, `tokens.pf`); tests `<module>_test.pf`; generated files
`*_gen.pf` and gitignored. Comment the *why* on anything present because of a
rule in this guide — a future reader (possibly the V2 compiler's author, i.e.
you) should never "simplify" a compat call back into `nth`:

```
// via compat, not nth: V1 nth returns bare/false, V2 returns Option (§6)
let c = listAt(chars, i);
```

---

## 11. Open items to verify before leaning on them

Three boundaries are only partially mapped and deserve a probe before the
relevant compiler phase depends on them. First, cross-module `match` on
imported unions is proven by the protocol.pf pattern, but the exact extent of
the stringify failure (does it affect `==` on foreign records? field access in
guards?) hasn't been charted — the §7 rules are conservative enough to not
need the answer, but chart it if you ever feel tempted to relax them. Second,
V1 `==` on records/unions vs V2 Equatable: the guide bans structured equality
[§2]; verify parity before ever unbanning it. Third, `where`-guard evaluation
order when multiple guarded arms could match: both dialects take the first
truthy arm top-to-bottom by spec, but this hasn't been differentially tested —
write matches so at most one arm can match and the question never arises.
