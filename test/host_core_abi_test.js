"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const core = require("../host/core.js");
const REQUIRED = ["$addI", "$arrGet", "$arrSet", "$bitAndI", "$bitNotI", "$bitOrI", "$cmpF", "$compLazy", "$compStrict", "$concatS", "$dictFromEntries", "$dictGet", "$dictSet", "$divI", "$eq", "$eqF", "$eqI", "$extern", "$field", "$geI", "$gtI", "$index", "$indexSet", "$lazyList", "$leI", "$listExactLen", "$listMinLen", "$listRest", "$ltI", "$makeRecord", "$makeVariant", "$matchFail", "$memoize", "$modI", "$mulI", "$nativeError", "$nativeErrorMessage", "$nativeErrorOperation", "$negI", "$newArray", "$nth", "$nthU", "$optionPipe", "$resultPipe", "$shlI", "$shrI", "$starGet", "$str", "$strAt", "$subI", "$toF"];

for (const name of REQUIRED) {
  assert.equal(typeof core[name], "function", "missing " + name);
}

assert.equal(core.$addI(Number.MAX_SAFE_INTEGER, 1), 9007199254740992n);
assert.equal(core.$leI(2, 2), true);
assert.equal(core.$geI(3, 2), true);
assert.equal(core.$bitNotI(0), -1);
assert.equal(core.$toF(7n), 7);

const nativeFailure = core.$nativeError(
  "NativeIoError",
  "readFile",
  "EACCES: denied"
);
assert.equal(nativeFailure.$u, "NativeError");
assert.equal(nativeFailure.$t, "NativeIoError");
assert.equal(core.$nativeErrorOperation(nativeFailure), "readFile");
assert.equal(core.$nativeErrorMessage(nativeFailure), "EACCES: denied");
assert.equal(core.$err(nativeFailure).message, nativeFailure);

let capturedStdout = "";
const originalWriteSync = fs.writeSync;
try {
  fs.writeSync = function captureStdout(fd, buffer, offset, length) {
    assert.equal(fd, process.stdout.fd);
    capturedStdout += buffer.subarray(offset, offset + length).toString("utf8");
    return length;
  };
  assert.equal(core.$print("out").$t, "Ok");
  assert.equal(core.$println(7).$t, "Ok");
  assert.equal(core.$flushStdout().$t, "Ok");
} finally {
  fs.writeSync = originalWriteSync;
}
assert.equal(capturedStdout, "out7\n");

try {
  fs.writeSync = function failStdoutWrite() {
    throw new Error("stdout write failed");
  };
  const failure = core.$print("unwritable");
  assert.equal(failure.$u, "Result");
  assert.equal(failure.$t, "Err");
  assert.equal(failure.message.$t, "NativeIoError");
  assert.equal(failure.message.operation, "print");
  assert.match(failure.message.message, /stdout write failed/);
} finally {
  fs.writeSync = originalWriteSync;
}

const lazy = core.$lazyList([() => 1, () => 2, () => 3]);
assert.equal(core.$listMinLen(lazy, 2), true);
assert.equal(core.$listExactLen(lazy, 3), true);
assert.equal(core.$nthU(lazy, 1), 2);
assert.deepEqual(core.$take(2, core.$listRest(lazy, 1)), [2, 3]);

const strictComp = core.$compStrict(
  [() => [1, 2], (x) => [x, x + 10]],
  ["x", "y"],
  (x, y) => y > x,
  (x, y) => [x, y]
);
assert.deepEqual(strictComp, [[1, 11], [2, 12]]);

const lazyComp = core.$compLazy(
  [() => [1, 2, 3]],
  ["x"],
  (x) => x % 2 === 1,
  (x) => x * 10
);
assert.deepEqual(core.$take(2, lazyComp), [10, 30]);

const dict = core.$dictFromEntries([["a", 1], ["b", 2]]);
assert.deepEqual(core.$dictGet(dict, "a").f, [1]);
assert.equal(core.$indexSet(dict, "c", 3), true);
assert.deepEqual(core.$index(dict, "c").f, [3]);
assert.deepEqual(core.$strAt("abc", 1).f, ["b"]);
assert.equal(core.$starGet([{ x: 1 }, { y: 2 }], "y"), 2);
assert.throws(
  () => core.$starGet([{ x: 1 }, { x: 2 }], "x"),
  /ambiguous star import/
);

// Record ABI dynamic-field fallback regression.
const pendingRecord = core.$makeRecord(
  "LoadPending",
  ["path", "importer", "span"],
  ["entry.pf", "entry.pf", null]
);
assert.equal(core.$field(pendingRecord, "path"), "entry.pf");
assert.deepEqual(pendingRecord.f, ["entry.pf", "entry.pf", null]);

const someVariant = core.$makeVariant(
  "Some",
  "Option",
  ["value"],
  [7]
);
assert.equal(core.$field(someVariant, "value"), 7);
assert.deepEqual(someVariant.f, [7]);

let optionCalls = 0;
assert.equal(
  core.$optionPipe(someVariant, (value) => {
    optionCalls += 1;
    return value + 1;
  }, false).value,
  8
);
assert.equal(
  core.$optionPipe(core.$none(), () => {
    optionCalls += 1;
    return 0;
  }, false).$t,
  "None"
);
assert.equal(optionCalls, 1);
assert.equal(
  core.$optionPipe(someVariant, (value) => core.$some(value + 2), true).value,
  9
);

let resultCalls = 0;
assert.equal(
  core.$resultPipe(core.$ok(4), (value) => {
    resultCalls += 1;
    return value * 2;
  }, false).value,
  8
);
assert.equal(
  core.$resultPipe(core.$err("stop"), () => {
    resultCalls += 1;
    return 0;
  }, false).$t,
  "Err"
);
assert.equal(resultCalls, 1);
assert.equal(
  core.$resultPipe(core.$ok(4), (value) => core.$ok(value + 3), true).value,
  7
);

console.log("Phase 13/core ABI conformance passed.");
