"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const corePath = path.join(__dirname, "../host/core.js");
const browserPath = path.join(__dirname, "../host/browser.js");

globalThis.PfunCore = require(corePath);
const browser = require(browserPath);

assert.equal(globalThis.PfunBrowser, browser);
assert.equal(globalThis.PfunBuiltins, browser.$builtins);

assert.equal(browser.$builtins.core.str, globalThis.PfunCore.$str);
assert.equal(
	browser.$builtins.json.jsonDeserializeAs,
	globalThis.PfunCore.$jsonDeserialize
);
assert.equal(browser.$builtins.io.print, browser.$print);
assert.equal(browser.$builtins.io.println, browser.$println);

assert.equal(
	Object.prototype.hasOwnProperty.call(
		browser.$builtins,
		"file"
	),
	false
);
assert.equal(
	Object.prototype.hasOwnProperty.call(
		browser.$builtins.io,
		"eprintln"
	),
	false
);

assert.equal(browser.$print("browser").$t, "Ok");
assert.equal(browser.$println("browser").$t, "Ok");
assert.equal(browser.$flushStdout().$t, "Ok");

const originalLog = globalThis.console.log;
try {
	globalThis.console.log = function failConsoleWrite() {
		throw new Error("console write failed");
	};
	const failure = browser.$println("unwritable");
	assert.equal(failure.$u, "Result");
	assert.equal(failure.$t, "Err");
	assert.equal(failure.message.$t, "NativeIoError");
	assert.equal(failure.message.operation, "println");
	assert.match(failure.message.message, /console write failed/);
} finally {
	globalThis.console.log = originalLog;
}

console.log("Browser host behavior passed.");
