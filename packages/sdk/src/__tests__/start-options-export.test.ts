/**
 * The `WorkflowStartOptions` the package exports is the type
 * `Client.startWorkflow` takes.
 *
 * The native binding's own options type used to carry the same name, with a
 * required `workflowId` and millisecond-only timeouts, so reading the source
 * for "WorkflowStartOptions" could land on the wrong one. Checked by
 * `npm run type-check:tests`.
 */

import type { Client, WorkflowStartOptions } from '../index';
import { Duration } from '../index';

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <T extends true>(_proof?: T): void => {};

assertType<Equals<WorkflowStartOptions, Parameters<Client['startWorkflow']>[0]>>();

// What startWorkflow accepts, the exported type accepts: no workflowId and a
// Duration timeout.
export const options: WorkflowStartOptions = {
  workflowType: 'order',
  workflowExecutionTimeout: Duration.fromMinutes(5),
};

describe('WorkflowStartOptions', () => {
  it('is checked at compile time', () => {
    expect(options.workflowType).toBe('order');
  });
});
