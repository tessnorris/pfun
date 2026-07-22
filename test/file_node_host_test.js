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
	if (tag === "Err") {
		assert.equal(result.message.$u, "NativeError");
		assert.equal(result.message.$t, "NativeIoError");
	}
	return result;
}

function expectRead(result, tag) {
	assert.equal(result.$u, "ReadResult");
	assert.equal(result.$t, tag);
	if (tag === "ReadErr") {
		assert.equal(result.message.$u, "NativeError");
		assert.equal(result.message.$t, "NativeIoError");
	}
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
	assert.equal(
		expectResult(host.$fileExists(whole), "Ok").value,
		true
	);
	assert.equal(
		expectResult(host.$readFile(whole), "Ok").value,
		wholeText
	);

	const stream = path.join(nested, "stream.txt");
	const writer = expectResult(
		host.$fileOpen(stream, mode("Write")),
		"Ok"
	).value;

	const badChar = expectResult(
		host.$writeChar(writer, "too long"),
		"Err"
	);
	assert.equal(badChar.message.operation, "writeChar");
	assert.match(badChar.message.message, /must be a Char/);

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
		expectRead(host.$readChar(reader), "ReadOk").value,
		"a"
	);
	assert.equal(
		expectRead(host.$readLine(reader), "ReadOk").value,
		"lpha"
	);
	assert.equal(
		expectRead(host.$readLine(reader), "ReadOk").value,
		"𐐷eta"
	);
	assert.equal(
		expectRead(host.$readLine(reader), "ReadOk").value,
		"tail"
	);
	expectRead(host.$readLine(reader), "ReadEof");
	expectResult(host.$fileClose(reader), "Ok");

	const mixed = path.join(nested, "mixed-lines.txt");
	fs.writeFileSync(mixed, "one\r\ntwo\rthree", "utf8");
	const mixedReader = expectResult(
		host.$fileOpen(mixed, mode("Read")),
		"Ok"
	).value;
	assert.equal(
		expectRead(host.$readLine(mixedReader), "ReadOk").value,
		"one"
	);
	assert.equal(
		expectRead(host.$readLine(mixedReader), "ReadOk").value,
		"two"
	);
	assert.equal(
		expectRead(host.$readLine(mixedReader), "ReadOk").value,
		"three"
	);
	expectRead(host.$readLine(mixedReader), "ReadEof");
	expectResult(host.$fileClose(mixedReader), "Ok");

	const wrongMode = expectResult(
		host.$fileOpen(stream, mode("Read")),
		"Ok"
	).value;
	expectResult(host.$writeLine(wrongMode, "nope"), "Err");
	expectResult(host.$fileClose(wrongMode), "Ok");

	expectResult(host.$removeFile(whole), "Ok");
	assert.equal(
		expectResult(host.$fileExists(whole), "Ok").value,
		false
	);
	expectResult(host.$removeFile(whole), "Err");
	expectResult(
		host.$readFile(path.join(nested, "missing.txt")),
		"Err"
	);

	const invalidExists = expectResult(
		host.$fileExists(null),
		"Err"
	);
	assert.equal(invalidExists.message.operation, "fileExists");
	assert.match(invalidExists.message.message, /must be a Str/);
} finally {
	fs.rmSync(temp, { recursive: true, force: true });
}

console.log("Node text-file floor behavior passed.");
