// src/iolib.ts
// I/O library — print, println, readChar, readln.
// Registered separately from the core stdlib so the I/O layer can be
// swapped or suppressed (e.g. in test environments).

import { RegistryFunction, PfunChar, StdinBuffer } from './interpreter';

// Singleton stdin buffer — shared across readChar and readln
const stdinBuffer = new StdinBuffer();

export const iolibFunctions: RegistryFunction[] = [

  // ─── Output ───────────────────────────────────────────────────────────────

  { name: 'print', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'print': side effects are not allowed in pure functions.");
    const val = interp.force(args[0]);
    process.stdout.write(interp.stringify(val));
    return val;
  }},

  { name: 'println', fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'println': side effects are not allowed in pure functions.");
    const val = interp.force(args[0]);
    console.log(interp.stringify(val));
    return val;
  }},

  // ─── Input ────────────────────────────────────────────────────────────────

  { name: 'readChar', fn: (_args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'readChar': side effects are not allowed in pure functions.");
    const c = stdinBuffer.readChar();
    if (c === null) return { __type: 'None', __union: 'Option' };
    return { __type: 'Some', __union: 'Option', value: new PfunChar(c) };
  }},

  { name: 'readln', fn: (_args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'readln': side effects are not allowed in pure functions.");
    const line = stdinBuffer.readLine();
    if (line === null) return { __type: 'None', __union: 'Option' };
    return { __type: 'Some', __union: 'Option', value: line };
  }},
];
