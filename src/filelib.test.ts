// src/filelib.test.ts
import { Lexer } from './lexer';
import { Parser } from './parser';
import { Interpreter, ModuleLoader } from './interpreter';
import * as os from 'os';
import * as nodePath from 'path';
import * as nodeFs from 'fs';
import { stdlibFunctions, stdlibTypes } from './library';
import { iolibFunctions } from './iolib';
import { filelibFunctions, filelibTypes } from './filelib';

// ─── Test helpers ─────────────────────────────────────────────────────────────

const run = (source: string) => {
  const ast = new Parser(new Lexer(source).lex()).parse();
  const interp = new Interpreter();
  interp.registerLibrary(stdlibFunctions, stdlibTypes);
  interp.registerLibrary(iolibFunctions, []);
  interp.registerLibrary(filelibFunctions, filelibTypes);
  const logs: any[] = [];
  let currentLine = '';
  const originalLog = console.log;
  const originalWrite = process.stdout.write.bind(process.stdout);
  console.log = (...args: any[]) => {
    logs.push(currentLine + args.map(a => String(a)).join(' '));
    currentLine = '';
  };
  (process.stdout as any).write = (s: string) => {
    if (typeof s !== 'string') return true;
    const parts = s.split('\n');
    for (let i = 0; i < parts.length - 1; i++) { logs.push(currentLine + parts[i]); currentLine = ''; }
    currentLine += parts[parts.length - 1];
    return true;
  };
  try {
    interp.interpret(ast, source);
    if (currentLine.length > 0) { logs.push(currentLine); currentLine = ''; }
  } finally {
    console.log = originalLog;
    (process.stdout as any).write = originalWrite;
  }
  return { logs, interp };
};

const withTempFile = (content: string, fn: (path: string) => void) => {
  const p = nodePath.join(os.tmpdir(), `pfun-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  nodeFs.writeFileSync(p, content, 'utf8');
  try { fn(p); }
  finally { try { nodeFs.unlinkSync(p); } catch {} }
};

const tempPath = () =>
  nodePath.join(os.tmpdir(), `pfun-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);

// ─── Helpers used in tests ────────────────────────────────────────────────────
// unwrapSome(x) extracts x.value from Some, or "none"
const UNWRAP = `
  function unwrapSome(opt) {
    return match opt {
      | Some s -> s.value
      | None   -> "none"
    };
  }
`;

describe('File Library Tests', () => {

  // ─── readFile / writeFile ───────────────────────────────────────────────────

  describe('readFile and writeFile', () => {
    it('readFile should return Some(string) for an existing file', () => {
      withTempFile('hello world', path => {
        const { logs } = run(`
          ${UNWRAP}
          proc p() { println(unwrapSome(readFile("${path}"))); }
          p();
        `);
        expect(logs).toEqual(['hello world']);
      });
    });

    it('readFile should return None for a missing file', () => {
      const { logs } = run(`
        ${UNWRAP}
        proc p() { println(unwrapSome(readFile("/no/such/file/exists.txt"))); }
        p();
      `);
      expect(logs).toEqual(['none']);
    });

    it('writeFile should write content and return Some(n)', () => {
      const path = tempPath();
      try {
        const { logs } = run(`
          ${UNWRAP}
          proc p() { println(unwrapSome(writeFile("${path}", "test content"))); }
          p();
        `);
        expect(logs).toEqual(['12']);
        expect(nodeFs.readFileSync(path, 'utf8')).toBe('test content');
      } finally { try { nodeFs.unlinkSync(path); } catch {} }
    });

    it('writeFile should return None on failure', () => {
      const { logs } = run(`
        ${UNWRAP}
        proc p() { println(unwrapSome(writeFile("/no/such/dir/file.txt", "data"))); }
        p();
      `);
      expect(logs).toEqual(['none']);
    });

    it('writeFile then readFile round-trip', () => {
      const path = tempPath();
      try {
        const { logs } = run(`
          ${UNWRAP}
          proc p() {
            writeFile("${path}", "round trip");
            println(unwrapSome(readFile("${path}")));
          }
          p();
        `);
        expect(logs).toEqual(['round trip']);
      } finally { try { nodeFs.unlinkSync(path); } catch {} }
    });
  });

  // ─── fileOpen / fileClose ────────────────────────────────────────────────────

  describe('fileOpen and fileClose', () => {
    it('fileOpen should return Some(handle) for an existing file in read mode', () => {
      withTempFile('content', path => {
        const { logs } = run(`
          proc p() {
            var h = fileOpen("${path}", "r");
            println(match h { | Some _ -> "opened" | None -> "failed" });
          }
          p();
        `);
        expect(logs).toEqual(['opened']);
      });
    });

    it('fileOpen should return None for a missing file in read mode', () => {
      const { logs } = run(`
        proc p() {
          var h = fileOpen("/no/such/file.txt", "r");
          println(match h { | Some _ -> "opened" | None -> "none" });
        }
        p();
      `);
      expect(logs).toEqual(['none']);
    });

    it('fileOpen in write mode returns WriteHandle', () => {
      const path = tempPath();
      try {
        const { logs } = run(`
          proc p() {
            var h = fileOpen("${path}", "w");
            let tag = match h { | Some s -> s.value.__type | None -> "failed" };
            println(tag);
            match h { | Some s -> fileClose(s.value) | None -> 0 };
          }
          p();
        `);
        expect(logs).toEqual(['WriteHandle']);
      } finally { try { nodeFs.unlinkSync(path); } catch {} }
    });

    it('fileOpen in read mode returns ReadHandle', () => {
      withTempFile('data', path => {
        const { logs } = run(`
          proc p() {
            var h = fileOpen("${path}", "r");
            let tag = match h { | Some s -> s.value.__type | None -> "failed" };
            println(tag);
            match h { | Some s -> fileClose(s.value) | None -> 0 };
          }
          p();
        `);
        expect(logs).toEqual(['ReadHandle']);
      });
    });
  });

  // ─── readChar / readLine ─────────────────────────────────────────────────────

  describe('readChar and readLine', () => {
    it('readChar should read chars one at a time', () => {
      withTempFile('abc', path => {
        const { logs } = run(`
          proc p() {
            var h = fileOpen("${path}", "r");
            match h {
              | Some s -> {
                  var handle = s.value;
                  var c1 = readChar(handle);
                  var c2 = readChar(handle);
                  var c3 = readChar(handle);
                  var c4 = readChar(handle);
                  println(match c1 { | Some x -> x.value | None -> "eof" });
                  println(match c2 { | Some x -> x.value | None -> "eof" });
                  println(match c3 { | Some x -> x.value | None -> "eof" });
                  println(match c4 { | Some _ -> "got"   | None -> "eof" });
                  fileClose(handle);
                }
              | None -> println("failed")
            };
          }
          p();
        `);
        expect(logs).toEqual(['a', 'b', 'c', 'eof']);
      });
    });

    it('readLine should read lines one at a time', () => {
      withTempFile('line1\nline2\nline3', path => {
        const { logs } = run(`
          proc p() {
            var h = fileOpen("${path}", "r");
            match h {
              | Some s -> {
                  var handle = s.value;
                  var l1 = readLine(handle);
                  var l2 = readLine(handle);
                  var l3 = readLine(handle);
                  var l4 = readLine(handle);
                  println(match l1 { | Some x -> x.value | None -> "eof" });
                  println(match l2 { | Some x -> x.value | None -> "eof" });
                  println(match l3 { | Some x -> x.value | None -> "eof" });
                  println(match l4 { | Some _ -> "got"   | None -> "eof" });
                  fileClose(handle);
                }
              | None -> println("failed")
            };
          }
          p();
        `);
        expect(logs).toEqual(['line1', 'line2', 'line3', 'eof']);
      });
    });

    it('readChar should throw when given a WriteHandle', () => {
      const path = tempPath();
      try {
        expect(() => run(`
          proc p() {
            var h = fileOpen("${path}", "w");
            match h {
              | Some s -> readChar(s.value)
              | None   -> 0
            };
          }
          p();
        `)).toThrow("requires a ReadHandle");
      } finally { try { nodeFs.unlinkSync(path); } catch {} }
    });
  });

  // ─── writeChar / writeLine ────────────────────────────────────────────────────

  describe('writeChar and writeLine', () => {
    it('writeChar should write individual chars', () => {
      const path = tempPath();
      try {
        run(`
          proc p() {
            var h = fileOpen("${path}", "w");
            match h {
              | Some s -> {
                  var handle = s.value;
                  writeChar(handle, 'h');
                  writeChar(handle, 'i');
                  fileClose(handle);
                }
              | None -> 0
            };
          }
          p();
        `);
        expect(nodeFs.readFileSync(path, 'utf8')).toBe('hi');
      } finally { try { nodeFs.unlinkSync(path); } catch {} }
    });

    it('writeLine should write strings with newlines', () => {
      const path = tempPath();
      try {
        run(`
          proc p() {
            var h = fileOpen("${path}", "w");
            match h {
              | Some s -> {
                  var handle = s.value;
                  writeLine(handle, "first");
                  writeLine(handle, "second");
                  fileClose(handle);
                }
              | None -> 0
            };
          }
          p();
        `);
        expect(nodeFs.readFileSync(path, 'utf8')).toBe('first\nsecond\n');
      } finally { try { nodeFs.unlinkSync(path); } catch {} }
    });

    it('writeChar should throw when given a ReadHandle', () => {
      withTempFile('data', path => {
        expect(() => run(`
          proc p() {
            var h = fileOpen("${path}", "r");
            match h {
              | Some s -> writeChar(s.value, 'x')
              | None   -> 0
            };
          }
          p();
        `)).toThrow("requires a WriteHandle");
      });
    });

    it('writeLine should return Some(n) with byte count', () => {
      const path = tempPath();
      try {
        const { logs } = run(`
          ${UNWRAP}
          proc p() {
            var h = fileOpen("${path}", "w");
            let n = match h {
              | Some s -> unwrapSome(writeLine(s.value, "hello"))
              | None   -> "failed"
            };
            println(n);
            match h { | Some s -> fileClose(s.value) | None -> 0 };
          }
          p();
        `);
        expect(logs).toEqual(['6']); // "hello\n" = 6 bytes
      } finally { try { nodeFs.unlinkSync(path); } catch {} }
    });
  });

  // ─── Purity enforcement ───────────────────────────────────────────────────────

  describe('Purity enforcement', () => {
    it('fileOpen should throw in pure functions', () => {
      expect(() => run(`
        function bad() { return fileOpen("x.txt", "r"); }
        bad();
      `)).toThrow("side effects not allowed in pure functions");
    });

    it('readFile should throw in pure functions', () => {
      expect(() => run(`
        function bad() { return readFile("x.txt"); }
        bad();
      `)).toThrow("side effects not allowed in pure functions");
    });

    it('writeFile should throw in pure functions', () => {
      expect(() => run(`
        function bad() { return writeFile("x.txt", "data"); }
        bad();
      `)).toThrow("side effects not allowed in pure functions");
    });
  });

  // ─── FileHandle union type ────────────────────────────────────────────────────

  describe('FileHandle union type', () => {
    it('ReadHandle and WriteHandle should be matchable variants', () => {
      withTempFile('data', path => {
        const { logs } = run(`
          function describeHandle(h) {
            return match h {
              | ReadHandle  _ -> "read"
              | WriteHandle _ -> "write"
            };
          }
          proc p() {
            let rh = fileOpen("${path}", "r");
            let tag = match rh { | Some s -> describeHandle(s.value) | None -> "failed" };
            println(tag);
            match rh { | Some s -> fileClose(s.value) | None -> 0 };
            let wh = fileOpen("${path}", "w");
            let wtag = match wh { | Some s -> describeHandle(s.value) | None -> "failed" };
            println(wtag);
            match wh { | Some s -> fileClose(s.value) | None -> 0 };
          }
          p();
        `);
        expect(logs).toEqual(['read', 'write']);
      });
    });
  });
});
