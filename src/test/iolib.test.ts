// src/iolib.test.ts
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Interpreter } from '../interpreter';
import { stdlibFunctions, stdlibTypes } from '../library';
import { iolibFunctions } from '../iolib';

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

describe('IO Library Tests', () => {
  describe('Output Functions', () => {
    it('println should print with a newline', () => {
      const { logs } = run(`println("hello");`);
      expect(logs).toEqual(['hello']);
    });

    it('print should print without a newline, flush on next println', () => {
      const { logs } = run(`
        proc p() {
          print("one ");
          print("two ");
          println("three");
        }
        p();
      `);
      expect(logs).toEqual(['one two three']);
    });

    it('print without a following println should still appear in logs', () => {
      const { logs } = run(`
        proc p() { print("no newline"); }
        p();
      `);
      expect(logs).toEqual(['no newline']);
    });

    it('println and print should throw in pure functions', () => {
      expect(() => run(`
        function bad() { println("oops"); }
        bad();
      `)).toThrow("Functions cannot use 'println'");
      expect(() => run(`
        function bad() { print("oops"); }
        bad();
      `)).toThrow("Functions cannot use 'print'");
    });
  });

  // ─── $ interpolated strings ───────────────────────────────────────────────

  describe('$ format strings', () => {
    it('should interpolate a simple variable', () => {
      const { logs } = run(`
        let name = "Alice";
        let s = $"Hello {name}";
        println(s);
      `);
      expect(logs).toEqual(['Hello Alice']);
    });

    it('should interpolate a record field', () => {
      const { logs } = run(`
        type Pt = { x, y }
        let pt = Pt { 3, 4 };
        let s = $"Point: {pt.x}, {pt.y}";
        println(s);
      `);
      expect(logs).toEqual(['Point: 3, 4']);
    });

    it('should auto-convert integers to strings', () => {
      const { logs } = run(`
        let n = 42;
        let s = $"n = {n}";
        println(s);
      `);
      expect(logs).toEqual(['n = 42']);
    });

    it('should handle escape sequences in the string portion', () => {
      const { logs } = run(`
        let x = 7;
        let s = $"x = {x}\\n";
        print(s);
      `);
      expect(logs).toEqual(['x = 7']);
    });

    it('should work in a pure function (no side effects)', () => {
      const { logs } = run(`
        function fmt(x, y) {
          return $"({x}, {y})";
        }
        println(fmt(3, 4));
      `);
      expect(logs).toEqual(['(3, 4)']);
    });

    it('should work with print() replacing old printf pattern', () => {
      const { logs } = run(`
        proc p() {
          let x1 = 2;
          let x2 = 5;
          let y1 = 4;
          let y2 = 25;
          print($"p1 = ({x1}, {y1}), p2 = ({x2}, {y2})\\n");
        }
        p();
      `);
      expect(logs).toEqual(['p1 = (2, 4), p2 = (5, 25)']);
    });

    it('should support literal braces via \\{ and \\}', () => {
      const { logs } = run(`
        let v = 99;
        let s = $"value = \\{v\\}";
        println(s);
      `);
      expect(logs).toEqual(['value = {v}']);
    });
  });

  // ─── @ raw strings ────────────────────────────────────────────────────────

  describe('@ raw strings', () => {
    it('should NOT interpret \\n as a newline', () => {
      const { logs } = run(`
        let s = @"Use \\n as a line break";
        println(s);
      `);
      expect(logs).toEqual(['Use \\n as a line break']);
    });

    it('should NOT interpret \\t as a tab', () => {
      const { logs } = run(`
        let s = @"col1\\tcol2";
        println(s);
      `);
      expect(logs).toEqual(['col1\\tcol2']);
    });

    it('should preserve backslashes literally', () => {
      const { logs } = run(`
        let s = @"C:\\Users\\Alice";
        println(s);
      `);
      expect(logs).toEqual(['C:\\Users\\Alice']);
    });

    it('should be a plain string value usable in concatenation', () => {
      const { logs } = run(`
        let a = @"hello\\nworld";
        let b = " (raw)";
        println(a + b);
      `);
      expect(logs).toEqual(['hello\\nworld (raw)']);
    });
  });

  // ─── Input Functions ──────────────────────────────────────────────────────


  describe('readChar and readln', () => {
    it('readChar should throw in a pure function', () => {
      expect(() => run(`
        function bad() { return readChar(); }
        bad();
      `)).toThrow("Functions cannot use 'readChar'");
    });

    it('readln should throw in a pure function', () => {
      expect(() => run(`
        function bad() { return readln(); }
        bad();
      `)).toThrow("Functions cannot use 'readln'");
    });

    it('readChar and readln should be accessible in procedures', () => {
      // Just verify they are defined and callable as builtins (no actual stdin)
      expect(() => run(`
        proc p() {
          // readChar and readln exist — calling them with no stdin returns None
          let c = readChar();
          let l = readln();
        }
        p();
      `)).not.toThrow();
    });
  });

  // ─── Modules & Imports ───────────────────────────────────────────────────────



  // ─── find & findSlice ─────────────────────────────────────────────────────
});
