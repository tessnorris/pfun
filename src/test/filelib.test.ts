// src/test/filelib.test.ts
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Interpreter } from '../interpreter';
import * as os from 'os';
import * as nodePath from 'path';
import * as nodeFs from 'fs';
import { stdlibFunctions, stdlibTypes } from '../library';
import { iolibFunctions } from '../iolib';
import { filelibFunctions, filelibTypes } from '../filelib';

// ─── Test helpers ─────────────────────────────────────────────────────────────

const run = (source: string) => {
  const ast = new Parser(new Lexer(source).lex()).parse();
  const interpreter = new Interpreter();
  interpreter.registerLibrary(stdlibFunctions, stdlibTypes);
  interpreter.registerLibrary(iolibFunctions, []);
  interpreter.registerLibrary(filelibFunctions, filelibTypes);
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

const withTempFile = (content: string, fn: (path: string) => void) => {
  const p = nodePath.join(os.tmpdir(), `pfun-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  nodeFs.writeFileSync(p, content, 'utf8');
  try { fn(p); } finally { try { nodeFs.unlinkSync(p); } catch {} }
};

const tempPath = () =>
  nodePath.join(os.tmpdir(), `pfun-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);

// ─── Shared snippets ──────────────────────────────────────────────────────────

// Unwrap a Result: Ok value as string, or "err:<message>"
const UNWRAP_RESULT = `
  function unwrapResult(r) {
    return match r with
      | Ok  o -> o.value + ""
      | Err e -> "err:" + e.message;
  }
`;

// Unwrap a ReadResult: Ok value as string, "eof", or "err:<message>"
const UNWRAP_READ = `
  function unwrapRead(r) {
    return match r with
      | Ok  o -> o.value + ""
      | Eof _ -> "eof"
      | Err e -> "err:" + e.message;
  }
`;

describe('File Library Tests', () => {

  // ─── FileMode type ────────────────────────────────────────────────────────────

  describe('FileMode union type', () => {
    it('Read, Write, Append are matchable variants', () => {
      const { logs } = run(`
        function describeMode(m) {
          return match m with
            | Read   _ -> "read"
            | Write  _ -> "write"
            | Append _ -> "append";
        }
        println(describeMode(Read));
        println(describeMode(Write));
        println(describeMode(Append));
      `);
      expect(logs).toEqual(['read', 'write', 'append']);
    });
  });

  // ─── Result type ─────────────────────────────────────────────────────────────

  describe('Result type', () => {
    it('Ok and Err are matchable variants of Result', () => {
      const { logs } = run(`
        ${UNWRAP_RESULT}
        println(unwrapResult(readFile("/no/such/file.txt")));
      `);
      expect(logs[0]).toMatch(/^err:/);
    });

    it('Ok carries a value field', () => {
      withTempFile('hello', path => {
        const { logs } = run(`
          proc p() {
            var r = readFile("${path}");
            println(match r with | Ok o -> o.value | Err e -> e.message);
          }
          p();
        `);
        expect(logs).toEqual(['hello']);
      });
    });

    it('Err carries a message field', () => {
      const { logs } = run(`
        proc p() {
          var r = readFile("/no/such/file.txt");
          println(match r with | Ok _ -> "ok" | Err e -> e.message);
        }
        p();
      `);
      expect(logs[0]).not.toBe('ok');
      expect(logs[0].length).toBeGreaterThan(0);
    });

    it('user code can construct Ok and Err directly', () => {
      const { logs } = run(`
        ${UNWRAP_RESULT}
        let r1 = Ok { 42 };
        let r2 = Err { "something went wrong" };
        println(unwrapResult(r1));
        println(unwrapResult(r2));
      `);
      expect(logs).toEqual(['42', 'err:something went wrong']);
    });

    it('two different unions can share Ok and Err variant names', () => {
      withTempFile('x', path => {
        const { logs } = run(`
          proc p() {
            var rr = readFile("${path}");
            var h  = fileOpen("${path}", Read);
            var rc = match h with | Ok o -> readChar(o.value) | Err _ -> Err { "open failed" };
            println(match rr with | Ok _ -> "Result.Ok"  | Err _ -> "Result.Err");
            println(match rc with | Ok _ -> "ReadResult.Ok" | Eof _ -> "ReadResult.Eof" | Err _ -> "ReadResult.Err");
            match h with | Ok o -> fileClose(o.value) | Err _ -> 0;
          }
          p();
        `);
        expect(logs).toEqual(['Result.Ok', 'ReadResult.Ok']);
      });
    });

    it('exhaustiveness checker uses the correct union for each match', () => {
      // Result match only needs Ok | Err — no Eof required
      withTempFile('data', path => {
        expect(() => run(`
          proc p() {
            var r = readFile("${path}");
            match r with | Ok _ -> 1 | Err _ -> 2;
          }
          p();
        `)).not.toThrow();
      });
      // ReadResult match needs Ok | Eof | Err
      withTempFile('data', path => {
        expect(() => run(`
          proc p() {
            var h = fileOpen("${path}", Read);
            match h with
              | Ok o -> {
                  var c = readChar(o.value);
                  match c with | Ok _ -> 1 | Err _ -> 2;
                }
              | Err _ -> 0;
          }
          p();
        `)).toThrow("missing arm(s) for 'Eof'");
      });
    });
  });

  // ─── ReadResult type ──────────────────────────────────────────────────────────

  describe('ReadResult type', () => {
    it('Ok carries the read value, Eof is distinct from Ok', () => {
      withTempFile('a', path => {
        const { logs } = run(`
          proc p() {
            var h = fileOpen("${path}", Read);
            match h with
              | Ok o -> {
                  var c = readChar(o.value);
                  println(match c with | Ok x -> "ok:" + x.value | Eof _ -> "eof" | Err e -> e.message);
                  fileClose(o.value);
                }
              | Err _ -> 0;
          }
          p();
        `);
        expect(logs).toEqual(['ok:a']);
      });
    });

    it('Eof is returned at end of file', () => {
      withTempFile('', path => {
        const { logs } = run(`
          proc p() {
            var h = fileOpen("${path}", Read);
            match h with
              | Ok o -> {
                  var c = readChar(o.value);
                  println(match c with | Ok _ -> "ok" | Eof _ -> "eof" | Err e -> e.message);
                  fileClose(o.value);
                }
              | Err _ -> 0;
          }
          p();
        `);
        expect(logs).toEqual(['eof']);
      });
    });
  });

  // ─── readFile ─────────────────────────────────────────────────────────────────

  describe('readFile', () => {
    it('should return Ok { string } for an existing file', () => {
      withTempFile('hello world', path => {
        const { logs } = run(`
          ${UNWRAP_RESULT}
          proc p() { println(unwrapResult(readFile("${path}"))); }
          p();
        `);
        expect(logs).toEqual(['hello world']);
      });
    });

    it('should return Err { message } for a missing file', () => {
      const { logs } = run(`
        proc p() {
          var r = readFile("/no/such/file/exists.txt");
          println(match r with | Ok _ -> "ok" | Err _ -> "err");
        }
        p();
      `);
      expect(logs).toEqual(['err']);
    });
  });

  // ─── writeFile ────────────────────────────────────────────────────────────────

  describe('writeFile', () => {
    it('should write content and return Ok { n }', () => {
      const path = tempPath();
      try {
        const { logs } = run(`
          ${UNWRAP_RESULT}
          proc p() { println(unwrapResult(writeFile("${path}", "test content"))); }
          p();
        `);
        expect(logs).toEqual(['12']);
        expect(nodeFs.readFileSync(path, 'utf8')).toBe('test content');
      } finally { try { nodeFs.unlinkSync(path); } catch {} }
    });

    it('should return Err { message } on failure', () => {
      const { logs } = run(`
        proc p() {
          var r = writeFile("/no/such/dir/file.txt", "data");
          println(match r with | Ok _ -> "ok" | Err _ -> "err");
        }
        p();
      `);
      expect(logs).toEqual(['err']);
    });

    it('writeFile then readFile round-trip', () => {
      const path = tempPath();
      try {
        const { logs } = run(`
          ${UNWRAP_RESULT}
          proc p() {
            writeFile("${path}", "round trip");
            println(unwrapResult(readFile("${path}")));
          }
          p();
        `);
        expect(logs).toEqual(['round trip']);
      } finally { try { nodeFs.unlinkSync(path); } catch {} }
    });
  });

  // ─── fileOpen and fileClose ───────────────────────────────────────────────────

  describe('fileOpen and fileClose', () => {
    it('fileOpen Read should return Ok { ReadHandle }', () => {
      withTempFile('data', path => {
        const { logs } = run(`
          proc p() {
            var r = fileOpen("${path}", Read);
            println(match r with | Ok o -> o.value.__type | Err e -> e.message);
            match r with | Ok o -> fileClose(o.value) | Err _ -> 0;
          }
          p();
        `);
        expect(logs).toEqual(['ReadHandle']);
      });
    });

    it('fileOpen Write should return Ok { WriteHandle }', () => {
      const path = tempPath();
      try {
        const { logs } = run(`
          proc p() {
            var r = fileOpen("${path}", Write);
            println(match r with | Ok o -> o.value.__type | Err e -> e.message);
            match r with | Ok o -> fileClose(o.value) | Err _ -> 0;
          }
          p();
        `);
        expect(logs).toEqual(['WriteHandle']);
      } finally { try { nodeFs.unlinkSync(path); } catch {} }
    });

    it('fileOpen Append should return Ok { WriteHandle }', () => {
      const path = tempPath();
      try {
        const { logs } = run(`
          proc p() {
            var r = fileOpen("${path}", Append);
            println(match r with | Ok o -> o.value.__type | Err e -> e.message);
            match r with | Ok o -> fileClose(o.value) | Err _ -> 0;
          }
          p();
        `);
        expect(logs).toEqual(['WriteHandle']);
      } finally { try { nodeFs.unlinkSync(path); } catch {} }
    });

    it('fileOpen Read should return Err for a missing file', () => {
      const { logs } = run(`
        proc p() {
          var r = fileOpen("/no/such/file.txt", Read);
          println(match r with | Ok _ -> "ok" | Err _ -> "err");
        }
        p();
      `);
      expect(logs).toEqual(['err']);
    });

    it('Write mode overwrites existing content', () => {
      const path = tempPath();
      try {
        run(`
          proc p() {
            var h = fileOpen("${path}", Write);
            match h with | Ok o -> { writeLine(o.value, "original"); fileClose(o.value); } | Err _ -> 0;
            var h2 = fileOpen("${path}", Write);
            match h2 with | Ok o -> { writeLine(o.value, "replaced"); fileClose(o.value); } | Err _ -> 0;
          }
          p();
        `);
        expect(nodeFs.readFileSync(path, 'utf8')).toBe('replaced\n');
      } finally { try { nodeFs.unlinkSync(path); } catch {} }
    });

    it('Append mode appends to existing content', () => {
      const path = tempPath();
      try {
        run(`
          proc p() {
            var h = fileOpen("${path}", Write);
            match h with | Ok o -> { writeLine(o.value, "first"); fileClose(o.value); } | Err _ -> 0;
            var h2 = fileOpen("${path}", Append);
            match h2 with | Ok o -> { writeLine(o.value, "second"); fileClose(o.value); } | Err _ -> 0;
          }
          p();
        `);
        expect(nodeFs.readFileSync(path, 'utf8')).toBe('first\nsecond\n');
      } finally { try { nodeFs.unlinkSync(path); } catch {} }
    });

    it('fileClose should return Ok', () => {
      withTempFile('data', path => {
        const { logs } = run(`
          proc p() {
            var h = fileOpen("${path}", Read);
            match h with
              | Ok o -> println(match fileClose(o.value) with | Ok _ -> "closed" | Err e -> e.message)
              | Err e -> println(e.message);
          }
          p();
        `);
        expect(logs).toEqual(['closed']);
      });
    });

    it('ReadHandle and WriteHandle are matchable as FileHandle variants', () => {
      withTempFile('data', path => {
        const { logs } = run(`
          function describeHandle(h) {
            return match h with
              | ReadHandle  _ -> "read"
              | WriteHandle _ -> "write";
          }
          proc p() {
            let rh = fileOpen("${path}", Read);
            println(match rh with | Ok o -> describeHandle(o.value) | Err _ -> "failed");
            match rh with | Ok o -> fileClose(o.value) | Err _ -> 0;
            let wh = fileOpen("${path}", Write);
            println(match wh with | Ok o -> describeHandle(o.value) | Err _ -> "failed");
            match wh with | Ok o -> fileClose(o.value) | Err _ -> 0;
          }
          p();
        `);
        expect(logs).toEqual(['read', 'write']);
      });
    });
  });

  // ─── readChar ─────────────────────────────────────────────────────────────────

  describe('readChar', () => {
    it('should return Ok { char } for each character, then Eof', () => {
      withTempFile('abc', path => {
        const { logs } = run(`
          ${UNWRAP_READ}
          proc p() {
            var h = fileOpen("${path}", Read);
            match h with
              | Ok o -> {
                  var handle = o.value;
                  println(unwrapRead(readChar(handle)));
                  println(unwrapRead(readChar(handle)));
                  println(unwrapRead(readChar(handle)));
                  println(unwrapRead(readChar(handle)));
                  fileClose(handle);
                }
              | Err e -> println(e.message);
          }
          p();
        `);
        expect(logs).toEqual(['a', 'b', 'c', 'eof']);
      });
    });

    it('should throw when given a WriteHandle', () => {
      const path = tempPath();
      try {
        expect(() => run(`
          proc p() {
            var h = fileOpen("${path}", Write);
            match h with | Ok o -> readChar(o.value) | Err _ -> 0;
          }
          p();
        `)).toThrow("requires a ReadHandle");
      } finally { try { nodeFs.unlinkSync(path); } catch {} }
    });
  });

  // ─── readLine ─────────────────────────────────────────────────────────────────

  describe('readLine', () => {
    it('should return Ok { string } per line, then Eof', () => {
      withTempFile('line1\nline2\nline3', path => {
        const { logs } = run(`
          ${UNWRAP_READ}
          proc p() {
            var h = fileOpen("${path}", Read);
            match h with
              | Ok o -> {
                  var handle = o.value;
                  println(unwrapRead(readLine(handle)));
                  println(unwrapRead(readLine(handle)));
                  println(unwrapRead(readLine(handle)));
                  println(unwrapRead(readLine(handle)));
                  fileClose(handle);
                }
              | Err e -> println(e.message);
          }
          p();
        `);
        expect(logs).toEqual(['line1', 'line2', 'line3', 'eof']);
      });
    });

    it('should throw when given a WriteHandle', () => {
      const path = tempPath();
      try {
        expect(() => run(`
          proc p() {
            var h = fileOpen("${path}", Write);
            match h with | Ok o -> readLine(o.value) | Err _ -> 0;
          }
          p();
        `)).toThrow("requires a ReadHandle");
      } finally { try { nodeFs.unlinkSync(path); } catch {} }
    });
  });

  // ─── writeChar and writeLine ──────────────────────────────────────────────────

  describe('writeChar and writeLine', () => {
    it('writeChar should write individual chars', () => {
      const path = tempPath();
      try {
        run(`
          proc p() {
            var h = fileOpen("${path}", Write);
            match h with
              | Ok o -> { writeChar(o.value, 'h'); writeChar(o.value, 'i'); fileClose(o.value); }
              | Err _ -> 0;
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
            var h = fileOpen("${path}", Write);
            match h with
              | Ok o -> { writeLine(o.value, "first"); writeLine(o.value, "second"); fileClose(o.value); }
              | Err _ -> 0;
          }
          p();
        `);
        expect(nodeFs.readFileSync(path, 'utf8')).toBe('first\nsecond\n');
      } finally { try { nodeFs.unlinkSync(path); } catch {} }
    });

    it('writeLine should return Ok { n } with byte count', () => {
      const path = tempPath();
      try {
        const { logs } = run(`
          proc p() {
            var h = fileOpen("${path}", Write);
            let r = match h with | Ok o -> writeLine(o.value, "hello") | Err _ -> Err { "no handle" };
            println(match r with | Ok o -> o.value + "" | Err e -> e.message);
            match h with | Ok o -> fileClose(o.value) | Err _ -> 0;
          }
          p();
        `);
        expect(logs).toEqual(['6']); // "hello\n" = 6 bytes
      } finally { try { nodeFs.unlinkSync(path); } catch {} }
    });

    it('writeChar should throw when given a ReadHandle', () => {
      withTempFile('data', path => {
        expect(() => run(`
          proc p() {
            var h = fileOpen("${path}", Read);
            match h with | Ok o -> writeChar(o.value, 'x') | Err _ -> 0;
          }
          p();
        `)).toThrow("requires a WriteHandle");
      });
    });

    it('Append mode accumulates lines across multiple opens', () => {
      const path = tempPath();
      try {
        run(`
          proc p() {
            var h1 = fileOpen("${path}", Write);
            match h1 with | Ok o -> { writeLine(o.value, "alpha"); fileClose(o.value); } | Err _ -> 0;
            var h2 = fileOpen("${path}", Append);
            match h2 with | Ok o -> { writeLine(o.value, "beta"); fileClose(o.value); } | Err _ -> 0;
            var h3 = fileOpen("${path}", Append);
            match h3 with | Ok o -> { writeLine(o.value, "gamma"); fileClose(o.value); } | Err _ -> 0;
          }
          p();
        `);
        expect(nodeFs.readFileSync(path, 'utf8')).toBe('alpha\nbeta\ngamma\n');
      } finally { try { nodeFs.unlinkSync(path); } catch {} }
    });
  });

  // ─── Purity enforcement ───────────────────────────────────────────────────────

  describe('Purity enforcement', () => {
    it('fileOpen should throw in pure functions', () => {
      expect(() => run(`
        function bad() { return fileOpen("x.txt", Read); }
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
}
  describe('fileExists', () => {
    it('returns true for a file that exists', () => {
      withTempFile('hello', path => {
        const { logs } = run(`
          proc p() {
            println(fileExists("${path}"));
          }
          p();
        `.replace('${path}', path));
        expect(logs).toEqual(['true']);
      });
    });

    it('returns false for a path that does not exist', () => {
      const { logs } = run(`
        proc p() {
          println(fileExists("/no/such/file.txt"));
        }
        p();
      `);
      expect(logs).toEqual(['false']);
    });

    it('can guard a readFile call', () => {
      withTempFile('content', path => {
        const { logs } = run(`
          proc p() {
            let exists = fileExists("${path}");
            let result = exists
              ? (match readFile("${path}") with | Ok o -> o.value | Err _ -> "read failed")
              : "not found";
            println(result);
          }
          p();
        `.replace(/\${path}/g, path));
        expect(logs).toEqual(['content']);
      });
    });

    it('returns false after a file is deleted', () => {
      const path = tempPath();
      nodeFs.writeFileSync(path, 'data', 'utf8');
      nodeFs.unlinkSync(path);
      const { logs } = run(`
        proc p() {
          println(fileExists("${path}"));
        }
        p();
      `.replace('${path}', path));
      expect(logs).toEqual(['false']);
    });

    it('throws in pure functions', () => {
      expect(() => run(`
        function bad() { return fileExists("x.txt"); }
        bad();
      `)).toThrow("side effects not allowed in pure functions");
    });
  });
});
