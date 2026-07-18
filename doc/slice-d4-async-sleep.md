# Slice D4 — async and sleep

D4 closes the first asynchronous host slice:

```text
sleep : Int -> async Proc<Unit>
```

The language already had `async proc`, `await`, asynchronous proc types, and
JavaScript async/await emission. D4 hardens the host primitive and places the
whole path under acceptance tests.

## Duration contract

`sleep(ms)` accepts an integer duration from `0` through `2147483647`
milliseconds.

- Negative durations are runtime errors.
- Larger durations are runtime errors rather than inheriting Node timer
  overflow behavior.
- `sleep(0)` still resolves on a later event-loop turn.
- Successful completion produces Unit.

## Async execution

An awaited async proc suspends its current task until completion.

Calling an async proc without `await` from proc context is legal
fire-and-forget behavior. The callee starts while the caller continues without
waiting for its result.

`await` outside an `async proc` is rejected by the checker.

## Acceptance gate

```bash
bash scripts/test-v2-slice-d4.sh
```
