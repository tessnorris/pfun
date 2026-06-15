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
});
