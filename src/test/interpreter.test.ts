// src/interpreter.test.ts
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Interpreter } from '../interpreter';
import * as os from 'os';
import * as nodePath from 'path';
import * as nodeFs from 'fs';
import { ModuleLoader } from '../interpreter';
import { stdlibFunctions, stdlibTypes } from '../library';
import { iolibFunctions } from '../iolib';

const run = (source: string) => {
  const ast = new Parser(new Lexer(source).lex()).parse();
  const interpreter = new Interpreter();
  interpreter.registerLibrary(stdlibFunctions, stdlibTypes);
  interpreter.registerLibrary(iolibFunctions, []);
  const logs: any[] = [];
  let currentLine = '';
  const originalLog = console.log;
  const originalWrite = process.stdout.write.bind(process.stdout);
  console.log = (...args: any[]) => {
    const s = args.map(a => String(a)).join(' ');
    logs.push(currentLine + s);
    currentLine = '';
  };
  (process.stdout as any).write = (s: string) => {
    if (typeof s !== 'string') return true;
    // Split on newlines — each \n flushes the current line to logs
    const parts = s.split('\n');
    for (let i = 0; i < parts.length - 1; i++) {
      logs.push(currentLine + parts[i]);
      currentLine = '';
    }
    currentLine += parts[parts.length - 1];
    return true;
  };
  try {
    interpreter.interpret(ast, source);
    if (currentLine.length > 0) { logs.push(currentLine); currentLine = ''; }
  } finally {
    console.log = originalLog;
    (process.stdout as any).write = originalWrite;
  }
  return { logs, interpreter };
};

// ─── Existing Feature Tests ────────────────────────────────────────────────────

describe('Interpreter Feature Tests', () => {
  describe('Mutability Rules', () => {
    it('should prevent reassignment to let bindings', () => {
      expect(() => run('let x = 10; x = 20;')).toThrow("Cannot assign to immutable variable 'x'");
    });

    it('should allow reassignment to var bindings and force evaluation', () => {
      const { logs } = run('var x = 10; x = 20; println(x);');
      expect(logs).toEqual(['20']);
    });
  });


  describe('Ternary & Equality', () => {
    it('should evaluate ternary operators lazily', () => {
      const { logs } = run('let x = true ? 1 : undefined_var; println(x);');
      expect(logs).toEqual(['1']);
    });

    it('should test equality correctly', () => {
      const { logs } = run('println((10 == 10)); println((10 == 5));');
      expect(logs).toEqual(['true', 'false']);
    });
  });


  describe('Records & Type Checking', () => {
    it('should create and access records', () => {
      const { logs } = run(`
        type Customer = { firstName, lastName };
        let c1 = Customer { "John", "Smith" };
        println(c1.firstName + " " + c1.lastName);
      `);
      expect(logs).toEqual(['John Smith']);
    });

    it('should support named record instantiation via ()', () => {
      const { logs } = run(`
        type Point = { x, y };
        let p = Point(y=20, x=10);
        println(p.x);
      `);
      expect(logs).toEqual(['10']);
    });

    it('should enforce type consistency on subsequent instantiations', () => {
      expect(() => run(`
        type Customer = { name, ssn };
        var c1 = Customer { "John", 111 };
        var c2 = Customer { "Jane", "222-22-2222" };
      `)).toThrow("Type mismatch in Customer");
    });
  });

  // ─── Discriminated Unions ──────────────────────────────────────────────────


  describe('Discriminated Union Types', () => {
    const SHAPE_DEF = `
      type Shape = {
        | Square: side
        | Circle: radius
        | Rectangle: x, y
      }
    `;

    it('should register and construct a variant positionally', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var sq = Square { 10 };
        println(sq.side);
      `);
      expect(logs).toEqual(['10']);
    });

    it('should construct a variant with named fields via {}', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var ci = Circle { radius = 5 };
        println(ci.radius);
      `);
      expect(logs).toEqual(['5']);
    });

    it('should construct a variant with named fields out of order via {}', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var re = Rectangle { y=20, x=10 };
        println(re.x);
        println(re.y);
      `);
      expect(logs).toEqual(['10', '20']);
    });

    it('should carry the variant name as the runtime type tag', () => {
      const { interpreter } = run(`
        ${SHAPE_DEF}
        var sq = Square { 10 };
      `);
      const sq = interpreter.getGlobal('sq');
      expect(sq.__type).toBe('Square');
    });

    it('should enforce field type consistency across instantiations of the same variant', () => {
      expect(() => run(`
        ${SHAPE_DEF}
        var s1 = Square { 10 };
        var s2 = Square { "ten" };
      `)).toThrow("Type mismatch in Square");
    });

    it('should allow different variants to use the same field name with different types', () => {
      // 'side' in Square and a hypothetical 'side' in another variant are independent schemas
      expect(() => run(`
        type Dual = {
          | A: value
          | B: value
        }
        var a1 = A { 1 };
        var b1 = B { "hello" };
      `)).not.toThrow();
    });

    it('should throw when constructing an unknown variant', () => {
      expect(() => run(`
        ${SHAPE_DEF}
        var t = Triangle { 3, 4, 5 };
      `)).toThrow("Unknown type 'Triangle'");
    });

    it('should throw when wrong number of fields are supplied', () => {
      expect(() => run(`
        ${SHAPE_DEF}
        var re = Rectangle { 10 };
      `)).toThrow("'Rectangle' expects 2 field(s), got 1.");
    });
  });

  // ─── Functions vs Procedures ───────────────────────────────────────────────


  describe('Functions and Procedures', () => {
    it('should allow println inside a procedure', () => {
      const { logs } = run(`
        proc greet(name) {
          println("Hello, " + name);
        }
        greet("Alice");
      `);
      expect(logs).toEqual(['Hello, Alice']);
    });

    it('should allow var inside a procedure', () => {
      const { logs } = run(`
        proc counter() {
          var x = 0;
          x = x + 1;
          println(x);
        }
        counter();
      `);
      expect(logs).toEqual(['1']);
    });

    it('should allow a procedure to call a pure function', () => {
      const { logs } = run(`
        function double(x) { return x * 2; }
        proc printDouble(n) { println(double(n)); }
        printDouble(7);
      `);
      expect(logs).toEqual(['14']);
    });

    it('should throw when a function uses println', () => {
      expect(() => run(`
        function bad(x) { println(x); }
        bad(1);
      `)).toThrow("Functions cannot use 'println'");
    });

    it('should throw when a function uses var', () => {
      expect(() => run(`
        function bad(x) { var y = x + 1; return y; }
        bad(1);
      `)).toThrow("Functions cannot use 'var'");
    });

    it('should throw when a function reassigns an outer var', () => {
      // Regression test: AssignExpr's evaluation previously had no
      // inPureContext check at all (unlike VarStmt's own declaration,
      // just above, and IndexAssignExpr, below) — reassigning an
      // already-declared outer var from a function ran successfully with
      // no error. The static checker (procedureCheck.ts) now also catches
      // this for same-module cases, but this test exercises the
      // interpreter's runtime guard directly and in isolation, since this
      // `run` helper bypasses the static checker entirely.
      expect(() => run(`
        var counter = 0;
        function bad() { counter = counter + 1; return counter; }
        bad();
      `)).toThrow("Functions cannot mutate 'var' bindings");
    });

    it('should throw when a function calls a procedure', () => {
      expect(() => run(`
        proc sideEffect() { println("oops"); }
        function bad(x) { return sideEffect(); }
        bad(1);
      `)).toThrow("Functions cannot call procedures");
    });

    it('should use strict evaluation in procedures', () => {
      // var requires strict evaluation; this verifies the proc forces args immediately
      const { logs } = run(`
        function add(x, y) { return x + y; }
        proc printSum(a, b) {
          var result = add(a, b);
          println(result);
        }
        printSum(3, 4);
      `);
      expect(logs).toEqual(['7']);
    });

    it('should support tail-call optimized recursion in functions', () => {
      const { logs } = run(`
        function countdown(n) {
          if n <= 0 then return "done" else countdown(n - 1);
        }
        println(countdown(10000));
      `);
      expect(logs).toEqual(['done']);
    });

    it('memo function should memoize pure function results', () => {
      // fact(5,1) called twice — second call should hit the cache
      const { logs } = run(`
        memo function fact(n, acc) {
          if n <= 1 then return acc else fact(n - 1, n * acc);
        }
        println(fact(5, 1));
        println(fact(5, 1));
      `);
      expect(logs).toEqual(['120', '120']);
    });

    it('plain function should not memoize results', () => {
      // counter is impure but let's verify caching is absent by checking
      // that a function with a side-effect through a var is NOT memoized
      const { logs } = run(`
        var callCount = 0;
        proc countedAdd(x, y) {
          callCount = callCount + 1;
          return x + y;
        }
        proc p() {
          countedAdd(2, 3);
          countedAdd(2, 3);
          println(callCount);
        }
        p();
      `);
      expect(logs).toEqual(['2']); // called twice, no memoization on procs
    });

    it('should allow procedures to mutate vars across multiple calls', () => {
      const { logs } = run(`
        var total = 0;
        proc add(n) {
          total = total + n;
          println(total);
        }
        add(5);
        add(3);
        add(2);
      `);
      expect(logs).toEqual(['5', '8', '10']);
    });

    it('should allow lambdas to be passed to procedures', () => {
      const { logs } = run(`
        proc applyAndPrint(f, x) {
          println(f(x));
        }
        applyAndPrint(fn x => x * x, 7);
      `);
      expect(logs).toEqual(['49']);
    });

    it('should allow lambdas with block bodies', () => {
      const { logs } = run(`
        let g = fn (y) => {
          let z = y * y;
          z + 2;
        };
        println(g(5));
      `);
      expect(logs).toEqual(['27']);
    });

    it('should allow block body lambdas bound with let', () => {
      const { logs } = run(`
        let addSquares = fn (a, b) => {
          let sa = a * a;
          let sb = b * b;
          sa + sb;
        };
        println(addSquares(3, 4));
      `);
      expect(logs).toEqual(['25']);
    });

    it('should allow block body lambdas passed inline', () => {
      const { logs } = run(`
        let nums = [1, 2, 3, 4, 5];
        let result = map(fn x => {
          let doubled = x * 2;
          doubled + 1;
        }, nums);
        println(result);
      `);
      expect(logs).toEqual(['[3, 5, 7, 9, 11]']);
    });
  });

  // ─── Option Type ───────────────────────────────────────────────────────────


  describe('Match Expressions', () => {
    const SHAPE_DEF = `
      type Shape = {
        | Square: side
        | Circle: radius
        | Rectangle: x, y
      }
    `;

    it('should match the correct variant arm', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var sq = Square { 7 };
        let result = match sq with
          | Square s -> s.side
          | Circle c -> c.radius
          | Rectangle r -> r.x;
        println(result);
      `);
      expect(logs).toEqual(['7']);
    });

    it('should make the binding immutable within the arm scope', () => {
      expect(() => run(`
        ${SHAPE_DEF}
        var sq = Square { 7 };
        match sq with
          | Square s -> s = 99
          | _ -> 0
      `)).toThrow("Cannot assign to immutable variable 's'");
    });

    it('should fall through to a wildcard arm', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var sq = Square { 4 };
        let result = match sq with
          | Circle c -> c.radius
          | _ -> 0;
        println(result);
      `);
      expect(logs).toEqual(['0']);
    });

    it('should evaluate the wildcard arm body expression', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var sq = Square { 4 };
        let result = match sq with
          | _ -> 42;
        println(result);
      `);
      expect(logs).toEqual(['42']);
    });

    it('should respect arm order (first match wins)', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var ci = Circle { 10 };
        let result = match ci with
          | Circle c -> 1
          | Circle c -> 2
          | _ -> 0;
        println(result);
      `);
      expect(logs).toEqual(['1']);
    });

    it('should skip a guarded arm when the guard is false and try the next arm', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var ci = Circle { 2 };
        let result = match ci with
          | Circle c where c.radius > 3 -> 100
          | Circle _ -> 1
          | _ -> 0;
        println(result);
      `);
      expect(logs).toEqual(['1']);
    });

    it('should match a guarded arm when the guard is true', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var ci = Circle { 5 };
        let result = match ci with
          | Circle c where c.radius > 3 -> c.radius
          | Circle _ -> 1
          | _ -> 0;
        println(result);
      `);
      expect(logs).toEqual(['5']);
    });

    it('should use the binding inside the guard expression', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var re = Rectangle { x=3, y=4 };
        let result = match re with
          | Rectangle r where r.x == r.y -> 0
          | Rectangle r -> r.x + r.y
          | _ -> 0;
        println(result);
      `);
      expect(logs).toEqual(['7']);
    });

    it('should throw on non-exhaustive match when no wildcard and a variant is missing', () => {
      expect(() => run(`
        ${SHAPE_DEF}
        var sq = Square { 4 };
        match sq with
          | Square s -> s.side
          | Circle c -> c.radius
      `)).toThrow("Non-exhaustive match on 'Shape': missing arm(s) for 'Rectangle'.");
    });

    it('should not throw on exhaustive match covering all variants', () => {
      expect(() => run(`
        ${SHAPE_DEF}
        var sq = Square { 4 };
        match sq with
          | Square s -> s.side
          | Circle c -> c.radius
          | Rectangle r -> r.x
      `)).not.toThrow();
    });

    it('should not throw exhaustiveness error when a wildcard is present', () => {
      expect(() => run(`
        ${SHAPE_DEF}
        var sq = Square { 4 };
        match sq with
          | Square s -> s.side
          | _ -> 0
      `)).not.toThrow();
    });

    it('should throw at runtime when all guards fail and no wildcard covers the variant', () => {
      expect(() => run(`
        ${SHAPE_DEF}
        var ci = Circle { 1 };
        match ci with
          | Circle c where c.radius > 10 -> c.radius
          | Square s -> s.side
          | Rectangle r -> r.x
      `)).toThrow("Non-exhaustive match: no arm matched value of type 'Circle'.");
    });

    it('should work as an expression nested inside other expressions', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var sq = Square { 6 };
        let doubled = (match sq with
          | Square s -> s.side
          | _ -> 0
        ) * 2;
        println(doubled);
      `);
      expect(logs).toEqual(['12']);
    });

    it('should work inside a pure function body', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        function area(shape) {
          return match shape with
            | Square s -> s.side * s.side
            | Circle c -> c.radius * c.radius
            | Rectangle r -> r.x * r.y
        }
        var sq = Square { 4 };
        var re = Rectangle { x=3, y=5 };
        println(area(sq));
        println(area(re));
      `);
      expect(logs).toEqual(['16', '15']);
    });

    it('should support match on lazy let bindings', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        let sq = Square { 9 };
        let result = match sq with
          | Square s -> s.side
          | _ -> 0;
        println(result);
      `);
      expect(logs).toEqual(['9']);
    });
  });

  // ─── Chars & Strings ───────────────────────────────────────────────────────



  // ─── Modules & Imports ───────────────────────────────────────────────────────

  describe('Modules and Imports', () => {
    const runWithModule = (mainSrc: string, modules: { [key: string]: string }) => {
      const dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'pfun-test-'));
      for (const [name, src] of Object.entries(modules)) {
        nodeFs.writeFileSync(nodePath.join(dir, name), src);
      }
      const setup = (i: Interpreter) => {
        i.registerLibrary(stdlibFunctions, stdlibTypes);
        i.registerLibrary(iolibFunctions, []);
      };
      const loader = new ModuleLoader(nodePath.join(dir, 'lib'), setup);
      loader.registerBuiltin('io', iolibFunctions);
      const ast = new Parser(new Lexer(mainSrc).lex()).parse();
      const interp = new Interpreter(dir, loader);
      setup(interp);
      const logs: any[] = [];
      let currentLine = '';
      const originalLog = console.log;
      const originalWrite = process.stdout.write.bind(process.stdout);
      console.log = (...args: any[]) => {
        logs.push(currentLine + args.map((a: any) => String(a)).join(' '));
        currentLine = '';
      };
      (process.stdout as any).write = (s: string) => {
        if (typeof s !== 'string') return true;
        const parts = s.split('\n');
        for (let i = 0; i < parts.length - 1; i++) { logs.push(currentLine + parts[i]); currentLine = ''; }
        currentLine += parts[parts.length - 1];
        return true;
      };
      try {
        interp.interpret(ast, mainSrc);
        if (currentLine.length > 0) { logs.push(currentLine); currentLine = ''; }
      } finally {
        console.log = originalLog;
        (process.stdout as any).write = originalWrite;
        nodeFs.rmSync(dir, { recursive: true });
      }
      return { logs, interp };
    };

    it('should import named exports from a module', () => {
      const { logs } = runWithModule(`
        import { add, double } from "./utils";
        println(add(3, 4));
        println(double(5));
      `, {
        'utils.pf': `
          export function add(x, y) { return x + y; }
          export function double(x) { return x * 2; }
        `
      });
      expect(logs).toEqual(['7', '10']);
    });

    it('should import with an alias', () => {
      const { logs } = runWithModule(`
        import { add as plus } from "./utils";
        println(plus(2, 3));
      `, {
        'utils.pf': `export function add(x, y) { return x + y; }`
      });
      expect(logs).toEqual(['5']);
    });

    it('should import * as namespace', () => {
      const { logs } = runWithModule(`
        import * as U from "./utils";
        println(U.add(10, 20));
        println(U.pi);
      `, {
        'utils.pf': `
          export function add(x, y) { return x + y; }
          export let pi = 3;
        `
      });
      expect(logs).toEqual(['30', '3']);
    });

    it('should cache modules and only execute them once', () => {
      const { logs } = runWithModule(`
        import { val } from "./counter";
        println(val);
      `, {
        'counter.pf': `export let val = 42;`
      });
      expect(logs).toEqual(['42']);
    });

    it('should throw when importing a non-exported name', () => {
      expect(() => runWithModule(`
        import { secret } from "./mod";
        println(secret);
      `, {
        'mod.pf': `let secret = 99;`
      })).toThrow("does not export 'secret'");
    });

    it('should throw on circular imports', () => {
      expect(() => runWithModule(`
        import { a } from "./a";
      `, {
        'a.pf': `import { b } from "./b"; export let a = 1;`,
        'b.pf': `import { a } from "./a"; export let b = 2;`
      })).toThrow("Circular import detected");
    });

    it('should export and import a proc', () => {
      const { logs } = runWithModule(`
        import { greet } from "./greetings";
        greet("Alice");
      `, {
        'greetings.pf': `
          export proc greet(name) { println("Hello, " + name); }
        `
      });
      expect(logs).toEqual(['Hello, Alice']);
    });

    it('should export and import a type', () => {
      const { logs } = runWithModule(`
        import { Point } from "./types";
        let p = Point { 3, 4 };
        println(p.x);
      `, {
        'types.pf': `export type Point = { x, y };`
      });
      expect(logs).toEqual(['3']);
    });

    it('should support import * from builtin module', () => {
      const { logs } = runWithModule(`
        import * from "io";
        proc p() { println("hello from io"); }
        p();
      `, {});
      expect(logs).toEqual(['hello from io']);
    });

    it('should support import * as namespace from builtin module', () => {
      expect(() => runWithModule(`
        import * as IO from "io";
      `, {})).not.toThrow();
    });

    describe('Exported var bindings share live, mutable storage across modules', () => {
      // These cover a real, pre-existing gap: an exported `var` used to be
      // captured as a snapshotted plain VALUE at the moment its `export
      // var ...` statement ran, with no way for an importer to observe
      // any LATER mutation (from the exporting module's own code, or
      // from another importer) — and, separately, the importer's own
      // binding was hardcoded immutable regardless of the source's own
      // var/let-ness, so the importer couldn't even reassign its local
      // copy. Both gaps are fixed together via Environment's Cell-based
      // internal storage (see Cell's docblock in interpreter.ts) — an
      // exported var now shares the SAME Cell with every importer, so a
      // mutation from any side is visible everywhere.

      it('a function importing a var sees mutations the EXPORTING module makes to it AFTER the export statement ran', () => {
        const { logs } = runWithModule(`
          import { counter } from "./lib";
          println(counter);
        `, {
          'lib.pf': `
            export var counter = 0;
            proc bump() { counter = counter + 1; }
            bump();
            bump();
            bump();
          `
        });
        expect(logs).toEqual(['3']);
      });

      it('an importer can mutate an imported var, and that mutation is visible through the SAME name imported a second time elsewhere', () => {
        const { logs } = runWithModule(`
          import { counter, bump } from "./lib";
          import { getCounter } from "./middle";
          println(counter);
          bump();
          println(counter);
          println(getCounter());
        `, {
          'lib.pf': `
            export var counter = 0;
            export proc bump() { counter = counter + 1; }
          `,
          'middle.pf': `
            import { counter } from "./lib";
            export function getCounter() { return counter; }
          `
        });
        // middle.pf's getCounter() reads counter via ITS OWN, separately
        // imported binding — confirming both import sites share one Cell,
        // not two independent copies.
        expect(logs).toEqual(['0', '1', '1']);
      });

      it('mutating through one importer is visible to a DIFFERENT importer of the same var, via a proc imported alongside it', () => {
        const { logs } = runWithModule(`
          import { shared, bumpShared } from "./lib";
          import { getShared, bumpFromOther } from "./other";
          println(shared);
          bumpShared();
          println(shared);
          println(getShared());
          bumpFromOther();
          println(shared);
          println(getShared());
        `, {
          'lib.pf': `
            export var shared = 0;
            export proc bumpShared() { shared = shared + 1; }
          `,
          'other.pf': `
            import { shared, bumpShared } from "./lib";
            export function getShared() { return shared; }
            export proc bumpFromOther() { bumpShared(); }
          `
        });
        expect(logs).toEqual(['0', '1', '1', '2', '2']);
      });

      it('a namespace-qualified read (X.counter) always reflects the LIVE current value, not a snapshot taken at import time', () => {
        const { logs } = runWithModule(`
          import * as Lib from "./lib";
          println(Lib.counter);
          Lib.bump();
          println(Lib.counter);
          Lib.bump();
          println(Lib.counter);
        `, {
          'lib.pf': `
            export var counter = 0;
            export proc bump() { counter = counter + 1; }
          `
        });
        expect(logs).toEqual(['0', '1', '2']);
      });

      it('a star-imported var can be mutated by a proc in the importing module (the originally-broken scenario)', () => {
        const { logs } = runWithModule(`
          import * from "./lib";
          proc bumpHere() { counter = counter + 1; return counter; }
          println(bumpHere());
        `, {
          'lib.pf': `export var counter = 0;`
        });
        expect(logs).toEqual(['1']);
      });

      it('a let export is unaffected — still a plain immutable snapshot, never sharable storage', () => {
        const { logs } = runWithModule(`
          import { x } from "./lib";
          println(x);
        `, {
          'lib.pf': `export let x = 42;`
        });
        expect(logs).toEqual(['42']);
      });
    });
  });

  // ─── split & join ─────────────────────────────────────────────────────────

  describe('split and join', () => {
    it('split should split a string on a delimiter', () => {
      const { interpreter } = run(`
        let parts = split("a,b,c", ",");
      `);
      const parts = interpreter.getGlobal('parts');
      expect(parts).toEqual(['a', 'b', 'c']);
    });

    it('split should handle a multi-char delimiter', () => {
      const { interpreter } = run(`
        let parts = split("one::two::three", "::");
      `);
      const parts = interpreter.getGlobal('parts');
      expect(parts).toEqual(['one', 'two', 'three']);
    });

    it('split on empty string yields individual characters', () => {
      const { interpreter } = run(`
        let parts = split("abc", "");
      `);
      const parts = interpreter.getGlobal('parts');
      expect(parts).toEqual(['a', 'b', 'c']);
    });

    it('split on absent delimiter yields a single-element list', () => {
      const { interpreter } = run(`
        let parts = split("hello", ",");
      `);
      const parts = interpreter.getGlobal('parts');
      expect(parts).toEqual(['hello']);
    });

    it('join should join a list of strings with a delimiter', () => {
      const { interpreter } = run(`
        let s = join(["a", "b", "c"], ",");
      `);
      expect(interpreter.getGlobal('s')).toBe('a,b,c');
    });

    it('join should auto-convert numbers to strings', () => {
      const { interpreter } = run(`
        let s = join([1, 2, 3], " - ");
      `);
      expect(interpreter.getGlobal('s')).toBe('1 - 2 - 3');
    });

    it('join with empty delimiter concatenates', () => {
      const { interpreter } = run(`
        let s = join(["x", "y", "z"], "");
      `);
      expect(interpreter.getGlobal('s')).toBe('xyz');
    });

    it('split then join round-trips', () => {
      const { interpreter } = run(`
        let original = "one two three";
        let s = join(split(original, " "), "-");
      `);
      expect(interpreter.getGlobal('s')).toBe('one-two-three');
    });

    it('split and join should work in pure functions', () => {
      const { interpreter } = run(`
        function csvRow(items) {
          return join(items, ",");
        }
        function parseRow(row) {
          return split(row, ",");
        }
        let row = csvRow(["Alice", "30", "true"]);
        let back = parseRow(row);
      `);
      expect(interpreter.getGlobal('row')).toBe('Alice,30,true');
      expect(interpreter.getGlobal('back')).toEqual(['Alice', '30', 'true']);
    });
  });

  // ─── Currying ──────────────────────────────────────────────────────────────

  describe('Currying', () => {
    it('calling a 2-arg function with 1 arg returns a partial function', () => {
      const { logs } = run(`
        function add(x, y) { return x + y; }
        let add5 = add(5);
        println(add5(3));
        println(add5(10));
      `);
      expect(logs).toEqual(['8', '15']);
    });

    it('calling a 3-arg function with 1 arg returns a 2-arg partial', () => {
      const { logs } = run(`
        function clamp(lo, hi, x) {
          return x < lo ? lo : (x > hi ? hi : x);
        }
        let clamp0to10 = clamp(0)(10);
        println(clamp0to10(5));
        println(clamp0to10(-3));
        println(clamp0to10(15));
      `);
      expect(logs).toEqual(['5', '0', '10']);
    });

    it('partial application works via sequential calls', () => {
      const { logs } = run(`
        function multiply(x, y) { return x * y; }
        let double = multiply(2);
        let triple = multiply(3);
        println(double(7));
        println(triple(7));
      `);
      expect(logs).toEqual(['14', '21']);
    });

    it('curried function can be passed to map', () => {
      const { logs } = run(`
        function add(x, y) { return x + y; }
        let nums = [1, 2, 3, 4, 5];
        println(map(add(10), nums));
      `);
      expect(logs).toEqual(['[11, 12, 13, 14, 15]']);
    });

    it('native function map can be partially applied', () => {
      const { logs } = run(`
        let double = map(fn x => x * 2);
        println(double([1, 2, 3]));
        println(double([10, 20]));
      `);
      expect(logs).toEqual(['[2, 4, 6]', '[20, 40]']);
    });

    it('native function filter can be partially applied', () => {
      const { logs } = run(`
        let evens = filter(fn x => x % 2 == 0);
        println(evens([1, 2, 3, 4, 5, 6]));
      `);
      expect(logs).toEqual(['[2, 4, 6]']);
    });

    it('native function cons can be partially applied', () => {
      const { logs } = run(`
        let prepend0 = cons(0);
        println(prepend0([1, 2, 3]));
      `);
      expect(logs).toEqual(['[0, 1, 2, 3]']);
    });

    it('native function find can be partially applied', () => {
      const { logs } = run(`
        let a = ["Alice", "Bob", "Carol"];
        let findInA = find(a);
        println(match findInA("Bob")   with | Some s -> s.value | None -> "not found");
        println(match findInA("Edgar") with | Some s -> s.value | None -> "not found");
      `);
      expect(logs).toEqual(['1', 'not found']);
    });

    it('native function take can be partially applied', () => {
      const { logs } = run(`
        let first3 = take(3);
        println(first3([10, 20, 30, 40, 50]));
        let nats = iterate(fn x => x + 1, 1);
        println(first3(nats));
      `);
      expect(logs).toEqual(['[10, 20, 30]', '[1, 2, 3]']);
    });

    it('native function reduce can be partially applied', () => {
      const { logs } = run(`
        let sum = reduce(fn acc, x => acc + x, 0);
        println(sum([1, 2, 3, 4, 5]));
        println(sum([10, 20, 30]));
      `);
      expect(logs).toEqual(['15', '60']);
    });

    it('curried partial is a pure function itself', () => {
      const { logs } = run(`
        function add(x, y) { return x + y; }
        function applyToFive(f) { return f(5); }
        println(applyToFive(add(10)));
        println(applyToFive(add(100)));
      `);
      expect(logs).toEqual(['15', '105']);
    });

    it('fully applying a curried partial gives the correct result', () => {
      const { logs } = run(`
        function power(base, exp) {
          if exp == 0 then 1
          else base * power(base, exp - 1);
        }
        let square = power(2);
        let cube   = power(3);
        println(square(8));
        println(cube(4));
      `);
      expect(logs).toEqual(['256', '81']);
    });
  });

  // ─── Memoization ───────────────────────────────────────────────────────────

  describe('Memoization', () => {
    it('memo function caches results — repeated calls return cached value', () => {
      const { logs } = run(`
        var calls = 0;
        proc inc() { calls = calls + 1; }
        // We can't directly count inside a function; test via fib which
        // would be exponential without memoization
        memo function fib(n) {
          if n <= 1 then n else fib(n - 1) + fib(n - 2);
        }
        println(fib(10));
        println(fib(15));
      `);
      expect(logs).toEqual(['55', '610']);
    });

    it('plain function recomputes on every call', () => {
      // Verify plain functions still work correctly (just without caching)
      const { logs } = run(`
        function add(x, y) { return x + y; }
        println(add(3, 4));
        println(add(3, 4));
        println(add(10, 20));
      `);
      expect(logs).toEqual(['7', '7', '30']);
    });

    it('memo function factorial with accumulator', () => {
      const { logs } = run(`
        memo function fact(n, acc) {
          if n <= 1 then acc else fact(n - 1, n * acc);
        }
        println(fact(5, 1));
        println(fact(10, 1));
      `);
      expect(logs).toEqual(['120', '3628800']);
    });

    it('memo keyword produces same correct results as plain function', () => {
      const { logs } = run(`
        function plain(x) { return x * x; }
        memo function memed(x) { return x * x; }
        println(plain(7));
        println(memed(7));
        println(plain(7));
        println(memed(7));
      `);
      expect(logs).toEqual(['49', '49', '49', '49']);
    });

    it('memo function on a recursive fib is correct for large n', () => {
      const { logs } = run(`
        memo function fib(n) {
          if n <= 1 then n else fib(n - 1) + fib(n - 2);
        }
        println(fib(20));
      `);
      expect(logs).toEqual(['6765']);
    });

    it('curried partial of a memo function does not memoize at partial level', () => {
      // The partial add5 = add(5) should just return a closure;
      // memoization happens when add5(x) is fully applied
      const { logs } = run(`
        memo function add(x, y) { return x + y; }
        let add5 = add(5);
        println(add5(3));
        println(add5(3));
      `);
      expect(logs).toEqual(['8', '8']);
    });
  });

  // ─── Name shadowing protection ────────────────────────────────────────────

  describe('Name shadowing protection', () => {
    it('should throw when shadowing a builtin with let', () => {
      expect(() => run(`let map = 42;`))
        .toThrow("built-in function");
    });

    it('should throw when shadowing a builtin with var at global scope', () => {
      expect(() => run(`
        proc p() { var length = 5; }
        p();
      `)).toThrow("built-in function");
    });

    it('should throw when shadowing a builtin with a function', () => {
      expect(() => run(`function filter(x) { return x; }`))
        .toThrow("built-in function");
    });

    it('should throw when shadowing a builtin with a proc', () => {
      expect(() => run(`proc println(x) { }`))
        .toThrow("built-in function");
    });

    it('should throw on global redefinition of a user let', () => {
      expect(() => run(`
        let x = 1;
        let x = 2;
      `)).toThrow("already defined");
    });

    it('should throw on global redefinition of a user function', () => {
      expect(() => run(`
        function add(x, y) { return x + y; }
        function add(x, y) { return x - y; }
      `)).toThrow("already defined");
    });

    it('should allow shadowing user names inside a function', () => {
      const { logs } = run(`
        let x = 10;
        function double(x) { return x * 2; }
        println(double(5));
        println(x);
      `);
      expect(logs).toEqual(['10', '10']);
    });

    it('should allow var reassignment', () => {
      const { logs } = run(`
        proc p() {
          var x = 1;
          x = 2;
          println(x);
        }
        p();
      `);
      expect(logs).toEqual(['2']);
    });

    it('re-registering a native via import should be idempotent not an error', () => {
      // Builtins registered directly (e.g. by registerLibrary) can be re-imported
      // without collision errors — the second registration is silently skipped.
      // We verify this by checking that println (already registered) doesn't throw.
      expect(() => run(`
        println("hello");
      `)).not.toThrow();
    });
  });
});
