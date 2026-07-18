# Slice C2 — stderr output

Slice C2 adds Node-backed procedures to the public `io` module:

```pfun
eprint(value);
eprintln(value);
```

Both use normal Pfun stringification and write only to standard error.

The bootstrap driver floor adds `IO.errorLines(lines)`. `IO.fail(message, code)`
now reports through stderr before calling `exit(code)`. Compiler diagnostics and
usage failures therefore stay off stdout, while successful `check` and `build`
confirmations remain on stdout.

The builtin manifest remains the source of truth. Its `nodeProc` entries are
checked against `bootstrap/host/node.js` by the Node host conformance test.

## Acceptance gate

```bash
bash scripts/test-v2-slice-c2.sh
```

## Bootstrap bridge

The C1 compiler bundle contains the C1 builtin manifest. It cannot directly
type-check a compiler source module that calls the newly added `eprintln`
procedure.

The C2 gate therefore creates a temporary copied bootstrap source tree whose
manifest and Node host include C2, but whose `IO.errorLines` implementation
still calls the older `println`. The C1 compiler can build that bridge. The
bridge then recognizes `eprintln` and builds the final C2 compiler from the
real source tree.

The copied tree lives under `output/slice-c2/bridge-src`; repository source is
not modified during the bridge build.
