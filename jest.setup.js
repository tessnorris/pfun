// jest.setup.js
BigInt.prototype.toJSON = function () {
  return this.toString() + 'n';
};
