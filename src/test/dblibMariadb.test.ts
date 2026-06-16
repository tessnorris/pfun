// src/test/dblibMariadb.test.ts
//
// Unit tests for dblibMariadb (dbConnect/dbQuery/dbClose over `mysql2/promise`).
// `mysql2/promise` is mocked at the module level — these tests verify
// dblib's argument validation, value/type mapping (DbValue, Pair, Result),
// and error handling without requiring a real MariaDB/MySQL server.
//
// See dblibMariadb.example.pf for an end-to-end script intended to be run
// against a real MariaDB/MySQL instance.

// ─── Mock `mysql2/promise` ─────────────────────────────────────────────────
//
// dblibMariadb.ts does `const mysql = require('mysql2/promise')` and calls
// `mysql.createConnection({...})`, which resolves to a connection object
// with `.execute(sql, params)` and `.end()`. Configurable per-test via the
// module-level state below, reset in beforeEach.

let connectShouldFail: string | null = null;
let executeRows: any[] | null = null;       // SELECT-style result: array of row objects
let executeOkPacket: { affectedRows: number } | null = null; // INSERT/UPDATE/DELETE-style
let executeError: string | null = null;
let lastExecuteSql: string | null = null;
let lastExecuteParams: any[] | null = null;
let endCalls = 0;

jest.mock('mysql2/promise', () => {
  return {
    createConnection: jest.fn((_config: any) => {
      if (connectShouldFail) return Promise.reject(new Error(connectShouldFail));
      return Promise.resolve({
        execute: jest.fn((sql: string, params: any[]) => {
          lastExecuteSql = sql;
          lastExecuteParams = params;
          if (executeError) return Promise.reject(new Error(executeError));
          if (executeOkPacket) return Promise.resolve([executeOkPacket, []]);
          return Promise.resolve([executeRows ?? [], []]);
        }),
        end: jest.fn(() => {
          endCalls++;
          return Promise.resolve();
        }),
      });
    }),
  };
}, { virtual: true });

import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Interpreter } from '../interpreter';
import { stdlibFunctions, stdlibTypes } from '../library';
import { mutStructuresFunctions, mutStructuresTypes } from '../mutStructures';
import { iolibFunctions } from '../iolib';
import { dblibTypes } from '../dblib';
import { dblibMariadbFunctions } from '../dblibMariadb';

const makeInterpreter = () => {
  const interpreter = new Interpreter();
  interpreter.registerLibrary(stdlibFunctions, stdlibTypes);
  interpreter.registerLibrary(mutStructuresFunctions, mutStructuresTypes);
  interpreter.registerLibrary(iolibFunctions, []);
  interpreter.registerLibrary(dblibMariadbFunctions, dblibTypes);
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
  executeRows = null;
  executeOkPacket = null;
  executeError = null;
  lastExecuteSql = null;
  lastExecuteParams = null;
  endCalls = 0;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('dblibMariadb', () => {

  describe('dbConnect', () => {
    it('returns Ok with a Connection on success', async () => {
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let result = await dbConnect("mysql://localhost/test");
          match result with
          | Ok _  -> println("connected")
          | Err e -> println("error: " + e.message);
        }
        p();
      `);
      expect(logs).toEqual(['connected']);
    });

    it('returns Err when the connection fails', async () => {
      connectShouldFail = 'ECONNREFUSED';
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let result = await dbConnect("mysql://localhost/test");
          match result with
          | Ok _  -> println("connected")
          | Err e -> println("error: " + e.message);
        }
        p();
      `);
      expect(logs).toEqual(['error: ECONNREFUSED']);
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
    it('maps SELECT rows to list<list<Pair<string, DbValue>>> with correct DbValue variants', async () => {
      executeRows = [
        { id: 1, name: 'Alice', balance: 12.5, active: 1, notes: null },
        { id: 2, name: 'Bob', balance: '0.00', active: 0, notes: 'vip' },
      ];

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
          let conn = await dbConnect("mysql://localhost/test");
          match conn with
          | Ok c -> {
              let result = await dbQuery(c.value, "SELECT * FROM users", []);
              match result with
              | Ok r -> {
                  println(r.value.rowCount);
                  println(length(r.value.rows));
                  printRow(nth(r.value.rows, 0));
                  println("---");
                  printRow(nth(r.value.rows, 1));
                }
              | Err e -> println("query error: " + e.message);
            }
          | Err e -> println("connect error: " + e.message);
        }
        p();
      `);
      expect(logs[0]).toBe('2');     // rowCount
      expect(logs[1]).toBe('2');     // number of rows
      expect(logs.slice(2, 7)).toEqual([
        'id:int:1',
        'name:text:Alice',
        'balance:float:12.5',
        // mysql2 returns TINYINT(1) "boolean" columns as JS numbers (0/1) by
        // default, not JS booleans — so `active` maps to DbInt, not DbBool.
        'active:int:1',
        'notes:null',
      ]);
      expect(logs[7]).toBe('---');
      expect(logs.slice(8)).toEqual([
        'id:int:2',
        'name:text:Bob',
        // With bigNumberStrings/decimalNumbers config, DECIMAL columns come
        // back as strings -> DbText (caller can toFloat() if needed).
        'balance:text:0.00',
        'active:int:0',
        'notes:text:vip',
      ]);
    });

    it('maps an INSERT/UPDATE OkPacket result to an empty rows list with rowCount = affectedRows', async () => {
      executeOkPacket = { affectedRows: 3 };
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let conn = await dbConnect("mysql://localhost/test");
          match conn with
          | Ok c -> {
              let result = await dbQuery(c.value, "UPDATE users SET active = ?", [DbBool { false }]);
              match result with
              | Ok r -> {
                  println(r.value.rowCount);
                  println(length(r.value.rows));
                }
              | Err e -> println("query error: " + e.message);
            }
          | Err e -> println("connect error: " + e.message);
        }
        p();
      `);
      expect(logs).toEqual(['3', '0']);
      expect(lastExecuteSql).toBe('UPDATE users SET active = ?');
      expect(lastExecuteParams).toEqual([false]);
    });

    it('passes DbValue-wrapped params through to the underlying execute call', async () => {
      executeRows = [];
      await runAsyncProgram(`
        async proc p() {
          let conn = await dbConnect("mysql://localhost/test");
          match conn with
          | Ok c -> {
              let result = await dbQuery(c.value, "SELECT * FROM users WHERE id = ? AND name = ?", [DbInt { 42 }, DbText { "Alice" }]);
              match result with
              | Ok _  -> println("ok")
              | Err e -> println("query error: " + e.message);
            }
          | Err e -> println("connect error: " + e.message);
        }
        p();
      `);
      expect(lastExecuteSql).toBe('SELECT * FROM users WHERE id = ? AND name = ?');
      expect(lastExecuteParams).toEqual([42n, 'Alice']);
    });

    it('returns Err when the underlying execute rejects', async () => {
      executeError = "ER_PARSE_ERROR: You have an error in your SQL syntax";
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let conn = await dbConnect("mysql://localhost/test");
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
      expect(logs).toEqual(['error: ER_PARSE_ERROR: You have an error in your SQL syntax']);
    });

    it('maps a Buffer column to DbBytes containing the correct List<Byte>', async () => {
      executeRows = [{ data: Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]) }];
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let conn = await dbConnect("mysql://localhost/test");
          match conn with
          | Ok c -> {
              let result = await dbQuery(c.value, "SELECT data FROM blobs WHERE id = ?", [DbInt { 1 }]);
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

    it('passes a DbBytes parameter as a Buffer to the driver', async () => {
      executeOkPacket = { affectedRows: 1 };
      await runAsyncProgram(`
        async proc p() {
          let conn = await dbConnect("mysql://localhost/test");
          match conn with
          | Ok c -> {
              let result = await dbQuery(c.value, "INSERT INTO blobs(data) VALUES (?)", [DbBytes { [0xCAb, 0xFEb] }]);
              match result with
              | Ok _  -> println("ok")
              | Err e -> println("query error: " + e.message);
            }
          | Err e -> println("connect error: " + e.message);
        }
        p();
      `);
      expect(lastExecuteParams).toEqual([Buffer.from([0xCA, 0xFE])]);
    });

    it('treats an empty SELECT result set correctly', async () => {
      executeRows = [];
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let conn = await dbConnect("mysql://localhost/test");
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
    it('returns Ok and calls end() on the underlying connection', async () => {
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let conn = await dbConnect("mysql://localhost/test");
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
