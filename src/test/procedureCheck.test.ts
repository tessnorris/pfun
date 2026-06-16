// src/test/procedureCheck.test.ts
//
// Tests for the static procedure-usage checker (checkProcedureUsage).
//
// These tests exercise the pass directly: parse → checkProcedureUsage. They
// do not invoke main.ts (which calls process.exit) or the interpreter — the
// pass requires no runtime, type information, or evaluation, only a parsed
// AST. See procedureCheck.ts's file header for the precise rules and the
// documented single-module scope boundary (imports are treated as opaque).

import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Stmt } from '../ast';
import { checkProcedureUsage } from '../procedureCheck';

function parse(src: string): Stmt[] {
  return new Parser(new Lexer(src).lex()).parse();
}

function check(src: string): void {
  checkProcedureUsage(parse(src));
}

describe('Static procedure-usage checker', () => {

  describe('Rule 1 — a proc name cannot be used as a value', () => {
    it('rejects a proc stored in a let inside a function', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        function bad() {
          let g = sideEffect;
          return 1;
        }
      `)).toThrow("'sideEffect' is a procedure");
    });

    it('rejects a proc returned from a function', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        function bad() {
          return sideEffect;
        }
      `)).toThrow("'sideEffect' is a procedure");
    });

    it('rejects a proc stored in a list literal', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        function bad() {
          let l = [sideEffect];
          return 1;
        }
      `)).toThrow("'sideEffect' is a procedure");
    });

    it('rejects a proc stored in an array literal', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        function bad() {
          let a = array { sideEffect };
          return 1;
        }
      `)).toThrow("'sideEffect' is a procedure");
    });

    it('rejects a proc passed as a higher-order argument to map (the motivating case)', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        function bad() {
          return map(sideEffect, [1, 2, 3]);
        }
      `)).toThrow("'sideEffect' is a procedure");
    });

    it('rejects a proc used as a record field value', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        type Box = { handler }
        function bad() {
          let b = Box { handler = sideEffect };
          return 1;
        }
      `)).toThrow("'sideEffect' is a procedure");
    });

    it('rejects a proc used as a dict value', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        function bad() {
          let d = dict { "k" -> sideEffect };
          return 1;
        }
      `)).toThrow("'sideEffect' is a procedure");
    });

    it('rejects a proc on the right-hand side of an assignment expression', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        function bad() {
          var g = 0;
          g = sideEffect;
          return 1;
        }
      `)).toThrow("'sideEffect' is a procedure");
    });

    it('rejects a proc used inside a ternary branch within a function', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        function pick(x) { return x; }
        function bad(flag) {
          let g = flag ? sideEffect : pick;
          return 1;
        }
      `)).toThrow("'sideEffect' is a procedure");
    });

    it('rejects a proc used inside a match arm body within a function', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        type MyOption = {
          | Some: value
          | None
        }
        function bad(opt) {
          return match opt with | Some v -> sideEffect | None -> 0;
        }
      `)).toThrow("'sideEffect' is a procedure");
    });
  });

  describe('Rule 2 — calling a proc from inside a function/lambda body is forbidden', () => {
    it('rejects a direct call to a proc from inside a function body', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        function bad() {
          return sideEffect(1);
        }
      `)).toThrow('Functions cannot call procedures');
    });

    it('rejects a proc call from inside a lambda nested in a function', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        function bad() {
          let g = fn (y) => sideEffect(y);
          return 1;
        }
      `)).toThrow('Functions cannot call procedures');
    });

    it('rejects a proc call from inside a bare top-level lambda', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        let g = fn (y) => sideEffect(y);
      `)).toThrow('Functions cannot call procedures');
    });

    it('rejects a proc call nested two lambdas deep inside a function', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        function bad() {
          let g = fn (y) => fn (z) => sideEffect(y + z);
          return 1;
        }
      `)).toThrow('Functions cannot call procedures');
    });

    it('rejects a proc call inside a comprehension body within a function', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        function bad() {
          return [sideEffect(x) for x <- [1, 2, 3]];
        }
      `)).toThrow('Functions cannot call procedures');
    });

    it('rejects a proc call inside a lambda block-body within a function', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        function bad() {
          let g = fn (y) => { sideEffect(y); 2 };
          return 1;
        }
      `)).toThrow('Functions cannot call procedures');
    });
  });

  describe('Legitimate uses that must NOT be rejected', () => {
    it('allows a proc to be used as a value at the top level (impure/module context)', () => {
      // Storing or passing a proc as a value is only a problem if it could
      // be CALLED from pure code. At the top level (impure context), the
      // proc itself can never reach a pure call site through this
      // reference alone — that path is closed by rule 2, not rule 1.
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        let g = sideEffect;
      `)).not.toThrow();
    });

    it('allows a proc to be passed by value to a native impure function at the top level (regression: httpListen(port, handler))', () => {
      // Real-world pattern from http_example.pf: httpListen(port, handler)
      // takes `handler` (an async proc) BY VALUE and invokes it later, per
      // request, from its own (impure) event loop — never from inside a
      // `function`. This must be allowed: a proc used as a value from
      // impure context is fine, regardless of which impure function it's
      // ultimately passed to or called from.
      expect(() => check(`
        async proc handleRequest(req, res) {
          res.text(200, "ok");
        }
        let port = 8080;
        httpListen(port, handleRequest);
      `)).not.toThrow();
    });

    it('allows a proc to be passed by value to another proc from inside a proc body', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        proc registerHandler(h) {
          h(1);
        }
        proc setup() {
          registerHandler(sideEffect);
        }
      `)).not.toThrow();
    });

    it('allows a proc to call another proc', () => {
      expect(() => check(`
        proc helper(x) { println(x); }
        proc main(x) {
          helper(x);
          helper(x + 1);
        }
      `)).not.toThrow();
    });

    it('allows a proc to call a pure function', () => {
      expect(() => check(`
        function double(x) { return x * 2; }
        proc printDouble(n) { println(double(n)); }
      `)).not.toThrow();
    });

    it('allows a top-level (module-scope) call to a proc', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        sideEffect(42);
      `)).not.toThrow();
    });

    it('allows a function to pass another function through a higher-order builtin', () => {
      expect(() => check(`
        function double(x) { return x * 2; }
        function useMap() {
          return map(double, [1, 2, 3]);
        }
      `)).not.toThrow();
    });

    it('allows a function to recurse via its own name', () => {
      expect(() => check(`
        function fact(n) {
          if n <= 1 then return 1 else return n * fact(n - 1);
        }
      `)).not.toThrow();
    });

    it('allows a proc to recurse via its own name', () => {
      expect(() => check(`
        proc countdown(n) {
          if n <= 0 then println("done") else { println(n); countdown(n - 1); }
        }
      `)).not.toThrow();
    });

    it('allows mutual recursion between two procs', () => {
      expect(() => check(`
        proc ping(n) { if n <= 0 then println("done") else pong(n - 1); }
        proc pong(n) { if n <= 0 then println("done") else ping(n - 1); }
      `)).not.toThrow();
    });

    it('allows a function name (not a proc) to be used as a value', () => {
      expect(() => check(`
        function double(x) { return x * 2; }
        function bad() {
          let g = double;
          return g(2);
        }
      `)).not.toThrow();
    });

    it('allows a lambda (always function-kind) to be used as a value anywhere', () => {
      expect(() => check(`
        function bad() {
          let g = fn (y) => y * 2;
          return g(5);
        }
      `)).not.toThrow();
    });

    it('allows a parameter name that shadows a would-be proc-shaped use', () => {
      expect(() => check(`
        function apply(sideEffect, x) {
          return sideEffect(x);
        }
      `)).not.toThrow();
    });

    it('allows a let-bound local with the same name pattern as a proc elsewhere, scoped correctly', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        proc useLocally() {
          let sideEffect = 5;
          return sideEffect + 1;
        }
      `)).not.toThrow();
    });
  });

  describe('Module-boundary scope (imports are treated as opaque, per documented design)', () => {
    it('does not flag an imported name used as a value inside a function', () => {
      // Per procedureCheck.ts's documented scope boundary, this pass cannot
      // know whether an imported name is a function or a proc — that
      // remains the dynamic interpreter's responsibility (inPureContext),
      // exactly as before this pass existed. This test pins down that the
      // static pass does not raise a false negative into a false positive
      // by guessing, nor crash on the ImportStmt node shapes.
      expect(() => check(`
        import { something } from "./other";
        function bad() {
          let g = something;
          return 1;
        }
      `)).not.toThrow();
    });

    it('does not flag a namespace-imported alias used as a value', () => {
      expect(() => check(`
        import * as Other from "./other";
        function bad() {
          let g = Other;
          return g;
        }
      `)).not.toThrow();
    });

    it('does not crash on a star import', () => {
      expect(() => check(`
        import * from "io";
        function bad() {
          return 1;
        }
      `)).not.toThrow();
    });
  });

  describe('Error positions', () => {
    it('attaches a source position to rule 1 violations', () => {
      try {
        check(`
          proc sideEffect(x) { println(x); }
          function bad() {
            let g = sideEffect;
            return 1;
          }
        `);
        fail('expected check() to throw');
      } catch (e: any) {
        expect(e.pos).toBeDefined();
        expect(typeof e.pos.line).toBe('number');
      }
    });

    it('attaches a source position to rule 2 violations', () => {
      try {
        check(`
          proc sideEffect(x) { println(x); }
          function bad() {
            return sideEffect(1);
          }
        `);
        fail('expected check() to throw');
      } catch (e: any) {
        expect(e.pos).toBeDefined();
        expect(typeof e.pos.line).toBe('number');
      }
    });
  });

  describe('export interacts correctly with declaration kind', () => {
    it('still rejects an exported proc misused as a value within the same module', () => {
      expect(() => check(`
        export proc sideEffect(x) { println(x); }
        function bad() {
          let g = sideEffect;
          return 1;
        }
      `)).toThrow("'sideEffect' is a procedure");
    });

    it('allows an exported function to be used as a value', () => {
      expect(() => check(`
        export function double(x) { return x * 2; }
        function bad() {
          let g = double;
          return g(2);
        }
      `)).not.toThrow();
    });
  });
});
