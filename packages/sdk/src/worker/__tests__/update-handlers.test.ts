/**
 * An `@Update` handler runs against the activation that carries the update,
 * with the arguments the client sent.
 */

import 'reflect-metadata';
import { Worker } from '../worker';
import type { Logger } from '../types';
import { Updates, Update } from '../../di/decorators';
import type { WorkflowContext } from '../../workflow/context';

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({
    serviceCreate: jest.fn(() => ({})),
    serviceStart: jest.fn(async () => undefined),
    pollWorkflowTask: jest.fn(() => new Promise(() => {})),
    pollTask: jest.fn(() => new Promise(() => {})),
  })),
  isNativeAvailable: jest.fn(() => true),
}));

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

const bytes = (value: unknown): number[] =>
  Array.from(new TextEncoder().encode(JSON.stringify(value)));

const received: Array<{ workflowId: string; input: unknown }> = [];

@Updates()
class AddressUpdates {
  @Update({ name: 'change_address' })
  async changeAddress(ctx: WorkflowContext, input: { city: string }): Promise<string> {
    received.push({ workflowId: ctx.workflowId(), input });
    return `moved to ${input.city}`;
  }
}

describe('@Update handlers', () => {
  it('receive the activation context and the arguments the client sent', async () => {
    void AddressUpdates;
    const workflow = async (ctx: WorkflowContext) => {
      await ctx.waitForEvent('done');
      return null;
    };
    Object.defineProperty(workflow, 'name', { value: 'with_updates' });
    const worker = new Worker({
      serverUrl: 'http://localhost:1',
      namespace: 'default',
      taskQueue: 'updates',
      workflows: [workflow],
      tasks: [],
      logger: silent,
    });

    const result = await (worker as any).executeWorkflowDirectBindings({
      run_id: 'run-1',
      execution: { workflow_id: 'wf-1', run_id: 'run-1' },
      jobs: [
        { StartWorkflow: { workflow_type: 'with_updates', workflow_id: 'wf-1', input: {} } },
        // The job as sdk-core serializes it.
        {
          UpdateState: {
            update_id: 'u-1',
            update_name: 'change_address',
            payload: { data: bytes({ city: 'Oslo' }), metadata: {} },
            headers: [],
          },
        },
      ],
    });

    expect(received).toEqual([{ workflowId: 'wf-1', input: { city: 'Oslo' } }]);
    const [update] = result.update_results;
    expect(update.update_id).toBe('u-1');
    const output = update.result.Completed.output.data;
    expect(JSON.parse(new TextDecoder().decode(new Uint8Array(output)))).toBe('moved to Oslo');
  });
});
