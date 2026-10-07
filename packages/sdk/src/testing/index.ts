/**
 * Testing utilities for Orcher workflows.
 *
 * Workflows run in memory against mocked tasks and a controllable test clock, so unit tests are
 * fast and deterministic and need no Orcher server.
 *
 * @module @orcher/sdk/testing
 *
 * @example Basic usage
 * ```typescript
 * import { TestWorkflowEnvironment } from '@orcher/sdk/testing';
 * import { orderWorkflow } from './workflows/orderWorkflow';
 *
 * describe('Order Processing', () => {
 *   let testEnv: TestWorkflowEnvironment;
 *
 *   beforeEach(async () => {
 *     testEnv = await TestWorkflowEnvironment.create();
 *   });
 *
 *   afterEach(async () => {
 *     await testEnv.cleanup();
 *   });
 *
 *   it('should process order successfully', async () => {
 *     testEnv.mockTask('chargeCard').returns({ chargeId: 'ch_123' });
 *     testEnv.mockTask('reserveInventory').returns({ reserved: true });
 *
 *     const result = await testEnv.executeWorkflow(orderWorkflow, {
 *       orderId: 'order-123',
 *       amount: 99.99,
 *       items: ['item1', 'item2']
 *     });
 *
 *     expect(result.status).toBe('completed');
 *     testEnv.assertTaskCalled('chargeCard', 1);
 *     testEnv.assertTaskCalled('reserveInventory', 1);
 *   });
 *
 *   it('should fail the order when payment fails', async () => {
 *     // Retries come from the task's retryPolicy and are applied by the engine.
 *     // The in-memory environment runs each task call once.
 *     testEnv.mockTask('chargeCard').throws(new Error('Payment gateway timeout'));
 *
 *     await expect(
 *       testEnv.executeWorkflow(orderWorkflow, { orderId: 'order-456', amount: 49.99 })
 *     ).rejects.toThrow();
 *     testEnv.assertTaskCalled('chargeCard', 1);
 *   });
 *
 *   it('should wait for a slow task', async () => {
 *     // The delay runs on the test clock, so only advanceTime releases it.
 *     testEnv.mockTask('chargeCard').resolvesAfter({ chargeId: 'ch_789' }, 10000);
 *
 *     const promise = testEnv.startWorkflow(orderWorkflow, {
 *       orderId: 'order-789',
 *       amount: 29.99
 *     });
 *
 *     await testEnv.advanceTime(10000);
 *
 *     const result = await promise;
 *     expect(result.status).toBe('completed');
 *   });
 * });
 * ```
 *
 * @example Advanced mocking
 * ```typescript
 * // Compute the result from the input
 * testEnv.mockTask('calculateTax').withFn(async (amount: number) => {
 *   return amount * 0.08;
 * });
 *
 * // Branch on the input
 * testEnv.mockTask('validateCard').withFn(async (card: Card) => {
 *   if (card.number.startsWith('4')) {
 *     return { valid: true, type: 'Visa' };
 *   }
 *   return { valid: false, error: 'Invalid card' };
 * });
 *
 * // Flaky service: success, failure, success, failure
 * testEnv.mockTask('externalAPI').alternates(
 *   { data: 'success' },
 *   new Error('Service unavailable'),
 *   4
 * );
 * ```
 *
 * @example Time control
 * ```typescript
 * it('should handle scheduled workflows', async () => {
 *   const testEnv = await TestWorkflowEnvironment.create({
 *     initialTime: new Date('2025-01-01T00:00:00Z')
 *   });
 *
 *   const promise = testEnv.startWorkflow(reminderWorkflow, {
 *     sendAt: new Date('2025-01-01T12:00:00Z')
 *   });
 *
 *   await testEnv.advanceTimeTo(new Date('2025-01-01T12:00:00Z'));
 *
 *   const result = await promise;
 *   expect(result.sent).toBe(true);
 * });
 * ```
 *
 * @example State inspection
 * ```typescript
 * it('should update workflow state correctly', async () => {
 *   const testEnv = await TestWorkflowEnvironment.create();
 *
 *   const promise = testEnv.startWorkflow(counterWorkflow, { max: 10 }, {
 *     workflowId: 'counter-1'
 *   });
 *
 *   await testEnv.advanceTime(1000);
 *
 *   const trace = testEnv.getExecutionTrace('counter-1');
 *   const counter = testEnv.getWorkflowState('counter-1', 'counter');
 *
 *   expect(counter).toBe(5);
 *   expect(trace?.tasksExecuted.length).toBeGreaterThan(0);
 * });
 * ```
 */

// ============================================================================
// Main Test Environment
// ============================================================================

export { TestWorkflowEnvironment, createTestWorkflowEnvironment } from './environment';
export type { TestableWorkflow } from './environment';

// ============================================================================
// Test Executor
// ============================================================================

export { TestExecutor, createTestExecutor } from './executor';

// ============================================================================
// Execution Trace
// ============================================================================

export { ExecutionTrace, createExecutionTrace } from './trace';

// ============================================================================
// Task Mocking
// ============================================================================

export {
  MockTaskRegistry,
  MockTaskInspector,
  createMockTaskRegistry,
  type MockTaskCallRecord,
} from './mocks/task-registry';

export { MockTaskBuilder, createMockTaskBuilder } from './mocks/task-builder';

export {
  MockOrcherClient,
  createMockOrcherClient,
  type StartWorkflowOptions,
} from './mocks/client';

export { MockWorkflowHandle, createMockWorkflowHandle } from './mocks/handle';

export {
  createMockClient,
  createMockRegistry,
  isMockWorkflowHandle,
  isMockOrcherClient,
  isMockTaskRegistry,
} from './mocks';

// ============================================================================
// Time Control
// ============================================================================

export { TimeController, createTimeController } from './time/controller';

// ============================================================================
// Assertions
// ============================================================================

export {
  // Workflow assertions
  assertWorkflowCompleted,
  assertWorkflowFailed,
  assertWorkflowRunning,
  assertWorkflowCancelled,
  assertWorkflowTimedOut,
  assertWorkflowStatus,
  assertWorkflowState,
  assertWorkflowHasState,
  assertWorkflowTaskCount,
  assertWorkflowEventCount,
  assertWorkflowDuration,
  assertHandleCompleted,
  assertHandleFailed,
  assertHandleCancelled,
  AssertionError,
  // Task assertions
  assertTaskCalled,
  assertTaskCalledTimes,
  assertTaskCalledWith,
  assertTaskNotCalled,
  assertTaskCallSucceeded,
  assertTaskCallFailed,
  assertAllTaskCallsSucceeded,
  assertTaskCallCountInRange,
  assertTaskCalledAtLeast,
  assertTaskCalledAtMost,
  assertTaskCallOrder,
  assertTaskCallDuration,
  // Custom matchers
  extendExpect,
  workflowMatchers,
  taskMatchers,
  handleMatchers,
  // Convenience functions
  assertCompleted,
  assertFailed,
  createAssertion,
  isExecutionTrace,
  isMockHandle,
  isMockRegistry,
} from './assertions';

export type { MatcherResult, HandleMatchers } from './assertions/matchers';

// ============================================================================
// Test Fixtures
// ============================================================================

export {
  // Builders
  TestDataBuilder,
  WorkflowInputBuilder,
  TaskInputBuilder,
  WorkflowOptionsBuilder,
  TestEnvOptionsBuilder,
  createWorkflowInput,
  createTaskInput,
  createTestData,
  // Common data factories
  createOrder,
  createPayment,
  createUser,
  createProduct,
  createAddress,
  createNotification,
  // Workflow input factories
  createOrderProcessingInput,
  createPaymentProcessingInput,
  createNotificationInput,
  // Task input factories
  createChargeCardInput,
  createSendEmailInput,
  createValidateOrderInput,
  createReserveInventoryInput,
  // Result factories
  createSuccessResult,
  createFailureResult,
  createChargeCardResult,
  createValidationResult,
  // Collection factories
  createOrders,
  createUsers,
  createProducts,
  // Random data generators
  randomEmail,
  randomAmount,
  randomPick,
  randomBoolean,
  resetIdCounter,
  // Scenario builders
  createOrderScenario,
  createPaymentScenario,
  createNotificationScenario,
  createBatchScenario,
} from './fixtures';

// ============================================================================
// Types
// ============================================================================

export type {
  // Test Environment
  TestEnvOptions,
  TestWorkflowOptions,
  TestEnvStats,

  // Execution Trace
  ExecutionTrace as IExecutionTrace,
  ExecutionStatus,
  TaskExecution,
  WorkflowEvent,
  WorkflowQuery,
  ChildWorkflowExecution,
  TimerExecution,
  StateSnapshot,

  // Mocking
  MockStrategy,
  FixedMockStrategy,
  SequenceMockStrategy,
  FunctionMockStrategy,
  ErrorMockStrategy,
  TaskMock,
  TaskCall,

  // Time Control
  MockTimer,
  TimeAdvanceOptions,

  // Testing Utilities
  AssertionResult,
  TestFixture,
} from './types';

export type { WorkflowMatchers, TaskMatchers } from './types';

// ============================================================================
// Convenience Helpers
// ============================================================================

/**
 * Create a test environment; the same as `TestWorkflowEnvironment.create`.
 *
 * @param options - Environment options
 * @returns Test environment instance
 *
 * @example
 * ```typescript
 * import { createTestEnv } from '@orcher/sdk/testing';
 *
 * const testEnv = await createTestEnv({
 *   namespace: 'test',
 *   taskQueue: 'test-queue'
 * });
 * ```
 */
export async function createTestEnv(options?: TestEnvOptions) {
  const { TestWorkflowEnvironment } = await import('./environment');
  return TestWorkflowEnvironment.create(options);
}

/**
 * Check whether a value is a test environment.
 *
 * The check is structural: any object with a `mockTask` method passes.
 *
 * @param env - Value to check
 * @returns True if `env` looks like a `TestWorkflowEnvironment`
 *
 * @example
 * ```typescript
 * if (isTestEnvironment(env)) {
 *   console.log('Running in test mode');
 * }
 * ```
 */
export function isTestEnvironment(env: any): env is TestWorkflowEnvironment {
  return env && typeof env.mockTask === 'function';
}

// ============================================================================
// Version Info
// ============================================================================

/**
 * Testing utilities version.
 */
export const TESTING_VERSION = '1.0.0';

/**
 * Describe the testing utilities: version, features, and supported test runners.
 *
 * @returns Version, feature list, and minimum versions of Jest, Vitest, and Node.js
 *
 * @example
 * ```typescript
 * import { getTestingInfo } from '@orcher/sdk/testing';
 *
 * console.log(getTestingInfo());
 * // {
 * //   version: '1.0.0',
 * //   features: ['mocking', 'timeControl', 'tracing', 'assertions', ...],
 * //   compatible: { jest: '>=27.0.0', vitest: '>=0.30.0', node: '>=16.0.0' }
 * // }
 * ```
 */
export function getTestingInfo() {
  return {
    version: TESTING_VERSION,
    features: [
      'mocking',
      'timeControl',
      'tracing',
      'assertions',
      'customMatchers',
      'stateInspection',
      'testFixtures',
    ],
    compatible: {
      jest: '>=27.0.0',
      vitest: '>=0.30.0',
      node: '>=16.0.0',
    },
  };
}

// Type-only imports for the helper signatures above.

import type { TestEnvOptions } from './types';
import type { TestWorkflowEnvironment } from './environment';
