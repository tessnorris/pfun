# Pfun V2 modular example

`examples/example.pf` is the canonical V2-native language tour. The modules in
this directory keep each feature demonstration focused and reusable.

## Current modules

- `core.pf` — strict bindings, procedural mutation, exact arity, explicit
  lambdas, ordinary function composition, and tail recursion.
- `strings.pf` — scalar strings, chars, raw strings, format strings, ambient
  string primitives, and the opt-in `"string"` library.
- `lists.pf` — ambient list primitives, list patterns, comprehensions, and the
  opt-in `"list"` library.
- `types.pf` — nominal records, unions, exhaustive matching, Option, and generic
  record fields.
- `pipelines.pf` — ordinary `|>`, transparent Option `|?>`, transparent Result
  `|!>`, raw and wrapped stages, short-circuiting, flattening, and joined errors.
- `combined_errors.pf` — combined unions, shared error fields, nested `Result`
  matching, and exhaustive handling of the flattened error set.
- `procs.pf` — synchronous and asynchronous procedure lambdas as callbacks.
- `timers.pf` — cancellable one-shot timers and awaited callbacks.

The tour is deterministic. It intentionally excludes interactive input, file
I/O, mutable dictionaries/arrays, lazy lists, HTTP, and native-backed libraries
until those V2 runtime layers are ready.

## Build

```bash
PFUN_HOME="$PWD" node boot/pfc.js \
  build examples/example.pf \
  -o output/example.js

node output/example.js
```
