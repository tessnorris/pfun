// src/test/integration/repl.test.ts
//
// The REPL (runRepl in main.ts) is a separate pipeline from runFile, with
// its own four checkProcedureUsage/checkTypes wiring points
// (loadReplFile's fail-fast loop, evalEntryImmediately, and flushQueue —
// see main.ts). It reads from a real readline interface attached to real
// process.stdin/stdout, which is too stateful to fake convincingly
// in-process the way runFile.test.ts fakes a single synchronous
// fs.readSync(0, ...) call. So unlike runFile.test.ts, every test here
// spawns the real compiled CLI as a child process with piped stdin —
// exactly how a real user's terminal session works, and exactly how this
// wiring was manually smoke-tested while it was being built.
//
// Requires `npm run build` to have been run first (dist/main.js must
// exist) — see spawnPfun's error message if it's missing.

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawnSync } from 'child_process';

/**
 * Locates $proj_root/examples — see the matching helper (and its longer
 * explanation) in runFile.test.ts.
 */
function findPfFilesDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const examplesDir = path.join(dir, 'examples');
    if (fs.existsSync(path.join(examplesDir, 'example.pf'))) return examplesDir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate $proj_root/examples/example.pf by walking up from ${__dirname}. ` +
    `If the project layout has changed again, update findPfFilesDir() in this file.`
  );
}

const PROJECT_PF_FILES = findPfFilesDir();
const PROJECT_ROOT = path.dirname(PROJECT_PF_FILES);

function spawnPfun(args: string[], stdin: string, cwd: string = PROJECT_PF_FILES): { stdout: string; stderr: string; exitCode: number | null } {
  const distMain = path.join(PROJECT_ROOT, 'dist', 'main.js');
  if (!fs.existsSync(distMain)) {
    throw new Error(
      `${distMain} not found — run \`npm run build\` (or \`npx tsc -p tsconfig.json --outDir dist\`) before running integration tests that spawn the real CLI.`
    );
  }
  const result = spawnSync('node', [distMain, ...args], {
    cwd,
    input: stdin,
    encoding: 'utf-8',
    timeout: 15000,
  });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: result.status };
}

describe('REPL (-i) — real compiled CLI through the actual production pipeline', () => {
  it('a cross-entry session resolves correctly (checkTypes per-entry isolation does not false-positive on an unbound name)', () => {
    // `x` is unbound from the perspective of the SECOND entry's own,
    // independent checkTypes() call (each entry is type-checked in
    // isolation — see flushQueue in main.ts) — this must resolve to a
    // harmless fresh type variable, not a spurious type error, or every
    // multi-line REPL session would break.
    const result = spawnPfun(['-i'], 'let x = 5;\nx + 1?\n');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('6');
    expect(result.stderr).toBe('');
  });

  it('a genuine type error typed live is caught and reported, not silently accepted', () => {
    const result = spawnPfun(['-i'], 'let xs = [1, "x"];\n?\n');
    expect(result.stderr).toContain('[TypeCheck]');
    expect(result.stderr).toContain('Cannot unify Str with Int');
  });

  it('byte arithmetic does not false-positive in the live REPL (regression)', () => {
    const result = spawnPfun(['-i'], 'let y = 100b + 55b;\ny?\n');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('155');
    expect(result.stdout).not.toContain('[TypeCheck]');
  });

  it('pre-loading a well-typed file (pfun -i file.pf) succeeds with no errors', () => {
    const result = spawnPfun(['-i', 'mathutils.pf'], ':quit\n');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('[TypeCheck]');
    expect(result.stdout).not.toContain('[Purity]');
  });

  it('pre-loading a file with a genuine type error is caught before the interactive prompt starts (exit 1)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfun-repl-integration-'));
    const filePath = path.join(dir, 'badtypes.pf');
    fs.writeFileSync(filePath, 'let xs = [1, "x"];\n', 'utf-8');
    const result = spawnPfun(['-i', filePath], '');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('[TypeCheck]');
  });

  describe('Stage 3: REPL preload routing (a preloaded file is checked via checkProgram, including everything it imports)', () => {
    it('a preloaded file that imports another file resolves and checks that import cleanly — relative to process.cwd(), matching how evaluation itself resolves it (NOT relative to the preloaded file\'s own directory)', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfun-repl-integration-'));
      fs.writeFileSync(path.join(dir, 'lib.pf'), 'export function double(x) {\n  return x * 2;\n}\n', 'utf-8');
      fs.writeFileSync(
        path.join(dir, 'entry.pf'),
        'import { double } from "./lib";\nlet a = double(5);\na?\n',
        'utf-8'
      );
      const result = spawnPfun(['-i', 'entry.pf'], ':quit\n', dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('10');
      expect(result.stderr).toBe('');
    });

    it('a purity violation inside an IMPORTED file is caught up front, before the REPL starts — previously invisible, since the old per-entry, no-resolver check never even looked at imported files', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfun-repl-integration-'));
      fs.writeFileSync(
        path.join(dir, 'lib.pf'),
        'export proc sideEffect(x) {\n  println(x);\n}\nfunction leaky() {\n  let g = sideEffect;\n  return 1;\n}\n',
        'utf-8'
      );
      fs.writeFileSync(
        path.join(dir, 'entry.pf'),
        'import { sideEffect } from "./lib";\nlet a = 1;\na?\n',
        'utf-8'
      );
      const result = spawnPfun(['-i', 'entry.pf'], ':quit\n', dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('[Purity]');
      expect(result.stderr).toContain('lib.pf');
      expect(result.stderr).toContain("Functions cannot use 'sideEffect' as a value");
      // Never reached the interactive prompt at all.
      expect(result.stdout).not.toContain('> ');
    });

    it('a type error spanning two of the preloaded file\'s OWN entries (no imports involved) is now caught — the old per-entry isolated checkTypes loop checked each chunk with no shared environment, so a later entry calling an earlier entry\'s function never saw its real type', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfun-repl-integration-'));
      const filePath = path.join(dir, 'cross_entry.pf');
      fs.writeFileSync(
        filePath,
        'function double(x) {\n  return x * 2;\n}\nlet bad = double("not a number");\n',
        'utf-8'
      );
      const result = spawnPfun(['-i', filePath], '');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('[TypeCheck]');
      expect(result.stderr).toContain('Cannot unify');
    });

    it('an error reported for a line AFTER an earlier `?`-suffixed entry still points at that line\'s real position in the file — stripping the REPL print marker does not shift later positions', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfun-repl-integration-'));
      const filePath = path.join(dir, 'position_check.pf');
      fs.writeFileSync(
        filePath,
        'let a = 1;\na?\n\nfunction double(x) {\n  return x * 2;\n}\nlet bad = double("oops");\n',
        'utf-8'
      );
      const result = spawnPfun(['-i', filePath], '');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('[TypeCheck]');
      // The unification failure is on line 7 of the real file.
      expect(result.stderr).toContain('line 7/');
    });
  });
});
