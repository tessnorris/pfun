"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const core = require("../host/core.js");
const host = require("../host/node.js");

function mode(name) {
	return core.$makeVariant(name, "FileMode", [], []);
}

function expectResult(result, tag) {
	assert.equal(result.$u, "Result");
	assert.equal(result.$t, tag);
	return result;
}

function expectRead(result, tag) {
	assert.equal(result.$u, "ReadResult");
	assert.equal(result.$t, tag);
	return result;
}

const names = [
	"readFile",
	"writeFile",
	"fileExists",
	"mkdirP",
	"removeFile",
	"fileOpen",
	"fileClose",
	"readChar",
	"readLine",
	"writeChar",
	"writeLine",
];

for (const name of names) {
	assert.equal(
		typeof host.$builtins.file[name],
		"function",
		"missing file." + name
	);
}

const temp = fs.mkdtempSync(
	path.join(os.tmpdir(), "pfun-d2-")
);

try {
	const nested = path.join(temp, "nested");
	expectResult(host.$mkdirP(nested), "Ok");
	assert.equal(fs.statSync(nested).isDirectory(), true);

	const whole = path.join(nested, "whole.txt");
	const wholeText = "whole β text";
	const written = expectResult(
		host.$writeFile(whole, wholeText),
		"Ok"
	);
	assert.equal(written.value, null);
	assert.equal(host.$fileExists(whole), true);
	assert.equal(
		expectResult(host.$readFile(whole), "Ok").value,
		wholeText
	);

	const stream = path.join(nested, "stream.txt");
	const writer = expectResult(
		host.$fileOpen(stream, mode("Write")),
		"Ok"
	).value;

	expectResult(host.$writeLine(writer, "alpha"), "Ok");
	expectResult(host.$writeChar(writer, "𐐷"), "Ok");
	expectResult(host.$writeLine(writer, "eta"), "Ok");
	expectResult(host.$fileClose(writer), "Ok");
	expectResult(host.$fileClose(writer), "Err");

	const appender = expectResult(
		host.$fileOpen(stream, mode("Append")),
		"Ok"
	).value;
	expectResult(host.$writeLine(appender, "tail"), "Ok");
	expectResult(host.$fileClose(appender), "Ok");

	const reader = expectResult(
		host.$fileOpen(stream, mode("Read")),
		"Ok"
	).value;

	assert.equal(
		expectRead(host.$readChar(reader), "Ok").value,
		"a"
	);
	assert.equal(
		expectRead(host.$readLine(reader), "Ok").value,
		"lpha"
	);
	assert.equal(
		expectRead(host.$readLine(reader), "Ok").value,
		"𐐷eta"
	);
	assert.equal(
		expectRead(host.$readLine(reader), "Ok").value,
		"tail"
	);
	expectRead(host.$readLine(reader), "Eof");
	expectResult(host.$fileClose(reader), "Ok");

	const mixed = path.join(nested, "mixed-lines.txt");
	fs.writeFileSync(mixed, "one\r\ntwo\rthree", "utf8");
	const mixedReader = expectResult(
		host.$fileOpen(mixed, mode("Read")),
		"Ok"
	).value;
	assert.equal(
		expectRead(host.$readLine(mixedReader), "Ok").value,
		"one"
	);
	assert.equal(
		expectRead(host.$readLine(mixedReader), "Ok").value,
		"two"
	);
	assert.equal(
		expectRead(host.$readLine(mixedReader), "Ok").value,
		"three"
	);
	expectRead(host.$readLine(mixedReader), "Eof");
	expectResult(host.$fileClose(mixedReader), "Ok");

	const wrongMode = expectResult(
		host.$fileOpen(stream, mode("Read")),
		"Ok"
	).value;
	expectResult(host.$writeLine(wrongMode, "nope"), "Err");
	expectResult(host.$fileClose(wrongMode), "Ok");

	expectResult(host.$removeFile(whole), "Ok");
	assert.equal(host.$fileExists(whole), false);
	expectResult(host.$removeFile(whole), "Err");
	expectResult(
		host.$readFile(path.join(nested, "missing.txt")),
		"Err"
	);
} finally {
	fs.rmSync(temp, { recursive: true, force: true });
}

console.log("Node text-file floor behavior passed.");
