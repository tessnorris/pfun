'use strict';
// pfun-http.js — runtime support for `import * from "http"` in transpiled Pfun.
//
// Direct port of httplib.ts. Key differences from the interpreter version:
//   - No Scheduler/spawnPfunCallback: the compiled handler is a plain JS
//     async function called directly per request.
//   - No interp.force() / interp.stringify(): values are already plain JS;
//     $stringify() from pfun-runtime.js handles formatting.
//   - res.text / res.json / res.bytes are plain JS functions, not
//     NativeFunction instances.
//   - pfunToJsonValue uses $stringify for the fallback case.

const http = require('http');
const { URL } = require('url');
const { PfunDict, PfunByte, $stringify } = require('./pfun-runtime');

// ─── Result helpers ───────────────────────────────────────────────────────────
const ok  = v => ({ __type: 'Ok',  __union: 'HttpResult', value:   v });
const err = m => ({ __type: 'Err', __union: 'HttpResult', message: m });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dictFromRecord(rec) {
  const map = new Map();
  for (const [k, v] of Object.entries(rec)) map.set(`s:${k}`, v);
  return new PfunDict(map);
}

function bufferToByteList(buf) {
  return Array.from(buf, b => new PfunByte(b));
}

function byteListToBuffer(list, fnName) {
  if (!Array.isArray(list) || !list.every(b => b instanceof PfunByte))
    throw new Error(`${fnName}: requires a List<Byte>.`);
  return Buffer.from(list.map(b => b.value));
}

// Mirrors jsonlib's pfunToJson encoding for res.json().
function pfunToJsonValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint')  return { __pfun: 'int', v: value.toString() };
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number')  return value;
  if (typeof value === 'string')  return value;
  if (value instanceof PfunDict) {
    const obj = {};
    for (const [k, v] of value.entries.entries()) obj[k.slice(2)] = pfunToJsonValue(v);
    return obj;
  }
  if (Array.isArray(value)) return value.map(pfunToJsonValue);
  if (value && typeof value === 'object' && '__type' in value) {
    const out = { __pfun: 'record', __type: value.__type, __union: value.__union ?? null };
    for (const key of Object.keys(value)) {
      if (key === '__type' || key === '__union') continue;
      out[key] = pfunToJsonValue(value[key]);
    }
    return out;
  }
  return $stringify(value);
}

// ─── Client ───────────────────────────────────────────────────────────────────

async function httpGet(url) {
  if (typeof url !== 'string') throw new Error('httpGet() requires a URL string.');
  try {
    const res = await fetch(url);
    const body = await res.text();
    const headers = {};
    res.headers.forEach((value, key) => { headers[key] = value; });
    return ok({ status: BigInt(res.status), headers: dictFromRecord(headers), body });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

async function httpGetBytes(url) {
  if (typeof url !== 'string') throw new Error('httpGetBytes() requires a URL string.');
  try {
    const res = await fetch(url);
    const arrayBuf = await res.arrayBuffer();
    const body = bufferToByteList(Buffer.from(arrayBuf));
    const headers = {};
    res.headers.forEach((value, key) => { headers[key] = value; });
    return ok({ status: BigInt(res.status), headers: dictFromRecord(headers), body });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

// ─── Server ───────────────────────────────────────────────────────────────────

// httpListen(port, handler)
// `handler` is a compiled async function (async proc (req, res) { ... }).
// Each request spawns handler(req, res) as a plain Promise — no Scheduler
// needed since compiled async functions are real JS async functions.
function httpListen(port, handler) {
  if (typeof port !== 'bigint') throw new Error('httpListen() requires an integer port.');
  if (typeof handler !== 'function') throw new Error('httpListen() requires a function as the second argument.');

  const server = http.createServer((nodeReq, nodeRes) => {
    const chunks = [];
    nodeReq.on('data', chunk => chunks.push(chunk));
    nodeReq.on('end', () => {
      const rawBody = Buffer.concat(chunks);
      const body = rawBody.toString('utf8');
      const bodyBytes = bufferToByteList(rawBody);

      let pathname = nodeReq.url ?? '/';
      const queryEntries = new Map();
      try {
        const parsed = new URL(nodeReq.url ?? '/', `http://${nodeReq.headers.host ?? 'localhost'}`);
        pathname = parsed.pathname;
        parsed.searchParams.forEach((value, key) => queryEntries.set(`s:${key}`, value));
      } catch { /* malformed URL — fall back to raw path, empty query */ }

      const headersEntries = new Map();
      for (const [key, value] of Object.entries(nodeReq.headers)) {
        if (typeof value === 'string') headersEntries.set(`s:${key}`, value);
        else if (Array.isArray(value)) headersEntries.set(`s:${key}`, value.join(', '));
      }

      const req = {
        __type:    'Request',
        method:    nodeReq.method ?? 'GET',
        path:      pathname,
        query:     new PfunDict(queryEntries),
        headers:   new PfunDict(headersEntries),
        body,
        bodyBytes,
      };

      let responded = false;
      const send = (status, contentType, payload) => {
        if (responded) return;
        responded = true;
        if (typeof status !== 'bigint') throw new Error('Response status code must be an integer.');
        nodeRes.writeHead(Number(status), { 'Content-Type': contentType });
        nodeRes.end(payload);
      };

      const res = {
        __type: 'Response',
        text:  (status, value) => send(status, 'text/plain; charset=utf-8',
                                       typeof value === 'string' ? value : $stringify(value)),
        json:  (status, value) => send(status, 'application/json; charset=utf-8',
                                       JSON.stringify(pfunToJsonValue(value))),
        bytes: (status, byteList, contentType) => {
          if (typeof contentType !== 'string') throw new Error('res.bytes: third argument (contentType) must be a string.');
          send(status, contentType, byteListToBuffer(byteList, 'res.bytes'));
        },
      };

      Promise.resolve(handler(req, res)).catch(e => {
        const message = e instanceof Error ? e.message : String(e);
        process.stderr.write(`[httpserver] handler error: ${message}\n`);
        if (!responded) send(500n, 'text/plain; charset=utf-8', 'Internal Server Error');
      });
    });
  });

  server.listen(Number(port));
  return undefined;
}

// ─── Exports ─────────────────────────────────────────────────────────────────
module.exports = { httpGet, httpGetBytes, httpListen };
