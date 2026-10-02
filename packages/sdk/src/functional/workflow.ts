/**
 * `workflow()`: define a workflow without classes or decorators.
 *
 * It registers the workflow with the `GlobalRegistry`, so a `Worker` picks it up
 * exactly as it does class-based `@Workflow()` definitions.
 *
 * @packageDocumentation
 */

import { GlobalRegistry } from '../di/registry';
import type {
  WorkflowDefinition,
  WorkflowMetadata,
  WorkflowReference,
  Type,
} from '../di/types';

/**
 * Define a workflow from a plain object, without classes or decorators.
 *
 * Returns a `WorkflowReference<TInput, TOutput>` with full type inference.
 * The workflow is registered with the `GlobalRegistry` and picked up by the `Worker`.
 * `version` defaults to `'1.0'`.
 *
 * @param definition - Workflow definition object with name, run function, and optional config
 * @returns A typed `WorkflowReference`
 * @throws {Error} If `name` is empty or `run` is not a function
 *
 * @example
 * Simple workflow:
 * ```typescript
 * import { workflow, WorkflowContext } from '@orcher/sdk';
 *
 * export const orderWorkflow = workflow({
 *   name: 'order-workflow',
 *   version: '1.0',
 *   run: async (ctx: WorkflowContext, order: OrderInput): Promise<OrderResult> => {
 *     const charge = await ctx.executeTask(chargeCard, { amount: order.total });
 *     await ctx.executeTask(sendEmail, { to: order.email, subject: 'Confirmed' });
 *     return { chargeId: charge.id, status: 'completed' };
 *   },
 * });
 * ```
 *
 * @example
 * With timeout and cron:
 * ```typescript
 * export const dailyReport = workflow({
 *   name: 'daily-report',
 *   timeout: 300_000,
 *   cronSchedule: '0 9 * * *',
 *   run: async (ctx: WorkflowContext, input: void): Promise<void> => {
 *     await ctx.executeTask(generateReport, {});
 *     await ctx.executeTask(sendEmail, { to: 'team@example.com', subject: 'Daily Report' });
 *   },
 * });
 * ```
 */
export function workflow<TInput, TOutput>(
  definition: WorkflowDefinition<TInput, TOutput>
): WorkflowReference<TInput, TOutput> {
  const { name, run, version = '1.0', description, timeout, cronSchedule } = definition;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('workflow() requires a non-empty name');
  }

  if (typeof run !== 'function') {
    throw new Error(`workflow('${name}'): run must be a function`);
  }

  // A synthetic workflow class, so the runtime can treat this workflow like a
  // class-based one: `new WorkflowClass()`, then `instance.run(ctx, ...args)`.
  // The computed key names the class after the workflow.
  const WorkflowClass = {
    [name]: class {
      async run(ctx: any, input: TInput): Promise<TOutput> {
        return run(ctx, input);
      }
    },
  }[name] as Type<any>;

  // Register exactly as the `@Workflow()` decorator does.
  const registry = GlobalRegistry.getInstance();

  const metadata: WorkflowMetadata = {
    name,
    version,
    description,
    workflowClass: WorkflowClass,
    timeout,
    cronSchedule,
  };
  registry.registerWorkflow(name, metadata);

  const ref: WorkflowReference<TInput, TOutput> = {
    workflowName: name,
    version,
    workflowClass: WorkflowClass,
  };

  return ref;
}
