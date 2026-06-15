// src/dblibPostgresql.ts
// PostgreSQL client for Pfun, built on the `pg` package.
// Register with: loader.registerBuiltin('db/postgresql', dblibPostgresqlFunctions, dblibTypes)
// Use with:      import * from "db/postgresql";
//
// All functions are async (return Promises), following httplib's
// httpGet convention: `await dbConnect(...)`, `await dbQuery(...)`, etc.
// All operations return DbResult and never reject — driver errors are
// captured as Err { message }.
//
//   await dbConnect(connectionString) -> DbResult<Connection>
//     Opens a single connection (pg.Client) to the given connection string,
//     e.g. "postgres://user:pass@localhost:5432/mydb".
//
//   await dbQuery(conn, sql, params) -> DbResult<QueryResult>
//     Runs a parameterized query. `params` is a list of values substituted
//     for $1, $2, ... placeholders in `sql`. Pass an empty list `[]` for
//     queries with no parameters. Works for SELECT as well as
//     INSERT/UPDATE/DELETE (rows will be empty for statements with no
//     RETURNING clause; rowCount reflects the number of affected rows).
//
//   await dbClose(conn) -> DbResult<nil>
//     Closes the connection. Safe to call even if the connection is already
//     closed (returns Err with the underlying message in that case).
//
// See dblib.ts for DbResult, DbValue, and QueryResult shapes.

import { Client } from 'pg';
import { RegistryFunction } from './interpreter';
import {
  ok, err, nodeErrMsg, rowToPairs, makeConnHandle, getClient, pfunParamsToSql,
} from './dblib';

export const dblibPostgresqlFunctions: RegistryFunction[] = [

  // dbConnect(connectionString) -> Promise<DbResult<Connection>>
  {
    name: 'dbConnect',
    arity: 1,
    fn: (args, interp) => {
      if (interp.inPureContext) throw new Error("Functions cannot use 'dbConnect': side effects are not allowed in pure functions.");
      const connStr = interp.force(args[0]);
      if (typeof connStr !== 'string') throw new Error("dbConnect() requires a connection string.");

      const client = new Client({ connectionString: connStr });
      return client.connect()
        .then(() => {
          interp._resources.push({ close: () => { client.end().catch(() => {}); } });
          return ok(makeConnHandle(client));
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

      let client: Client;
      let sqlParams: any[];
      try {
        client = getClient(handle, 'dbQuery');
        sqlParams = pfunParamsToSql(params, interp, 'dbQuery');
      } catch (e) {
        return Promise.resolve(err(nodeErrMsg(e)));
      }

      return client.query(sql, sqlParams)
        .then((res: any) => ok({
          __type: 'QueryResult',
          rows: res.rows.map(rowToPairs),
          rowCount: BigInt(res.rowCount ?? 0),
        }))
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

      let client: Client;
      try {
        client = getClient(handle, 'dbClose');
      } catch (e) {
        return Promise.resolve(err(nodeErrMsg(e)));
      }

      return client.end()
        .then(() => ok(undefined))
        .catch((e: any) => err(nodeErrMsg(e)));
    },
  },
];
