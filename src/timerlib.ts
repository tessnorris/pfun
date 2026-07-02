// src/timerlib.ts
// Timer utilities for Pfun.
// Register with: loader.registerBuiltin('timer', timerlibFunctions)
// Use with:      import * from "timer";
//
// ─── API ─────────────────────────────────────────────────────────────────────
//
//   setTimer(ms, action) -> Int
//
//     Schedule `action()` to run once after `ms` milliseconds.
//     `action` must be a proc with no arguments.
//     Returns a timer ID (Int) that can be passed to clearTimer to cancel.
//     The action runs as a spawned task so it can use await.
//     Side-effecting — not allowed in pure functions.
//
//   clearTimer(id) -> unit
//
//     Cancel a pending timer by its ID. Safe to call after the timer has
//     already fired (no-op in that case). Side-effecting — not allowed in
//     pure functions.

import { Interpreter, RegistryFunction, PfunFunction } from './interpreter';

// ─── Module-level timer registry ─────────────────────────────────────────────
//
// We store the raw Node Timeout handles in a Map keyed by BigInt ID so that
// clearTimer(id) can look them up. The Map is module-level so it persists
// across multiple Interpreter instances (relevant in tests) — but each entry
// is cleaned up either on fire or on clearTimer, so there's no leak.

let nextTimerId = 1n;
const pendingTimers = new Map<bigint, ReturnType<typeof setTimeout>>();

// ─── Functions ────────────────────────────────────────────────────────────────

export const timerlibFunctions: RegistryFunction[] = [

  // setTimer(ms, action) — fire action() once after ms milliseconds.
  // Returns the timer's Int ID.
  {
    name: 'setTimer',
    arity: 2,
    fn: (args, interp) => {
      if (interp.inPureContext)
        throw new Error("Functions cannot use 'setTimer': side effects are not allowed in pure functions.");
      const ms     = interp.force(args[0]);
      const action = interp.force(args[1]);
      if (typeof ms !== 'bigint')
        throw new Error("setTimer() requires an integer number of milliseconds as the first argument.");
      if (Number(ms) < 0)
        throw new Error("setTimer() requires a non-negative number of milliseconds.");
      // Duck-type check: accept any value with an .execute method (PfunFunction)
      // or plain JS function. Avoids instanceof failing across module instances.
      if (!action || (typeof (action as any).execute !== 'function' && typeof action !== 'function'))
        throw new Error("setTimer() requires a proc (with no arguments) as the second argument.");

      const id = nextTimerId++;

      const handle = setTimeout(() => {
        pendingTimers.delete(id);
        interp.spawnPfunCallback(
          action as PfunFunction,
          [],
          (e: unknown) => {
            const message = e instanceof Error ? e.message : String(e);
            // eslint-disable-next-line no-console
            console.error(`[setTimer] action error (id=${id}): ${message}`);
          },
        );
      }, Number(ms));

      pendingTimers.set(id, handle);

      // Register for cleanup when the interpreter is torn down (e.g. in tests).
      interp._resources.push({
        close: () => {
          if (pendingTimers.has(id)) {
            clearTimeout(pendingTimers.get(id)!);
            pendingTimers.delete(id);
          }
        },
      });

      return id;
    },
  },

  // clearTimer(id) — cancel a pending timer. No-op if already fired or cleared.
  {
    name: 'clearTimer',
    arity: 1,
    fn: (args, interp) => {
      if (interp.inPureContext)
        throw new Error("Functions cannot use 'clearTimer': side effects are not allowed in pure functions.");
      const id = interp.force(args[0]);
      if (typeof id !== 'bigint')
        throw new Error("clearTimer() requires a timer ID (Int) returned by setTimer.");
      const handle = pendingTimers.get(id);
      if (handle !== undefined) {
        clearTimeout(handle);
        pendingTimers.delete(id);
      }
      return undefined;
    },
  },
];
