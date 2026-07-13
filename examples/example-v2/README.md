# Pfun V2 modular example

`examples/example-V2.pf` is the V2-native language tour.

The original `examples/example.pf` remains untouched because the V1 compiler
tests still use it.

## Current modules

- `core.pf` — strict bindings, procedural mutation, exact arity, explicit
  lambdas, ordinary function composition, and tail recursion.
- `strings.pf` — scalar strings, chars, raw strings, format strings, ambient
  string primitives, and the opt-in `"string"` library.
- `lists.pf` — ambient list primitives, list patterns, comprehensions, and the
  opt-in `"list"` library.
- `types.pf` — nominal records, unions, exhaustive matching, Option, and generic
  record fields.

This first slice is deterministic. It intentionally excludes interactive input,
file I/O, mutable dictionaries/arrays, lazy lists, async operations, HTTP, and
native-backed libraries until those V2 runtime layers are ready.

## Build

```bash
PFUN_HOME="$PWD" node bootstrap-stage2/pfc.js \
  build examples/example-V2.pf \
  -o output/example-V2.js

node output/example-V2.js
```
