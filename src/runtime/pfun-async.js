'use strict';
// pfun-async.js — runtime support for `import * from "async"` in transpiled Pfun.
//
// In the interpreter, async is powered by the Scheduler and Effect protocol.
// In compiled output, async proc → JS async function and await → JS await,
// so these functions are straightforward Promise wrappers.

const ok   = v => ({ __type: 'Ok',  __union: 'Result', value:   v });
const err  = m => ({ __type: 'Err', __union: 'Result', message: m });

// sleep(ms) — resolves after ms milliseconds, returning Ok { ms }.
async function sleep(ms) {
  if (typeof ms !== 'bigint' && typeof ms !== 'number')
    throw new Error('sleep() requires an Int or Float argument (milliseconds).');
  const delay = typeof ms === 'bigint' ? Number(ms) : ms;
  await new Promise(resolve => setTimeout(resolve, delay));
  return ok(ms);
}

// asyncAll(list) — runs a list of async procs concurrently, returns Ok { List<result> }
// or Err { message } if any rejects. Mirrors Promise.all semantics.
async function asyncAll(list) {
  if (!Array.isArray(list)) throw new Error('asyncAll() requires a list of async functions.');
  try {
    const results = await Promise.all(list.map(f => {
      if (typeof f !== 'function') throw new Error('asyncAll(): each element must be an async function.');
      return f();
    }));
    return ok(results);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

// asyncRace(list) — runs a list of async procs concurrently, returns the
// first to resolve. Mirrors Promise.race semantics.
async function asyncRace(list) {
  if (!Array.isArray(list)) throw new Error('asyncRace() requires a list of async functions.');
  try {
    const result = await Promise.race(list.map(f => {
      if (typeof f !== 'function') throw new Error('asyncRace(): each element must be an async function.');
      return f();
    }));
    return ok(result);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

module.exports = { sleep, asyncAll, asyncRace };
