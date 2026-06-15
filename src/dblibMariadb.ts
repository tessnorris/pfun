// src/dblibMariadb.ts
// MariaDB/MySQL client for Pfun, built on the `mysql2` package's Promise API.
// Register with: loader.registerBuiltin('db/mariadb', dblibMariadbFunctions, dblibTypes)
// Use with:      import * from "db/mariadb";
//
// Same interface and conventions as dblibPostgresql — see that file's header
// for the full dbConnect/dbQuery/dbClose contract and dblib.ts for DbResult,
// DbValue, and QueryResult shapes.
//
//   await dbConnect(connectionString) -> DbResult<Connection>
//     e.g. "mysql://user:pass@localhost:3306/mydb"
//
//   await dbQuery(conn, sql, params) -> DbResult<QueryResult>
//     `params` is a list of values substituted for `?` placeholders in `sql`
//     (mysql2's positional-placeholder style). Pass `[]` for queries with no
//     parameters.
//
//   await dbClose(conn) -> DbResult<nil>
//
// Configuration notes:
//   - The connection is created with `bigNumberStrings: true` and
//     `decimalNumbers: false` so that BIGINT/DECIMAL/NUMERIC columns are
//     returned as JS strings (mapping to DbText) rather than risking
//     precision loss in JS numbers — consistent with dblib's documented
//     "numeric strings become DbText" convention.

import { RegistryFunction } from './interpreter';
import {
  ok, err, nodeErrMsg, rowToPairs, makeConnHandle, getClient, pfunParamsToSql,
} from './dblib';

// mysql2/promise is required lazily inside each function body would be
// wasteful (re-require on every call), so require it once at module load.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mysql = require('mysql2/promise');

export const dblibMariadbFunctions: RegistryFunction[] = [

  // dbConnect(connectionString) -> Promise<DbResult<Connection>>
  {
    name: 'dbConnect',
    arity: 1,
    fn: (args, interp) => {
      if (interp.inPureContext) throw new Error("Functions cannot use 'dbConnect': side effects are not allowed in pure functions.");
      const connStr = interp.force(args[0]);
      if (typeof connStr !== 'string') throw new Error("dbConnect() requires a connection string.");

      return mysql.createConnection({
        uri: connStr,
        bigNumberStrings: true,
        decimalNumbers: false,
      })
        .then((connection: any) => {
          interp._resources.push({ close: () => { connection.end().catch(() => {}); } });
          return ok(makeConnHandle(connection));
        })
        .catch((e: any) => err(nodeErrMsg(e)));
    },
  },

  // dbQuery(conn, sql, params) -> Promise<DbResult<QueryResult>>
  {
    name: 'dbQuery',
    arity: 3,
    fn: (args, interp) => {
      if (interp.inPureContext) throw new Error("Functions cannot use 'dbQuery': side effects are not allowed in pure functions.");
      const handle = interp.force(args[0]);
      const sql    = interp.force(args[1]);
      const params = interp.force(args[2]);
      if (typeof sql !== 'string') throw new Error("dbQuery(): query must be a string.");

      let connection: any;
      let sqlParams: any[];
      try {
        connection = getClient(handle, 'dbQuery');
        sqlParams = pfunParamsToSql(params, interp, 'dbQuery');
      } catch (e) {
        return Promise.resolve(err(nodeErrMsg(e)));
      }

      return connection.execute(sql, sqlParams)
        .then(([rows]: [any]) => {
          // mysql2 returns an array of row objects for SELECT, or an
          // OkPacket-like object ({ affectedRows, ... }) for
          // INSERT/UPDATE/DELETE.
          if (Array.isArray(rows)) {
            return ok({
              __type: 'QueryResult',
              rows: rows.map(rowToPairs),
              rowCount: BigInt(rows.length),
            });
          }
          return ok({
            __type: 'QueryResult',
            rows: [],
            rowCount: BigInt(rows?.affectedRows ?? 0),
          });
        })
        .catch((e: any) => err(nodeErrMsg(e)));
    },
  },

  // dbClose(conn) -> Promise<DbResult<nil>>
  {
    name: 'dbClose',
    arity: 1,
    fn: (args, interp) => {
      if (interp.inPureContext) throw new Error("Functions cannot use 'dbClose': side effects are not allowed in pure functions.");
      const handle = interp.force(args[0]);

      let connection: any;
      try {
        connection = getClient(handle, 'dbClose');
      } catch (e) {
        return Promise.resolve(err(nodeErrMsg(e)));
      }

      return connection.end()
        .then(() => ok(undefined))
        .catch((e: any) => err(nodeErrMsg(e)));
    },
  },
];
