// src/asynclib.ts
// Minimal async utilities. Currently just `sleep` — a real-timer-based
// async primitive (a Promise that resolves after a delay), useful both as a
// standalone utility (`await sleep(1000)`) and as the canonical
// non-deterministic-timing primitive for testing the scheduler (step 6):
// concurrent tasks that `sleep` for different durations should interleave
// rather than block each other.
//
// Register with: loader.registerBuiltin('async', asynclibFunctions)
// Use with:      import * from "async";

import { RegistryFunction } from './interpreter';

export const asynclibFunctions: RegistryFunction[] = [

  // sleep(ms) — returns a Promise that resolves to nil after `ms`
  // milliseconds. `await sleep(ms)` suspends the current task for `ms`ms
  // without blocking the event loop, so other tasks (e.g. other in-flight
  // HTTP request handlers under httpserver.listen) continue to make
  // progress while this task is asleep.
  //
  // Side-effecting (consumes real wall-clock time / schedules a timer) —
  // disallowed in pure functions, same as the other procedural natives.
  { name: 'sleep', arity: 1, fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'sleep': side effects are not allowed in pure functions.");
    const ms = interp.force(args[0]);
    if (typeof ms !== 'bigint') throw new Error("sleep() requires an integer number of milliseconds.");
    const millis = Number(ms);
    if (millis < 0) throw new Error("sleep() requires a non-negative number of milliseconds.");
    return new Promise<void>(resolve => setTimeout(resolve, millis));
  }},
];
