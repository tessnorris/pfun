'use strict';
// pfun-db-postgresql.js — runtime support for `import * from "db/postgresql"`
// in transpiled Pfun programs.
//
// Direct port of dblibPostgresql.ts + the shared dblib.ts helpers.
// Requires the `pg` npm package at runtime: npm install pg
//
// All three functions are async and return DbResult — they never reject.
// Use with: import * from "db/postgresql";
//   await dbConnect("postgres://user:pass@localhost:5432/mydb")
//   await dbQuery(conn, "SELECT $1::int", [DbInt { 42 }])
//   await dbClose(conn)

const { PfunByte, $registerType } = require('./pfun-runtime');

// ─── Register shared db types ─────────────────────────────────────────────────
// These mirror dblibTypes from dblib.ts — registered when the module loads
// so that Pfun code can construct DbInt { v }, match on DbResult, etc.
$registerType('Ok',          ['value'],              'DbResult');
$registerType('Err',         ['message'],            'DbResult');
$registerType('DbInt',       ['value'],              'DbValue');
$registerType('DbFloat',     ['value'],              'DbValue');
$registerType('DbText',      ['value'],              'DbValue');
$registerType('DbBool',      ['value'],              'DbValue');
$registerType('DbBytes',     ['value'],              'DbValue');
$registerType('DbNull',      [],                     'DbValue');
$registerType('QueryResult', ['rows', 'rowCount'],   null);

// ─── DbResult helpers ─────────────────────────────────────────────────────────
const ok  = v => ({ __type: 'Ok',  __union: 'DbResult', value: v });
const err = m => ({ __type: 'Err', __union: 'DbResult', message: m });
const nodeErrMsg = e => e instanceof Error ? e.message : String(e);

// ─── DbValue constructors ─────────────────────────────────────────────────────
const dbInt   = v => ({ __type: 'DbInt',   __union: 'DbValue', value: v });
const dbFloat = v => ({ __type: 'DbFloat', __union: 'DbValue', value: v });
const dbText  = v => ({ __type: 'DbText',  __union: 'DbValue', value: v });
const dbBool  = v => ({ __type: 'DbBool',  __union: 'DbValue', value: v });
const dbBytes = v => ({ __type: 'DbBytes', __union: 'DbValue', value: v });
const dbNull  =     { __type: 'DbNull',   __union: 'DbValue' };

// ─── Column value mapping ─────────────────────────────────────────────────────
// JS driver value → DbValue. Mirrors dblib.ts's sqlValueToDbValue exactly.
function sqlValueToDbValue(v) {
  if (v === null || v === undefined) return dbNull;
  if (typeof v === 'bigint')  return dbInt(v);
  if (typeof v === 'number')  return Number.isInteger(v) ? dbInt(BigInt(v)) : dbFloat(v);
  if (typeof v === 'string')  return dbText(v);
  if (typeof v === 'boolean') return dbBool(v);
  if (v instanceof Date)      return dbText(v.toISOString());
  if (Buffer.isBuffer(v))     return dbBytes(Array.from(v, b => new PfunByte(b)));
  return dbText(String(v));
}

// ─── Row mapping ──────────────────────────────────────────────────────────────
// Driver row object → list<Pair<string, DbValue>>
function rowToPairs(row) {
  return Object.entries(row).map(([key, value]) => ({
    __type: 'Pair', key, value: sqlValueToDbValue(value),
  }));
}

// ─── Connection handle ────────────────────────────────────────────────────────
function makeConn(client) { return { __type: 'Connection', __client: client }; }
function getClient(handle, fnName) {
  if (!handle || handle.__type !== 'Connection' || !handle.__client)
    throw new Error(`${fnName}: requires a Connection.`);
  return handle.__client;
}

// ─── Parameter conversion ─────────────────────────────────────────────────────
// Pfun list of query params → plain JS values for the driver.
// In compiled output values are already forced; no interp.force() needed.
function pfunValueToSql(v, fnName) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint')  return v;
  if (typeof v === 'number')  return v;
  if (typeof v === 'string')  return v;
  if (typeof v === 'boolean') return v;
  // PfunByte or List<Byte> → Buffer
  if (v instanceof PfunByte) return Buffer.from([v.value]);
  if (Array.isArray(v) && v.every(b => b instanceof PfunByte))
    return Buffer.from(v.map(b => b.value));
  // DbValue round-trip
  if (v && v.__union === 'DbValue') {
    switch (v.__type) {
      case 'DbInt':   return v.value;
      case 'DbFloat': return v.value;
      case 'DbText':  return v.value;
      case 'DbBool':  return v.value;
      case 'DbNull':  return null;
      case 'DbBytes':
        return Buffer.from((v.value).map(b => b.value));
    }
  }
  throw new Error(`${fnName}: unsupported parameter value of type ${typeof v}.`);
}

function pfunParamsToSql(params, fnName) {
  if (!Array.isArray(params)) throw new Error(`${fnName}: params must be a list.`);
  return params.map(p => pfunValueToSql(p, fnName));
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Lazy-require pg so that programs that don't use postgresql don't need the
// package installed.
function getPg() {
  try { return require('pg'); }
  catch { throw new Error("db/postgresql: the 'pg' npm package is required. Run: npm install pg"); }
}

async function dbConnect(connStr) {
  if (typeof connStr !== 'string')
    throw new Error('dbConnect() requires a connection string.');
  const { Client } = getPg();
  const client = new Client({ connectionString: connStr });
  try {
    await client.connect();
    return ok(makeConn(client));
  } catch (e) {
    return err(nodeErrMsg(e));
  }
}

async function dbQuery(handle, sql, params) {
  if (typeof sql !== 'string') throw new Error('dbQuery(): query must be a string.');
  let client, sqlParams;
  try {
    client = getClient(handle, 'dbQuery');
    sqlParams = pfunParamsToSql(params, 'dbQuery');
  } catch (e) {
    return err(nodeErrMsg(e));
  }
  try {
    const res = await client.query(sql, sqlParams);
    return ok({
      __type: 'QueryResult',
      rows: res.rows.map(rowToPairs),
      rowCount: BigInt(res.rowCount ?? 0),
    });
  } catch (e) {
    return err(nodeErrMsg(e));
  }
}

async function dbClose(handle) {
  let client;
  try { client = getClient(handle, 'dbClose'); }
  catch (e) { return err(nodeErrMsg(e)); }
  try {
    await client.end();
    return ok(undefined);
  } catch (e) {
    return err(nodeErrMsg(e));
  }
}

// ─── DbValue singleton exports ────────────────────────────────────────────────
// Zero-field variants used as bare identifiers in Pfun code (like None).
const DbNull = { __type: 'DbNull', __union: 'DbValue' };

module.exports = { dbConnect, dbQuery, dbClose, DbNull };
