// src/iolib.test.ts
import { Lexer } from './lexer';
import { Parser } from './parser';
import { Interpreter } from './interpreter';
import { stdlibFunctions, stdlibTypes } from './library';
import { iolibFunctions } from './iolib';

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

    it('printf should interpolate {name}', () => {
      const { logs } = run(`
        proc p() {
          let name = "Alice";
          printf("Hello {name}\\n");
        }
        p();
      `);
      expect(logs).toEqual(['Hello Alice']);
    });

    it('printf should interpolate {rec.field}', () => {
      const { logs } = run(`
        proc p() {
          type Pt = { x, y }
          let pt = Pt { 3, 4 };
          printf("Point: {pt.x}, {pt.y}\\n");
        }
        p();
      `);
      expect(logs).toEqual(['Point: 3, 4']);
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
