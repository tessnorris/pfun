// src/listops.test
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
    const parts = s.split('\n');
    for (let i = 0; i < parts.length - 1; i++) {
      logs.push(currentLine + parts[i]);
      currentLine = '';
    }
    currentLine += parts[parts.length - 1];
    return true;
  };
  try {
    interpreter.interpret(ast);
    if (currentLine.length > 0) { logs.push(currentLine); currentLine = ''; }
  } finally {
    console.log = originalLog;
    (process.stdout as any).write = originalWrite;
  }
  return { logs, interpreter };
};

describe('List Operations Tests', () => {
  describe('Lists & Higher Order Functions', () => {
    it('should support list operations', () => {
      const { logs } = run(`
        let l1 = ["a", "b", "c"];
        println(head(l1));
        println(tail(l1));
        println(cons("d", tail(l1)));
      `);
      expect(logs[0]).toBe('a');
      expect(logs[1]).toBe('[b, c]');
      expect(logs[2]).toBe('[d, b, c]');
    });

    it('should allow lists containing items of the same type', () => {
      const { logs } = run(`
        let l = [1, 2, 3];
        println(head(l));
      `);
      expect(logs).toEqual(['1']);
    });

    it('should throw on mixed types in list literal when forced', () => {
      expect(() => run(`let l = [1, "two", 3]; eval l;`))
        .toThrow("Type mismatch in list: expected bigint, got string.");
    });

    it('should throw on cons with mismatched type', () => {
      expect(() => run(`
        let l = [1, 2];
        cons("three", l);
      `)).toThrow("Type mismatch in list: expected string, got bigint.");
    });

    it('should throw on map returning mixed types', () => {
      expect(() => run(`
        let nums = [1, 2];
        map(fn x => x == 1 ? 1 : "two", nums);
      `)).toThrow("Type mismatch in list: expected bigint, got string.");
    });

    it('should enforce types on nested lists when forced', () => {
      expect(() => run(`
        var nested = [[1, 2], ["a", "b"]];
      `)).toThrow("Type mismatch in list: expected list<bigint>, got list<string>.");
    });

    it('should support map, filter, and reduce', () => {
      const { logs } = run(`
        let nums = [1, 2, 3, 4];
        let evens = filter(fn x => x % 2 == 0, nums);
        let doubled = map(fn x => x * 2, evens);
        let sum = reduce(fn acc, x => acc + x, 0, doubled);
        println(sum);
      `);
      expect(logs).toEqual(['12']);
    });
  });


  describe('List Comprehensions', () => {
    it('should produce a transformed list from a single generator', () => {
      const { logs } = run(`
        let nums = [1, 2, 3];
        println([ x * 2 for x <- nums ]);
      `);
      expect(logs).toEqual(['[2, 4, 6]']);
    });

    it('should filter with a where guard', () => {
      const { logs } = run(`
        let nums = [1, 2, 3, 4, 5];
        println([ x for x <- nums where x % 2 == 0 ]);
      `);
      expect(logs).toEqual(['[2, 4]']);
    });

    it('should support combined conditions with &&', () => {
      const { logs } = run(`
        let nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        println([ x for x <- nums where x > 3 && x < 8 ]);
      `);
      expect(logs).toEqual(['[4, 5, 6, 7]']);
    });

    it('should apply body expression after filtering', () => {
      const { logs } = run(`
        let nums = [1, 2, 3, 4, 5];
        println([ x * x for x <- nums where x > 2 ]);
      `);
      expect(logs).toEqual(['[9, 16, 25]']);
    });

    it('should produce cartesian product with two generators', () => {
      const { logs } = run(`
        let xs = [1, 2];
        let ys = [10, 20];
        println([ x + y for x <- xs for y <- ys ]);
      `);
      expect(logs).toEqual(['[11, 21, 12, 22]']);
    });

    it('should support multiple generators with a guard', () => {
      const { logs } = run(`
        println([ x + y for x <- [1, 2, 3] for y <- [1, 2, 3] where x != y ]);
      `);
      expect(logs).toEqual(['[3, 4, 3, 5, 4, 5]']);
    });

    it('should support three generators', () => {
      const { logs } = run(`
        let result = [ x + y + z for x <- [1, 2] for y <- [10] for z <- [100] ];
        println(result);
      `);
      expect(logs).toEqual(['[111, 112]']);
    });

    it('should produce an empty list when the guard filters everything', () => {
      const { logs } = run(`
        println([ x for x <- [1, 2, 3] where x > 10 ]);
      `);
      expect(logs).toEqual(['[]']);
    });

    it('should produce an empty list from an empty source', () => {
      const { logs } = run(`
        let empty = [];
        let result = [ x * 2 for x <- empty ];
        println(result);
      `);
      expect(logs).toEqual(['[]']);
    });

    it('should work as an expression inside let', () => {
      const { logs } = run(`
        let evens = [ x for x <- [1, 2, 3, 4, 5, 6] where x % 2 == 0 ];
        println(evens);
      `);
      expect(logs).toEqual(['[2, 4, 6]']);
    });

    it('should work inside a pure function body', () => {
      const { logs } = run(`
        function evens(lst) { return [ x for x <- lst where x % 2 == 0 ]; }
        println(evens([1, 2, 3, 4, 5, 6]));
      `);
      expect(logs).toEqual(['[2, 4, 6]']);
    });

    it('should work nested inside another comprehension', () => {
      const { logs } = run(`
        let matrix = [[1, 2], [3, 4]];
        let flat = [ x for row <- matrix for x <- row ];
        println(flat);
      `);
      expect(logs).toEqual(['[1, 2, 3, 4]']);
    });

    it('should enforce type consistency in result', () => {
      expect(() => run(`
        let mixed = [ x == 1 ? 1 : "two" for x <- [1, 2] ];
        eval mixed;
      `)).toThrow("Type mismatch in list");
    });

    it('should throw when source is not a list', () => {
      expect(() => run(`
        let result = [ x for x <- 42 ];
        eval result;
      `)).toThrow("Comprehension source must be a list");
    });

    it('should work inside a procedure with print', () => {
      const { logs } = run(`
        proc printEvens(lst) {
          let evens = [ x for x <- lst where x % 2 == 0 ];
          println(evens);
        }
        printEvens([1, 2, 3, 4, 5, 6]);
      `);
      expect(logs).toEqual(['[2, 4, 6]']);
    });

    it('should compose with map and filter', () => {
      const { logs } = run(`
        let nums = [1, 2, 3, 4, 5];
        let comp   = [ x * 2 for x <- nums where x % 2 == 0 ];
        let mapped = map(fn x => x * 2, filter(fn x => x % 2 == 0, nums));
        println(comp);
        println(mapped);
      `);
      expect(logs).toEqual(['[4, 8]', '[4, 8]']);
    });
  });

  // ─── Dictionaries ──────────────────────────────────────────────────────────


  describe('Infinite Lists', () => {
    it('iterate should produce values by repeatedly applying f to seed', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        println(take(5, nats));
      `);
      expect(logs).toEqual(['[1, 2, 3, 4, 5]']);
    });

    it('repeat should produce an infinite list of one value', () => {
      const { logs } = run(`
        println(take(4, repeat(7)));
      `);
      expect(logs).toEqual(['[7, 7, 7, 7]']);
    });

    it('cycle should repeat a finite list', () => {
      const { logs } = run(`
        println(take(7, cycle(["a", "b", "c"])));
      `);
      expect(logs).toEqual(['[a, b, c, a, b, c, a]']);
    });

    it('map over a lazy list should produce a new lazy list', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        let doubled = map(fn x => x * 2, nats);
        println(take(5, doubled));
      `);
      expect(logs).toEqual(['[2, 4, 6, 8, 10]']);
    });

    it('filter over a lazy list should produce a new lazy list', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        let evens = filter(fn x => x % 2 == 0, nats);
        println(take(5, evens));
      `);
      expect(logs).toEqual(['[2, 4, 6, 8, 10]']);
    });

    it('should support chained map and filter on lazy lists', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        let result = take(5, filter(fn x => x % 3 == 0, map(fn x => x * 2, nats)));
        println(result);
      `);
      expect(logs).toEqual(['[6, 12, 18, 24, 30]']);
    });

    it('cons onto a lazy list should produce a new lazy list', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        println(take(5, cons(0, nats)));
      `);
      expect(logs).toEqual(['[0, 1, 2, 3, 4]']);
    });

    it('tail of a lazy list should skip the first element', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        println(take(5, tail(nats)));
      `);
      expect(logs).toEqual(['[2, 3, 4, 5, 6]']);
    });

    it('take on a finite list should slice it', () => {
      const { logs } = run(`
        println(take(3, [10, 20, 30, 40, 50]));
      `);
      expect(logs).toEqual(['[10, 20, 30]']);
    });

    it('take of more elements than the list has should return the whole list', () => {
      const { logs } = run(`
        println(take(10, [1, 2, 3]));
      `);
      expect(logs).toEqual(['[1, 2, 3]']);
    });

    it('should support reduce on a taken finite slice', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        let sum = reduce(fn acc, x => acc + x, 0, take(10, nats));
        println(sum);
      `);
      expect(logs).toEqual(['55']);
    });

    it('reduce should throw on a lazy list', () => {
      expect(() => run(`
        let nats = iterate(fn x => x + 1, 1);
        reduce(fn acc, x => acc + x, 0, nats);
      `)).toThrow("reduce cannot be used on an infinite list");
    });

    it('should support fibonacci via iterate with a pair record', () => {
      const { logs } = run(`
        type Pair = { a, b }
        let fibs = map(fn p => p.a, iterate(fn p => Pair { p.b, p.a + p.b }, Pair { 0, 1 }));
        println(take(8, fibs));
      `);
      expect(logs).toEqual(['[0, 1, 1, 2, 3, 5, 8, 13]']);
    });

    it('should support powers of 2 via iterate', () => {
      const { logs } = run(`
        let powers = iterate(fn x => x * 2, 1);
        println(take(6, powers));
      `);
      expect(logs).toEqual(['[1, 2, 4, 8, 16, 32]']);
    });

    it('should allow a pure function to return a lazy list', () => {
      const { logs } = run(`
        function multiplesOf(n) {
          return iterate(fn x => x + n, n);
        }
        println(take(5, multiplesOf(3)));
      `);
      expect(logs).toEqual(['[3, 6, 9, 12, 15]']);
    });

    it('should support head on a lazy list', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        println(head(nats));
      `);
      expect(logs).toEqual(['1']);
    });

    it('lazy list should print as <lazylist>', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        println(nats);
      `);
      expect(logs).toEqual(['<lazylist>']);
    });
  });


});
