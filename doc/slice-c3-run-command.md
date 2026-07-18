# Slice C3 — run command

Slice C3 adds:

```text
pfc run <entry.pf> [args...]
```

The command uses the production path:

```text
loadGraph
  -> Pipeline.compileProgram
  -> Link.nodeBundle
  -> runNodeBundle
```

There is no interpreter path.

`runNodeBundle` is a Node-only manifest procedure. The Node host writes the
linked bundle to an OS temporary directory, launches a synchronous child Node
process with inherited stdin/stdout/stderr and forwarded arguments, returns the
child exit code, and removes the temporary directory in a `finally` block.

The driver itself never writes a persistent artifact for `run`.

## Bootstrap bridge

A C2 compiler has the C2 builtin manifest embedded in its bundle and therefore
cannot directly check the final C3 IO floor, which calls `runNodeBundle`.
The C3 gate builds a one-generation bridge from a copied source tree whose
`executeNodeBundle` wrapper is replaced with a typed non-executing stub. The
bridge contains the C3 manifest and can build the final C3 compiler.

## Exit behavior

- successful child: child's exit status
- compile/load/host failure: `1`
- command-line usage error: `2`

## Acceptance gate

```bash
bash scripts/test-v2-slice-c3.sh
```
