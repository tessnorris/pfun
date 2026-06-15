// src/dblib.ts
// Shared types and helpers for SQL database client libraries (dblibPostgresql,
// dblibMariadb, ...). This module registers no functions of its own — it's a
// dependency of the driver-specific modules, which each register their own
// connect/query/close functions under their own module name.
//
// Register the types alongside a driver module, e.g.:
//   loader.registerBuiltin('db/postgresql', dblibPostgresqlFunctions, dblibTypes);
//
// ─── Types ──────────────────────────────────────────────────────────────────
//
//   DbResult<T>:  Ok { value: T } | Err { message: string }
//     - Consistent with filelib's Result convention. All connect/query/close
//       operations return Promise<DbResult<...>> and never reject.
//
//   DbValue: DbInt { value: int } | DbFloat { value: float } | DbText { value: string }
//          | DbBool { value: bool } | DbNull
//     - A small closed union representing a single column value, so that a
//       row (list<Pair<string, DbValue>>) satisfies Pfun dicts'/lists'
//       single-element-type requirement while preserving the underlying
//       SQL value's shape.
//     - Mapping from JS driver values:
//         JS bigint            -> DbInt
//         JS number (integral) -> DbInt
//         JS number (non-int)  -> DbFloat
//         JS string            -> DbText
//         JS boolean           -> DbBool
//         null / undefined     -> DbNull
//       Notably, SQL NUMERIC/DECIMAL/BIGINT columns that drivers return as
//       strings (to avoid precision loss) become DbText — callers can use
//       toInt/toFloat (from the core stdlib) to parse them as needed. dblib
//       does not attempt to infer numeric-ness from string contents.
//     - Reading a value out of a DbValue requires a `match`, as with any
//       Pfun union: `match v with | DbInt n -> n.value | ... `. As with
//       Result/Option/HttpResult, the bound name (`n` above) is the whole
//       variant record — its payload is `n.value`, not `n` itself.
//     - DbValue is also used for QUERY PARAMETERS (see dbQuery below): wrap
//       each parameter in the matching constructor, e.g.
//       `[DbInt { 42 }, DbText { "Alice" }]`. This keeps a single query's
//       parameter list homogeneous (`list<DbValue>`), satisfying Pfun's
//       list-element-type rule even when the parameters themselves have
//       different underlying types. A list of raw scalars of the SAME type
//       (e.g. `[1, 2]`, all bigint) is also accepted directly.
//
//   QueryResult: { rows: list<list<Pair<string, DbValue>>>, rowCount: int }
//     - Each row is an ordered list of column-name/DbValue pairs (using the
//       existing Pair { key, value } record from stdlibTypes), reflecting
//       the column order returned by the driver. Plain lists/Pairs mean
//       query results can be processed with map/filter/reduce/find etc.
//       without importing mutStructures or casting anything.
//
// ─── Connection handles ───────────────────────────────────────────────────────
//
//   Connection — an opaque record wrapping the underlying driver client.
//   The wrapped client (__client) is not accessible from Pfun code; it is
//   only inspected by this module's and the driver modules' native functions.

import { RegistryType, PfunChar } from './interpreter';

// ─── Result / DbValue helpers ─────────────────────────────────────────────────
// These construct values directly (bypassing instantiate) so they carry the
// correct __union tag regardless of which union was registered first —
// mirrors filelib's ok/err helpers.

export const ok  = (value: any)      => ({ __type: 'Ok',  __union: 'DbResult', value });
export const err = (message: string) => ({ __type: 'Err', __union: 'DbResult', message });

export const dbInt   = (value: bigint)  => ({ __type: 'DbInt',   __union: 'DbValue', value });
export const dbFloat = (value: number)  => ({ __type: 'DbFloat', __union: 'DbValue', value });
export const dbText  = (value: string)  => ({ __type: 'DbText',  __union: 'DbValue', value });
export const dbBool  = (value: boolean) => ({ __type: 'DbBool',  __union: 'DbValue', value });
export const dbNull  =                     { __type: 'DbNull',  __union: 'DbValue' };

export function nodeErrMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Convert a single JS value (as returned by a SQL driver for one column) into
 * a DbValue. See the module header for the mapping rules.
 */
export function sqlValueToDbValue(v: any): any {
  if (v === null || v === undefined) return dbNull;
  if (typeof v === 'bigint')  return dbInt(v);
  if (typeof v === 'number')  return Number.isInteger(v) ? dbInt(BigInt(v)) : dbFloat(v);
  if (typeof v === 'string')  return dbText(v);
  if (typeof v === 'boolean') return dbBool(v);
  // Dates, Buffers, etc. — fall back to string representation rather than
  // throwing, so unusual column types don't crash the whole query.
  if (v instanceof Date) return dbText(v.toISOString());
  if (Buffer.isBuffer(v)) return dbText(v.toString('utf8'));
  return dbText(String(v));
}

/**
 * Convert a single driver row (a plain JS object keyed by column name, the
 * shape returned by both `pg` and `mysql2`) into a Pfun
 * list<Pair<string, DbValue>>, preserving the object's key order (which in
 * practice reflects the query's column order for both drivers).
 */
export function rowToPairs(row: Record<string, any>): any[] {
  return Object.entries(row).map(([key, value]) => ({
    __type: 'Pair',
    key,
    value: sqlValueToDbValue(value),
  }));
}

/**
 * Wrap a driver client/pool in an opaque Connection handle. The client is
 * stored on a non-enumerable-ish field (__client) that is not part of the
 * registered record's fields, so it's invisible to Pfun code but accessible
 * to this module's and driver modules' native functions via direct property
 * access.
 */
export function makeConnHandle(client: any): any {
  return { __type: 'Connection', __client: client };
}

export function getClient(handle: any, fnName: string): any {
  if (!handle || handle.__type !== 'Connection' || !handle.__client) {
    throw new Error(`${fnName}: requires a Connection.`);
  }
  return handle.__client;
}

/**
 * Convert a Pfun list of query parameters (bigint/number/string/bool/PfunChar/
 * DbValue/nil) into plain JS values suitable for passing to a driver's
 * parameterized query (`client.query(sql, params)` / `connection.execute(sql, params)`).
 */
export function pfunParamsToSql(params: any, interp: any, fnName: string): any[] {
  if (!Array.isArray(params)) throw new Error(`${fnName}: params must be a list.`);
  return params.map((p) => pfunValueToSql(interp.force(p), fnName));
}

function pfunValueToSql(v: any, fnName: string): any {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v;
  if (v instanceof PfunChar) return v.value;
  // Allow passing DbValue records back in directly (e.g. round-tripping a
  // value read from one query into another).
  if (v && typeof v === 'object' && v.__union === 'DbValue') {
    switch (v.__type) {
      case 'DbInt':   return v.value;
      case 'DbFloat': return v.value;
      case 'DbText':  return v.value;
      case 'DbBool':  return v.value;
      case 'DbNull':  return null;
    }
  }
  throw new Error(`${fnName}: unsupported parameter value of type ${typeof v}.`);
}

// ─── Registry Types ───────────────────────────────────────────────────────────

export const dblibTypes: RegistryType[] = [
  {
    kind: 'union',
    name: 'DbResult',
    variants: [
      { name: 'Ok',  fields: ['value'] },
      { name: 'Err', fields: ['message'] },
    ],
  },
  {
    kind: 'union',
    name: 'DbValue',
    variants: [
      { name: 'DbInt',   fields: ['value'] },
      { name: 'DbFloat', fields: ['value'] },
      { name: 'DbText',  fields: ['value'] },
      { name: 'DbBool',  fields: ['value'] },
      { name: 'DbNull',  fields: [] },
    ],
  },
  {
    kind: 'plain',
    name: 'QueryResult',
    fields: ['rows', 'rowCount'],
  },
  // Connection is intentionally NOT registered as a RegistryType: it has no
  // Pfun-visible fields (the wrapped driver client lives on a JS-only
  // __client property), so there is nothing for Pfun code to construct,
  // pattern-match, or destructure. dbConnect's Ok variant simply carries an
  // opaque value of __type 'Connection'.
];
