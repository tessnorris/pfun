# Slice E1 — first-class proc lambdas

This slice adds explicitly typed anonymous procedure values:

```pfun
proc (value: Int) -> Int { value + 1 }
async proc (value: Int) -> Int { value + 1 }
```

Creating, storing, passing, returning, importing, and exporting a proc value is
pure. Calling one remains an effect and is rejected in `function` and `fn`
contexts. Sync and async proc types are distinct, calls use exact arity, and
JavaScript lexical closure cells preserve mutations to captured `var` bindings.

Proc type expressions use `proc(T1, T2) -> R` and
`async proc(T1, T2) -> R`.
