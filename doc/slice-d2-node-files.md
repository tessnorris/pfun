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
Result<T, NativeError> = Ok { value } | Err { message }
```

Successful writes, closes, directory creation, and removal carry Unit.

Handle reads use:

```text
ReadResult<T, NativeError> =
  ReadOk { value }
  | ReadEof
  | ReadErr { message }
```

This distinguishes clean end-of-file from an operating-system or decoding
failure.

The error payload is a `NativeError`; file operations produce its
`NativeIoError` variant. `fileExists` also uses `Result<Bool, NativeError>`:
missing paths are `Ok { false }`, while permission and platform failures are
`Err`. See Slice E5 for the shared native-error contract.

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

D2 originally exercised `Result` and `ReadResult` with shared constructor
names. The streaming constructors are now globally distinct, while the checker
continues to resolve match patterns from the statically known subject union.

This is required for:

```text
Result<T, E>     = Ok { value } | Err { message }
ReadResult<T, E> = ReadOk { value } | ReadEof | ReadErr { message }
```

and for user-defined unions that intentionally reuse variant names.
