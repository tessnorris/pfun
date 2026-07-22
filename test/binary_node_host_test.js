"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const core = require("../host/core.js");
const host = require("../host/node.js");

function variant(name, unionName) {
	return core.$makeVariant(name, unionName, [], []);
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

const Read = variant("Read", "FileMode");
const Write = variant("Write", "FileMode");
const ByteMode = variant("ByteMode", "BufferMode");
const CharMode = variant("CharMode", "BufferMode");

const names = [
	"readByte",
	"readBytes",
	"writeByte",
	"writeBytes",
	"readBuffer",
	"writeBuffer",
	"makeBuffer",
	"makeStringBuffer",
	"appendBuffer",
	"appendChar",
	"appendString",
	"bufferLength",
	"bufferToBytes",
	"bufferToString",
];

for (const name of names) {
	assert.equal(
		typeof host.$builtins.file[name],
		"function",
		"missing file." + name
	);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pfun-d3-"));

try {
	const binaryPath = path.join(temp, "bytes.bin");
	const writer = expectResult(
		host.$fileOpen(binaryPath, Write),
		"Ok"
	).value;

	expectResult(host.$writeByte(writer, 0xde), "Ok");
	expectResult(
		host.$writeBytes(writer, [0xad, 0xbe, 0xef]),
		"Ok"
	);
	expectResult(host.$fileClose(writer), "Ok");
	assert.deepEqual(
		Array.from(fs.readFileSync(binaryPath)),
		[0xde, 0xad, 0xbe, 0xef]
	);

	const reader = expectResult(
		host.$fileOpen(binaryPath, Read),
		"Ok"
	).value;
	assert.equal(
		expectRead(host.$readByte(reader), "ReadOk").value,
		0xde
	);
	assert.deepEqual(
		expectRead(host.$readBytes(reader, 2), "ReadOk").value,
		[0xad, 0xbe]
	);
	assert.deepEqual(
		expectRead(host.$readBytes(reader, 8), "ReadOk").value,
		[0xef]
	);
	expectRead(host.$readBytes(reader, 1), "ReadEof");
	assert.deepEqual(
		expectRead(host.$readBytes(reader, 0), "ReadOk").value,
		[]
	);
	expectResult(host.$fileClose(reader), "Ok");

	const mixedPath = path.join(temp, "mixed.bin");
	fs.writeFileSync(
		mixedPath,
		Buffer.from([0x41, 0xce, 0xb2, 0x0a, 0x42])
	);
	const mixed = expectResult(
		host.$fileOpen(mixedPath, Read),
		"Ok"
	).value;
	assert.equal(
		expectRead(host.$readByte(mixed), "ReadOk").value,
		0x41
	);
	assert.equal(
		expectRead(host.$readChar(mixed), "ReadOk").value,
		"β"
	);
	assert.equal(
		expectRead(host.$readLine(mixed), "ReadOk").value,
		""
	);
	assert.equal(
		expectRead(host.$readByte(mixed), "ReadOk").value,
		0x42
	);
	expectRead(host.$readByte(mixed), "ReadEof");
	expectResult(host.$fileClose(mixed), "Ok");

	const raw = host.$makeBuffer(ByteMode);
	assert.equal(raw.$mode, "ByteMode");
	assert.equal(host.$appendBuffer(raw, 0x41), null);
	assert.equal(host.$appendBuffer(raw, 0x42), null);
	assert.equal(host.$bufferLength(raw), 2);
	assert.deepEqual(host.$bufferToBytes(raw), [0x41, 0x42]);
	assert.throws(() => host.$bufferToString(raw), /CharMode/);
	assert.throws(() => host.$appendString(raw, "bad"), /CharMode/);

	const chars = host.$makeStringBuffer();
	assert.equal(chars.$mode, "CharMode");
	assert.equal(host.$appendString(chars, "hello "), null);
	assert.equal(host.$appendChar(chars, "β"), null);
	assert.equal(host.$bufferLength(chars), 8);
	assert.equal(host.$bufferToString(chars), "hello β");
	assert.throws(() => host.$bufferToBytes(chars), /ByteMode/);
	assert.throws(() => host.$appendBuffer(chars, 1), /ByteMode/);

	const bufferPath = path.join(temp, "buffer.txt");
	const bufferWriter = expectResult(
		host.$fileOpen(bufferPath, Write),
		"Ok"
	).value;
	expectResult(host.$writeBuffer(bufferWriter, chars), "Ok");
	expectResult(host.$fileClose(bufferWriter), "Ok");
	assert.equal(fs.readFileSync(bufferPath, "utf8"), "hello β");

	const bufferReader = expectResult(
		host.$fileOpen(bufferPath, Read),
		"Ok"
	).value;
	const first = expectResult(
		host.$readBuffer(bufferReader, 5, ByteMode),
		"Ok"
	).value;
	assert.deepEqual(
		host.$bufferToBytes(first),
		[104, 101, 108, 108, 111]
	);
	const second = expectResult(
		host.$readBuffer(bufferReader, 3, CharMode),
		"Ok"
	).value;
	assert.equal(host.$bufferToString(second), " β");
	const empty = expectResult(
		host.$readBuffer(bufferReader, 4, ByteMode),
		"Ok"
	).value;
	assert.equal(host.$bufferLength(empty), 0);
	expectResult(host.$fileClose(bufferReader), "Ok");

	const wrongMode = expectResult(
		host.$fileOpen(binaryPath, Read),
		"Ok"
	).value;
	expectResult(host.$writeByte(wrongMode, 1), "Err");
	expectResult(host.$writeBytes(wrongMode, [1, 2]), "Err");
	expectResult(host.$fileClose(wrongMode), "Ok");

	const badWriter = expectResult(
		host.$fileOpen(path.join(temp, "bad.bin"), Write),
		"Ok"
	).value;
	expectResult(host.$writeByte(badWriter, 256), "Err");
	expectResult(host.$writeBytes(badWriter, [1, -1]), "Err");
	expectResult(host.$fileClose(badWriter), "Ok");

	const badReader = expectResult(
		host.$fileOpen(binaryPath, Read),
		"Ok"
	).value;
	expectRead(host.$readBytes(badReader, -1), "ReadErr");
	expectResult(host.$readBuffer(badReader, -1, ByteMode), "Err");
	expectResult(host.$fileClose(badReader), "Ok");
} finally {
	fs.rmSync(temp, { recursive: true, force: true });
}

console.log("Node binary and buffer floor behavior passed.");
