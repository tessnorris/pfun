// src/test/mainModuleRegistration.test.ts
//
// Regression test for a real bug: dblib.ts documents
// `loader.registerBuiltin('db/postgresql', dblibPostgresqlFunctions,
// dblibTypes)` / `loader.registerBuiltin('db/mariadb', dblibMariadbFunctions,
// dblibTypes)` as the intended wiring, but main.ts's registerBuiltinModules()
// never actually called them — so `import * from "db/postgresql"` and
// `import * from "db/mariadb"` failed with "Module not found" for every
// user, even though the driver code itself worked correctly (as
// dblibPostgresql.test.ts / dblibMariadb.test.ts, which bypass the module
// system via registerLibrary(), already proved).
//
// Unlike the ModuleLoader-level tests in dblibPostgresql.test.ts /
// dblibMariadb.test.ts (which construct their own loader and register the
// builtins by hand, and so cannot catch "main.ts forgot to register this"),
// this test imports registerBuiltinModules directly FROM main.ts and
// exercises a real ModuleLoader built the same way main.ts builds one. A
// regression here — removing or mistyping one of the registerBuiltin calls
// in main.ts — fails this test, which the hand-rolled loader tests cannot.
//
// main.ts also runs a CLI driver at module-load time guarded by
// `if (require.main === module)`, so importing it here does not invoke the
// CLI, call process.exit, or block on stdin — only registerBuiltinModules
// and its own module-level setup run.
//
// `pg` and `mysql2/promise` are mocked here even though this file never
// calls dbConnect/dbQuery/dbClose itself. Without this, importing main.ts
// pulls in the REAL `pg`/`mysql2` packages (since main.ts imports
// dblibPostgresql.ts/dblibMariadb.ts directly, unmocked) in the same test
// run as dblibPostgresql.test.ts/dblibMariadb.test.ts, which mock those same
// packages for their own tests. That real-vs-mocked split for the same
// underlying native module caused intermittent failures/flakiness in THIS
// SUITE (not just this file) — dblibPostgresql.test.ts's own tests would
// sporadically attempt a real network connection and fail with
// ECONNREFUSED instead of using its mock. Mocking here too removes the
// conflicting module identity entirely.
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

import { ModuleLoader } from '../interpreter';
import { registerBuiltinModules } from '../main';

describe('main.ts — registerBuiltinModules', () => {
  const builtinModuleNames = ['io', 'file', 'json', 'math', 'async', 'http', 'db/postgresql', 'db/mariadb'];

  for (const name of builtinModuleNames) {
    it(`registers "${name}" as a resolvable, loadable builtin module`, () => {
      const loader = new ModuleLoader('/unused-lib-dir');
      registerBuiltinModules(loader);
      const resolved = loader.resolve(name, '/unused-from-dir');
      expect(resolved).toBe(`__builtin__:${name}`);
      expect(() => loader.load(resolved)).not.toThrow();
    });
  }

  it('"db/postgresql" exports dbConnect, dbQuery, dbClose, and the DbResult/DbValue/QueryResult types', () => {
    const loader = new ModuleLoader('/unused-lib-dir');
    registerBuiltinModules(loader);
    const exports = loader.load(loader.resolve('db/postgresql', '/unused-from-dir'));
    for (const name of ['dbConnect', 'dbQuery', 'dbClose']) {
      expect(exports.has(name)).toBe(true);
    }
    for (const typeName of ['DbResult', 'DbValue', 'QueryResult']) {
      expect(exports.has(typeName)).toBe(true);
    }
  });

  it('"db/mariadb" exports dbConnect, dbQuery, dbClose, and the DbResult/DbValue/QueryResult types', () => {
    const loader = new ModuleLoader('/unused-lib-dir');
    registerBuiltinModules(loader);
    const exports = loader.load(loader.resolve('db/mariadb', '/unused-from-dir'));
    for (const name of ['dbConnect', 'dbQuery', 'dbClose']) {
      expect(exports.has(name)).toBe(true);
    }
    for (const typeName of ['DbResult', 'DbValue', 'QueryResult']) {
      expect(exports.has(typeName)).toBe(true);
    }
  });

  it('a fresh ModuleLoader does NOT resolve "db/postgresql"/"db/mariadb" as builtins without registerBuiltinModules', () => {
    // Sanity check on the test methodology itself: confirms resolve()'s
    // `__builtin__:` sentinel is genuinely conditional on registration,
    // not always returned regardless — i.e. that the assertions above
    // would actually fail if main.ts's registration were ever removed
    // again, the same way they did when this bug was first reported.
    const loader = new ModuleLoader('/unused-lib-dir');
    expect(loader.resolve('db/postgresql', '/unused-from-dir')).not.toBe('__builtin__:db/postgresql');
    expect(loader.resolve('db/mariadb', '/unused-from-dir')).not.toBe('__builtin__:db/mariadb');
  });
});
