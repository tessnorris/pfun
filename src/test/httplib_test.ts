// src/test/httplib.test.ts
//
// Step 6: httplib (httpGet client, httpListen server) + asynclib (sleep)
// integration tests. Covers:
//   - httpGet against a real (Node-native) test server: success + headers/body
//   - httpGet error path: connection refused -> Err
//   - httpListen: a Pfun async proc handler serving real HTTP requests
//   - httpListen + httpGet together: concurrency — a fast route responds
//     before a slow route that was requested first (Scheduler interleaving)
//   - sleep(ms): basic resolution + non-blocking (other tasks progress)

import * as http from 'http';
import { AddressInfo } from 'net';
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Interpreter } from '../interpreter';
import { stdlibFunctions, stdlibTypes } from '../library';
import { mutStructuresFunctions, mutStructuresTypes } from '../mutStructures';
import { iolibFunctions } from '../iolib';
import { httplibFunctions, httplibTypes } from '../httplib';
import { asynclibFunctions } from '../asynclib';

const createdInterpreters: Interpreter[] = [];

const makeInterpreter = () => {
  const interpreter = new Interpreter();
  interpreter.registerLibrary(stdlibFunctions, stdlibTypes);
  interpreter.registerLibrary(mutStructuresFunctions, mutStructuresTypes);
  interpreter.registerLibrary(iolibFunctions, []);
  interpreter.registerLibrary(httplibFunctions, httplibTypes);
  interpreter.registerLibrary(asynclibFunctions, []);
  createdInterpreters.push(interpreter);
  return interpreter;
};

afterEach(() => {
  // Close any http.Server instances created via httpListen during this test
  // (registered in interp._resources) so they don't keep Jest's process
  // alive or accumulate across tests.
  for (const interp of createdInterpreters) {
    for (const resource of interp._resources) resource.close();
    interp._resources.length = 0;
  }
  createdInterpreters.length = 0;
});

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

/** Start a plain Node http server on a random free port, returning {server, port}. */
function startNodeServer(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, port });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()));
}

/** Find a free TCP port for an httpListen test by briefly binding to port 0. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

describe('httplib (phase 6)', () => {

  // ─── Additional test helpers for new client functions ─────────────────────

  /** Start a plain Node http server on a random free port. Returns the server directly. */
  async function startServer(handler: http.RequestListener): Promise<http.Server> {
    return new Promise(resolve => {
      const server = http.createServer(handler);
      server.listen(0, '127.0.0.1', () => resolve(server));
    });
  }

  /** Return http://127.0.0.1:<port> for a server. */
  function serverUrl(server: http.Server): string {
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  /** Run a synchronous Pfun program (no async needed). */
  function runSyncProgram(source: string) {
    const interp = makeInterpreter();
    const ast = new Parser(new Lexer(source).lex()).parse();
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: any[]) => logs.push(a.map(String).join(' '));
    try { interp.interpret(ast, source); }
    finally { console.log = orig; }
    return { logs };
  }

  describe('httpGet against a real server', () => {
    it('returns Ok with status, headers, and body for a successful response', async () => {
      const { server, port } = await startNodeServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'X-Custom': 'hello' });
        res.end('Hello, world!');
      });
      try {
        const { logs } = await runAsyncProgram(`
          async proc p() {
            let result = await httpGet("http://127.0.0.1:${port}/");
            match result with
            | Ok r -> {
                println(r.value.status);
                println(r.value.body);
                println(r.value.headers["x-custom"]);
              }
            | Err e -> println("error: " + e.message);
          }
          p();
        `);
        expect(logs).toEqual(['200', 'Hello, world!', 'hello']);
      } finally {
        await closeServer(server);
      }
    });

    it('returns Err for a connection that is refused', async () => {
      // Find a free port, then DON'T listen on it — connection should be refused.
      const port = await findFreePort();
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let result = await httpGet("http://127.0.0.1:${port}/");
          match result with
          | Ok r  -> println("ok: " + r.value.status)
          | Err e -> println("error");
        }
        p();
      `);
      expect(logs).toEqual(['error']);
    });
  });

  describe('httpListen with a Pfun handler', () => {
    it('serves a request via res.text', async () => {
      const port = await findFreePort();
      const interpreter = makeInterpreter();
      // httpListen returns immediately; the program "finishes" while the
      // server keeps running. We drive a follow-up fetch from the test
      // itself (real Node fetch) against the Pfun-served port.
      await runAsyncProgram(`
        async proc handle(req, res) {
          res.text(200, "Hello from Pfun: " + req.path);
        }
        httpListen(${port}, handle);
      `, interpreter);

      const res = await fetch(`http://127.0.0.1:${port}/greet`);
      const body = await res.text();
      expect(res.status).toBe(200);
      expect(body).toBe('Hello from Pfun: /greet');
    });

    it('serves JSON via res.json, reflecting request headers and query', async () => {
      const port = await findFreePort();
      const interpreter = makeInterpreter();
      await runAsyncProgram(`
        async proc handle(req, res) {
          res.json(200, dict {
            "method" -> req.method,
            "path" -> req.path,
            "name" -> req.query["name"]
          });
        }
        httpListen(${port}, handle);
      `, interpreter);

      const res = await fetch(`http://127.0.0.1:${port}/api/echo?name=pfun`);
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.method).toBe('GET');
      expect(json.path).toBe('/api/echo');
      expect(json.name).toBe('pfun');
    });

    it('an async handler can itself await (e.g. sleep) before responding', async () => {
      const port = await findFreePort();
      const interpreter = makeInterpreter();
      await runAsyncProgram(`
        async proc handle(req, res) {
          await sleep(5);
          res.text(200, "delayed");
        }
        httpListen(${port}, handle);
      `, interpreter);

      const res = await fetch(`http://127.0.0.1:${port}/`);
      const body = await res.text();
      expect(body).toBe('delayed');
    });

    it('an error in one handler returns 500 without crashing the server', async () => {
      const port = await findFreePort();
      const interpreter = makeInterpreter();
      // Suppress the expected console.error from the handler error.
      const originalError = console.error;
      console.error = () => {};
      try {
        await runAsyncProgram(`
          async proc handle(req, res) {
            if req.path == "/boom" then {
              eval head([]);
            } else {
              res.text(200, "ok");
            }
          }
          httpListen(${port}, handle);
        `, interpreter);

        const boomRes = await fetch(`http://127.0.0.1:${port}/boom`);
        expect(boomRes.status).toBe(500);

        const okRes = await fetch(`http://127.0.0.1:${port}/fine`);
        expect(okRes.status).toBe(200);
        expect(await okRes.text()).toBe('ok');
      } finally {
        console.error = originalError;
      }
    });
  });

  describe('httpListen + httpGet concurrency', () => {
    it('a /fast route responds before a /slow route requested earlier', async () => {
      const port = await findFreePort();
      const interpreter = makeInterpreter();
      await runAsyncProgram(`
        async proc handle(req, res) {
          if req.path == "/slow" then {
            await sleep(50);
            res.text(200, "slow");
          } else {
            res.text(200, "fast");
          }
        }
        httpListen(${port}, handle);
      `, interpreter);

      const order: string[] = [];
      const slowPromise = fetch(`http://127.0.0.1:${port}/slow`)
        .then(r => r.text())
        .then(body => { order.push(body); });
      // Give the slow request a head start, then fire the fast one.
      await new Promise(r => setTimeout(r, 5));
      const fastPromise = fetch(`http://127.0.0.1:${port}/fast`)
        .then(r => r.text())
        .then(body => { order.push(body); });

      await Promise.all([slowPromise, fastPromise]);
      expect(order).toEqual(['fast', 'slow']);
    });

    it('a Pfun client can talk to a Pfun server (both sides via this interpreter)', async () => {
      const port = await findFreePort();
      const interpreter = makeInterpreter();
      const { logs } = await runAsyncProgram(`
        async proc handle(req, res) {
          res.text(200, "pong");
        }
        httpListen(${port}, handle);

        async proc client() {
          await sleep(5); // let the server start accepting
          let result = await httpGet("http://127.0.0.1:${port}/ping");
          match result with
          | Ok r  -> println(r.value.body)
          | Err e -> println("error: " + e.message);
        }
        client();
      `, interpreter);
      expect(logs).toEqual(['pong']);
    });
  });

  describe('httpGetBytes against a real server', () => {
    it('returns Ok with status, headers, and body as List<Byte> for binary content', async () => {
      const pngBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]); // PNG magic bytes
      const { server, port } = await startNodeServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(pngBytes);
      });
      try {
        const { logs } = await runAsyncProgram(`
          async proc p() {
            let result = await httpGetBytes("http://127.0.0.1:${port}/");
            match result with
            | Ok r -> {
                println(r.value.status);
                println(length(r.value.body));
                println(nth(r.value.body, 0));
                println(nth(r.value.body, 1));
              }
            | Err e -> println("error: " + e.message);
          }
          p();
        `);
        expect(logs).toEqual(['200', '8', '137', '80']); // 0x89=137, 0x50=80
      } finally {
        await closeServer(server);
      }
    });

    it('preserves bytes that would corrupt under UTF-8 decoding', async () => {
      // 0xFF 0xFE is invalid UTF-8 and would be mangled by .text()
      const rawBytes = Buffer.from([0xFF, 0xFE, 0x00, 0x01]);
      const { server, port } = await startNodeServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(rawBytes);
      });
      try {
        const { logs } = await runAsyncProgram(`
          async proc p() {
            let result = await httpGetBytes("http://127.0.0.1:${port}/");
            match result with
            | Ok r -> {
                println(nth(r.value.body, 0));
                println(nth(r.value.body, 1));
                println(nth(r.value.body, 2));
                println(nth(r.value.body, 3));
              }
            | Err e -> println("error: " + e.message);
          }
          p();
        `);
        expect(logs).toEqual(['255', '254', '0', '1']);
      } finally {
        await closeServer(server);
      }
    });

    it('returns Err for a connection that is refused', async () => {
      const port = await findFreePort();
      const { logs } = await runAsyncProgram(`
        async proc p() {
          let result = await httpGetBytes("http://127.0.0.1:${port}/");
          match result with
          | Ok r  -> println("ok: " + r.value.status)
          | Err e -> println("error");
        }
        p();
      `);
      expect(logs).toEqual(['error']);
    });
  });

  describe('httpListen — binary request/response handling', () => {
    it('Request.bodyBytes contains the raw, undecoded request body', async () => {
      const port = await findFreePort();
      const interpreter = makeInterpreter();
      await runAsyncProgram(`
        async proc handle(req, res) {
          res.text(200, "" + length(req.bodyBytes) + ":" + nth(req.bodyBytes, 0));
        }
        httpListen(${port}, handle);
      `, interpreter);

      const res = await fetch(`http://127.0.0.1:${port}/upload`, {
        method: 'POST',
        body: Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]),
      });
      const body = await res.text();
      expect(body).toBe('4:222'); // 4 bytes, first byte 0xDE = 222
    });

    it('Request.body and Request.bodyBytes both reflect the same underlying data for text', async () => {
      const port = await findFreePort();
      const interpreter = makeInterpreter();
      await runAsyncProgram(`
        async proc handle(req, res) {
          res.text(200, req.body + "|" + length(req.bodyBytes));
        }
        httpListen(${port}, handle);
      `, interpreter);

      const res = await fetch(`http://127.0.0.1:${port}/echo`, {
        method: 'POST',
        body: 'hello',
      });
      const body = await res.text();
      expect(body).toBe('hello|5');
    });

    it('res.bytes sends raw bytes with the given Content-Type', async () => {
      const port = await findFreePort();
      const interpreter = makeInterpreter();
      await runAsyncProgram(`
        async proc handle(req, res) {
          res.bytes(200, [0x89b, 0x50b, 0x4Eb, 0x47b], "image/png");
        }
        httpListen(${port}, handle);
      `, interpreter);

      const res = await fetch(`http://127.0.0.1:${port}/image`);
      const buf = Buffer.from(await res.arrayBuffer());
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(buf).toEqual(Buffer.from([0x89, 0x50, 0x4E, 0x47]));
    });

    it('res.bytes round-trips through httpGetBytes', async () => {
      const port = await findFreePort();
      const interpreter = makeInterpreter();
      const { logs } = await runAsyncProgram(`
        async proc handle(req, res) {
          res.bytes(200, [0x01b, 0x02b, 0x03b], "application/octet-stream");
        }
        httpListen(${port}, handle);

        async proc client() {
          await sleep(5);
          let result = await httpGetBytes("http://127.0.0.1:${port}/data");
          match result with
          | Ok r  -> println(length(r.value.body) + ":" + nth(r.value.body, 2))
          | Err e -> println("error: " + e.message);
        }
        client();
      `, interpreter);
      expect(logs).toEqual(['3:3']);
    });

    it('a Pfun client uploads binary data to a Pfun server', async () => {
      const port = await findFreePort();
      const interpreter = makeInterpreter();
      const { logs } = await runAsyncProgram(`
        async proc handle(req, res) {
          res.text(200, "received " + length(req.bodyBytes) + " bytes, sum of first two = " + (toInt(nth(req.bodyBytes, 0)) + toInt(nth(req.bodyBytes, 1))));
        }
        httpListen(${port}, handle);
      `, interpreter);

      const res = await fetch(`http://127.0.0.1:${port}/upload`, {
        method: 'POST',
        body: Buffer.from([10, 20, 30]),
      });
      const body = await res.text();
      expect(body).toBe('received 3 bytes, sum of first two = 30');
    });
  });

  describe('asynclib sleep', () => {
    it('resolves after approximately the requested delay', async () => {
      const start = Date.now();
      const { logs } = await runAsyncProgram(`
        async proc p() {
          await sleep(20);
          println("done");
        }
        p();
      `);
      const elapsed = Date.now() - start;
      expect(logs).toEqual(['done']);
      expect(elapsed).toBeGreaterThanOrEqual(15);
    });

    it('rejects sleep() in a pure function', async () => {
      await expect(runAsyncProgram(`
        async function f() {
          return await sleep(1);
        }
        async proc p() { println(f()); }
        p();
      `)).rejects.toThrow(/side effects are not allowed in pure functions/);
    });

    it('multiple concurrently-sleeping handlers complete in delay order', async () => {
      const port = await findFreePort();
      const interpreter = makeInterpreter();
      await runAsyncProgram(`
        async proc handle(req, res) {
          if req.path == "/a" then { await sleep(30); res.text(200, "a"); }
          else if req.path == "/b" then { await sleep(10); res.text(200, "b"); }
          else { res.text(200, "c"); }
        }
        httpListen(${port}, handle);
      `, interpreter);

      const order: string[] = [];
      const pA = fetch(`http://127.0.0.1:${port}/a`).then(r => r.text()).then(b => order.push(b));
      const pB = fetch(`http://127.0.0.1:${port}/b`).then(r => r.text()).then(b => order.push(b));
      const pC = fetch(`http://127.0.0.1:${port}/c`).then(r => r.text()).then(b => order.push(b));
      await Promise.all([pA, pB, pC]);
      expect(order).toEqual(['c', 'b', 'a']);
    });
  });

  // ─── httpRequest ────────────────────────────────────────────────────────────

  describe('httpRequest', () => {
    it('GET: returns Ok with status, headers, and body', async () => {
      const server = await startServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'X-Custom': 'hello' });
        res.end('got it');
      });
      try {
        const result = await runAsyncProgram(`
          async proc main() {
            match await httpRequest("GET", "${serverUrl(server)}/", listToDict([]), "") with
            | Err e -> println("err:" + e.message)
            | Ok  r -> {
                println(__str__(r.value.status));
                println(r.value.body);
              };
          }
          main();
        `);
        expect(result.logs).toEqual(['200', 'got it']);
      } finally { server.close(); }
    });

    it('POST: sends method, custom headers, and body', async () => {
      const server = await startServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          res.writeHead(201, { 'Content-Type': 'text/plain' });
          res.end(`${req.method}:${req.headers['x-token'] ?? 'none'}:${body}`);
        });
      });
      try {
        const result = await runAsyncProgram(`
          async proc main() {
            var headers = listToDict([Pair { "x-token", "secret" }]);
            match await httpRequest("POST", "${serverUrl(server)}/data", headers, "payload") with
            | Err e -> println("err:" + e.message)
            | Ok  r -> println(r.value.body);
          }
          main();
        `);
        expect(result.logs).toEqual(['POST:secret:payload']);
      } finally { server.close(); }
    });

    it('PUT updates a resource', async () => {
      const server = await startServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(req.method ?? '');
      });
      try {
        const result = await runAsyncProgram(`
          async proc main() {
            match await httpRequest("PUT", "${serverUrl(server)}/", listToDict([]), "data") with
            | Err e -> println("err:" + e.message)
            | Ok  r -> println(r.value.body);
          }
          main();
        `);
        expect(result.logs).toEqual(['PUT']);
      } finally { server.close(); }
    });

    it('returns response headers in the Ok value', async () => {
      const server = await startServer((_req, res) => {
        res.writeHead(200, { 'X-My-Header': 'my-value', 'Content-Type': 'text/plain' });
        res.end('ok');
      });
      try {
        const result = await runAsyncProgram(`
          async proc main() {
            match await httpRequest("GET", "${serverUrl(server)}/", listToDict([]), "") with
            | Err e -> println("err:" + e.message)
            | Ok  r -> {
                if has(r.value.headers, "x-my-header")
                then println(r.value.headers["x-my-header"])
                else println("missing");
              };
          }
          main();
        `);
        expect(result.logs).toEqual(['my-value']);
      } finally { server.close(); }
    });

    it('returns Err for connection refused', async () => {
      const result = await runAsyncProgram(`
        async proc main() {
          match await httpRequest("GET", "http://localhost:1", listToDict([]), "") with
          | Err _ -> println("err")
          | Ok  _ -> println("ok");
        }
        main();
      `);
      expect(result.logs).toEqual(['err']);
    });

    it('rejects non-string method', async () => {
      await expect(async () => runAsyncProgram(`
        async proc main() { eval await httpRequest(42, "http://x", listToDict([]), ""); }
        main();
      `)).rejects.toThrow('string method');
    });

    it('rejects non-string URL', async () => {
      await expect(async () => runAsyncProgram(`
        async proc main() { eval await httpRequest("GET", 42, listToDict([]), ""); }
        main();
      `)).rejects.toThrow('string URL');
    });

    it('rejects non-string body', async () => {
      await expect(async () => runAsyncProgram(`
        async proc main() { eval await httpRequest("GET", "http://x", listToDict([]), 42); }
        main();
      `)).rejects.toThrow('string body');
    });

    it('throws in pure functions', async () => {
      await expect(runAsyncProgram(`
        function bad() { return httpRequest("GET", "http://x", listToDict([]), ""); }
        bad();
      `)).rejects.toThrow('side effects are not allowed in pure functions');
    });
  });

  // ─── httpRequestBytes ────────────────────────────────────────────────────────

  describe('httpRequestBytes', () => {
    it('returns the response body as List<Byte>', async () => {
      const payload = Buffer.from([0x01, 0x02, 0x03, 0xff]);
      const server = await startServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(payload);
      });
      try {
        const result = await runAsyncProgram(`
          async proc main() {
            match await httpRequestBytes("GET", "${serverUrl(server)}/", listToDict([]), "") with
            | Err e -> println("err:" + e.message)
            | Ok  r -> {
                println(__str__(length(r.value.body)));
                println(__str__(toInt(head(r.value.body))));
              };
          }
          main();
        `);
        expect(result.logs).toEqual(['4', '1']);
      } finally { server.close(); }
    });

    it('POST with body and binary response', async () => {
      const server = await startServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          const received = Buffer.concat(chunks);
          res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
          res.end(received); // echo back the body as bytes
        });
      });
      try {
        const result = await runAsyncProgram(`
          async proc main() {
            match await httpRequestBytes("POST", "${serverUrl(server)}/", listToDict([]), "hi") with
            | Err e -> println("err:" + e.message)
            | Ok  r -> println(__str__(length(r.value.body)));
          }
          main();
        `);
        expect(result.logs).toEqual(['2']); // "hi" = 2 bytes
      } finally { server.close(); }
    });

    it('preserves bytes that would corrupt under UTF-8 decode', async () => {
      const rawBytes = Buffer.from([0x80, 0x81, 0xff]);
      const server = await startServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(rawBytes);
      });
      try {
        const result = await runAsyncProgram(`
          async proc main() {
            match await httpRequestBytes("GET", "${serverUrl(server)}/", listToDict([]), "") with
            | Err e -> println("err:" + e.message)
            | Ok  r -> {
                println(__str__(length(r.value.body)));
                println(__str__(toInt(nth(r.value.body, 2))));
              };
          }
          main();
        `);
        expect(result.logs).toEqual(['3', '255']);
      } finally { server.close(); }
    });

    it('returns Err for connection refused', async () => {
      const result = await runAsyncProgram(`
        async proc main() {
          match await httpRequestBytes("GET", "http://localhost:1", listToDict([]), "") with
          | Err _ -> println("err")
          | Ok  _ -> println("ok");
        }
        main();
      `);
      expect(result.logs).toEqual(['err']);
    });

    it('throws in pure functions', async () => {
      await expect(runAsyncProgram(`
        function bad() { return httpRequestBytes("GET", "http://x", listToDict([]), ""); }
        bad();
      `)).rejects.toThrow('side effects are not allowed in pure functions');
    });
  });

  // ─── fetchWithTimeout ────────────────────────────────────────────────────────

  describe('fetchWithTimeout', () => {
    it('returns Ok for a fast response', async () => {
      const server = await startServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('fast');
      });
      try {
        const result = await runAsyncProgram(`
          async proc main() {
            match await fetchWithTimeout("${serverUrl(server)}/", 5000) with
            | Err e -> println("err:" + e.message)
            | Ok  r -> println(r.value.body);
          }
          main();
        `);
        expect(result.logs).toEqual(['fast']);
      } finally { server.close(); }
    });

    it('returns Err with timeout message when server is too slow', async () => {
      // Server that delays longer than the timeout
      const server = await startServer((_req, res) => {
        setTimeout(() => { res.writeHead(200); res.end('slow'); }, 500);
      });
      try {
        const result = await runAsyncProgram(`
          async proc main() {
            match await fetchWithTimeout("${serverUrl(server)}/", 50) with
            | Err e -> println(e.message)
            | Ok  r -> println("ok:" + r.value.body);
          }
          main();
        `);
        expect(result.logs[0]).toMatch(/timeout after 50ms/);
      } finally { server.close(); }
    });

    it('returns Err for connection refused', async () => {
      const result = await runAsyncProgram(`
        async proc main() {
          match await fetchWithTimeout("http://localhost:1", 1000) with
          | Err _ -> println("err")
          | Ok  _ -> println("ok");
        }
        main();
      `);
      expect(result.logs).toEqual(['err']);
    });

    it('includes status and headers in the Ok value', async () => {
      const server = await startServer((_req, res) => {
        res.writeHead(202, { 'Content-Type': 'text/plain', 'X-Foo': 'bar' });
        res.end('accepted');
      });
      try {
        const result = await runAsyncProgram(`
          async proc main() {
            match await fetchWithTimeout("${serverUrl(server)}/", 5000) with
            | Err e -> println("err:" + e.message)
            | Ok  r -> {
                println(__str__(r.value.status));
                println(r.value.body);
              };
          }
          main();
        `);
        expect(result.logs).toEqual(['202', 'accepted']);
      } finally { server.close(); }
    });

    it('rejects non-string URL', async () => {
      await expect(async () => runAsyncProgram(`
        async proc main() { eval await fetchWithTimeout(42, 1000); }
        main();
      `)).rejects.toThrow('string URL');
    });

    it('rejects non-integer timeout', async () => {
      await expect(async () => runAsyncProgram(`
        async proc main() { eval await fetchWithTimeout("http://x", 1.5); }
        main();
      `)).rejects.toThrow('integer timeout');
    });

    it('throws in pure functions', async () => {
      await expect(runAsyncProgram(`
        function bad() { return fetchWithTimeout("http://x", 1000); }
        bad();
      `)).rejects.toThrow('side effects are not allowed in pure functions');
    });
  });

  // ─── urlEncode ──────────────────────────────────────────────────────────────

  describe('urlEncode', () => {
    it('encodes spaces as %20', () => {
      const result = runSyncProgram(`
        proc main() { println(urlEncode("hello world")); }
        main();
      `);
      expect(result.logs).toEqual(['hello%20world']);
    });

    it('encodes special query characters', () => {
      const result = runSyncProgram(`
        proc main() { println(urlEncode("a=1&b=2")); }
        main();
      `);
      expect(result.logs).toEqual(['a%3D1%26b%3D2']);
    });

    it('leaves unreserved characters unchanged', () => {
      const result = runSyncProgram(`
        proc main() { println(urlEncode("hello-world_123")); }
        main();
      `);
      expect(result.logs).toEqual(['hello-world_123']);
    });

    it('encodes an empty string to empty string', () => {
      const result = runSyncProgram(`
        proc main() { println(urlEncode("")); }
        main();
      `);
      expect(result.logs).toEqual(['']);
    });

    it('encodes unicode characters', () => {
      const result = runSyncProgram(`
        proc main() { println(urlEncode("caf\u00e9")); }
        main();
      `);
      expect(result.logs).toEqual(['caf%C3%A9']);
    });

    it('encodes slashes and colons', () => {
      const result = runSyncProgram(`
        proc main() { println(urlEncode("https://example.com/path")); }
        main();
      `);
      expect(result.logs).toEqual(['https%3A%2F%2Fexample.com%2Fpath']);
    });

    it('can be used from a pure function', () => {
      const result = runSyncProgram(`
        function encode(s) { urlEncode(s); }
        proc main() { println(encode("a b")); }
        main();
      `);
      expect(result.logs).toEqual(['a%20b']);
    });

    it('rejects non-string input', () => {
      expect(() => runSyncProgram(`
        proc main() { eval urlEncode(42); }
        main();
      `)).toThrow('string');
    });
  });
});
