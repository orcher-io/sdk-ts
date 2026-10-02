/**
 * The `@Tasks()` class decorator and helpers for inspecting task handler classes.
 *
 * A task handler class groups methods decorated with `@Task()`.
 *
 * `@Task` attaches a static TaskReference for each task at runtime. Wrap the class in
 * `createTaskRefs()` to get those references with full input and output typing. TypeScript
 * cannot see them on the class itself, because a class decorator's return type does not
 * change the class's type.
 *
 * @packageDocumentation
 */

import 'reflect-metadata';
import { GlobalRegistry } from '../registry';
import type { TasksOptions, Type, TaskHandlerMetadata, WithTaskRefs } from '../types';
import { DecoratorError } from '../errors';

/**
 * Marks a class as a task handler and registers it with the global registry.
 *
 * Decorate the class's task methods with `@Task()`. The worker creates a new instance for each
 * task execution and injects its constructor dependencies from the container. Use
 * `createTaskRefs(ClassName)` to obtain typed references to the tasks.
 *
 * @param _options - Accepts no options.
 * @returns A class decorator.
 * @throws DecoratorError if applied to something other than a class.
 *
 * @example
 * Basic usage with type inference:
 * ```typescript
 * @Tasks()
 * export class PaymentTasks {
 *   @Task()
 *   async chargeCard(ctx: TaskContext, input: ChargeInput): Promise<ChargeResult> {
 *     return { success: true, chargeId: 'ch_123' };
 *   }
 * }
 *
 * // Reference tasks through createTaskRefs(). @Task attaches the statics at
 * // runtime, but a class decorator cannot change the class's type, so reading
 * // PaymentTasks.chargeCard directly does not compile.
 * export const paymentTasks = createTaskRefs(PaymentTasks);
 *
 * const result = await ctx.executeTask(paymentTasks.chargeCard, input);
 * // input is checked against ChargeInput, result is typed as ChargeResult
 * ```
 *
 * @example
 * With dependency injection:
 * ```typescript
 * @Tasks()
 * export class PaymentTasks {
 *   constructor(
 *     private stripe: StripeService,
 *     private logger: LoggerService
 *   ) {}
 *
 *   @Task({ timeout: 30000 })
 *   async chargeCard(ctx: TaskContext, input: ChargeInput): Promise<ChargeResult> {
 *     this.logger.log('Processing payment');
 *     return this.stripe.charge(input.amount, input.token);
 *   }
 * }
 * ```
 *
 * @example
 * Multiple task methods:
 * ```typescript
 * @Tasks()
 * export class UserTasks {
 *   @Task()
 *   async createUser(ctx: TaskContext, data: UserData): Promise<User> { }
 *
 *   @Task()
 *   async deleteUser(ctx: TaskContext, userId: string): Promise<void> { }
 * }
 *
 * export const userTasks = createTaskRefs(UserTasks);
 *
 * // Both are fully typed:
 * await ctx.executeTask(userTasks.createUser, userData);   // returns User
 * await ctx.executeTask(userTasks.deleteUser, 'user-123'); // returns void
 * ```
 */
export function Tasks<T extends abstract new (...args: any) => any>(
  _options: TasksOptions = {}
): (target: T) => WithTaskRefs<T> {
  return function (target: T): WithTaskRefs<T> {
    if (typeof target !== 'function') {
      throw DecoratorError.cannotApplyToNonClass('@Tasks', typeof target);
    }

    const metadata: TaskHandlerMetadata = {
      token: target as unknown as Type<any>,
      registered: true,
    };

    Reflect.defineMetadata('tasks', true, target);
    Reflect.defineMetadata('tasks:handler', true, target);
    Reflect.defineMetadata('tasks:metadata', metadata, target);

    const registry = GlobalRegistry.getInstance();
    registry.registerTaskHandler(target as unknown as Type<any>, metadata);

    Reflect.defineMetadata('di:tasks-decorated', true, target);

    // The static task references were attached by @Task; this only widens the type.
    return target as WithTaskRefs<T>;
  };
}

/**
 * Returns whether a class is decorated with `@Tasks()`.
 *
 * @param target - Class to check
 * @returns true if the class is decorated with @Tasks
 *
 * @example
 * ```typescript
 * @Tasks()
 * class MyTasks {}
 *
 * isTasks(MyTasks); // true
 * isTasks(class Other {}); // false
 * ```
 */
export function isTasks(target: any): boolean {
  if (!target || typeof target !== 'function') {
    return false;
  }
  return Reflect.getMetadata('tasks', target) === true;
}

/**
 * Returns whether a class is a task handler. Equivalent to {@link isTasks}.
 *
 * @param target - Class to check
 * @returns true if the class is a task handler
 *
 * @example
 * ```typescript
 * @Tasks()
 * class MyTasks {}
 *
 * isTaskHandler(MyTasks); // true
 * ```
 */
export function isTaskHandler(target: any): boolean {
  return isTasks(target);
}

/**
 * Returns the task handler metadata `@Tasks()` stored on a class.
 *
 * @param target - Class to get metadata from
 * @returns Task handler metadata, or undefined if not decorated
 *
 * @example
 * ```typescript
 * @Tasks()
 * class MyTasks {}
 *
 * const metadata = getTaskHandlerMetadata(MyTasks);
 * console.log(metadata.token); // MyTasks
 * ```
 */
export function getTaskHandlerMetadata(target: any): TaskHandlerMetadata | undefined {
  if (!isTasks(target)) {
    return undefined;
  }
  return Reflect.getMetadata('tasks:metadata', target);
}

/**
 * Returns the names of the methods decorated with `@Task()` on a task handler class.
 *
 * Only the class's own prototype is inspected; inherited methods are not included.
 *
 * @param target - Task handler class to inspect
 * @returns Array of method names that are tasks
 *
 * @example
 * ```typescript
 * @Tasks()
 * class PaymentTasks {
 *   @Task()
 *   async chargeCard() {}
 *
 *   @Task()
 *   async refund() {}
 * }
 *
 * const taskMethods = getTaskMethods(PaymentTasks);
 * // ['chargeCard', 'refund']
 * ```
 */
export function getTaskMethods(target: any): string[] {
  if (!isTasks(target)) {
    return [];
  }

  const prototype = target.prototype;
  if (!prototype) {
    return [];
  }

  const taskMethods: string[] = [];
  const propertyNames = Object.getOwnPropertyNames(prototype);

  for (const propertyName of propertyNames) {
    if (propertyName === 'constructor') {
      continue;
    }

    // Set by the @Task() decorator on each task method.
    const isTask = Reflect.getMetadata('task', prototype, propertyName);
    if (isTask) {
      taskMethods.push(propertyName);
    }
  }

  return taskMethods;
}
