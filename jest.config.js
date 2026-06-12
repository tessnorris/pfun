module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/test'],
  testMatch: ['**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: { target: 'ES2020', module: 'CommonJS', esModuleInterop: true, strict: true },
      diagnostics: false,
    }],
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  snapshotSerializers: ['<rootDir>/jest.bigint-serializer.js'],
  collectCoverageFrom: ['src/**/*.ts', '!src/test/**/*.ts'],
};
