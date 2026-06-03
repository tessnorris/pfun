// src/filelib.ts
// File I/O library for Pfun.
// Register with: loader.registerBuiltin('file', iolibFunctions)
// Use with:      import * from "file";
//
// FileHandle is a union type (ReadHandle | WriteHandle).
// The fd is stored on the runtime object but not accessible from Pfun code.
//
// Convenience functions (readFile, writeFile) manage handles internally.
// All other functions require an explicit handle from fileOpen/fileClose.

import * as fs from 'fs';
import { RegistryFunction, RegistryType, PfunChar } from './interpreter';

// ─── FileHandle runtime objects ───────────────────────────────────────────────
// These carry __type/__union for the Pfun type system, plus a hidden fd field.

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
// Reads one UTF-8 codepoint from a file descriptor synchronously.

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

// ─── Option helpers ───────────────────────────────────────────────────────────

const some = (value: any) => ({ __type: 'Some', __union: 'Option', value });
const none = { __type: 'None', __union: 'Option' };

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
];

// ─── Registry Functions ───────────────────────────────────────────────────────

export const filelibFunctions: RegistryFunction[] = [

  // fileOpen(path, mode) — mode is "r" or "w"
  // Returns Some { ReadHandle } or Some { WriteHandle }, or None on failure.
  { name: 'fileOpen', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'fileOpen': side effects not allowed in pure functions.");
    const filePath = interp.force(args[0]);
    const mode     = interp.force(args[1]);
    if (typeof filePath !== 'string') throw new Error("fileOpen: path must be a string.");
    if (typeof mode !== 'string' || (mode !== 'r' && mode !== 'w'))
      throw new Error("fileOpen: mode must be \"r\" or \"w\".");
    try {
      const fd = fs.openSync(filePath, mode);
      return some(mode === 'r' ? makeReadHandle(fd) : makeWriteHandle(fd));
    } catch { return none; }
  }},

  // fileClose(handle) — closes the file descriptor.
  { name: 'fileClose', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'fileClose': side effects not allowed in pure functions.");
    const handle = interp.force(args[0]);
    try { fs.closeSync(getFd(handle)); } catch {}
    return none;
  }},

  // readChar(handle) — reads one Unicode char from a ReadHandle.
  // Returns Some { char } or None at EOF.
  { name: 'readChar', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'readChar': side effects not allowed in pure functions.");
    const handle = interp.force(args[0]);
    if (handle.__type !== 'ReadHandle') throw new Error("readChar: requires a ReadHandle.");
    const c = readCharFromFd(getFd(handle));
    return c === null ? none : some(new PfunChar(c));
  }},

  // readLine(handle) — reads one line from a ReadHandle (newline consumed, not included).
  // Returns Some { string } or None at EOF.
  { name: 'readLine', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'readLine': side effects not allowed in pure functions.");
    const handle = interp.force(args[0]);
    if (handle.__type !== 'ReadHandle') throw new Error("readLine: requires a ReadHandle.");
    const line = readLineFromFd(getFd(handle));
    return line === null ? none : some(line);
  }},

  // readFile(path) — opens, reads entire file as string, closes.
  // Returns Some { string } or None on failure.
  { name: 'readFile', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'readFile': side effects not allowed in pure functions.");
    const filePath = interp.force(args[0]);
    if (typeof filePath !== 'string') throw new Error("readFile: path must be a string.");
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return some(content);
    } catch { return none; }
  }},

  // writeChar(handle, char) — writes one char to a WriteHandle.
  { name: 'writeChar', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'writeChar': side effects not allowed in pure functions.");
    const handle = interp.force(args[0]);
    const c      = interp.force(args[1]);
    if (handle.__type !== 'WriteHandle') throw new Error("writeChar: requires a WriteHandle.");
    if (!(c instanceof PfunChar)) throw new Error("writeChar: second argument must be a char.");
    try {
      const buf = Buffer.from(c.value, 'utf8');
      fs.writeSync(getFd(handle), buf);
      return some(BigInt(buf.length));
    } catch { return none; }
  }},

  // writeLine(handle, string) — writes a string followed by a newline to a WriteHandle.
  { name: 'writeLine', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'writeLine': side effects not allowed in pure functions.");
    const handle = interp.force(args[0]);
    const str    = interp.force(args[1]);
    if (handle.__type !== 'WriteHandle') throw new Error("writeLine: requires a WriteHandle.");
    if (typeof str !== 'string') throw new Error("writeLine: second argument must be a string.");
    try {
      const buf = Buffer.from(str + '\n', 'utf8');
      fs.writeSync(getFd(handle), buf);
      return some(BigInt(buf.length));
    } catch { return none; }
  }},

  // writeFile(path, content) — opens, writes entire string, closes.
  // Returns Some { n } (chars written) or None on failure.
  { name: 'writeFile', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'writeFile': side effects not allowed in pure functions.");
    const filePath = interp.force(args[0]);
    const content  = interp.force(args[1]);
    if (typeof filePath !== 'string') throw new Error("writeFile: path must be a string.");
    if (typeof content  !== 'string') throw new Error("writeFile: content must be a string.");
    try {
      fs.writeFileSync(filePath, content, 'utf8');
      return some(BigInt(content.length));
    } catch { return none; }
  }},
];
