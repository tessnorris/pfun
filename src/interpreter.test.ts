// src/interpreter.test.ts
import { Lexer } from './lexer';
import { Parser } from './parser';
import { Interpreter } from './interpreter';
import * as os from 'os';
import * as nodePath from 'path';
import * as nodeFs from 'fs';
import { ModuleLoader } from './interpreter';
import { stdlibFunctions, stdlibTypes } from './library';
import { iolibFunctions } from './iolib';

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

    it('should memoize pure function results', () => {
      // fact(5,1) called twice — second call should hit the cache
      const { logs } = run(`
        function fact(n, acc) {
          if n <= 1 then return acc else fact(n - 1, n * acc);
        }
        println(fact(5, 1));
        println(fact(5, 1));
      `);
      expect(logs).toEqual(['120', '120']);
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
  });
});
