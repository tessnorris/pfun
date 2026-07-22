# Slice D6 — cancellable one-shot timers

D6 adds the platform-neutral `timer` builtin module on top of first-class proc
values:

```pfun
setTimer(ms, action)       // Result<TimerHandle, NativeError>
setAsyncTimer(ms, action)  // Result<TimerHandle, NativeError>
clearTimer(handle)         // Result<Unit, NativeError>
```

Both scheduling calls return an opaque `TimerHandle` inside `Ok`. Timers fire
once. Clearing a pending timer prevents its callback; clearing an already-fired
or already-cleared timer is an idempotent `Ok`.

Durations use the same contract as `sleep`: `0` through `2147483647`
milliseconds. Validation and scheduling failures use `NativeTimerError` rather
than crashing. Scheduling and cancellation are effects, so they may be called
only at top level or in proc context. Pure code may still create and transport
the callback proc value without invoking or scheduling it.
