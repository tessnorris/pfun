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

  // ─── Match Expressions ─────────────────────────────────────────────────────

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

    it('should work inside a function body', () => {
      const { logs } = run(`
        ${SHAPE_DEF}
        function area(shape): {
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
