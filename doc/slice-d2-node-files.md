# Slice D2 — Node text-file I/O

D2 implements the text-file floor needed by `examples/example.pf`:

```text
readFile
writeFile
fileExists
mkdirP
removeFile
fileOpen
fileClose
readChar
readLine
writeChar
writeLine
```

The following remain later work:

```text
fileSize, isDir, renameFile, listDir, watchDir
readByte, readBytes, writeByte, writeBytes
Buffer and buffer/file operations
```

## Result contracts

Whole-file and mutating operations use:

```text
Result<T, Str> = Ok { value } | Err { message }
```

Successful writes, closes, directory creation, and removal carry Unit.

Handle reads use:

```text
ReadResult<T, Str> =
  Ok { value }
  | Eof
  | Err { message }
```

This distinguishes clean end-of-file from an operating-system or decoding
failure.

## Handle model

A Node file handle retains:

- the file descriptor;
- `Read`, `Write`, or `Append` mode;
- closed state;
- a small pending-byte queue.

All text reads share one byte cursor. `readChar` decodes one UTF-8 code point.
`readLine` accepts LF, CRLF, and bare CR and returns the final unterminated
line. This cursor design is intentionally ready for D3 byte operations without
changing the public handle representation.

## Acceptance gate

```bash
bash scripts/test-v2-slice-d2.sh
```

## Shared variant-name resolution

D2 exercises both `Result` and `ReadResult`, which share `Ok` and `Err`.
The checker resolves a match pattern from the statically known union of the
subject rather than from a global variant-name entry. A bound `TVariant` also
uses its recorded `unionName` when resolving payload fields.

This is required for:

```text
Result<T, E>     = Ok { value } | Err { message }
ReadResult<T, E> = Ok { value } | Eof | Err { message }
```

and for user-defined unions that intentionally reuse variant names.
