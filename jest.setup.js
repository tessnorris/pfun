// jest.setup.js
// BigInt.prototype.toJSON is patched by jest.bigint-patch.js (via --require in package.json)
// which runs in all processes before jest starts. This file handles any remaining setup.
BigInt.prototype.toJSON = function () {
  return this.toString() + 'n';
};
