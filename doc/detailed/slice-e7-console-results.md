# Slice E7 — console and stdin Results

E7 makes recoverable console and standard-input failures explicit in the
ambient native error model:

```text
print(value)     : proc Result<Unit, NativeError>
println(value)   : proc Result<Unit, NativeError>
eprint(value)    : proc Result<Unit, NativeError>
eprintln(value)  : proc Result<Unit, NativeError>
flushStdout()    : proc Result<Unit, NativeError>
scanln()         : proc Result<Option<Str>, NativeError>
scanChar()       : proc Result<Option<Char>, NativeError>
```

Successful writes and flushes return `Ok(Unit)`. A clean stdin end-of-file is
still `Ok(None)`, which keeps ordinary EOF distinct from an actual read error.
Node standard-stream writes complete synchronously at the file-descriptor
boundary, so closed-pipe and other write failures are observable before the
procedure returns. Stream, input, stringification, and browser-console failures
return `Err(NativeIoError { operation, message })`.

The compiler's final diagnostic and exit paths intentionally discard a failed
diagnostic write: after stderr itself has failed, there is no remaining console
channel on which to report that second failure.

## Acceptance gate

```bash
bash scripts/test-v2-slice-e7-console-results.sh
```

The runner checks a compiler fixed point, the complete generated unit suite,
Pfun-level stdin/stdout/stderr behavior, direct Node bundle behavior, injected
host failures, the browser surface, and rejection of the legacy bare-`Option`
stdin contract.
