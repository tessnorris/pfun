// src/test/datastructs.test.ts
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Interpreter, PfunArray } from '../interpreter';
import { stdlibFunctions, stdlibTypes } from '../library';
import { iolibFunctions } from '../iolib';

const run = (source: string) => {
  const ast = new Parser(new Lexer(source).lex()).parse();
  const interpreter = new Interpreter();
  interpreter.registerLibrary(stdlibFunctions, stdlibTypes);
  interpreter.registerLibrary(iolibFunctions, []);
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
        let result = match x with | Some s -> s.value | None -> 0;
        println(result);
      `);
      expect(logs).toEqual(['42']);
    });

    it('should match None and return the default', () => {
      const { logs } = run(`
        let x = None;
        let result = match x with | Some s -> s.value | None -> 0;
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
        let result = match x with
          | Some s where s.value > 50 -> "big"
          | Some _ -> "small"
          | None   -> "nothing";
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
        let result = match x with | Some s -> s.value | _ -> 999;
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
          return match acc with | Some _ -> acc | None -> x;
        }
        let candidates = [None, None, Some { 7 }, Some { 8 }];
        let first = reduce(fn a, x => firstSome(a, x), None, candidates);
        println(match first with | Some s -> s.value | None -> 0);
      `);
      expect(logs).toEqual(['7']);
    });

    it('should allow user-defined zero-field variants in other union types', () => {
      const { logs } = run(`
        type Result = { | Ok: value | Err }
        let ok  = Ok { 42 };
        let err = Err;
        println(match ok  with | Ok o -> o.value | Err -> 0);
        println(match err with | Ok o -> o.value | Err -> 0);
      `);
      expect(logs).toEqual(['42', '0']);
    });
  });

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

    it('should throw when accessing a missing key', () => {
      expect(() => run(`
        var d = dict { "a" -> 1 };
        eval d["b"];
      `)).toThrow("Key not found in dict");
    });

    it('has() should return true for existing keys, false otherwise', () => {
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

    it('keys() and values() should return all entries', () => {
      const { logs } = run(`
        var d = dict { "x" -> 10 };
        println(keys(d));
        println(values(d));
      `);
      expect(logs).toEqual(['[x]', '[10]']);
    });

    it('should throw when declaring a dict with let', () => {
      expect(() => run(`
        let d = dict { "x" -> 1 };
      `)).toThrow("Dictionaries must be declared with 'var'");
    });

    it('should support boolean keys', () => {
      const { logs } = run(`
        var d = dict { true -> "yes", false -> "no" };
        println(d[true]);
        println(d[false]);
      `);
      expect(logs).toEqual(['yes', 'no']);
    });

    it('should throw when trying to mutate a dict in a pure function', () => {
      expect(() => run(`
        function bad(d) { d["x"] = 1; return d; }
        var d = dict {};
        bad(d);
      `)).toThrow("Functions cannot mutate arrays or dicts");
    });
  });

  describe('Chars and Strings', () => {
    it('char literal should be a distinct type from string', () => {
      const { interpreter } = run(`var c = 'a';`);
      expect(interpreter.getGlobal('c').constructor.name).toBe('PfunChar');
    });

    it("'a' should not equal \"a\"", () => {
      const { logs } = run(`println('a' == "a");`);
      expect(logs).toEqual(['false']);
    });

    it('asc() and chr() should round-trip', () => {
      const { logs } = run(`println(chr(asc('z')));`);
      expect(logs).toEqual(['z']);
    });

    it('head/tail/cons should work on strings', () => {
      const { logs } = run(`
        println(head("hello"));
        println(tail("hello"));
        println(cons('H', "ello"));
      `);
      expect(logs).toEqual(['h', 'ello', 'Hello']);
    });

    it('filter over a string should return a string', () => {
      const { logs } = run(`println(filter(fn c => c != 'l', "hello"));`);
      expect(logs).toEqual(['heo']);
    });
  });

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
  });

  // ─── Arrays ───────────────────────────────────────────────────────────────────

  describe('Arrays', () => {
    it('should construct an array with var', () => {
      const { interpreter } = run(`var a = array { "Alice", "Bob", "Carol" };`);
      const a = interpreter.getGlobal('a');
      expect(a).toBeInstanceOf(PfunArray);
      expect(a.elements).toEqual(['Alice', 'Bob', 'Carol']);
    });

    it('should construct an empty array', () => {
      const { interpreter } = run(`var a = array {};`);
      const a = interpreter.getGlobal('a');
      expect(a).toBeInstanceOf(PfunArray);
      expect(a.elements).toHaveLength(0);
    });

    it('should throw when declaring an array with let', () => {
      expect(() => run(`let a = array { 1, 2, 3 };`))
        .toThrow("Arrays must be declared with 'var'");
    });

    it('should access elements by index', () => {
      const { logs } = run(`
        var a = array { "Alice", "Bob", "Carol" };
        println(a[0]);
        println(a[2]);
      `);
      expect(logs).toEqual(['Alice', 'Carol']);
    });

    it('should throw on out-of-bounds access', () => {
      expect(() => run(`
        var a = array { 1, 2, 3 };
        eval a[5];
      `)).toThrow("out of bounds");
    });

    it('should support index assignment', () => {
      const { logs } = run(`
        proc p() {
          var a = array { "Alice", "Bob" };
          a[1] = "Charlie";
          println(a[1]);
        }
        p();
      `);
      expect(logs).toEqual(['Charlie']);
    });

    it('should throw on type mismatch in assignment', () => {
      expect(() => run(`
        proc p() {
          var a = array { 1, 2, 3 };
          a[0] = "hello";
        }
        p();
      `)).toThrow("Type mismatch in array");
    });

    it('length() should return the element count', () => {
      const { logs } = run(`
        var a = array { 10, 20, 30 };
        println(length(a));
      `);
      expect(logs).toEqual(['3']);
    });

    it('should print as array { ... }', () => {
      const { logs } = run(`
        var a = array { 1, 2, 3 };
        println(a);
      `);
      expect(logs).toEqual(['array { 1, 2, 3 }']);
    });

    it('should enforce homogeneous element types at construction', () => {
      expect(() => run(`var a = array { 1, "two", 3 };`))
        .toThrow("Type mismatch in array");
    });

    it('append() should add an element to the end', () => {
      const { logs } = run(`
        proc p() {
          var a = array { "Alice", "Bob" };
          append(a, "Dave");
          println(length(a));
          println(a[2]);
        }
        p();
      `);
      expect(logs).toEqual(['3', 'Dave']);
    });

    it('append() should throw on type mismatch', () => {
      expect(() => run(`
        proc p() {
          var a = array { 1, 2 };
          append(a, "three");
        }
        p();
      `)).toThrow("Type mismatch in array");
    });

    it('removeAt() should remove an element and shift the rest', () => {
      const { logs } = run(`
        proc p() {
          var a = array { "Alice", "Bob", "Carol" };
          removeAt(a, 1);
          println(length(a));
          println(a[0]);
          println(a[1]);
        }
        p();
      `);
      expect(logs).toEqual(['2', 'Alice', 'Carol']);
    });

    it('removeAt() should throw on out-of-bounds index', () => {
      expect(() => run(`
        proc p() {
          var a = array { 1, 2 };
          removeAt(a, 5);
        }
        p();
      `)).toThrow("out of bounds");
    });

    it('insertAt() should insert an element and shift later ones', () => {
      const { logs } = run(`
        proc p() {
          var a = array { "Alice", "Bob", "Dave" };
          insertAt(a, 2, "Charlie");
          println(length(a));
          println(a[2]);
          println(a[3]);
        }
        p();
      `);
      expect(logs).toEqual(['4', 'Charlie', 'Dave']);
    });

    it('insertAt() at index 0 should prepend', () => {
      const { logs } = run(`
        proc p() {
          var a = array { "Bob", "Carol" };
          insertAt(a, 0, "Alice");
          println(a[0]);
          println(a[1]);
        }
        p();
      `);
      expect(logs).toEqual(['Alice', 'Bob']);
    });

    it('insertAt() at length should append', () => {
      const { logs } = run(`
        proc p() {
          var a = array { "Alice", "Bob" };
          insertAt(a, 2, "Carol");
          println(a[2]);
        }
        p();
      `);
      expect(logs).toEqual(['Carol']);
    });

    it('insertAt() should throw when index exceeds length', () => {
      expect(() => run(`
        proc p() {
          var a = array { 1, 2 };
          insertAt(a, 10, 3);
        }
        p();
      `)).toThrow("out of bounds");
    });

    it('find() should work on arrays', () => {
      const { logs } = run(`
        var a = array { "Alice", "Bob", "Carol" };
        println(match find(a, "Bob") with | Some s -> s.value | None -> "not found");
        println(match find(a, "Eve") with | Some s -> s.value | None -> "not found");
      `);
      expect(logs).toEqual(['1', 'not found']);
    });

    it('toList() should convert array to an immutable list', () => {
      const { logs } = run(`
        var a = array { 1, 2, 3 };
        let l = toList(a);
        println(l);
      `);
      expect(logs).toEqual(['[1, 2, 3]']);
    });

    it('toArray() should convert a list to a mutable array', () => {
      const { interpreter } = run(`
        let l = [10, 20, 30];
        var a = toArray(l);
      `);
      const a = interpreter.getGlobal('a');
      expect(a).toBeInstanceOf(PfunArray);
      expect(a.elements).toEqual([10n, 20n, 30n]);
    });

    it('toArray() should convert a string to an array of chars', () => {
      const { logs } = run(`
        var a = toArray("hello");
        println(a[0]);
        println(length(a));
      `);
      expect(logs).toEqual(['h', '5']);
    });

    it('toDict() should produce a dict with integer keys', () => {
      const { logs } = run(`
        var a = array { "x", "y", "z" };
        var d = toDict(a);
        println(d[0]);
        println(d[2]);
      `);
      expect(logs).toEqual(['x', 'z']);
    });

    it('should throw when using append/removeAt/insertAt in a pure function', () => {
      expect(() => run(`
        var a = array { 1, 2 };
        function bad(arr) { return append(arr, 3); }
        bad(a);
      `)).toThrow("side effects not allowed in pure functions");

      expect(() => run(`
        var a = array { 1, 2 };
        function bad(arr) { return removeAt(arr, 0); }
        bad(a);
      `)).toThrow("side effects not allowed in pure functions");

      expect(() => run(`
        var a = array { 1, 2 };
        function bad(arr) { return insertAt(arr, 0, 0); }
        bad(a);
      `)).toThrow("side effects not allowed in pure functions");
    });

    it('should throw on index assignment in a pure function', () => {
      expect(() => run(`
        var a = array { 1, 2 };
        function bad(arr) { arr[0] = 99; return arr; }
        bad(a);
      `)).toThrow("Functions cannot mutate arrays or dicts");
    });
  });
});
