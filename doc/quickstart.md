# Pfun Language Quickstart

## Language features

### Variables & types

```pfun
let x = 10;            // immutable
var y = 0;             // mutable
y = y + 5;
```

Scalar types: **Int** (arbitrary precision), **Float**, **Bool**, **Char**
(`'a'`), **Str** (`"hi"`), **Byte** (`255b`, `0xFFb`), plus `nil`.

```pfun
println(9999999999999999999999999999 * 9999999999999999999999999999);  // big ints just work
println(10 / 3);     // 3   (Int division truncates toward zero)
println(10.0 / 3);   // 3.3333333333333335  (Float)
println(0xF0b & 0x0Fb);  // 0   (Byte bitwise; also Int)
```

### Functions, procedures, lambdas

```pfun
function add(x, y) { return x + y; }      // pure, lazy, memoizable
proc shout(s) { println(s + "!"); }       // impure (side effects allowed)
let double = fn x => x * 2;               // lambda
memo function fib(n) { if n <= 1 then n else fib(n-1) + fib(n-2); }
```

- **Currying / partial application:** `add(3)` returns a function awaiting `y`.
- **Tail-call optimization:** self-recursive tail calls run in constant stack —
  `countdown(1000000)` does not overflow.
- **Closures:** `function adder(n) { return fn x => x + n; }`.

### Control flow & pattern matching

```pfun
if a < b then println("less") else println("more");

match shape with
| Circle c           -> c.radius * c.radius
| Rect r where r.w>0 -> r.w * r.h         // guards
| _                  -> 0;                // wildcard
```

### Lists, comprehensions, lazy/infinite lists

```pfun
let xs = [1, 2, 3, 4, 5];
map(fn x => x * x, xs);                    // [1, 4, 9, 16, 25]
filter(fn x => x % 2 == 0, xs);           // [2, 4]
reduce(fn a, x => a + x, 0, xs);          // 15
[ x * 10 for x <- xs where x % 2 == 1 ];  // comprehension
let nats = iterate(fn x => x + 1, 1);     // infinite stream
take(5, filter(fn x => x % 3 == 0, nats));// [3, 6, 9, 12, 15]
```

Strings behave as lists of chars: `head("hi")`, `tail`, `cons('H', "i")`, `map`,
`split`, `join`. Interpolate with `$"…{name}…"`.

### Records & discriminated unions

```pfun
type Point = { x, y };
let p = Point(x = 3, y = 4);         // or  Point { 3, 4 }
println(p.x);

type Shape = { | Circle: radius | Rect: w, h }
let c = Circle { radius = 5 };
```

Built-in unions: `Option` (`Some {value}` / `None`) and, from libraries,
`Result` (`Ok` / `Err`) and `ReadResult` (`Ok` / `Eof` / `Err`).

### Mutable arrays & dicts

```pfun
var a = array { 10, 20, 30 };
append(a, 40);   a[0] = 99;   arrayLength(a);   toList(a);
var d = dict { "k" -> 1 };
d["k"] = 2;   has(d, "k");   keys(d);   values(d);
```

---

## Libraries

Core list/string/number functions and the mutable-structure operations
(`array`/`dict`) need **no import**. Everything else is gated by `import`:

```pfun
import * from "io";       // print, println, printf via $, readln, scriptArgs, getEnv
import * from "math";     // sqrt, sin, pow, log, abs, min, max, clamp, lerp, ...
import * from "json";     // jsonSerialize / jsonDeserialize (Option-wrapped)
import * from "file";     // readFile/writeFile, fileOpen/Close, byte & buffer I/O
import * from "async";    // sleep (used with async/await)
import * from "http";     // httpListen server + httpGet/httpGetBytes client
```

Import forms:

```pfun
import * from "math";                         // bring all names into scope
import { add, fib as f } from "./helper";     // named, with optional alias
import * as M from "./helper";                // namespace:  M.add(1, 2)
```

```pfun
import * from "json";
match jsonSerialize(myRecord) with
| Some s -> writeFile("out.json", s.value)
| None   -> println("could not serialize");
```

### Async / await

Compiled programs run on a real cooperative scheduler (stackful coroutines +
a `poll` event loop). `await` suspends the current task; timers and socket
readiness resume it.

```pfun
import * from "async";
async proc work() {
  await sleep(10);
  return 42;
}
async proc main() { println(await work()); }
main();
```

### HTTP server & client

`httpListen` runs each request handler as its own task, so handlers interleave
at `await` points (a slow handler doesn't block others). `httpGet` suspends the
calling task until the response arrives — so a client can even call a server
running in the *same* process.

```pfun
import * from "http";

async proc handler(req, res) {
  if req.path == "/" then res.text(200, "ok")
  else res.json(200, dict { "path" -> req.path });
}
httpListen(8080, handler);

async proc client() {
  match await httpGet("http://localhost:8080/") with
  | Ok r  -> println(r.value.status + ": " + r.value.body)
  | Err e -> println("failed: " + e.message);
}
client();
```


