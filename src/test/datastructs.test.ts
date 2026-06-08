// src/datastructs.ts
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

describe('Data Structure Tests', () => {
  describe('Option Type', () => {
    it('Some and None should be available without any type declaration', () => {
      const { interpreter } = run(`
        var s = Some { 1 };
        var n = None;
      `);
      expect(interpreter.getGlobal('s').__type).toBe('Some');
      expect(interpreter.getGlobal('n').__type).toBe('None');
    });

    it('should match Some and extract the value', () => {
      const { logs } = run(`
        let x = Some { 42 };
        let result = match x with | Some s -> s.value
          | None   -> 0;
        println(result);
      `);
      expect(logs).toEqual(['42']);
    });

    it('should match None and return the default', () => {
      const { logs } = run(`
        let x = None;
        let result = match x with | Some s -> s.value
          | None   -> 0;
        println(result);
      `);
      expect(logs).toEqual(['0']);
    });

    it('should support None as a bare identifier without braces', () => {
      const { interpreter } = run('let x = None;');
      expect(interpreter.getGlobal('x').__type).toBe('None');
    });

    it('should support Some with positional braces', () => {
      const { interpreter } = run('var s = Some { 99 };');
      expect(interpreter.getGlobal('s').value).toBe(99n);
    });

    it('should allow a function to return an Option', () => {
      const { logs } = run(`
        function safeDivide(a, b) {
          return b == 0 ? None : Some { a / b };
        }
        let good = safeDivide(10, 2);
        let bad  = safeDivide(10, 0);
        println(match good with | Some s -> s.value | None -> 0);
        println(match bad  with | Some s -> s.value | None -> 0);
      `);
      expect(logs).toEqual(['5', '0']);
    });

    it('should support where guards on Some', () => {
      const { logs } = run(`
        let x = Some { 100 };
        let result = match x with | Some s where s.value > 50 -> "big"
          | Some _                    -> "small"
          | None                      -> "nothing";
        println(result);
      `);
      expect(logs).toEqual(['big']);
    });

    it('should require exhaustive match on Option', () => {
      expect(() => run(`
        let x = Some { 1 };
        match x with | Some s -> s.value;
      `)).toThrow("Non-exhaustive match on 'Option': missing arm(s) for 'None'.");
    });

    it('should work with wildcard instead of explicit None arm', () => {
      const { logs } = run(`
        let x = None;
        let result = match x with | Some s -> s.value
          | _      -> 999;
        println(result);
      `);
      expect(logs).toEqual(['999']);
    });

    it('should support Option values in lists with map', () => {
      const { logs } = run(`
        let opts = [Some { 1 }, Some { 2 }, Some { 3 }];
        let vals = map(fn o => match o with | Some s -> s.value | None -> 0, opts);
        println(vals);
      `);
      expect(logs).toEqual(['[1, 2, 3]']);
    });

    it('should support chaining with reduce to find first Some', () => {
      const { logs } = run(`
        function firstSome(acc, x) {
          return match acc with | Some _ -> acc
            | None   -> x;
        }
        let candidates = [None, None, Some { 7 }, Some { 8 }];
        let first = reduce(fn a, x => firstSome(a, x), None, candidates);
        println(match first with | Some s -> s.value | None -> 0);
      `);
      expect(logs).toEqual(['7']);
    });

    it('should allow user-defined zero-field variants in other union types', () => {
      const { logs } = run(`
        type Result = {
          | Ok: value
          | Err
        }
        let ok  = Ok { 42 };
        let err = Err;
        println(match ok  with | Ok o -> o.value | Err -> 0);
        println(match err with | Ok o -> o.value | Err -> 0);
      `);
      expect(logs).toEqual(['42', '0']);
    });
  });

  // ─── List Comprehensions ───────────────────────────────────────────────────


  describe('Dictionaries', () => {
    it('should construct a dict and access values by string key', () => {
      const { logs } = run(`
        var d = dict { "name" -> "Alice", "age" -> "30" };
        println(d["name"]);
        println(d["age"]);
      `);
      expect(logs).toEqual(['Alice', '30']);
    });

    it('should construct a dict with integer keys', () => {
      const { logs } = run(`
        var d = dict { 1 -> "one", 2 -> "two" };
        println(d[1]);
        println(d[2]);
      `);
      expect(logs).toEqual(['one', 'two']);
    });

    it('should construct an empty dict', () => {
      const { logs } = run(`
        var d = dict {};
        d["key"] = "value";
        println(d["key"]);
      `);
      expect(logs).toEqual(['value']);
    });

    it('should update an existing key', () => {
      const { logs } = run(`
        var d = dict { "x" -> 1 };
        d["x"] = 99;
        println(d["x"]);
      `);
      expect(logs).toEqual(['99']);
    });

    it('should add a new key via index assignment', () => {
      const { logs } = run(`
        var d = dict {};
        d["new"] = 42;
        println(d["new"]);
      `);
      expect(logs).toEqual(['42']);
    });

    it('should throw when accessing a missing key', () => {
      expect(() => run(`
        var d = dict { "a" -> 1 };
        eval d["b"];
      `)).toThrow("Key not found in dict");
    });

    it('has() should return true for existing keys', () => {
      const { logs } = run(`
        var d = dict { "x" -> 1 };
        println(has(d, "x"));
        println(has(d, "y"));
      `);
      expect(logs).toEqual(['true', 'false']);
    });

    it('remove() should delete a key', () => {
      const { logs } = run(`
        var d = dict { "a" -> 1, "b" -> 2 };
        remove(d, "a");
        println(has(d, "a"));
        println(has(d, "b"));
      `);
      expect(logs).toEqual(['false', 'true']);
    });

    it('keys() should return all keys as a list', () => {
      const { logs } = run(`
        var d = dict { "x" -> 1 };
        println(keys(d));
      `);
      expect(logs).toEqual(['[x]']);
    });

    it('values() should return all values as a list', () => {
      const { logs } = run(`
        var d = dict { "x" -> 10, "y" -> 20 };
        println(values(d));
      `);
      expect(logs).toEqual(['[10, 20]']);
    });

    it('should throw when declaring a dict with let', () => {
      expect(() => run(`
        let d = dict { "x" -> 1 };
      `)).toThrow("Dictionaries must be declared with 'var'");
    });

    it('should throw on non-primitive key', () => {
      expect(() => run(`
        var d = dict {};
        var r = dict { [1, 2] -> "bad" };
      `)).toThrow("Dictionary keys must be");
    });

    it('should support boolean keys', () => {
      const { logs } = run(`
        var d = dict { true -> "yes", false -> "no" };
        println(d[true]);
        println(d[false]);
      `);
      expect(logs).toEqual(['yes', 'no']);
    });

    it('keys with the same value should be the same entry', () => {
      const { logs } = run(`
        var d = dict { "k" -> 1 };
        d["k"] = 2;
        println(d["k"]);
      `);
      expect(logs).toEqual(['2']);
    });

    it('should work inside a procedure', () => {
      const { logs } = run(`
        proc buildDict(lst) {
          var d = dict {};
          var i = 0;
          var remaining = lst;
          var item = head(remaining);
          d[item] = i;
          println(d[item]);
        }
        buildDict(["hello"]);
      `);
      expect(logs).toEqual(['0']);
    });

    it('should throw when trying to mutate a dict in a pure function', () => {
      expect(() => run(`
        function bad(d) {
          d["x"] = 1;
          return d;
        }
        var d = dict {};
        bad(d);
      `)).toThrow("Functions cannot mutate dicts");
    });
  });


  describe('Chars and Strings', () => {
    it('char literal should be a distinct type from string', () => {
      const { interpreter } = run(`var c = 'a';`);
      const c = interpreter.getGlobal('c');
      expect(c.constructor.name).toBe('PfunChar');
    });

    it("'a' should not equal \"a\"", () => {
      const { logs } = run(`println('a' == "a");`);
      expect(logs).toEqual(['false']);
    });

    it("two identical char literals should be equal", () => {
      const { logs } = run(`println('a' == 'a');`);
      expect(logs).toEqual(['true']);
    });

    it("two different char literals should not be equal", () => {
      const { logs } = run(`println('a' == 'b');`);
      expect(logs).toEqual(['false']);
    });

    it('asc() should return the ascii code of a char', () => {
      const { logs } = run(`println(asc('A'));`);
      expect(logs).toEqual(['65']);
    });

    it('chr() should return the char for an ascii code', () => {
      const { logs } = run(`println(chr(65));`);
      expect(logs).toEqual(['A']);
    });

    it('chr(asc(c)) should be the identity', () => {
      const { logs } = run(`println(chr(asc('z')));`);
      expect(logs).toEqual(['z']);
    });

    it('escape sequences should work in char literals', () => {
      const { logs } = run(`println(asc('\\n'));`);
      expect(logs).toEqual(['10']);
    });

    it('escape sequences should work in string literals', () => {
      const { logs } = run(`println("He said \\"hi\\"");`);
      expect(logs).toEqual(['He said "hi"']);
    });

    it('head of a string should return a char', () => {
      const { interpreter } = run(`var h = head("hello");`);
      const h = interpreter.getGlobal('h');
      expect(h.constructor.name).toBe('PfunChar');
      expect(h.value).toBe('h');
    });

    it('tail of a string should return a string', () => {
      const { logs } = run(`println(tail("hello"));`);
      expect(logs).toEqual(['ello']);
    });

    it('cons of char onto string should return a string', () => {
      const { logs } = run(`println(cons('H', "ello"));`);
      expect(logs).toEqual(['Hello']);
    });

    it('filter over a string should return a string', () => {
      const { logs } = run(`println(filter(fn c => c != 'l', "hello"));`);
      expect(logs).toEqual(['heo']);
    });

    it('map over a string returning chars should return a string', () => {
      const { logs } = run(`
        function shift(c) { return chr(asc(c) + 1); }
        println(map(fn c => shift(c), "abc"));
      `);
      expect(logs).toEqual(['bcd']);
    });

    it('reduce over a string should work', () => {
      const { logs } = run(`
        let count = reduce(fn acc, _ => acc + 1, 0, "hello");
        println(count);
      `);
      expect(logs).toEqual(['5']);
    });

    it('string concatenation with + should work', () => {
      const { logs } = run(`println("hello" + " " + "world");`);
      expect(logs).toEqual(['hello world']);
    });

    it('char + string concatenation should work', () => {
      const { logs } = run(`println('H' + "ello");`);
      expect(logs).toEqual(['Hello']);
    });
  });

  // ─── Empty list type compatibility ────────────────────────────────────────

  describe('Empty list [] type compatibility', () => {
    it('[] should be compatible as a record field previously typed as list<T>', () => {
      const { logs } = run(`
        type Box = { items }
        let a = Box { [1, 2, 3] };
        let b = Box { [] };
        println(a.items);
        println(b.items);
      `);
      expect(logs).toEqual(['[1, 2, 3]', '[]']);
    });

    it('[] should be compatible as a record field typed list<T> in any order', () => {
      const { logs } = run(`
        type Box = { items }
        let a = Box { [] };
        let b = Box { [1, 2, 3] };
        println(a.items);
        println(b.items);
      `);
      expect(logs).toEqual(['[]', '[1, 2, 3]']);
    });

    it('[] should be compatible as a union variant field previously typed as list<T>', () => {
      const { logs } = run(`
        type Wrap = {
          | Full: items
          | Empty: items
        }
        let a = Full { [1, 2, 3] };
        let b = Empty { [] };
        println(a.items);
        println(b.items);
      `);
      expect(logs).toEqual(['[1, 2, 3]', '[]']);
    });

    it('cons of typed list onto [] should work', () => {
      const { logs } = run(`
        let xs = cons([1, 2], []);
        println(xs);
      `);
      expect(logs).toEqual(['[[1, 2]]']);
    });

    it('a list containing [] and typed lists should be compatible', () => {
      const { logs } = run(`
        let matrix = [[1, 2], [], [3, 4]];
        println(matrix);
      `);
      expect(logs).toEqual(['[[1, 2], [], [3, 4]]']);
    });
  });

  // ─── Output Functions ──────────────────────────────────────────────────────




});
