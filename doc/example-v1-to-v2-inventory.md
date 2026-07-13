# `example.pf` V1 → V2 Migration Inventory

**Target branch:** `V2-bootstrap`  
**Source program:** `examples/example.pf`  
**Proposed repository path for this document:** `doc/example-v2-migration.md`

## Purpose

This document turns the existing V1 `examples/example.pf` into an explicit V2
migration backlog.

The old example is not merely a syntax sample. It combines:

- language semantics;
- ambient core functions;
- ordinary Pfun libraries;
- Node host capabilities;
- obsolete interpreter-era behavior;
- APIs that conflict with V2's second-class procedure model.

The migration target is therefore **not** “make the old file compile with the
fewest edits.” The target is:

> Produce a V2-native command-line example that demonstrates the intended V2
> language and library design, while preserving useful behavioral coverage from
> the V1 example.

The original section labels are retained below even though the V1 file numbers
some sections out of order and uses `20` twice.

## Source of truth

This inventory uses:

- `examples/example.pf` from the `V2-bootstrap` branch;
- `pfun-v2-manual.md` for the current V2 language and implementation status;
- `pfun_v2_architecture.md` for normative V2 design decisions;
- `bootstrap-style-guide.md` for already-proven V1/V2 incompatibilities;
- current project state reported after self-hosting and fixed-point bootstrap.

Where the V2 manual is behind the live branch, this document marks the item as a
**project update** rather than silently treating the older status as current.

---

## Disposition legend

| Disposition | Meaning |
|---|---|
| **KEEP** | The concept belongs in V2 and needs little more than house-style cleanup. |
| **REWRITE** | The concept remains, but the V1 source teaches obsolete semantics or syntax. |
| **REDESIGN** | The V1 API conflicts with V2 and needs a different abstraction. |
| **REMOVE** | The feature was deliberately removed from V2. Do not emulate it. |
| **DEFER** | The feature belongs in V2, but should not block the first runnable example. |
| **SPLIT** | One V1 section mixes features with different V2 dispositions. |

## Priority legend

| Priority | Meaning |
|---|---|
| **P0** | Required for the first useful V2 command-line example. |
| **P1** | Required for broad core-language and basic standard-library coverage. |
| **P2** | Host/runtime or larger-library work after the core example is stable. |
| **P3** | Browser/server/application framework work; not part of the first CLI milestone. |

## Implementation status legend

| Status | Meaning |
|---|---|
| **Ready** | Current compiler path should support the intended V2 form end to end. |
| **Partial** | Syntax/checking or part of the runtime exists, but the complete behavior is not ready. |
| **Planned** | Specified but not implemented end to end. |
| **Porting** | Compiler support exists; ordinary Pfun library source still needs migration. |
| **In progress** | Work is actively being applied in the current branch. |
| **Removed** | Intentionally absent in V2. |

---

# 1. Top-level import and execution inventory

The V1 example begins with:

```pfun
import * from "io";
import * from "file";
import * from "foreign";
```

| V1 surface | V2 decision | Required action | Priority | Status |
|---|---|---|---|---|
| Direct execution through the interpreter | **REMOVE** | Rewrite all introductory text around compiled execution. The capstone command is `pfc build`; later `pfun run` is compile-link-execute, never interpretation. | P0 | `build` ready; `run` planned |
| Large file of top-level effects | **REWRITE** | Introduce `proc main()` and split demonstrations into imported modules. Keep top-level execution to one direct `main()` call if the current entry convention requires it. | P0 | Ready |
| `import * from "io"` | **KEEP** | Continue using the builtin module for console and process I/O. Use V2 names such as `scanln`, `scanChar`, and `exit`. | P0 | Ready surface |
| `import * from "file"` | **SPLIT** | Keep simple whole-file operations in the early example. Defer handles, binary I/O, and buffers until their host ABI is complete. | P1/P2 | Partial |
| `import * from "foreign"` in application code | **REMOVE** | Application code must never receive raw JS values. Native-backed libraries use private `extern` declarations and export Pfun values, `Option`, `Result`, opaque handles, or domain unions. | P0 | Design locked |
| Extended list utilities | **REWRITE** | Import with `import * from "list";`; ambient `map`, `filter`, `reduce`, `cons`, `length`, etc. remain no-import language functions. | P0 | In progress |
| Extended string utilities | **REWRITE** | Import with `import * from "string";`; ambient `split`, `join`, `slice`, `length`, etc. remain no-import language functions. | P0 | In progress |

---

# 2. Section-by-section inventory

## Core syntax and strict execution

| V1 section | Disposition | V2-native example | Compiler/runtime dependency | Priority | Status |
|---|---|---|---|---|---|
| **1. Comments & Variables** | **REWRITE** | Keep comments, `let`, `var`, and assignment, but describe `let` as **strict** and evaluated exactly once. Restrict `var` and assignment to procedural contexts. | Strict evaluation; purity and assignment checks. | P0 | Ready |
| **2. Operators & Ternary** | **REWRITE** | Keep numeric arithmetic, comparison, logic, shifts, and `? :`. Replace string `+` with `++` or format strings. Demonstrate `NonZero`/`safeDiv` separately instead of implying arbitrary integer division is always valid. | `++` ready; `NonZero` divisor enforcement partial. | P0/P1 | Partial |
| **3. Control Flow** | **REWRITE** | Keep block-required `if`, procedural `while`, mutation, and early return. Replace expression-position `if` with ternary, helper functions, or a block whose final statement is a trailing `if`. Replace `seq = seq + [x]` with `appendOne`, `cons` plus `reverse`, or another named list operation. | Trailing-if semantics; list library. | P0 | Ready except final list facade validation |
| **14. Strings, Chars & Output** | **MAJOR REWRITE** | Teach `Str` as its own scalar sequence, not `List<Char>`. Remove `head`, `tail`, `cons`, `map`, and `filter` over strings. Character-level work uses `split(s, "")`, `join`, explicit code-point helpers, or the `"string"` library. Replace `printf` with `$"..."` plus `print`/`println`. Match the target `chr : Int -> Option<Char>`. | Final `chr` totality wiring; string library. | P0/P1 | Partial |
| **21. Raw String Literals** | **KEEP** | Preserve the Windows path, regex-like text, and escape contrast examples. Remove any interpreter wording. | Lexer/parser/emitter. | P0 | Ready |
| **22. Split & Join** | **REWRITE** | Preserve string splitting and joining. Do not promise automatic conversion of arbitrary join elements unless that remains the final V2 signature; explicitly map values through `str`/formatting first. Replace all string `+` with `++`. | String/list core intrinsics. | P0 | Ready |
| **20. Format Strings** | **KEEP** | Keep and expand this section. V2 format holes accept the full expression grammar. Use format strings as the preferred migration path for mixed-value V1 concatenation. | Format lexer/parser/emitter. | P0 | Ready |

## Functions, procedures, calls, and recursion

| V1 section | Disposition | V2-native example | Compiler/runtime dependency | Priority | Status |
|---|---|---|---|---|---|
| **4. Functions, Lambdas & Procedures** | **REWRITE** | Teach strict argument evaluation, exact arity, pure `function`/`fn`, effectful named `proc`, and explicit `generic function`/`generic proc`. Remove claims that functions have lazy arguments. Procs are callable names, not values. | Type inference, purity, exact-arity checking. | P0 | Ready |
| **4b. Anonymous Proc Lambdas** | **REMOVE / REDESIGN** | Delete every `proc (...) => ...` example, every proc-valued parameter, and every stored proc closure. Replace simple cases with direct named proc calls. Replace effectful callback APIs with closed descriptor unions and exhaustive dispatch, or with a dedicated driver-owned entry convention. | No implementation should restore first-class procs. | P0 | Removed by design |
| **4c. Pipe Operator** | **REWRITE** | Keep `|>` for exact-arity functions. A named proc may appear on the right side only in proc context. Replace inline string `+` with `++`. Do not use pipe as hidden partial application. | Parser/checker/emitter. | P0 | Ready |
| **5a. Tail-call Optimization** | **KEEP** | Keep direct self-tail recursion, including tail calls in match arms. Add a deep list-pattern recursion example rather than relying only on `if`. Mutual tail recursion remains outside the guarantee unless explicitly added later. | Self-tail-call emission. | P0 | **Project update: fixed-point compiler now exercises match-arm TCO** |
| **5b. Memoization** | **DEFER** | Keep syntax in a small disabled or later section until host memo caches are complete. State that memoization is an optimization only and never changes semantics. | Memo runtime and Equatable cache keys. | P2 | Planned runtime |
| **5c. Currying & Partial Application** | **REMOVE / REWRITE** | V1 automatic currying is gone. Rewrite `clamp(0)(100)` as `fn x => clamp(0, 100, x)`, `map(f)` as `fn xs => map(f, xs)`, and similarly for `filter`, `reduce`, and `take`. | Exact-arity checking. | P0 | Removed by design |

## Lists and collection-oriented pure code

| V1 section | Disposition | V2-native example | Compiler/runtime dependency | Priority | Status |
|---|---|---|---|---|---|
| **6. Lists & Higher-Order Functions** | **REWRITE** | Keep ambient `map`, `filter`, `reduce`, `cons`, `length`, and immutable list literals. Replace partial `head`/`tail` examples with list patterns or explicit `Option` matches. | Option-returning reads still being fully wired. | P0 | Partial |
| **15. Slice, nth & isInfinite** | **SPLIT** | Keep `slice` and `take`. Rewrite `nth` to return `Option`. Remove `isInfinite` from the ordinary semantic example: strict and lazy lists intentionally share one logical type, and representation should not normally leak. | Option reads; lazy runtime. | P1/P2 | Partial |
| **16. find & findSlice** | **REWRITE** | Keep `Option<Int>` search results. Use the final V2 argument order consistently. Search on records is allowed only when the value is `Equatable`. Replace `nth(matches, 0)` with a list pattern or `Option` match. | Equatable constraints and Option. | P1 | Ready/partial read cleanup |
| **17. reverse & length** | **REWRITE** | Keep both as full-forcing operations on finite lists. Do not claim strings are lists; string reversal may remain an explicit string operation if supported. Rewrite `last` with a list pattern, reverse plus pattern, or `Option` indexing. Document that full-forcing an infinite lazy list diverges by contract. | Lazy forcing classes later. | P1 | Core strict behavior ready |
| **11. List Comprehensions** | **KEEP / CLEAN UP** | Keep single and multiple generators and `where`. Replace string `+` with `++`. Mark reusable polymorphic helpers `generic`. Correct stale variable-name mistakes in the V1 sample while porting. | Comprehension checking/emission. | P0 | Ready |
| **12. Infinite Lists** | **REDESIGN / DEFER** | V2 laziness is explicit: `lazy [...]`, not a generally lazy language. Decide whether `iterate`, `repeat`, and `cycle` remain ordinary `"list"`/`"lazy"` library constructors. Remove representation tests. Keep only after memoized lazy cells and PREFIX/MODE/FULL forcing behavior exist. | Lazy list host representation and forcing contract. | P2 | Partial syntax/checking; runtime planned |
| **35. List Utilities** | **PORT NOW** | Replace the old relative `listutils` import with `import * from "list";`. Preserve useful aggregate, search, zip, flatten, merge, and sort coverage. Ambient primitives remain ambient. Add strict/lazy forcing-class notes when lazy lists land. | Expanded `listx`, public facade, library tests. | P0 | In progress |

## Records, unions, matching, and modules

| V1 section | Disposition | V2-native example | Compiler/runtime dependency | Priority | Status |
|---|---|---|---|---|---|
| **7. Records & Custom Types** | **KEEP / REWRITE** | Keep nominal records and all-named or all-positional construction. Replace string `+`. Demonstrate functional update by reconstruction. Across modules, prefer exported constructor helpers until full record shapes in interfaces are no longer a constraint. | Record interface shape is still a tracked refinement. | P0 | Mostly ready |
| **8. Discriminated Unions** | **REWRITE** | Keep records and variants, but explain inferred nominal types rather than a mutable runtime registry. Add `generic` payload fields where reuse requires independent types. Avoid variant-name collisions in the current program-global variant namespace. | Generic payloads ready; variant namespace remains a design constraint. | P0 | Ready with caveat |
| **9. Pattern Matching** | **MAJOR REWRITE** | Keep union and list patterns. Guarded arms **never count toward exhaustiveness**; every variant/list-length domain needs unguarded coverage. Rewrite V1 examples that prove totality using only guarded scalar arms. Prefer explicit renderer functions for foreign module-defined structures. | Exhaustiveness checker. | P0 | Ready |
| **10. Option** | **REWRITE** | Keep ambient generic `Option`. Replace the V1 `safeDivide` body with `safeDiv`, `nonZero`, or a match that carries the proof expected by the checker. Use Option helpers from ordinary library modules where helpful. | Final `NonZero` enforcement and Option-read wiring. | P1 | Partial |
| **19. Modules & Imports** | **REWRITE** | Keep named, aliased, namespace, and bare-library imports. Explain frozen module interfaces and topological checking. Ban the V1 workaround of re-declaring imported types. Keep externs private. Add `"list"` and `"string"` as ordinary Pfun library modules found through `$PFUN_HOME/lib`. | Module graph/interfaces ready; record shapes still a refinement. | P0 | Ready |
| V1 runtime `__type` explanations | **REMOVE FROM USER MODEL** | Do not teach runtime tags as the language's type system. Tags may remain ABI details, but static nominal types and checked patterns are authoritative. | Stable runtime ABI only. | P0 | Design locked |

## Mutable structures, console input, files, and JSON

| V1 section | Disposition | V2-native example | Compiler/runtime dependency | Priority | Status |
|---|---|---|---|---|---|
| **13. Dictionaries** | **REDESIGN / DEFER** | Keep dicts as mutable procedural structures. Reads return `Option`; mutation is proc-only. Do not teach throwing or sentinel reads. Use immutable `imaps`/`imapi` only for compiler internals, not as the user-facing replacement. | Dict host intrinsics and total reads. | P2 | Planned/partial |
| **18. Input** | **REWRITE / ISOLATE** | Use `scanChar` and `scanln`, both returning `Option`. Put blocking input in a separate opt-in example/module so the main conformance run is deterministic and non-interactive. | `io` host operations. | P1 | Ready surface |
| **23. File I/O** | **SPLIT** | First milestone: `readFile`, `writeFile`, `fileExists`, `mkdirP`, all returning `Result`-family values. Later milestone: typed handles, line/char/byte reads, seeks, and buffers. Keep helper procs module-level where possible. | Node file host ABI. | P1/P2 | Partial |
| **24. Arrays** | **REDESIGN / DEFER** | Keep arrays strict, mutable, homogeneous, and proc-only for mutation. Reads return `Option`; writes return `Bool` rather than throwing. Do not retain V1 unchecked indexing behavior. | Array host intrinsics. | P2 | Planned/partial |
| **20. JSON Persistence** | **REWRITE** | Preserve `jsonSerialize : a -> Option<Str>` and `jsonDeserialize : Str -> Option<a>`, composed with file `Result`s. Do not promise round-trip support for functions, handles, lazy sequences, or raw native values. Verify nominal tag reconstruction before using deserialized data as a user record. | JSON host/library conformance. | P1 | Surface ready; conformance needed |

## Bytes and binary I/O

| V1 section | Disposition | V2-native example | Compiler/runtime dependency | Priority | Status |
|---|---|---|---|---|---|
| **25. Bytes & Binary I/O** | **MAJOR REWRITE / SPLIT** | Use decimal bytes or hex with `_b`, e.g. `0xFF_b`. Byte arithmetic wraps modulo 256 instead of raising overflow. `byteOf`/conversion and UTF-8 decoding return `Option` where invalid input is possible. Avoid byte truthiness examples; compare explicitly. Keep binary files and buffers for the later host milestone. | Byte wrapping, conversion totality, buffer/file ABI. | P2 | Partial |

## Ordinary Pfun libraries and native-backed modules

| V1 section | Disposition | V2-native example | Compiler/runtime dependency | Priority | Status |
|---|---|---|---|---|---|
| **26. Date Library** | **PORT / DEFER** | Expose Pfun date records/unions or opaque handles through a private extern wrapper. No raw JS `Date`, no `foreign`, and no shared ad hoc `FOk`/`FErr`. Pure transformations stay functions; “now” and locale/timezone reads are procs. | Date library port plus Node host primitives. | P2 | Planned |
| **27. Random Library** | **PORT / DEFER** | Randomness is an effect. Public random generation should be proc-only or use an explicit state/seed value for a pure generator. Tests assert ranges and invariants, not exact unseeded output. No raw JS RNG value escapes. | Random host/library design. | P2 | Planned |
| **28. String Library** | **PORT NOW** | Replace the old `stringlib` import with `import * from "string";`. Cover trimming, prefix/suffix, replacement, matching, prefix scans, padding, repetition, and search. Keep explicit V2 argument order documented. | Expanded `strx`, public facade, tests. | P0 | In progress |
| **29. HTML Parsing** | **PORT / DEFER** | Keep a pure TagSoup-style parser returning a Pfun ADT. Replace partial list/string operations with list patterns and Option. Define node types in one module; consumers import them rather than re-declaring them. | String/list/Option libraries and record interfaces. | P2 | Planned |
| **30. HTTP Client Extended** | **REDESIGN / DEFER** | Public HTTP operations return `Result` with fully wrapped Pfun request/response records. Remove process-exit hacks and raw native access. A server API cannot accept a proc-valued handler; settle `listen`/entry-module dispatch or descriptor-driven routing first. | `http` builtin module, async runtime, Node host. | P3 for server, P2 for client | Planned |
| **31. Timers** | **REDESIGN / DEFER** | Delete callback-taking timer APIs. For one-shot sequencing use `await sleep`. For subscriptions use descriptor data plus exhaustive dispatch. Timer cancellation should use an opaque handle if exposed. | Async scheduler, timer module, descriptor runtime. | P3 | Planned |
| **32. Compression** | **PORT / DEFER** | Private extern wrapper around host compression. Public API accepts/returns Pfun bytes and `Result`; no JS Buffer escapes. Keep round-trip and malformed-input tests. | Byte/buffer ABI and Node compression host floor. | P2 | Planned |
| **33. Cryptography** | **PORT / DEFER** | Private extern wrapper. Model keys, password hashes, and cipher boxes with opaque/domain types. Random salt/nonce generation is effectful. Every host failure becomes `Result`; no raw JS objects or exceptions escape. | Byte/buffer ABI, random source, crypto host floor. | P2 | Planned |
| **34. TOML** | **PORT EARLY** | This is an excellent pure-language shakedown after list/string/Option/Result. Port parsing and printing to V2 style: `++`, explicit `generic`, total reads, no re-declared imports, and domain-specific parse diagnostics/Result. | Current pure compiler and standard-library floor. | P1 | Planned port |
| Locale/math formatting used by later examples | **PORT / DEFER** | Keep locale reads at effect boundaries; keep deterministic formatting pure when locale/config is supplied explicitly. | Locale wrapper and math host surface. | P2 | Planned |
| Browser-only view/theme/TEA libraries | **DEFER** | They are not required for the command-line `example.pf` milestone. Port after descriptor-based effects, DOM floor, and generated TEA glue. | Browser target and TEA runtime. | P3 | Planned |

---

# 3. Cross-cutting source rewrite ledger

These transformations should be applied systematically rather than discovered
one compiler error at a time.

| V1 pattern | V2 pattern |
|---|---|
| `let x = if c then { a } else { b };` | `let x = c ? a : b;`, or call a helper/block whose final statement is the `if`. |
| `"count: " + n` | `$"count: {n}"`, or `"count: " ++ str(n)`. |
| `xs + [x]` | `appendOne(xs, x)`, another named list operation, or `cons` into a reversed accumulator. |
| `proc x => effect(x)` | Direct named proc call, descriptor union, or dedicated dispatcher. |
| `let f = namedProc;` | Illegal. Call `namedProc(...)` directly from proc context. |
| `f(a)` where `f` expects three args and V1 returns a closure | `fn b, c => f(a, b, c)` or another explicit lambda matching the desired arity. |
| `head(xs)` / `tail(xs)` as bare values | List pattern, or `match head(xs) with Some/None`. |
| `nth(xs, i)` returning an element/`false` | `match nth(xs, i) with Some/None`. |
| Strings passed to list `map`, `filter`, `head`, `tail`, `cons` | `split(s, "")`, string-library operation, or explicit code-point helper; reassemble with `join`. |
| Match with only guarded arms | Add an unguarded arm for every variant/domain or a final wildcard. |
| `0xFFb` | `0xFF_b`. |
| Byte overflow test expecting an exception | Wraparound-value test. |
| `foreignRequire`, `foreignGet`, `foreignCall` in application code | Private extern inside a wrapper module; export only Pfun values/Results/opaque types. |
| Re-declare an imported union locally | Define the type once and import it. |
| Implicitly stringify imported structured values | Call the type-owning module's explicit renderer. |
| Assume an exported helper is automatically polymorphic | Declare `export generic function` or `export generic proc`. |
| Runtime type-registry explanation | Static nominal type and interface explanation. |
| Top-level blocking input in the main example | Separate interactive module/example. |
| One giant sequential file | Small modules plus one capstone `main`. |

---

# 4. Proposed V2 example layout

The old file should remain available as a historical V1 corpus file during the
migration:

```text
examples/
  example-v1.pf
```

The V2 capstone should be modular:

```text
examples/
  example.pf                 # imports modules; proc main; deterministic capstone
  example/
    core.pf                  # strict values, operators, control flow, functions
    strings.pf               # raw/format strings, scalar Str, "string" library
    lists.pf                 # ambient list floor, comprehensions, "list" library
    types.pf                 # records, unions, Option, match, generic declarations
    modules.pf               # import/interface demonstrations
    io.pf                    # deterministic console + whole-file + JSON examples
    mutable.pf               # dict/array/buffer examples, added when runtime lands
    libraries.pf             # TOML/date/random/compress/crypto/html sections
    async.pf                 # sleep/http/timer examples, added last
```

A separate interactive entry avoids making the normal golden run wait for stdin:

```text
examples/example-interactive.pf
```

A separate server example avoids turning the language tour into a long-running
process:

```text
examples/example-http.pf
```

---

# 5. Recommended migration slices

## Slice A — deterministic core language (**P0**)

Include:

- comments;
- strict `let`;
- procedural `var` and assignment;
- numeric/string operators;
- ternary and trailing-if;
- `while`;
- pure functions and `fn`;
- direct named procs;
- exact arity and explicit lambdas;
- pipe;
- self-tail recursion;
- lists, comprehensions, records, unions, Option, and match;
- raw and format strings;
- modules;
- `"list"` and `"string"` libraries.

Explicitly exclude for now:

- memo;
- lazy/infinite lists;
- dicts and arrays;
- file handles and binary I/O;
- async, HTTP, timers;
- large native-backed libraries.

**Gate:**

```bash
node bootstrap-stage2/pfc.js build examples/example.pf -o /tmp/example-v2.js
node /tmp/example-v2.js
```

Output must be deterministic and match a checked-in golden file.

## Slice B — total reads and basic command-line effects (**P1**)

Add:

- final Option-returning `head`/`tail`/`nth`/index/`chr`;
- `NonZero` division behavior;
- stdin in the separate interactive example;
- whole-file operations;
- JSON;
- TOML.

**Gate:** positive behavior tests plus negative diagnostics for illegal partial
assumptions and zero divisors.

## Slice C — mutable and binary runtime (**P2**)

Add:

- dicts;
- arrays;
- buffers;
- binary file operations;
- byte wrapping and UTF-8 boundary tests.

**Gate:** every read is total and every host failure is returned data.

## Slice D — native-backed libraries (**P2**)

Add:

- date;
- random;
- compression;
- cryptography;
- HTML parsing;
- locale.

**Gate:** no exported extern, raw JS object, JS exception, or public `foreign`
operation.

## Slice E — async/network/browser edges (**P3**)

Add separately:

- scheduler and `sleep`;
- HTTP client;
- server/listen entry model;
- timer descriptors/subscriptions;
- TEA/browser modules.

**Gate:** no proc values or callback-shaped public APIs.

---

# 6. Definition of done for every inventory row

A row is complete only when all relevant boxes are checked:

- [ ] V2-native example source exists.
- [ ] The example compiles through the canonical `checkGraph` pipeline.
- [ ] A focused positive behavior test exists.
- [ ] A negative diagnostic test exists for any removed V1 behavior.
- [ ] The emitted program runs under the correct target host.
- [ ] Builtin manifest, emitter intrinsic, and host export agree where relevant.
- [ ] Public native wrappers return only Pfun values, `Option`, `Result`, domain
      unions, or opaque handles.
- [ ] The example does not use raw `foreign`.
- [ ] The example does not pass, store, or return a proc.
- [ ] The example does not use string/list `+`.
- [ ] The example does not rely on automatic currying.
- [ ] The example does not rely on partial reads or sentinel values.
- [ ] Matches have unguarded exhaustive coverage.
- [ ] Polymorphic public declarations are explicitly `generic`.
- [ ] Output is deterministic or the test checks invariants instead of exact
      values.
- [ ] Stage 2 still builds the compiler and the stage 2/stage 3 fixed-point gate
      remains green.

---

# 7. Open design decisions exposed by the inventory

These should be decided before their corresponding sections are ported.

1. **Public server entry model**  
   `httpListen(port, handlerProc)` is illegal under second-class procs. Choose a
   dedicated `listen` declaration/entry convention, generated driver glue, or a
   closed route descriptor interpreted by one named proc.

2. **Timer subscriptions**  
   Decide whether timers are `await sleep`, opaque cancellable handles, TEA-style
   subscription descriptors, or some combination. Do not accept proc callbacks.

3. **Lazy constructor placement**  
   Decide whether `iterate`, `repeat`, and `cycle` are ambient, in `"list"`, or
   in a separate `"lazy"` module. `isInfinite` should not be needed for ordinary
   code.

4. **String character API**  
   Finalize code-point access and conversion names around scalar `Str`,
   `Char`, `split(s, "")`, `asc`, `chr : Option`, and UTF-8 helpers.

5. **Dict/array public surface**  
   Finalize Option-returning reads and Bool-returning writes before porting the
   V1 demonstrations.

6. **Nominal JSON reconstruction**  
   Decide exactly how JSON deserialization obtains or validates a nominal Pfun
   type before the example promises record/union round-tripping.

7. **Variant namespace**  
   The current program-global variant namespace requires disciplined prefixes.
   Decide whether this remains V2 or becomes module-scoped before porting many
   large libraries with common names such as `Ok`, `Err`, `Text`, or `None`.

---

# 8. Immediate next work selected by this inventory

The next implementation slice should be:

1. Validate and finish the new `"list"` and `"string"` modules.
2. Create `examples/example-v1.pf` as the untouched historical source.
3. Replace `examples/example.pf` with a deterministic modular Slice A entry.
4. Port only the P0 rows.
5. Add one microtest for every removed V1 semantic:
   - string/list `+`;
   - proc values and proc lambdas;
   - partial application;
   - expression-position `if`;
   - partial `nth`;
   - guarded-only exhaustiveness;
   - exported/raw native interop.
6. Keep the self-hosting fixed-point gate green after every row.

That gives the project a usable V2 language tour quickly, while the remaining
rows stay visible as an ordered implementation backlog instead of quietly
pressuring the compiler to preserve V1 behavior.
