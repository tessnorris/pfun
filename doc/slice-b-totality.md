# Slice B1 implementation notes

## Scope

This first Slice B increment establishes the pure totality floor:

- total list reads;
- total list/string index reads;
- total integer-to-character conversion;
- proof-carrying integer division and modulo;
- Option-returning safe division and modulo.

Whole-file effects, JSON, interactive input, and TOML remain subsequent Slice B
increments.

## Existing runtime floor

The builtin manifest already declares `nth`, `chr`, `nonZero`, `safeDiv`, and
`safeMod` with total signatures. Index expressions already infer `Option` for
lists, arrays, strings, and dicts. The linker already includes the corresponding
host ABI functions.

## Checker change

Previously `/` and `%` followed the same ordinary-numeric path as `+`, `-`, and
`*`. The checker now distinguishes Float operations from Int operations:

- any Float operand keeps IEEE behavior;
- a syntactic nonzero integer literal is accepted in divisor position;
- a syntactic literal zero is rejected;
- a nonliteral Int divisor is rejected;
- a `NonZero` divisor is accepted;
- an unconstrained divisor parameter may infer as `NonZero`.

The emitted operation remains `$divI` or `$modI`; no runtime zero branch is
added for proof-checked Int operations.

## List module change

`head` and `tail` are ordinary Pfun functions in `lib/list.pf`. Both return
`Option`, keeping the ambient runtime floor small and avoiding partial host
intrinsics.
