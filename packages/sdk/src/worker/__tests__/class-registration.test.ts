/**
 * A decorated class given in `WorkerOptions` registers under the name its
 * decorator declares, so a start by that name reaches it.
 */

import 'reflect-metadata';
import { Worker } from '../worker';
import type { Logger } from '../types';
import { Workflow } from '../../di/decorators/workflow';
import { Tasks } from '../../di/decorators/tasks';
import { Task } from '../../di/decorators/task';
import type { WorkflowContext } from '../../workflow/context';
import { FakeEngine } from './support/fake-engine';

// A worker connects to nothing until run(), which none of these call.
jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({})),
  isNativeAvailable: jest.fn(() => true),
}));

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

@Workflow({ name: 'order-fulfilment' })
class OrderFulfilmentWorkflow {
  async run(_ctx: WorkflowContext, input: { orderId: string }) {
    return { fulfilled: input.orderId };
  }
}

@Tasks()
class ShippingTasks {
  @Task()
  async bookCourier(_ctx: unknown, orderId: string) {
    return `courier for ${orderId}`;
  }

  @Task()
  async printLabel(_ctx: unknown, orderId: string) {
    return `label for ${orderId}`;
  }
}

const worker = (options: { workflows?: unknown[]; tasks?: unknown[] }) =>
  new Worker({
    serverUrl: 'http://localhost:1',
    namespace: 'default',
    taskQueue: 'q',
    workflows: [],
    tasks: [],
    logger: silent,
    ...options,
  });

describe('decorated classes in WorkerOptions', () => {
  it('registers a Workflow class under its declared name and runs it', async () => {
    const w = worker({ workflows: [OrderFulfilmentWorkflow] });

    expect([...(w as any).workflowMap.keys()]).toEqual(['order-fulfilment']);

    const activation = new FakeEngine({ orderId: 'o-1' }).activation();
    activation.run!.workflowType = 'order-fulfilment';
    const result = await w.runActivation(activation);

    expect(result.outcome.oneofKind).toBe('commands');
    const commands =
      result.outcome.oneofKind === 'commands' ? result.outcome.commands.commands : [];
    expect(commands.find((c) => c.what.oneofKind === 'completeRun')).toBeDefined();
  });

  it('registers every task of a Tasks class under its task name', () => {
    const w = worker({ tasks: [ShippingTasks] });

    expect([...(w as any).taskMap.keys()].sort()).toEqual(['bookCourier', 'printLabel']);
  });

  it('still registers a plain function under its own name', () => {
    const plain = async () => null;
    const w = worker({ workflows: [plain], tasks: [plain] });

    expect([...(w as any).workflowMap.keys()]).toEqual(['plain']);
    expect([...(w as any).taskMap.keys()]).toEqual(['plain']);
  });
});
