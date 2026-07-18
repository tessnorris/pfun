"use strict";

const assert = require("node:assert/strict");

const core = require("../host/core.js");
const host = require("../host/node.js");

function own(object, key) {
	return Object.prototype.hasOwnProperty.call(object, key);
}

function saveEnvironment(name) {
	if (own(process.env, name) && process.env[name] !== undefined) {
		return {
			present: true,
			value: String(process.env[name])
		};
	}

	return { present: false, value: "" };
}

function restoreEnvironment(name, saved) {
	if (saved.present) {
		process.env[name] = saved.value;
	} else {
		delete process.env[name];
	}
}

function expectSome(option, expected) {
	assert.equal(option.$t, "Some");
	assert.equal(option.$u, "Option");
	assert.equal(option.value, expected);
}

function expectNone(option) {
	assert.equal(option.$t, "None");
	assert.equal(option.$u, "Option");
}

assert.equal(
	host.$builtins.io.scriptArgs,
	host.$scriptArgs
);
assert.equal(
	host.$builtins.io.getEnv,
	host.$getEnv
);
assert.equal(
	host.$builtins.io.envVars,
	host.$envVars
);

const originalArgv = process.argv.slice();

try {
	process.argv.splice(
		0,
		process.argv.length,
		process.execPath,
		"/tmp/process-example.js",
		"alpha",
		"beta gamma",
		"",
		"--literal",
		"β"
	);

	const args = host.$scriptArgs();

	assert.deepEqual(
		args,
		["alpha", "beta gamma", "", "--literal", "β"]
	);

	process.argv.push("later");
	assert.deepEqual(
		args,
		["alpha", "beta gamma", "", "--literal", "β"]
	);
} finally {
	process.argv.splice(
		0,
		process.argv.length,
		...originalArgv
	);
}

const names = [
	"PFUN_D5_PRESENT",
	"PFUN_D5_EMPTY",
	"PFUN_D5_UNICODE",
	"PFUN_D5_MISSING"
];
const saved = new Map(
	names.map((name) => [name, saveEnvironment(name)])
);

try {
	process.env.PFUN_D5_PRESENT = "present value";
	process.env.PFUN_D5_EMPTY = "";
	process.env.PFUN_D5_UNICODE = "β";
	delete process.env.PFUN_D5_MISSING;

	expectSome(
		host.$getEnv("PFUN_D5_PRESENT"),
		"present value"
	);
	expectSome(host.$getEnv("PFUN_D5_EMPTY"), "");
	expectSome(host.$getEnv("PFUN_D5_UNICODE"), "β");
	expectNone(host.$getEnv("PFUN_D5_MISSING"));

	assert.throws(
		() => host.$getEnv(42),
		/environment variable name must be a Str/
	);

	const environment = host.$envVars();

	assert.ok(
		environment
			&& environment.$dict instanceof Map,
		"envVars must return a Pfun Dict"
	);

	expectSome(
		core.$dictGet(environment, "PFUN_D5_PRESENT"),
		"present value"
	);
	expectSome(
		core.$dictGet(environment, "PFUN_D5_EMPTY"),
		""
	);
	expectSome(
		core.$dictGet(environment, "PFUN_D5_UNICODE"),
		"β"
	);
	expectNone(
		core.$dictGet(environment, "PFUN_D5_MISSING")
	);

	process.env.PFUN_D5_PRESENT = "changed later";
	delete process.env.PFUN_D5_UNICODE;

	expectSome(
		core.$dictGet(environment, "PFUN_D5_PRESENT"),
		"present value"
	);
	expectSome(
		core.$dictGet(environment, "PFUN_D5_UNICODE"),
		"β"
	);
} finally {
	for (const name of names) {
		restoreEnvironment(name, saved.get(name));
	}
}

console.log(
	"Node process argument and environment floor behavior passed."
);
