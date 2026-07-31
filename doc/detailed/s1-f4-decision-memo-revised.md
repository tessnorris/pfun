# S1–F4 decision memo

**Status:** settled implementation decisions  
**Audited baseline:** repository `main` at `2caf48874c67`  
**Analysis commit:** `a440de1`  
**Purpose:** amendments to §§4, 5, 8, and 9.1 of the Pfun V2 Completion Specification

This memo resolves the S1–F4 implementation questions without changing Pfun’s
governing language goals: ordinary code remains annotation-free, expected
failure remains explicit, and nominal schemas are inferred from the complete
program rather than from witness code.

All blocking language and repository-policy choices discussed during review are
settled here. The only deferred item is a possible precision improvement to
diagnostic recovery; it does not affect language semantics or block any slice.

---

## Part A — Settled maintainer decisions

| # | Decision | Resolution |
|---|---|---|
| A1 | S1 versus F3 sequencing | **Split S1.** S1 ships field-solution refusal and statically decidable builtin cases. Candidate deferral, cascade suppression, and export groundedness land in F3 after program state exists. |
| A2 | Import cycles | **Not legal.** The module graph remains acyclic and `cycleDiag` remains. F2’s stable SCC identities apply only to intra-module recursive binding groups. |
| A3 | Nominal identity | **F0 introduces file-qualified identity.** A nominal type is identified by `(logicalModulePath, typeName)`, never by a bare program-global name. |
| A4 | Variant identity and lookup | **F0 also qualifies variants.** Construction and patterns support `Alias.Variant`; an unqualified constructor must resolve uniquely. Runtime identity is `(logicalModulePath, unionName, variantName)`. |
| A5 | Float-to-Int and rounding APIs | **Total checked functions return `Option<Int>`; verified functions use the `V` suffix.** `floorV`, `ceilV`, `roundV`, and `floatToIntV` return bare `Int` under executable finiteness preconditions. |
| A6 | Rounding ties | **Half values round away from zero.** Every conversion canonicalizes floating `-0` to integer `0`. |
| A7 | String character access | **Two accessors.** `nth` is UTF-16-code-unit indexed and O(1); `charByIndex` is Unicode-scalar indexed and O(n). Both reject malformed surrogate structure as specified in C11. |
| A8 | `TAny` and `ITAny` | **Remove them completely.** `TUnknown` remains only as a diagnostic-recovery type. Native unknown values stay behind typed decoders or opaque handles. |
| A9 | Opaque equality and rendering | **No automatic structural capability outside the defining module.** Opaque values are not automatically equatable, comparable, or printable. The defining module exports named operations when those behaviors are meaningful. |
| A10 | Byte operators | **Fixed-width wrapping arithmetic.** Byte `+`, `-`, and `*` wrap modulo 256. Byte bitwise and shift operations remain Byte-specific; Byte `/` and `%` do not ship in this phase. |
| A11 | Schema manifest policy | **Commit one semantic manifest for the canonical self-hosted compiler build.** Contributor provenance is a separate, uncommitted diagnostic artifact. Other programs and targets have separate inference universes and manifests. |

### A5.1 Exact Float APIs

The immediate total APIs are:

```text
floor      : Float -> Option<Int>
ceil       : Float -> Option<Int>
round      : Float -> Option<Int>
floatToInt : Float -> Option<Int>
```

They return `None` exactly for `NaN`, `+Inf`, and `-Inf`. Every finite Float is
convertible because Pfun `Int` is arbitrary precision. `floatToInt` truncates
toward zero; `floor` and `ceil` have their mathematical meanings; `round`
rounds halves away from zero.

When executable contracts exist, add:

```pfun
function floorV(value)
requires isFinite(value)
{ ... }

function ceilV(value)
requires isFinite(value)
{ ... }

function roundV(value)
requires isFinite(value)
{ ... }

function floatToIntV(value)
requires isFinite(value)
{ ... }
```

Each verified function returns `Int` directly. The `V` suffix is the general
naming convention for an operation whose ordinary form returns `Option` or
`Result`, but whose verified form returns the successful value under an
executable precondition. This is the same convention as `nthV` and `chrV`.

---

## Part B — New slice F0

### 8.x F0 — File-qualified nominal and variant identity

`FieldKey` begins with a module path, so nominal and variant identity must be
equally precise before field inference can rely on it. The baseline checker
uses bare names in `TNamed`, `st.records`, and `st.variants`; merging dependency
shapes can therefore overwrite an unrelated declaration with the same name.
F0 repairs this in isolation.

### B1. Canonical module identity

`logicalModulePath` is checkout-independent:

- project source modules use normalized, forward-slash paths relative to the
  compilation root;
- package modules use their canonical package name plus package-relative path;
- ambient builtin declarations use the reserved logical path `@builtin/core`;
- absolute paths and host-specific separators never enter type identity,
  runtime tags, manifests, or diagnostics intended for comparison.

Two checkouts of the same source tree therefore produce identical identities.

### B2. Nominal and variant identities

Use canonical structured identities:

```text
NominalId = {
    path,
    typeName
}

VariantId = {
    path,
    unionName,
    variantName
}
```

`TNamed` and `ITNamed` carry `NominalId`. Variant constructor, constructed
variant, and pattern types carry `VariantId`; they never recover identity from
the visible spelling later.

Ambient variants have ordinary canonical ownership, for example:

```text
(@builtin/core, Option, Some)
(@builtin/core, Option, None)
(@builtin/core, Result, Ok)
(@builtin/core, Result, Err)
```

Combined unions retain the original `VariantId` of every member. Combining a
union changes the admissible set of constructors, not constructor identity.

### B3. Lookup and qualification

Constructor lookup follows these rules:

1. `Alias.Variant` resolves through the existing module or named-import alias
   to one canonical `VariantId`.
2. An unqualified constructor is accepted only when exactly one visible local,
   named-import, star-import, or ambient declaration has that spelling.
3. Two visible candidates produce an ambiguity diagnostic listing their
   logical module paths; traversal or import order never chooses one.
4. A duplicate declaration within one module remains an error.
5. Construction and pattern lookup use the same resolver.

Types follow the equivalent qualification and ambiguity rules. No registration
step silently overwrites a prior canonical identity.

### B4. Runtime identity

Runtime tags and schema registration use the full structured triple:

```text
[logicalModulePath, unionName, variantName]
```

An implementation may intern or canonically encode the triple, but equality
and matching are defined by its three components. A bare variant name is never
the runtime identity. This is an intentional linker ABI checkpoint.

### B5. F0 tasks

1. Add canonical nominal and variant ids to checker and interface types.
2. Re-key record and variant tables by canonical identity.
3. Add one constructor/type resolver shared by expressions and patterns.
4. Implement alias-qualified construction and matching.
5. Make ambiguity deterministic and diagnostic rather than order-dependent.
6. Thread canonical identity through emission, runtime tags, schema
   registration, formatting, and diagnostics.
7. Reserve and document the ambient builtin module identity.

### B6. F0 acceptance

- Two modules may both declare `State` with a `Ready` variant.
- A third module imports both, constructs both through aliases, and matches
  both correctly.
- An unqualified `Ready` with both variants visible is an ambiguity error.
- Combined unions preserve both original constructor identities.
- A duplicate within one module remains an error.
- Building the same checkout from two filesystem locations produces identical
  compiler output, runtime tags, diagnostics, and schema identity.
- Existing suites and the compiler fixed point remain green.

---

## Part C — S1 decisions

### C1. Candidate calls are not general types

Because multi-case builtin names are not first-class values, candidate sets do
not belong in the general `Type` algebra. Use a callee-specific form:

```pfun
type CandidateCase = {
    caseId,
    params,
    result,
    constraints,
    purity,
    forcing
}

type Callee = {
    | Ordinary: typ
    | Candidates: cases
}
```

`caseId` is stable and appears in deterministic diagnostics. `constraints`
contains requirements such as `Equatable(a)`. `purity` records whether
selecting the case creates an effect obligation. `forcing` records lazy or
mutable observation requirements.

This keeps candidate behavior out of substitution, interface conversion,
free-variable collection, formatting, generalization, instantiation, and every
exhaustive match over `Type`.

### C2. Multi-case builtins are not first-class

Using a multi-case builtin name outside direct call position is rejected:

```pfun
let f = length;
```

produces:

```text
Cannot use multi-case builtin 'length' as a value; wrap it in a lambda.
```

The user may write `fn xs => length(xs)`. This rule is why candidate state can
remain call-specific. The initial candidate inventory includes `length`,
`slice`, `find`, `findSlice`, and the list/string cases of `nth`.

### C3. Candidate viability is isolated and non-committing

For an ordinary callee, argument inference remains left-to-right to preserve
current diagnostic order.

For a candidate callee:

1. Infer all argument expressions once.
2. Probe every arity-compatible case from the same pre-probe substitution.
3. Include parameter, result-context, case constraint, purity, and forcing
   viability in the probe.
4. Discard the substitutions and obligations of every unsuccessful probe.
5. If exactly one case survives, rerun or commit that case only.
6. If no case survives, issue one candidate mismatch diagnostic.
7. During S1, if several cases survive, issue one ambiguity diagnostic.
8. During F3, preserve the unresolved call as a pending candidate call.

An unsuccessful candidate must never bind a type variable or leak a capability
obligation into another candidate.

### C4. Deferred calls have a result variable

F3 represents a still-ambiguous call explicitly:

```pfun
type PendingCandidateCall = {
    site,
    cases,
    argumentTypes,
    resultType,
    context,
    span
}
```

`resultType` is a fresh ordinary inference variable returned to downstream
expressions. When a pending call is reconsidered, each candidate probe unifies
its own result with that variable. Downstream uses can therefore select, for
example, the `Str` or `List<a>` result of `slice` without prematurely choosing
a case.

Case-local `Equatable`, effect, or forcing obligations are emitted only after
one case is selected. An unresolved or mismatched call never produces orphan
case obligations.

### C5. Recovery types cannot determine data shape

At S1 close, `TAny` and `ITAny` no longer exist. `TUnknown` is retained solely
to continue checking after an earlier diagnostic. It may not:

- bind a normal `TFieldVar`;
- instantiate a `generic` field slot authoritatively;
- discharge equality, comparison, numeric, callable, rendering, indexing, or
  decoder-schema obligations;
- appear in a finalized interface, export, or semantic schema manifest.

When a construction contains recovery evidence, its nominal result type is
retained for cascade control, but the affected field remains unbound. The
recovery fragment is never an authoritative schema contributor.

### C6. Remove `TAny` and `ITAny`

S1 removes:

- `TAny` and `ITAny` variants;
- source parsing and formatting of `Any`;
- permissive `Any` unification;
- automatic equality/comparison approval through `Any`;
- builtin signatures that use `Any`;
- interface conversion arms and groundedness shortcuts for `Any`.

Native code that genuinely handles unknown host values must expose either a
typed decoder returning a Pfun value or an opaque handle with named operations.
Future extern declarations cannot introduce a user-visible dynamic top type.

Diagnostics use single quotes around program names consistently.

### C7. Export operational groundedness

No ordinary export is operationally ground through a recovery type. The
`startsWith`, `endsWith`, `contains`, `indexOf`, `replace`, and `nullOrEmpty`
regressions must retain concrete signatures after their old `Any`-based
builtin relationships are replaced. Final export-groundedness enforcement
lands in F3, as specified by A1.

---

## Part C′ — S2 decisions

### C8. Opaque interfaces retain explicit opacity

An exported opaque type’s final interface retains:

- canonical nominal identity;
- an explicit opaque marker;
- visible generic arity and type arguments;
- exported constructors or named observer operations, if any;
- no private record or variant representation.

The defining module retains its full internal shape. An importer receives a
specific diagnostic such as:

```text
Cannot access field 'value' because 'PositiveInt' is opaque.
```

rather than the misleading claim that the type simply has no such field.

Outside the defining module, opacity does not automatically grant equality,
comparison, or rendering. If those operations are meaningful, the defining
module exports named functions such as `sameHandle` or `handleText`.

### C9. Operational grounding of opaque types

An opaque nominal head is representationally ground without revealing its
shape. Its visible type arguments and requested capabilities remain subject to
ordinary operational-groundedness rules.

Thus `OpaqueHandle` can be emitted without its private fields, while an opaque
`Box<a>` whose public observer returns `a` cannot hide an unresolved `a` where
code generation needs a concrete capability.

### C10. Byte and Int never unify

`TByte` does not unify with `TInt`; there are no implicit mixed Byte/Int
operators. Explicit conversions are:

```text
byteOf  : Int -> Option<Byte>
byteToInt : Byte -> Int
```

`byteToInt` is lossless. `byteOfV : Int -> Byte` may later be added under
`0 <= value && value <= 255`.

The Byte operator table is:

| Expression | Operand types | Result | Semantics |
|---|---|---|---|
| `a + b` | `Byte, Byte` | `Byte` | `(a + b) mod 256` |
| `a - b` | `Byte, Byte` | `Byte` | `(a - b) mod 256` |
| `a * b` | `Byte, Byte` | `Byte` | `(a * b) mod 256` |
| `a & b` | `Byte, Byte` | `Byte` | Bitwise AND |
| `a \| b` | `Byte, Byte` | `Byte` | Bitwise OR |
| `a << b` | `Byte, Byte` | `Byte` | Left shift, masked to eight bits; counts `>= 8` yield zero |
| `a >> b` | `Byte, Byte` | `Byte` | Logical right shift; counts `>= 8` yield zero |
| `a == b`, `a != b` | `Byte, Byte` | `Bool` | Byte equality |
| `<`, `<=`, `>`, `>=` | `Byte, Byte` | `Bool` | Unsigned numeric order |
| `/`, `%` | — | — | Not defined for Byte in this phase |

Negative shift counts are impossible because the count is a Byte. Arithmetic
and bitwise emission use Byte-specific host helpers; Int helpers are not reused
through coercion. Unary `-` and `~` are not defined for Byte in this phase.
Wrapping applies to arithmetic overflow, not to division by zero or mixed-type
conversion.

### C11. UTF-16 and Unicode-scalar access

Pfun `Str` stores UTF-16 code units. `length` and `slice` count code units, and
`slice` may therefore create an isolated surrogate.

```text
nth         : Str, Int -> Option<Char>
charByIndex : Str, Int -> Option<Char>
```

`nth` is code-unit indexed and O(1):

- negative and out-of-range indexes return `None`;
- a BMP scalar beginning at the index returns `Some`;
- a valid high/low surrogate pair beginning at the index returns `Some`;
- an index on the low half of a valid pair returns `None`;
- either kind of unpaired surrogate returns `None`.

`charByIndex` is Unicode-scalar indexed and O(n):

- negative and out-of-range scalar indexes return `None`;
- a surrogate pair occupies one scalar index;
- if malformed UTF-16 is encountered while scanning to the requested scalar,
  the operation returns `None` rather than skipping or replacing it;
- malformed data after an already reached scalar does not invalidate the
  returned earlier scalar.

“Scalar indexed” is the normative term. Neither operation claims grapheme
cluster indexing.

---

## Part C″ — F1–F4 decisions

### C12. Inference levels land in F1

F1 adds levels to ordinary inference variables and gives program field
variables the outermost program level. Unifying a type with `TFieldVar` lowers
every nested variable to that level, preventing later generalization or
freshening. `declarationFreeVars` remains temporarily as a defensive check.

F0 establishes nominal identity; F1 establishes `FieldKey`, `TFieldVar`, and
nested rigidity. Keeping those responsibilities separate makes both bootstrap
checkpoints measurable.

### C13. `bindField` widens variants

Like `bindVar`, `bindField` widens a constructed `TVariant` to its owning union
before binding. A field constructed only with one variant is therefore typed
as the union, preserving uniform exhaustiveness behavior at access sites.

### C14. `FieldKey` stays structured

Internally:

```text
FieldKey = {
    path,
    typeName,
    variantName,
    fieldName
}
```

`variantName` is absent for record fields. Maps compare structured components;
they do not depend on a supposedly impossible separator character.

When a textual key is unavoidable, encode the four components as a canonical
JSON array with ordinary JSON escaping. Sorting compares the tuple components
directly. `\x1f` is not a delimiter: Unix filenames may contain it.

### C15. Purity and exhaustiveness straddle infer/finalize

During inference:

- report syntactically certain effect violations;
- record type-dependent purity obligations for deferred callees, mutable or
  lazy observation, and candidate-case effects;
- do not guess those obligations from unresolved types.

During finalization:

- resolve type-dependent purity obligations;
- run exhaustiveness against finalized union types;
- suppress these finalization-dependent diagnostics when program inference is
  incomplete.

Purity therefore remains partly in inference, but it is not wholly
type-independent.

### C16. Recovery distinguishes collection, bodies, and programs

Track at least:

```text
collectionComplete(module)
bodyComplete(body)
programInferenceComplete
```

- A module with a complete declaration collection may publish a provisional
  interface even when one body fails.
- A module with parse, import, duplicate-declaration, or declaration-shape
  failure does not have a trustworthy provisional interface; dependents are
  skipped with an import/dependency diagnostic.
- Evidence from a successful body may participate in inference.
- Evidence from an erroneous or skipped body is non-authoritative: it cannot
  settle a field, create a field-conflict diagnostic, enter a final interface,
  or appear in the schema manifest.

The initial implementation uses one program-wide completion flag. If any
reachable required body is incomplete, suppress all finalization-dependent
diagnostics and publish neither final interfaces nor a schema manifest. Local
syntax and type diagnostics that do not depend on finalization still report.

### C17. Schema and provenance are separate artifacts

Constraint provenance is retained through finalization for diagnostics. It
contains spans, contributor roles, containment paths, and candidate/member
ordinals. It may be emitted as an optional uncommitted provenance report and
may change when witnesses or equivalent constructions are removed.

The canonical semantic schema manifest contains no source spans or contributor
sites. It records only semantic facts:

- exact target and root set;
- each structured `FieldKey`;
- normal or generic status;
- finalized type or legitimate symbolic field identity;
- common-field equality relations;
- stable executable-predicate identity when predicates are present.

Deleting a witness must leave this semantic manifest unchanged. A changed
provenance report is expected and is not a schema regression.

### C18. Contributor ordering is total

Diagnostics choose “first concrete contributor” and “conflicting contributor”
by this total order:

1. logical module path;
2. start offset;
3. end offset;
4. contributor role;
5. containment path;
6. candidate or member ordinal.

Line and column are rendered locations, not the complete ordering key. The
order is deterministic under traversal reordering and added unrelated imports.

### C19. Operational grounding uses capability obligations

Equality and rendering do not automatically require exposing a complete
representation. They create operational obligations:

- `==` and `!=` require `Equatable`;
- ordering requires `Comparable`;
- `__str__` requires the language’s rendering capability;
- numeric, callable, indexing, schema generation, and host ABI operations
  require their corresponding concrete capabilities.

An unresolved field is rejected only when an obligation cannot be discharged.
Opaque types receive no automatic structural obligations outside their
defining module; callers use exported named operations instead.

This avoids both under-grounding and needlessly materializing an opaque or
symbolic representation.

### C20. `FieldCommon` performs real unification

A common-field access unifies the actual field variables of every member
variant. It never returns `TUnknown` merely because several variants are
involved.

The semantic manifest records the stable equality relation among the member
`FieldKey`s, not the access span that happened to force it. Access spans remain
in provenance for diagnostics. Adding or removing semantically redundant
accesses therefore does not create schema churn.

### C21. Manifest scope is one complete program

Every compiler invocation defines its own inference universe:

```text
complete program =
    requested entry roots
    + target-specific generated roots
    + their transitive import closure
    + builtins used by that closure
```

Requested entry roots are open-ended user input. Only compiler-generated
additions are a closed, versioned list for each target:

- Node linker roots for a Node build;
- browser runtime roots for a browser build;
- test harness roots for a test build;
- compiler ABI roots for a compiler bootstrap.

The compiler, unrelated tests, and browser applications are not merged into
one program. A field may therefore specialize differently in separate valid
programs without cross-program conflict.

### C22. Canonical manifest policy

The committed baseline artifact is the deterministic semantic manifest for one
documented canonical self-hosted compiler invocation. It includes the builtin
and stdlib declarations reachable from that invocation and identifies:

- schema format version;
- compilation target;
- requested roots;
- generated roots;
- canonical sorted semantic entries.

A broader stdlib conformance check may produce a separate named manifest. Test
files and browser applications produce separate ephemeral manifests unless a
specific conformance baseline is deliberately added later.

The manifest is deterministic JSON sorted by structured identity and declared
field order. It contains no fresh-variable ids, map iteration order, absolute
paths, contributor spans, or timestamps.

### C23. Witness inventory is useful but not magically exhaustive

Extend `scripts/baseline-inventory.mjs` with all conventionally named
`*Witness*` functions. Use that inventory as F4’s generated worklist and
regression count.

Also audit signature anchors, synthetic constructions, and witnesses without
the naming convention. The generated inventory is a reliable named baseline,
not proof that every semantic witness was discovered automatically.

Each witness removal must preserve the canonical compiler schema manifest.
Changes to optional contributor provenance are allowed.

---

## Part D — Amended slice tasks and acceptance

### D1. Explicit phase order

The dependency order through this work is:

```text
S0 -> F0 -> S1 -> S2 -> F1 -> F2 -> F3 -> F4
```

F0 precedes every field-key and candidate change so all later types and
diagnostics use canonical identity. S1 removes dynamic typing paths before F1
allows program-wide field binding. S2 settles opacity and scalar/numeric
semantics before operational grounding is finalized.

### D2. S1 acceptance

- `TAny` and `ITAny` no longer exist.
- `TUnknown` cannot bind either a normal field or a generic slot
  authoritatively.
- The candidate builtins expose real case sets with stable case ids.
- Valid list, string, array, and dictionary uses retain their real types.
- A multi-case builtin used as a value is rejected with the lambda guidance.
- A statically decidable candidate call commits exactly one case.
- Failed candidate probes leak no substitutions or obligations.
- The `slice`-into-field arithmetic example is rejected statically.
- Fixed point and all existing suites remain green.

Candidate deferral, final cascade suppression, and export operational
groundedness remain F3 work.

### D3. S2 acceptance

- Importers receive explicit opaque-type diagnostics and cannot observe private
  representation.
- Opaque values acquire no automatic structural equality, ordering, or
  rendering.
- Float conversion and rounding functions follow A5 and A6, including
  non-finite `None`, half-away-from-zero, and `-0 -> 0`.
- Byte/Int mixed operations are rejected.
- Every Byte operator follows the C10 table and Byte `/` and `%` are rejected.
- `nth(Str, Int)` and `charByIndex` pass BMP, surrogate-pair, negative,
  out-of-range, isolated-surrogate, and sliced-malformation fixtures.

### D4. F1 acceptance

- `FieldKey` is structured and checkout-independent.
- `TFieldVar` is rigid, never generalized, instantiated, freshened, or
  defaulted.
- Variables nested under a field solution are lowered to program level.
- Variant field contributors widen to their owning unions.
- Fixed point and existing suites remain green.

### D5. F2 acceptance

- The import graph remains acyclic.
- Intra-module binding-group SCCs receive stable identities.
- Declaration collection produces provisional interfaces only for modules with
  complete declaration shape.
- Reachability uses the requested roots plus the closed generated-root list for
  the selected target.
- Two distinct targets or entry-root sets remain separate inference universes.

### D6. F3 acceptance

- Pending candidate calls expose result variables to downstream inference and
  resolve to exactly one case before finalization.
- Type-dependent purity obligations resolve after type finalization.
- Erroneous body evidence never settles a field or creates an authoritative
  conflict.
- An incomplete program publishes no final interfaces or semantic manifest and
  suppresses all finalization-dependent diagnostics.
- No ordinary export is operationally ground through `TUnknown` or an
  undischarged capability obligation.
- Field conflicts use the total contributor ordering.

### D7. F4 acceptance

- Final interfaces contain resolved field schemas and explicit opacity.
- `FieldCommon` unifies actual member field variables.
- The canonical self-hosted compiler manifest is committed and deterministic.
- Compiler generations at fixed point produce byte-identical output and
  semantically identical manifests.
- Conventionally named witness inventory is generated, remaining witness forms
  are audited, and every removal preserves the semantic manifest.
- Optional provenance may differ after witness removal without failing schema
  acceptance.

---

## Part E — Bootstrap checkpoints

Refresh the checked-in seed only at the close of **F0**, **S1**, **F1**, and
**F3**, after that slice’s complete acceptance gate passes. “Checkpoint” does
not authorize replacing the seed with an unverified compiler.

For each core semantic checkpoint:

1. The previously checked-in seed builds generation 1 from the changed source.
2. Generation 1 builds generation 2 from the same source.
3. Generation 2 builds generation 3 from the same source.
4. Compare generation 2 with generation 3 byte-for-byte.
5. Compare the generation-2 and generation-3 semantic manifests.
6. Run the complete test and slice suite with the fixed-point compiler.
7. Only then replace the checked-in seed with the verified generation.

If the prior seed cannot parse or check the changed source, the slice must first
introduce a seed-compatible bridge. Hand-copying an unverified generated
compiler is not a bootstrap strategy.

The checked-in seed may become stale during a checkpoint; the requirement is
that it can build generation 1 and that generations produced by the new
compiler reach the code and manifest fixed points.

---

## Part F — Remaining non-blocking refinement

No language-design or repository-policy decision remains open for S1–F4.

One diagnostic precision improvement is deliberately later:

- **Per-field taint.** The first F3 implementation uses the conservative
  program-wide `programInferenceComplete` gate. After provenance is measured,
  the compiler may suppress finalization diagnostics only for fields whose
  contributor closure touches an incomplete body. This may improve recovery,
  but it must not change the schemas accepted from a complete program.
