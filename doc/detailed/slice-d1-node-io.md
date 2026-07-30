# Slice D1 — Node console I/O

D1 closes and hardens the console-I/O portion of the Node host floor:

```text
print
println
eprint
eprintln
flushStdout
scanln
scanChar
exit
```

Process arguments and environment remain D5 work. The existing bootstrap
`scriptArgs` and `getEnv` procedures remain available because the compiler and
C3 already depend on them.

## Shared stdin cursor

`scanln` and `scanChar` consume one lazily loaded stdin string and one cursor.

`scanln` accepts LF, CRLF, and bare CR, strips the terminator, returns a final
unterminated line, and returns `Ok(None)` only when no input remains. Actual
read failures return `Err(NativeIoError)`.

`scanChar` consumes one Unicode code point, including supplementary-plane
characters represented by a UTF-16 surrogate pair, and returns `Ok(None)` at
EOF. Its complete type is `Result<Option<Char>, NativeError>`.

## Streams

`print` and `println` use stdout. `eprint` and `eprintln` use stderr. All use
normal Pfun stringification and return `Result<Unit, NativeError>`.
`flushStdout` has the same Result return type.

`exit` delegates the requested status; `pfc run` propagates that status.

## Acceptance gate

```bash
bash scripts/test-v2-slice-d1.sh
```
