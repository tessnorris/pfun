// src/test/checkTypesWiring.test.ts
//
// Regression test for a real gap: typechecker.ts's checkTypes(stmts, source)
// is documented as "Intended for use in main.ts / the CLI pipeline" and is
// fully built and tested (see inferencer.test.ts's "checkTypes — error
// formatting" section) — but main.ts never actually called it. Static type
// errors (e.g. `let xs = [1, "x"];`) went completely undetected at compile
// time; the only way to discover them was for the interpreter to stumble
// into a runtime type mismatch somewhere downstream, if ever.
//
// Before wiring checkTypes in, three real bugs in inferencer.ts were found
// and fixed (see inferencer.test.ts's "Ground type unification" and
// "Constraint generation — binary operators" sections for the unit-level
// regression tests):
//   1. unify()'s primitive-kind switch was missing 'Byte', so ANY two Byte
//      values failed to unify with the nonsensical "Cannot unify Byte with
//      Byte" — this alone produced 58 false positives against example.pf.
//   2. cgenBinary's arithmetic operators (-, *, /, %, +) hardcoded both
//      operands to Int, with no Byte or Float awareness, contradicting the
//      interpreter's real semantics (Byte op Byte -> Byte, no mixing; Int/
//      Float mixed arithmetic promotes to Float).
//   3. FloatExpr had no case in cgenExpr's literal switch at all and fell
//      through to an unconstrained freshVar() — a silent FALSE NEGATIVE
//      that let real errors like `[1.5, "x"]` go undetected.
//
// This file tests the WIRING specifically: that checkTypes is actually
// invoked at the right points and actually blocks/surfaces errors there.
// The unit-level correctness of checkTypes/inferencer.ts itself is covered
// in inferencer.test.ts.
//
// While writing these tests, a SEPARATE real bug was found and fixed in
// ModuleLoader.load (interpreter.ts): a module that failed to load for any
// reason (lex/parse error, checkProcedureUsage, checkTypes, or
// interp.interpret() itself throwing) left its resolvedPath stuck in the
// loader's internal `loading` set forever, since the cleanup
// (`this.loading.delete(resolvedPath)`) only ran on the successful path. A
// second load attempt for that same path then incorrectly reported
// "Circular import detected" instead of re-surfacing the real error. Fixed
// with try/finally around the loading-set bookkeeping. See the dedicated
// regression tests below.
//
// Coverage map vs. the four call sites added in main.ts/interpreter.ts:
//   - ModuleLoader.load() (interpreter.ts)         -> tested directly below
//   - main.ts's runFile()                          -> NOT unit-testable here:
//     runFile calls process.exit(1) directly on error paths and is not
//     exported (exporting it would require either a process.exit mock or an
//     architecture change to make it return instead of exit, both out of
//     scope for this change). Verified manually instead via the real CLI
//     against real .pf files — see the project's manual verification notes
//     for this change: `node dist/main.js example.pf` (58 false positives
//     eliminated, byte-identical output to the pre-regression baseline) and
//     a constructed `let xs = [1, "x"];` file (correctly rejected with
//     [TypeCheck] and exit code 1).
//   - loadReplFile()'s fail-fast loop / flushQueue() (main.ts, REPL)        -> NOT
//     unit-testable here for the same reason (process.exit, not exported).
//     Verified manually via `pfun -i` for both a live-typed type error and
//     a pre-loaded file with a type error, and for cross-entry sessions
//     (`let x = 5;` then `x + 1?`) to confirm no false positive from
//     per-entry fragment isolation (checkTypes treats an unbound name as a
//     wildcard freshVar, not an error — verified directly).

import { ModuleLoader } from '../interpreter';

describe('checkTypes wiring — ModuleLoader.load()', () => {
  function makeLoader(): { loader: ModuleLoader; dir: string } {
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfun-checktypes-'));
    return { loader: new ModuleLoader(dir), dir };
  }

  function writeModule(dir: string, name: string, content: string): string {
    const path = require('path');
    const fs = require('fs');
    const filePath = path.join(dir, `${name}.pf`);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  it('loads a well-typed module without error', () => {
    const { loader, dir } = makeLoader();
    const filePath = writeModule(dir, 'good', 'export let x = 1 + 2;');
    expect(() => loader.load(filePath)).not.toThrow();
  });

  it('throws a PfunError for a module with a genuine type error', () => {
    const { loader, dir } = makeLoader();
    const filePath = writeModule(dir, 'bad', 'export let xs = [1, "x"];');
    expect(() => loader.load(filePath)).toThrow();
    try {
      loader.load(filePath);
      fail('expected load() to throw');
    } catch (e: any) {
      expect(e.pfunMessage).toMatch(/\[TypeCheck\]/);
    }
  });

  it('does not produce a false positive for byte arithmetic (regression)', () => {
    const { loader, dir } = makeLoader();
    const filePath = writeModule(dir, 'bytes', 'export let x = 100b + 55b; export let y = 0xF0b & 0x0Fb;');
    expect(() => loader.load(filePath)).not.toThrow();
  });

  it('does not produce a false positive for mixed int/float arithmetic (regression)', () => {
    const { loader, dir } = makeLoader();
    const filePath = writeModule(dir, 'floats', 'export let x = 1 - 2.5; export let y = 2.5 + 1;');
    expect(() => loader.load(filePath)).not.toThrow();
  });

  it('catches a type error in an IMPORTED module, with position pointing at the imported file', () => {
    const { loader, dir } = makeLoader();
    writeModule(dir, 'badimport', 'export let xs = [1, "x"];');
    const importerPath = writeModule(dir, 'importer', 'import { xs } from "./badimport";');
    expect(() => loader.load(importerPath)).toThrow();
    try {
      loader.load(importerPath);
      fail('expected load() to throw');
    } catch (e: any) {
      expect(e.pfunMessage).toMatch(/\[TypeCheck\]/);
      // Position should be inside badimport.pf's own line 1, not the
      // importer — confirms the error was raised while loading the
      // imported module, not misattributed to the import statement itself.
      expect(e.pfunMessage).toMatch(/line 1/);
    }
  });

  // Regression found WHILE writing the test above: a module that fails to
  // load (for ANY reason — lex/parse error, checkProcedureUsage,
  // checkTypes, or interp.interpret() itself throwing) used to leave its
  // resolvedPath stuck in the loader's internal `loading` set forever,
  // because `this.loading.delete(resolvedPath)` only ran on the
  // successful-completion path. A SECOND attempt to load that same path
  // (e.g. the test above calling load() twice to inspect the error, or a
  // REPL session retrying an import) would then incorrectly report
  // "Circular import detected" instead of re-surfacing the real error.
  // Fixed with try/finally around the loading-set bookkeeping in
  // ModuleLoader.load (interpreter.ts).
  it('re-throws the SAME real error on a second load attempt, not "Circular import detected" (regression)', () => {
    const { loader, dir } = makeLoader();
    const filePath = writeModule(dir, 'bad', 'export let xs = [1, "x"];');

    let firstMessage: string | undefined;
    try {
      loader.load(filePath);
      fail('expected first load() to throw');
    } catch (e: any) {
      firstMessage = e.message;
    }
    expect(firstMessage).toMatch(/\[TypeCheck\]/);

    let secondMessage: string | undefined;
    try {
      loader.load(filePath);
      fail('expected second load() to throw');
    } catch (e: any) {
      secondMessage = e.message;
    }
    expect(secondMessage).toMatch(/\[TypeCheck\]/);
    expect(secondMessage).not.toMatch(/Circular import/);
    expect(secondMessage).toEqual(firstMessage);
  });

  it('a module that fails to load can still be re-attempted after a lex/parse error (same regression, different error kind)', () => {
    const { loader, dir } = makeLoader();
    const filePath = writeModule(dir, 'badsyntax', 'let x = ;');

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        loader.load(filePath);
        fail(`expected attempt ${attempt} to throw`);
      } catch (e: any) {
        expect(e.message).not.toMatch(/Circular import/);
      }
    }
  });
});
