/**
 * The TypeScript SDK for Orcher durable workflow orchestration.
 *
 * This is the main entry point. It exports a decorator-based API and a
 * functional API for defining workflows, tasks, queries, updates, events, and
 * actors, plus the {@link Client} and {@link Worker}.
 *
 * @packageDocumentation
 * @module @orcher/sdk
 *
 * @example
 * Functional API:
 * ```typescript
 * import { task, workflow, TaskContext, WorkflowContext } from '@orcher/sdk';
 *
 * const sendEmail = task({
 *   name: 'send-email',
 *   execute: async (ctx: TaskContext, input: { to: string; subject: string }) => {
 *     await emailService.send(input);
 *   },
 * });
 *
 * const orderWorkflow = workflow({
 *   name: 'order-workflow',
 *   run: async (ctx: WorkflowContext, order: Order) => {
 *     await ctx.executeTask(sendEmail, { to: order.email, subject: 'Confirmed' });
 *     return { orderId: order.id, status: 'completed' };
 *   },
 * });
 * ```
 *
 * @example
 * Class-based API (with DI):
 * ```typescript
 * import {
 *   Injectable,
 *   Tasks,
 *   Task,
 *   Workflow,
 *   TaskContext,
 *   WorkflowContext,
 *   createTaskRefs,
 * } from '@orcher/sdk';
 *
 * @Injectable()
 * @Tasks()
 * class PaymentTasks {
 *   constructor(private payments: PaymentGateway) {}
 *
 *   @Task()
 *   async charge(ctx: TaskContext, input: ChargeInput): Promise<ChargeResult> {
 *     return this.payments.charge(input);
 *   }
 * }
 *
 * const paymentTasks = createTaskRefs(PaymentTasks);
 *
 * @Workflow({ name: 'payment-workflow' })
 * class PaymentWorkflow {
 *   async run(ctx: WorkflowContext, input: any) {
 *     return await ctx.executeTask(paymentTasks.charge, input);
 *   }
 * }
 * ```
 */

// ============================================================================
// Workflow APIs
// ============================================================================

export { WorkflowContext } from './workflow/context';

export { StepType } from './workflow/context';

export type {
  WorkflowCommand,
  WorkflowCommandType,
  ScheduleTaskCommand,
  StartTimerCommand,
  RecordStepResultCommand,
} from './workflow/context';

// Child workflows: the handle startChildWorkflow returns, and the error its
// result() and executeChildWorkflow throw for a child that did not complete.
export { ChildWorkflowHandle, ChildWorkflowFailedError } from './workflow/child-handle';

// Deterministic helpers
export { WorkflowRandom } from './workflow/random';
export { WorkflowTime } from './workflow/time';

// Event handling
export { EventBuffer, EventManager, EventHelpers } from './workflow/events';
export type { EventData, WaitForEventCommand, SendEventCommand } from './workflow/events';

// Query handling
export { QueryManager, QueryHelpers, QueryError } from './workflow/query';
export type { QueryHandler, QueryResult } from './workflow/query';

// Saga pattern
export { Saga, SagaBuilder } from './workflow/saga';

// Common workflow types
export { Duration, ParentClosePolicy, QueryRejectCondition } from './workflow/types';

export type {
  ChildWorkflowOptions,
  RestartFreshOptions,
  EventOptions,
  QueryOptions,
} from './workflow/types';

// ============================================================================
// Task APIs
// ============================================================================

export { TaskContext, CancellationToken } from './task/context';
export type { TaskExecution, HeartbeatMessage } from './task/context';

// Queries and events have no exports of their own. Query handlers are
// registered on WorkflowContext and read with WorkflowHandle.query(). Workflows
// wait for events through WorkflowContext; clients send them through
// WorkflowHandle.sendEvent().

// ============================================================================
// Error Handling & Retry
// ============================================================================

export {
  // The execution layer: workflow, task, and worker failures, carrying
  // severity, details, and the execution code vocabulary. They extend
  // OrcherError (exported below), the single base of every Orcher error, so
  // `err instanceof OrcherError` holds for transport failures too.
  OrchestrationError,
  WorkflowError,
  TaskError,
  WorkerError,
  SerializationError,
  ConfigurationError,
  ErrorSeverity,
  isOrcherError,
  isOrchestrationError,
  isWorkflowError,
  isTaskError,
  isClientError,
  isWorkerError,
  isWorkflowSuspension,
  toOrcherError,
  wrapError,
} from './errors/index';

// The durable task retry policy is the one public `RetryPolicy`. The SDK has no
// in-process retry helper, because durable workflows delegate retries to the engine.
export type { RetryPolicy } from './workflow/types';

// ============================================================================
// Worker APIs
// ============================================================================

export { Worker } from './worker/worker';
export { isDirectBindingsMode } from './core/native';

export type {
  WorkerOptions,
  WorkerStats,
  ShutdownOptions,
  WorkerIdentity,
  WorkerCapabilities,
  WorkerHealth,
  WorkerMetadata,
  Logger,
} from './worker/types';

export { WorkerState } from './worker/types';

export {
  // The concrete error classes are named Service* internally; they are
  // exported under the public Worker* names.
  ServiceConfigurationError as WorkerConfigurationError,
  ServiceStartupError as WorkerStartupError,
  ServiceShutdownError as WorkerShutdownError,
  PollingError,
  ExecutionError,
  HandlerNotFoundError,
  ConcurrencyLimitError,
  ExecutionTimeoutError,
  isExecutionError,
  isHandlerNotFoundError,
} from './worker/errors';

// ============================================================================
// Client, transport errors, payloads, and native bindings
// ============================================================================

export {
  Client,
  WorkflowHandle,
  // Transport-layer error classes
  InvalidArgumentError,
  PermissionDeniedError,
  ResourceExhaustedError,
  FailedPreconditionError,
  AbortedError,
  OutOfRangeError,
  UnimplementedError,
  InternalError,
  UnavailableError,
  OrcherError,
  ClientError,
  // The client throws these, so callers need the classes for `instanceof`
  // checks.
  NotFoundError,
  AlreadyExistsError,
  DataLossError,
  UnauthenticatedError,
  TimeoutError,
  ConnectionError,
  // Payload utilities
  toPayload,
  fromPayload,
  toPayloadWithMetadata,
  getPayloadMetadata,
  isValidPayload,
  tryFromPayload,
  PayloadError,
  PayloadUtils,
  // Protocol buffer types
  Payload,
  Header,
  Failure,
  // Native module utilities
  getNativeModule,
  isNativeModuleAvailable,
  getNativeVersion,
  getNativeModuleVersion,
  performHealthCheck,
  getNativeModuleInfo,
  CORE_VERSION,
} from './core';

export type {
  ClientConfig,
  ServiceConfig as WorkerConfig,
  WorkflowStartOptions,
  WorkflowHandleOptions,
  ExecutionRequest,
  ExecutionResult,
  NativeModule,
  Disposable,
  AsyncDisposable,
  NativeClientHandle,
  NativeWorkflowHandle,
} from './core';

export {
  WorkflowStatus,
  WorkflowIdReusePolicy,
  parseErrorCode,
  extractErrorMessage,
  ErrorCode,
} from './core';

// The execution-layer vocabulary (WORKFLOW_*, TASK_*, ...), as carried by
// ExecutionError.code. Distinct from the transport ErrorCode above, which is
// what parseErrorCode returns and what client errors carry.
export { ErrorCode as ExecutionErrorCode } from './errors/index';

export type {
  WorkflowExecution,
  WorkflowExecutionDescription,
  WorkflowExecutionConfig,
  WorkflowExecutionInfo,
  WorkflowListPage,
  ListWorkflowsOptions,
  SearchWorkflowsOptions,
  ParentExecutionInfo,
} from './core';

// ============================================================================
// Dependency Injection
// ============================================================================

/**
 * Dependency injection decorators for services, tasks, workflows, and actors.
 *
 * Decorators:
 * - `@Injectable()`: mark a class as an injectable service (singleton, transient, or scoped)
 * - `@Tasks()`: mark a class as a task handler with DI support
 * - `@Task()`: mark a method as a task; reach its TaskReference with `createTaskRefs()`
 * - `@Workflow()`: mark a class as a workflow
 * - `@Inject()`: specify a custom injection token (Symbol, string, or class)
 * - `@Actor()` and `@Operation()`: define an actor and its operations
 * - `@Updates()`/`@Update()` and `@Queries()`/`@Query()`: define update and query handlers
 *
 * Workflows take no injected dependencies. Workflow code is replayed from the
 * journal on every recovery and must produce the same commands each time, which
 * an injected service cannot be relied on to do. Side effects belong in tasks,
 * where DI is available and results are journaled.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class PaymentGateway {
 *   async charge(amount: number) { return { id: 'ch_123' }; }
 * }
 *
 * // A task handler receives its dependencies through DI.
 * @Injectable()
 * @Tasks()
 * class PaymentTasks {
 *   constructor(private payments: PaymentGateway) {}
 *
 *   // The method name is the task name. Do not pass a different `name`:
 *   // createTaskRefs() types references by method name.
 *   @Task()
 *   async chargeCard(ctx: TaskContext, input: any) {
 *     return this.payments.charge(input.amount);
 *   }
 * }
 *
 * const paymentTasks = createTaskRefs(PaymentTasks);
 *
 * // Workflows take no dependencies: they must stay deterministic.
 * @Workflow({ name: 'payment-workflow' })
 * class PaymentWorkflow {
 *   async run(ctx: WorkflowContext, input: any) {
 *     return await ctx.executeTask(paymentTasks.chargeCard, input);
 *   }
 * }
 * ```
 */
export {
  Injectable,
  Tasks,
  Task,
  Workflow,
  Inject,
  Actor,
  Operation,
  Updates,
  Update,
  Queries,
  Query,
} from './di/decorators';

export { OrcherContainer } from './di/container';
export { GlobalRegistry as DIGlobalRegistry, globalRegistry } from './di/registry';

export { createTaskRefs } from './di/types';

export type {
  Token,
  Type,
  Scope,
  Factory,
  Provider,
  TaskReference,
  TaskRefs,
  OnInit,
  OnDestroy,
  InjectableOptions,
  TasksOptions,
  TaskOptions as DITaskOptions,
  WorkflowOptions as DIWorkflowOptions,
  ServiceMetadata,
  TaskHandlerMetadata,
  TaskMetadata as DITaskMetadata,
  WorkflowMetadata as DIWorkflowMetadata,
  RetryPolicy as DIRetryPolicy,
} from './di/types';

export {
  DIError,
  DependencyNotFoundError,
  CircularDependencyError,
  DecoratorError,
  TaskNotFoundError,
  WorkflowNotFoundError,
  ActorNotFoundError,
  OperationNotFoundError,
  InvalidScopeError,
  LifecycleError,
  DIErrorCode,
} from './di/errors';

// ============================================================================
// Functional API (class-free task & workflow definitions)
// ============================================================================

/**
 * Functional API: define tasks and workflows without classes or decorators.
 *
 * Both styles register to the same GlobalRegistry and work side by side:
 * - `task({ name, execute })` returns a `TaskReference`, the same shape `@Task()` produces
 * - `workflow({ name, run })` returns a `WorkflowReference`
 *
 * Naming convention: PascalCase is the decorator (`Task`, `Workflow`); camelCase
 * is the functional form (`task`, `workflow`).
 *
 * @example
 * ```typescript
 * import { task, workflow, TaskContext, WorkflowContext } from '@orcher/sdk';
 *
 * export const sendEmail = task({
 *   name: 'send-email',
 *   execute: async (ctx: TaskContext, input: { to: string }) => {
 *     await mailer.send(input.to);
 *   },
 * });
 *
 * export const orderWorkflow = workflow({
 *   name: 'order-workflow',
 *   run: async (ctx: WorkflowContext, order: OrderInput) => {
 *     await ctx.executeTask(sendEmail, { to: order.email });
 *     return { status: 'completed' };
 *   },
 * });
 * ```
 */
export { task, workflow } from './functional';

export type { TaskDefinition, WorkflowDefinition, WorkflowReference } from './di/types';

// ============================================================================
// Actor System
// ============================================================================

/**
 * Actors: keyed, stateful objects whose state lives on the server.
 *
 * Actors are defined with decorators, support DI, and are invoked from a
 * client through typed proxies.
 *
 * @example
 * ```typescript
 * @Injectable()
 * @Actor()
 * class ShoppingCart {
 *   constructor(private db: DatabaseService) {}
 *
 *   @Operation()
 *   async addItem(ctx: ActorContext, item: CartItem): Promise<Cart> {
 *     const cart = await ctx.state.get<Cart>('cart') ?? { items: [] };
 *     cart.items.push(item);
 *     await ctx.state.set('cart', cart);
 *     return cart;
 *   }
 *
 *   @Operation({ mode: 'shared' })
 *   async getTotal(ctx: ActorContext): Promise<number> {
 *     const cart = await ctx.state.get<Cart>('cart') ?? { items: [] };
 *     return cart.items.reduce((sum, i) => sum + i.price, 0);
 *   }
 * }
 *
 * // Client-side typed invocation
 * const cart = client.actorRef(ShoppingCart, 'user-123');
 * const result = await cart.addItem({ name: 'book', price: 10 });
 * ```
 */

// Actor context and state
export { ActorContext, ActorState } from './actor';
export type { ActorExecution, ActorStateClient } from './actor';

// Actor client proxy
export type { ActorRef } from './client/actor-ref';

// Actor types
export type {
  ActorOptions,
  OperationOptions,
  ActorMetadata,
  OperationMetadata,
  OperationReference,
  OperationRefs,
  WithOperationRefs,
  OperationMode,
} from './di/types';

// Update types
export type {
  UpdatesOptions,
  UpdateOptions,
  UpdateHandlerMetadata,
  UpdateMetadata as DIUpdateMetadata,
  UpdateReference,
  UpdateRefs,
} from './di/types';

// Query types
export type {
  QueriesOptions,
  QueryOptions as DIQueryOptions,
  QueryHandlerMetadata as DIQueryHandlerMetadata,
  QueryMetadata as DIQueryMetadata,
  QueryReference,
  QueryRefs,
} from './di/types';

// ============================================================================
// Version
// ============================================================================

/**
 * SDK version: the version of the installed package, read from its
 * `package.json` so it cannot fall behind a release.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const VERSION: string = (require('../package.json') as { version: string }).version;

export default {
  VERSION,
};
