// src/test/dblibPostgresql.test.ts
//
// Unit tests for dblibPostgresql (dbConnect/dbQuery/dbClose over `pg`).
// The `pg` package is mocked at the module level — these tests verify
// dblib's argument validation, value/type mapping (DbValue, Pair, Result),
// and error handling without requiring a real Postgres server.
//
// See dblibPostgresql.example.pf for an end-to-end script intended to be
// run against a real Postgres instance.

// ─── Mock `pg` ────────────────────────────────────────────────────────────
//
// A minimal fake Client: `connect`, `query`, `end` are jest mocks whose
// behavior is configured per-test via `__setQueryResult`/`__setQueryError`/
// `__setConnectError`. Each `new Client(...)` call shares the same mock
// instance's configurable behavior via module-level state, reset in
// beforeEach.

let connectShouldFail: string | null = null;
let queryResult: { rows: any[]; rowCount: number } | null = null;
let queryError: string | null = null;
let lastQuerySql: string | null = null;
let lastQueryParams: any[] | null = null;
let endCalls = 0;

jest.mock('pg', () => {
  return {
    Client: jest.fn().mockImplementation(() => ({
      connect: jest.fn(() => {
        if (connectShouldFail) return Promise.reject(new Error(connectShouldFail));
        return Promise.resolve();
      }),
      query: jest.fn((sql: string, params: any[]) => {
        lastQuerySql = sql;
        lastQueryParams = params;
        if (queryError) return Promise.reject(new Error(queryError));
        return Promise.resolve(queryResult);
      }),
      end: jest.fn(() => {
        endCalls++;
        return Promise.resolve();
      }),
    })),
  };
}, { virtual: true });

import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Interpreter } from '../interpreter';
import { stdlibFunctions, stdlibTypes } from '../library';
import { mutStructuresFunctions, mutStructuresTypes } from '../mutStructures';
import { iolibFunctions } from '../iolib';
import { dblibTypes } from '../dblib';
import { dblibPostgresqlFunctions } from '../dblibPostgresql';

const makeInterpreter = () => {
  const interpreter = new Interpreter();
  interpreter.registerLibrary(stdlibFunctions, stdlibTypes);
  interpreter.registerLibrary(mutStructuresFunctions, mutStructuresTypes);
  interpreter.registerLibrary(iolibFunctions, []);
  interpreter.registerLibrary(dblibPostgresqlFunctions, dblibTypes);
  return interpreter;
};

/** Run a Pfun program via interpretAsync, capturing println output. */
const runAsyncProgram = async (source: string, interpreter = makeInterpreter()) => {
  const ast = new Parser(new Lexer(source).lex()).parse();
  const logs: string[] = [];
  let currentLine = '';
  const originalLog = console.log;
  const originalWrite = process.stdout.write.bind(process.stdout);
  console.log = (...args: any[]) => { logs.push(currentLine + args.map(String).join(' ')); currentLine = ''; };
  (process.stdout as any).write = (s: string) => {
    if (typeof s !== 'string') return true;
    const parts = s.split('\n');
    for (let i = 0; i < parts.length - 1; i++) { logs.push(currentLine + parts[i]); currentLine = ''; }
    currentLine += parts[parts.length - 1];
    return true;
  };
  try {
    await interpreter.interpretAsync(ast, source);
    if (currentLine.length > 0) { logs.push(currentLine); currentLine = ''; }
  } finally {
    console.log = originalLog;
    (process.stdout as any).write = originalWrite;
  }
  return { logs, interpreter };
};

beforeEach(() => {
  connectShouldFail = null;
  queryResult = null;
  queryError = null;
  lastQuerySql = null;
  lastQueryParams = null;
  endCalls = 0;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('dblibPostgresql', () => {

  describe('dbConnect', () => {
    it('returns Ok with a Connection on success', async () => {
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let result = await dbConnect("postgres://localhost/test");
          match result with
          | Ok _  -> println("connected")
          | Err e -> println("error: " + e.message);
        }
        p();
      `);
      expect(logs).toEqual(['connected']);
    });

    it('returns Err when the connection fails', async () => {
      connectShouldFail = 'connection refused';
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let result = await dbConnect("postgres://localhost/test");
          match result with
          | Ok _  -> println("connected")
          | Err e -> println("error: " + e.message);
        }
        p();
      `);
      expect(logs).toEqual(['error: connection refused']);
    });

    it('rejects a non-string connection string', async () => {
      await expect(runAsyncProgram(`
        async proc p() {
          let result = await dbConnect(42);
          println("unreachable");
        }
        p();
      `)).rejects.toThrow(/connection string/);
    });
  });

  describe('dbQuery', () => {
    it('maps rows to list<list<Pair<string, DbValue>>> with correct DbValue variants', async () => {
      queryResult = {
        rows: [
          { id: 1, name: 'Alice', balance: 12.5, active: true, notes: null },
          { id: 2, name: 'Bob', balance: 0, active: false, notes: 'vip' },
        ],
        rowCount: 2,
      };
      const { logs } = await runAsyncProgram(`
        proc printPair(pair) {
          match pair.value with
          | DbInt n    -> println(pair.key + ":int:" + __str__(n.value))
          | DbFloat n  -> println(pair.key + ":float:" + __str__(n.value))
          | DbText s   -> println(pair.key + ":text:" + s.value)
          | DbBool b   -> println(pair.key + ":bool:" + __str__(b.value))
          | DbBytes b  -> println(pair.key + ":bytes:" + __str__(length(b.value)))
          | DbNull     -> println(pair.key + ":null");
        }

        proc printRow(pairs) {
          if length(pairs) == 0 then return 0;
          printPair(head(pairs));
          printRow(tail(pairs));
        }

        async proc p() {
          let conn = await dbConnect("postgres://localhost/test");
          match conn with
          | Ok c -> {
              let result = await dbQuery(c.value, "SELECT * FROM users", []);
              match result with
              | Ok r -> {
                  println(r.value.rowCount);
                  println(length(r.value.rows));
                  printRow(nth(r.value.rows, 0));
                }
              | Err e -> println("query error: " + e.message);
            }
          | Err e -> println("connect error: " + e.message);
        }
        p();
      `);
      expect(logs[0]).toBe('2');     // rowCount
      expect(logs[1]).toBe('2');     // number of rows
      expect(logs.slice(2)).toEqual([
        'id:int:1',
        'name:text:Alice',
        'balance:float:12.5',
        'active:bool:true',
        'notes:null',
      ]);
    });

    it('maps a non-integer-valued whole number to DbInt and a fractional number to DbFloat', async () => {
      queryResult = { rows: [{ a: 5, b: 5.5, c: 5n as any }], rowCount: 1 };
      const { logs } = await runAsyncProgram(`
        proc printPairKind(pair) {
          match pair.value with
          | DbInt n   -> println(pair.key + ":int")
          | DbFloat n -> println(pair.key + ":float")
          | DbText s  -> println(pair.key + ":text")
          | DbBool b  -> println(pair.key + ":bool")
          | DbBytes b -> println(pair.key + ":bytes:" + __str__(length(b.value)))
          | DbNull    -> println(pair.key + ":null");
        }

        proc printRowKinds(pairs) {
          if length(pairs) == 0 then return 0;
          printPairKind(head(pairs));
          printRowKinds(tail(pairs));
        }

        async proc p() {
          let conn = await dbConnect("postgres://localhost/test");
          match conn with
          | Ok c -> {
              let result = await dbQuery(c.value, "SELECT 1", []);
              match result with
              | Ok r -> printRowKinds(nth(r.value.rows, 0))
              | Err e -> println("query error: " + e.message);
            }
          | Err e -> println("connect error: " + e.message);
        }
        p();
      `);
      expect(logs).toEqual(['a:int', 'b:float', 'c:int']);
    });

    it('passes DbValue-wrapped params through to the underlying query call', async () => {
      queryResult = { rows: [], rowCount: 0 };
      await runAsyncProgram(`
        async proc p() {
          let conn = await dbConnect("postgres://localhost/test");
          match conn with
          | Ok c -> {
              let result = await dbQuery(c.value, "SELECT * FROM users WHERE id = $1 AND name = $2", [DbInt { 42 }, DbText { "Alice" }]);
              match result with
              | Ok _  -> println("ok")
              | Err e -> println("query error: " + e.message);
            }
          | Err e -> println("connect error: " + e.message);
        }
        p();
      `);
      expect(lastQuerySql).toBe('SELECT * FROM users WHERE id = $1 AND name = $2');
      expect(lastQueryParams).toEqual([42n, 'Alice']);
    });

    it('passes a homogeneous raw-value params list through to the underlying query call', async () => {
      queryResult = { rows: [], rowCount: 0 };
      await runAsyncProgram(`
        async proc p() {
          let conn = await dbConnect("postgres://localhost/test");
          match conn with
          | Ok c -> {
              let result = await dbQuery(c.value, "SELECT * FROM users WHERE id = $1 OR id = $2", [1, 2]);
              match result with
              | Ok _  -> println("ok")
              | Err e -> println("query error: " + e.message);
            }
          | Err e -> println("connect error: " + e.message);
        }
        p();
      `);
      expect(lastQuerySql).toBe('SELECT * FROM users WHERE id = $1 OR id = $2');
      expect(lastQueryParams).toEqual([1n, 2n]);
    });

    it('returns Err when the underlying query rejects', async () => {
      queryError = 'syntax error at or near "FORM"';
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let conn = await dbConnect("postgres://localhost/test");
          match conn with
          | Ok c -> {
              let result = await dbQuery(c.value, "SELECT * FORM users", []);
              match result with
              | Ok _  -> println("ok")
              | Err e -> println("error: " + e.message);
            }
          | Err e -> println("connect error: " + e.message);
        }
        p();
      `);
      expect(logs).toEqual(['error: syntax error at or near "FORM"']);
    });

    it('maps a Buffer column to DbBytes containing the correct List<Byte>', async () => {
      queryResult = {
        rows: [{ data: Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]) }],
        rowCount: 1,
      };
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let conn = await dbConnect("postgres://localhost/test");
          match conn with
          | Ok c -> {
              let result = await dbQuery(c.value, "SELECT data FROM blobs WHERE id = $1", [DbInt { 1 }]);
              match result with
              | Ok r -> {
                  let row = nth(r.value.rows, 0);
                  let col = nth(row, 0);
                  match col.value with
                  | DbBytes b -> {
                      println(length(b.value));
                      println(nth(b.value, 0));
                      println(nth(b.value, 3));
                    }
                  | _ -> println("not bytes");
                }
              | Err e -> println("query error: " + e.message);
            }
          | Err e -> println("connect error: " + e.message);
        }
        p();
      `);
      expect(logs).toEqual(['4', '222', '239']); // 0xDE=222, 0xEF=239
    });

    it('passes a List<Byte> parameter as a Buffer to the driver', async () => {
      queryResult = { rows: [], rowCount: 1 };
      await runAsyncProgram(`
        async proc p() {
          let conn = await dbConnect("postgres://localhost/test");
          match conn with
          | Ok c -> {
              let result = await dbQuery(c.value, "INSERT INTO blobs(data) VALUES ($1)", [DbBytes { [0xCAb, 0xFEb] }]);
              match result with
              | Ok _  -> println("ok")
              | Err e -> println("query error: " + e.message);
            }
          | Err e -> println("connect error: " + e.message);
        }
        p();
      `);
      expect(lastQueryParams).toEqual([Buffer.from([0xCA, 0xFE])]);
    });

    it('treats an empty result set correctly', async () => {
      queryResult = { rows: [], rowCount: 0 };
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let conn = await dbConnect("postgres://localhost/test");
          match conn with
          | Ok c -> {
              let result = await dbQuery(c.value, "SELECT * FROM users WHERE id = -1", []);
              match result with
              | Ok r -> {
                  println(r.value.rowCount);
                  println(length(r.value.rows));
                }
              | Err e -> println("error: " + e.message);
            }
          | Err e -> println("connect error: " + e.message);
        }
        p();
      `);
      expect(logs).toEqual(['0', '0']);
    });
  });

  describe('dbClose', () => {
    it('returns Ok and calls end() on the underlying client', async () => {
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let conn = await dbConnect("postgres://localhost/test");
          match conn with
          | Ok c -> {
              let result = await dbClose(c.value);
              match result with
              | Ok _  -> println("closed")
              | Err e -> println("error: " + e.message);
            }
          | Err e -> println("connect error: " + e.message);
        }
        p();
      `);
      expect(logs).toEqual(['closed']);
      expect(endCalls).toBe(1);
    });
  });
});
