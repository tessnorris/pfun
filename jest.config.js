module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: { target: 'ES2020', module: 'CommonJS', esModuleInterop: true, strict: true },
      diagnostics: false,
    }],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts'],
};
