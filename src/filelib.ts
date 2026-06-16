// src/filelib.ts
// File I/O library for Pfun.
// Register with: loader.registerBuiltin('file', filelibFunctions)
// Use with:      import * from "file";
//
// FileHandle is a union type (ReadHandle | WriteHandle).
// The fd is stored on the runtime object but not accessible from Pfun code.
//
// FileMode is a union type: Read | Write | Append
//   Read   — open for reading; file must exist
//   Write  — open for writing; creates or overwrites
//   Append — open for writing; creates or appends
//
// Result type:     Ok { value } | Err { message }
// ReadResult type: Ok { value } | Eof | Err { message }
//
// readChar and readLine return ReadResult (distinguishes EOF from error).
// All other fallible operations return Result.
//
// Convenience functions (readFile, writeFile) manage handles internally.
// All other functions require an explicit handle from fileOpen/fileClose.

import * as fs from 'fs';
import { RegistryFunction, RegistryType, PfunChar, PfunByte } from './interpreter';

// ─── FileHandle runtime objects ───────────────────────────────────────────────

function makeReadHandle(fd: number): any {
  return { __type: 'ReadHandle', __union: 'FileHandle', __fd: fd };
}

function makeWriteHandle(fd: number): any {
  return { __type: 'WriteHandle', __union: 'FileHandle', __fd: fd };
}

function getFd(handle: any): number {
  if (typeof handle?.__fd !== 'number') throw new Error("Expected a FileHandle.");
  return handle.__fd;
}

// ─── Char reader for file fds ─────────────────────────────────────────────────

function readByteFromFd(fd: number): number | null {
  const buf = Buffer.alloc(1);
  try {
    const n = fs.readSync(fd, buf, 0, 1, null);
    return n === 0 ? null : buf[0];
  } catch { return null; }
}

function readCharFromFd(fd: number): string | null {
  const b0 = readByteFromFd(fd);
  if (b0 === null) return null;
  let bytes: number[];
  if      (b0 < 0x80) { bytes = [b0]; }
  else if (b0 < 0xE0) { const b1 = readByteFromFd(fd); if (b1 === null) return String.fromCharCode(b0); bytes = [b0, b1]; }
  else if (b0 < 0xF0) { const b1 = readByteFromFd(fd); if (b1 === null) return String.fromCharCode(b0); const b2 = readByteFromFd(fd); if (b2 === null) return String.fromCharCode(b0); bytes = [b0, b1, b2]; }
  else                { const b1 = readByteFromFd(fd); if (b1 === null) return String.fromCharCode(b0); const b2 = readByteFromFd(fd); if (b2 === null) return String.fromCharCode(b0); const b3 = readByteFromFd(fd); if (b3 === null) return String.fromCharCode(b0); bytes = [b0, b1, b2, b3]; }
  return Buffer.from(bytes).toString('utf8') || null;
}

function readLineFromFd(fd: number): string | null {
  let line = '', gotAny = false;
  while (true) {
    const c = readCharFromFd(fd);
    if (c === null) return gotAny ? line : null;
    gotAny = true;
    if (c === '\n') return line;
    if (c !== '\r') line += c;
  }
}

// ─── Result / ReadResult helpers ─────────────────────────────────────────────
// These construct values directly (bypassing instantiate) so they carry the
// correct __union tag regardless of which union was registered first.
// Result     = Ok { value } | Err { message }          (all non-read operations)
// ReadResult = Ok { value } | Eof | Err { message }    (readChar, readLine)

const ok   = (value: any)      => ({ __type: 'Ok',  __union: 'Result',     value });
const err  = (message: string) => ({ __type: 'Err', __union: 'Result',     message });
const okR  = (value: any)      => ({ __type: 'Ok',  __union: 'ReadResult', value });
const eofR =                       { __type: 'Eof',  __union: 'ReadResult' };
const errR = (message: string) => ({ __type: 'Err', __union: 'ReadResult', message });

function nodeErrMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ─── Buffer runtime object ────────────────────────────────────────────────────
//
// PfunBuffer is a mutable byte/char buffer. The `mode` field ('byte' | 'char')
// is fixed at construction and determines whether read/write operations work in
// raw byte or UTF-8 char units. Not accessible from Pfun code — only passed to
// readBuffer/writeBuffer.

export class PfunBuffer {
  public data: Buffer;
  public pos:  number = 0;  // current read/write position

  constructor(
    public mode: 'byte' | 'char',
    capacity: number = 4096,
  ) {
    this.data = Buffer.alloc(capacity);
  }

  static fromBytes(bytes: PfunByte[]): PfunBuffer {
    const buf = new PfunBuffer('byte', bytes.length);
    for (let i = 0; i < bytes.length; i++) buf.data[i] = bytes[i].value;
    buf.pos = bytes.length;
    return buf;
  }

  toByteList(): PfunByte[] {
    const out: PfunByte[] = [];
    for (let i = 0; i < this.pos; i++) out.push(new PfunByte(this.data[i]));
    return out;
  }
}

// ─── Registry Types ───────────────────────────────────────────────────────────

export const filelibTypes: RegistryType[] = [
  {
    kind: 'union',
    name: 'FileHandle',
    variants: [
      { name: 'ReadHandle',  fields: [] },
      { name: 'WriteHandle', fields: [] },
    ],
  },
  {
    kind: 'union',
    name: 'FileMode',
    variants: [
      { name: 'Read',   fields: [] },
      { name: 'Write',  fields: [] },
      { name: 'Append', fields: [] },
    ],
  },
  {
    kind: 'union',
    name: 'Result',
    variants: [
      { name: 'Ok',  fields: ['value'] },
      { name: 'Err', fields: ['message'] },
    ],
  },
  {
    kind: 'union',
    name: 'ReadResult',
    variants: [
      { name: 'Ok',  fields: ['value'] },
      { name: 'Eof', fields: [] },
      { name: 'Err', fields: ['message'] },
    ],
  },
  // BufferMode: whether a buffer holds raw bytes or UTF-8 chars.
  {
    kind: 'union',
    name: 'BufferMode',
    variants: [
      { name: 'ByteMode', fields: [] },
      { name: 'CharMode', fields: [] },
    ],
  },
];

// ─── Registry Functions ───────────────────────────────────────────────────────

export const filelibFunctions: RegistryFunction[] = [

  // fileExists(path) — returns true if the path exists, false otherwise.
  { name: 'fileExists', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'fileExists': side effects not allowed in pure functions.");
    const filePath = interp.force(args[0]);
    if (typeof filePath !== 'string') throw new Error("fileExists: path must be a string.");
    return fs.existsSync(filePath);
  }},

  // fileOpen(path, mode) — mode is Read | Write | Append
  // Returns Ok { ReadHandle | WriteHandle } or Err { message }.
  { name: 'fileOpen', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'fileOpen': side effects not allowed in pure functions.");
    const filePath = interp.force(args[0]);
    const mode     = interp.force(args[1]);
    if (typeof filePath !== 'string') throw new Error("fileOpen: path must be a string.");
    if (!mode || typeof mode !== 'object' || !['Read', 'Write', 'Append'].includes(mode.__type))
      throw new Error("fileOpen: mode must be Read, Write, or Append.");
    const flag = mode.__type === 'Read' ? 'r' : mode.__type === 'Write' ? 'w' : 'a';
    try {
      const fd = fs.openSync(filePath, flag);
      return ok(flag === 'r' ? makeReadHandle(fd) : makeWriteHandle(fd));
    } catch (e) { return err(nodeErrMsg(e)); }
  }},

  // fileClose(handle) — closes the file descriptor.
  // Returns Ok { 0 } or Err { message }.
  { name: 'fileClose', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'fileClose': side effects not allowed in pure functions.");
    const handle = interp.force(args[0]);
    try { fs.closeSync(getFd(handle)); return ok(0n); }
    catch (e) { return err(nodeErrMsg(e)); }
  }},

  // readChar(handle) — reads one Unicode char from a ReadHandle.
  // Returns Ok { char } | Eof | Err { message }.
  { name: 'readChar', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'readChar': side effects not allowed in pure functions.");
    const handle = interp.force(args[0]);
    if (handle.__type !== 'ReadHandle') throw new Error("readChar: requires a ReadHandle.");
    try {
      const c = readCharFromFd(getFd(handle));
      return c === null ? eofR : okR(new PfunChar(c));
    } catch (e) { return errR(nodeErrMsg(e)); }
  }},

  // readLine(handle) — reads one line from a ReadHandle (newline consumed, not included).
  // Returns Ok { string } | Eof | Err { message }.
  { name: 'readLine', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'readLine': side effects not allowed in pure functions.");
    const handle = interp.force(args[0]);
    if (handle.__type !== 'ReadHandle') throw new Error("readLine: requires a ReadHandle.");
    try {
      const line = readLineFromFd(getFd(handle));
      return line === null ? eofR : okR(line);
    } catch (e) { return errR(nodeErrMsg(e)); }
  }},

  // readFile(path) — opens, reads entire file as string, closes.
  // Returns Ok { string } or Err { message }.
  { name: 'readFile', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'readFile': side effects not allowed in pure functions.");
    const filePath = interp.force(args[0]);
    if (typeof filePath !== 'string') throw new Error("readFile: path must be a string.");
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return ok(content);
    } catch (e) { return err(nodeErrMsg(e)); }
  }},

  // writeChar(handle, char) — writes one char to a WriteHandle.
  // Returns Ok { n } or Err { message }.
  { name: 'writeChar', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'writeChar': side effects not allowed in pure functions.");
    const handle = interp.force(args[0]);
    const c      = interp.force(args[1]);
    if (handle.__type !== 'WriteHandle') throw new Error("writeChar: requires a WriteHandle.");
    if (!(c instanceof PfunChar)) throw new Error("writeChar: second argument must be a char.");
    try {
      const buf = Buffer.from(c.value, 'utf8');
      fs.writeSync(getFd(handle), buf);
      return ok(BigInt(buf.length));
    } catch (e) { return err(nodeErrMsg(e)); }
  }},

  // writeLine(handle, string) — writes a string followed by a newline to a WriteHandle.
  // Returns Ok { n } or Err { message }.
  { name: 'writeLine', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'writeLine': side effects not allowed in pure functions.");
    const handle = interp.force(args[0]);
    const str    = interp.force(args[1]);
    if (handle.__type !== 'WriteHandle') throw new Error("writeLine: requires a WriteHandle.");
    if (typeof str !== 'string') throw new Error("writeLine: second argument must be a string.");
    try {
      const buf = Buffer.from(str + '\n', 'utf8');
      fs.writeSync(getFd(handle), buf);
      return ok(BigInt(buf.length));
    } catch (e) { return err(nodeErrMsg(e)); }
  }},

  // writeFile(path, content) — opens, writes entire string, closes.
  // Returns Ok { n } (chars written) or Err { message }.
  { name: 'writeFile', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'writeFile': side effects not allowed in pure functions.");
    const filePath = interp.force(args[0]);
    const content  = interp.force(args[1]);
    if (typeof filePath !== 'string') throw new Error("writeFile: path must be a string.");
    if (typeof content  !== 'string') throw new Error("writeFile: content must be a string.");
    try {
      fs.writeFileSync(filePath, content, 'utf8');
      return ok(BigInt(content.length));
    } catch (e) { return err(nodeErrMsg(e)); }
  }},

  // ─── Byte-level I/O ──────────────────────────────────────────────────────

  // readByte(handle) — reads one raw byte from a ReadHandle.
  // Returns Ok { byte } | Eof | Err { message }.
  { name: 'readByte', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'readByte': side effects not allowed in pure functions.");
    const handle = interp.force(args[0]);
    if (handle.__type !== 'ReadHandle') throw new Error("readByte: requires a ReadHandle.");
    try {
      const b = readByteFromFd(getFd(handle));
      return b === null ? eofR : okR(new PfunByte(b));
    } catch (e) { return errR(nodeErrMsg(e)); }
  }},

  // writeByte(handle, byte) — writes one raw byte to a WriteHandle.
  // Returns Ok { 1 } or Err { message }.
  { name: 'writeByte', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'writeByte': side effects not allowed in pure functions.");
    const handle = interp.force(args[0]);
    const b      = interp.force(args[1]);
    if (handle.__type !== 'WriteHandle') throw new Error("writeByte: requires a WriteHandle.");
    if (!(b instanceof PfunByte)) throw new Error("writeByte: second argument must be a Byte.");
    try {
      const buf = Buffer.from([b.value]);
      fs.writeSync(getFd(handle), buf);
      return ok(1n);
    } catch (e) { return err(nodeErrMsg(e)); }
  }},

  // readBytes(handle, n) — reads up to n raw bytes from a ReadHandle.
  // Returns Ok { List<Byte> } | Eof | Err { message }.
  // Returns Eof only if zero bytes were read (i.e. already at EOF).
  // A partial read (fewer than n bytes) returns Ok with however many were available.
  { name: 'readBytes', arity: 2, fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'readBytes': side effects not allowed in pure functions.");
    const handle = interp.force(args[0]);
    const nVal   = interp.force(args[1]);
    if (handle.__type !== 'ReadHandle') throw new Error("readBytes: requires a ReadHandle.");
    if (typeof nVal !== 'bigint' || nVal < 0n) throw new Error("readBytes: count must be a non-negative Int.");
    const n = Number(nVal);
    try {
      const buf = Buffer.alloc(n);
      const read = fs.readSync(getFd(handle), buf, 0, n, null);
      if (read === 0) return eofR;
      const bytes: PfunByte[] = [];
      for (let i = 0; i < read; i++) bytes.push(new PfunByte(buf[i]));
      return okR(bytes);
    } catch (e) { return errR(nodeErrMsg(e)); }
  }},

  // writeBytes(handle, bytes) — writes a List<Byte> to a WriteHandle.
  // Returns Ok { n } (bytes written) or Err { message }.
  { name: 'writeBytes', arity: 2, fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'writeBytes': side effects not allowed in pure functions.");
    const handle = interp.force(args[0]);
    const bytes  = interp.force(args[1]);
    if (handle.__type !== 'WriteHandle') throw new Error("writeBytes: requires a WriteHandle.");
    if (!Array.isArray(bytes) || !bytes.every((b: any) => b instanceof PfunByte))
      throw new Error("writeBytes: second argument must be a List<Byte>.");
    try {
      const buf = Buffer.from(bytes.map((b: PfunByte) => b.value));
      fs.writeSync(getFd(handle), buf);
      return ok(BigInt(buf.length));
    } catch (e) { return err(nodeErrMsg(e)); }
  }},

  // ─── Buffer I/O ──────────────────────────────────────────────────────────
  //
  // A Buffer is a mutable byte/char accumulator backed by PfunBuffer.
  // makeBuffer(mode) — creates a new empty buffer.
  //   mode: ByteMode | CharMode (from the BufferMode union)
  // readBuffer(handle, n, mode) — reads n units into a new buffer and returns it.
  //   In ByteMode: reads n raw bytes.
  //   In CharMode: reads n UTF-8 chars (each may be 1–4 bytes on disk).
  // writeBuffer(handle, buffer) — writes all of buffer's contents to a WriteHandle.
  // bufferToBytes(buffer) — returns a List<Byte> copy of the buffer's raw bytes.
  // bufferToString(buffer) — returns a String (CharMode buffers only).
  // bufferLength(buffer) — number of bytes currently in the buffer.

  { name: 'makeBuffer', fn: (args, interp) => {
    const mode = interp.force(args[0]);
    if (!mode || (mode.__type !== 'ByteMode' && mode.__type !== 'CharMode'))
      throw new Error("makeBuffer: mode must be ByteMode or CharMode.");
    return new PfunBuffer(mode.__type === 'ByteMode' ? 'byte' : 'char');
  }},

  { name: 'readBuffer', arity: 3, fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'readBuffer': side effects not allowed in pure functions.");
    const handle = interp.force(args[0]);
    const nVal   = interp.force(args[1]);
    const mode   = interp.force(args[2]);
    if (handle.__type !== 'ReadHandle') throw new Error("readBuffer: requires a ReadHandle.");
    if (typeof nVal !== 'bigint' || nVal < 0n) throw new Error("readBuffer: count must be a non-negative Int.");
    if (!mode || (mode.__type !== 'ByteMode' && mode.__type !== 'CharMode'))
      throw new Error("readBuffer: mode must be ByteMode or CharMode.");
    const n = Number(nVal);
    const bufMode = mode.__type === 'ByteMode' ? 'byte' : 'char';
    const pbuf = new PfunBuffer(bufMode, Math.max(n * 4, 16)); // * 4 for worst-case UTF-8
    try {
      if (bufMode === 'byte') {
        const read = fs.readSync(getFd(handle), pbuf.data, 0, n, null);
        pbuf.pos = read;
      } else {
        // CharMode: read n chars using the UTF-8 decoder
        let charsRead = 0;
        while (charsRead < n) {
          const c = readCharFromFd(getFd(handle));
          if (c === null) break;
          const encoded = Buffer.from(c, 'utf8');
          // Grow if needed
          if (pbuf.pos + encoded.length > pbuf.data.length) {
            const grown = Buffer.alloc(pbuf.data.length * 2);
            pbuf.data.copy(grown);
            pbuf.data = grown;
          }
          encoded.copy(pbuf.data, pbuf.pos);
          pbuf.pos += encoded.length;
          charsRead++;
        }
      }
      return ok(pbuf);
    } catch (e) { return err(nodeErrMsg(e)); }
  }},

  { name: 'writeBuffer', arity: 2, fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'writeBuffer': side effects not allowed in pure functions.");
    const handle = interp.force(args[0]);
    const pbuf   = interp.force(args[1]);
    if (handle.__type !== 'WriteHandle') throw new Error("writeBuffer: requires a WriteHandle.");
    if (!(pbuf instanceof PfunBuffer)) throw new Error("writeBuffer: second argument must be a Buffer.");
    try {
      fs.writeSync(getFd(handle), pbuf.data, 0, pbuf.pos);
      return ok(BigInt(pbuf.pos));
    } catch (e) { return err(nodeErrMsg(e)); }
  }},

  // bufferToBytes(buffer) — returns a List<Byte> copy of the buffer's raw bytes.
  { name: 'bufferToBytes', fn: (args, interp) => {
    const pbuf = interp.force(args[0]);
    if (!(pbuf instanceof PfunBuffer)) throw new Error("bufferToBytes: argument must be a Buffer.");
    return pbuf.toByteList();
  }},

  // bufferToString(buffer) — returns the buffer contents decoded as UTF-8 string.
  // Intended for CharMode buffers; works on ByteMode too (raw UTF-8 decode).
  { name: 'bufferToString', fn: (args, interp) => {
    const pbuf = interp.force(args[0]);
    if (!(pbuf instanceof PfunBuffer)) throw new Error("bufferToString: argument must be a Buffer.");
    return pbuf.data.toString('utf8', 0, pbuf.pos);
  }},

  // bufferLength(buffer) — number of bytes currently written into the buffer.
  { name: 'bufferLength', fn: (args, interp) => {
    const pbuf = interp.force(args[0]);
    if (!(pbuf instanceof PfunBuffer)) throw new Error("bufferLength: argument must be a Buffer.");
    return BigInt(pbuf.pos);
  }},
];
