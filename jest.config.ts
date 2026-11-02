import type { Config } from 'jest';

const tsJest = {
  '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', isolatedModules: false }],
} as const;

const base = {
  testEnvironment: 'node',
  transform: tsJest,
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFiles: ['<rootDir>/test/setup/env.ts'],
};

const config: Config = {
  // One shared PostgreSQL container per run: test files must not truncate under each other.
  maxWorkers: 1,
  testTimeout: 60000,
  projects: [
    {
      ...base,
      displayName: 'unit',
      testMatch: ['<rootDir>/test/unit/**/*.spec.ts', '<rootDir>/test/architecture/**/*.spec.ts'],
    },
    {
      ...base,
      displayName: 'int',
      testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
      globalSetup: '<rootDir>/test/setup/global-setup.ts',
      globalTeardown: '<rootDir>/test/setup/global-teardown.ts',
      testTimeout: 60000,
    },
    {
      ...base,
      displayName: 'e2e',
      testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
      globalSetup: '<rootDir>/test/setup/global-setup.ts',
      globalTeardown: '<rootDir>/test/setup/global-teardown.ts',
      testTimeout: 60000,
    },
  ],
};

export default config;
