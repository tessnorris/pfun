// src/jsonlib.test.ts
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { Interpreter, ModuleLoader } from '../interpreter';
import { stdlibFunctions, stdlibTypes } from '../library';
import { iolibFunctions } from '../iolib';
import { jsonlibFunctions } from '../jsonlib';
import * as os from 'os';
import * as nodePath from 'path';
import * as nodeFs from 'fs';

// ─── Test helpers ─────────────────────────────────────────────────────────────

const run = (source: string) => {
  const setupInterp = (interp: Interpreter) => {
    interp.registerLibrary(stdlibFunctions, stdlibTypes);
  };
  const loader = new ModuleLoader('/no/lib', setupInterp);
  loader.registerBuiltin('json', jsonlibFunctions);

  const ast = new Parser(new Lexer(source).lex()).parse();
  const interp = new Interpreter('/no', loader);
  interp.registerLibrary(stdlibFunctions, stdlibTypes);
  interp.registerLibrary(iolibFunctions, []);

  const logs: string[] = [];
  let currentLine = '';
  const origLog = console.log;
  const origWrite = process.stdout.write.bind(process.stdout);
  console.log = (...args: any[]) => {
    logs.push(currentLine + args.map(String).join(' '));
    currentLine = '';
  };
  (process.stdout as any).write = (s: string) => {
    if (typeof s !== 'string') return true;
    const parts = s.split('\n');
    for (let i = 0; i < parts.length - 1; i++) { logs.push(currentLine + parts[i]); currentLine = ''; }
    currentLine += parts[parts.length - 1];
    return true;
  };
  try {
    interp.interpret(ast, source);
    if (currentLine.length > 0) { logs.push(currentLine); currentLine = ''; }
  } finally {
    console.log = origLog;
    (process.stdout as any).write = origWrite;
  }
  return { logs, interp };
};

const tempPath = () =>
  nodePath.join(os.tmpdir(), `pfun-json-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

// ─── jsonSerialize / jsonDeserialize ──────────────────────────────────────────

describe('jsonSerialize and jsonDeserialize', () => {

  it('round-trips a plain integer', () => {
    const { logs } = run(`
      import * from "json";
      proc p() {
        let s = jsonSerialize(42);
        let json = match s with | Some s -> s.value | None -> "failed";
        let back = jsonDeserialize(json);
        println(match back with | Some s -> s.value | None -> -1);
      }
      p();
    `);
    expect(logs).toEqual(['42']);
  });

  it('round-trips a boolean', () => {
    const { logs } = run(`
      import * from "json";
      proc p() {
        let s = jsonSerialize(true);
        let json = match s with | Some s -> s.value | None -> "failed";
        let back = jsonDeserialize(json);
        println(match back with | Some s -> s.value | None -> false);
      }
      p();
    `);
    expect(logs).toEqual(['true']);
  });

  it('round-trips a string', () => {
    const { logs } = run(`
      import * from "json";
      proc p() {
        let s = jsonSerialize("hello world");
        let json = match s with | Some s -> s.value | None -> "failed";
        let back = jsonDeserialize(json);
        println(match back with | Some s -> s.value | None -> "nope");
      }
      p();
    `);
    expect(logs).toEqual(['hello world']);
  });

  it('round-trips a list of integers', () => {
    const { logs } = run(`
      import * from "json";
      proc p() {
        let s = jsonSerialize([1, 2, 3, 4, 5]);
        let json = match s with | Some s -> s.value | None -> "failed";
        let back = jsonDeserialize(json);
        println(match back with | Some s -> s.value | None -> []);
      }
      p();
    `);
    expect(logs).toEqual(['[1, 2, 3, 4, 5]']);
  });

  it('round-trips a plain record', () => {
    const { logs } = run(`
      import * from "json";
      type Point = { x, y };
      proc p() {
        let pt = Point { 10, 20 };
        let s = jsonSerialize(pt);
        let json = match s with | Some s -> s.value | None -> "failed";
        let pt2 = match jsonDeserialize(json) with | Some s -> s.value | None -> Point { 0, 0 };
        println(pt2.x);
        println(pt2.y);
      }
      p();
    `);
    expect(logs).toEqual(['10', '20']);
  });

  it('round-trips a discriminated union variant with fields', () => {
    const { logs } = run(`
      import * from "json";
      type Shape = {
        | Circle: radius
        | Rectangle: x, y
      }
      proc p() {
        let s = jsonSerialize(Circle { 5 });
        let json = match s with | Some s -> s.value | None -> "failed";
        let c2 = match jsonDeserialize(json) with | Some s -> s.value | None -> Circle { 0 };
        println(c2.radius);
      }
      p();
    `);
    expect(logs).toEqual(['5']);
  });

  it('round-trips a zero-field union variant', () => {
    const { logs } = run(`
      import * from "json";
      type Opt2 = { | Just: value | Nothing }
      proc p() {
        let s = jsonSerialize(Nothing);
        let json = match s with | Some s -> s.value | None -> "failed";
        let result = match jsonDeserialize(json) with
          | Some s -> (match s.value with | Just j -> j.value | Nothing -> 999)
          | None   -> -1;
        println(result);
      }
      p();
    `);
    expect(logs).toEqual(['999']);
  });

  it('round-trips a list of records', () => {
    const { logs } = run(`
      import * from "json";
      type User = { name, age };
      proc p() {
        let users = [User(name="Alice", age=30), User(name="Bob", age=25)];
        let s = jsonSerialize(users);
        let json = match s with | Some s -> s.value | None -> "failed";
        let us = match jsonDeserialize(json) with | Some s -> s.value | None -> [];
        println(head(us).name);
        println(head(tail(us)).age);
      }
      p();
    `);
    expect(logs).toEqual(['Alice', '25']);
  });

  it('round-trips deeply nested structures', () => {
    const { logs } = run(`
      import * from "json";
      type Tree = { | Leaf: value | Node: left, right }
      proc p() {
        let t = Node { Node { Leaf { 1 }, Leaf { 2 } }, Leaf { 3 } };
        let s = jsonSerialize(t);
        let json = match s with | Some s -> s.value | None -> "failed";
        let t2 = match jsonDeserialize(json) with | Some s -> s.value | None -> Leaf { 0 };
        let leftLeft = match t2.left with
          | Node n -> (match n.left with | Leaf l -> l.value | Node _ -> -1)
          | Leaf _ -> -2;
        println(leftLeft);
      }
      p();
    `);
    expect(logs).toEqual(['1']);
  });

  it('round-trips the built-in None variant', () => {
    const { logs } = run(`
      import * from "json";
      proc p() {
        let s = jsonSerialize(None);
        let json = match s with | Some s -> s.value | None -> "failed";
        let result = match jsonDeserialize(json) with
          | Some s -> (match s.value with | Some _ -> "some" | None -> "none")
          | None   -> "error";
        println(result);
      }
      p();
    `);
    expect(logs).toEqual(['none']);
  });

  it('round-trips a mixed list of union variants', () => {
    const { logs } = run(`
      import * from "json";
      type Status = { | Active: id | Inactive }
      proc p() {
        let items = [Active { 1 }, Inactive, Active { 99 }];
        let s = jsonSerialize(items);
        let json = match s with | Some s -> s.value | None -> "failed";
        let items2 = match jsonDeserialize(json) with | Some s -> s.value | None -> [];
        println(match head(items2) with | Active a -> a.id | Inactive -> 0);
        println(match head(tail(items2)) with | Active _ -> "active" | Inactive -> "inactive");
        println(match head(tail(tail(items2))) with | Active a -> a.id | Inactive -> 0);
      }
      p();
    `);
    expect(logs).toEqual(['1', 'inactive', '99']);
  });

  it('returns None for invalid JSON', () => {
    const { logs } = run(`
      import * from "json";
      proc p() {
        let result = match jsonDeserialize("not valid json {{") with
          | Some _ -> "ok"
          | None   -> "none";
        println(result);
      }
      p();
    `);
    expect(logs).toEqual(['none']);
  });
});

// ─── jsonWriteFile / jsonReadFile ─────────────────────────────────────────────

describe('jsonWriteFile and jsonReadFile', () => {

  it('writes and reads back a record', () => {
    const path = tempPath();
    try {
      const { logs } = run(`
        import * from "json";
        type Config = { host, port };
        proc p() {
          let cfg = Config(host="localhost", port=8080);
          let ok = match jsonWriteFile("${path}", cfg) with | Some _ -> "written" | None -> "failed";
          println(ok);
          let cfg2 = match jsonReadFile("${path}") with | Some s -> s.value | None -> Config(host="err", port=0);
          println(cfg2.host);
          println(cfg2.port);
        }
        p();
      `);
      expect(logs).toEqual(['written', 'localhost', '8080']);
    } finally {
      try { nodeFs.unlinkSync(path); } catch {}
    }
  });

  it('produces valid JSON readable by external tools', () => {
    const path = tempPath();
    try {
      run(`
        import * from "json";
        type Point = { x, y };
        proc p() { jsonWriteFile("${path}", Point { 3, 7 }); }
        p();
      `);
      const parsed = JSON.parse(nodeFs.readFileSync(path, 'utf8'));
      expect(parsed.__pfun).toBe('record');
      expect(parsed.__type).toBe('Point');
      expect(parsed.x).toEqual({ __pfun: 'int', v: '3' });
      expect(parsed.y).toEqual({ __pfun: 'int', v: '7' });
    } finally {
      try { nodeFs.unlinkSync(path); } catch {}
    }
  });

  it('writes and reads back a list of union variants', () => {
    const path = tempPath();
    try {
      const { logs } = run(`
        import * from "json";
        type Status = { | Active: id | Inactive }
        proc p() {
          jsonWriteFile("${path}", [Active { 1 }, Inactive, Active { 2 }]);
          let items2 = match jsonReadFile("${path}") with | Some s -> s.value | None -> [];
          println(match head(tail(items2)) with | Active _ -> "active" | Inactive -> "inactive");
        }
        p();
      `);
      expect(logs).toEqual(['inactive']);
    } finally {
      try { nodeFs.unlinkSync(path); } catch {}
    }
  });

  it('round-trips a deeply nested tree through a file', () => {
    const path = tempPath();
    try {
      const { logs } = run(`
        import * from "json";
        type Tree = { | Leaf: value | Node: left, right }
        proc p() {
          let t = Node {
            Node { Leaf { 10 }, Leaf { 20 } },
            Node { Leaf { 30 }, Node { Leaf { 40 }, Leaf { 50 } } }
          };
          jsonWriteFile("${path}", t);
          let t2 = match jsonReadFile("${path}") with | Some s -> s.value | None -> Leaf { 0 };
          let v = match t2.right with
            | Node n -> (match n.right with
                | Node nn -> (match nn.right with | Leaf l -> l.value | Node _ -> -1)
                | Leaf _  -> -2)
            | Leaf _ -> -3;
          println(v);
        }
        p();
      `);
      expect(logs).toEqual(['50']);
    } finally {
      try { nodeFs.unlinkSync(path); } catch {}
    }
  });

  it('returns None for a missing file', () => {
    const { logs } = run(`
      import * from "json";
      proc p() {
        println(match jsonReadFile("/no/such/file.json") with | Some _ -> "ok" | None -> "none");
      }
      p();
    `);
    expect(logs).toEqual(['none']);
  });
});
