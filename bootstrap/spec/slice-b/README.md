# Slice B1 — total reads and safe integer division

This is the first executable portion of Slice B.

## Positive behavior

The positive bundle verifies:

- `head` and `tail` from the opt-in `"list"` module return `Option`;
- ambient `nth` returns `Option`;
- list and string index expressions return `Option`;
- `chr` returns `Option<Char>`;
- nonzero integer literals are accepted directly as `/` and `%` divisors;
- negative nonzero integer literals are accepted;
- `nonZero` supplies a statically proven `NonZero` divisor;
- `safeDiv` and `safeMod` return `Option<Int>`;
- literal float division by zero remains IEEE-total.

## Negative diagnostics

The negative programs verify:

- literal zero cannot be an Int divisor;
- an ordinary `Int` variable cannot be an Int divisor;
- the diagnostic names all three remedies;
- `nth`, index reads, `chr`, and `head` cannot be consumed as bare values.

## Run

```bash
bash scripts/test-v2-slice-b.sh
```

The runner builds a compiler containing the changes, requires a byte-identical
self-rebuild, executes the positive Node bundle, checks every negative program,
and then reruns the Slice A gate when it is available.
