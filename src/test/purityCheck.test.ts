// src/test/purityCheck_test.ts
//
// Tests for the static procedure-usage checker (checkPurity).
//
// These tests exercise the pass directly: parse → checkPurity. They
// do not invoke main.ts (which calls process.exit) or the interpreter — the
// pass requires no runtime, type information, or evaluation, only a parsed
// AST. See purityCheck.ts's file header for the precise rules and the
// documented single-module scope boundary (imports are treated as opaque).

import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Stmt } from '../ast';
import { checkPurity } from '../purityCheck';

function parse(src: string): Stmt[] {
  return new Parser(new Lexer(src).lex()).parse();
}

function check(src: string): void {
  checkPurity(parse(src));
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

  describe('Anonymous proc lambdas (proc x => body)', () => {
    // ── proc lambda bodies are impure — side effects allowed ────────────────

    it('allows a proc lambda body to call a named proc', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        proc run(f) { f(1); }
        run(proc x => sideEffect(x));
      `)).not.toThrow();
    });

    it('allows a proc lambda body to use var mutation', () => {
      expect(() => check(`
        var counter = 0;
        proc run(f) { f(1); }
        run(proc x => { counter = counter + x; });
      `)).not.toThrow();
    });

    it('allows a proc lambda body to contain a block with side effects', () => {
      expect(() => check(`
        proc run(f) { f(1); }
        run(proc x => {
          var y = x + 1;
          y = y * 2;
        });
      `)).not.toThrow();
    });

    it('allows nested proc lambdas (proc returning proc)', () => {
      expect(() => check(`
        proc run(f) { f(1); }
        run(proc x => {
          run(proc y => {
            var z = x + y;
            z = z + 1;
          });
        });
      `)).not.toThrow();
    });

    // ── proc lambdas in pure context ────────────────────────────────────────
    // Note: the static checker catches proc lambda bodies being in pure
    // context (a fn lambda inside the proc lambda can't call procs), but does
    // not yet track that a let binding initialized with a proc lambda is
    // proc-kind — that is caught at runtime when the call actually occurs.

    it('does not statically reject a proc lambda stored in a let inside a function (caught at runtime on call)', () => {
      // The static pass does not yet track proc-lambda-initialized let bindings
      // as proc-kind. The runtime's inPureContext check catches it when called.
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        function bad() {
          let g = proc x => sideEffect(x);
          return 1;
        }
      `)).not.toThrow();
    });

    it('does not statically reject calling a proc lambda from inside a fn lambda (caught at runtime)', () => {
      // Similarly, an immediately-invoked proc lambda inside a fn lambda is
      // a runtime purity error, not a static one.
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        let g = fn x => (proc y => sideEffect(y))(x);
      `)).not.toThrow();
    });

    // ── fn lambdas inside a proc lambda body stay pure ───────────────────────

    it('allows a fn lambda inside a proc lambda body (fn stays pure)', () => {
      expect(() => check(`
        proc run(f) { f(1); }
        run(proc x => {
          let g = fn y => y * x;
        });
      `)).not.toThrow();
    });

    it('rejects a proc call from inside a fn lambda nested in a proc lambda', () => {
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        proc run(f) { f(1); }
        run(proc x => {
          let g = fn y => sideEffect(y);
        });
      `)).toThrow('Functions cannot call procedures');
    });

    // ── closure capture ──────────────────────────────────────────────────────

    it('allows a proc lambda to capture and mutate an outer var via closure', () => {
      expect(() => check(`
        proc run(f) { f(0); }
        var total = 0;
        run(proc x => { total = total + x; });
      `)).not.toThrow();
    });

    it('allows a proc lambda to capture an outer let binding', () => {
      expect(() => check(`
        proc run(f) { f(0); }
        let prefix = "hello";
        run(proc x => { println(prefix); });
      `)).not.toThrow();
    });

    // ── syntax variants ──────────────────────────────────────────────────────

    it('accepts bare single-param syntax: proc x => expr', () => {
      expect(() => check(`
        proc run(f) { f(1); }
        run(proc x => println(x));
      `)).not.toThrow();
    });

    it('accepts parenthesized single-param syntax: proc(x) => expr', () => {
      expect(() => check(`
        proc run(f) { f(1); }
        run(proc(x) => println(x));
      `)).not.toThrow();
    });

    it('accepts multi-param syntax: proc(x, y) => expr', () => {
      expect(() => check(`
        proc run2(f) { f(1, 2); }
        run2(proc(x, y) => println(x));
      `)).not.toThrow();
    });

    it('accepts zero-param syntax: proc() => expr', () => {
      expect(() => check(`
        proc run0(f) { f(); }
        run0(proc() => println("hi"));
      `)).not.toThrow();
    });

    it('accepts block body: proc x => { stmts }', () => {
      expect(() => check(`
        proc run(f) { f(1); }
        run(proc x => {
          var y = x;
          y = y + 1;
        });
      `)).not.toThrow();
    });
  });
    it('rejects reassigning an outer var from inside a function', () => {
      expect(() => check(`
        var counter = 0;
        function bad() {
          counter = counter + 1;
          return counter;
        }
      `)).toThrow("Functions cannot mutate 'counter'");
    });

    it('rejects reassigning an outer var from inside a lambda', () => {
      expect(() => check(`
        var total = 0;
        let f = fn x => total = total + x;
      `)).toThrow("Functions cannot mutate 'total'");
    });

    it('rejects reassigning an outer var from a nested function', () => {
      expect(() => check(`
        var n = 0;
        function outer() {
          function inner() {
            n = n + 1;
            return n;
          }
          return inner();
        }
      `)).toThrow("Functions cannot mutate 'n'");
    });

    it('rejects array element mutation from inside a function', () => {
      expect(() => check(`
        var arr = array { 1, 2, 3 };
        function bad() {
          arr[0] = 99;
          return arr[0];
        }
      `)).toThrow('Functions cannot mutate arrays or dicts');
    });

    it('rejects dict element mutation from inside a function', () => {
      expect(() => check(`
        var d = dict { "k" -> 1 };
        function bad() {
          d["k"] = 99;
          return 1;
        }
      `)).toThrow('Functions cannot mutate arrays or dicts');
    });

    it('rejects index-assignment from pure context even when the object is not a known var', () => {
      // The blanket rule mirrors the interpreter's own unconditional
      // runtime check for IndexAssignExpr — it doesn't matter what
      // expr.object resolves to.
      expect(() => check(`
        function makeArray() { return array { 1, 2, 3 }; }
        function bad() {
          makeArray()[0] = 99;
          return 1;
        }
      `)).toThrow('Functions cannot mutate arrays or dicts');
    });

    it('reports the rule-1 violation first when an assignment violates both rule 1 and rule 3', () => {
      // `g = sideEffect;` is BOTH a var mutation (rule 3) AND a proc-as-
      // value assignment (rule 1). Rule 1 is checked first, matching this
      // checker's pre-existing error-priority ordering.
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        function bad() {
          var g = 0;
          g = sideEffect;
          return 1;
        }
      `)).toThrow("'sideEffect' is a procedure");
    });

    it('does not flag a let-bound name (let bindings are immutable and have no AssignExpr target)', () => {
      expect(() => check(`
        let x = 5;
        function ok() {
          return x + 1;
        }
      `)).not.toThrow();
    });

    it('does not flag a function parameter shadowing an outer var name', () => {
      // The parameter is a distinct, non-var binding in the inner scope;
      // it shadows the outer var entirely, so resolving it finds 'other',
      // not 'var'.
      expect(() => check(`
        var counter = 0;
        function f(counter) {
          return counter + 1;
        }
      `)).not.toThrow();
    });
  });

  describe('Legitimate uses that must NOT be rejected', () => {
    it('allows a proc to mutate an outer var (this is exactly what var/proc exist for)', () => {
      expect(() => check(`
        var counter = 0;
        proc bump() {
          counter = counter + 1;
          return counter;
        }
      `)).not.toThrow();
    });

    it('allows a proc to mutate an array/dict element', () => {
      expect(() => check(`
        var arr = array { 1, 2, 3 };
        proc setFirst(v) {
          arr[0] = v;
          return arr[0];
        }
      `)).not.toThrow();
    });

    it('allows a var to be reassigned at the top level (impure/module context)', () => {
      expect(() => check(`
        var counter = 0;
        counter = counter + 1;
      `)).not.toThrow();
    });

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

    it('allows a proc lambda to be passed as a value inside a proc body', () => {
      expect(() => check(`
        proc run(f) { f(1); }
        proc setup() {
          run(proc x => println(x));
        }
      `)).not.toThrow();
    });

    it('allows a proc lambda to be stored in a let inside a proc body', () => {
      expect(() => check(`
        proc run(f) { f(1); }
        proc setup() {
          let handler = proc x => println(x);
          run(handler);
        }
      `)).not.toThrow();
    });

    it('allows a proc lambda stored in a var at top level', () => {
      expect(() => check(`
        proc run(f) { f(1); }
        var handler = proc x => println(x);
        run(handler);
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
      // Per purityCheck.ts's documented scope boundary, this pass cannot
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

    it('does not flag mutation of an imported name (rule 3 has the same same-module-only scope boundary as rules 1/2)', () => {
      // An imported `counter` cannot be proven to be a `var` by this
      // pass — it's treated as opaque 'other', same as rules 1/2. This
      // misuse is still caught, but only by the interpreter's own
      // runtime check (AssignExpr now throws on inPureContext — see
      // interpreter.ts — exactly as IndexAssignExpr already did).
      expect(() => check(`
        import { counter } from "./other";
        function bad() {
          counter = counter + 1;
          return counter;
        }
      `)).not.toThrow();
    });
  });

  describe('Mutable-structure let/var check (unrelated to the purity rules above)', () => {
    // This rule has nothing to do with inPureContext — it fires identically
    // at the top level, inside a proc, or inside a function. See
    // purityCheck.ts's file header for the full rationale.

    it('rejects a dict literal declared with let', () => {
      expect(() => check(`let d = dict { "x" -> 1 };`))
        .toThrow("Dictionaries must be declared with 'var'");
    });

    it('rejects an array literal declared with let', () => {
      expect(() => check(`let a = array { 1, 2, 3 };`))
        .toThrow("Arrays must be declared with 'var'");
    });

    it('rejects a dict built via toDict() declared with let', () => {
      expect(() => check(`
        var a = array { "x" };
        let d = toDict(a);
      `)).toThrow("Dictionaries must be declared with 'var'");
    });

    it('rejects a dict built via listToDict() declared with let', () => {
      expect(() => check(`let d = listToDict([]);`))
        .toThrow("Dictionaries must be declared with 'var'");
    });

    it('rejects a buffer built via makeBuffer() declared with let', () => {
      expect(() => check(`let b = makeBuffer(ByteMode);`))
        .toThrow("Buffers must be declared with 'var'");
    });

    it('rejects a buffer built via makeStringBuffer() declared with let', () => {
      expect(() => check(`let b = makeStringBuffer("x");`))
        .toThrow("Buffers must be declared with 'var'");
    });

    it('still rejects a constructor call declared with let, even wrapped in parens', () => {
      expect(() => check(`let b = (makeBuffer(ByteMode));`))
        .toThrow("Buffers must be declared with 'var'");
    });

    it('error message names the actual constructor that was used', () => {
      expect(() => check(`let b = makeStringBuffer("x");`))
        .toThrow('var b = makeStringBuffer(...)');
    });

    it('fires inside a function body, independent of purity', () => {
      expect(() => check(`
        function bad() {
          let b = makeBuffer(ByteMode);
          return 1;
        }
      `)).toThrow("Buffers must be declared with 'var'");
    });

    it('fires inside a proc body too — this rule is not purity-gated', () => {
      expect(() => check(`
        proc bad() {
          let d = dict { "x" -> 1 };
        }
      `)).toThrow("Dictionaries must be declared with 'var'");
    });

    it('fires inside a nested block/if branch', () => {
      expect(() => check(`
        proc bad(flag) {
          if flag then {
            let b = makeBuffer(ByteMode);
          } else 0;
        }
      `)).toThrow("Buffers must be declared with 'var'");
    });

    it('does not flag the var-declared equivalents', () => {
      expect(() => check(`
        var d1 = dict { "x" -> 1 };
        var a1 = array { 1, 2, 3 };
        var a2 = array { "y" };
        var d2 = toDict(a2);
        var d3 = listToDict([]);
        var b1 = makeBuffer(ByteMode);
        var b2 = makeStringBuffer("x");
      `)).not.toThrow();
    });

    it('does not flag an ordinary let binding unrelated to mutable structures', () => {
      expect(() => check(`
        let x = 1;
        let s = "hello";
        let l = [1, 2, 3];
        function f() { let y = x + 1; return y; }
      `)).not.toThrow();
    });

    it('does not flag a let bound to the RESULT of using a dict/array, only to its construction', () => {
      // Reading from an already-built (var) dict/array and binding the
      // result via let is fine — the rule only targets let bound directly
      // to a constructor call/literal.
      expect(() => check(`
        var d = dict { "x" -> 1 };
        let v = d["x"];
        var a = array { 1, 2, 3 };
        let n = arrayLength(a);
      `)).not.toThrow();
    });

    it('when both a purity violation and a var-requirement violation occur in the same statement, the purity violation is reported first', () => {
      // Matches this file's established error-priority convention (see
      // AssignExpr's handling above for the same rationale): a proc value
      // embedded in a dict/array literal that also needs 'var' reports
      // the proc misuse, not the var requirement.
      expect(() => check(`
        proc sideEffect(x) { println(x); }
        function bad() {
          let a = array { sideEffect };
          return 1;
        }
      `)).toThrow("'sideEffect' is a procedure");
    });

    it('a resolver (whole-program mode) does not suppress or alter this check', () => {
      // This rule needs no cross-module information at all, so it must
      // behave identically with or without a resolver supplied.
      const resolver = () => null;
      expect(() => checkPurity(parse(`let b = makeBuffer(ByteMode);`), resolver))
        .toThrow("Buffers must be declared with 'var'");
    });

    it('attaches a source position to a violation', () => {
      try {
        check(`let b = makeBuffer(ByteMode);`);
        fail('expected check() to throw');
      } catch (e: any) {
        expect(e.pos).toBeDefined();
        expect(typeof e.pos.line).toBe('number');
      }
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
