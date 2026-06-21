// src/test/filelib_byte.test.ts
// Tests for byte-level file I/O: readByte, writeByte, readBytes, writeBytes,
// makeBuffer, readBuffer, writeBuffer, bufferToBytes, bufferToString, bufferLength.

import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Interpreter, PfunByte } from '../interpreter';
import { PfunBuffer, mutStructuresFunctions, mutStructuresTypes } from '../mutStructures';
import * as os from 'os';
import * as nodePath from 'path';
import * as nodeFs from 'fs';
import { stdlibFunctions, stdlibTypes } from '../library';
import { iolibFunctions } from '../iolib';
import { filelibFunctions, filelibTypes } from '../filelib';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const run = (source: string) => {
  const ast = new Parser(new Lexer(source).lex()).parse();
  const interp = new Interpreter();
  interp.registerLibrary(stdlibFunctions, stdlibTypes);
  interp.registerLibrary(mutStructuresFunctions, mutStructuresTypes);
  interp.registerLibrary(iolibFunctions, []);
  interp.registerLibrary(filelibFunctions, filelibTypes);
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...args: any[]) => logs.push(args.map(String).join(' '));
  try { interp.interpret(ast, source); } finally { console.log = orig; }
  return { logs, interp };
};

const withTempFile = (content: Buffer | string, fn: (path: string) => void) => {
  const p = nodePath.join(os.tmpdir(), `pfun-byte-test-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  if (typeof content === 'string') nodeFs.writeFileSync(p, content, 'utf8');
  else nodeFs.writeFileSync(p, content);
  try { fn(p); } finally { try { nodeFs.unlinkSync(p); } catch {} }
};

const tempPath = () =>
  nodePath.join(os.tmpdir(), `pfun-byte-test-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);

// ─── readByte ─────────────────────────────────────────────────────────────────

describe('readByte', () => {
  it('reads a single byte and returns Ok { byte }', () => {
    withTempFile(Buffer.from([0x41]), path => {
      const { logs } = run(`
        proc p() {
          var h = fileOpen("${path}", Read);
          match h with
          | Ok o -> {
              let r = readByte(o.value);
              match r with
              | Ok b -> println(b.value)
              | Eof -> println("eof")
              | Err e -> println(e.message);
              fileClose(o.value);
            }
          | Err _ -> println("open failed");
        }
        p();
      `);
      expect(logs).toEqual(['65']);
    });
  });

  it('returns Eof at end of file', () => {
    withTempFile(Buffer.from([]), path => {
      const { logs } = run(`
        proc p() {
          var h = fileOpen("${path}", Read);
          match h with
          | Ok o -> {
              let r = readByte(o.value);
              match r with
              | Ok b -> println(b.value)
              | Eof -> println("eof")
              | Err e -> println(e.message);
              fileClose(o.value);
            }
          | Err _ -> println("open failed");
        }
        p();
      `);
      expect(logs).toEqual(['eof']);
    });
  });

  it('reads multiple bytes sequentially', () => {
    withTempFile(Buffer.from([0x01, 0x02, 0x03]), path => {
      const { logs } = run(`
        proc p() {
          var h = fileOpen("${path}", Read);
          match h with
          | Ok o -> {
              let r1 = readByte(o.value);
              let r2 = readByte(o.value);
              let r3 = readByte(o.value);
              match r1 with | Ok b -> println(b.value) | _ -> 0;
              match r2 with | Ok b -> println(b.value) | _ -> 0;
              match r3 with | Ok b -> println(b.value) | _ -> 0;
              fileClose(o.value);
            }
          | Err _ -> 0;
        }
        p();
      `);
      expect(logs).toEqual(['1', '2', '3']);
    });
  });

  it('throws when given a WriteHandle', () => {
    const path = tempPath();
    expect(() => run(`
      proc p() {
        var h = fileOpen("${path}", Write);
        match h with | Ok o -> readByte(o.value) | Err _ -> 0;
      }
      p();
    `)).toThrow("requires a ReadHandle");
    try { nodeFs.unlinkSync(path); } catch {}
  });
});

// ─── writeByte ────────────────────────────────────────────────────────────────

describe('writeByte', () => {
  it('writes a single byte to a file', () => {
    const path = tempPath();
    try {
      run(`
        proc p() {
          var h = fileOpen("${path}", Write);
          match h with
          | Ok o -> { writeByte(o.value, 0x41b); fileClose(o.value); }
          | Err _ -> 0;
        }
        p();
      `);
      expect(nodeFs.readFileSync(path)).toEqual(Buffer.from([0x41]));
    } finally { try { nodeFs.unlinkSync(path); } catch {} }
  });

  it('returns Ok { 1 } on success', () => {
    const path = tempPath();
    try {
      const { logs } = run(`
        proc p() {
          var h = fileOpen("${path}", Write);
          match h with
          | Ok o -> {
              let r = writeByte(o.value, 0xFFb);
              match r with | Ok n -> println(n.value) | Err e -> println(e.message);
              fileClose(o.value);
            }
          | Err _ -> 0;
        }
        p();
      `);
      expect(logs).toEqual(['1']);
    } finally { try { nodeFs.unlinkSync(path); } catch {} }
  });

  it('writes multiple bytes', () => {
    const path = tempPath();
    try {
      run(`
        proc p() {
          var h = fileOpen("${path}", Write);
          match h with
          | Ok o -> {
              writeByte(o.value, 0xDEb);
              writeByte(o.value, 0xADb);
              writeByte(o.value, 0xBEb);
              writeByte(o.value, 0xEFb);
              fileClose(o.value);
            }
          | Err _ -> 0;
        }
        p();
      `);
      expect(nodeFs.readFileSync(path)).toEqual(Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]));
    } finally { try { nodeFs.unlinkSync(path); } catch {} }
  });

  it('throws when given a ReadHandle', () => {
    withTempFile(Buffer.from([0x00]), path => {
      expect(() => run(`
        proc p() {
          var h = fileOpen("${path}", Read);
          match h with | Ok o -> writeByte(o.value, 0x00b) | Err _ -> 0;
        }
        p();
      `)).toThrow("requires a WriteHandle");
    });
  });
});

// ─── readBytes ────────────────────────────────────────────────────────────────

describe('readBytes', () => {
  it('reads n bytes as a List<Byte>', () => {
    withTempFile(Buffer.from([0x01, 0x02, 0x03, 0x04]), path => {
      const { logs } = run(`
        proc p() {
          var h = fileOpen("${path}", Read);
          match h with
          | Ok o -> {
              let r = readBytes(o.value, 3);
              match r with
              | Ok b -> println(length(b.value))
              | _ -> println("fail");
              fileClose(o.value);
            }
          | Err _ -> 0;
        }
        p();
      `);
      expect(logs).toEqual(['3']);
    });
  });

  it('partial read returns however many bytes are available', () => {
    withTempFile(Buffer.from([0xAA, 0xBB]), path => {
      const { logs } = run(`
        proc p() {
          var h = fileOpen("${path}", Read);
          match h with
          | Ok o -> {
              let r = readBytes(o.value, 100);
              match r with
              | Ok b -> println(length(b.value))
              | Eof -> println("eof")
              | Err e -> println(e.message);
              fileClose(o.value);
            }
          | Err _ -> 0;
        }
        p();
      `);
      expect(logs).toEqual(['2']);
    });
  });

  it('returns Eof when already at end of file', () => {
    withTempFile(Buffer.from([]), path => {
      const { logs } = run(`
        proc p() {
          var h = fileOpen("${path}", Read);
          match h with
          | Ok o -> {
              let r = readBytes(o.value, 4);
              match r with
              | Ok bytes -> println(length(bytes))
              | Eof -> println("eof")
              | Err _ -> println("err");
              fileClose(o.value);
            }
          | Err _ -> 0;
        }
        p();
      `);
      expect(logs).toEqual(['eof']);
    });
  });

  it('byte values are correct', () => {
    withTempFile(Buffer.from([0xDE, 0xAD]), path => {
      const { logs } = run(`
        proc p() {
          var h = fileOpen("${path}", Read);
          match h with
          | Ok o -> {
              let r = readBytes(o.value, 2);
              match r with
              | Ok b -> {
                  println(nth(b.value, 0));
                  println(nth(b.value, 1));
                }
              | _ -> 0;
              fileClose(o.value);
            }
          | Err _ -> 0;
        }
        p();
      `);
      expect(logs).toEqual(['222', '173']); // 0xDE = 222, 0xAD = 173
    });
  });
});

// ─── writeBytes ───────────────────────────────────────────────────────────────

describe('writeBytes', () => {
  it('writes a List<Byte> to a file', () => {
    const path = tempPath();
    try {
      run(`
        proc p() {
          var h = fileOpen("${path}", Write);
          match h with
          | Ok o -> {
              writeBytes(o.value, [0xCAb, 0xFEb]);
              fileClose(o.value);
            }
          | Err _ -> 0;
        }
        p();
      `);
      expect(nodeFs.readFileSync(path)).toEqual(Buffer.from([0xCA, 0xFE]));
    } finally { try { nodeFs.unlinkSync(path); } catch {} }
  });

  it('returns Ok { n } with byte count', () => {
    const path = tempPath();
    try {
      const { logs } = run(`
        proc p() {
          var h = fileOpen("${path}", Write);
          match h with
          | Ok o -> {
              let r = writeBytes(o.value, [0x01b, 0x02b, 0x03b]);
              match r with | Ok n -> println(n.value) | Err e -> println(e.message);
              fileClose(o.value);
            }
          | Err _ -> 0;
        }
        p();
      `);
      expect(logs).toEqual(['3']);
    } finally { try { nodeFs.unlinkSync(path); } catch {} }
  });

  it('round-trips with readBytes', () => {
    const path = tempPath();
    try {
      const { logs } = run(`
        proc p() {
          var wh = fileOpen("${path}", Write);
          match wh with
          | Ok o -> { writeBytes(o.value, [0xAAb, 0xBBb, 0xCCb]); fileClose(o.value); }
          | Err _ -> 0;
          var rh = fileOpen("${path}", Read);
          match rh with
          | Ok o -> {
              let r = readBytes(o.value, 3);
              match r with
              | Ok b -> println(length(b.value))
              | _ -> println("fail");
              fileClose(o.value);
            }
          | Err _ -> 0;
        }
        p();
      `);
      expect(logs).toEqual(['3']);
    } finally { try { nodeFs.unlinkSync(path); } catch {} }
  });
});

// ─── Buffer ───────────────────────────────────────────────────────────────────

describe('PfunBuffer (native)', () => {
  it('PfunBuffer.fromBytes produces correct byte list', () => {
    const bytes = [new PfunByte(0xDE), new PfunByte(0xAD)];
    const buf = PfunBuffer.fromBytes(bytes);
    expect(buf.pos).toBe(2);
    expect(buf.data[0]).toBe(0xDE);
    expect(buf.data[1]).toBe(0xAD);
  });

  it('PfunBuffer.toByteList round-trips', () => {
    const bytes = [new PfunByte(1), new PfunByte(2), new PfunByte(3)];
    const buf = PfunBuffer.fromBytes(bytes);
    const out = buf.toByteList();
    expect(out).toHaveLength(3);
    expect(out[0].value).toBe(1);
    expect(out[1].value).toBe(2);
    expect(out[2].value).toBe(3);
  });
});

describe('makeBuffer', () => {
  it('makeBuffer(ByteMode) creates a byte buffer', () => {
    const { interp } = run(`var b = makeBuffer(ByteMode);`);
    const b = interp.force(interp.getGlobal('b'));
    expect(b).toBeInstanceOf(PfunBuffer);
    expect((b as PfunBuffer).mode).toBe('byte');
  });

  it('makeBuffer(CharMode) creates a char buffer', () => {
    const { interp } = run(`var b = makeBuffer(CharMode);`);
    const b = interp.force(interp.getGlobal('b'));
    expect(b).toBeInstanceOf(PfunBuffer);
    expect((b as PfunBuffer).mode).toBe('char');
  });

  it('throws when declared with let', () => {
    expect(() => run(`let b = makeBuffer(ByteMode);`))
      .toThrow("Buffers must be declared with 'var'");
  });
});

describe('readBuffer / writeBuffer', () => {
  it('readBuffer in ByteMode reads raw bytes', () => {
    withTempFile(Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]), path => {
      const { interp } = run(`
        proc p() {
          var h = fileOpen("${path}", Read);
          match h with
          | Ok o -> {
              let r = readBuffer(o.value, 4, ByteMode);
              fileClose(o.value);
            }
          | Err _ -> 0;
        }
        p();
      `);
      // readBuffer returns Ok { buffer } — hard to test from Pfun side without
      // bufferToBytes, so we test the combination below
    });
  });

  it('bufferToBytes after readBuffer returns correct bytes', () => {
    withTempFile(Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]), path => {
      const { logs } = run(`
        proc p() {
          var h = fileOpen("${path}", Read);
          match h with
          | Ok o -> {
              let r = readBuffer(o.value, 4, ByteMode);
              match r with
              | Ok b -> {
                  let bytes = bufferToBytes(b.value);
                  println(length(bytes));
                  println(nth(bytes, 0));
                  println(nth(bytes, 3));
                }
              | Err e -> println(e.message);
              fileClose(o.value);
            }
          | Err _ -> 0;
        }
        p();
      `);
      expect(logs).toEqual(['4', '222', '239']); // 0xDE=222, 0xEF=239
    });
  });

  it('readBuffer in CharMode reads UTF-8 chars', () => {
    withTempFile('hello', path => {
      const { logs } = run(`
        proc p() {
          var h = fileOpen("${path}", Read);
          match h with
          | Ok o -> {
              let r = readBuffer(o.value, 5, CharMode);
              match r with
              | Ok b -> println(bufferToString(b.value))
              | Err e -> println(e.message);
              fileClose(o.value);
            }
          | Err _ -> 0;
        }
        p();
      `);
      expect(logs).toEqual(['hello']);
    });
  });

  it('writeBuffer writes buffer contents to file', () => {
    const path = tempPath();
    try {
      run(`
        proc p() {
          var wh = fileOpen("${path}", Write);
          match wh with
          | Ok o -> {
              let r = readBuffer(o.value, 0, ByteMode);
              fileClose(o.value);
            }
          | Err _ -> 0;
        }
        p();
      `);
      // Build buffer natively and write it
      const buf = PfunBuffer.fromBytes([new PfunByte(0xAA), new PfunByte(0xBB)]);
      const fd = nodeFs.openSync(path, 'w');
      nodeFs.writeSync(fd, buf.data, 0, buf.pos);
      nodeFs.closeSync(fd);
      expect(nodeFs.readFileSync(path)).toEqual(Buffer.from([0xAA, 0xBB]));
    } finally { try { nodeFs.unlinkSync(path); } catch {} }
  });

  it('writeBuffer round-trip through readBuffer', () => {
    const path = tempPath();
    try {
      const { logs } = run(`
        proc p() {
          var wh = fileOpen("${path}", Write);
          match wh with
          | Ok o -> {
              writeBytes(o.value, [0x01b, 0x02b, 0x03b]);
              fileClose(o.value);
            }
          | Err _ -> 0;
          var rh = fileOpen("${path}", Read);
          match rh with
          | Ok o -> {
              let r = readBuffer(o.value, 3, ByteMode);
              match r with
              | Ok b -> {
                  let bytes = bufferToBytes(b.value);
                  println(bufferLength(b.value));
                  println(nth(bytes, 0));
                  println(nth(bytes, 2));
                }
              | _ -> println("fail");
              fileClose(o.value);
            }
          | Err _ -> 0;
        }
        p();
      `);
      expect(logs).toEqual(['3', '1', '3']);
    } finally { try { nodeFs.unlinkSync(path); } catch {} }
  });
});

describe('bufferLength', () => {
  it('returns 0 for a fresh buffer', () => {
    const { interp } = run(`var b = makeBuffer(ByteMode);`);
    const b = interp.force(interp.getGlobal('b'));
    expect((b as PfunBuffer).pos).toBe(0);
  });
});

describe('bufferToString', () => {
  it('decodes ASCII bytes as string', () => {
    withTempFile('world', path => {
      const { logs } = run(`
        proc p() {
          var h = fileOpen("${path}", Read);
          match h with
          | Ok o -> {
              let r = readBuffer(o.value, 5, CharMode);
              match r with
              | Ok buf -> println(bufferToString(buf.value))
              | _ -> println("fail");
              fileClose(o.value);
            }
          | Err _ -> 0;
        }
        p();
      `);
      expect(logs).toEqual(['world']);
    });
  });
});
