"use strict";

const assert = require("node:assert/strict");

const core = require("../host/core.js");
const host = require("../host/node.js");

async function main() {
	assert.equal(
		typeof host.$builtins.async.sleep,
		"function"
	);
	assert.equal(host.$builtins.async.sleep, core.$sleep);

	let settled = false;
	const zero = host.$builtins.async.sleep(0).then(
		(value) => {
			settled = true;
			return value;
		}
	);

	assert.equal(settled, false);
	assert.equal(await zero, null);
	assert.equal(settled, true);

	const started = Date.now();
	assert.equal(
		await host.$builtins.async.sleep(25),
		null
	);
	const elapsed = Date.now() - started;

	assert.ok(
		elapsed >= 15,
		"sleep(25) resolved too early: " + elapsed + "ms"
	);
	assert.ok(
		elapsed < 5000,
		"sleep(25) took unexpectedly long: " + elapsed + "ms"
	);

	assert.throws(
		() => host.$builtins.async.sleep(-1),
		/non-negative/
	);
	assert.throws(
		() => host.$builtins.async.sleep(2147483648),
		/at most 2147483647 milliseconds/
	);
	assert.throws(
		() => host.$builtins.async.sleep(2147483648n),
		/at most 2147483647 milliseconds/
	);

	console.log("Node async/sleep floor behavior passed.");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
