# Slice E2 — combined unions and unified errors

E2 adds explicit union inclusion with `...UnionName` inside a union body.
Included variants remain owned and emitted by their original declarations;
the combined type is a static supertype used for inference, matching, shared
field access, and generic containers such as `Result<Value, AppError>`.

`main.pf` composes error unions across modules and through a transitive
`DataError` union. It also demonstrates that a field such as `message` is
available directly on the combined value only when every variant has it.

The negative fixtures cover omitted match arms, partial shared fields,
duplicate variants and includes, cycles, unknown/non-union includes,
reverse supertype-to-component flow, and ambiguous least-upper-bound joins.
