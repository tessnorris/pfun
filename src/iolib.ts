// src/iolib.ts
// I/O library — print, println, readChar, readln, scriptArgs, getEnv, envVars.
// Registered separately from the core stdlib so the I/O layer can be
// swapped or suppressed (e.g. in test environments).

import { RegistryFunction, PfunChar, StdinBuffer, PfunDict } from './interpreter';

// Singleton stdin buffer — shared across readChar and readln
const stdinBuffer = new StdinBuffer();

/** Build a Pfun dict<string,string> from a plain JS Record<string,string>. */
function dictFromRecord(rec: Record<string, string | undefined>): PfunDict {
  const map = new Map<string, any>();
  for (const [k, v] of Object.entries(rec)) {
    if (v !== undefined) map.set(`s:${k}`, v);
  }
  return new PfunDict(map);
}

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

  { name: 'flushStdout', fn: (_args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'flushStdout': side effects are not allowed in pure functions.");
    // Node's stdout is synchronous when writing to a TTY, but flush via
    // a zero-byte write to ensure any buffered output is sent before reading
    try { (process.stdout as any)._handle?.flush?.(); } catch {}
    return true;
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

  // ─── Command-line arguments & environment ──────────────────────────────────
  //
  // These read external, run-dependent process state rather than performing
  // a write — but that's still impure in the sense that matters here: a pure
  // `function` calling getEnv("HOME") would be reading a side channel outside
  // its arguments, the same category of impurity print/readln are blocked
  // for. If functional code needs an argument or environment variable, a
  // `proc` (or top-level code) should fetch it and pass it down explicitly.

  // scriptArgs() -> List<Str>
  // Arguments passed to the running script, i.e. everything after the
  // script path: `pfun script.pf foo bar` -> ["foo", "bar"].
  { name: 'scriptArgs', arity: 0, fn: (_args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'scriptArgs': side effects are not allowed in pure functions.");
    return [...interp.scriptArgs];
  }},

  // getEnv(name) -> Option<Str>
  // Looks up a single environment variable. Returns None if it isn't set.
  { name: 'getEnv', arity: 1, fn: (args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'getEnv': side effects are not allowed in pure functions.");
    const name = interp.force(args[0]);
    if (typeof name !== 'string') throw new Error("getEnv() requires a string argument.");
    const value = process.env[name];
    if (value === undefined) return { __type: 'None', __union: 'Option' };
    return { __type: 'Some', __union: 'Option', value };
  }},

  // envVars() -> Dict<Str, Str>
  // All environment variables visible to the process, as a dict. Variables
  // with no value (which shouldn't normally occur) are omitted rather than
  // represented as nil, keeping the dict's value type a plain Str.
  { name: 'envVars', arity: 0, fn: (_args, interp) => {
    if (interp.inPureContext) throw new Error("Functions cannot use 'envVars': side effects are not allowed in pure functions.");
    return dictFromRecord(process.env);
  }},
];
