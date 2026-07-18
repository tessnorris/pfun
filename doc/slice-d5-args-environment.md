# Slice D5 — process arguments and environment

D5 completes the Node process-input floor in the existing `io` builtin module:

```text
scriptArgs : () -> List<Str>
getEnv     : Str -> Option<Str>
envVars    : () -> Dict<Str, Str>
```

All three are Node-only procedures because they observe process state.

## Arguments

`scriptArgs()` returns every command-line argument after the running JavaScript
file. Arguments are preserved exactly, including spaces, empty strings,
Unicode, and values beginning with `-` or `--`.

For:

```text
pfc run program.pf alpha "beta gamma" "" --literal β
```

the program receives:

```text
["alpha", "beta gamma", "", "--literal", "β"]
```

The returned list is a snapshot and does not alias Node's mutable
`process.argv` array.

## Environment lookup

`getEnv(name)` distinguishes an unset variable from an empty variable:

```text
unset       -> None
NAME=""     -> Some { value = "" }
NAME="text" -> Some { value = "text" }
```

The host performs no application-specific normalization of names or values.

## Environment snapshot

`envVars()` copies every visible environment entry into a Pfun
`Dict<Str, Str>`. It never exposes the live Node `process.env` object.

Later changes to `process.env` do not change a previously returned dictionary.
The dictionary itself is an ordinary mutable Pfun dictionary owned by the
caller.

D5 intentionally provides no environment mutation procedures.

## Acceptance gate

```bash
bash scripts/test-v2-slice-d5.sh
```

The gate covers exact argument preservation, pfc-run forwarding, inherited
environment values, empty versus missing variables, Unicode, dictionary
representation, snapshot isolation, proc-only checking, direct NodeBundle
execution, compiler fixed point, and all D4-through-A regressions.
