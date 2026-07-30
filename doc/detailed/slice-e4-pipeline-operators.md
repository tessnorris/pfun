# Slice E4 — transparent Option and Result pipelines

Slice E4 implements all three low-precedence, left-associative pipeline
operators in the V2 lexer, parser, checker, purity pass, emitter, and host ABI.

## Contract

- `value |> step` is an exact-arity unary call.
- `|?>` is transparent on raw values. Once a stage returns `Option`, it skips
  later stages on `None`, maps raw returns back into `Some`, and flattens
  `Option` returns.
- `|!>` is transparent on raw values. Once a stage returns `Result`, it skips
  later stages on `Err`, maps raw returns back into `Ok`, and flattens `Result`
  returns.
- When two `|!>` stages return different domain errors, the result error slot
  is their least declared combined union.
- Neither operator performs recovery or converts between `Option` and `Result`.
- A proc on the right is still an invocation: it is legal only in proc or
  top-level context.

This permits one operator for a mixed fallible/infallible chain:

```pfun
rows |!> transpose |!> reverse |!> slide |!> reverse |!> transpose
```

## Acceptance

Run:

```sh
scripts/test-v2-slice-e4-pipeline-operators.sh
```

The runner checks a byte-identical compiler fixed point, the complete generated
test corpus, host helper behavior, raw and wrapped pipeline execution through
both `pfc run` and a direct NodeBundle, negative arity and purity diagnostics,
and the canonical modular example output. The aggregate runner discovers E4
automatically.
