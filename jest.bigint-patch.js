// jest.bigint-patch.js
// Required via NODE_OPTIONS before jest starts, so the BigInt patch is
// applied in both the main process and all worker processes before any
// serialization occurs.
BigInt.prototype.toJSON = function() { return this.toString() + 'n'; };
