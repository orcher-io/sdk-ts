/**
 * The `@Workflow()` class decorator and helpers for inspecting workflow classes.
 *
 * A workflow class must not use `@Injectable()` or take constructor dependencies. Workflows
 * are replayed from their journal and must be deterministic; side effects belong in tasks.
 *
 * @packageDocumentation
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
// Decorator signatures are typed with `any`.

import 'reflect-metadata';
import { GlobalRegistry } from '../registry';
import type { WorkflowOptions, WorkflowMetadata, Type } from '../types';
import { DecoratorError } from '../errors';

/**
 * Marks a class as a workflow and registers it with the global registry.
 *
 * The class must have a `run(ctx, input)` method, which the worker calls to execute the
 * workflow. The version defaults to `'1.0'`.
 *
 * A workflow is replayed from its execution history, so it must be deterministic:
 * - Do not decorate it with `@Injectable()` or give it constructor dependencies.
 * - Do not call databases, APIs, or other I/O directly.
 * - Use only `ctx` methods, which are deterministic.
 * - Run side effects as tasks through `ctx.executeTask()`. Task results are journaled, so a
 *   replay reads the recorded result instead of running the task again.
 *
 * @param options - Workflow options. `name` is required; `version`, `description`, `timeout`
 *   in milliseconds, and `cronSchedule` are optional.
 * @returns A class decorator.
 * @throws DecoratorError if applied to something other than a class, if `name` is missing or
 *   empty, or if the class has no `run()` method.
 *
 * @example
 * Basic usage:
 * ```typescript
 * // paymentTasks = createTaskRefs(PaymentTasks)
 * @Workflow({ name: 'payment-workflow' })
 * export class PaymentWorkflow {
 *   async run(ctx: WorkflowContext, input: PaymentInput): Promise<PaymentOutput> {
 *     // Side effects run as tasks, whose results are journaled.
 *     const result = await ctx.executeTask(paymentTasks.chargeCard, input);
 *     return result;
 *   }
 * }
 * ```
 *
 * @example
 * With version and timeout:
 * ```typescript
 * // orderTasks, paymentTasks, and shippingTasks come from createTaskRefs()
 * @Workflow({
 *   name: 'order-workflow',
 *   version: '2.0',
 *   timeout: 300000, // 5 minutes
 *   description: 'Process order with payment and shipping'
 * })
 * export class OrderWorkflow {
 *   async run(ctx: WorkflowContext, input: OrderInput): Promise<OrderOutput> {
 *     const validation = await ctx.executeTask(orderTasks.validate, input);
 *     if (!validation.valid) throw new Error('Invalid order');
 *
 *     const payment = await ctx.executeTask(paymentTasks.charge, input.payment);
 *     const shipment = await ctx.executeTask(shippingTasks.create, input.shipping);
 *
 *     return { orderId: input.id, paymentId: payment.id, trackingNumber: shipment.tracking };
 *   }
 * }
 * ```
 *
 * @example
 * Incorrect: a workflow with dependencies and side effects:
 * ```typescript
 * // Do not combine @Workflow() with @Injectable().
 * @Injectable()
 * @Workflow({ name: 'payment-workflow' })
 * export class PaymentWorkflow {
 *   constructor(private stripe: StripeService) {}
 *
 *   async run(ctx: WorkflowContext, input: PaymentInput) {
 *     return this.stripe.charge(input);  // Runs again on every replay.
 *   }
 * }
 * ```
 *
 * @example
 * Correct: the workflow has no dependencies; the task handler does:
 * ```typescript
 * // paymentTasks = createTaskRefs(PaymentTasks)
 * @Workflow({ name: 'payment-workflow' })
 * export class PaymentWorkflow {
 *   async run(ctx: WorkflowContext, input: PaymentInput) {
 *     return await ctx.executeTask(paymentTasks.charge, input);
 *   }
 * }
 *
 * @Tasks()
 * export class PaymentTasks {
 *   constructor(private stripe: StripeService) {}
 *
 *   @Task()
 *   async charge(ctx: TaskContext, input: PaymentInput) {
 *     return this.stripe.charge(input);  // The result is journaled.
 *   }
 * }
 * ```
 */
export function Workflow(options: WorkflowOptions): ClassDecorator {
  return function <T extends Function>(target: T): T {
    if (typeof target !== 'function') {
      throw DecoratorError.cannotApplyToNonClass(
        '@Workflow',
        typeof target,
        'Workflow decorator can only be applied to classes'
      );
    }

    if (!options || !options.name) {
      throw new DecoratorError(
        '@Workflow() requires a name option.\n' +
          'Usage: @Workflow({ name: "my-workflow" })\n' +
          'Example:\n' +
          '  @Workflow({ name: "payment-workflow", version: "1.0" })\n' +
          '  export class PaymentWorkflow { ... }'
      );
    }

    if (typeof options.name !== 'string' || options.name.trim().length === 0) {
      throw new DecoratorError(
        '@Workflow() requires a non-empty name.\n' + `Received: ${JSON.stringify(options.name)}`
      );
    }

    if (!target.prototype.run || typeof target.prototype.run !== 'function') {
      throw new DecoratorError(
        `@Workflow() requires ${target.name} to have a run() method.\n` +
          'Workflow classes must implement:\n' +
          '  async run(ctx: WorkflowContext, input: TInput): Promise<TOutput>\n\n' +
          'Example:\n' +
          `  @Workflow({ name: "${options.name}" })\n` +
          `  export class ${target.name} {\n` +
          '    async run(ctx: WorkflowContext, input: any): Promise<any> {\n' +
          '      // Workflow implementation\n' +
          '    }\n' +
          '  }'
      );
    }

    const metadata: WorkflowMetadata = {
      name: options.name,
      version: options.version || '1.0',
      description: options.description,
      workflowClass: target as unknown as Type<any>,
      timeout: options.timeout,
      cronSchedule: options.cronSchedule,
    };

    Reflect.defineMetadata('workflow', true, target);
    Reflect.defineMetadata('workflow:metadata', metadata, target);
    Reflect.defineMetadata('workflow:name', options.name, target);
    Reflect.defineMetadata('workflow:version', metadata.version, target);
    if (options.cronSchedule) {
      Reflect.defineMetadata('workflow:cronSchedule', options.cronSchedule, target);
    }

    const registry = GlobalRegistry.getInstance();
    registry.registerWorkflow(options.name, metadata);

    return target;
  };
}

/**
 * Returns whether a class is decorated with `@Workflow()`.
 *
 * @param target - Class to check
 * @returns true if the class is decorated with @Workflow
 *
 * @example
 * ```typescript
 * @Workflow({ name: 'my-workflow' })
 * class MyWorkflow {
 *   async run() {}
 * }
 *
 * class NotAWorkflow {}
 *
 * isWorkflow(MyWorkflow);    // true
 * isWorkflow(NotAWorkflow);  // false
 * isWorkflow(null);          // false
 * ```
 */
export function isWorkflow(target: any): boolean {
  if (!target || typeof target !== 'function') {
    return false;
  }
  return Reflect.getMetadata('workflow', target) === true;
}

/**
 * Returns the metadata `@Workflow()` stored on a class.
 *
 * @param target - Workflow class
 * @returns Workflow metadata, or undefined if not a workflow
 *
 * @example
 * ```typescript
 * @Workflow({ name: 'payment-workflow', version: '2.0', timeout: 60000 })
 * class PaymentWorkflow {
 *   async run() {}
 * }
 *
 * const metadata = getWorkflowMetadata(PaymentWorkflow);
 * console.log(metadata.name);     // 'payment-workflow'
 * console.log(metadata.version);  // '2.0'
 * console.log(metadata.timeout);  // 60000
 * ```
 */
export function getWorkflowMetadata(target: any): WorkflowMetadata | undefined {
  if (!isWorkflow(target)) {
    return undefined;
  }
  return Reflect.getMetadata('workflow:metadata', target);
}

/**
 * Returns the workflow name of a decorated class.
 *
 * @param target - Workflow class
 * @returns Workflow name, or undefined if not a workflow
 *
 * @example
 * ```typescript
 * @Workflow({ name: 'payment-workflow' })
 * class PaymentWorkflow {
 *   async run() {}
 * }
 *
 * const name = getWorkflowName(PaymentWorkflow);
 * console.log(name); // 'payment-workflow'
 * ```
 */
export function getWorkflowName(target: any): string | undefined {
  if (!isWorkflow(target)) {
    return undefined;
  }
  return Reflect.getMetadata('workflow:name', target);
}

/**
 * Returns the workflow version of a decorated class.
 *
 * @param target - Workflow class
 * @returns Workflow version (`'1.0'` if none was declared), or undefined if not a workflow
 *
 * @example
 * ```typescript
 * @Workflow({ name: 'payment-workflow', version: '2.0' })
 * class PaymentWorkflow {
 *   async run() {}
 * }
 *
 * const version = getWorkflowVersion(PaymentWorkflow);
 * console.log(version); // '2.0'
 * ```
 */
export function getWorkflowVersion(target: any): string | undefined {
  if (!isWorkflow(target)) {
    return undefined;
  }
  return Reflect.getMetadata('workflow:version', target);
}

/**
 * Returns the cron schedule declared on a workflow class.
 *
 * @param target - Workflow class
 * @returns Cron schedule string, or undefined if not set
 */
export function getWorkflowCronSchedule(target: any): string | undefined {
  if (!isWorkflow(target)) {
    return undefined;
  }
  return Reflect.getMetadata('workflow:cronSchedule', target);
}
