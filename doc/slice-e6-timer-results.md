# Slice E6 — timer and async Results

E6 migrates the existing async delay and one-shot timer floor to the shared
native-error contract:

```text
sleep         : Int -> async Result<Unit, NativeError>
setTimer      : Int, proc() -> Unit -> Result<TimerHandle, NativeError>
setAsyncTimer : Int, async proc() -> Unit -> Result<TimerHandle, NativeError>
clearTimer    : TimerHandle -> Result<Unit, NativeError>
```

Expected validation, scheduling, and cancellation failures use
`NativeTimerError`. `sleep` always returns a promise that resolves to `Result`;
it does not reject for these failures. A missing path and a missing timer are
therefore handled the same way at the language level: match `Ok`/`Err`, then
inspect the structured error when needed.

Timer callbacks execute after the scheduling `Result` has already returned.
Unexpected synchronous throws and asynchronous promise rejections are caught
and retained on the opaque host handle, preventing uncaught exceptions and
unhandled rejections. Exposing that later completion as a public value requires
a separate completion/future API and is intentionally not implied by the
initial scheduling `Result`.

## Acceptance

Run:

```sh
scripts/test-v2-slice-e6-timer-results.sh
```

The gate requires a byte-identical compiler fixed point, runs the complete
generated unit suite, checks Node and browser host behavior, tests successful
and failing sleep/scheduling/cancellation, verifies callback rejection
containment, executes the Pfun fixture through `pfc run` and a direct
NodeBundle, and rejects the former bare-`TimerHandle` contract. The all-slices
runner discovers E6 automatically.
