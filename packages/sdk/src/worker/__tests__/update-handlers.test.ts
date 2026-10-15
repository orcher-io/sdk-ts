/**
 * An `@Update` handler runs against the activation that carries the update,
 * with the arguments the client sent.
 */

import 'reflect-metadata';
import { Worker } from '../worker';
import type { Logger } from '../types';
import { Updates, Update } from '../../di/decorators';
import type { WorkflowContext } from '../../workflow/context';

// A worker connects to nothing until run(), which none of these call.
jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({})),
  isNativeAvailable: jest.fn(() => true),
}));

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

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

    const at = { seconds: '1', nanos: 0 };
    const result = await worker.runActivation({
      activationId: new Uint8Array([1]),
      run: {
        workflowId: 'wf-1',
        runId: 'run-1',
        workflowType: 'with_updates',
        taskQueue: 'updates',
        namespace: 'default',
      },
      resolutions: [
        {
          stepId: '',
          at,
          replaying: false,
          sequence: '0',
          what: {
            oneofKind: 'started',
            started: {
              input: [{ data: bytes({}), metadata: {} }],
              attempt: 1,
              startedAt: at,
              randomSeed: new Uint8Array(),
              headers: {},
              stepIds: 0,
              historyLineage: '',
            },
          },
        },
        {
          stepId: '',
          at,
          replaying: false,
          sequence: '0',
          what: {
            oneofKind: 'update',
            update: {
              updateId: 'u-1',
              name: 'change_address',
              args: [{ data: bytes({ city: 'Oslo' }), metadata: {} }],
            },
          },
        },
      ],
      queries: [],
    });

    expect(received).toEqual([{ workflowId: 'wf-1', input: { city: 'Oslo' } }]);
    const [update] = result.updates;
    expect(update!.updateId).toBe('u-1');
    expect(update!.answer.oneofKind).toBe('value');
    const output = update!.answer.oneofKind === 'value' ? update!.answer.value.data : undefined;
    expect(JSON.parse(new TextDecoder().decode(output))).toBe('moved to Oslo');
  });
});
