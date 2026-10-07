/**
 * `task()`: define a task without classes or decorators.
 *
 * It returns a `TaskReference` that works in `ctx.executeTask()` exactly like the
 * references class-based `@Task()` methods produce.
 *
 * @packageDocumentation
 */

import { GlobalRegistry } from '../di/registry';
import type {
  TaskDefinition,
  TaskMetadata,
  TaskReference,
  TaskHandlerMetadata,
  Type,
} from '../di/types';

/**
 * Define a task from a plain object, without classes or decorators.
 *
 * Returns a `TaskReference<TInput, TOutput>` with full type inference,
 * usable in `ctx.executeTask()` exactly like class-based `@Task()` references.
 *
 * @param definition - Task definition object with name, execute function, and optional config
 * @returns A typed `TaskReference` for use in workflows
 * @throws {Error} If `name` is empty or `execute` is not a function
 *
 * @example
 * Simple task:
 * ```typescript
 * import { task, TaskContext } from '@orcher/sdk';
 *
 * export const sendEmail = task({
 *   name: 'send-email',
 *   execute: async (ctx: TaskContext, input: { to: string; subject: string }) => {
 *     await mailer.send(input.to, input.subject);
 *   },
 * });
 * ```
 *
 * @example
 * With timeout and retry:
 * ```typescript
 * export const chargeCard = task({
 *   name: 'charge-card',
 *   timeout: 30_000,
 *   retryPolicy: { maxAttempts: 3, backoffCoefficient: 2 },
 *   execute: async (ctx: TaskContext, input: ChargeInput): Promise<ChargeResult> => {
 *     return payments.charge({ amount: input.amount });
 *   },
 * });
 * ```
 *
 * @example
 * Use in workflows alongside class-based tasks:
 * ```typescript
 * const paymentTasks = createTaskRefs(PaymentTasks);
 *
 * const result = await ctx.executeTask(sendEmail, { to: 'a@b.com', subject: 'hi' });
 * const charge = await ctx.executeTask(paymentTasks.chargeCard, input);
 * ```
 */
export function task<TInput, TOutput>(
  definition: TaskDefinition<TInput, TOutput>
): TaskReference<TInput, TOutput> {
  const { name, execute, timeout, heartbeatTimeout, retryPolicy } = definition;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('task() requires a non-empty name');
  }

  if (typeof execute !== 'function') {
    throw new Error(`task('${name}'): execute must be a function`);
  }

  // A synthetic handler class, so the runtime can treat this task like a
  // class-based one: `new HandlerClass()`, then `instance[methodName](ctx, input)`.
  const methodName = 'execute';

  // The computed key names the class after the task, for readable stack traces.
  const HandlerClass = {
    [name]: class {
      async execute(ctx: any, input: TInput): Promise<TOutput> {
        return execute(ctx, input);
      }
    },
  }[name] as Type<any>;

  // Register the handler and the task exactly as `@Tasks()` and `@Task()` do.
  const registry = GlobalRegistry.getInstance();

  const handlerMetadata: TaskHandlerMetadata = {
    token: HandlerClass,
    registered: true,
  };
  registry.registerTaskHandler(HandlerClass, handlerMetadata);

  const taskMetadata: TaskMetadata = {
    name,
    handlerClass: HandlerClass,
    methodName,
    timeout,
    heartbeatTimeout,
    retryPolicy,
  };
  registry.registerTask(name, taskMetadata);

  const ref: TaskReference<TInput, TOutput> = {
    taskName: name,
    handlerClass: HandlerClass,
    methodName,
    retryPolicy: taskMetadata.retryPolicy,
    // `executeTask` reads the timeout from this reference, not from the
    // registered metadata, so it must be copied here or a declared `timeout`
    // is ignored at schedule time.
    timeout: taskMetadata.timeout,
    // Read by `executeTask` from the reference too; without it a declared
    // heartbeat timeout was accepted and the task ran unsupervised.
    heartbeatTimeout: taskMetadata.heartbeatTimeout,
  };

  return ref;
}
