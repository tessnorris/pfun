# Slice B2 — command-line and whole-file effects

This corpus tests the first Node effect boundary for ordinary V2 programs.

## Covered behavior

- `scriptArgs : Proc<List<Str>>`;
- `getEnv : Str -> Proc<Option<Str>>`;
- `fileExists : Str -> Proc<Result<Bool, NativeError>>`;
- `mkdirP : Str -> Proc<Result<Unit, NativeError>>`;
- `writeFile : Str, Str -> Proc<Result<Unit, NativeError>>`;
- `readFile : Str -> Proc<Result<Str, NativeError>>`;
- successful nested-directory creation;
- idempotent `mkdirP`;
- successful write/read round trip;
- missing-file reads represented as `Err`;
- attempts to write to a directory represented as `Err`;
- attempts to create a directory over a file represented as `Err`;
- pure functions cannot call file procedures;
- write content must be `Str`.

The positive program receives its temporary root through `scriptArgs`. The shell
runner owns cleanup, so the Pfun file API does not need a delete operation for
this acceptance slice.

## Run

```bash
bash scripts/test-v2-slice-b2.sh
```

The runner rebuilds the compiler, requires a byte-identical self-rebuild,
executes both argument and no-argument Node bundles, checks negative diagnostics,
and finally runs the B1/Slice A regression gates.
