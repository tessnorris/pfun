# Slice D6 — cancellable one-shot timers

D6 adds typed callback timers after first-class proc values became available.
The platform-neutral builtin module is:

```pfun
import * from "timer";
```

Its effective signatures are:

```text
setTimer      : Int, proc() -> Unit       -> Result<TimerHandle, NativeError>
setAsyncTimer : Int, async proc() -> Unit -> Result<TimerHandle, NativeError>
clearTimer    : TimerHandle               -> Result<Unit, NativeError>
```

`TimerHandle` is opaque. Application code unwraps a successful scheduling
`Result`, may retain and pass the handle back to `clearTimer`, but cannot
manufacture one from an integer or inspect the host timer identifier.

## Semantics

- Timers are one-shot.
- Durations are milliseconds from `0` through `2147483647`, matching `sleep`.
- Invalid durations and scheduler failures are `NativeTimerError` values.
- A zero-duration timer still runs on a later event-loop turn.
- `clearTimer` prevents a pending callback.
- Clearing twice, or clearing after the callback fired, is an idempotent no-op.
- Sync and async callback types remain distinct; the API does not weaken
  `TProc.isAsync` or introduce callable subtyping.
- Scheduling and cancellation are effects. Pure code may transport the proc
  callback or handle but may not call the timer procedures.
- The shared host floor supports NodeBundle and BrowserBundle targets.

Unexpected callback throws and asynchronous rejections are caught by the host
so they do not become uncaught exceptions or unhandled promise rejections. The
opaque handle retains that failure internally for a future observable
completion API. This scheduling `Result` reports only failures known while
scheduling or clearing; it cannot retroactively report a callback failure that
happens after it returned.

Repeating application subscriptions are intentionally not host intervals.
They remain descriptor-driven so subscription sets can be diffed and handled
exhaustively. A one-shot callback may schedule its own successor when a lower-
level repeating loop is appropriate.

## Acceptance

```bash
bash scripts/test-v2-slice-d6.sh
```

The gate checks compiler fixed point, the complete generated suite, sync and
async callback execution, captured mutable state, cancellation and idempotence,
static purity and type failures, duration error Results, direct NodeBundle
execution, and BrowserBundle linkage.
