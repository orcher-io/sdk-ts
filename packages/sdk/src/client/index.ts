/**
 * The client API: {@link Client} starts workflows and returns
 * {@link WorkflowHandle}s for observing and controlling them.
 *
 * @module @orcher/sdk
 *
 * @example
 * ```typescript
 * import { Client } from '@orcher/sdk';
 *
 * const client = new Client({
 *   serverUrl: 'http://localhost:50051',
 *   namespace: 'default'
 * });
 *
 * await client.connect();
 *
 * const handle = await client.startWorkflow({
 *   workflowId: 'my-workflow',
 *   workflowType: 'processOrder',
 *   taskQueue: 'orders',
 *   args: [{ orderId: 123 }]
 * });
 *
 * const result = await handle.result();
 * console.log('Result:', result);
 *
 * client.close();
 * ```
 */

export { Client } from './client';
export { WorkflowHandle } from './workflow-handle';

export type {
  WorkflowStartOptions,
  WorkflowHandleOptions,
  CancelOptions,
  QueryOptions,
  EventOptions,
} from './types';

export { WorkflowIdReusePolicy } from './types';
