'use strict';
// pfun-db-mariadb.js — runtime support for `import * from "db/mariadb"`
// in transpiled Pfun programs.
//
// Direct port of dblibMariadb.ts + the shared dblib.ts helpers.
// Requires the `mysql2` npm package at runtime: npm install mysql2
//
// Same interface as pfun-db-postgresql.js but:
//   - Uses mysql2/promise instead of pg
//   - Placeholders are `?` (positional) instead of `$1,$2,...`
//   - bigNumberStrings: true so BIGINT/DECIMAL → DbText (no precision loss)
//   - SELECT returns array of rows; INSERT/UPDATE/DELETE returns OkPacket

const { PfunByte, $registerType } = require('./pfun-runtime');

// ─── Register shared db types ─────────────────────────────────────────────────
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
function rowToPairs(row) {
  return Object.entries(row).map(([key, value]) => ({
    __type: 'Pair', key, value: sqlValueToDbValue(value),
  }));
}

// ─── Connection handle ────────────────────────────────────────────────────────
function makeConn(conn) { return { __type: 'Connection', __client: conn }; }
function getClient(handle, fnName) {
  if (!handle || handle.__type !== 'Connection' || !handle.__client)
    throw new Error(`${fnName}: requires a Connection.`);
  return handle.__client;
}

// ─── Parameter conversion ─────────────────────────────────────────────────────
function pfunValueToSql(v, fnName) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint')  return v;
  if (typeof v === 'number')  return v;
  if (typeof v === 'string')  return v;
  if (typeof v === 'boolean') return v;
  if (v instanceof PfunByte) return Buffer.from([v.value]);
  if (Array.isArray(v) && v.every(b => b instanceof PfunByte))
    return Buffer.from(v.map(b => b.value));
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

function getMysql() {
  try { return require('mysql2/promise'); }
  catch { throw new Error("db/mariadb: the 'mysql2' npm package is required. Run: npm install mysql2"); }
}

async function dbConnect(connStr) {
  if (typeof connStr !== 'string')
    throw new Error('dbConnect() requires a connection string.');
  const mysql = getMysql();
  try {
    const connection = await mysql.createConnection({
      uri: connStr,
      bigNumberStrings: true,
      decimalNumbers: false,
    });
    return ok(makeConn(connection));
  } catch (e) {
    return err(nodeErrMsg(e));
  }
}

async function dbQuery(handle, sql, params) {
  if (typeof sql !== 'string') throw new Error('dbQuery(): query must be a string.');
  let connection, sqlParams;
  try {
    connection = getClient(handle, 'dbQuery');
    sqlParams = pfunParamsToSql(params, 'dbQuery');
  } catch (e) {
    return err(nodeErrMsg(e));
  }
  try {
    const [rows] = await connection.execute(sql, sqlParams);
    if (Array.isArray(rows)) {
      return ok({
        __type: 'QueryResult',
        rows: rows.map(rowToPairs),
        rowCount: BigInt(rows.length),
      });
    }
    // INSERT/UPDATE/DELETE — OkPacket
    return ok({
      __type: 'QueryResult',
      rows: [],
      rowCount: BigInt(rows?.affectedRows ?? 0),
    });
  } catch (e) {
    return err(nodeErrMsg(e));
  }
}

async function dbClose(handle) {
  let connection;
  try { connection = getClient(handle, 'dbClose'); }
  catch (e) { return err(nodeErrMsg(e)); }
  try {
    await connection.end();
    return ok(undefined);
  } catch (e) {
    return err(nodeErrMsg(e));
  }
}

// ─── DbValue singleton exports ────────────────────────────────────────────────
const DbNull = { __type: 'DbNull', __union: 'DbValue' };

module.exports = { dbConnect, dbQuery, dbClose, DbNull };
