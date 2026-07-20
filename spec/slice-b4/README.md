# Slice B4 — interactive input and permission failures

B4 completes the remaining basic Node input boundary and folds in the stronger
permission-denied test deferred from B2.

## Interactive procedures

```text
scanln   : Proc<Option<Str>>
scanChar : Proc<Option<Char>>
```

The acceptance programs are never executed with an attached terminal. Every
invocation receives an explicit pipe and is wrapped in `timeout`, so the suite
cannot wait for user input.

Covered behavior:

- a normal line;
- an empty line as `Some("")`, distinct from EOF;
- a final line without a trailing newline;
- CRLF stripping for `scanln`;
- ASCII, multibyte Unicode, and supplementary-plane Unicode characters;
- EOF as `None`;
- `scanln` and `scanChar` sharing one input cursor;
- pure functions being unable to call either procedure.

## Actual permission denial

B2 already covered missing files and invalid path shapes as `Err`. B4 creates a
file inside a directory the test process cannot traverse and asserts that both
`readFile` and `writeFile` report an `EACCES` `Err`.

For an ordinary user, the runner uses a mode-000 directory. When run as root, it
copies the standalone test bundle under `/tmp` and drops to the `nobody` user
with `setpriv` or `runuser`, so root privileges cannot bypass the test.

## Run

```bash
bash scripts/test-v2-slice-b4.sh
```

The runner rebuilds to a fixed point, runs every input program with explicit
stdin, performs the real permission-denied test, checks purity diagnostics, and
then runs the complete B3 → B2 → B1 → A regression chain.
