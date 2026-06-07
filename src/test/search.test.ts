// src/search.test.ts
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
    interpreter.interpret(ast, source);
    if (currentLine.length > 0) { logs.push(currentLine); currentLine = ''; }
  } finally {
    console.log = originalLog;
    (process.stdout as any).write = originalWrite;
  }
  return { logs, interpreter };
};

describe('Search and Access Tests', () => {
  describe('Slice, nth, and isInfinite', () => {
    it('slice should return k items starting at n from a list', () => {
      const { logs } = run(`println(slice(1, 3, [10, 20, 30, 40, 50]));`);
      expect(logs).toEqual(['[20, 30, 40]']);
    });

    it('slice on a string should return a substring', () => {
      const { logs } = run(`println(slice(1, 3, "hello"));`);
      expect(logs).toEqual(['ell']);
    });

    it('slice on a lazy list should materialize the right window', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        println(slice(5, 3, nats));
      `);
      expect(logs).toEqual(['[6, 7, 8]']);
    });

    it('slice past end of list should return available items', () => {
      const { logs } = run(`println(slice(3, 10, [1, 2, 3, 4, 5]));`);
      expect(logs).toEqual(['[4, 5]']);
    });

    it('nth should return item at index n', () => {
      const { logs } = run(`println(nth([10, 20, 30], 1));`);
      expect(logs).toEqual(['20']);
    });

    it('nth should return false when out of bounds', () => {
      const { logs } = run(`println(nth([1, 2, 3], 99));`);
      expect(logs).toEqual(['false']);
    });

    it('nth on a string should return a char', () => {
      const { interpreter } = run(`var c = nth("hello", 1);`);
      const c = interpreter.getGlobal('c');
      expect(c.constructor.name).toBe('PfunChar');
      expect(c.value).toBe('e');
    });

    it('nth on a lazy list should materialize just enough', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        println(nth(nats, 9));
      `);
      expect(logs).toEqual(['10']);
    });

    it('isInfinite should return true for lazy lists', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        println(isInfinite(nats));
      `);
      expect(logs).toEqual(['true']);
    });

    it('isInfinite should return false for finite lists', () => {
      const { logs } = run(`println(isInfinite([1, 2, 3]));`);
      expect(logs).toEqual(['false']);
    });

    it('isInfinite should return false for strings', () => {
      const { logs } = run(`println(isInfinite("hello"));`);
      expect(logs).toEqual(['false']);
    });
  });



  describe('find and findSlice', () => {
    it('find should return the index of an existing item', () => {
      const { logs } = run(`println(find([10, 20, 30], 20));`);
      expect(logs).toEqual(['1']);
    });

    it('find should return -1 when item is not present', () => {
      const { logs } = run(`println(find([10, 20, 30], 99));`);
      expect(logs).toEqual(['-1']);
    });

    it('find should return the first matching index', () => {
      const { logs } = run(`println(find([1, 2, 1, 3], 1));`);
      expect(logs).toEqual(['0']);
    });

    it('find should work on strings (char search)', () => {
      const { logs } = run(`println(find("hello", 'l'));`);
      expect(logs).toEqual(['2']);
    });

    it('find should return -1 for missing char in string', () => {
      const { logs } = run(`println(find("hello", 'z'));`);
      expect(logs).toEqual(['-1']);
    });

    it('find should compare by value not reference', () => {
      const { logs } = run(`
        type Point = { x, y }
        let pts = [Point { 1, 2 }, Point { 3, 4 }, Point { 5, 6 }];
        println(find(pts, Point { 3, 4 }));
      `);
      expect(logs).toEqual(['1']);
    });

    it('findSlice should return the start index of a matching sublist', () => {
      const { logs } = run(`println(findSlice([1, 2, 3, 4, 5], [2, 3, 4]));`);
      expect(logs).toEqual(['1']);
    });

    it('findSlice should return -1 when slice is not present', () => {
      const { logs } = run(`println(findSlice([1, 2, 3], [4, 5]));`);
      expect(logs).toEqual(['-1']);
    });

    it('findSlice should return 0 for an empty slice', () => {
      const { logs } = run(`println(findSlice([1, 2, 3], []));`);
      expect(logs).toEqual(['0']);
    });

    it('findSlice should work on strings (substring search)', () => {
      const { logs } = run(`println(findSlice("hello world", "world"));`);
      expect(logs).toEqual(['6']);
    });

    it('findSlice should return -1 for missing substring', () => {
      const { logs } = run(`println(findSlice("hello", "xyz"));`);
      expect(logs).toEqual(['-1']);
    });

    it('findSlice should find the first of multiple matches', () => {
      const { logs } = run(`println(findSlice([1, 2, 1, 2, 3], [1, 2]));`);
      expect(logs).toEqual(['0']);
    });

    it('find and findSlice should throw on lazy lists', () => {
      expect(() => run(`
        let nats = iterate(fn x => x + 1, 1);
        find(nats, 5);
      `)).toThrow("cannot search an infinite list");
    });
  });
});
