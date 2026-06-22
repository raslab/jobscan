import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Longer timeout for integration tests hitting real dev server
  testTimeout: 30_000,
  // Show individual test names
  verbose: true,
};

export default config;
