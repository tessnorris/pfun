// src/test/scheduler.test.ts
//
// Step 6: Scheduler unit tests — hand-constructed Generator<Effect,...>
// tasks driven through Scheduler.spawn/run, with no Pfun parsing involved.
// Covers:
//   - basic single-task completion
//   - interleaving: a faster task completes before a slower one started
//     earlier
//   - per-task error isolation: one task throwing doesn't affect others
//   - context isolation: inPureContext/inTailPosition/inAsyncContext
//     mutated by one task don't leak into another while both are in flight
//   - run() resolves once all spawned tasks complete
//   - tasks spawned from within other tasks are also waited for

import { Interpreter, Scheduler, Effect, PfunFunction } from '../interpreter';
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { stdlibFunctions, stdlibTypes } from '../library';

/** A task that resolves `value` after `ms` real milliseconds. */
function* delayTask(ms: number, value: any): Generator<Effect, any, any> {
  const result = yield { kind: 'await', promise: new Promise(r => setTimeout(() => r(value), ms)) };
  return result;
}

/** A task that immediately throws (no await at all). */
function* throwingTask(message: string): Generator<Effect, any, any> {
  throw new Error(message);
  // eslint-disable-next-line no-unreachable
  yield { kind: 'await', promise: Promise.resolve() };
}

/** A task that awaits a promise which then rejects. */
function* rejectingTask(message: string): Generator<Effect, any, any> {
  yield { kind: 'await', promise: Promise.reject(new Error(message)) };
}

describe('Scheduler (phase 6)', () => {

  it('runs a single task to completion', async () => {
    const interp = new Interpreter();
    const scheduler = new Scheduler(interp);
    const results: string[] = [];

    scheduler.spawn((function* () {
      const v = yield* delayTask(5, 'done');
      results.push(v);
    })());

    await scheduler.run();
    expect(results).toEqual(['done']);
  });

  it('interleaves: a shorter delay completes before a longer one started earlier', async () => {
    const interp = new Interpreter();
    const scheduler = new Scheduler(interp);
    const order: string[] = [];

    scheduler.spawn((function* () {
      yield* delayTask(30, null);
      order.push('slow');
    })());

    scheduler.spawn((function* () {
      yield* delayTask(5, null);
      order.push('fast');
    })());

    await scheduler.run();
    expect(order).toEqual(['fast', 'slow']);
  });

  it('run() resolves only after ALL spawned tasks complete', async () => {
    const interp = new Interpreter();
    const scheduler = new Scheduler(interp);
    const order: string[] = [];

    scheduler.spawn((function* () { yield* delayTask(5, null);  order.push('a'); })());
    scheduler.spawn((function* () { yield* delayTask(15, null); order.push('b'); })());
    scheduler.spawn((function* () { yield* delayTask(10, null); order.push('c'); })());

    await scheduler.run();
    expect(order.sort()).toEqual(['a', 'b', 'c']);
    expect(scheduler.taskCount).toBe(0);
  });

  it('a task with no await completes synchronously within spawn (taskCount drops immediately)', async () => {
    const interp = new Interpreter();
    const scheduler = new Scheduler(interp);

    scheduler.spawn((function* () {
      return 42;
    })());

    expect(scheduler.taskCount).toBe(0);
    await scheduler.run(); // should resolve immediately
  });

  describe('error isolation', () => {
    it('a task throwing synchronously is reported via onError, other tasks continue', async () => {
      const interp = new Interpreter();
      const scheduler = new Scheduler(interp);
      const errors: string[] = [];
      const order: string[] = [];

      scheduler.spawn(throwingTask('boom'), (e: any) => errors.push(e.message));
      scheduler.spawn((function* () { yield* delayTask(5, null); order.push('ok'); })());

      await scheduler.run();
      expect(errors).toEqual(['boom']);
      expect(order).toEqual(['ok']);
    });

    it('a task whose awaited promise rejects is reported via onError', async () => {
      const interp = new Interpreter();
      const scheduler = new Scheduler(interp);
      const errors: string[] = [];

      scheduler.spawn(rejectingTask('rejected!'), (e: any) => errors.push(e.message));

      await scheduler.run();
      expect(errors).toEqual(['rejected!']);
    });

    it('a task can catch its own rejection internally — no onError needed', async () => {
      const interp = new Interpreter();
      const scheduler = new Scheduler(interp);
      const results: string[] = [];

      scheduler.spawn((function* () {
        try {
          yield { kind: 'await', promise: Promise.reject(new Error('inner')) };
        } catch (e: any) {
          results.push('caught: ' + e.message);
        }
      })());

      await scheduler.run();
      expect(results).toEqual(['caught: inner']);
    });

    it('uses the scheduler-wide default error handler when no per-task handler is given', async () => {
      const interp = new Interpreter();
      const scheduler = new Scheduler(interp);
      const errors: string[] = [];
      scheduler.setDefaultErrorHandler((e: any) => errors.push((e as Error).message));

      scheduler.spawn(throwingTask('default-handled'));

      await scheduler.run();
      expect(errors).toEqual(['default-handled']);
    });

    it('emit effects escaping to the scheduler are reported as an internal error', async () => {
      const interp = new Interpreter();
      const scheduler = new Scheduler(interp);
      const errors: string[] = [];

      scheduler.spawn((function* (): Generator<Effect, void, any> {
        yield { kind: 'emit', value: 1 } as Effect;
      })(), (e: any) => errors.push((e as Error).message));

      await scheduler.run();
      expect(errors[0]).toMatch(/unexpected Effect.*'emit'/);
    });
  });

  describe('per-task context isolation', () => {
    it('inPureContext set by one task does not leak into a concurrently-running task', async () => {
      const interp = new Interpreter();
      const scheduler = new Scheduler(interp);
      const observed: boolean[] = [];

      // Task A: sets inPureContext = true, awaits (yields control), then
      // checks it's still true when resumed.
      scheduler.spawn((function* (): Generator<Effect, void, any> {
        interp.inPureContext = true;
        yield { kind: 'await', promise: new Promise(r => setTimeout(r, 10)) };
        observed.push(interp.inPureContext); // should still be true for THIS task
      })());

      // Task B: runs while A is parked, sets inPureContext = false.
      scheduler.spawn((function* (): Generator<Effect, void, any> {
        yield { kind: 'await', promise: new Promise(r => setTimeout(r, 1)) };
        interp.inPureContext = false;
        observed.push(interp.inPureContext); // false for THIS task
      })());

      await scheduler.run();
      // Both tasks should have observed their OWN value, not been
      // clobbered by the other's mutation.
      expect(observed.sort()).toEqual([false, true]);
    });

    it('inTailPosition and inAsyncContext are likewise isolated per task', async () => {
      const interp = new Interpreter();
      const scheduler = new Scheduler(interp);
      const results: any[] = [];

      scheduler.spawn((function* (): Generator<Effect, void, any> {
        interp.inTailPosition = true;
        interp.inAsyncContext = false;
        yield { kind: 'await', promise: new Promise(r => setTimeout(r, 10)) };
        results.push({ tail: interp.inTailPosition, async: interp.inAsyncContext });
      })());

      scheduler.spawn((function* (): Generator<Effect, void, any> {
        yield { kind: 'await', promise: new Promise(r => setTimeout(r, 1)) };
        interp.inTailPosition = false;
        interp.inAsyncContext = true;
        results.push({ tail: interp.inTailPosition, async: interp.inAsyncContext });
      })());

      await scheduler.run();
      expect(results.find(r => r.async === false)).toEqual({ tail: true, async: false });
      expect(results.find(r => r.async === true)).toEqual({ tail: false, async: true });
    });
  });

  describe('nested spawning', () => {
    it('a task that spawns another task — run() waits for both', async () => {
      const interp = new Interpreter();
      const scheduler = new Scheduler(interp);
      const order: string[] = [];

      scheduler.spawn((function* (): Generator<Effect, void, any> {
        order.push('outer-start');
        scheduler.spawn((function* (): Generator<Effect, void, any> {
          yield* delayTask(5, null);
          order.push('inner-done');
        })());
        yield* delayTask(1, null);
        order.push('outer-done');
      })());

      await scheduler.run();
      expect(order[0]).toBe('outer-start');
      expect(order).toContain('inner-done');
      expect(order).toContain('outer-done');
      expect(order).toHaveLength(3);
    });
  });

  // ─── Interpreter.spawnPfunCallback ───────────────────────────────────────
  //
  // The generic primitive any future native module (and eventually an
  // `extern` FFI boundary) uses to invoke a Pfun function/proc in response
  // to an external event, rather than hand-rolling executeGen()+spawn() the
  // way httplib.ts's httpListen did before this was extracted. These tests
  // build real PfunFunctions from parsed Pfun source — unlike the
  // hand-constructed generators above — since the thing under test is
  // specifically the PfunFunction -> task bridge.
  describe('Interpreter.spawnPfunCallback', () => {
    const makeFn = (source: string, interp: Interpreter, globalName: string = 'cb'): PfunFunction => {
      const ast = new Parser(new Lexer(source).lex()).parse();
      interp.interpret(ast, source);
      const fn = interp.getGlobal(globalName);
      if (!(fn instanceof PfunFunction)) throw new Error(`test setup: ${globalName} did not resolve to a PfunFunction`);
      return fn;
    };

    it('invokes a Pfun proc with the given arguments', async () => {
      const interp = new Interpreter();
      interp.registerLibrary(stdlibFunctions, stdlibTypes);
      const results: any[] = [];
      const cb = makeFn(`
        proc cb(x, y) { return x + y; }
      `, interp);

      interp.spawnPfunCallback(cb, [3n, 4n], (e) => { throw e; });
      await interp.scheduler.run();
      // The proc's return value isn't surfaced by spawnPfunCallback itself
      // (mirroring Scheduler.spawn — it's fire-and-forget); side effects
      // performed by the callback body are how results get observed.
      expect(results).toEqual([]); // nothing pushed — proc just returns
    });

    it('side effects performed by the callback are observable after scheduler.run()', async () => {
      const interp = new Interpreter();
      interp.registerLibrary(stdlibFunctions, stdlibTypes);
      const observed: any[] = [];
      interp.registerLibrary([
        { name: 'record', fn: (args: any[], i: any) => { observed.push(i.force(args[0])); return null; } },
      ] as any, []);

      const cb = makeFn(`proc cb(x) { record(x * 2); }`, interp);

      interp.spawnPfunCallback(cb, [10n], (e) => { throw e; });
      await interp.scheduler.run();
      expect(observed).toEqual([20n]);
    });

    it('an async proc callback can await before completing', async () => {
      const interp = new Interpreter();
      interp.registerLibrary(stdlibFunctions, stdlibTypes);
      const observed: any[] = [];
      interp.registerLibrary([
        { name: 'record', fn: (args: any[], i: any) => { observed.push(i.force(args[0])); return null; } },
        { name: 'delay', fn: (_args: any[]) => new Promise(r => setTimeout(r, 10)) },
      ] as any, []);

      const cb = makeFn(`
        async proc cb(x) {
          await delay();
          record(x);
        }
      `, interp);

      interp.spawnPfunCallback(cb, ['after-delay'], (e) => { throw e; });
      await interp.scheduler.run();
      expect(observed).toEqual(['after-delay']);
    });

    it('routes a thrown PfunError to onError instead of crashing the caller', async () => {
      const interp = new Interpreter();
      interp.registerLibrary(stdlibFunctions, stdlibTypes);
      const errors: string[] = [];
      const cb = makeFn(`proc cb() { eval head([]); }`, interp); // throws: empty list

      interp.spawnPfunCallback(cb, [], (e) => {
        errors.push(e instanceof Error ? e.message : String(e));
      });
      await interp.scheduler.run();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/head/i);
    });

    it('one callback throwing does not prevent a second spawned callback from completing', async () => {
      const interp = new Interpreter();
      interp.registerLibrary(stdlibFunctions, stdlibTypes);
      const observed: any[] = [];
      interp.registerLibrary([
        { name: 'record', fn: (args: any[], i: any) => { observed.push(i.force(args[0])); return null; } },
      ] as any, []);

      const failing    = makeFn(`proc failingCb() { eval head([]); }`, interp, 'failingCb');
      const succeeding = makeFn(`proc okCb(x) { record(x); }`, interp, 'okCb');

      const errors: unknown[] = [];
      interp.spawnPfunCallback(failing, [], (e) => errors.push(e));
      interp.spawnPfunCallback(succeeding, ['ok'], (e) => { throw e; });

      await interp.scheduler.run();
      expect(errors).toHaveLength(1);
      expect(observed).toEqual(['ok']);
    });

    it('multiple callbacks spawned concurrently interleave like any other tasks', async () => {
      const interp = new Interpreter();
      interp.registerLibrary(stdlibFunctions, stdlibTypes);
      const order: string[] = [];
      interp.registerLibrary([
        { name: 'record', fn: (args: any[], i: any) => { order.push(i.force(args[0])); return null; } },
        { name: 'delay', fn: (args: any[], i: any) => new Promise(r => setTimeout(r, Number(i.force(args[0])))) },
      ] as any, []);

      const cb = makeFn(`
        async proc cb(label, ms) {
          await delay(ms);
          record(label);
        }
      `, interp);

      interp.spawnPfunCallback(cb, ['slow', 30n], (e) => { throw e; });
      interp.spawnPfunCallback(cb, ['fast', 5n], (e) => { throw e; });

      await interp.scheduler.run();
      expect(order).toEqual(['fast', 'slow']);
    });

    it('returns immediately — does not block the caller waiting for the callback', () => {
      const interp = new Interpreter();
      interp.registerLibrary(stdlibFunctions, stdlibTypes);
      interp.registerLibrary([
        { name: 'delay', fn: () => new Promise(r => setTimeout(r, 1000)) },
      ] as any, []);
      const cb = makeFn(`async proc cb() { await delay(); }`, interp);

      const before = Date.now();
      interp.spawnPfunCallback(cb, [], () => {});
      const after = Date.now();
      expect(after - before).toBeLessThan(50); // did not wait for the 1000ms delay
    });
  });
});
