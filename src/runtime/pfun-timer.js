// pfun-timer.js
// Runtime shim for `import * from "timer"` in transpiled Pfun programs.
// Drop this file in src/runtime/ alongside the other pfun-*.js shims.
//
// In compiled output there is no Interpreter or spawnPfunCallback — the
// action proc is a plain curried JS function. We call it directly, catching
// errors and logging them to stderr.

'use strict';

let nextTimerId = 1n;
const pendingTimers = new Map();

// setTimer(ms, action) — fire action() once after ms milliseconds.
// Returns a BigInt timer ID.
function setTimer(ms, action) {
  if (typeof ms !== 'bigint')
    throw new Error("setTimer() requires an integer number of milliseconds as the first argument.");
  const millis = Number(ms);
  if (millis < 0)
    throw new Error("setTimer() requires a non-negative number of milliseconds.");
  if (typeof action !== 'function')
    throw new Error("setTimer() requires a proc (with no arguments) as the second argument.");

  const id = nextTimerId++;

  const handle = setTimeout(() => {
    pendingTimers.delete(id);
    try {
      // action is a compiled proc with no arguments — call it directly.
      const result = action();
      // If the action returns a Promise (async proc), catch errors from it.
      if (result && typeof result.then === 'function') {
        result.catch(e => {
          process.stderr.write(`[setTimer] async action error (id=${id}): ${e instanceof Error ? e.message : e}\n`);
        });
      }
    } catch (e) {
      process.stderr.write(`[setTimer] action error (id=${id}): ${e instanceof Error ? e.message : e}\n`);
    }
  }, millis);

  pendingTimers.set(id, handle);
  return id;
}

// clearTimer(id) — cancel a pending timer. No-op if already fired or cleared.
function clearTimer(id) {
  if (typeof id !== 'bigint')
    throw new Error("clearTimer() requires a timer ID (Int) returned by setTimer.");
  const handle = pendingTimers.get(id);
  if (handle !== undefined) {
    clearTimeout(handle);
    pendingTimers.delete(id);
  }
  return undefined;
}

module.exports = { setTimer, clearTimer };
