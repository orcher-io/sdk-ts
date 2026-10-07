/**
 * The test environment runs a `workflow({...})` reference as well as a bare
 * run function.
 *
 * It accepted run functions only, so a workflow defined with the functional
 * API, which is how the docs define them, could not be tested without
 * reaching past the reference to the function inside it. The type assertions
 * are checked by `npm run type-check:tests`.
 */

import { TestWorkflowEnvironment } from '../environment';
import { workflow } from '../../functional/workflow';
import { task } from '../../functional/task';
import { globalRegistry } from '../../di/registry';
import type { WorkflowContext } from '../../workflow/context';

interface Order {
  orderId: string;
  amount: number;
}

describe('TestWorkflowEnvironment with a workflow() reference', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeEach(async () => {
    testEnv = await TestWorkflowEnvironment.create();
  });

  afterEach(async () => {
    await testEnv.cleanup();
    globalRegistry.clear();
  });

  const chargeCard = () =>
    task({
      name: 'chargeCard',
      execute: async (_ctx, input: { amount: number }) => ({ charged: input.amount }),
    });

  const orderWorkflow = (charge: ReturnType<typeof chargeCard>) =>
    workflow({
      name: 'order-workflow',
      run: async (ctx: WorkflowContext, order: Order) => {
        const receipt = await ctx.executeTask(charge, { amount: order.amount });
        return { orderId: order.orderId, charged: receipt.charged };
      },
    });

  it('runs it with executeWorkflow', async () => {
    const ref = orderWorkflow(chargeCard());
    testEnv.mockTask('chargeCard').returns({ charged: 42 });

    const result = await testEnv.executeWorkflow(ref, { orderId: 'o-1', amount: 42 });

    // The result keeps the reference's output type.
    const charged: number = result.charged;
    expect(charged).toBe(42);
    expect(result).toEqual({ orderId: 'o-1', charged: 42 });
  });

  it('runs it with startWorkflow', async () => {
    const ref = orderWorkflow(chargeCard());
    testEnv.mockTask('chargeCard').returns({ charged: 7 });

    await expect(testEnv.startWorkflow(ref, { orderId: 'o-2', amount: 7 })).resolves.toEqual({
      orderId: 'o-2',
      charged: 7,
    });
  });

  it('still runs a bare run function', async () => {
    const result = await testEnv.executeWorkflow(
      async (_ctx: WorkflowContext, n: number) => n * 2,
      21
    );
    expect(result).toBe(42);
  });

  it('checks the input against the reference', () => {
    const ref = orderWorkflow(chargeCard());
    // Compiled, never run.
    const typeOnly = () =>
      // @ts-expect-error the input must be an Order
      testEnv.executeWorkflow(ref, { orderId: 1 });
    expect(typeof typeOnly).toBe('function');
  });

  it('names what it takes when given something else', async () => {
    await expect(testEnv.executeWorkflow({} as never, {})).rejects.toThrow(
      /run function or the reference workflow/
    );
  });
});
