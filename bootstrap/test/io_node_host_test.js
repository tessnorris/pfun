"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const path = require("node:path");

const nodePath = path.join(__dirname, "../host/node.js");

function probe(source, input) {
	const result = childProcess.spawnSync(
		process.execPath,
		["-e", source],
		{ input, encoding: "utf8" }
	);
	assert.equal(result.status, 0, result.stderr);
	return result;
}

const registrySource = `
	const host = require(${JSON.stringify(nodePath)});
	const names = [
		"print",
		"println",
		"eprint",
		"eprintln",
		"flushStdout",
		"scanln",
		"scanChar",
		"exit"
	];
	for (const name of names) {
		if (typeof host.$builtins.io[name] !== "function") {
			throw new Error("missing io." + name);
		}
	}
	host.$builtins.io.print(["out", 2, true]);
	host.$builtins.io.println("!");
	host.$builtins.io.eprint(["err", 3, false]);
	host.$builtins.io.eprintln("!");
	if (host.$builtins.io.flushStdout() !== null) {
		throw new Error("flushStdout did not return Unit");
	}
`;
const registry = probe(registrySource, "");
assert.equal(registry.stdout, "[out, 2, true]!\n");
assert.equal(registry.stderr, "[err, 3, false]!\n");

const scannerSource = `
	const host = require(${JSON.stringify(nodePath)});
	const values = [
		host.$scanln(),
		host.$scanln(),
		host.$scanChar(),
		host.$scanln(),
		host.$scanChar(),
		host.$scanln()
	].map((value) => value.$t === "Some" ? value.value : null);
	process.stdout.write(JSON.stringify(values));
`;
const scanner = probe(
	scannerSource,
	"first\rsecond\r\nβtail\nZ"
);
assert.deepEqual(
	JSON.parse(scanner.stdout),
	["first", "second", "β", "tail", "Z", null]
);
assert.equal(scanner.stderr, "");

const unicodeSource = `
	const host = require(${JSON.stringify(nodePath)});
	const first = host.$scanChar();
	const second = host.$scanChar();
	process.stdout.write(JSON.stringify([
		first.$t === "Some" ? first.value : null,
		second.$t === "Some" ? second.value : null
	]));
`;
const unicode = probe(unicodeSource, "𐐷");
assert.deepEqual(JSON.parse(unicode.stdout), ["𐐷", null]);

const exitSource = `
	const host = require(${JSON.stringify(nodePath)});
	host.$exit(23);
`;
const exited = childProcess.spawnSync(
	process.execPath,
	["-e", exitSource],
	{ encoding: "utf8" }
);
assert.equal(exited.status, 23);

console.log("Node io floor behavior passed.");
