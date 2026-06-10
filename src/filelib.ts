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
import { RegistryFunction, RegistryType, PfunChar } from './interpreter';

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
];

// ─── Registry Functions ───────────────────────────────────────────────────────

export const filelibFunctions: RegistryFunction[] = [

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
];
