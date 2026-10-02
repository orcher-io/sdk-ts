/**
 * The `@Task()` method decorator and helpers for inspecting task methods.
 *
 * `@Task()` marks a method as a task and attaches a static `TaskReference` for it to the task
 * handler class.
 *
 * @packageDocumentation
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
// Decorator signatures are typed with `any`.

import 'reflect-metadata';
import { GlobalRegistry } from '../registry';
import type { TaskOptions, TaskMetadata, TaskReference, Type } from '../types';
import { DecoratorError } from '../errors';

/**
 * Marks a method as a task and registers it with the global registry.
 *
 * The task name defaults to the method name. The decorator attaches a static `TaskReference`
 * to the class under the task name. Obtain typed references with `createTaskRefs()` and pass
 * them to `ctx.executeTask()`.
 *
 * Do not pass a `name` that differs from the method name. `createTaskRefs()` types each
 * reference by method name, while the runtime static lives under the task name, so the typed
 * key would point at nothing. The method name is the task name.
 *
 * @param options - Task options: `name`, `timeout` in milliseconds, and `retryPolicy`.
 * @returns A method decorator.
 * @throws DecoratorError if applied to a symbol-named property or a non-method, or if the
 *   class already has a static property with the task name.
 *
 * @example
 * Basic usage:
 * ```typescript
 * @Tasks()
 * export class PaymentTasks {
 *   @Task()
 *   async chargeCard(ctx: TaskContext, input: ChargeInput): Promise<ChargeResult> {
 *     return { success: true, chargeId: 'ch_123' };
 *   }
 * }
 *
 * const paymentTasks = createTaskRefs(PaymentTasks);
 *
 * // Static property: PaymentTasks.chargeCard
 * // Task name: 'chargeCard'
 * const result = await ctx.executeTask(paymentTasks.chargeCard, input);
 * ```
 *
 * @example
 * With timeout and retry policy:
 * ```typescript
 * @Tasks()
 * export class PaymentTasks {
 *   @Task({
 *     timeout: 30000,
 *     retryPolicy: {
 *       maxAttempts: 3,
 *       initialInterval: 1000,
 *       backoffCoefficient: 2
 *     }
 *   })
 *   async chargeCard(ctx: TaskContext, input: ChargeInput): Promise<ChargeResult> {
 *     // ...
 *   }
 * }
 * ```
 *
 * @example
 * Multiple tasks in one handler:
 * ```typescript
 * @Tasks()
 * export class PaymentTasks {
 *   @Task()
 *   async charge(ctx: TaskContext, input: ChargeInput): Promise<ChargeResult> { }
 *
 *   @Task()
 *   async refund(ctx: TaskContext, input: RefundInput): Promise<RefundResult> { }
 *
 *   @Task()
 *   async validate(ctx: TaskContext, input: ValidateInput): Promise<boolean> { }
 * }
 *
 * const paymentTasks = createTaskRefs(PaymentTasks);
 *
 * await ctx.executeTask(paymentTasks.charge, chargeInput);
 * await ctx.executeTask(paymentTasks.refund, refundInput);
 * await ctx.executeTask(paymentTasks.validate, validateInput);
 * ```
 */
export function Task(options: TaskOptions = {}): MethodDecorator {
  return function (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    if (typeof propertyKey === 'symbol') {
      throw DecoratorError.cannotApplyToNonMethod(
        '@Task',
        'symbol property',
        'Task methods must have string names'
      );
    }

    if (!descriptor || typeof descriptor.value !== 'function') {
      throw DecoratorError.cannotApplyToNonMethod(
        '@Task',
        typeof descriptor?.value || 'undefined',
        'Task decorator can only be applied to methods'
      );
    }

    const handlerClass = target.constructor as Type<any>;
    const methodName = propertyKey;
    const taskName = options.name || methodName;

    const staticPropertyName = taskName;

    // Never overwrite an existing static, such as a hand-written property or another task that
    // resolved to the same name.
    if (Object.prototype.hasOwnProperty.call(handlerClass, staticPropertyName)) {
      throw DecoratorError.staticPropertyConflict(
        '@Task',
        handlerClass.name,
        staticPropertyName,
        `Cannot create static property '${staticPropertyName}' - already exists. ` +
          `Use a different task name or rename the existing property.`
      );
    }

    const metadata: TaskMetadata = {
      name: taskName,
      handlerClass,
      methodName,
      timeout: options.timeout,
      retryPolicy: options.retryPolicy,
    };

    Reflect.defineMetadata('task', true, target, propertyKey);
    Reflect.defineMetadata('task:metadata', metadata, target, propertyKey);
    Reflect.defineMetadata('task:name', taskName, target, propertyKey);

    const registry = GlobalRegistry.getInstance();
    registry.registerTask(taskName, metadata);

    // The reference is attached as a static named after the task. TypeScript cannot see these
    // statics, so callers go through createTaskRefs() (see @Tasks).
    const taskReference: TaskReference<any, any> = {
      taskName,
      handlerClass,
      methodName,
      retryPolicy: options.retryPolicy,
      // Carried on the reference as well as the metadata, because the reference is what
      // `executeTask` receives.
      timeout: options.timeout,
    };

    Object.defineProperty(handlerClass, staticPropertyName, {
      value: taskReference,
      writable: false,
      enumerable: true,
      configurable: false,
    });

    return descriptor;
  };
}

/**
 * Returns whether a method is decorated with `@Task()`.
 *
 * @param target - Class prototype
 * @param propertyKey - Method name
 * @returns true if the method is decorated with @Task
 *
 * @example
 * ```typescript
 * @Tasks()
 * class MyTasks {
 *   @Task()
 *   async myTask() {}
 *
 *   async notATask() {}
 * }
 *
 * isTask(MyTasks.prototype, 'myTask'); // true
 * isTask(MyTasks.prototype, 'notATask'); // false
 * ```
 */
export function isTask(target: any, propertyKey: string): boolean {
  if (!target || typeof propertyKey !== 'string') {
    return false;
  }
  return Reflect.getMetadata('task', target, propertyKey) === true;
}

/**
 * Returns the metadata `@Task()` stored on a method.
 *
 * @param target - Class prototype
 * @param propertyKey - Method name
 * @returns Task metadata, or undefined if not a task
 *
 * @example
 * ```typescript
 * @Tasks()
 * class MyTasks {
 *   @Task({ timeout: 5000 })
 *   async myTask() {}
 * }
 *
 * const metadata = getTaskMetadata(MyTasks.prototype, 'myTask');
 * console.log(metadata.name); // 'myTask'
 * console.log(metadata.timeout); // 5000
 * ```
 */
export function getTaskMetadata(target: any, propertyKey: string): TaskMetadata | undefined {
  if (!isTask(target, propertyKey)) {
    return undefined;
  }
  return Reflect.getMetadata('task:metadata', target, propertyKey);
}

/**
 * Returns the task name of a decorated method.
 *
 * @param target - Class prototype
 * @param propertyKey - Method name
 * @returns Task name, or undefined if not a task
 *
 * @example
 * ```typescript
 * @Tasks()
 * class MyTasks {
 *   @Task()
 *   async myTask() {}
 * }
 *
 * const name = getTaskName(MyTasks.prototype, 'myTask');
 * console.log(name); // 'myTask'
 * ```
 */
export function getTaskName(target: any, propertyKey: string): string | undefined {
  if (!isTask(target, propertyKey)) {
    return undefined;
  }
  return Reflect.getMetadata('task:name', target, propertyKey);
}

/**
 * Returns whether a class has a static `TaskReference` under the given task name.
 *
 * @param handlerClass - Task handler class
 * @param taskName - Task name, which is also the static property name
 * @returns true if the class has a TaskReference for that task
 *
 * @example
 * ```typescript
 * @Tasks()
 * class MyTasks {
 *   @Task()  // Static property: MyTasks.myTask
 *   async myTask() {}
 *
 *   async helper() {}
 * }
 *
 * hasTaskReference(MyTasks, 'myTask'); // true
 * hasTaskReference(MyTasks, 'helper'); // false
 * ```
 */
export function hasTaskReference(handlerClass: Type<any>, taskName: string): boolean {
  if (!handlerClass || typeof taskName !== 'string') {
    return false;
  }
  const ref = (handlerClass as any)[taskName];
  return (
    ref !== undefined &&
    typeof ref === 'object' &&
    'taskName' in ref &&
    'handlerClass' in ref &&
    'methodName' in ref
  );
}

/**
 * Returns the static `TaskReference` a class holds under the given task name.
 *
 * @param handlerClass - Task handler class
 * @param taskName - Task name, which is also the static property name
 * @returns TaskReference, or undefined if not found
 *
 * @example
 * ```typescript
 * @Tasks()
 * class MyTasks {
 *   @Task()
 *   async chargeCard() {}
 * }
 *
 * const ref = getTaskReference(MyTasks, 'chargeCard');
 * console.log(ref.taskName);     // 'chargeCard'
 * console.log(ref.methodName);   // 'chargeCard'
 * console.log(ref.handlerClass); // MyTasks
 * ```
 */
export function getTaskReference<TInput = any, TOutput = any>(
  handlerClass: Type<any>,
  taskName: string
): TaskReference<TInput, TOutput> | undefined {
  if (!hasTaskReference(handlerClass, taskName)) {
    return undefined;
  }
  return (handlerClass as any)[taskName];
}

/**
 * Returns every static `TaskReference` on a task handler class.
 *
 * @param handlerClass - Task handler class
 * @returns Array of TaskReferences
 *
 * @example
 * ```typescript
 * @Tasks()
 * class PaymentTasks {
 *   @Task()
 *   async charge() {}
 *
 *   @Task()
 *   async refund() {}
 * }
 *
 * const refs = getAllTaskReferences(PaymentTasks);
 * // [
 * //   { taskName: 'charge', handlerClass: PaymentTasks, methodName: 'charge' },
 * //   { taskName: 'refund', handlerClass: PaymentTasks, methodName: 'refund' }
 * // ]
 * ```
 */
export function getAllTaskReferences(handlerClass: Type<any>): TaskReference<any, any>[] {
  if (!handlerClass) {
    return [];
  }

  const refs: TaskReference<any, any>[] = [];
  const propertyNames = Object.getOwnPropertyNames(handlerClass);

  for (const propertyName of propertyNames) {
    const ref = (handlerClass as any)[propertyName];
    if (
      ref &&
      typeof ref === 'object' &&
      'taskName' in ref &&
      'handlerClass' in ref &&
      'methodName' in ref
    ) {
      refs.push(ref);
    }
  }

  return refs;
}
