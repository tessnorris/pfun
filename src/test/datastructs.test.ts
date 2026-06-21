// src/test/datastructs.test.ts
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Interpreter, PfunArray } from '../interpreter';
import { stdlibFunctions, stdlibTypes } from '../library';
import { mutStructuresFunctions, mutStructuresTypes, PfunBuffer } from '../mutStructures';
import { iolibFunctions } from '../iolib';

const run = (source: string) => {
  const ast = new Parser(new Lexer(source).lex()).parse();
  const interpreter = new Interpreter();
  interpreter.registerLibrary(stdlibFunctions, stdlibTypes);
  interpreter.registerLibrary(mutStructuresFunctions, mutStructuresTypes);
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

    it('should throw when declaring a dict built via toDict() with let', () => {
      expect(() => run(`
        var a = array { "x", "y" };
        let d = toDict(a);
      `)).toThrow("Dictionaries must be declared with 'var'");
    });

    it('should throw when declaring a dict built via listToDict() with let', () => {
      expect(() => run(`
        let d = listToDict([Pair { "k", 1 }]);
      `)).toThrow("Dictionaries must be declared with 'var'");
    });

    it('should throw when declaring a dict built via toDict() with let, even wrapped in parens', () => {
      expect(() => run(`
        var a = array { "x" };
        let d = (toDict(a));
      `)).toThrow("Dictionaries must be declared with 'var'");
    });

    it('error message names the actual constructor that was used (toDict)', () => {
      expect(() => run(`
        var a = array { "x" };
        let d = toDict(a);
      `)).toThrow('var d = toDict(...)');
    });

    it('error message names the actual constructor that was used (listToDict)', () => {
      expect(() => run(`
        let d = listToDict([]);
      `)).toThrow('var d = listToDict(...)');
    });

    it('toDict() works fine when declared with var', () => {
      const { logs } = run(`
        var a = array { "x", "y" };
        var d = toDict(a);
        println(d[0]);
        println(d[1]);
      `);
      expect(logs).toEqual(['x', 'y']);
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

    it('arrayLength() should return the element count', () => {
      const { logs } = run(`
        var a = array { 10, 20, 30 };
        println(arrayLength(a));
      `);
      expect(logs).toEqual(['3']);
    });

    it('length() should reject a PfunArray (use arrayLength instead)', () => {
      expect(() => run(`
        var a = array { 1, 2, 3 };
        eval length(a);
      `)).toThrow("arrayLength()");
    });

    it('arrayLength() should reject an immutable list', () => {
      expect(() => run(`eval arrayLength([1, 2, 3]);`))
        .toThrow("arrayLength() requires an array");
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
          println(arrayLength(a));
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
          println(arrayLength(a));
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
          println(arrayLength(a));
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
        println(arrayLength(a));
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
}
  // ─── Pair ─────────────────────────────────────────────────────────────────────

  describe('Pair', () => {
    it('is available without a type declaration', () => {
      const { interpreter } = run(`var p = Pair { "a", 1 };`);
      expect(interpreter.getGlobal('p').__type).toBe('Pair');
    });

    it('can be constructed positionally', () => {
      const { logs } = run(`
        let p = Pair { "hello", 42 };
        println(p.key);
        println(p.value);
      `);
      expect(logs).toEqual(['hello', '42']);
    });

    it('can be constructed with named fields', () => {
      const { logs } = run(`
        let p = Pair(key="lang", value="Pfun");
        println(p.key);
        println(p.value);
      `);
      expect(logs).toEqual(['lang', 'Pfun']);
    });

    it('can hold integer values', () => {
      const { logs } = run(`
        let p = Pair { 1, 99 };
        println(p.key);
        println(p.value);
      `);
      expect(logs).toEqual(['1', '99']);
    });

    it('can hold boolean values', () => {
      const { logs } = run(`
        let p = Pair(key="active", value=true);
        println(p.key);
        println(p.value);
      `);
      expect(logs).toEqual(['active', 'true']);
    });

    it('can hold record values', () => {
      const { logs } = run(`
        type Point = { x, y };
        let p = Pair(key="origin", value=Point { 0, 0 });
        println(p.key);
        println(p.value.x);
      `);
      expect(logs).toEqual(['origin', '0']);
    });

    it('works in a list', () => {
      const { logs } = run(`
        let pairs = [Pair { "a", 1 }, Pair { "b", 2 }, Pair { "c", 3 }];
        println(length(pairs));
        println(head(pairs).key);
        println(head(tail(pairs)).value);
      `);
      expect(logs).toEqual(['3', 'a', '2']);
    });

    it('works with map', () => {
      const { logs } = run(`
        let pairs = [Pair { "x", 10 }, Pair { "y", 20 }];
        let vals = map(fn p => p.value, pairs);
        println(vals);
      `);
      expect(logs).toEqual(['[10, 20]']);
    });

    it('works with filter', () => {
      const { logs } = run(`
        let pairs = [Pair { "a", 1 }, Pair { "b", 2 }, Pair { "c", 3 }];
        let big = filter(fn p => p.value > 1, pairs);
        println(length(big));
        println(head(big).key);
      `);
      expect(logs).toEqual(['2', 'b']);
    });

    it('can be used in a pure function', () => {
      const { logs } = run(`
        function swap(p) { return Pair(key=p.value, value=p.key); }
        let p = Pair(key="hello", value="world");
        let s = swap(p);
        println(s.key);
        println(s.value);
      `);
      expect(logs).toEqual(['world', 'hello']);
    });
  });

  // ─── dictToList ───────────────────────────────────────────────────────────────

  describe('dictToList', () => {
    it('converts a string-keyed dict to a list of Pairs', () => {
      const { logs } = run(`
        proc p() {
          var d = dict { "a" -> 1, "b" -> 2 };
          let pairs = dictToList(d);
          println(length(pairs));
        }
        p();
      `);
      expect(logs).toEqual(['2']);
    });

    it('each element is a Pair with correct key and value', () => {
      const { logs } = run(`
        proc p() {
          var d = dict { "name" -> "Alice" };
          let pairs = dictToList(d);
          let pair = head(pairs);
          println(pair.key);
          println(pair.value);
        }
        p();
      `);
      expect(logs).toEqual(['name', 'Alice']);
    });

    it('restores integer keys as integers', () => {
      const { logs } = run(`
        proc p() {
          var d = dict { 1 -> "one", 2 -> "two" };
          let pairs = dictToList(d);
          let pair = head(pairs);
          println(pair.key);
          println(pair.value);
        }
        p();
      `);
      expect(logs).toEqual(['1', 'one']);
    });

    it('restores boolean keys as booleans', () => {
      const { logs } = run(`
        proc p() {
          var d = dict { true -> "yes", false -> "no" };
          let pairs = dictToList(d);
          let trueEntry = head(filter(fn p => p.key == true, pairs));
          println(trueEntry.value);
        }
        p();
      `);
      expect(logs).toEqual(['yes']);
    });

    it('returns an empty list for an empty dict', () => {
      const { logs } = run(`
        proc p() {
          var d = dict {};
          let pairs = dictToList(d);
          println(length(pairs));
        }
        p();
      `);
      expect(logs).toEqual(['0']);
    });

    it('pairs can be mapped over', () => {
      const { logs } = run(`
        proc p() {
          var d = dict { "x" -> 10, "y" -> 20, "z" -> 30 };
          let pairs = dictToList(d);
          let vals = map(fn p => p.value, pairs);
          let total = reduce(fn acc, v => acc + v, 0, vals);
          println(total);
        }
        p();
      `);
      expect(logs).toEqual(['60']);
    });

    it('pairs can be filtered', () => {
      const { logs } = run(`
        proc p() {
          var d = dict { "a" -> 1, "b" -> 2, "c" -> 3 };
          let pairs = dictToList(d);
          let big = filter(fn p => p.value > 1, pairs);
          println(length(big));
        }
        p();
      `);
      expect(logs).toEqual(['2']);
    });

    it('throws on non-dict argument', () => {
      expect(() => run(`eval dictToList([1, 2, 3]);`)).toThrow();
    });
  });
}
  // ─── listToDict ───────────────────────────────────────────────────────────────

  describe('listToDict', () => {
    it('converts a list of string-keyed Pairs to a dict', () => {
      const { logs } = run(`
        proc p() {
          let pairs = [Pair { "a", 1 }, Pair { "b", 2 }];
          var d = listToDict(pairs);
          println(d["a"]);
          println(d["b"]);
        }
        p();
      `);
      expect(logs).toEqual(['1', '2']);
    });

    it('converts a list of integer-keyed Pairs to a dict', () => {
      const { logs } = run(`
        proc p() {
          let pairs = [Pair { 1, "one" }, Pair { 2, "two" }];
          var d = listToDict(pairs);
          println(d[1]);
          println(d[2]);
        }
        p();
      `);
      expect(logs).toEqual(['one', 'two']);
    });

    it('converts a list of boolean-keyed Pairs to a dict', () => {
      const { logs } = run(`
        proc p() {
          let pairs = [Pair { true, "yes" }, Pair { false, "no" }];
          var d = listToDict(pairs);
          println(d[true]);
          println(d[false]);
        }
        p();
      `);
      expect(logs).toEqual(['yes', 'no']);
    });

    it('round-trips with dictToList', () => {
      const { logs } = run(`
        proc p() {
          var d = dict { "x" -> 10, "y" -> 20, "z" -> 30 };
          var d2 = listToDict(dictToList(d));
          println(d2["x"]);
          println(d2["y"]);
          println(d2["z"]);
        }
        p();
      `);
      expect(logs).toEqual(['10', '20', '30']);
    });

    it('empty list produces empty dict', () => {
      const { logs } = run(`
        proc p() {
          var d = listToDict([]);
          println(has(d, "a"));
        }
        p();
      `);
      expect(logs).toEqual(['false']);
    });

    it('later pairs overwrite earlier pairs with the same key', () => {
      const { logs } = run(`
        proc p() {
          let pairs = [Pair { "k", 1 }, Pair { "k", 2 }];
          var d = listToDict(pairs);
          println(d["k"]);
        }
        p();
      `);
      expect(logs).toEqual(['2']);
    });

    it('throws on non-list argument', () => {
      expect(() => run(`eval listToDict("not a list");`)).toThrow();
    });

    it('throws on list containing non-Pair records', () => {
      expect(() => run(`
        type Foo = { x };
        eval listToDict([Foo { 1 }]);
      `)).toThrow();
    });
  });

  // ─── Buffer Operations ───────────────────────────────────────────────────────
  //
  // Buffer (PfunBuffer) moved here from filelib.ts so it's a core mutable
  // structure, usable without `import * from "file"` — the run() helper at the
  // top of this file registers only stdlib + mutStructures + iolib (no
  // filelib), so every passing test in this section is itself proof the move
  // worked: nothing here needs the file module. readBuffer/writeBuffer
  // (file-handle-bound, stayed in filelib.ts) are tested separately in
  // filelib_byte_test.ts.

  describe('Buffers', () => {
    describe('makeBuffer', () => {
      it('creates an empty ByteMode buffer', () => {
        const { interpreter } = run(`var b = makeBuffer(ByteMode);`);
        const b = interpreter.getGlobal('b');
        expect(b).toBeInstanceOf(PfunBuffer);
        expect(b.mode).toBe('byte');
        expect(b.pos).toBe(0);
      });

      it('creates an empty CharMode buffer', () => {
        const { interpreter } = run(`var b = makeBuffer(CharMode);`);
        const b = interpreter.getGlobal('b');
        expect(b).toBeInstanceOf(PfunBuffer);
        expect(b.mode).toBe('char');
      });

      it('throws on an invalid mode', () => {
        expect(() => run(`eval makeBuffer(42);`))
          .toThrow('makeBuffer: mode must be ByteMode or CharMode.');
      });

      it('bufferLength() of a fresh buffer is 0', () => {
        const { logs } = run(`
          var b = makeBuffer(ByteMode);
          println(bufferLength(b));
        `);
        expect(logs).toEqual(['0']);
      });

      it('throws when declared with let', () => {
        expect(() => run(`let b = makeBuffer(ByteMode);`))
          .toThrow("Buffers must be declared with 'var'");
      });

      it('throws when declared with let, even wrapped in parens', () => {
        expect(() => run(`let b = (makeBuffer(CharMode));`))
          .toThrow("Buffers must be declared with 'var'");
      });

      it('error message names the actual constructor that was used', () => {
        expect(() => run(`let b = makeBuffer(ByteMode);`))
          .toThrow('var b = makeBuffer(...)');
      });
    });

    describe('makeStringBuffer', () => {
      it('seeds a CharMode buffer with the given string', () => {
        const { logs } = run(`
          var b = makeStringBuffer("Hello");
          println(bufferToString(b));
          println(bufferLength(b));
        `);
        expect(logs).toEqual(['Hello', '5']);
      });

      it('handles an empty string', () => {
        const { logs } = run(`
          var b = makeStringBuffer("");
          println(bufferLength(b));
        `);
        expect(logs).toEqual(['0']);
      });

      it('produces a buffer that can still be appended to afterward', () => {
        const { logs } = run(`
          proc p() {
            var b = makeStringBuffer("");
            appendString(b, "later");
            println(bufferToString(b));
          }
          p();
        `);
        expect(logs).toEqual(['later']);
      });

      it('throws on a non-string argument', () => {
        expect(() => run(`eval makeStringBuffer(42);`))
          .toThrow('makeStringBuffer: argument must be a string.');
      });

      it('throws when declared with let', () => {
        expect(() => run(`let b = makeStringBuffer("x");`))
          .toThrow("Buffers must be declared with 'var'");
      });

      it('error message names the actual constructor that was used', () => {
        expect(() => run(`let b = makeStringBuffer("x");`))
          .toThrow('var b = makeStringBuffer(...)');
      });
    });

    describe('appendBuffer', () => {
      it('appends a List<Byte> and mutates in place', () => {
        const { logs } = run(`
          proc p() {
            var b = makeBuffer(ByteMode);
            appendBuffer(b, [72b, 105b]);
            println(bufferLength(b));
            println(bufferToString(b));
          }
          p();
        `);
        expect(logs).toEqual(['2', 'Hi']);
      });

      it('returns the buffer, enabling chained calls', () => {
        const { logs } = run(`
          proc p() {
            var b = appendBuffer(appendBuffer(makeBuffer(ByteMode), [72b]), [105b]);
            println(bufferToString(b));
          }
          p();
        `);
        expect(logs).toEqual(['Hi']);
      });

      it('throws on a non-Buffer first argument', () => {
        expect(() => run(`
          proc p() { appendBuffer("not a buffer", [72b]); }
          p();
        `)).toThrow('appendBuffer: first argument must be a Buffer.');
      });

      it('throws on a non-List<Byte> second argument', () => {
        expect(() => run(`
          proc p() { appendBuffer(makeBuffer(ByteMode), "not bytes"); }
          p();
        `)).toThrow('appendBuffer: second argument must be a List<Byte>.');
      });

      it('throws in a pure function', () => {
        expect(() => run(`
          proc setup() { return makeBuffer(ByteMode); }
          function bad(b) {
            appendBuffer(b, [72b]);
            return b;
          }
          bad(setup());
        `)).toThrow("Functions cannot use 'appendBuffer'");
      });
    });

    describe('appendChar', () => {
      it('UTF-8 encodes and appends a single char', () => {
        const { logs } = run(`
          proc p() {
            var b = makeStringBuffer("Hi");
            appendChar(b, '!');
            println(bufferToString(b));
          }
          p();
        `);
        expect(logs).toEqual(['Hi!']);
      });

      it('handles a multi-byte UTF-8 char', () => {
        const { logs } = run(`
          proc p() {
            var b = makeBuffer(CharMode);
            appendChar(b, 'é');
            println(bufferLength(b));
            println(bufferToString(b));
          }
          p();
        `);
        expect(logs).toEqual(['2', 'é']); // é is 2 bytes in UTF-8
      });

      it('returns the buffer, enabling chained calls', () => {
        const { logs } = run(`
          proc p() {
            var b = appendChar(appendChar(makeBuffer(CharMode), 'h'), 'i');
            println(bufferToString(b));
          }
          p();
        `);
        expect(logs).toEqual(['hi']);
      });

      it('throws on a non-Buffer first argument', () => {
        expect(() => run(`
          proc p() { appendChar("not a buffer", 'x'); }
          p();
        `)).toThrow('appendChar: first argument must be a Buffer.');
      });

      it('throws on a non-char second argument', () => {
        expect(() => run(`
          proc p() { appendChar(makeBuffer(CharMode), "not a char"); }
          p();
        `)).toThrow('appendChar: second argument must be a char.');
      });

      it('throws in a pure function', () => {
        expect(() => run(`
          proc setup() { return makeBuffer(CharMode); }
          function bad(b) {
            appendChar(b, 'x');
            return b;
          }
          bad(setup());
        `)).toThrow("Functions cannot use 'appendChar'");
      });
    });

    describe('appendString', () => {
      it('UTF-8 encodes and appends a string, mutating in place', () => {
        const { logs } = run(`
          proc p() {
            var b = makeStringBuffer("Hello");
            appendString(b, ", world");
            println(bufferToString(b));
            println(bufferLength(b));
          }
          p();
        `);
        expect(logs).toEqual(['Hello, world', '12']);
      });

      it('appending an empty string is a no-op', () => {
        const { logs } = run(`
          proc p() {
            var b = makeStringBuffer("x");
            appendString(b, "");
            println(bufferToString(b));
            println(bufferLength(b));
          }
          p();
        `);
        expect(logs).toEqual(['x', '1']);
      });

      it('returns the buffer, enabling chained calls', () => {
        const { logs } = run(`
          proc p() {
            var b = appendString(appendString(makeBuffer(CharMode), "foo"), "bar");
            println(bufferToString(b));
          }
          p();
        `);
        expect(logs).toEqual(['foobar']);
      });

      it('compounds correctly across several separate calls on the same var-bound buffer', () => {
        const expected = 'ab'.repeat(20); // 40 chars
        const { logs } = run(`
          proc p() {
            var b = makeBuffer(CharMode);
            proc loop(i) {
              if i < 20 then {
                appendString(b, "ab");
                loop(i + 1);
              } else 0;
            }
            loop(0);
            println(bufferLength(b));
            println(bufferToString(b) == "${expected}");
          }
          p();
        `);
        expect(logs).toEqual(['40', 'true']);
      });

      it('grows capacity correctly for a single chunk larger than the default 4096-byte capacity', () => {
        const longStr = 'ab'.repeat(2500); // 5000 bytes
        const { logs } = run(`
          proc p() {
            var b = makeBuffer(CharMode);
            appendString(b, "${longStr}");
            println(bufferLength(b));
            println(bufferToString(b) == "${longStr}");
          }
          p();
        `);
        expect(logs).toEqual(['5000', 'true']);
      });

      it('throws on a non-Buffer first argument', () => {
        expect(() => run(`
          proc p() { appendString("not a buffer", "x"); }
          p();
        `)).toThrow('appendString: first argument must be a Buffer.');
      });

      it('throws on a non-string second argument', () => {
        expect(() => run(`
          proc p() { appendString(makeBuffer(CharMode), 42); }
          p();
        `)).toThrow('appendString: second argument must be a string.');
      });

      it('throws in a pure function', () => {
        expect(() => run(`
          proc setup() { return makeBuffer(CharMode); }
          function bad(b) {
            appendString(b, "x");
            return b;
          }
          bad(setup());
        `)).toThrow("Functions cannot use 'appendString'");
      });
    });

    describe('mixing appendBuffer/appendChar/appendString on the same buffer', () => {
      it('all three interoperate regardless of buffer mode', () => {
        const { logs } = run(`
          proc p() {
            var b = makeBuffer(ByteMode);
            appendString(b, "ab");
            appendChar(b, 'c');
            appendBuffer(b, [100b]); // 'd'
            println(bufferToString(b));
            println(bufferLength(b));
          }
          p();
        `);
        expect(logs).toEqual(['abcd', '4']);
      });
    });

    describe('bufferToBytes', () => {
      it('returns a List<Byte> copy of the buffer contents', () => {
        const { logs } = run(`
          proc p() {
            var b = makeBuffer(ByteMode);
            appendBuffer(b, [10b, 20b, 30b]);
            let bytes = bufferToBytes(b);
            println(length(bytes));
            println(nth(bytes, 0));
            println(nth(bytes, 2));
          }
          p();
        `);
        expect(logs).toEqual(['3', '10', '30']);
      });

      it('throws on a non-Buffer argument', () => {
        expect(() => run(`eval bufferToBytes("not a buffer");`))
          .toThrow('bufferToBytes: argument must be a Buffer.');
      });
    });

    describe('bufferToString', () => {
      it('decodes a CharMode buffer as UTF-8, including multi-byte chars', () => {
        const { logs } = run(`
          var b = makeStringBuffer("café");
          println(bufferToString(b));
        `);
        expect(logs).toEqual(['café']);
      });

      it('also works on a ByteMode buffer (raw UTF-8 decode)', () => {
        const { logs } = run(`
          proc p() {
            var b = makeBuffer(ByteMode);
            appendBuffer(b, [104b, 105b]); // "hi"
            println(bufferToString(b));
          }
          p();
        `);
        expect(logs).toEqual(['hi']);
      });

      it('throws on a non-Buffer argument', () => {
        expect(() => run(`eval bufferToString(42);`))
          .toThrow('bufferToString: argument must be a Buffer.');
      });
    });

    describe('bufferLength', () => {
      it('tracks length as content is appended', () => {
        const { logs } = run(`
          proc p() {
            var b = makeBuffer(CharMode);
            println(bufferLength(b));
            appendString(b, "abc");
            println(bufferLength(b));
          }
          p();
        `);
        expect(logs).toEqual(['0', '3']);
      });

      it('throws on a non-Buffer argument', () => {
        expect(() => run(`eval bufferLength(true);`))
          .toThrow('bufferLength: argument must be a Buffer.');
      });
    });

    describe('Buffer is available without importing "file"', () => {
      it('construction and manipulation work with only stdlib+mutStructures+iolib registered', () => {
        // run() above never registers filelibFunctions/filelibTypes — this
        // test passing is itself proof that Buffer no longer requires
        // `import * from "file"`, now that it lives in mutStructures.ts.
        const { logs } = run(`
          proc p() {
            var b = makeStringBuffer("ok");
            println(bufferToString(b));
          }
          p();
        `);
        expect(logs).toEqual(['ok']);
      });
    });

    describe('let vs var: the guard turns a silent footgun into a loud error', () => {
      // Before this guard existed, `let b = makeBuffer(...)` would silently
      // re-evaluate the constructor on every access (Pfun's `let` is
      // call-by-name, not memoized) — so a later statement mutating `b`
      // would mutate a throwaway buffer that nothing ever reads again,
      // while a subsequent read re-constructs a fresh, unmutated buffer.
      // The guard rejects the let-binding outright at the point of
      // declaration instead of letting that silently wrong behavior occur.
      it('rejects the exact pattern that used to silently lose mutations (makeStringBuffer)', () => {
        expect(() => run(`
          proc p() {
            let b = makeStringBuffer("Hello");
            appendString(b, ", world");
            println(bufferToString(b));
          }
          p();
        `)).toThrow("Buffers must be declared with 'var'");
      });

      it('the var-based equivalent of the above genuinely works end-to-end', () => {
        const { logs } = run(`
          proc p() {
            var b = makeStringBuffer("Hello");
            appendString(b, ", world");
            println(bufferToString(b));
          }
          p();
        `);
        expect(logs).toEqual(['Hello, world']);
      });

      it('rejects the exact pattern that used to silently lose mutations (toDict)', () => {
        expect(() => run(`
          proc p() {
            var a = array { "x", "y" };
            let d = toDict(a);
            d[2] = "z";
            println(keys(d));
          }
          p();
        `)).toThrow("Dictionaries must be declared with 'var'");
      });

      it('the var-based equivalent of the above genuinely works end-to-end', () => {
        const { logs } = run(`
          proc p() {
            var a = array { "x", "y" };
            var d = toDict(a);
            d[2] = "z";
            println(d[0]);
            println(d[2]);
          }
          p();
        `);
        expect(logs).toEqual(['x', 'z']);
      });
    });
  });

  // ─── PfunBuffer.append() — native growth logic ─────────────────────────────
  //
  // Direct TS-level tests of the growth/append mechanism generalized from
  // readBuffer's old inline single-char doubling step (see filelib.ts).
  // Pfun-level behavior is covered above via appendBuffer/appendChar/appendString;
  // these tests pin down the exact capacity math.

  describe('PfunBuffer.append (native)', () => {
    it('appends bytes within existing capacity without growing', () => {
      const buf = new PfunBuffer('byte', 16);
      buf.append(Buffer.from([1, 2, 3]));
      expect(buf.pos).toBe(3);
      expect(buf.data.length).toBe(16);
    });

    it('doubles capacity exactly once when a chunk slightly exceeds capacity', () => {
      const buf = new PfunBuffer('byte', 4);
      buf.append(Buffer.from([1, 2, 3, 4, 5])); // 5 bytes > 4 capacity
      expect(buf.pos).toBe(5);
      expect(buf.data.length).toBe(8); // doubled once: 4 -> 8
    });

    it('doubles capacity multiple times in a single call when needed', () => {
      const buf = new PfunBuffer('byte', 4);
      const chunk = Buffer.alloc(100, 7);
      buf.append(chunk); // needs 4 -> 8 -> 16 -> 32 -> 64 -> 128
      expect(buf.pos).toBe(100);
      expect(buf.data.length).toBe(128);
      expect(buf.data.subarray(0, 100)).toEqual(chunk);
    });

    it('appending an empty chunk is a no-op', () => {
      const buf = new PfunBuffer('byte', 16);
      buf.append(Buffer.from([]));
      expect(buf.pos).toBe(0);
      expect(buf.data.length).toBe(16);
    });

    it('multiple sequential appends accumulate correctly', () => {
      const buf = new PfunBuffer('char', 4);
      buf.append(Buffer.from('ab', 'utf8'));
      buf.append(Buffer.from('cd', 'utf8'));
      buf.append(Buffer.from('ef', 'utf8'));
      expect(buf.pos).toBe(6);
      expect(buf.data.toString('utf8', 0, buf.pos)).toBe('abcdef');
    });
  });
});
