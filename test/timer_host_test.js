"use strict";

const assert = require("node:assert/strict");

const core = require("../host/core.js");
const nodeHost = require("../host/node.js");
const browserHostPath = require.resolve("../host/browser.js");

const originalSetTimeout = globalThis.setTimeout;

function wait(milliseconds) {
	return new Promise((resolve) => {
		originalSetTimeout(resolve, milliseconds);
	});
}

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
	assert.equal(nodeHost.$builtins.timer.setTimer, core.$setTimer);
	assert.equal(nodeHost.$builtins.timer.setAsyncTimer, core.$setAsyncTimer);
	assert.equal(nodeHost.$builtins.timer.clearTimer, core.$clearTimer);

	const negative = expectResult(
		core.$setTimer(-1, () => null),
		"Err",
		"setTimer"
	);
	assert.match(negative.message.message, /non-negative/);

	const tooLarge = expectResult(
		core.$setTimer(2147483648, () => null),
		"Err",
		"setTimer"
	);
	assert.match(
		tooLarge.message.message,
		/at most 2147483647 milliseconds/
	);

	const badAction = expectResult(
		core.$setAsyncTimer(0, null),
		"Err",
		"setAsyncTimer"
	);
	assert.match(badAction.message.message, /must be a procedure/);

	const badHandle = expectResult(
		core.$clearTimer(null),
		"Err",
		"clearTimer"
	);
	assert.match(badHandle.message.message, /TimerHandle/);

	let canceledFired = false;
	const canceled = expectResult(
		core.$setTimer(0, () => {
			canceledFired = true;
		}),
		"Ok"
	).value;
	expectResult(core.$clearTimer(canceled), "Ok");
	expectResult(core.$clearTimer(canceled), "Ok");
	await wait(20);
	assert.equal(canceledFired, false);

	let syncFired = false;
	const sync = expectResult(
		core.$setTimer(0, () => {
			syncFired = true;
		}),
		"Ok"
	).value;
	await wait(20);
	assert.equal(syncFired, true);
	assert.equal(sync.$timerFailure, null);
	expectResult(core.$clearTimer(sync), "Ok");

	const syncFailure = expectResult(
		core.$setTimer(0, () => {
			throw new Error("sync callback boom");
		}),
		"Ok"
	).value;
	await wait(20);
	assert.equal(syncFailure.$timerFailure.$t, "NativeTimerError");
	assert.equal(syncFailure.$timerFailure.operation, "setTimer");
	assert.equal(
		syncFailure.$timerFailure.message,
		"callback failed: sync callback boom"
	);

	const unhandled = [];
	function onUnhandled(reason) {
		unhandled.push(reason);
	}
	process.on("unhandledRejection", onUnhandled);
	const asyncFailure = expectResult(
		core.$setAsyncTimer(0, async () => {
			throw new Error("async callback boom");
		}),
		"Ok"
	).value;
	await wait(30);
	process.removeListener("unhandledRejection", onUnhandled);
	assert.deepEqual(unhandled, []);
	assert.equal(asyncFailure.$timerFailure.$t, "NativeTimerError");
	assert.equal(asyncFailure.$timerFailure.operation, "setAsyncTimer");
	assert.equal(
		asyncFailure.$timerFailure.message,
		"callback failed: async callback boom"
	);

	let unavailable;
	try {
		globalThis.setTimeout = function unavailableTimer() {
			throw new Error("scheduler unavailable");
		};
		unavailable = core.$setTimer(0, () => null);
	} finally {
		globalThis.setTimeout = originalSetTimeout;
	}
	const schedulerFailure = expectResult(
		unavailable,
		"Err",
		"setTimer"
	);
	assert.equal(
		schedulerFailure.message.message,
		"scheduler unavailable"
	);

	const clearFailureHandle = expectResult(
		core.$setTimer(1000, () => null),
		"Ok"
	).value;
	const originalClearTimeout = globalThis.clearTimeout;
	let unavailableClear;
	try {
		globalThis.clearTimeout = function unavailableCancellation() {
			throw new Error("cancellation unavailable");
		};
		unavailableClear = core.$clearTimer(clearFailureHandle);
	} finally {
		globalThis.clearTimeout = originalClearTimeout;
	}
	const cancellationFailure = expectResult(
		unavailableClear,
		"Err",
		"clearTimer"
	);
	assert.equal(
		cancellationFailure.message.message,
		"cancellation unavailable"
	);
	expectResult(core.$clearTimer(clearFailureHandle), "Ok");

	globalThis.PfunCore = core;
	delete require.cache[browserHostPath];
	require(browserHostPath);
	assert.equal(globalThis.PfunBrowser.$builtins.timer.setTimer, core.$setTimer);
	assert.equal(
		globalThis.PfunBrowser.$builtins.timer.setAsyncTimer,
		core.$setAsyncTimer
	);
	assert.equal(
		globalThis.PfunBrowser.$builtins.timer.clearTimer,
		core.$clearTimer
	);

	console.log("Timer Result host behavior passed.");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
