# Pfun

Pfun—short for **Procedural-FUNctional**—is a statically checked, compiled
language for writing application logic as pure transformations with explicit
procedural edges.

The basic idea is simple: use functions for computation and procedures for
effects. Pfun enforces that boundary at compile time. Pure code cannot quietly
print, mutate state, read a file, call an effectful callback, or otherwise reach
into the outside world.

Pfun is designed to offer the useful parts of functional programming without
requiring an object-oriented runtime model, pervasive type annotations, or a
second effect language hidden inside the first one.

> [!IMPORTANT]
> Pfun V2 is under active development. The compiler is self-hosted and reaches
> a byte-identical fixed point, but the language and standard library are not
> yet a stable release.

## What Pfun is aiming for

- **A pure functional core and an effectful procedural shell.** `function` and
  `fn` are pure; `proc` is where I/O, mutation, async work, and other effects
  happen.
- **Static guarantees with low ceremony.** Pfun infers ordinary types,
  statically checks purity and match exhaustiveness, and keeps normal code free
  of type annotations.
- **Monomorphic by default, generic by request.** Use `generic` when a function
  or field is intentionally polymorphic.
- **Algebraic data instead of objects.** Records, discriminated unions,
  immutable lists, and exhaustive pattern matching are the main modeling
  tools.
- **Explicit failure values.** Expected absence uses `Option`; recoverable
  failure uses the ambient `Result<Value, Error>` type; native failures use
  structured `NativeError` variants.
- **Readable fallible pipelines.** `|?>` propagates `None`, while `|!>`
  propagates `Err` and preserves combined domain-error types.
- **Strict evaluation by default.** Laziness is explicit and limited to list
  production rather than applied to the entire language.
- **Compiled-only execution.** V2 has one compiler pipeline and no interpreter
  or REPL with separate semantics.
- **JavaScript as a practical target, not a language model.** Pfun currently
  emits Node and browser JavaScript without adopting JavaScript's object,
  exception, or dynamic type systems.

## A small example

```pfun
import * from "io";

function sum(values) {
	match values with
	| [] -> 0
	| [first, ...rest] -> first + sum(rest)
}

proc main() {
	println("sum: " ++ str(sum([1, 2, 3, 4])));
}

main();
```

Output:

```text
sum: 10
```

`sum` is pure and decomposes the list with an exhaustive match. `main` is a
procedure because printing is an effect. The compiler rejects the same
`println` call inside `sum`.

## Current status

The active V2 compiler is written in Pfun under `src/`. The checked-in
`boot/pfc.js` compiler can compile that source into another compiler, which can
then reproduce itself byte for byte.

The current command-line compiler supports:

- Checking a complete reachable module graph
- Building a single-file Node bundle
- Building a multi-file Node program
- Building a browser bundle
- Compiling and running a program directly
- Static type, purity, import, arity, and exhaustiveness diagnostics

Implemented language work also includes first-class synchronous and async proc
lambdas, combined unions, one ambient generic `Result`, transparent Option and
Result pipelines, structured native errors, files and binary buffers, async
sleep, timers, process arguments and environment access, and result-based
console I/O.

The runtime and V2 standard library are still growing. In particular, the
repository-root `lib/` directory is retained as a V1 compatibility/archive
surface; V2 public libraries live under `src/stdlib/`.

## Getting started

### Requirements

- Node.js (a current LTS release is recommended)
- Bash for the test and acceptance scripts
- Git if cloning the repository

No npm installation step is required to run the checked-in V2 compiler.

### Run the language tour

```bash
git clone https://github.com/tessnorris/pfun.git
cd pfun

export PFUN_HOME="$PWD"
node boot/pfc.js run examples/example.pf
```

`examples/example.pf` is the canonical V2 tour. It is split into focused
modules under `examples/example-v2/`.

### Check a program

```bash
export PFUN_HOME="$PWD"
node boot/pfc.js check path/to/program.pf
```

### Build a Node bundle

```bash
export PFUN_HOME="$PWD"
node boot/pfc.js build path/to/program.pf -o output/program.js
node output/program.js
```

`node-bundle` is the default build target. It can also be requested explicitly:

```bash
node boot/pfc.js build path/to/program.pf \
	--target node-bundle \
	-o output/program.js
```

### Build a multi-file Node program

```bash
export PFUN_HOME="$PWD"
node boot/pfc.js build path/to/program.pf \
	--target node \
	-o output/program

node output/program/main.js
```

### Build for the browser

```bash
export PFUN_HOME="$PWD"
node boot/pfc.js build path/to/program.pf \
	--target browser \
	-o output/index.html \
	--page "Pfun Application"
```

### Pass arguments to a program

Arguments after the entry path are available through Pfun's process-argument
API:

```bash
export PFUN_HOME="$PWD"
node boot/pfc.js run path/to/program.pf first second third
```

## Verify the self-hosted compiler

From the repository root:

```bash
mkdir -p output/fixed-point
export PFUN_HOME="$PWD"

node boot/pfc.js \
	build src/drivers/cli.pf \
	-o output/fixed-point/pfc-1.js

node output/fixed-point/pfc-1.js \
	build src/drivers/cli.pf \
	-o output/fixed-point/pfc-2.js

cmp output/fixed-point/pfc-1.js output/fixed-point/pfc-2.js
```

`cmp` should produce no output. That means the two compiler generations are
byte-identical.

## Testing

Run the complete V2 acceptance history:

```bash
scripts/test-v2-all-slices.sh --summary
```

The runner discovers the slice scripts automatically, continues after failures,
and writes its logs beneath `output/all-slices/`. Use `--fail-fast` while
iterating, `--color` to force color, or `--no-color` to disable it.

Run the generated compiler unit suites directly:

```bash
export PFUN_HOME="$PWD"
bash test/run-tests.sh --summary
```

An individual acceptance slice can also be run on its own:

```bash
bash scripts/test-v2-slice-e4-pipeline-operators.sh
```

See [Testing Pfun V2](doc/testing-v2.md) for compiler overrides, output modes,
logs, and CI usage.

## Repository map

| Path | Purpose |
|---|---|
| `boot/pfc.js` | Checked-in self-hosted V2 compiler |
| `src/` | Compiler source, V2 standard library, testing library, and browser namespaces |
| `host/` | Shared, Node, and browser JavaScript runtime ABI |
| `test/` | Generated Pfun unit suites, host tests, and smoke tests |
| `spec/` | Semantic fixtures and acceptance tests organized by implementation slice |
| `scripts/` | Slice-specific and aggregate acceptance runners |
| `examples/` | Canonical language tour and application examples |
| `doc/` | Manuals, architecture, implementation notes, and testing documentation |
| `lib/` | V1 compatibility/archive libraries; not the supported V2 standard library |

## Documentation

- [Pfun V2 reference manual](doc/pfun-v2-manual.md)
- [Pfun V2 architecture](doc/pfun_v2_architecture.md)
- [Bootstrap style guide](doc/bootstrap-style-guide.md)
- [Testing Pfun V2](doc/testing-v2.md)
- [V2 modular example](examples/example-v2/README.md)

The manual and architecture document describe the intended language as well as
implemented behavior. Slice documents under `doc/` and acceptance fixtures
under `spec/` record the exact behavior added at each development step.

## Near-term design direction

Current design work is focused on:

- Rigid whole-program field inference so users and compiler code do not need
  artificial type-witness values
- Executable invariants and function contracts, enforced dynamically before
  any proof system is required
- Gradual static discharge of those checks as a later verifier phase
- Continued migration of native failure paths to structured `Result` values
- Expansion of the V2 standard library and browser/TEA stack

The eventual verifier is deliberately downstream of ordinary type inference:
contracts may contribute normal type constraints, but proof results will never
invent or specialize base types.

## License

Pfun is available under the [MIT License](LICENSE).
