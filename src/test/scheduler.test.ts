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

import { Interpreter, Scheduler, Effect } from '../interpreter';

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
});
