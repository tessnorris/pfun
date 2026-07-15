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

assert.equal(browser.$print("browser"), null);
assert.equal(browser.$println("browser"), null);
assert.equal(browser.$flushStdout(), null);

console.log("Browser host behavior passed.");
