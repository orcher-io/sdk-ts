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

    const request: any = new FakeEngine({ orderId: 'o-1' }).request();
    request.jobs[0].StartWorkflow.workflow_type = 'order-fulfilment';
    const result = await (w as any).executeWorkflowDirectBindings(request);

    expect(result.successful).toBe(true);
    const completion = result.commands.find((c: any) => 'CompleteWorkflow' in c);
    expect(completion).toBeDefined();
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
