# Slice C1 — check-only command

Slice C1 adds:

```text
pfc check <entry.pf>
```

The command uses the same production loading and checking path as build:

```text
disk load
  -> lex
  -> parse
  -> import graph
  -> topological order
  -> Pipeline.checkProgram
```

It stops before host-source loading, emission, linking, or artifact writing.

## Exit behavior

- successful check: `0`
- source/check diagnostic: `1`
- command-line usage error: `2`

C1 intentionally preserves the existing `IO.fail` stream behavior. Slice C2
adds `eprint` and `eprintln`, moves compiler diagnostics to stderr, and provides
the stream separation needed by `pfc run`.

## Acceptance gate

```bash
bash scripts/test-v2-slice-c1.sh
```
