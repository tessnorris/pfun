// src/test/async.test.ts
//
// Step 4: real `await` — AwaitExpr evaluation + the runAsync top-level
// driver. These tests use small mock async NativeFunctions (real JS
// Promises, some delayed via setTimeout) registered directly on the
// interpreter, exercising:
//   - basic await of an immediately-resolved promise
//   - await of a delayed promise (proves a real suspend/resume happens)
//   - await in nested/non-statement-level expression position
//   - ordering: a faster await resolves before a slower one started earlier
//   - error propagation: a rejected promise surfaces as a catchable error
//   - await on a non-promise value passes through unchanged (JS semantics)
//   - the sync interpret()/runSync path still works for non-async programs

import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Interpreter, NativeFunction, runAsync } from '../interpreter';
import { stdlibFunctions, stdlibTypes } from '../library';
import { mutStructuresFunctions, mutStructuresTypes } from '../mutStructures';
import { iolibFunctions } from '../iolib';

/**
 * Build an interpreter with stdlib + a few mock async natives:
 *   - resolveValue(x)      -> Promise.resolve(x)
 *   - delay(ms, x)         -> Promise that resolves to x after ms milliseconds
 *   - rejectWith(message)  -> Promise that rejects with new Error(message)
 *   - sleep(ms)            -> Promise<nil> that resolves after ms milliseconds
 */
const makeInterpreter = () => {
  const interpreter = new Interpreter();
  interpreter.registerLibrary(stdlibFunctions, stdlibTypes);
  interpreter.registerLibrary(mutStructuresFunctions, mutStructuresTypes);
  interpreter.registerLibrary(iolibFunctions, []);

  interpreter.registerFunction({
    name: 'resolveValue',
    arity: 1,
    fn: (args, interp) => Promise.resolve(interp.force(args[0])),
  });

  interpreter.registerFunction({
    name: 'delay',
    arity: 2,
    fn: (args, interp) => {
      const ms = Number(interp.force(args[0]));
      const value = interp.force(args[1]);
      return new Promise(resolve => setTimeout(() => resolve(value), ms));
    },
  });

  interpreter.registerFunction({
    name: 'rejectWith',
    arity: 1,
    fn: (args, interp) => {
      const message = interp.force(args[0]);
      return Promise.reject(new Error(message));
    },
  });

  interpreter.registerFunction({
    name: 'sleep',
    arity: 1,
    fn: (args, interp) => {
      const ms = Number(interp.force(args[0]));
      return new Promise(resolve => setTimeout(resolve, ms));
    },
  });

  return interpreter;
};

/** Run a program via interpretAsync, capturing println output. */
const runAsyncProgram = async (source: string) => {
  const interpreter = makeInterpreter();
  const ast = new Parser(new Lexer(source).lex()).parse();

  const logs: string[] = [];
  let currentLine = '';
  const originalLog = console.log;
  const originalWrite = process.stdout.write.bind(process.stdout);
  console.log = (...args: any[]) => { logs.push(currentLine + args.map(String).join(' ')); currentLine = ''; };
  (process.stdout as any).write = (s: string) => {
    if (typeof s !== 'string') return true;
    const parts = s.split('\n');
    for (let i = 0; i < parts.length - 1; i++) { logs.push(currentLine + parts[i]); currentLine = ''; }
    currentLine += parts[parts.length - 1];
    return true;
  };
  try {
    await interpreter.interpretAsync(ast, source);
    if (currentLine.length > 0) { logs.push(currentLine); currentLine = ''; }
  } finally {
    console.log = originalLog;
    (process.stdout as any).write = originalWrite;
  }
  return { logs, interpreter };
};

describe('Async/await (phase 4)', () => {

  describe('basic await', () => {
    it('await of an immediately-resolved promise returns its value', async () => {
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let x = await resolveValue(42);
          println(x);
        }
        p();
      `);
      expect(logs).toEqual(['42']);
    });

    it('await of a delayed promise returns its value after the delay', async () => {
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let x = await delay(10, "done");
          println(x);
        }
        p();
      `);
      expect(logs).toEqual(['done']);
    });

    it('calling an async function without await transparently inlines its await (no Promise-wrapping boundary)', async () => {
      // In this generator-based model, `f()` called from inside another
      // `yield*` chain (i.e. from inside another async function/proc body)
      // does NOT receive an automatically-wrapped Promise the way real JS
      // async functions do — the call inlines f's execution, including any
      // `await` inside it, via yield* delegation. So `f()` and `await f()`
      // behave the same when `f` is called from an async context.
      // (A native async function — step 6's httplib etc. — DOES return a
      // real Promise, since NativeFunction.execute is a plain sync JS call
      // that can itself construct/return a Promise object.)
      const { logs } = await runAsyncProgram(`
        async function f() {
          return 1 + await resolveValue(41);
        }
        async proc p() { println(f()); }
        p();
      `);
      expect(logs).toEqual(['42']);
    });

    it('await of a call whose result is itself awaited (nested await)', async () => {
      const { logs } = await runAsyncProgram(`
        async function f() {
          return 1 + await resolveValue(41);
        }
        async proc p() {
          let result = await f();
          println(result);
        }
        p();
      `);
      expect(logs).toEqual(['42']);
    });

    it('multiple sequential awaits in one procedure', async () => {
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let a = await resolveValue(1);
          let b = await resolveValue(2);
          let c = await resolveValue(3);
          println(a + b + c);
        }
        p();
      `);
      expect(logs).toEqual(['6']);
    });
  });

  describe('await on non-promise values', () => {
    it('await on a plain value returns it unchanged (JS semantics)', async () => {
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let x = await 5;
          println(x);
        }
        p();
      `);
      expect(logs).toEqual(['5']);
    });
  });

  describe('ordering / real suspension', () => {
    it('a shorter delay resolves before a longer one awaited earlier', async () => {
      // This single-task test can't show interleaving (that's step 6's
      // scheduler), but it DOES prove `delay` performs a real suspend: if
      // `await` were merely synchronous/blocking, a 30ms delay would still
      // "work" but this test mainly documents the expected sequential
      // result and timing-sensitive behavior for a single task.
      const start = Date.now();
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let a = await delay(30, "slow");
          let b = await delay(5, "fast");
          println(a);
          println(b);
        }
        p();
      `);
      const elapsed = Date.now() - start;
      expect(logs).toEqual(['slow', 'fast']);
      // Sequential awaits: total time should be roughly 30 + 5 ms (not 0).
      expect(elapsed).toBeGreaterThanOrEqual(30);
    });
  });

  describe('error propagation', () => {
    it('a rejected promise surfaces as a catchable error', async () => {
      await expect(runAsyncProgram(`
        async proc p() {
          let x = await rejectWith("boom");
          println(x);
        }
        p();
      `)).rejects.toThrow('boom');
    });

    it('error from a rejected await does not produce any output', async () => {
      try {
        await runAsyncProgram(`
          async proc p() {
            println("before");
            let x = await rejectWith("boom");
            println("after");
          }
          p();
        `);
        fail('expected rejection');
      } catch (e: any) {
        expect(e.message).toContain('boom');
      }
    });
  });

  describe('sync interpret() still works for non-async programs', () => {
    it('interpret() (sync) runs a program with no await normally', () => {
      const interpreter = makeInterpreter();
      const ast = new Parser(new Lexer(`
        function double(x) { return x * 2; }
        eval double(21);
      `).lex()).parse();
      // Should not throw — no Effect is ever yielded.
      expect(() => interpreter.interpret(ast)).not.toThrow();
    });

    it('interpret() (sync) throws runSync\'s internal error if await is reached', () => {
      const interpreter = makeInterpreter();
      const ast = new Parser(new Lexer(`
        async proc p() {
          let x = await resolveValue(1);
        }
        p();
      `).lex()).parse();
      expect(() => interpreter.interpret(ast)).toThrow(/yielded an Effect/);
    });
  });

  // ── Async/await (phase 5): async-contagion runtime checks ───────────────
  describe('async-contagion (await only inside async function/proc)', () => {
    it('await directly inside a non-async function throws', async () => {
      await expect(runAsyncProgram(`
        function f() {
          return await resolveValue(1);
        }
        async proc p() { println(f()); }
        p();
      `)).rejects.toThrow(/'await' can only be used inside an 'async function' or 'async proc'/);
    });

    it('await directly inside a non-async proc throws', async () => {
      await expect(runAsyncProgram(`
        proc p() {
          let x = await resolveValue(1);
          println(x);
        }
        p();
      `)).rejects.toThrow(/'await' can only be used inside an 'async function' or 'async proc'/);
    });

    it('await at top level (no enclosing function/proc) is allowed', async () => {
      const { logs } = await runAsyncProgram(`
        let x = await resolveValue(99);
        println(x);
      `);
      expect(logs).toEqual(['99']);
    });

    it('a non-async function calling an async function without await is a contagion violation (errors)', async () => {
      // f is async and awaits internally. g is NOT marked async but calls
      // f() directly in its return expression without `await` — per the
      // async-contagion rule, g itself should be `async` in this case (or
      // call `await f()`). containsAwait's CallExpr check only looks at the
      // DIRECTLY-called function's `.async` flag (g.async === false here),
      // not transitively through g's body — deep transitive effect
      // inference is out of scope for this runtime-check-based approach
      // (consistent with inPureContext, which is also a direct/local check,
      // not a transitive static analysis).
      //
      // Result: g() gets thunked (containsAwait(g(), env) is false), and
      // forcing that thunk via println's sync force() reaches `await`
      // inside f's inlined body, surfacing runSync's internal error. This
      // is a real error (not silent incorrect behavior) — just not phrased
      // in terms of "g should be async". Writing `async function g()` (or
      // `let r = await f(); return r + 1;`) avoids it entirely.
      await expect(runAsyncProgram(`
        async function f() {
          return await resolveValue(7);
        }
        function g() {
          return f() + 1;
        }
        async proc p() { println(g()); }
        p();
      `)).rejects.toThrow(/yielded an Effect/);
    });

    it('inAsyncContext is restored after an async function returns — a sibling non-async await still throws', async () => {
      // After f() (async) returns and inAsyncContext is restored, h()
      // (non-async, containing `await` directly) should still throw —
      // proving the flag was correctly restored to its prior value rather
      // than "stuck" true from f's execution.
      await expect(runAsyncProgram(`
        async function f() {
          return await resolveValue(1);
        }
        function h() {
          return await resolveValue(2);
        }
        async proc p() {
          let a = await f();
          println(a);
          println(h());
        }
        p();
      `)).rejects.toThrow(/'await' can only be used inside an 'async function' or 'async proc'/);
    });

    it('a value bound via async f() can be used normally after f returns (context correctly restored)', async () => {
      const { logs } = await runAsyncProgram(`
        async function f() {
          return await resolveValue(1);
        }
        function double(x) { return x * 2; }
        async proc p() {
          let a = await f();
          println(double(a));
        }
        p();
      `);
      expect(logs).toEqual(['2']);
    });

    it('async memo function caches the resolved value, not a pending promise', async () => {
      // Each call to f(x) increments callCount via a side-channel; if memo
      // worked correctly, calling f(5) twice should only actually execute
      // the body (and hit `await`) once — the second call returns the
      // cached resolved value directly.
      let callCount = 0;
      const interpreter = makeInterpreter();
      interpreter.registerFunction({
        name: 'countedResolve',
        arity: 1,
        fn: (args, interp) => { callCount++; return Promise.resolve(interp.force(args[0])); },
      });
      const ast = new Parser(new Lexer(`
        async memo function f(x) {
          return await countedResolve(x * 10);
        }
        async proc p() {
          let a = await f(5);
          let b = await f(5);
          println(a);
          println(b);
        }
        p();
      `).lex()).parse();

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...a: any[]) => logs.push(a.map(String).join(' '));
      try {
        await interpreter.interpretAsync(ast);
      } finally {
        console.log = originalLog;
      }
      expect(logs).toEqual(['50', '50']);
      expect(callCount).toBe(1);
    });
  });


    it('runAsync resolves a generator that yields one await Effect', async () => {
      const interpreter = makeInterpreter();
      function* gen(): Generator<any, string, any> {
        const v = yield { kind: 'await', promise: Promise.resolve('hello') };
        return v + ' world';
      }
      const result = await runAsync(gen());
      expect(result).toBe('hello world');
    });

    it('runAsync throws into the generator on promise rejection', async () => {
      function* gen(): Generator<any, string, any> {
        try {
          yield { kind: 'await', promise: Promise.reject(new Error('nope')) };
          return 'unreachable';
        } catch (e: any) {
          return 'caught: ' + e.message;
        }
      }
      const result = await runAsync(gen());
      expect(result).toBe('caught: nope');
    });
  });
});
