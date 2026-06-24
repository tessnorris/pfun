module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/test'],
  testMatch: ['**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // Cap parallelism: the integration tests (runFile, transpiler, repl) spawn
  // real child processes and do file/network I/O. Without a worker limit,
  // running all 32 suites simultaneously saturates the machine.
  // 4 workers is a safe default; increase if your machine has spare cores.
  maxWorkers: 4,
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
