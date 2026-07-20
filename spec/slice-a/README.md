# Slice A — ordinary strict application code

This corpus is the executable gate for the first V2 application-language slice.

## Positive coverage

`main.pf` and `helper.pf` jointly cover scalar literals and operators, strict
`let`, procedural mutation and `while`, ternary and trailing-if values, pure
functions and lambdas, exact arity, records, unions, field access, guarded and
exhaustive matching, full-expression format strings, raw strings, direct
procedures, imports, and linked Node execution.

## Negative coverage

- `exact_arity_too_few.pf`
- `exact_arity_too_many.pf`
- `guarded_only_match.pf`
- `pure_calls_proc.pf`

## Run

```bash
bash scripts/test-v2-slice-a.sh
```

The runner builds a compiler containing the changes with the existing stage-2
compiler, then rebuilds the compiler with itself and requires byte-identical
output before testing the programs.
