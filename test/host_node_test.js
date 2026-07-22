"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const core = require("../host/core.js");
const nodeHost = require("../host/node.js");

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function matching(text, opening, openChar, closeChar) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = opening; index < text.length; index += 1) {
    const char = text[index];

    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error("unterminated balanced region");
}

function functionBody(source, name) {
  const marker = "function " + name + "()";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error("missing " + name);

  const opening = source.indexOf("{", start);
  const closing = matching(source, opening, "{", "}");
  return source.slice(opening + 1, closing);
}

function entryCalls(body) {
  const kinds = [
    "pure", "nodePure", "browserPure",
    "procEntry", "nodeProc", "browserProc"
  ];
  const calls = [];

  for (const kind of kinds) {
    const marker = kind + "(";
    let offset = 0;

    while (true) {
      const start = body.indexOf(marker, offset);
      if (start < 0) break;

      const opening = start + kind.length;
      const closing = matching(body, opening, "(", ")");
      const text = body.slice(start, closing + 1);
      const strings = [...text.matchAll(/"((?:\\.|[^"])*)"/g)]
        .map((match) => JSON.parse('"' + match[1] + '"'));

      calls.push({
        kind,
        name: strings[0],
        intrinsic: strings[strings.length - 1]
      });
      offset = closing + 1;
    }
  }

  return calls;
}

function manifestModules() {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/builtins/spec.pf"),
    "utf8"
  );
  const modules = new Map();
  const pattern =
    /export function \w+ModuleSpec\(\)\s*\{\s*builtinModule\("([^"]+)",\s*(\w+Exports)\(\)/g;

  for (const match of source.matchAll(pattern)) {
    const moduleName = match[1];
    const exportFunction = match[2];
    const entries = entryCalls(functionBody(source, exportFunction))
      .filter((entry) =>
        entry.kind !== "browserPure" &&
        entry.kind !== "browserProc"
      );
    modules.set(moduleName, entries);
  }

  return modules;
}

// The manifest is the authority for the Node builtin registry.
for (const [moduleName, entries] of manifestModules()) {
  const moduleExports = nodeHost.$builtins[moduleName];
  assert.ok(moduleExports, "missing builtin module " + moduleName);

  for (const entry of entries) {
    const host =
      entry.kind === "nodePure" || entry.kind === "nodeProc"
        ? nodeHost
        : core;

    assert.equal(
      typeof host[entry.intrinsic],
      "function",
      "missing intrinsic " + entry.intrinsic
    );
    assert.equal(
      moduleExports[entry.name],
      host[entry.intrinsic],
      moduleName + "." + entry.name + " is not wired to " + entry.intrinsic
    );
  }
}

assert.equal(globalThis.PfunNode, nodeHost);
assert.equal(globalThis.PfunBuiltins, nodeHost.$builtins);
assert.equal(nodeHost.$builtins.core, nodeHost.$builtins["$builtin/core"]);

// Filesystem boundary behavior.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pfun-node-host-"));
try {
  const nested = path.join(temp, "a", "b");
  const made = nodeHost.$mkdirP(nested);
  assert.equal(made.$t, "Ok");
  assert.equal(fs.statSync(nested).isDirectory(), true);

  const file = path.join(nested, "source.pf");
  const source = "let β = 1;\n";
  const written = nodeHost.$writeFile(file, source);
  assert.equal(written.$t, "Ok");
  assert.equal(written.value, null);
  const exists = nodeHost.$fileExists(file);
  assert.equal(exists.$t, "Ok");
  assert.equal(exists.value, true);

  const read = nodeHost.$readFile(file);
  assert.equal(read.$t, "Ok");
  assert.equal(read.value, source);

  const readHandle = nodeHost.$fileOpen(
    file,
    core.$makeVariant("Read", "FileMode", [], [])
  );
  assert.equal(readHandle.$t, "Ok");
  assert.equal(nodeHost.$fileClose(readHandle.value).$t, "Ok");
  assert.equal(nodeHost.$fileClose(readHandle.value).$t, "Err");

  const missing = nodeHost.$readFile(path.join(temp, "missing.pf"));
  assert.equal(missing.$t, "Err");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

// argv and environment.
process.env.PFUN_NODE_HOST_TEST = "present";
assert.equal(nodeHost.$getEnv("PFUN_NODE_HOST_TEST").value, "present");
delete process.env.PFUN_NODE_HOST_TEST;
assert.equal(nodeHost.$getEnv("PFUN_NODE_HOST_TEST").$t, "None");
assert.deepEqual(nodeHost.$scriptArgs(), process.argv.slice(2));

// stdin scanners share one cursor and preserve Unicode chars.
const nodePath = path.join(__dirname, "../host/node.js");
const probe = `
  const host = require(${JSON.stringify(nodePath)});
  const values = [
    host.$scanln(),
    host.$scanChar(),
    host.$scanChar(),
    host.$scanChar()
  ].map((result) => {
    if (result.$t !== "Ok") throw new Error("unexpected scan failure");
    const value = result.value;
    return value.$t === "Some" ? value.value : null;
  });
  process.stdout.write(JSON.stringify(values));
`;
const scanned = childProcess.spawnSync(
  process.execPath,
  ["-e", probe],
  { input: "alpha\r\nβz", encoding: "utf8" }
);
assert.equal(scanned.status, 0, scanned.stderr);
assert.deepEqual(JSON.parse(scanned.stdout), ["alpha", "β", "z", null]);

const stdinFailureProbe = `
  const host = require(${JSON.stringify(nodePath)});
  const fs = require("node:fs");
  fs.readFileSync = function failStdinRead(fd) {
    if (fd === 0) throw new Error("stdin read failed");
    throw new Error("unexpected file read");
  };
  const result = host.$scanln();
  process.stdout.write(JSON.stringify(result));
`;
const stdinFailure = childProcess.spawnSync(
  process.execPath,
  ["-e", stdinFailureProbe],
  { encoding: "utf8" }
);
assert.equal(stdinFailure.status, 0, stdinFailure.stderr);
const stdinFailureResult = JSON.parse(stdinFailure.stdout);
assert.equal(stdinFailureResult.$t, "Err");
assert.equal(stdinFailureResult.message.$t, "NativeIoError");
assert.equal(stdinFailureResult.message.operation, "scanln");
assert.match(stdinFailureResult.message.message, /stdin read failed/);


// stderr output is separate from stdout and uses Pfun stringification.
const stderrProbe = `
	const host = require(${JSON.stringify(nodePath)});
	host.$eprint("error:");
	host.$eprintln(42);
	process.stdout.write("output");
`;
const stderrResult = childProcess.spawnSync(
	process.execPath,
	["-e", stderrProbe],
	{ encoding: "utf8" }
);
assert.equal(stderrResult.status, 0, stderrResult.stderr);
assert.equal(stderrResult.stdout, "output");
assert.equal(stderrResult.stderr, "error:42\n");

const originalWriteSync = fs.writeSync;
try {
	fs.writeSync = function failStderrWrite(fd, buffer, offset, length) {
		if (fd === process.stderr.fd) {
			throw new Error("stderr write failed");
		}
		return originalWriteSync(fd, buffer, offset, length);
	};
	const stderrFailure = nodeHost.$eprintln("unwritable");
	assert.equal(stderrFailure.$t, "Err");
	assert.equal(stderrFailure.message.$t, "NativeIoError");
	assert.equal(stderrFailure.message.operation, "eprintln");
	assert.match(stderrFailure.message.message, /stderr write failed/);
} finally {
	fs.writeSync = originalWriteSync;
}


// NodeBundle execution forwards arguments, streams, exit status, and cleanup.
const runDirsBefore = fs.readdirSync(os.tmpdir())
	.filter((name) => name.startsWith("pfun-run-"))
	.sort();
const runBundleSource = [
	'process.stdout.write("child-out:" + process.argv.slice(2).join(",") + "\\n");',
	'process.stderr.write("child-err\\n");',
	'process.exit(7);'
].join("\n");
const runBundleProbe = `
	const host = require(${JSON.stringify(nodePath)});
	const result = host.$runNodeBundle(
		${JSON.stringify(runBundleSource)},
		["alpha", "beta gamma"]
	);
	if (result.$t !== "Ok") {
		process.stderr.write(
			"probe-error:"
				+ host.$builtins.core.nativeErrorMessage(result.message)
				+ "\\n"
		);
		process.exit(1);
	}
	process.stdout.write("result:" + String(result.value) + "\\n");
`;
const runBundleResult = childProcess.spawnSync(
	process.execPath,
	["-e", runBundleProbe],
	{ encoding: "utf8" }
);
assert.equal(runBundleResult.status, 0, runBundleResult.stderr);
assert.equal(
	runBundleResult.stdout,
	"child-out:alpha,beta gamma\nresult:7\n"
);
assert.equal(runBundleResult.stderr, "child-err\n");

const invalidBundle = nodeHost.$runNodeBundle(null, []);
assert.equal(invalidBundle.$u, "Result");
assert.equal(invalidBundle.$t, "Err");
assert.equal(invalidBundle.message.$u, "NativeError");
assert.equal(invalidBundle.message.$t, "NativeProcessError");
assert.equal(invalidBundle.message.operation, "runNodeBundle");
assert.match(invalidBundle.message.message, /must be a Str/);

const runDirsAfter = fs.readdirSync(os.tmpdir())
	.filter((name) => name.startsWith("pfun-run-"))
	.sort();
assert.deepEqual(runDirsAfter, runDirsBefore);

// Exit status is delegated exactly.
const exitProbe = `
  const host = require(${JSON.stringify(nodePath)});
  host.$exit(7);
`;
const exited = childProcess.spawnSync(
  process.execPath,
  ["-e", exitProbe],
  { encoding: "utf8" }
);
assert.equal(exited.status, 7);

console.log("Node host manifest conformance and behavior passed.");
