"use strict";

const assert = require("node:assert/strict");

const core = require("../host/core.js");
const host = require("../host/node.js");

function expectResult(result, tag, operation) {
	assert.equal(result.$u, "Result");
	assert.equal(result.$t, tag);
	if (tag === "Err") {
		assert.equal(result.message.$u, "NativeError");
		assert.equal(result.message.$t, "NativeTimerError");
		assert.equal(result.message.operation, operation);
	}
	return result;
}

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
	assert.equal(expectResult(await zero, "Ok").value, null);
	assert.equal(settled, true);

	const started = Date.now();
	assert.equal(
		expectResult(
			await host.$builtins.async.sleep(25),
			"Ok"
		).value,
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

	const negative = expectResult(
		await host.$builtins.async.sleep(-1),
		"Err",
		"sleep"
	);
	assert.match(negative.message.message, /non-negative/);

	const tooLarge = expectResult(
		await host.$builtins.async.sleep(2147483648),
		"Err",
		"sleep"
	);
	assert.match(
		tooLarge.message.message,
		/at most 2147483647 milliseconds/
	);

	const tooLargeBigInt = expectResult(
		await host.$builtins.async.sleep(2147483648n),
		"Err",
		"sleep"
	);
	assert.match(
		tooLargeBigInt.message.message,
		/at most 2147483647 milliseconds/
	);

	const originalSetTimeout = globalThis.setTimeout;
	let unavailable;
	try {
		globalThis.setTimeout = function unavailableTimer() {
			throw new Error("scheduler unavailable");
		};
		unavailable = host.$builtins.async.sleep(0);
	} finally {
		globalThis.setTimeout = originalSetTimeout;
	}
	const schedulerFailure = expectResult(
		await unavailable,
		"Err",
		"sleep"
	);
	assert.equal(
		schedulerFailure.message.message,
		"scheduler unavailable"
	);

	console.log("Node async/sleep floor behavior passed.");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
