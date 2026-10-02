// Jest setup for the Orcher TypeScript SDK. Runs before each test suite.

// The SDK's decorators rely on reflect-metadata being loaded first.
import 'reflect-metadata';

// Longer timeout for integration tests.
jest.setTimeout(30000);

// Console output is left on. Uncomment the lines below to silence it.
global.console = {
  ...console,
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};

process.env.NODE_ENV = 'test';
process.env.ORCHER_SERVER_URL = process.env.ORCHER_SERVER_URL || 'http://localhost:50051';

global.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

afterAll(async () => {
  // A short pause lets pending timers and sockets settle before Jest exits.
  await new Promise((resolve) => setTimeout(resolve, 100));
});

// Fail loudly on an unhandled promise rejection instead of letting it pass silently.
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection in test:', reason);
  throw reason;
});
