/**
 * Types for the dependency injection container, registry, and decorators.
 * @packageDocumentation
 */

import type { TaskRetryPolicy } from '../workflow/types';

/**
 * Key that identifies a dependency: a class constructor, a string, or a symbol.
 */
export type Token<T = any> = new (...args: any[]) => T | string | symbol;

/**
 * A class constructor that produces instances of `T`.
 */
export interface Type<T = any> {
  new (...args: any[]): T;
}

/**
 * Lifetime of a service instance.
 *
 * - `singleton`: one instance for the whole worker (default).
 * - `transient`: a new instance on every resolution.
 * - `scoped`: accepted by `@Injectable()`, but per-workflow scoping is not supported yet. The
 *   worker registers `scoped` services as singletons, and {@link OrcherContainer.register}
 *   rejects the value with `InvalidScopeError`.
 */
export type Scope = 'singleton' | 'transient' | 'scoped';

/**
 * Function that creates an instance, given the container to resolve dependencies from.
 */
export type Factory<T = any> = (container: any) => T | Promise<T>;

/**
 * Describes how the container creates the instance for a token.
 *
 * Set one of `useValue`, `useFactory`, or `useClass`, checked in that order. With none set,
 * the token must be a class, and the container instantiates it.
 */
export interface Provider<T = any> {
  token: Token<T>;
  useClass?: Type<T>;
  useFactory?: Factory<T>;
  useValue?: T;
  scope?: Scope;
}

/**
 * Lifecycle hook called right after the container creates an instance.
 *
 * The container calls it synchronously. An `onInit` that returns a promise is not awaited, and
 * the container logs a warning.
 */
export interface OnInit {
  onInit(): Promise<void> | void;
}

/**
 * Lifecycle hook called on cached singletons when the container is disposed.
 */
export interface OnDestroy {
  onDestroy(): Promise<void> | void;
}

/**
 * Service metadata stored by `@Injectable`.
 */
export interface ServiceMetadata {
  token: Token;
  scope: Scope;
  registered: boolean;
}

/**
 * Task handler metadata stored by `@Tasks`.
 */
export interface TaskHandlerMetadata {
  token: Type<any>;
  registered: boolean;
}

/**
 * Task method metadata stored by `@Task`.
 */
export interface TaskMetadata {
  name: string;
  handlerClass: Type<any>;
  methodName: string;
  timeout?: number;
  retryPolicy?: RetryPolicy;
}

/**
 * Workflow metadata stored by `@Workflow`.
 */
export interface WorkflowMetadata {
  name: string;
  version?: string;
  description?: string;
  workflowClass: Type<any>;
  timeout?: number;
  cronSchedule?: string;
}

/**
 * Retry policy for `@Task` options.
 *
 * An alias of `TaskRetryPolicy`, exported as `DIRetryPolicy` from the package root.
 */
export type RetryPolicy = TaskRetryPolicy;

/**
 * Typed handle to a task, created by the `@Task()` decorator.
 *
 * `@Task()` attaches a reference as a static property of the class, named after the task.
 * Obtain typed references with {@link createTaskRefs} and pass them to `ctx.executeTask()`.
 *
 * @example
 * ```typescript
 * @Tasks()
 * class PaymentTasks {
 *   @Task()
 *   async chargeCard(ctx: TaskContext, input: ChargeInput): Promise<ChargeResult> { }
 *
 *   // @Task() attaches at runtime:
 *   // static chargeCard: TaskReference<ChargeInput, ChargeResult>
 * }
 *
 * const paymentTasks = createTaskRefs(PaymentTasks);
 *
 * // Inside a workflow:
 * const result = await ctx.executeTask(paymentTasks.chargeCard, input);
 * // result is typed as ChargeResult
 * ```
 */
export interface TaskReference<TInput = any, TOutput = any> {
  /** Task name registered with the system */
  taskName: string;

  /** Task handler class that implements the method */
  handlerClass: Type<any>;

  /** Method name on the handler class */
  methodName: string;

  /** Retry policy declared on the task, forwarded to the ScheduleTask command */
  retryPolicy?: RetryPolicy;

  /**
   * Run limit declared on `@Task({ timeout })`, in milliseconds.
   *
   * Carried on the reference because the reference is what `executeTask` receives. Without it,
   * the task would run under the scheduler default whatever the decorator declared.
   */
  timeout?: number;

  /** Phantom field for type inference; not set at runtime */
  readonly _inputType?: TInput;

  /** Phantom field for type inference; not set at runtime */
  readonly _outputType?: TOutput;
}

/**
 * Definition passed to the functional `task()` API.
 *
 * @example
 * ```typescript
 * const chargeCard = task({
 *   name: 'charge-card',
 *   timeout: 30_000,
 *   execute: async (ctx: TaskContext, input: ChargeInput): Promise<ChargeResult> => {
 *     return stripe.charges.create({ amount: input.amount });
 *   },
 * });
 * ```
 */
export interface TaskDefinition<TInput = any, TOutput = any> {
  name: string;
  execute: (ctx: any, input: TInput) => Promise<TOutput>;
  timeout?: number;
  heartbeatTimeout?: number;
  retryPolicy?: RetryPolicy;
}

/**
 * Definition passed to the functional `workflow()` API.
 *
 * @example
 * ```typescript
 * const orderWorkflow = workflow({
 *   name: 'order-workflow',
 *   version: '1.0',
 *   run: async (ctx: WorkflowContext, input: OrderInput): Promise<OrderResult> => {
 *     return { status: 'completed' };
 *   },
 * });
 * ```
 */
export interface WorkflowDefinition<TInput = any, TOutput = any> {
  name: string;
  version?: string;
  description?: string;
  timeout?: number;
  cronSchedule?: string;
  run: (ctx: any, input: TInput) => Promise<TOutput>;
}

/**
 * Typed handle to a workflow, returned by the functional `workflow()` API.
 *
 * Clients use it to start the workflow with checked input and output types.
 */
export interface WorkflowReference<TInput = any, TOutput = any> {
  /** Workflow name registered with the system */
  workflowName: string;

  /** Workflow version */
  version: string;

  /** Class generated from the definition; the worker runs the workflow through it */
  workflowClass: Type<any>;

  /** Phantom field for type inference; not set at runtime */
  readonly _inputType?: TInput;

  /** Phantom field for type inference; not set at runtime */
  readonly _outputType?: TOutput;
}

/**
 * Options for the `@Injectable` decorator.
 */
export interface InjectableOptions {
  scope?: Scope;
}

/**
 * Options for the `@Tasks` decorator. Accepts no options.
 */
export interface TasksOptions {
  // Intentionally empty.
}

/**
 * Maps each task method of a class to its `TaskReference` type.
 *
 * Every method with the signature `(ctx, input) => Promise<output>` becomes a
 * `TaskReference<input, output>`, keyed by method name. The runtime static is keyed by task
 * name, so the two agree only when `@Task()` is not given a `name` that differs from the
 * method name.
 *
 * @example
 * ```typescript
 * @Tasks()
 * class PaymentTasks {
 *   @Task({ name: 'chargeCard' })
 *   async chargeCard(ctx: TaskContext, input: ChargeInput): Promise<ChargeOutput> { }
 * }
 *
 * type Refs = TaskRefs<PaymentTasks>;
 * // ^? { chargeCard: TaskReference<ChargeInput, ChargeOutput> }
 * ```
 */
export type TaskRefs<T> = {
  [K in keyof T as T[K] extends (ctx: any, input: infer _I) => Promise<infer _O>
    ? K
    : never]: T[K] extends (ctx: any, input: infer I) => Promise<infer O>
    ? TaskReference<I, O>
    : never;
};

/**
 * Returns the typed task references of a `@Tasks` class.
 *
 * `@Task()` attaches the references to the class at runtime, but a decorator cannot change the
 * class's type. This function returns the class itself, typed as {@link TaskRefs}, so each
 * reference carries its input and output types.
 *
 * @param taskClass - The task handler class decorated with @Tasks()
 * @returns An object with TaskReference properties for each @Task method
 *
 * @example
 * ```typescript
 * @Tasks()
 * export class PaymentTasks {
 *   @Task({ name: 'chargeCard' })
 *   async chargeCard(ctx: TaskContext, input: ChargeInput): Promise<ChargeOutput> {
 *     return { chargeId: 'ch_123', status: 'succeeded' };
 *   }
 *
 *   @Task({ name: 'refundCharge' })
 *   async refundCharge(ctx: TaskContext, input: RefundInput): Promise<RefundOutput> {
 *     return { refundId: 'rf_123', status: 'refunded' };
 *   }
 * }
 *
 * // Create typed task references
 * export const paymentTasks = createTaskRefs(PaymentTasks);
 *
 * // Inside a workflow:
 * const result = await ctx.executeTask(paymentTasks.chargeCard, { amount: 100, token: 'tok_123' });
 * // result is typed as ChargeOutput
 * ```
 */
export function createTaskRefs<T extends new (...args: any[]) => any>(
  taskClass: T
): TaskRefs<InstanceType<T>> {
  // @Task has already attached the references as statics named after each task, so the class
  // itself is the reference object; only its type changes here.
  return taskClass as unknown as TaskRefs<InstanceType<T>>;
}

/**
 * @deprecated Use TaskRefs instead
 * @internal
 */
export type ExtractTaskRefs<T> = TaskRefs<T>;

/**
 * @deprecated Use createTaskRefs() for better DX
 * @internal
 */
export type WithTaskRefs<T extends abstract new (...args: any) => any> = T &
  TaskRefs<InstanceType<T>>;

/**
 * Options for the `@Workflow` decorator.
 */
export interface WorkflowOptions {
  name: string;
  version?: string;
  description?: string;
  timeout?: number;
  cronSchedule?: string;
}

/**
 * Options for the `@Task` decorator.
 */
export interface TaskOptions {
  name?: string;
  timeout?: number;
  retryPolicy?: RetryPolicy;
}

// Update types

/**
 * Options for the `@Updates` class decorator. Accepts no options.
 */
export interface UpdatesOptions {
  // Intentionally empty.
}

/**
 * Update handler metadata stored by `@Updates`.
 */
export interface UpdateHandlerMetadata {
  token: Type<any>;
  registered: boolean;
}

/**
 * Options for the `@Update` method decorator.
 */
export interface UpdateOptions {
  name?: string;
  timeout?: number;
  description?: string;
}

/**
 * Update method metadata stored by `@Update`.
 */
export interface UpdateMetadata {
  name: string;
  handlerClass: Type<any>;
  methodName: string;
  timeout?: number;
  description?: string;
}

/**
 * Handle to an update handler, created by the `@Update()` decorator.
 *
 * `@Update()` attaches a reference as a static property of the class, named after the update.
 * Clients send updates by name, taken from `updateName`.
 *
 * @example
 * ```typescript
 * @Updates()
 * class OrderUpdates {
 *   @Update({ name: 'change_address' })
 *   async changeAddress(
 *     ctx: WorkflowContext,
 *     input: ChangeAddressInput
 *   ): Promise<ChangeAddressResult> { }
 *
 *   // @Update() attaches at runtime:
 *   // static change_address: UpdateReference<ChangeAddressInput, ChangeAddressResult>
 * }
 *
 * // From a client, with a WorkflowHandle:
 * const result = await handle.update<ChangeAddressResult>('change_address', input);
 * ```
 */
export interface UpdateReference<TInput = any, TOutput = any> {
  /** Update name registered with the system */
  updateName: string;

  /** Update handler class that implements the method */
  handlerClass: Type<any>;

  /** Method name on the handler class */
  methodName: string;

  /** Phantom field for type inference; not set at runtime */
  readonly _inputType?: TInput;

  /** Phantom field for type inference; not set at runtime */
  readonly _outputType?: TOutput;
}

/**
 * Maps each update method of a class to its `UpdateReference` type.
 *
 * Every method with the signature `(ctx, input) => Promise<output>` becomes an
 * `UpdateReference<input, output>`, keyed by method name.
 */
export type UpdateRefs<T> = {
  [K in keyof T as T[K] extends (ctx: any, input: infer _I) => Promise<infer _O>
    ? K
    : never]: T[K] extends (ctx: any, input: infer I) => Promise<infer O>
    ? UpdateReference<I, O>
    : never;
};

/**
 * An update handler class type that also carries its static `UpdateReference` properties.
 */
export type WithUpdateRefs<T extends abstract new (...args: any) => any> = T &
  UpdateRefs<InstanceType<T>>;

// Query types

/**
 * Options for the `@Queries` class decorator. Accepts no options.
 */
export interface QueriesOptions {
  // Intentionally empty.
}

/**
 * Query handler metadata stored by `@Queries`.
 */
export interface QueryHandlerMetadata {
  token: Type<any>;
  registered: boolean;
}

/**
 * Options for the `@Query` method decorator.
 *
 * Exported from the package root as `DIQueryOptions`, because the workflow API already exports
 * a different `QueryOptions`.
 */
export interface QueryOptions {
  name?: string;
  /** Cache TTL in milliseconds (0 = no cache) */
  cacheTtl?: number;
  /** Description of what the query returns */
  description?: string;
}

/**
 * Query method metadata stored by `@Query`.
 */
export interface QueryMetadata {
  name: string;
  handlerClass: Type<any>;
  methodName: string;
  cacheTtl?: number;
  description?: string;
}

/**
 * Handle to a query handler, created by the `@Query()` decorator.
 *
 * Query methods are synchronous and take no input, so the reference carries only an output
 * type. Clients send queries by name, taken from `queryName`.
 *
 * @example
 * ```typescript
 * @Queries()
 * class OrderQueries {
 *   @Query({ name: 'get_status' })
 *   getStatus(): string { return this.status; }
 *
 *   // @Query() attaches at runtime:
 *   // static get_status: QueryReference<string>
 * }
 *
 * // From a client, with a WorkflowHandle:
 * const status = await handle.query<string>('get_status');
 * ```
 */
export interface QueryReference<TOutput = any> {
  /** Query name registered with the system */
  queryName: string;

  /** Query handler class that implements the method */
  handlerClass: Type<any>;

  /** Method name on the handler class */
  methodName: string;

  /** Phantom field for type inference; not set at runtime */
  readonly _outputType?: TOutput;
}

/**
 * Maps each query method of a class to its `QueryReference` type.
 *
 * Every method with the signature `() => T` becomes a `QueryReference<T>`, keyed by method
 * name. Query methods take no arguments; they read captured workflow state.
 */
export type QueryRefs<T> = {
  [K in keyof T as T[K] extends () => infer _O ? K : never]: T[K] extends () => infer O
    ? QueryReference<O>
    : never;
};

/**
 * A query handler class type that also carries its static `QueryReference` properties.
 */
export type WithQueryRefs<T extends abstract new (...args: any) => any> = T &
  QueryRefs<InstanceType<T>>;

// Actor types

/**
 * How an actor operation runs alongside other operations on the same actor key.
 *
 * - `exclusive`: only one operation runs at a time per actor key. The default; use it for
 *   mutations.
 * - `shared`: several operations may run at once per actor key. Use it for reads.
 */
export type OperationMode = 'exclusive' | 'shared';

/**
 * Options for the `@Actor` class decorator.
 */
export interface ActorOptions {
  /** Actor type name. Defaults to the class name. */
  name?: string;
}

/**
 * Options for the `@Operation` method decorator.
 */
export interface OperationOptions {
  /** Operation name. Defaults to the method name. */
  name?: string;
  /** Concurrency mode. Defaults to `'exclusive'`. */
  mode?: OperationMode;
  /** Operation timeout in milliseconds */
  timeout?: number;
}

/**
 * Actor metadata stored by `@Actor`.
 */
export interface ActorMetadata {
  name: string;
  actorClass: Type<any>;
}

/**
 * Operation metadata stored by `@Operation`.
 */
export interface OperationMetadata {
  name: string;
  actorClass: Type<any>;
  methodName: string;
  mode: OperationMode;
  timeout?: number;
}

/**
 * Typed handle to an actor operation, created by the `@Operation()` decorator.
 *
 * Like {@link TaskReference}, it carries the input and output types in phantom fields.
 *
 * @example
 * ```typescript
 * @Actor()
 * class ShoppingCart {
 *   @Operation()
 *   async addItem(ctx: ActorContext, item: CartItem): Promise<Cart> { ... }
 *
 *   // @Operation() attaches at runtime:
 *   // static addItem: OperationReference<CartItem, Cart>
 * }
 *
 * // From a client:
 * const cart = client.actorRef(ShoppingCart, 'user-123');
 * const result = await cart.addItem({ name: 'book', price: 10 });
 * // result is typed as Cart
 * ```
 */
export interface OperationReference<TInput = any, TOutput = any> {
  /** Operation name registered with the system */
  operationName: string;

  /** Actor class that implements the operation */
  actorClass: Type<any>;

  /** Method name on the actor class */
  methodName: string;

  /** Concurrency mode */
  mode: OperationMode;

  /** Phantom field for type inference; not set at runtime */
  readonly _inputType?: TInput;

  /** Phantom field for type inference; not set at runtime */
  readonly _outputType?: TOutput;
}

/**
 * Maps each operation method of an actor class to its `OperationReference` type.
 *
 * Methods with the signature `(ctx, input) => Promise<output>` become
 * `OperationReference<input, output>`; methods with `(ctx) => Promise<output>` become
 * `OperationReference<void, output>`.
 *
 * @example
 * ```typescript
 * @Actor()
 * class ShoppingCart {
 *   @Operation()
 *   async addItem(ctx: ActorContext, item: CartItem): Promise<Cart> { ... }
 *
 *   @Operation({ mode: 'shared' })
 *   async getTotal(ctx: ActorContext): Promise<number> { ... }
 * }
 *
 * type Refs = OperationRefs<ShoppingCart>;
 * // ^? { addItem: OperationReference<CartItem, Cart>, getTotal: OperationReference<void, number> }
 * ```
 */
export type OperationRefs<T> = {
  [K in keyof T as T[K] extends (ctx: any, ...args: any[]) => Promise<any>
    ? K
    : never]: T[K] extends (ctx: any, input: infer I) => Promise<infer O>
    ? OperationReference<I, O>
    : T[K] extends (ctx: any) => Promise<infer O>
      ? OperationReference<void, O>
      : never;
};

/**
 * An actor class type that also carries its static `OperationReference` properties.
 *
 * @example
 * ```typescript
 * // A cast, not an annotation: TypeScript does not consider the plain class
 * // assignable to the intersection, since it cannot see the generated statics.
 * const CartActor = ShoppingCart as WithOperationRefs<typeof ShoppingCart>;
 * CartActor.addItem // OperationReference<CartItem, Cart>
 * ```
 */
export type WithOperationRefs<T extends abstract new (...args: any) => any> = T &
  OperationRefs<InstanceType<T>>;
