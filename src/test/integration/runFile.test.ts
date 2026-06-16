// src/test/integration/runFile.test.ts
//
// INTENT: every bug found and fixed across this project's recent history
// (db/postgresql and db/mariadb never registered in registerBuiltinModules;
// checkTypes built and tested but never actually called from main.ts; the
// ModuleLoader.load loading-set leak) was INVISIBLE to the existing unit
// tests, because those tests each construct their own hand-rolled
// Interpreter/ModuleLoader/environment rather than going through the real
// production entry point. Each library/pass was correct in isolation; the
// WIRING between them and main.ts is what regressed, repeatedly.
//
// This file closes that gap by calling main.ts's actual exported runFile()
// — the literal function the real CLI invokes — against real, complete .pf
// fixture files, asserting on exact captured stdout/stderr and exit code.
// A regression in any of: registerBuiltinModules, the checkProcedureUsage/
// checkTypes wiring, their ORDER, or the interpreter's module-loading path,
// should show up here even if every individual library/pass's own unit
// tests still pass.
//
// runFile() calls process.exit(1) directly on its error paths and is not
// designed to return an exit code. Most fixtures here call the real
// runFile() in-process, spying on process.exit/console.log/console.error
// to capture results instead of letting them touch the real process or
// kill the test worker. example.pf is the one exception — see the comment
// on that test for why it spawns the real compiled CLI as a child process
// instead.

// runFile is imported from main.ts below, which transitively imports the
// real dblibPostgresql.ts/dblibMariadb.ts (and therefore the real `pg`/
// `mysql2` packages) via registerBuiltinModules. None of the tests in this
// file actually call dbConnect/dbQuery, but without mocking these here,
// running this file in the same Jest worker as dblibPostgresql.test.ts/
// dblibMariadb.test.ts (which mock `pg`/`mysql2` themselves) creates a
// conflicting module identity for the whole worker — those files'
// own tests then sporadically attempt a REAL network connection and fail
// with ECONNREFUSED instead of using their mock. This exact issue, and
// this exact fix, was already needed once for mainModuleRegistration.test.ts
// (see that file's header comment) for the same underlying reason.
jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn(() => Promise.resolve()),
    query: jest.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
    end: jest.fn(() => Promise.resolve()),
  })),
}), { virtual: true });

jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn(() => Promise.resolve({
    execute: jest.fn(() => Promise.resolve([[], []])),
    end: jest.fn(() => Promise.resolve()),
  })),
}), { virtual: true });

import * as path from 'path';
import { runFile } from '../../main';

const FIXTURES = path.join(__dirname, 'fixtures');
const PROJECT_PF_FILES = findPfFilesDir();

/**
 * Locates $proj_root/examples — the directory containing the real .pf
 * fixture files (example.pf, mathutils.pf, etc.) — by walking up from this
 * test file's directory until an examples/example.pf is found. Walking up
 * dynamically (rather than a fixed `path.join(__dirname, '..', '..', '..')`)
 * avoids needing to know or maintain this test file's exact depth relative
 * to the project root.
 */
function findPfFilesDir(): string {
  const fs = require('fs');
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const examplesDir = path.join(dir, 'examples');
    if (fs.existsSync(path.join(examplesDir, 'example.pf'))) return examplesDir;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  throw new Error(
    `Could not locate $proj_root/examples/example.pf by walking up from ${__dirname}. ` +
    `If the project layout has changed again, update findPfFilesDir() in this file.`
  );
}

/**
 * Same idea, but for the dist/main.js build artifact — used by spawnPfun
 * below to find the compiled CLI regardless of this test file's depth.
 */
function findDistMain(): string {
  const fs = require('fs');
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'dist', 'main.js');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate dist/main.js by walking up from ${__dirname} — run \`npm run build\` ` +
    `(or \`npx tsc -p tsconfig.json --outDir dist\`) before running integration tests that spawn the real CLI.`
  );
}

/**
 * Calls the real runFile() and captures everything it would have printed
 * or exited with, instead of letting it touch the real process. Only
 * suitable for fixtures that don't read stdin and don't depend on
 * `instanceof Error` surviving Jest's module graph (see spawnPfun for the
 * fixture that needs both).
 */
async function runFileCaptured(
  filePath: string
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode: number | null = null;

  const logSpy = jest.spyOn(console, 'log').mockImplementation((...args: any[]) => {
    stdout.push(args.map(String).join(' '));
  });
  const errSpy = jest.spyOn(console, 'error').mockImplementation((...args: any[]) => {
    stderr.push(args.map(String).join(' '));
  });
  // runFile calls process.exit(1) directly on its error paths. Throwing a
  // sentinel from the mock lets execution actually stop at that point
  // (matching what process.exit would do), without killing the test
  // worker. The exit code is captured before throwing.
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    throw new ProcessExitSentinel();
  }) as any);

  try {
    await runFile(filePath);
  } catch (e) {
    if (!(e instanceof ProcessExitSentinel)) throw e;
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode };
}

class ProcessExitSentinel extends Error {}

/**
 * Runs the real, compiled pfun CLI as an actual child process — single
 * realm, real stdin, no Jest/ts-jest module-graph quirks. Requires
 * `npm run build` (or an equivalent tsc invocation producing dist/main.js
 * at the project root) to have been run first; if dist/main.js is
 * missing, these tests fail with a clear message rather than a confusing
 * ENOENT.
 */
function spawnPfun(
  args: string[],
  opts: { cwd: string; stdin?: string }
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const { spawnSync } = require('child_process');
  const distMain = findDistMain();
  const result = spawnSync('node', [distMain, ...args], {
    cwd: opts.cwd,
    input: opts.stdin,
    encoding: 'utf-8',
    timeout: 15000,
  });
  return Promise.resolve({
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status,
  });
}

describe('runFile — real .pf files through the actual production pipeline', () => {
  it('mathutils.pf: a pure module with no top-level output runs cleanly (exit 0)', async () => {
    const result = await runFileCaptured(path.join(PROJECT_PF_FILES, 'mathutils.pf'));
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBeNull(); // success path never calls process.exit
  });

  // example.pf is run via the REAL compiled CLI as a spawned child process,
  // not via in-process runFile(), for two reasons: (1) it reads from
  // stdin, which StdinBuffer satisfies via a synchronous fs.readSync(0,
  // ...) — fine to fake for fd 0 specifically inside Jest, but (2) doing
  // so surfaced a genuine ts-jest/Jest module-realm quirk unrelated to
  // production correctness: a thrown Node fs Error's `instanceof Error`
  // can be FALSE inside ts-jest's module graph even though
  // `constructor.name` is 'Error', which broke an unrelated assertion deep
  // in example.pf's file-IO section (filelib.ts's nodeErrMsg helper relies
  // on `e instanceof Error`). Spawning the actual compiled CLI as a real,
  // single-realm `node` process — exactly how a real user runs it — avoids
  // this entirely and is the more faithful test for this fixture anyway.
  it('example.pf via the real compiled CLI: full output matches the known-correct baseline exactly, character for character', async () => {
    const result = await spawnPfun(['example.pf'], { cwd: PROJECT_PF_FILES, stdin: 'TestUser\n' });
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    // This is the exact, full stdout of example.pf as captured from the
    // real CLI and verified against the project's existing baseline. If
    // example.pf's intentional behavior ever changes, this fixture file
    // must be updated deliberately, by re-running the real CLI and
    // re-capturing — never loosened into a partial/fuzzy match.
    expect(result.stdout.replace(/\n$/, '')).toBe(EXAMPLE_PF_EXPECTED_STDOUT);
  });

  it('a lexical error is caught before any other check runs (exit 1, [Lexical])', async () => {
    const result = await runFileCaptured(path.join(FIXTURES, 'lex_error.pf'));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('[Lexical]');
    expect(result.stdout).toBe('');
  });

  it('a procedure-purity violation is caught before type checking runs (exit 1, [Purity])', async () => {
    const result = await runFileCaptured(path.join(FIXTURES, 'purity_violation.pf'));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('[Purity]');
    expect(result.stdout).toBe('');
  });

  it('a genuine type error is caught before interpretation runs (exit 1, [TypeCheck])', async () => {
    const result = await runFileCaptured(path.join(FIXTURES, 'type_error.pf'));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('[TypeCheck]');
    expect(result.stdout).toBe('');
  });
});

// Captured verbatim from `node dist/main.js example.pf` with stdin
// "TestUser\n". See this file's header comment for how to safely update
// this if example.pf's intentional behavior changes.
const EXAMPLE_PF_EXPECTED_STDOUT = require('fs').readFileSync(
  path.join(__dirname, 'fixtures', 'example_expected_stdout.txt'),
  'utf-8'
).replace(/\n$/, '');
