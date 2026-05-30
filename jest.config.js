module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'], // <-- Add this line
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: { target: 'ES2020', module: 'CommonJS', esModuleInterop: true, strict: true }
    }],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts'],
};
