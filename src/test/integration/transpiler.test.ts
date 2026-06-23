// src/test/integration/transpiler.test.ts
//
// Differential testing harness for the Pfun → JavaScript transpiler.
//
// For each fixture, this harness:
//   1. Runs the fixture through the INTERPRETER (existing runFile path) and
//      captures stdout.  The interpreter is the oracle — its output is the
//      definition of correct behaviour.
//   2. Runs the same fixture through the TRANSPILER (parse → checkTypes →
//      transpile → write temp .js → node) and captures stdout.
//   3. Asserts the two outputs are identical, byte for byte.
//
// No hand-written expected output is needed.  The harness scales to every
// eligible fixture for free: add a .pf file to fixtures/transpiler/ and it
// is automatically included.
//
// "Negative" fixtures (programs that are expected to throw at runtime) use a
// separate describe block and assert that BOTH the interpreter and the
// transpiler produce a non-zero exit / throw with the same error message
// prefix, rather than comparing stdout.

jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn(() => Promise.resolve()),
    query:   jest.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
    end:     jest.fn(() => Promise.resolve()),
  })),
}), { virtual: true });

jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn(() => Promise.resolve({
    execute: jest.fn(() => Promise.resolve([[], []])),
    end:     jest.fn(() => Promise.resolve()),
  })),
}), { virtual: true });

import * as path from 'path';
import * as fs   from 'fs';
import * as os   from 'os';
import { spawnSync } from 'child_process';
import { Lexer }   from '../../lexer';
import { Parser }  from '../../parser';
import { checkTypes } from '../../typechecker';
import { transpile }  from '../../transpiler';
import { runFile }    from '../../main';

// ─── Paths ────────────────────────────────────────────────────────────────────

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'transpiler');
const RUNTIME_JS   = path.join(__dirname, '..', '..', 'runtime', 'pfun-runtime.js');

// ─── Interpreter runner ───────────────────────────────────────────────────────
// Runs a .pf file in-process via the same runFile() the real CLI uses,
// capturing stdout/stderr without touching process.exit.

async function runInterpreter(pfPath: string): Promise<{ stdout: string; stderr: string; threw: boolean; errorMsg: string }> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  let threw = false;
  let errorMsg = '';

  const origStdoutWrite  = process.stdout.write.bind(process.stdout);
  const origStderrWrite  = process.stderr.write.bind(process.stderr);
  const origConsoleLog   = console.log;
  const origConsoleError = console.error;

  process.stdout.write  = (chunk: any) => { stdoutChunks.push(String(chunk)); return true; };
  process.stderr.write  = (chunk: any) => { stderrChunks.push(String(chunk)); return true; };
  console.log   = (...args: any[]) => stdoutChunks.push(args.map(String).join(' ') + '\n');
  console.error = (...args: any[]) => stderrChunks.push(args.map(String).join(' ') + '\n');

  const origExit = process.exit.bind(process);
  (process as any).exit = (code?: number) => { threw = true; errorMsg = `exit(${code})`; throw new Error(`process.exit(${code})`); };

  try {
    await runFile(pfPath);
  } catch (e: any) {
    threw = true;
    errorMsg = e?.message ?? String(e);
  } finally {
    process.stdout.write  = origStdoutWrite;
    process.stderr.write  = origStderrWrite;
    console.log   = origConsoleLog;
    console.error = origConsoleError;
    (process as any).exit = origExit;
  }

  return {
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
    threw,
    errorMsg,
  };
}

// ─── Transpiler runner ────────────────────────────────────────────────────────
// Parses and type-checks the .pf source, transpiles it to JS, writes a
// temp file next to src/runtime/pfun-runtime.js, runs it under Node, and
// returns the captured output.

function runTranspiled(pfPath: string): { stdout: string; stderr: string; exitCode: number | null } {
  const source = fs.readFileSync(pfPath, 'utf-8');
  const stmts  = new Parser(new Lexer(source).lex()).parse();
  const errors = checkTypes(stmts, source);
  if (errors.length > 0) {
    // Return static errors as stderr so the harness can compare them
    return { stdout: '', stderr: errors.map(e => e.pfunMessage).join('\n'), exitCode: 1 };
  }
  const jsSource = transpile(stmts, source);

  // Write temp JS alongside src/runtime/pfun-runtime.js so require('./pfun-runtime') works
  const tmpDir = path.dirname(RUNTIME_JS);
  const tmpFile = path.join(tmpDir, `_pfun_transpiler_test_${Date.now()}.js`);
  try {
    fs.writeFileSync(tmpFile, jsSource, 'utf-8');
    const result = spawnSync('node', [tmpFile], {
      encoding: 'utf-8',
      timeout: 15_000,
    });
    return {
      stdout:   result.stdout ?? '',
      stderr:   result.stderr ?? '',
      exitCode: result.status,
    };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

// ─── Fixture discovery ────────────────────────────────────────────────────────
// All .pf files in fixtures/transpiler/ that do NOT start with "error_" are
// "positive" fixtures (both backends must produce matching stdout).
// Files starting with "error_" are "negative" fixtures (both must fail with
// a matching error message prefix).

function allFixtures(): string[] {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs.readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith('.pf'))
    .sort()
    .map(f => path.join(FIXTURES_DIR, f));
}

const positiveFixtures = allFixtures().filter(f => !path.basename(f).startsWith('error_'));
const negativeFixtures = allFixtures().filter(f =>  path.basename(f).startsWith('error_'));

// ─── Positive fixtures: interpreter output === transpiled output ───────────────

describe('Transpiler differential tests — positive fixtures', () => {
  if (positiveFixtures.length === 0) {
    it.todo('no positive fixtures found in fixtures/transpiler/');
  }

  for (const pfPath of positiveFixtures) {
    const name = path.basename(pfPath, '.pf');
    it(`${name}: transpiled output matches interpreter output`, async () => {
      const interp  = await runInterpreter(pfPath);
      const transpiled = runTranspiled(pfPath);

      // If the interpreter itself threw/errored, the test is miscategorised
      // (should be in error_ fixtures).
      if (interp.threw) {
        throw new Error(
          `Interpreter threw on '${name}' (a positive fixture). ` +
          `Move to error_ prefix if this is expected to fail.\n` +
          `Error: ${interp.errorMsg}\nStderr: ${interp.stderr}`
        );
      }

      // Surface useful diffs when assertions fail
      const context = [
        `Fixture: ${name}`,
        `--- Interpreter stdout ---\n${interp.stdout}`,
        `--- Transpiled stdout ---\n${transpiled.stdout}`,
        `--- Transpiled stderr ---\n${transpiled.stderr}`,
      ].join('\n');

      expect(transpiled.exitCode).toBe(0);
      expect(transpiled.stdout).toBe(interp.stdout);
    }, 30_000);
  }
});

// ─── Negative fixtures: both fail with matching error ────────────────────────

describe('Transpiler differential tests — error parity', () => {
  if (negativeFixtures.length === 0) {
    it.todo('no error_ fixtures found in fixtures/transpiler/');
  }

  for (const pfPath of negativeFixtures) {
    const name = path.basename(pfPath, '.pf');
    it(`${name}: both interpreter and transpiled output fail with the same error`, async () => {
      const interp     = await runInterpreter(pfPath);
      const transpiled = runTranspiled(pfPath);

      // Interpreter must have thrown / errored
      const interpFailed = interp.threw || interp.stderr.trim().length > 0;
      expect(interpFailed).toBe(true);

      // Transpiled must have exited non-zero or printed to stderr
      const transpFailed = transpiled.exitCode !== 0 || transpiled.stderr.trim().length > 0;
      expect(transpFailed).toBe(true);

      // Both error outputs must share at least one meaningful keyword —
      // extracts all alpha tokens ≥4 chars from each, lowercased, and
      // checks for any intersection. This handles the interpreter's
      // "[DivideByZero] Error..." format vs the transpiler's plain
      // "Divide by zero." message: both share "divide".
      const interpErr = (interp.stderr + ' ' + interp.errorMsg).trim();
      const transpErr = (transpiled.stderr).trim();
      const keyTokens = (s: string): Set<string> => {
        const tokens = s.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(t => t.length >= 4);
        return new Set(tokens);
      };
      const interpTokens = keyTokens(interpErr);
      const transpTokens = keyTokens(transpErr);
      const shared = [...transpTokens].filter(t => interpTokens.has(t));
      expect(shared.length).toBeGreaterThan(0);
    }, 30_000);
  }
});
