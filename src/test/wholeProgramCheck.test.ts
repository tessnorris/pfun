// src/test/wholeProgramCheck.test.ts
//
// Tests for the Stage 1 whole-program static checker (checkProgram):
// cross-module procedure-usage (purity) checking across the import graph,
// including named/namespace/star imports, missing modules, circular
// imports, and the "each file parsed exactly once" guarantee. See
// wholeProgramCheck.ts's file header for the full design.
//
// These tests use real multi-file fixtures on disk (under
// fixtures/wholeProgramCheck/) rather than in-memory strings, since the
// whole point of this pass is resolving and parsing real files across a
// real import graph — an in-memory single-AST test couldn't exercise that.

// This file imports registerBuiltinModules from main.ts, which transitively
// imports dblibPostgresql.ts/dblibMariadb.ts, which import the real 'pg'/
// 'mysql2' packages. Without mocking them here too, this file's real,
// unmocked 'pg'/'mysql2' module instances can collide with
// dblibPostgresql.test.ts's/dblibMariadb.test.ts's own jest.mock()'d
// versions of those same packages when both run in the same Jest worker —
// the established fix (see mainModuleRegistration.test.ts, which hit the
// identical issue for the identical reason) is to mock them here too,
// removing the conflicting module identity entirely.
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
import { ModuleLoader } from '../interpreter';
import { checkProgram } from '../wholeProgramCheck';
import { registerBuiltinModules } from '../main';

const FIXTURES = path.join(__dirname, 'fixtures', 'wholeProgramCheck');

function check(fixtureName: string): ReturnType<typeof checkProgram> {
  const entry  = path.join(FIXTURES, fixtureName);
  const loader = new ModuleLoader(FIXTURES);
  registerBuiltinModules(loader);
  return checkProgram(entry, loader);
}

describe('Whole-program static checker (checkProgram) — Stage 1: graph + purity', () => {

  describe('Cross-module purity violations are caught', () => {
    it('catches a proc imported by name and used as a value in a function', () => {
      const err = check('main_bad.pf');
      expect(err).not.toBeNull();
      expect(err!.pfunMessage).toContain("Functions cannot use 'sideEffect' as a value");
    });

    it('does NOT show a file-path header when the violation is in the entry file itself (no ambiguity to resolve)', () => {
      const err = check('main_bad.pf');
      expect(err).not.toBeNull();
      // The entry file's own basename should not appear as an "In ...:"
      // attribution line — only cross-file errors get one (see the next
      // describe block's "attributes the error to the dependency file"
      // test for the contrasting case).
      expect(err!.pfunMessage).not.toMatch(/^In .*main_bad\.pf/m);
    });

    it('catches a namespace-qualified proc used as a value (import * as X)', () => {
      const err = check('main_namespace_bad.pf');
      expect(err).not.toBeNull();
      expect(err!.pfunMessage).toContain("Functions cannot use 'Lib.sideEffect' as a value");
    });

    it('catches a namespace-qualified proc call (import * as X)', () => {
      const err = check('main_namespace_call_bad.pf');
      expect(err).not.toBeNull();
      expect(err!.pfunMessage).toContain('Functions cannot call procedures');
      expect(err!.pfunMessage).toContain("'Lib.sideEffect'");
    });

    it('catches a star-imported var mutated from a function (rule 3 across import * from)', () => {
      const err = check('main_star_bad.pf');
      expect(err).not.toBeNull();
      expect(err!.pfunMessage).toContain("Functions cannot mutate 'counter'");
    });

    it('attributes the error to the dependency file, not the entry file, for a transitive violation', () => {
      // middle.pf (imported by transitive_violation_entry.pf) has the
      // actual violation; the entry file itself is clean. The reported
      // error must point at middle.pf.
      const err = check('transitive_violation_entry.pf');
      expect(err).not.toBeNull();
      expect(err!.pfunMessage).toContain('middle.pf');
      expect(err!.pfunMessage).not.toContain('transitive_violation_entry.pf');
      expect(err!.pfunMessage).toContain("Functions cannot use 'deepSideEffect' as a value");
    });
  });

  describe('Legitimate cross-module uses are NOT flagged', () => {
    it('passes a function imported by name and called from another function', () => {
      expect(check('main_good.pf')).toBeNull();
    });

    it('passes a namespace-qualified function call', () => {
      expect(check('main_namespace_good.pf')).toBeNull();
    });

    it('passes a top-level (impure context) call to an imported proc', () => {
      expect(check('main_builtin_proc_good.pf')).toBeNull();
    });

    it('passes a star-imported var mutated from a proc (legitimate var/proc use across import *)', () => {
      expect(check('main_star_good.pf')).toBeNull();
    });

    it('passes a diamond-shaped import graph with no violations', () => {
      expect(check('diamond_entry.pf')).toBeNull();
    });
  });

  describe('Graph resolution errors', () => {
    it('reports a missing module with the resolved path and the importing position', () => {
      const err = check('main_missing.pf');
      expect(err).not.toBeNull();
      expect(err!.pfunMessage).toContain('Module not found');
      expect(err!.pfunMessage).toContain('doesnotexist.pf');
    });

    it('detects a circular import', () => {
      const err = check('cycle_a.pf');
      expect(err).not.toBeNull();
      expect(err!.pfunMessage).toContain('Circular import detected');
    });
  });

  describe('Each file is parsed exactly once', () => {
    it('produces exactly one graph node per resolved path even in a diamond-shaped import graph', () => {
      // diamond_entry.pf imports BOTH diamond_a.pf and diamond_b.pf, which
      // both import lib.pf — lib.pf must appear as exactly one node, not
      // two, despite being reachable via two different import paths.
      const { buildModuleGraph } = require('../wholeProgramCheck');
      const entry  = path.join(FIXTURES, 'diamond_entry.pf');
      const loader = new ModuleLoader(FIXTURES);
      registerBuiltinModules(loader);
      const graph = buildModuleGraph(entry, loader);

      const resolvedPaths = graph.map((n: any) => n.resolvedPath);
      const counts = new Map<string, number>();
      for (const p of resolvedPaths) counts.set(p, (counts.get(p) ?? 0) + 1);

      const libPath = path.join(FIXTURES, 'lib.pf');
      expect(counts.get(libPath)).toBe(1);
      // And the property holds for every node, not just lib.pf.
      for (const [, n] of counts) expect(n).toBe(1);
    });

    it('orders the graph dependency-first: lib.pf appears before both diamond_a.pf and diamond_b.pf, which appear before diamond_entry.pf', () => {
      const { buildModuleGraph } = require('../wholeProgramCheck');
      const entry  = path.join(FIXTURES, 'diamond_entry.pf');
      const loader = new ModuleLoader(FIXTURES);
      registerBuiltinModules(loader);
      const graph = buildModuleGraph(entry, loader);

      const indexOf = (name: string) => graph.findIndex((n: any) => n.resolvedPath === path.join(FIXTURES, name));
      const libIdx     = indexOf('lib.pf');
      const aIdx        = indexOf('diamond_a.pf');
      const bIdx        = indexOf('diamond_b.pf');
      const entryIdx    = indexOf('diamond_entry.pf');

      expect(libIdx).toBeGreaterThanOrEqual(0);
      expect(libIdx).toBeLessThan(aIdx);
      expect(libIdx).toBeLessThan(bIdx);
      expect(aIdx).toBeLessThan(entryIdx);
      expect(bIdx).toBeLessThan(entryIdx);
    });
  });

  describe('Backward compatibility — checkProcedureUsage with no resolver is unchanged', () => {
    it('still treats imports as opaque when called without a ModuleImportResolver (existing single-module callers/tests)', () => {
      // This is procedureCheck.test.ts's territory in detail; this is a
      // narrow smoke check that wholeProgramCheck.ts's existence hasn't
      // altered checkProcedureUsage's default (no-resolver) behavior.
      const { checkProcedureUsage } = require('../procedureCheck');
      const { Lexer } = require('../lexer');
      const { Parser } = require('../parser');
      const ast = new Parser(new Lexer(`
        import { something } from "./other";
        function bad() {
          let g = something;
          return 1;
        }
      `).lex()).parse();
      expect(() => checkProcedureUsage(ast)).not.toThrow();
    });
  });
});
