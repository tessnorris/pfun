// src/httplib.ts
// HTTP client and server for Pfun (step 6).
// Register with: loader.registerBuiltin('http', httplibFunctions, httplibTypes)
// Use with:      import * from "http";
//
// ─── Client ─────────────────────────────────────────────────────────────────
//
//   await httpGet(url)
//
// Returns a Promise<HttpResult> — HttpResult is a Result-shaped union
// (consistent with filelib's Result), so it never rejects:
//   Ok { status, headers, body }  — status: int, headers: dict<string,string>,
//                                    body: string
//   Err { message }               — network/DNS/connection errors
//
// ─── Server ─────────────────────────────────────────────────────────────────
//
//   httpListen(port, handler)
//
// `handler` is an `async proc (req, res) { ... }`. For each incoming HTTP
// request, a fresh Request record and Response object are built and
// `handler(req, res)` is run as a new task via interp.scheduler.spawn — so
// multiple in-flight requests interleave at `await` points, and a slow
// handler does not block other requests.
//
//   Request:  { method, path, query, headers, body }
//     - method:  string ("GET", "POST", ...)
//     - path:    string (URL path, without query string)
//     - query:   dict<string,string> (parsed query parameters)
//     - headers: dict<string,string> (lower-cased header names)
//     - body:    string (raw request body)
//
//   Response: { text, json }
//     - text(statusCode, body)   — send a plain-text response
//     - json(statusCode, value)  — send `value` JSON-serialized
//
// `listen` returns immediately (it doesn't block) — the server keeps the
// Node process alive via its open socket, independent of the Scheduler. An
// uncaught error in one handler is logged to stderr and does not crash the
// server or affect other in-flight requests (Scheduler's per-task error
// isolation).

import * as http from 'http';
import { URL } from 'url';
import { Interpreter, RegistryFunction, RegistryType, PfunDict, PfunFunction, NativeFunction } from './interpreter';

// ─── Result helpers (consistent with filelib's Result convention) ────────────

const ok  = (value: any)      => ({ __type: 'Ok',  __union: 'HttpResult', value });
const err = (message: string) => ({ __type: 'Err', __union: 'HttpResult', message });

// ─── Serialization helpers ────────────────────────────────────────────────────

/**
 * Convert a JS value into a JSON-able plain value for httpserver's
 * `res.json(...)`. Mirrors jsonlib's pfunToJson encoding for the common
 * cases (records, unions, dicts, lists, primitives) so `res.json(200, x)`
 * round-trips the same way `jsonSerialize` would, without creating a
 * dependency between httplib and jsonlib.
 */
function pfunToJsonValue(interp: Interpreter, value: any): any {
  const v = interp.force(value);
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint')  return { __pfun: 'int', v: v.toString() };
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number')  return v;
  if (typeof v === 'string')  return v;
  if (v instanceof PfunDict) {
    const obj: any = {};
    for (const [k, val] of v.entries.entries()) {
      const raw = k.slice(2);
      obj[raw] = pfunToJsonValue(interp, val);
    }
    return obj;
  }
  if (Array.isArray(v)) return v.map(el => pfunToJsonValue(interp, el));
  if (v && typeof v === 'object' && '__type' in v) {
    const out: any = { __pfun: 'record', __type: v.__type, __union: v.__union ?? null };
    for (const key of Object.keys(v)) {
      if (key === '__type' || key === '__union') continue;
      out[key] = pfunToJsonValue(interp, v[key]);
    }
    return out;
  }
  // PfunChar and anything else: stringify
  return interp.stringify(v);
}

/** Build a Pfun dict<string,string> from a plain JS Record<string,string>. */
function dictFromRecord(rec: Record<string, string>): PfunDict {
  const map = new Map<string, any>();
  for (const [k, v] of Object.entries(rec)) map.set(`s:${k}`, v);
  return new PfunDict(map);
}

// ─── Built-in Types ───────────────────────────────────────────────────────────

export const httplibTypes: RegistryType[] = [
  {
    kind: 'union',
    name: 'HttpResult',
    variants: [
      { name: 'Ok',  fields: ['value'] },
      { name: 'Err', fields: ['message'] },
    ],
  },
];

// ─── Built-in Functions ───────────────────────────────────────────────────────

export const httplibFunctions: RegistryFunction[] = [

  // ─── Client ───────────────────────────────────────────────────────────────

  // httpGet(url) -> Promise<HttpResult>
  // Flat top-level name, consistent with filelib's readFile/writeFile etc.
  {
    name: 'httpGet',
    arity: 1,
    fn: (args, interp) => {
      if (interp.inPureContext) throw new Error("Functions cannot use 'httpGet': side effects are not allowed in pure functions.");
      const url = interp.force(args[0]);
      if (typeof url !== 'string') throw new Error("httpGet() requires a URL string.");
      return fetch(url)
        .then(async (res) => {
          const body = await res.text();
          const headers: Record<string, string> = {};
          res.headers.forEach((value, key) => { headers[key] = value; });
          return ok({
            status: BigInt(res.status),
            headers: dictFromRecord(headers),
            body,
          });
        })
        .catch((e: any) => err(e instanceof Error ? e.message : String(e)));
    },
  },

  // ─── Server ───────────────────────────────────────────────────────────────

  // httpListen(port, handler) -> nil
  // `handler` must be an `async proc (req, res) { ... }`. Returns
  // immediately; the server runs until the process exits.
  {
    name: 'httpListen',
    arity: 2,
    fn: (args, interp) => {
      if (interp.inPureContext) throw new Error("Functions cannot use 'httpListen': side effects are not allowed in pure functions.");
      const port    = interp.force(args[0]);
      const handler = interp.force(args[1]);
      if (typeof port !== 'bigint') throw new Error("httpListen() requires an integer port.");
      if (!(handler instanceof PfunFunction)) throw new Error("httpListen() requires a function/proc as the second argument.");

      const server = http.createServer((nodeReq, nodeRes) => {
        const chunks: Buffer[] = [];
        nodeReq.on('data', (chunk) => chunks.push(chunk));
        nodeReq.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');

          let pathname = nodeReq.url ?? '/';
          const queryEntries = new Map<string, any>();
          try {
            const parsed = new URL(nodeReq.url ?? '/', `http://${nodeReq.headers.host ?? 'localhost'}`);
            pathname = parsed.pathname;
            parsed.searchParams.forEach((value, key) => { queryEntries.set(`s:${key}`, value); });
          } catch { /* malformed URL — fall back to raw path, empty query */ }

          const headersEntries = new Map<string, any>();
          for (const [key, value] of Object.entries(nodeReq.headers)) {
            if (typeof value === 'string') headersEntries.set(`s:${key}`, value);
            else if (Array.isArray(value)) headersEntries.set(`s:${key}`, value.join(', '));
          }

          const reqRecord = {
            __type: 'Request',
            method: nodeReq.method ?? 'GET',
            path: pathname,
            query: new PfunDict(queryEntries),
            headers: new PfunDict(headersEntries),
            body,
          };

          let responded = false;
          const send = (status: bigint, contentType: string, payload: string) => {
            if (responded) return;
            responded = true;
            if (typeof status !== 'bigint') throw new Error("Response status code must be an integer.");
            nodeRes.writeHead(Number(status), { 'Content-Type': contentType });
            nodeRes.end(payload);
          };

          const resRecord = {
            __type: 'Response',
            text: new NativeFunction((textArgs, textInterp) => {
              if (textInterp.inPureContext) throw new Error("Functions cannot use 'res.text': side effects are not allowed in pure functions.");
              const status = textInterp.force(textArgs[0]);
              const value  = textInterp.force(textArgs[1]);
              send(status, 'text/plain; charset=utf-8', typeof value === 'string' ? value : textInterp.stringify(value));
              return undefined;
            }, 2),
            json: new NativeFunction((jsonArgs, jsonInterp) => {
              if (jsonInterp.inPureContext) throw new Error("Functions cannot use 'res.json': side effects are not allowed in pure functions.");
              const status    = jsonInterp.force(jsonArgs[0]);
              const value     = jsonArgs[1];
              const jsonValue = pfunToJsonValue(jsonInterp, value);
              send(status, 'application/json; charset=utf-8', JSON.stringify(jsonValue));
              return undefined;
            }, 2),
          };

          // Spawn the handler as its own task — multiple in-flight requests
          // interleave at `await` points (see Scheduler).
          interp.scheduler.spawn(
            handler.executeGen([reqRecord, resRecord], interp),
            (e: unknown) => {
              const message = e instanceof Error ? e.message : String(e);
              // eslint-disable-next-line no-console
              console.error(`[httpserver] handler error: ${message}`);
              if (!responded) send(500n, 'text/plain; charset=utf-8', 'Internal Server Error');
            },
          );
        });
      });

      server.listen(Number(port));
      interp._resources.push({ close: () => server.close() });
      return undefined;
    },
  },
];
