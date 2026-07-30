# Slice E5 — native errors

Slice E5 gives fallible native operations a shared structured error type:

```pfun
type NativeError = {
	| NativeIoError: operation, message
	| NativeProcessError: operation, message
	| NativeTimerError: operation, message
	| NativeBufferError: operation, message
	| NativeJsonError: operation, message
	| NativeNumericError: operation, message
	| NativePlatformError: operation, message
}
```

`NativeError` and its variants are ambient. Every variant carries the native
operation name and a human-readable message. The pure ambient accessors
`nativeErrorOperation(error)` and `nativeErrorMessage(error)` are useful when
code does not need to distinguish variants.

This foundation slice migrates the native operations that already returned
`Result` or `ReadResult`: whole-file and handle I/O, binary file operations,
`fileExists`, and `runNodeBundle`. Their failure slots now contain
`NativeError`, and `fileExists` now returns `Result<Bool, NativeError>` so
permission and platform failures are not confused with a missing path.

Timers, console input/output, standalone buffer operations, JSON, and numeric
conversion keep their existing behavior in this slice. Their corresponding
variants reserve one stable error vocabulary for the follow-up behavior
slices; changing callback completion contracts is also separate work.

## Acceptance

Run:

```sh
scripts/test-v2-slice-e5-native-errors.sh
```

The gate requires a byte-identical compiler fixed point, runs the complete
generated unit suite, exercises every `NativeError` variant, verifies real
filesystem failures and both host registries, and rejects the former bare-Bool
`fileExists` contract. The all-slices runner discovers E5 automatically.
