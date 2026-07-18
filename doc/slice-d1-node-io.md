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
unterminated line, and returns `None` only when no input remains.

`scanChar` consumes one Unicode code point, including supplementary-plane
characters represented by a UTF-16 surrogate pair, and returns `None` at EOF.

## Streams

`print` and `println` use stdout. `eprint` and `eprintln` use stderr. All use
normal Pfun stringification and return Unit. `flushStdout` returns Unit.

`exit` delegates the requested status; `pfc run` propagates that status.

## Acceptance gate

```bash
bash scripts/test-v2-slice-d1.sh
```
