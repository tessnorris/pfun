# Slice E3 — unified Result

Slice E3 removes collision-only result unions from the active V2 compiler and
supported library surface. `$builtin/core` is now the sole owner of the ambient
generic `Result<Value, Error>` and its `Ok`/`Err` constructors.

## Contract

- Compiler packages, builtin modules, standard-library modules, and user code
  reuse core `Result`; they do not declare package-prefixed result wrappers.
- Structured failures are domain unions placed in `Result`'s error slot.
- Combined unions supply the least common error type when an operation can
  return failures from more than one domain.
- Semantically richer outcome state machines remain separate types and use
  globally distinct constructors. `ReadResult` therefore keeps its clean-EOF
  state as `ReadOk`/`ReadEof`/`ReadErr`.

Internal records that merely summarize a compiler pass—such as `InferResult`
with type tables and diagnostics—are not success/failure unions and remain
unchanged. Likewise, parser/traversal state records that carry cursor or graph
state are implementation state machines, not public `Result` alternatives.

## Acceptance

Run:

```sh
scripts/test-v2-slice-e3-unified-results.sh
```

The runner rebuilds the compiler to a byte-identical fixed point, runs every
generated Pfun suite, exercises cross-module domain errors through core
`Result`, checks direct NodeBundle behavior, rejects legacy read constructors,
runs Node file-host tests, and audits active sources for removed wrapper names.

The older top-level `lib/` tree is a V1 compatibility/archive surface and is
not part of the supported V2 standard library (`src/stdlib`). Porting those
modules is separate work; their historical result unions do not define the V2
contract.
