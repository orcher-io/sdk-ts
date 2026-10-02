module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/packages'],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/?(*.)+(spec|test).+(ts|tsx|js)',
  ],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    }],
  },
  collectCoverageFrom: [
    'packages/**/src/**/*.{ts,tsx}',
    '!packages/**/src/**/*.d.ts',
    '!packages/**/src/**/*.test.ts',
    '!packages/**/src/**/*.spec.ts',
    '!packages/**/src/__tests__/**',
    '!packages/**/src/__mocks__/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '^@orcher/core$': '<rootDir>/packages/core/src',
    '^@orcher/sdk$': '<rootDir>/packages/sdk/src',
    '^@orcher/testing$': '<rootDir>/packages/testing/src',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testTimeout: 10000,
  verbose: true,
  bail: false,
  maxWorkers: '50%',
  globals: {
    'ts-jest': {
      isolatedModules: true,
    },
  },
  projects: [
    {
      displayName: 'core',
      testMatch: ['<rootDir>/packages/core/**/*.test.ts'],
    },
    {
      displayName: 'sdk',
      testMatch: ['<rootDir>/packages/sdk/**/*.test.ts'],
    },
    {
      displayName: 'testing',
      testMatch: ['<rootDir>/packages/testing/**/*.test.ts'],
    },
  ],
};
