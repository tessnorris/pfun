// jest.bigint-serializer.js
// Custom jest serializer for BigInt values.
// Referenced from jest.config.js snapshotSerializers.
module.exports = {
  test(val) { return typeof val === 'bigint'; },
  print(val) { return `${val}n`; },
};
