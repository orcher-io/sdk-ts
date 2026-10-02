/**
 * Errors raised by the dependency injection container, registry, and decorators.
 * @packageDocumentation
 */

/**
 * Stable codes for DI errors.
 *
 * Every {@link DIError} message starts with its code (for example `[DI001]`), so an error seen
 * in a log can be searched for by code.
 */
export enum DIErrorCode {
  DEPENDENCY_NOT_FOUND = 'DI001',
  CIRCULAR_DEPENDENCY = 'DI002',
  DECORATOR_ERROR = 'DI003',
  TASK_NOT_FOUND = 'DI004',
  LIFECYCLE_ERROR = 'DI005',
  INVALID_SCOPE = 'DI006',
  ACTOR_NOT_FOUND = 'DI007',
  OPERATION_NOT_FOUND = 'DI008',
  WORKFLOW_NOT_FOUND = 'DI009',
}

/**
 * Returns true unless `NODE_ENV` is `production`.
 *
 * DI errors append resolution chains and fix suggestions only in development, to keep
 * production messages short.
 */
export function isDevelopment(): boolean {
  return process.env['NODE_ENV'] !== 'production';
}

/**
 * Returns a human-readable name for a DI token: the class name for a constructor,
 * `Symbol(description)` for a symbol, and the string itself otherwise.
 *
 * @param token - Token to name
 */
export function getTokenName(token: unknown): string {
  if (typeof token === 'function') {
    return (token as { name?: string }).name ?? 'Anonymous';
  }
  if (typeof token === 'symbol') {
    return token.toString();
  }
  return String(token);
}

/**
 * Base class for all DI errors.
 *
 * The message is prefixed with the error code, for example `[DI001] Cannot resolve ...`.
 */
export class DIError extends Error {
  constructor(
    public code: DIErrorCode,
    message: string
  ) {
    super(`[${code}] ${message}`);
    this.name = 'DIError';
  }
}

/**
 * Thrown when a dependency cannot be resolved.
 *
 * In development the message also includes the resolution chain and suggested fixes.
 */
export class DependencyNotFoundError extends DIError {
  constructor(
    public token: unknown,
    public resolutionChain: unknown[],
    public context?: string
  ) {
    const tokenName = getTokenName(token);
    let message = `Cannot resolve dependency: ${tokenName}`;

    if (context) {
      message += `\n${context}`;
    }

    if (isDevelopment()) {
      const chain = resolutionChain.map(getTokenName).join(' → ');
      message +=
        `\n\nResolution chain: ${chain}\n\n` +
        `Possible solutions:\n` +
        `  • Add @Injectable() decorator to ${tokenName}\n` +
        `  • Ensure ${tokenName} is imported before worker.run()\n` +
        `  • Check autoDiscover() patterns include the file`;
    }

    super(DIErrorCode.DEPENDENCY_NOT_FOUND, message);
    this.name = 'DependencyNotFoundError';
  }
}

/**
 * Thrown when resolving a token requires resolving that same token again.
 *
 * The message shows the cycle; in development it also suggests ways to break it.
 */
export class CircularDependencyError extends DIError {
  constructor(public cycle: unknown[]) {
    const cycleStr = cycle.map(getTokenName).join(' → ');
    let message = `Circular dependency detected: ${cycleStr}`;

    if (isDevelopment()) {
      message +=
        `\n\n` +
        `Possible solutions:\n` +
        `  • Extract shared logic into a third service\n` +
        `  • Use factory for lazy injection\n` +
        `  • Consider combining these classes`;
    }

    super(DIErrorCode.CIRCULAR_DEPENDENCY, message);
    this.name = 'CircularDependencyError';
  }
}

/**
 * Thrown when a decorator is applied incorrectly.
 *
 * In development the message includes a suggested fix.
 */
export class DecoratorError extends DIError {
  constructor(message: string) {
    super(DIErrorCode.DECORATOR_ERROR, message);
    this.name = 'DecoratorError';
  }

  /**
   * Creates the error for a generated static reference whose name is already taken on the class.
   *
   * Accepts two call forms: `(className, propertyName)`, or
   * `(decoratorName, className, propertyName, customMessage?)`.
   */
  static staticPropertyConflict(
    decoratorOrClassName: string,
    classNameOrProperty: string,
    propertyName?: string,
    customMessage?: string
  ): DecoratorError {
    let message: string;
    if (propertyName !== undefined) {
      // Four-argument form: (decoratorName, className, propertyName, customMessage?)
      message =
        customMessage || `${classNameOrProperty}.${propertyName} already exists as static property`;
    } else {
      // Two-argument form: (className, propertyName)
      message = `${decoratorOrClassName}.${classNameOrProperty} already exists as static property`;
    }

    if (isDevelopment()) {
      message += `\n\nSolution: Rename the task method or remove the static property`;
    }

    return new DecoratorError(message);
  }

  /**
   * Creates the error for a class decorator applied to something other than a class.
   */
  static cannotApplyToNonClass(
    decoratorName: string,
    _targetType?: string,
    customMessage?: string
  ): DecoratorError {
    let message = customMessage || `@${decoratorName} can only be applied to classes`;

    if (isDevelopment()) {
      message += `\n\nEnsure you're decorating a class definition`;
    }

    return new DecoratorError(message);
  }

  /**
   * Creates the error for a method decorator applied to something other than a method.
   */
  static cannotApplyToNonMethod(
    decoratorName: string,
    propertyKey: string,
    customMessage?: string
  ): DecoratorError {
    let message = customMessage || `@${decoratorName} can only be applied to methods`;

    if (isDevelopment()) {
      message += `\n\nEnsure ${propertyKey} is an async method, not a property`;
    }

    return new DecoratorError(message);
  }
}

/**
 * Thrown when no task is registered under the requested name.
 *
 * In development the message lists the registered tasks.
 */
export class TaskNotFoundError extends DIError {
  constructor(
    public taskName: string,
    public availableTasks?: string[]
  ) {
    let message = `Task not found: ${taskName}`;

    if (isDevelopment() && availableTasks?.length) {
      message += `\n\nAvailable tasks: ${availableTasks.join(', ')}`;
    }

    super(DIErrorCode.TASK_NOT_FOUND, message);
    this.name = 'TaskNotFoundError';
  }
}

/**
 * Thrown when no workflow is registered under the requested name.
 *
 * Carries the `DI004` code shared with {@link TaskNotFoundError}. In development the message
 * lists the registered workflows.
 */
export class WorkflowNotFoundError extends DIError {
  constructor(
    public workflowName: string,
    public availableWorkflows?: string[]
  ) {
    let message = `Workflow not found: ${workflowName}`;

    if (isDevelopment() && availableWorkflows?.length) {
      message += `\n\nAvailable workflows: ${availableWorkflows.join(', ')}`;
    }

    super(DIErrorCode.WORKFLOW_NOT_FOUND, message);
    this.name = 'WorkflowNotFoundError';
  }
}

/**
 * Thrown when a provider is registered with a scope the container does not support.
 */
export class InvalidScopeError extends DIError {
  constructor(
    public providedScope: string,
    public validScopes: string[] = ['singleton', 'transient']
  ) {
    let message = `Invalid scope: '${providedScope}'`;

    if (isDevelopment()) {
      message +=
        `\n\nValid scopes: ${validScopes.join(', ')}\n` +
        `  • singleton: One instance for entire application (default)\n` +
        `  • transient: New instance each time requested`;
    }

    super(DIErrorCode.INVALID_SCOPE, message);
    this.name = 'InvalidScopeError';
  }
}

/**
 * Thrown when no actor is registered under the requested name.
 */
export class ActorNotFoundError extends DIError {
  constructor(
    public actorName: string,
    public availableActors?: string[]
  ) {
    let message = `Actor not found: ${actorName}`;

    if (isDevelopment() && availableActors?.length) {
      message += `\n\nAvailable actors: ${availableActors.join(', ')}`;
      message += `\n\nSolution: Ensure @Actor() decorator is applied and the class is imported before worker.run()`;
    }

    super(DIErrorCode.ACTOR_NOT_FOUND, message);
    this.name = 'ActorNotFoundError';
  }
}

/**
 * Thrown when an actor has no operation registered under the requested name.
 */
export class OperationNotFoundError extends DIError {
  constructor(
    public operationName: string,
    public actorName?: string,
    public availableOperations?: string[]
  ) {
    let message = actorName
      ? `Operation not found: ${actorName}.${operationName}`
      : `Operation not found: ${operationName}`;

    if (isDevelopment() && availableOperations?.length) {
      message += `\n\nAvailable operations: ${availableOperations.join(', ')}`;
      message += `\n\nSolution: Ensure @Operation() decorator is applied to the method`;
    }

    super(DIErrorCode.OPERATION_NOT_FOUND, message);
    this.name = 'OperationNotFoundError';
  }
}

/**
 * Thrown when a service's `onInit` or `onDestroy` hook throws.
 *
 * Wraps the original error. In development the message includes its stack.
 */
export class LifecycleError extends DIError {
  constructor(
    public serviceName: string,
    public hook: 'onInit' | 'onDestroy',
    public originalError: Error
  ) {
    let message = `${serviceName}.${hook}() failed: ${originalError.message}`;

    if (isDevelopment()) {
      message +=
        `\n\nDebug steps:\n` +
        `  • Check ${serviceName}.${hook}() implementation\n` +
        `  • Ensure all async operations are awaited\n` +
        `  • Verify external service dependencies\n\n` +
        `Original stack:\n${originalError.stack}`;
    }

    super(DIErrorCode.LIFECYCLE_ERROR, message);
    this.name = 'LifecycleError';
  }
}
