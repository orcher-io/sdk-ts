/**
 * Mocks of Orcher components: tasks, the client, and workflow handles.
 *
 * @module @orcher/sdk/testing/mocks
 *
 * @example Task mocking
 * ```typescript
 * import { MockTaskRegistry, MockTaskBuilder } from '@orcher/sdk/testing';
 *
 * const registry = new MockTaskRegistry();
 * const builder = new MockTaskBuilder('chargeCard', registry);
 *
 * builder.returns({ chargeId: 'ch_123', success: true });
 * ```
 *
 * @example Client mocking
 * ```typescript
 * import { MockOrcherClient } from '@orcher/sdk/testing';
 *
 * const client = new MockOrcherClient();
 *
 * // Mock workflow result
 * client.mockWorkflowResult(orderWorkflow, { status: 'completed' });
 *
 * // Start workflow
 * const handle = await client.startWorkflow(orderWorkflow, {
 *   workflowId: 'order-123',
 *   input: orderData
 * });
 *
 * // Get result
 * const result = await handle.result();
 * ```
 *
 * @example Workflow handle mocking
 * ```typescript
 * import { MockWorkflowHandle } from '@orcher/sdk/testing';
 *
 * const handle = new MockWorkflowHandle('wf-123', 'orderWorkflow');
 *
 * // Simulate completion
 * handle.completeWith({ status: 'completed' });
 *
 * // Send events
 * await handle.sendEvent('orderApproved', { approvedBy: 'manager' });
 *
 * // Verify
 * handle.verifyEventSent('orderApproved');
 * ```
 */

// ============================================================================
// Task Mocking
// ============================================================================

export {
  MockTaskRegistry,
  MockTaskInspector,
  createMockTaskRegistry,
  type MockTaskCallRecord,
} from './task-registry';

export { MockTaskBuilder, createMockTaskBuilder } from './task-builder';

// ============================================================================
// Client Mocking
// ============================================================================

export { MockOrcherClient, createMockOrcherClient, type StartWorkflowOptions } from './client';

export { MockWorkflowHandle, createMockWorkflowHandle } from './handle';

// ============================================================================
// Convenience Factories
// ============================================================================

/**
 * Create a mock client for a namespace.
 *
 * @param namespace - Namespace to use (default: `test`)
 * @returns Configured mock client
 *
 * @example
 * ```typescript
 * import { createMockClient } from '@orcher/sdk/testing';
 *
 * const client = createMockClient('test');
 * ```
 */
export function createMockClient(namespace: string = 'test'): MockOrcherClient {
  const { MockOrcherClient } = require('./client');
  return new MockOrcherClient({
    serverUrl: 'mock://localhost:50051',
    namespace,
  });
}

/**
 * Create a mock task registry with a fixed-value mock for each entry.
 *
 * @param mocks - Map of task names to the value each task returns
 * @returns Configured mock registry
 *
 * @example
 * ```typescript
 * import { createMockRegistry } from '@orcher/sdk/testing';
 *
 * const registry = createMockRegistry({
 *   'chargeCard': { chargeId: 'ch_123', success: true },
 *   'reserveInventory': { reserved: true },
 *   'sendEmail': undefined
 * });
 * ```
 */
export function createMockRegistry(mocks: Record<string, any> = {}): MockTaskRegistry {
  const { MockTaskRegistry } = require('./task-registry');
  const registry = new MockTaskRegistry();

  for (const [taskName, value] of Object.entries(mocks)) {
    registry.registerMock(taskName, {
      type: 'fixed',
      value,
    });
  }

  return registry;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if value is a mock workflow handle.
 *
 * The check is structural: any object with a `completeWith` method passes.
 *
 * @param value - Value to check
 * @returns True if mock handle
 *
 * @example
 * ```typescript
 * if (isMockWorkflowHandle(handle)) {
 *   handle.completeWith(result);
 * }
 * ```
 */
export function isMockWorkflowHandle(value: any): value is MockWorkflowHandle {
  return value && typeof value.completeWith === 'function';
}

/**
 * Check if value is a mock Orcher client.
 *
 * The check is structural: any object with a `mockWorkflowResult` method passes.
 *
 * @param value - Value to check
 * @returns True if mock client
 *
 * @example
 * ```typescript
 * if (isMockOrcherClient(client)) {
 *   client.mockWorkflowResult(workflow, result);
 * }
 * ```
 */
export function isMockOrcherClient(value: any): value is MockOrcherClient {
  return value && typeof value.mockWorkflowResult === 'function';
}

/**
 * Check if value is a mock task registry.
 *
 * The check is structural: any object with a `registerMock` method passes.
 *
 * @param value - Value to check
 * @returns True if mock registry
 *
 * @example
 * ```typescript
 * if (isMockTaskRegistry(registry)) {
 *   registry.registerMock(taskName, strategy);
 * }
 * ```
 */
export function isMockTaskRegistry(value: any): value is MockTaskRegistry {
  return value && typeof value.registerMock === 'function';
}

// Type-only imports for the signatures above.
import type { MockTaskRegistry } from './task-registry';
import type { MockOrcherClient } from './client';
import type { MockWorkflowHandle } from './handle';
