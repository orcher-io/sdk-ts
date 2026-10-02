/**
 * Process-wide store of metadata recorded by the DI decorators.
 * @packageDocumentation
 */

import type {
  Type,
  ServiceMetadata,
  TaskHandlerMetadata,
  TaskMetadata,
  WorkflowMetadata,
  ActorMetadata,
  OperationMetadata,
  UpdateHandlerMetadata,
  UpdateMetadata,
  QueryHandlerMetadata,
  QueryMetadata,
} from './types';

/**
 * Process-wide store of metadata for decorated classes and methods.
 *
 * Decorators (`@Injectable`, `@Tasks`, `@Task`, `@Workflow`, `@Actor`, `@Operation`,
 * `@Updates`, `@Update`, `@Queries`, `@Query`) register here when their module is loaded,
 * whether by an explicit import or by `autoDiscover()`. The worker reads the registry when it
 * starts, so a class must be loaded before `worker.run()` to be picked up.
 *
 * There is one instance per process, available as {@link globalRegistry}. Decorators run
 * synchronously at module load, so registrations never interleave.
 *
 * Registering a name or class that is already registered overwrites the earlier entry and logs
 * a warning.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class MyService {}
 *
 * // @Injectable() has registered MyService:
 * const services = globalRegistry.getAllServices();
 * ```
 */
export class GlobalRegistry {
  private static instance: GlobalRegistry;

  private services = new Map<Type<any>, ServiceMetadata>();
  private taskHandlers = new Map<Type<any>, TaskHandlerMetadata>();
  private tasks = new Map<string, TaskMetadata>();
  private workflows = new Map<string, WorkflowMetadata>();
  private actors = new Map<string, ActorMetadata>();
  private operations = new Map<string, OperationMetadata>();
  private updateHandlers = new Map<Type<any>, UpdateHandlerMetadata>();
  private updates = new Map<string, UpdateMetadata>();
  private queryHandlers = new Map<Type<any>, QueryHandlerMetadata>();
  private queries = new Map<string, QueryMetadata>();

  private constructor() {
    // Private: use getInstance() or the exported globalRegistry.
  }

  /**
   * Returns the process-wide registry, creating it on first use.
   *
   * @returns The global registry instance
   *
   * @example
   * ```typescript
   * const registry = GlobalRegistry.getInstance();
   * registry.registerService(MyService, metadata);
   * ```
   */
  static getInstance(): GlobalRegistry {
    if (!GlobalRegistry.instance) {
      GlobalRegistry.instance = new GlobalRegistry();
    }
    return GlobalRegistry.instance;
  }

  // =========================================================================
  // Service Registration
  // =========================================================================

  /**
   * Records a service class and its metadata.
   *
   * Services are keyed by class. Registering a class again overwrites its metadata and logs a
   * warning.
   *
   * @param serviceClass - The service class (constructor)
   * @param metadata - Service metadata from @Injectable decorator
   *
   * @example
   * ```typescript
   * @Injectable({ scope: 'singleton' })
   * class MyService {}
   *
   * // The decorator calls:
   * globalRegistry.registerService(MyService, {
   *   token: MyService,
   *   scope: 'singleton',
   *   registered: true,
   * });
   * ```
   */
  registerService(serviceClass: Type<any>, metadata: ServiceMetadata): void {
    if (this.services.has(serviceClass)) {
      console.warn(
        `[GlobalRegistry] Service ${serviceClass.name} is already registered. Overwriting with new metadata.`
      );
    }
    this.services.set(serviceClass, metadata);
  }

  /**
   * Returns the metadata of a service class.
   *
   * @param serviceClass - The service class to lookup
   * @returns Service metadata if found, undefined otherwise
   *
   * @example
   * ```typescript
   * const metadata = globalRegistry.getService(MyService);
   * if (metadata) {
   *   console.log('Service scope:', metadata.scope);
   * }
   * ```
   */
  getService(serviceClass: Type<any>): ServiceMetadata | undefined {
    return this.services.get(serviceClass);
  }

  /**
   * Returns all registered services.
   *
   * The map is a copy, so changing it does not change the registry.
   *
   * @returns Map of all registered services (class -> metadata)
   *
   * @example
   * ```typescript
   * const allServices = globalRegistry.getAllServices();
   * for (const [serviceClass, metadata] of allServices) {
   *   console.log(`Service: ${serviceClass.name}, Scope: ${metadata.scope}`);
   * }
   * ```
   */
  getAllServices(): Map<Type<any>, ServiceMetadata> {
    return new Map(this.services);
  }

  /**
   * Returns whether a service class is registered.
   *
   * @param serviceClass - The service class to check
   * @returns true if the service is registered, false otherwise
   *
   * @example
   * ```typescript
   * if (globalRegistry.hasService(MyService)) {
   *   console.log('MyService is registered');
   * }
   * ```
   */
  hasService(serviceClass: Type<any>): boolean {
    return this.services.has(serviceClass);
  }

  // =========================================================================
  // Task Handler Registration
  // =========================================================================

  /**
   * Records a task handler class and its metadata.
   *
   * Task handlers are `@Tasks` classes whose methods are tasks. Registering a class again
   * overwrites its metadata and logs a warning.
   *
   * @param handlerClass - The task handler class (constructor)
   * @param metadata - Task handler metadata from @Tasks decorator
   *
   * @example
   * ```typescript
   * @Tasks()
   * class PaymentTasks {
   *   @Task()
   *   async chargeCard(input: any) {}
   * }
   *
   * // The decorator calls:
   * globalRegistry.registerTaskHandler(PaymentTasks, { token: PaymentTasks, registered: true });
   * ```
   */
  registerTaskHandler(handlerClass: Type<any>, metadata: TaskHandlerMetadata): void {
    if (this.taskHandlers.has(handlerClass)) {
      console.warn(
        `[GlobalRegistry] Task handler ${handlerClass.name} is already registered. Overwriting with new metadata.`
      );
    }
    this.taskHandlers.set(handlerClass, metadata);
  }

  /**
   * Returns the metadata of a task handler class.
   *
   * @param handlerClass - The task handler class to lookup
   * @returns Task handler metadata if found, undefined otherwise
   *
   * @example
   * ```typescript
   * const metadata = globalRegistry.getTaskHandler(PaymentTasks);
   * if (metadata) {
   *   console.log('Handler class:', metadata.token.name);
   * }
   * ```
   */
  getTaskHandler(handlerClass: Type<any>): TaskHandlerMetadata | undefined {
    return this.taskHandlers.get(handlerClass);
  }

  /**
   * Returns all registered task handlers.
   *
   * The map is a copy, so changing it does not change the registry.
   *
   * @returns Map of all registered task handlers (class -> metadata)
   *
   * @example
   * ```typescript
   * const allHandlers = globalRegistry.getAllTaskHandlers();
   * for (const [handlerClass, metadata] of allHandlers) {
   *   console.log(`Handler: ${handlerClass.name}`);
   * }
   * ```
   */
  getAllTaskHandlers(): Map<Type<any>, TaskHandlerMetadata> {
    return new Map(this.taskHandlers);
  }

  /**
   * Returns whether a task handler class is registered.
   *
   * @param handlerClass - The task handler class to check
   * @returns true if the handler is registered, false otherwise
   *
   * @example
   * ```typescript
   * if (globalRegistry.hasTaskHandler(PaymentTasks)) {
   *   console.log('PaymentTasks handler is registered');
   * }
   * ```
   */
  hasTaskHandler(handlerClass: Type<any>): boolean {
    return this.taskHandlers.has(handlerClass);
  }

  // =========================================================================
  // Task Registration
  // =========================================================================

  /**
   * Records a task method and its metadata.
   *
   * Tasks are methods of task handler classes, keyed by task name. Registering a name again
   * overwrites its metadata and logs a warning.
   *
   * @param taskName - The unique task name/identifier
   * @param metadata - Task metadata from @Task decorator
   *
   * @example
   * ```typescript
   * @Tasks()
   * class PaymentTasks {
   *   @Task({ name: 'payment.charge' })
   *   async chargeCard(input: any) {}
   * }
   *
   * // The decorator calls:
   * globalRegistry.registerTask('payment.charge', {
   *   name: 'payment.charge',
   *   handlerClass: PaymentTasks,
   *   methodName: 'chargeCard',
   * });
   * ```
   */
  registerTask(taskName: string, metadata: TaskMetadata): void {
    if (this.tasks.has(taskName)) {
      console.warn(
        `[GlobalRegistry] Task "${taskName}" is already registered. Overwriting with new metadata.`
      );
    }
    this.tasks.set(taskName, metadata);
  }

  /**
   * Returns the metadata of a task.
   *
   * @param taskName - The task name to lookup
   * @returns Task metadata if found, undefined otherwise
   *
   * @example
   * ```typescript
   * const metadata = globalRegistry.getTask('payment.charge');
   * if (metadata) {
   *   console.log('Handler:', metadata.handlerClass.name);
   *   console.log('Method:', metadata.methodName);
   * }
   * ```
   */
  getTask(taskName: string): TaskMetadata | undefined {
    return this.tasks.get(taskName);
  }

  /**
   * Returns all registered tasks.
   *
   * The map is a copy, so changing it does not change the registry.
   *
   * @returns Map of all registered tasks (name -> metadata)
   *
   * @example
   * ```typescript
   * const allTasks = globalRegistry.getAllTasks();
   * for (const [taskName, metadata] of allTasks) {
   *   console.log(`Task: ${taskName}, Method: ${metadata.methodName}`);
   * }
   * ```
   */
  getAllTasks(): Map<string, TaskMetadata> {
    return new Map(this.tasks);
  }

  /**
   * Returns whether a task name is registered.
   *
   * @param taskName - The task name to check
   * @returns true if the task is registered, false otherwise
   *
   * @example
   * ```typescript
   * if (globalRegistry.hasTask('payment.charge')) {
   *   console.log('payment.charge task is registered');
   * }
   * ```
   */
  hasTask(taskName: string): boolean {
    return this.tasks.has(taskName);
  }

  // =========================================================================
  // Workflow Registration
  // =========================================================================

  /**
   * Records a workflow class and its metadata.
   *
   * Workflows are `@Workflow` classes, keyed by workflow name. Registering a name again
   * overwrites its metadata and logs a warning.
   *
   * @param workflowName - The unique workflow name/identifier
   * @param metadata - Workflow metadata from @Workflow decorator
   *
   * @example
   * ```typescript
   * @Workflow({ name: 'payment-workflow', version: '1.0' })
   * class PaymentWorkflow {
   *   async run(ctx: WorkflowContext, input: any) {}
   * }
   *
   * // The decorator calls:
   * globalRegistry.registerWorkflow('payment-workflow', {
   *   name: 'payment-workflow',
   *   workflowClass: PaymentWorkflow,
   *   version: '1.0'
   * });
   * ```
   */
  registerWorkflow(workflowName: string, metadata: WorkflowMetadata): void {
    if (this.workflows.has(workflowName)) {
      console.warn(
        `[GlobalRegistry] Workflow "${workflowName}" is already registered. Overwriting with new metadata.`
      );
    }
    this.workflows.set(workflowName, metadata);
  }

  /**
   * Returns the metadata of a workflow.
   *
   * @param workflowName - The workflow name to lookup
   * @returns Workflow metadata if found, undefined otherwise
   *
   * @example
   * ```typescript
   * const metadata = globalRegistry.getWorkflow('payment-workflow');
   * if (metadata) {
   *   console.log('Workflow class:', metadata.workflowClass.name);
   *   console.log('Version:', metadata.version);
   * }
   * ```
   */
  getWorkflow(workflowName: string): WorkflowMetadata | undefined {
    return this.workflows.get(workflowName);
  }

  /**
   * Returns all registered workflows.
   *
   * The map is a copy, so changing it does not change the registry.
   *
   * @returns Map of all registered workflows (name -> metadata)
   *
   * @example
   * ```typescript
   * const allWorkflows = globalRegistry.getAllWorkflows();
   * for (const [workflowName, metadata] of allWorkflows) {
   *   console.log(`Workflow: ${workflowName}, Version: ${metadata.version}`);
   * }
   * ```
   */
  getAllWorkflows(): Map<string, WorkflowMetadata> {
    return new Map(this.workflows);
  }

  /**
   * Returns whether a workflow name is registered.
   *
   * @param workflowName - The workflow name to check
   * @returns true if the workflow is registered, false otherwise
   *
   * @example
   * ```typescript
   * if (globalRegistry.hasWorkflow('payment-workflow')) {
   *   console.log('payment-workflow is registered');
   * }
   * ```
   */
  hasWorkflow(workflowName: string): boolean {
    return this.workflows.has(workflowName);
  }

  // =========================================================================
  // Actor Registration
  // =========================================================================

  /**
   * Records an actor class and its metadata, keyed by actor type name.
   *
   * @param actorName - The unique actor type name
   * @param metadata - Actor metadata from @Actor decorator
   */
  registerActor(actorName: string, metadata: ActorMetadata): void {
    if (this.actors.has(actorName)) {
      console.warn(
        `[GlobalRegistry] Actor "${actorName}" is already registered. Overwriting with new metadata.`
      );
    }
    this.actors.set(actorName, metadata);
  }

  /**
   * Returns the metadata of an actor.
   *
   * @param actorName - The actor name to lookup
   * @returns Actor metadata if found, undefined otherwise
   */
  getActor(actorName: string): ActorMetadata | undefined {
    return this.actors.get(actorName);
  }

  /**
   * Returns a copy of all registered actors.
   *
   * @returns Map of all registered actors (name -> metadata)
   */
  getAllActors(): Map<string, ActorMetadata> {
    return new Map(this.actors);
  }

  /**
   * Returns whether an actor is registered.
   *
   * @param actorName - The actor name to check
   * @returns true if the actor is registered
   */
  hasActor(actorName: string): boolean {
    return this.actors.has(actorName);
  }

  // =========================================================================
  // Operation Registration
  // =========================================================================

  /**
   * Records an actor operation and its metadata.
   *
   * Operations are keyed by `actorName.operationName`, so different actors can use the same
   * operation name. The key uses the class name; {@link GlobalRegistry.rekeyActorOperations}
   * moves it when `@Actor({ name })` sets a different actor name.
   *
   * @param operationName - The operation name
   * @param actorClass - The actor class that owns this operation
   * @param metadata - Operation metadata from @Operation decorator
   */
  registerOperation(
    operationName: string,
    actorClass: Type<any>,
    metadata: OperationMetadata
  ): void {
    const actorName = actorClass.name;
    const key = `${actorName}.${operationName}`;
    if (this.operations.has(key)) {
      console.warn(
        `[GlobalRegistry] Operation "${key}" is already registered. Overwriting with new metadata.`
      );
    }
    this.operations.set(key, metadata);
  }

  /**
   * Returns the metadata of an actor operation.
   *
   * @param actorName - The actor type name
   * @param operationName - The operation name
   * @returns Operation metadata if found, undefined otherwise
   */
  getOperation(actorName: string, operationName: string): OperationMetadata | undefined {
    return this.operations.get(`${actorName}.${operationName}`);
  }

  /**
   * Moves an actor's operations to keys under the actor's public name.
   *
   * Method decorators run before class decorators, so `@Operation` can only key operations by
   * the class name. When `@Actor({ name })` sets a different name, the operations must move to
   * the `${actorName}.${operation}` keys used by lookups and server registration. Otherwise the
   * operations of a renamed actor cannot be found at execution time.
   */
  rekeyActorOperations(actorClass: Type<any>, actorName: string): void {
    const oldPrefix = `${actorClass.name}.`;
    const newPrefix = `${actorName}.`;
    if (oldPrefix === newPrefix) return;

    for (const [key, metadata] of Array.from(this.operations)) {
      if (key.startsWith(oldPrefix) && metadata.actorClass === actorClass) {
        this.operations.delete(key);
        this.operations.set(`${newPrefix}${key.slice(oldPrefix.length)}`, metadata);
      }
    }
  }

  /**
   * Returns a copy of all registered operations.
   *
   * @returns Map of all registered operations (actorName.operationName -> metadata)
   */
  getAllOperations(): Map<string, OperationMetadata> {
    return new Map(this.operations);
  }

  /**
   * Returns whether an actor operation is registered.
   *
   * @param actorName - The actor type name
   * @param operationName - The operation name
   * @returns true if the operation is registered
   */
  hasOperation(actorName: string, operationName: string): boolean {
    return this.operations.has(`${actorName}.${operationName}`);
  }

  /**
   * Returns the operations registered for one actor.
   *
   * @param actorName - The actor type name
   * @returns Array of operation metadata for that actor
   */
  getOperationsForActor(actorName: string): OperationMetadata[] {
    const results: OperationMetadata[] = [];
    const prefix = `${actorName}.`;
    for (const [key, metadata] of this.operations) {
      if (key.startsWith(prefix)) {
        results.push(metadata);
      }
    }
    return results;
  }

  // =========================================================================
  // Update Handler Registration
  // =========================================================================

  /**
   * Records an update handler class and its metadata.
   *
   * @param handlerClass - The update handler class (constructor)
   * @param metadata - Update handler metadata from @Updates decorator
   */
  registerUpdateHandler(handlerClass: Type<any>, metadata: UpdateHandlerMetadata): void {
    if (this.updateHandlers.has(handlerClass)) {
      console.warn(
        `[GlobalRegistry] Update handler ${handlerClass.name} is already registered. Overwriting with new metadata.`
      );
    }
    this.updateHandlers.set(handlerClass, metadata);
  }

  /**
   * Returns the metadata of an update handler class.
   */
  getUpdateHandler(handlerClass: Type<any>): UpdateHandlerMetadata | undefined {
    return this.updateHandlers.get(handlerClass);
  }

  /**
   * Returns a copy of all registered update handlers.
   */
  getAllUpdateHandlers(): Map<Type<any>, UpdateHandlerMetadata> {
    return new Map(this.updateHandlers);
  }

  /**
   * Returns whether an update handler class is registered.
   */
  hasUpdateHandler(handlerClass: Type<any>): boolean {
    return this.updateHandlers.has(handlerClass);
  }

  // =========================================================================
  // Update Registration
  // =========================================================================

  /**
   * Records an update method and its metadata, keyed by update name.
   *
   * @param updateName - The unique update name/identifier
   * @param metadata - Update metadata from @Update decorator
   */
  registerUpdate(updateName: string, metadata: UpdateMetadata): void {
    if (this.updates.has(updateName)) {
      console.warn(
        `[GlobalRegistry] Update "${updateName}" is already registered. Overwriting with new metadata.`
      );
    }
    this.updates.set(updateName, metadata);
  }

  /**
   * Returns the metadata of an update.
   */
  getUpdate(updateName: string): UpdateMetadata | undefined {
    return this.updates.get(updateName);
  }

  /**
   * Returns a copy of all registered updates.
   */
  getAllUpdates(): Map<string, UpdateMetadata> {
    return new Map(this.updates);
  }

  /**
   * Returns whether an update name is registered.
   */
  hasUpdate(updateName: string): boolean {
    return this.updates.has(updateName);
  }

  // =========================================================================
  // Query Handler Registration
  // =========================================================================

  /**
   * Records a query handler class and its metadata.
   *
   * @param handlerClass - The query handler class (constructor)
   * @param metadata - Query handler metadata from @Queries decorator
   */
  registerQueryHandler(handlerClass: Type<any>, metadata: QueryHandlerMetadata): void {
    if (this.queryHandlers.has(handlerClass)) {
      console.warn(
        `[GlobalRegistry] Query handler ${handlerClass.name} is already registered. Overwriting with new metadata.`
      );
    }
    this.queryHandlers.set(handlerClass, metadata);
  }

  /**
   * Returns the metadata of a query handler class.
   */
  getQueryHandler(handlerClass: Type<any>): QueryHandlerMetadata | undefined {
    return this.queryHandlers.get(handlerClass);
  }

  /**
   * Returns a copy of all registered query handlers.
   */
  getAllQueryHandlers(): Map<Type<any>, QueryHandlerMetadata> {
    return new Map(this.queryHandlers);
  }

  /**
   * Returns whether a query handler class is registered.
   */
  hasQueryHandler(handlerClass: Type<any>): boolean {
    return this.queryHandlers.has(handlerClass);
  }

  // =========================================================================
  // Query Registration
  // =========================================================================

  /**
   * Records a query method and its metadata, keyed by query name.
   *
   * @param queryName - The unique query name/identifier
   * @param metadata - Query metadata from @Query decorator
   */
  registerQuery(queryName: string, metadata: QueryMetadata): void {
    if (this.queries.has(queryName)) {
      console.warn(
        `[GlobalRegistry] Query "${queryName}" is already registered. Overwriting with new metadata.`
      );
    }
    this.queries.set(queryName, metadata);
  }

  /**
   * Returns the metadata of a query.
   */
  getQuery(queryName: string): QueryMetadata | undefined {
    return this.queries.get(queryName);
  }

  /**
   * Returns a copy of all registered queries.
   */
  getAllQueries(): Map<string, QueryMetadata> {
    return new Map(this.queries);
  }

  /**
   * Returns whether a query name is registered.
   */
  hasQuery(queryName: string): boolean {
    return this.queries.has(queryName);
  }

  // =========================================================================
  // Utility Methods
  // =========================================================================

  /**
   * Removes every registration of every kind.
   *
   * Intended for tests that need a clean registry.
   *
   * @example
   * ```typescript
   * // In test setup/teardown
   * afterEach(() => {
   *   globalRegistry.clear();
   * });
   * ```
   */
  clear(): void {
    this.services.clear();
    this.taskHandlers.clear();
    this.tasks.clear();
    this.workflows.clear();
    this.actors.clear();
    this.operations.clear();
    this.updateHandlers.clear();
    this.updates.clear();
    this.queryHandlers.clear();
    this.queries.clear();
  }

  /**
   * Returns the number of registrations of each kind.
   *
   * Useful for debugging and monitoring.
   *
   * @returns Object containing counts for each entity type
   *
   * @example
   * ```typescript
   * const stats = globalRegistry.getStats();
   * console.log(`${stats.services} services, ${stats.tasks} tasks, ${stats.workflows} workflows`);
   * ```
   */
  getStats(): {
    services: number;
    taskHandlers: number;
    tasks: number;
    workflows: number;
    actors: number;
    operations: number;
    updateHandlers: number;
    updates: number;
    queryHandlers: number;
    queries: number;
  } {
    return {
      services: this.services.size,
      taskHandlers: this.taskHandlers.size,
      tasks: this.tasks.size,
      workflows: this.workflows.size,
      actors: this.actors.size,
      operations: this.operations.size,
      updateHandlers: this.updateHandlers.size,
      updates: this.updates.size,
      queryHandlers: this.queryHandlers.size,
      queries: this.queries.size,
    };
  }

  /**
   * Returns a human-readable, multi-line count of each kind of registration.
   *
   * Useful for debugging and logging.
   *
   * @returns Formatted string with registration details
   *
   * @example
   * ```typescript
   * console.log(globalRegistry.getSummary());
   * // Output:
   * // GlobalRegistry Summary:
   * //   Services: 5
   * //   Task Handlers: 3
   * //   Tasks: 12
   * //   Workflows: 4
   * //   Actors: 0
   * //   ...
   * ```
   */
  getSummary(): string {
    const stats = this.getStats();
    return `GlobalRegistry Summary:
  Services: ${stats.services}
  Task Handlers: ${stats.taskHandlers}
  Tasks: ${stats.tasks}
  Workflows: ${stats.workflows}
  Actors: ${stats.actors}
  Operations: ${stats.operations}
  Update Handlers: ${stats.updateHandlers}
  Updates: ${stats.updates}
  Query Handlers: ${stats.queryHandlers}
  Queries: ${stats.queries}`;
  }
}

/**
 * The process-wide {@link GlobalRegistry} that decorators register into.
 */
export const globalRegistry = GlobalRegistry.getInstance();
