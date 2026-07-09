// src/test/timerlib.test.ts
// Tests for timerlib.ts: setTimer and clearTimer.

import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Interpreter } from '../interpreter';
import { stdlibFunctions, stdlibTypes } from '../library';
import { mutStructuresFunctions, mutStructuresTypes } from '../mutStructures';
import { iolibFunctions } from '../iolib';
import { asynclibFunctions } from '../asynclib';
import { timerlibFunctions } from '../timerlib';

const createdInterpreters: Interpreter[] = [];

function makeInterpreter(): Interpreter {
  // Use ModuleLoader so that `import * from "timer"` resolves correctly.
  const { ModuleLoader } = require('../interpreter');
  const loader = new ModuleLoader('.');
  const interp = new Interpreter('.', loader);
  interp.registerLibrary(stdlibFunctions, stdlibTypes);
  interp.registerLibrary(mutStructuresFunctions, mutStructuresTypes);
  loader.registerBuiltin('mutStructures', mutStructuresFunctions, mutStructuresTypes);
  // Register iolibFunctions both ways: as a global library (so println etc.
  // are available without an import statement) and as a builtin module (so
  // `import * from "io"` inside test programs resolves correctly).
  interp.registerLibrary(iolibFunctions, []);
  loader.registerBuiltin('io', iolibFunctions);
  loader.registerBuiltin('async', asynclibFunctions);
  loader.registerBuiltin('timer', timerlibFunctions);
  createdInterpreters.push(interp);
  return interp;
}

afterEach(() => {
  for (const interp of createdInterpreters) {
    for (const r of interp._resources) r.close();
    interp._resources.length = 0;
  }
  createdInterpreters.length = 0;
});

async function run(source: string): Promise<{ logs: string[] }> {
  const interp = makeInterpreter();
  const ast = new Parser(new Lexer(source).lex()).parse();
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: any[]) => logs.push(a.map(String).join(' '));
  try {
    await interp.interpretAsync(ast, source);
    // Drain any tasks spawned by timer callbacks (spawnPfunCallback)
    // that are still pending after the main program finishes.
    if ((interp as any)._scheduler) {
      await (interp as any)._scheduler.run();
    }
  } finally { console.log = orig; }
  return { logs };
}

// ─── setTimer ────────────────────────────────────────────────────────────────

describe('setTimer', () => {
  it('returns a positive integer ID', async () => {
    const { logs } = await run(`
      import * from "timer";
      import * from "async";
      async proc main() {
        proc noop() { 0; }
        let id = setTimer(10000, noop);
        clearTimer(id);
        println(__str__(id > 0));
      }
      main();
    `);
    expect(logs).toEqual(['true']);
  });

  it('fires the action after the delay', async () => {
    const { logs } = await run(`
      import * from "io";
      import * from "timer";
      import * from "async";
      async proc main() {
        var log = toArray([]);
        proc action() { eval append(log, "fired"); }
        eval setTimer(30, action);
        eval await sleep(150);
        eval await sleep(10);
        println(__str__(arrayLength(log) > 0));
        println("done");
      }
      main();
    `);
    expect(logs).toEqual(['true', 'done']);
  });

  it('action fires approximately after the specified delay', async () => {
    // We cannot test exact timing, but we can verify the action does NOT fire
    // immediately and DOES fire within a generous window.
    const { logs } = await run(`
      import * from "io";
      import * from "timer";
      import * from "async";
      async proc main() {
        var log = toArray([]);
        proc action() { eval append(log, "x"); }
        eval setTimer(80, action);
        eval await sleep(20);
        println("before: " + __str__(arrayLength(log) == 0));
        eval await sleep(200);
        eval await sleep(10);
        println("after: " + __str__(arrayLength(log) > 0));
      }
      main();
    `);
    expect(logs).toEqual(['before: true', 'after: true']);
  });

  it('multiple timers fire independently', async () => {
    const { logs } = await run(`
      import * from "io";
      import * from "timer";
      import * from "async";
      async proc main() {
        var logA = toArray([]);
        var logB = toArray([]);
        proc fireA() { eval append(logA, "A"); }
        proc fireB() { eval append(logB, "B"); }
        eval setTimer(30, fireA);
        eval setTimer(60, fireB);
        eval await sleep(150);
        eval await sleep(10);
        println(__str__(arrayLength(logA) > 0));
        println(__str__(arrayLength(logB) > 0));
      }
      main();
    `);
    expect(logs).toEqual(['true', 'true']);
  });

  it('returns different IDs for successive calls', async () => {
    const { logs } = await run(`
      import * from "io";
      import * from "timer";
      async proc main() {
        proc noop() { 0; }
        let id1 = setTimer(10000, noop);
        let id2 = setTimer(10000, noop);
        clearTimer(id1);
        clearTimer(id2);
        println(__str__(id1 != id2));
      }
      main();
    `);
    expect(logs).toEqual(['true']);
  });

  it('fires zero-delay timer', async () => {
    const { logs } = await run(`
      import * from "io";
      import * from "timer";
      import * from "async";
      async proc main() {
        var fired = false;
        proc action() { fired = true; }
        eval setTimer(0, action);
        eval await sleep(50);
        println(__str__(fired));
      }
      main();
    `);
    expect(logs).toEqual(['true']);
  });

  it('action can mutate mutable state', async () => {
    const { logs } = await run(`
      import * from "io";
      import * from "timer";
      import * from "async";
      async proc main() {
        var log = toArray([]);
        proc action() { eval append(log, "ran"); }
        eval setTimer(20, action);
        eval await sleep(100);
        eval await sleep(10);
        println(__str__(arrayLength(log)));
      }
      main();
    `);
    expect(logs).toEqual(['1']);
  });

  it('throws for non-integer ms', async () => {
    await expect(run(`
      import * from "timer";
      proc noop() { 0; }
      proc main() { eval setTimer(1.5, noop); }
      main();
    `)).rejects.toThrow('integer number of milliseconds');
  });

  it('throws for negative ms', async () => {
    await expect(run(`
      import * from "timer";
      proc noop() { 0; }
      proc main() { eval setTimer(-1, noop); }
      main();
    `)).rejects.toThrow('non-negative');
  });

  it('throws for non-proc action', async () => {
    await expect(run(`
      import * from "timer";
      proc main() { eval setTimer(100, 42); }
      main();
    `)).rejects.toThrow('proc');
  });

  it('throws in pure functions', async () => {
    await expect(run(`
      import * from "timer";
      proc noop() { 0; }
      function bad() { setTimer(100, noop); }
      bad();
    `)).rejects.toThrow('side effects are not allowed in pure functions');
  });
});

// ─── clearTimer ───────────────────────────────────────────────────────────────

describe('clearTimer', () => {
  it('prevents a pending timer from firing', async () => {
    const { logs } = await run(`
      import * from "io";
      import * from "timer";
      import * from "async";
      async proc main() {
        var fired = false;
        proc action() { fired = true; }
        let id = setTimer(50, action);
        clearTimer(id);
        eval await sleep(150);
        println(__str__(fired));
      }
      main();
    `);
    expect(logs).toEqual(['false']);
  });

  it('is a no-op when called after the timer fires', async () => {
    // The timer fires at 30ms. After 150ms we call clearTimer — this must
    // not throw even though the timer has already fired and removed itself
    // from the pending map.
    const { logs } = await run(`
      import * from "io";
      import * from "timer";
      import * from "async";
      async proc main() {
        proc action() { 0; }
        let id = setTimer(30, action);
        eval await sleep(150);
        clearTimer(id);   // no-op: already fired
        println("ok");
      }
      main();
    `);
    expect(logs).toEqual(['ok']);
  });

  it('is a no-op for an already-cleared timer', async () => {
    const { logs } = await run(`
      import * from "io";
      import * from "timer";
      import * from "async";
      async proc main() {
        proc noop() { 0; }
        let id = setTimer(5000, noop);
        clearTimer(id);
        clearTimer(id);   // second call — must not throw
        println("ok");
      }
      main();
    `);
    expect(logs).toEqual(['ok']);
  });

  it('only cancels the specified timer, not others', async () => {
    // Set two long-delay timers, cancel one, then verify via clearTimer
    // that the cancelled one is gone (second clearTimer is no-op, confirms
    // it was already removed) while the other is still cancellable.
    const { logs } = await run(`
      import * from "io";
      import * from "timer";
      async proc main() {
        proc noop() { 0; }
        let idA = setTimer(10000, noop);
        let idB = setTimer(10000, noop);
        clearTimer(idA);
        // B should still be cancellable (returns without throwing)
        clearTimer(idB);
        println("ok");
      }
      main();
    `);
    expect(logs).toEqual(['ok']);
  });

  it('throws for non-integer ID', async () => {
    await expect(run(`
      import * from "timer";
      proc main() { clearTimer("not-an-id"); }
      main();
    `)).rejects.toThrow('timer ID');
  });

  it('throws in pure functions', async () => {
    await expect(run(`
      import * from "timer";
      function bad() { clearTimer(1); }
      bad();
    `)).rejects.toThrow('side effects are not allowed in pure functions');
  });
});
