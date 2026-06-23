'use strict';
// pfun-file.js — runtime support for `import * from "file"` in transpiled Pfun.
//
// Direct port of filelib.ts. Registers FileHandle/FileMode/Result/ReadResult/
// BufferMode union types, then exports all file I/O functions.
//
// Note: PfunBuffer construction/manipulation functions (makeBuffer, appendBuffer,
// appendChar, appendString, makeStringBuffer, bufferToBytes, bufferToString,
// bufferLength) now live in pfun-runtime.js as core mutable structures.
// This module handles the handle-bound I/O: readBuffer, writeBuffer, and all
// readChar/readLine/readByte/readBytes/writeByte/writeBytes/writeChar/writeLine
// operations that require a file descriptor.

const fs  = require('fs');
const { PfunChar, PfunByte, PfunBuffer, $registerType } = require('./pfun-runtime');

// ─── Register union types ─────────────────────────────────────────────────────
$registerType('ReadHandle',  [], 'FileHandle');
$registerType('WriteHandle', [], 'FileHandle');
$registerType('Read',        [], 'FileMode');
$registerType('Write',       [], 'FileMode');
$registerType('Append',      [], 'FileMode');
$registerType('Ok',          ['value'],   'Result');
$registerType('Err',         ['message'], 'Result');
$registerType('Eof',         [],          'ReadResult');
$registerType('ByteMode',    [],          'BufferMode');
$registerType('CharMode',    [],          'BufferMode');

// ─── Handle helpers ───────────────────────────────────────────────────────────
function makeReadHandle(fd)  { return { __type: 'ReadHandle',  __union: 'FileHandle', __fd: fd }; }
function makeWriteHandle(fd) { return { __type: 'WriteHandle', __union: 'FileHandle', __fd: fd }; }
function getFd(h) {
  if (typeof h?.__fd !== 'number') throw new Error('Expected a FileHandle.');
  return h.__fd;
}

// ─── Result / ReadResult helpers ──────────────────────────────────────────────
const ok   = v => ({ __type: 'Ok',  __union: 'Result',     value:   v });
const err  = m => ({ __type: 'Err', __union: 'Result',     message: m });
const okR  = v => ({ __type: 'Ok',  __union: 'ReadResult', value:   v });
const eofR =      { __type: 'Eof',  __union: 'ReadResult' };
const errR = m => ({ __type: 'Err', __union: 'ReadResult', message: m });
const nodeErrMsg = e => e instanceof Error ? e.message : String(e);

// ─── Low-level fd readers ─────────────────────────────────────────────────────
function readByteFromFd(fd) {
  const buf = Buffer.alloc(1);
  try { const n = fs.readSync(fd, buf, 0, 1, null); return n === 0 ? null : buf[0]; }
  catch { return null; }
}

function readCharFromFd(fd) {
  const b0 = readByteFromFd(fd);
  if (b0 === null) return null;
  let bytes;
  if      (b0 < 0x80) { bytes = [b0]; }
  else if (b0 < 0xE0) { const b1 = readByteFromFd(fd); if (b1 === null) return String.fromCharCode(b0); bytes = [b0, b1]; }
  else if (b0 < 0xF0) { const b1 = readByteFromFd(fd); if (b1 === null) return String.fromCharCode(b0); const b2 = readByteFromFd(fd); if (b2 === null) return String.fromCharCode(b0); bytes = [b0, b1, b2]; }
  else                { const b1 = readByteFromFd(fd); if (b1 === null) return String.fromCharCode(b0); const b2 = readByteFromFd(fd); if (b2 === null) return String.fromCharCode(b0); const b3 = readByteFromFd(fd); if (b3 === null) return String.fromCharCode(b0); bytes = [b0, b1, b2, b3]; }
  return Buffer.from(bytes).toString('utf8') || null;
}

function readLineFromFd(fd) {
  let line = '', gotAny = false;
  while (true) {
    const c = readCharFromFd(fd);
    if (c === null) return gotAny ? line : null;
    gotAny = true;
    if (c === '\n') return line;
    if (c !== '\r') line += c;
  }
}

// ─── PfunBuffer class ─────────────────────────────────────────────────────────
// Mutable byte/char buffer for readBuffer/writeBuffer.
// ─── Exported functions ───────────────────────────────────────────────────────

function fileExists(p) {
  if (typeof p !== 'string') throw new Error('fileExists: path must be a string.');
  return fs.existsSync(p);
}

function removeFile(p) {
  if (typeof p !== 'string') throw new Error('removeFile: path must be a string.');
  try { fs.unlinkSync(p); return ok(0n); } catch (e) { return err(nodeErrMsg(e)); }
}

function touchFile(p) {
  if (typeof p !== 'string') throw new Error('touchFile: path must be a string.');
  try {
    if (fs.existsSync(p)) { const now = new Date(); fs.utimesSync(p, now, now); }
    else fs.closeSync(fs.openSync(p, 'w'));
    return ok(0n);
  } catch (e) { return err(nodeErrMsg(e)); }
}

function readFile(p) {
  if (typeof p !== 'string') throw new Error('readFile: path must be a string.');
  try { return ok(fs.readFileSync(p, 'utf8')); } catch (e) { return err(nodeErrMsg(e)); }
}

function writeFile(p, content) {
  if (typeof p !== 'string') throw new Error('writeFile: path must be a string.');
  if (typeof content !== 'string') throw new Error('writeFile: content must be a string.');
  try { fs.writeFileSync(p, content, 'utf8'); return ok(BigInt(content.length)); } catch (e) { return err(nodeErrMsg(e)); }
}

function fileOpen(p, mode) {
  if (typeof p !== 'string') throw new Error('fileOpen: path must be a string.');
  if (!mode || !['Read','Write','Append'].includes(mode.__type))
    throw new Error('fileOpen: mode must be Read, Write, or Append.');
  const flag = mode.__type === 'Read' ? 'r' : mode.__type === 'Write' ? 'w' : 'a';
  try {
    const fd = fs.openSync(p, flag);
    return ok(flag === 'r' ? makeReadHandle(fd) : makeWriteHandle(fd));
  } catch (e) { return err(nodeErrMsg(e)); }
}

function fileClose(handle) {
  try { fs.closeSync(getFd(handle)); return ok(0n); } catch (e) { return err(nodeErrMsg(e)); }
}

function readChar(handle) {
  if (handle.__type !== 'ReadHandle') throw new Error('readChar: requires a ReadHandle.');
  try {
    const c = readCharFromFd(getFd(handle));
    return c === null ? eofR : okR(new PfunChar(c));
  } catch (e) { return errR(nodeErrMsg(e)); }
}

function readLine(handle) {
  if (handle.__type !== 'ReadHandle') throw new Error('readLine: requires a ReadHandle.');
  try {
    const line = readLineFromFd(getFd(handle));
    return line === null ? eofR : okR(line);
  } catch (e) { return errR(nodeErrMsg(e)); }
}

function writeChar(handle, c) {
  if (handle.__type !== 'WriteHandle') throw new Error('writeChar: requires a WriteHandle.');
  if (!(c instanceof PfunChar)) throw new Error('writeChar: second argument must be a char.');
  try { const buf = Buffer.from(c.value, 'utf8'); fs.writeSync(getFd(handle), buf); return ok(1n); }
  catch (e) { return err(nodeErrMsg(e)); }
}

function writeLine(handle, s) {
  if (handle.__type !== 'WriteHandle') throw new Error('writeLine: requires a WriteHandle.');
  if (typeof s !== 'string') throw new Error('writeLine: second argument must be a string.');
  try { const buf = Buffer.from(s + '\n', 'utf8'); fs.writeSync(getFd(handle), buf); return ok(BigInt(buf.length)); }
  catch (e) { return err(nodeErrMsg(e)); }
}

function readByte(handle) {
  if (handle.__type !== 'ReadHandle') throw new Error('readByte: requires a ReadHandle.');
  try {
    const b = readByteFromFd(getFd(handle));
    return b === null ? eofR : okR(new PfunByte(b));
  } catch (e) { return errR(nodeErrMsg(e)); }
}

function writeByte(handle, b) {
  if (handle.__type !== 'WriteHandle') throw new Error('writeByte: requires a WriteHandle.');
  if (!(b instanceof PfunByte)) throw new Error('writeByte: second argument must be a Byte.');
  try { fs.writeSync(getFd(handle), Buffer.from([b.value])); return ok(1n); }
  catch (e) { return err(nodeErrMsg(e)); }
}

function readBytes(handle, n) {
  if (handle.__type !== 'ReadHandle') throw new Error('readBytes: requires a ReadHandle.');
  if (typeof n !== 'bigint' || n < 0n) throw new Error('readBytes: count must be a non-negative Int.');
  const count = Number(n);
  try {
    const buf = Buffer.alloc(count);
    const read = fs.readSync(getFd(handle), buf, 0, count, null);
    if (read === 0) return eofR;
    return okR(Array.from({ length: read }, (_, i) => new PfunByte(buf[i])));
  } catch (e) { return errR(nodeErrMsg(e)); }
}

function writeBytes(handle, bytes) {
  if (handle.__type !== 'WriteHandle') throw new Error('writeBytes: requires a WriteHandle.');
  if (!Array.isArray(bytes) || !bytes.every(b => b instanceof PfunByte))
    throw new Error('writeBytes: second argument must be a List<Byte>.');
  try {
    const buf = Buffer.from(bytes.map(b => b.value));
    fs.writeSync(getFd(handle), buf);
    return ok(BigInt(buf.length));
  } catch (e) { return err(nodeErrMsg(e)); }
}

function readBuffer(handle, n, mode) {
  if (handle.__type !== 'ReadHandle') throw new Error('readBuffer: requires a ReadHandle.');
  if (typeof n !== 'bigint' || n < 0n) throw new Error('readBuffer: count must be a non-negative Int.');
  if (!mode || (mode.__type !== 'ByteMode' && mode.__type !== 'CharMode'))
    throw new Error('readBuffer: mode must be ByteMode or CharMode.');
  const count = Number(n);
  const bufMode = mode.__type === 'ByteMode' ? 'byte' : 'char';
  const pbuf = new PfunBuffer(bufMode, Math.max(count * 4, 16));
  try {
    if (bufMode === 'byte') {
      const read = fs.readSync(getFd(handle), pbuf.data, 0, count, null);
      pbuf.pos = read;
    } else {
      let charsRead = 0;
      while (charsRead < count) {
        const c = readCharFromFd(getFd(handle));
        if (c === null) break;
        pbuf.append(Buffer.from(c, 'utf8'));
        charsRead++;
      }
    }
    return ok(pbuf);
  } catch (e) { return err(nodeErrMsg(e)); }
}

function writeBuffer(handle, pbuf) {
  if (handle.__type !== 'WriteHandle') throw new Error('writeBuffer: requires a WriteHandle.');
  if (!(pbuf instanceof PfunBuffer)) throw new Error('writeBuffer: second argument must be a Buffer.');
  try { fs.writeSync(getFd(handle), pbuf.data, 0, pbuf.pos); return ok(BigInt(pbuf.pos)); }
  catch (e) { return err(nodeErrMsg(e)); }
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  // Path operations
  fileExists, removeFile, touchFile, readFile, writeFile,
  // Handle lifecycle
  fileOpen, fileClose,
  // Char / string I/O
  readChar, readLine, writeChar, writeLine,
  // Byte I/O
  readByte, writeByte, readBytes, writeBytes,
  // Buffer I/O
  readBuffer, writeBuffer,
  // Union constructors (so match arms work in compiled code)
  Read:   { __type: 'Read',   __union: 'FileMode' },
  Write:  { __type: 'Write',  __union: 'FileMode' },
  Append: { __type: 'Append', __union: 'FileMode' },
};
