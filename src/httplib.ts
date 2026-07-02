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
//                                    body: string (decoded as UTF-8)
//   Err { message }               — network/DNS/connection errors
//
//   await httpGetBytes(url)
//
// Identical to httpGet, but the body is returned as List<Byte> (raw,
// undecoded bytes) instead of a UTF-8 string — use this for binary content
// (images, PDFs, archives, ...) where UTF-8 decoding would corrupt the data:
//   Ok { status, headers, body }  — body: List<Byte>
//   Err { message }
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
//   Request:  { method, path, query, headers, body, bodyBytes }
//     - method:    string ("GET", "POST", ...)
//     - path:      string (URL path, without query string)
//     - query:     dict<string,string> (parsed query parameters)
//     - headers:   dict<string,string> (lower-cased header names)
//     - body:      string (raw request body, decoded as UTF-8 — may contain
//                  the U+FFFD replacement character if the body isn't valid
//                  UTF-8, e.g. for binary uploads; use bodyBytes instead)
//     - bodyBytes: List<Byte> (raw request body, undecoded — use this for
//                  binary uploads such as images or file attachments)
//
//   Response: { text, json, bytes }
//     - text(statusCode, body)                — send a plain-text response
//     - json(statusCode, value)                — send `value` JSON-serialized
//     - bytes(statusCode, byteList, contentType) — send raw List<Byte> with
//       the given Content-Type (e.g. "image/png", "application/octet-stream")
//
// `listen` returns immediately (it doesn't block) — the server keeps the
// Node process alive via its open socket, independent of the Scheduler. An
// uncaught error in one handler is logged to stderr and does not crash the
// server or affect other in-flight requests (Scheduler's per-task error
// isolation).

import * as http from 'http';
import { URL } from 'url';
import { Interpreter, RegistryFunction, RegistryType, PfunDict, PfunFunction, NativeFunction, PfunByte } from './interpreter';

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

/** Convert a Node Buffer into a Pfun List<Byte>. */
function bufferToByteList(buf: Buffer): PfunByte[] {
  return Array.from(buf, b => new PfunByte(b));
}

/** Convert a Pfun List<Byte> into a Node Buffer, for sending as a response body. */
function byteListToBuffer(list: any, fnName: string): Buffer {
  if (!Array.isArray(list) || !list.every((b: any) => b instanceof PfunByte)) {
    throw new Error(`${fnName}: requires a List<Byte>.`);
  }
  return Buffer.from(list.map((b: PfunByte) => b.value));
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

  // httpGetBytes(url) -> Promise<HttpResult>
  // Same as httpGet, but the body is returned as List<Byte> (raw, undecoded
  // bytes) — use for binary content (images, PDFs, archives, ...) where
  // UTF-8 decoding would corrupt the data.
  {
    name: 'httpGetBytes',
    arity: 1,
    fn: (args, interp) => {
      if (interp.inPureContext) throw new Error("Functions cannot use 'httpGetBytes': side effects are not allowed in pure functions.");
      const url = interp.force(args[0]);
      if (typeof url !== 'string') throw new Error("httpGetBytes() requires a URL string.");
      return fetch(url)
        .then(async (res) => {
          const arrayBuf = await res.arrayBuffer();
          const body = bufferToByteList(Buffer.from(arrayBuf));
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
          const rawBody = Buffer.concat(chunks);
          const body = rawBody.toString('utf8');
          const bodyBytes = bufferToByteList(rawBody);

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
            bodyBytes,
          };

          let responded = false;
          const send = (status: bigint, contentType: string, payload: string | Buffer) => {
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
            bytes: new NativeFunction((bytesArgs, bytesInterp) => {
              if (bytesInterp.inPureContext) throw new Error("Functions cannot use 'res.bytes': side effects are not allowed in pure functions.");
              const status      = bytesInterp.force(bytesArgs[0]);
              const byteList    = bytesInterp.force(bytesArgs[1]);
              const contentType = bytesInterp.force(bytesArgs[2]);
              if (typeof contentType !== 'string') throw new Error("res.bytes: third argument (contentType) must be a string.");
              const buf = byteListToBuffer(byteList, 'res.bytes');
              send(status, contentType, buf);
              return undefined;
            }, 3),
          };

          // Spawn the handler as its own task — multiple in-flight requests
          // interleave at `await` points (see Scheduler / spawnPfunCallback).
          interp.spawnPfunCallback(
            handler,
            [reqRecord, resRecord],
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

  // ─── Extended client ──────────────────────────────────────────────────────

  // httpRequest(method, url, headers, body) -> Promise<HttpResult>
  // General HTTP client supporting arbitrary methods, request headers, and body.
  //   method  : Str — "GET", "POST", "PUT", "PATCH", "DELETE", etc.
  //   url     : Str — full URL including scheme
  //   headers : Dict<Str,Str> — request headers; pass empty dict for none
  //   body    : Str — request body; pass "" to omit (required for GET/HEAD)
  // Returns Ok { status, headers, body } (body is UTF-8 string) or Err { message }.
  {
    name: 'httpRequest',
    arity: 4,
    fn: (args, interp) => {
      if (interp.inPureContext) throw new Error("Functions cannot use 'httpRequest': side effects are not allowed in pure functions.");
      const method  = interp.force(args[0]);
      const url     = interp.force(args[1]);
      const headers = interp.force(args[2]);
      const body    = interp.force(args[3]);
      if (typeof method !== 'string') throw new Error("httpRequest() requires a string method.");
      if (typeof url    !== 'string') throw new Error("httpRequest() requires a string URL.");
      if (typeof body   !== 'string') throw new Error("httpRequest() requires a string body (pass \"\" for no body).");
      const headersObj: Record<string, string> = {};
      if (headers instanceof PfunDict) {
        for (const [k, v] of headers.entries.entries()) {
          if (typeof v === 'string') headersObj[k.slice(2)] = v;
        }
      }
      const fetchOpts: RequestInit = { method, headers: headersObj };
      if (body !== '') fetchOpts.body = body;
      return fetch(url, fetchOpts)
        .then(async (res) => {
          const resBody = await res.text();
          const resHeaders: Record<string, string> = {};
          res.headers.forEach((value, key) => { resHeaders[key] = value; });
          return ok({ status: BigInt(res.status), headers: dictFromRecord(resHeaders), body: resBody });
        })
        .catch((e: any) => err(e instanceof Error ? e.message : String(e)));
    },
  },

  // httpRequestBytes(method, url, headers, body) -> Promise<HttpResult>
  // Identical to httpRequest but the response body is returned as List<Byte>.
  {
    name: 'httpRequestBytes',
    arity: 4,
    fn: (args, interp) => {
      if (interp.inPureContext) throw new Error("Functions cannot use 'httpRequestBytes': side effects are not allowed in pure functions.");
      const method  = interp.force(args[0]);
      const url     = interp.force(args[1]);
      const headers = interp.force(args[2]);
      const body    = interp.force(args[3]);
      if (typeof method !== 'string') throw new Error("httpRequestBytes() requires a string method.");
      if (typeof url    !== 'string') throw new Error("httpRequestBytes() requires a string URL.");
      if (typeof body   !== 'string') throw new Error("httpRequestBytes() requires a string body (pass \"\" for no body).");
      const headersObj: Record<string, string> = {};
      if (headers instanceof PfunDict) {
        for (const [k, v] of headers.entries.entries()) {
          if (typeof v === 'string') headersObj[k.slice(2)] = v;
        }
      }
      const fetchOpts: RequestInit = { method, headers: headersObj };
      if (body !== '') fetchOpts.body = body;
      return fetch(url, fetchOpts)
        .then(async (res) => {
          const arrayBuf = await res.arrayBuffer();
          const resBody = bufferToByteList(Buffer.from(arrayBuf));
          const resHeaders: Record<string, string> = {};
          res.headers.forEach((value, key) => { resHeaders[key] = value; });
          return ok({ status: BigInt(res.status), headers: dictFromRecord(resHeaders), body: resBody });
        })
        .catch((e: any) => err(e instanceof Error ? e.message : String(e)));
    },
  },

  // fetchWithTimeout(url, ms) -> Promise<HttpResult>
  // GET request aborted with Err if no response arrives within ms milliseconds.
  // Uses AbortController so the in-flight connection is cancelled on timeout.
  //   url : Str — full URL
  //   ms  : Int — timeout in milliseconds
  // Returns Ok { status, headers, body } or Err { message } on timeout/error.
  {
    name: 'fetchWithTimeout',
    arity: 2,
    fn: (args, interp) => {
      if (interp.inPureContext) throw new Error("Functions cannot use 'fetchWithTimeout': side effects are not allowed in pure functions.");
      const url = interp.force(args[0]);
      const ms  = interp.force(args[1]);
      if (typeof url !== 'string') throw new Error("fetchWithTimeout() requires a string URL.");
      if (typeof ms !== 'bigint') throw new Error("fetchWithTimeout() requires an integer timeout in milliseconds.");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Number(ms));
      return fetch(url, { signal: controller.signal })
        .then(async (res) => {
          clearTimeout(timer);
          const body = await res.text();
          const headers: Record<string, string> = {};
          res.headers.forEach((value, key) => { headers[key] = value; });
          return ok({ status: BigInt(res.status), headers: dictFromRecord(headers), body });
        })
        .catch((e: any) => {
          clearTimeout(timer);
          const msg = e instanceof Error ? e.message : String(e);
          return err(e.name === "AbortError" ? `timeout after ${Number(ms)}ms` : msg);
        });
    },
  },

  // urlEncode(s) -> Str
  // Percent-encode a string for use in a URL query parameter value.
  // Wraps JavaScript's encodeURIComponent — encodes everything except
  // A-Z a-z 0-9 - _ . ! ~ * ' ( )
  // Pure function: no side effects, usable in both functions and procs.
  {
    name: 'urlEncode',
    arity: 1,
    fn: (args, interp) => {
      const s = interp.force(args[0]);
      if (typeof s !== 'string') throw new Error("urlEncode() requires a string.");
      return encodeURIComponent(s);
    },
  },
];
