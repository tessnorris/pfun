import { Lexer } from './lexer';
import { Parser } from './parser';
import { Interpreter } from './interpreter';

const run = (source: string) => {
  const ast = new Parser(new Lexer(source).lex()).parse();
  const interpreter = new Interpreter();
  const logs: any[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => logs.push(args.map(a => String(a)).join(' '));
  try { interpreter.interpret(ast); }
  finally { console.log = originalLog; }
  return { logs, interpreter };
};

// ─── Existing Feature Tests ────────────────────────────────────────────────────

describe('Interpreter Feature Tests', () => {
  describe('Mutability Rules', () => {
    it('should prevent reassignment to let bindings', () => {
      expect(() => run('let x = 10; x = 20;')).toThrow("Cannot assign to immutable variable 'x'");
    });

    it('should allow reassignment to var bindings and force evaluation', () => {
      const { logs } = run('var x = 10; x = 20; print x;');
      expect(logs).toEqual(['20']);
    });
  });

  describe('Ternary & Equality', () => {
    it('should evaluate ternary operators lazily', () => {
      const { logs } = run('let x = true ? 1 : undefined_var; print x;');
      expect(logs).toEqual(['1']);
    });

    it('should test equality correctly', () => {
      const { logs } = run('print (10 == 10); print (10 == 5);');
      expect(logs).toEqual(['true', 'false']);
    });
  });

  describe('Lists & Higher Order Functions', () => {
    it('should support list operations', () => {
      const { logs } = run(`
        let l1 = ["a", "b", "c"];
        print head(l1);
        print tail(l1);
        print cons("d", tail(l1));
      `);
      expect(logs[0]).toBe('a');
      expect(logs[1]).toBe('[b, c]');
      expect(logs[2]).toBe('[d, b, c]');
    });

    it('should allow lists containing items of the same type', () => {
      const { logs } = run(`
        let l = [1, 2, 3];
        print head(l);
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
        print sum;
      `);
      expect(logs).toEqual(['12']);
    });
  });

  describe('Records & Type Checking', () => {
    it('should create and access records', () => {
      const { logs } = run(`
        type Customer = { firstName, lastName };
        let c1 = Customer { "John", "Smith" };
        print c1.firstName + " " + c1.lastName;
      `);
      expect(logs).toEqual(['John Smith']);
    });

    it('should support named record instantiation via ()', () => {
      const { logs } = run(`
        type Point = { x, y };
        let p = Point(y=20, x=10);
        print p.x;
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
        print sq.side;
      `);
      expect(logs).toEqual(['10']);
    });

    it('should construct a variant with named fields via {}', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var ci = Circle { radius = 5 };
        print ci.radius;
      `);
      expect(logs).toEqual(['5']);
    });

    it('should construct a variant with named fields out of order via {}', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var re = Rectangle { y=20, x=10 };
        print re.x;
        print re.y;
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
    it('should allow print inside a procedure', () => {
      const { logs } = run(`
        proc greet(name) {
          print "Hello, " + name;
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
          print x;
        }
        counter();
      `);
      expect(logs).toEqual(['1']);
    });

    it('should allow a procedure to call a pure function', () => {
      const { logs } = run(`
        function double(x) { return x * 2; }
        proc printDouble(n) { print double(n); }
        printDouble(7);
      `);
      expect(logs).toEqual(['14']);
    });

    it('should throw when a function uses print', () => {
      expect(() => run(`
        function bad(x) { print x; }
        bad(1);
      `)).toThrow("Functions cannot use 'print'");
    });

    it('should throw when a function uses var', () => {
      expect(() => run(`
        function bad(x) { var y = x + 1; return y; }
        bad(1);
      `)).toThrow("Functions cannot use 'var'");
    });

    it('should throw when a function calls a procedure', () => {
      expect(() => run(`
        proc sideEffect() { print "oops"; }
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
          print result;
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
        print countdown(10000);
      `);
      expect(logs).toEqual(['done']);
    });

    it('should memoize pure function results', () => {
      // fact(5,1) called twice — second call should hit the cache
      const { logs } = run(`
        function fact(n, acc) {
          if n <= 1 then return acc else fact(n - 1, n * acc);
        }
        print fact(5, 1);
        print fact(5, 1);
      `);
      expect(logs).toEqual(['120', '120']);
    });

    it('should allow procedures to mutate vars across multiple calls', () => {
      const { logs } = run(`
        var total = 0;
        proc add(n) {
          total = total + n;
          print total;
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
          print f(x);
        }
        applyAndPrint(fn x => x * x, 7);
      `);
      expect(logs).toEqual(['49']);
    });
  });

  // ─── Option Type ───────────────────────────────────────────────────────────

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
        let result = match x {
          | Some s -> s.value
          | None   -> 0
        };
        print result;
      `);
      expect(logs).toEqual(['42']);
    });

    it('should match None and return the default', () => {
      const { logs } = run(`
        let x = None;
        let result = match x {
          | Some s -> s.value
          | None   -> 0
        };
        print result;
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
        print match good { | Some s -> s.value | None -> 0 };
        print match bad  { | Some s -> s.value | None -> 0 };
      `);
      expect(logs).toEqual(['5', '0']);
    });

    it('should support where guards on Some', () => {
      const { logs } = run(`
        let x = Some { 100 };
        let result = match x {
          | Some s where s.value > 50 -> "big"
          | Some _                    -> "small"
          | None                      -> "nothing"
        };
        print result;
      `);
      expect(logs).toEqual(['big']);
    });

    it('should require exhaustive match on Option', () => {
      expect(() => run(`
        let x = Some { 1 };
        match x { | Some s -> s.value };
      `)).toThrow("Non-exhaustive match on 'Option': missing arm(s) for 'None'.");
    });

    it('should work with wildcard instead of explicit None arm', () => {
      const { logs } = run(`
        let x = None;
        let result = match x {
          | Some s -> s.value
          | _      -> 999
        };
        print result;
      `);
      expect(logs).toEqual(['999']);
    });

    it('should support Option values in lists with map', () => {
      const { logs } = run(`
        let opts = [Some { 1 }, Some { 2 }, Some { 3 }];
        let vals = map(fn o => match o { | Some s -> s.value | None -> 0 }, opts);
        print vals;
      `);
      expect(logs).toEqual(['[1, 2, 3]']);
    });

    it('should support chaining with reduce to find first Some', () => {
      const { logs } = run(`
        function firstSome(acc, x) {
          return match acc {
            | Some _ -> acc
            | None   -> x
          };
        }
        let candidates = [None, None, Some { 7 }, Some { 8 }];
        let first = reduce(fn a, x => firstSome(a, x), None, candidates);
        print match first { | Some s -> s.value | None -> 0 };
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
        print match ok  { | Ok o -> o.value | Err -> 0 };
        print match err { | Ok o -> o.value | Err -> 0 };
      `);
      expect(logs).toEqual(['42', '0']);
    });
  });

  // ─── List Comprehensions ───────────────────────────────────────────────────

  describe('List Comprehensions', () => {
    it('should produce a transformed list from a single generator', () => {
      const { logs } = run(`
        let nums = [1, 2, 3];
        print [ x * 2 for x <- nums ];
      `);
      expect(logs).toEqual(['[2, 4, 6]']);
    });

    it('should filter with a where guard', () => {
      const { logs } = run(`
        let nums = [1, 2, 3, 4, 5];
        print [ x for x <- nums where x % 2 == 0 ];
      `);
      expect(logs).toEqual(['[2, 4]']);
    });

    it('should support combined conditions with &&', () => {
      const { logs } = run(`
        let nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        print [ x for x <- nums where x > 3 && x < 8 ];
      `);
      expect(logs).toEqual(['[4, 5, 6, 7]']);
    });

    it('should apply body expression after filtering', () => {
      const { logs } = run(`
        let nums = [1, 2, 3, 4, 5];
        print [ x * x for x <- nums where x > 2 ];
      `);
      expect(logs).toEqual(['[9, 16, 25]']);
    });

    it('should produce cartesian product with two generators', () => {
      const { logs } = run(`
        let xs = [1, 2];
        let ys = [10, 20];
        print [ x + y for x <- xs for y <- ys ];
      `);
      expect(logs).toEqual(['[11, 21, 12, 22]']);
    });

    it('should support multiple generators with a guard', () => {
      const { logs } = run(`
        print [ x + y for x <- [1, 2, 3] for y <- [1, 2, 3] where x != y ];
      `);
      expect(logs).toEqual(['[3, 4, 3, 5, 4, 5]']);
    });

    it('should support three generators', () => {
      const { logs } = run(`
        let result = [ x + y + z for x <- [1, 2] for y <- [10] for z <- [100] ];
        print result;
      `);
      expect(logs).toEqual(['[111, 112]']);
    });

    it('should produce an empty list when the guard filters everything', () => {
      const { logs } = run(`
        print [ x for x <- [1, 2, 3] where x > 10 ];
      `);
      expect(logs).toEqual(['[]']);
    });

    it('should produce an empty list from an empty source', () => {
      const { logs } = run(`
        let empty = [];
        let result = [ x * 2 for x <- empty ];
        print result;
      `);
      expect(logs).toEqual(['[]']);
    });

    it('should work as an expression inside let', () => {
      const { logs } = run(`
        let evens = [ x for x <- [1, 2, 3, 4, 5, 6] where x % 2 == 0 ];
        print evens;
      `);
      expect(logs).toEqual(['[2, 4, 6]']);
    });

    it('should work inside a pure function body', () => {
      const { logs } = run(`
        function evens(lst) { return [ x for x <- lst where x % 2 == 0 ]; }
        print evens([1, 2, 3, 4, 5, 6]);
      `);
      expect(logs).toEqual(['[2, 4, 6]']);
    });

    it('should work nested inside another comprehension', () => {
      const { logs } = run(`
        let matrix = [[1, 2], [3, 4]];
        let flat = [ x for row <- matrix for x <- row ];
        print flat;
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
          print evens;
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
        print comp;
        print mapped;
      `);
      expect(logs).toEqual(['[4, 8]', '[4, 8]']);
    });
  });

  // ─── Infinite Lists ────────────────────────────────────────────────────────

  describe('Infinite Lists', () => {
    it('iterate should produce values by repeatedly applying f to seed', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        print take(5, nats);
      `);
      expect(logs).toEqual(['[1, 2, 3, 4, 5]']);
    });

    it('repeat should produce an infinite list of one value', () => {
      const { logs } = run(`
        print take(4, repeat(7));
      `);
      expect(logs).toEqual(['[7, 7, 7, 7]']);
    });

    it('cycle should repeat a finite list', () => {
      const { logs } = run(`
        print take(7, cycle(["a", "b", "c"]));
      `);
      expect(logs).toEqual(['[a, b, c, a, b, c, a]']);
    });

    it('map over a lazy list should produce a new lazy list', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        let doubled = map(fn x => x * 2, nats);
        print take(5, doubled);
      `);
      expect(logs).toEqual(['[2, 4, 6, 8, 10]']);
    });

    it('filter over a lazy list should produce a new lazy list', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        let evens = filter(fn x => x % 2 == 0, nats);
        print take(5, evens);
      `);
      expect(logs).toEqual(['[2, 4, 6, 8, 10]']);
    });

    it('should support chained map and filter on lazy lists', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        let result = take(5, filter(fn x => x % 3 == 0, map(fn x => x * 2, nats)));
        print result;
      `);
      expect(logs).toEqual(['[6, 12, 18, 24, 30]']);
    });

    it('cons onto a lazy list should produce a new lazy list', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        print take(5, cons(0, nats));
      `);
      expect(logs).toEqual(['[0, 1, 2, 3, 4]']);
    });

    it('tail of a lazy list should skip the first element', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        print take(5, tail(nats));
      `);
      expect(logs).toEqual(['[2, 3, 4, 5, 6]']);
    });

    it('take on a finite list should slice it', () => {
      const { logs } = run(`
        print take(3, [10, 20, 30, 40, 50]);
      `);
      expect(logs).toEqual(['[10, 20, 30]']);
    });

    it('take of more elements than the list has should return the whole list', () => {
      const { logs } = run(`
        print take(10, [1, 2, 3]);
      `);
      expect(logs).toEqual(['[1, 2, 3]']);
    });

    it('should support reduce on a taken finite slice', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        let sum = reduce(fn acc, x => acc + x, 0, take(10, nats));
        print sum;
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
        print take(8, fibs);
      `);
      expect(logs).toEqual(['[0, 1, 1, 2, 3, 5, 8, 13]']);
    });

    it('should support powers of 2 via iterate', () => {
      const { logs } = run(`
        let powers = iterate(fn x => x * 2, 1);
        print take(6, powers);
      `);
      expect(logs).toEqual(['[1, 2, 4, 8, 16, 32]']);
    });

    it('should allow a pure function to return a lazy list', () => {
      const { logs } = run(`
        function multiplesOf(n) {
          return iterate(fn x => x + n, n);
        }
        print take(5, multiplesOf(3));
      `);
      expect(logs).toEqual(['[3, 6, 9, 12, 15]']);
    });

    it('should support head on a lazy list', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        print head(nats);
      `);
      expect(logs).toEqual(['1']);
    });

    it('lazy list should print as <lazylist>', () => {
      const { logs } = run(`
        let nats = iterate(fn x => x + 1, 1);
        print nats;
      `);
      expect(logs).toEqual(['<lazylist>']);
    });
  });

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
        let result = match sq {
          | Square s -> s.side
          | Circle c -> c.radius
          | Rectangle r -> r.x
        };
        print result;
      `);
      expect(logs).toEqual(['7']);
    });

    it('should make the binding immutable within the arm scope', () => {
      expect(() => run(`
        ${SHAPE_DEF}
        var sq = Square { 7 };
        match sq {
          | Square s -> s = 99
          | _ -> 0
        };
      `)).toThrow("Cannot assign to immutable variable 's'");
    });

    it('should fall through to a wildcard arm', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var sq = Square { 4 };
        let result = match sq {
          | Circle c -> c.radius
          | _ -> 0
        };
        print result;
      `);
      expect(logs).toEqual(['0']);
    });

    it('should evaluate the wildcard arm body expression', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var sq = Square { 4 };
        let result = match sq {
          | _ -> 42
        };
        print result;
      `);
      expect(logs).toEqual(['42']);
    });

    it('should respect arm order (first match wins)', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var ci = Circle { 10 };
        let result = match ci {
          | Circle c -> 1
          | Circle c -> 2
          | _ -> 0
        };
        print result;
      `);
      expect(logs).toEqual(['1']);
    });

    it('should skip a guarded arm when the guard is false and try the next arm', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var ci = Circle { 2 };
        let result = match ci {
          | Circle c where c.radius > 3 -> 100
          | Circle _ -> 1
          | _ -> 0
        };
        print result;
      `);
      expect(logs).toEqual(['1']);
    });

    it('should match a guarded arm when the guard is true', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var ci = Circle { 5 };
        let result = match ci {
          | Circle c where c.radius > 3 -> c.radius
          | Circle _ -> 1
          | _ -> 0
        };
        print result;
      `);
      expect(logs).toEqual(['5']);
    });

    it('should use the binding inside the guard expression', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var re = Rectangle { x=3, y=4 };
        let result = match re {
          | Rectangle r where r.x == r.y -> 0
          | Rectangle r -> r.x + r.y
          | _ -> 0
        };
        print result;
      `);
      expect(logs).toEqual(['7']);
    });

    it('should throw on non-exhaustive match when no wildcard and a variant is missing', () => {
      expect(() => run(`
        ${SHAPE_DEF}
        var sq = Square { 4 };
        match sq {
          | Square s -> s.side
          | Circle c -> c.radius
        };
      `)).toThrow("Non-exhaustive match on 'Shape': missing arm(s) for 'Rectangle'.");
    });

    it('should not throw on exhaustive match covering all variants', () => {
      expect(() => run(`
        ${SHAPE_DEF}
        var sq = Square { 4 };
        match sq {
          | Square s -> s.side
          | Circle c -> c.radius
          | Rectangle r -> r.x
        };
      `)).not.toThrow();
    });

    it('should not throw exhaustiveness error when a wildcard is present', () => {
      expect(() => run(`
        ${SHAPE_DEF}
        var sq = Square { 4 };
        match sq {
          | Square s -> s.side
          | _ -> 0
        };
      `)).not.toThrow();
    });

    it('should throw at runtime when all guards fail and no wildcard covers the variant', () => {
      expect(() => run(`
        ${SHAPE_DEF}
        var ci = Circle { 1 };
        match ci {
          | Circle c where c.radius > 10 -> c.radius
          | Square s -> s.side
          | Rectangle r -> r.x
        };
      `)).toThrow("Non-exhaustive match: no arm matched value of type 'Circle'.");
    });

    it('should work as an expression nested inside other expressions', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        var sq = Square { 6 };
        let doubled = (match sq {
          | Square s -> s.side
          | _ -> 0
        }) * 2;
        print doubled;
      `);
      expect(logs).toEqual(['12']);
    });

    it('should work inside a pure function body', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        function area(shape) {
          return match shape {
            | Square s -> s.side * s.side
            | Circle c -> c.radius * c.radius
            | Rectangle r -> r.x * r.y
          };
        }
        var sq = Square { 4 };
        var re = Rectangle { x=3, y=5 };
        print area(sq);
        print area(re);
      `);
      expect(logs).toEqual(['16', '15']);
    });

    it('should support match on lazy let bindings', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        let sq = Square { 9 };
        let result = match sq {
          | Square s -> s.side
          | _ -> 0
        };
        print result;
      `);
      expect(logs).toEqual(['9']);
    });
  });
});
