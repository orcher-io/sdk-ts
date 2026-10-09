/**
 * The worker: polls the Orcher engine for workflow and task execution requests,
 * runs the registered handlers, and reports the results back to the engine.
 *
 * @module @orcher/sdk/worker/worker
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- SDK interop with native Rust module requires dynamic typing */

import { EventEmitter } from 'events';
import * as os from 'os';

import { Client } from '../client/client';
import { tlsForUrl } from '../core/tls';
import { durationToMillis } from '../workflow/types';
import { toPayload } from '../core/bridge/payload';
import { getNativeModule } from '../core/native';
import type { ClientConfig, NativeServiceHandle } from '../core/types';
import { OrcherContainer } from '../di/container';
import { globalRegistry as diGlobalRegistry } from '../di/registry';

import { ActorExecutor } from './actor-executor';
import type { ActorStateClient } from '../actor/context';
import { WorkerError, describeTaskFailure } from './errors';
import { TASK_FAILED_SENTINEL_KEY } from '../errors';
import { Semaphore } from './semaphore';
import { WorkerBuilder } from './worker-builder';
import { SessionManager } from './session';
import { TaskExecutor, type TaskHeartbeatBinding } from './task-executor';
import {
  WorkerState,
  type WorkerOptions,
  type WorkerStats,
  type ShutdownOptions,
  type WorkerIdentity,
  type WorkerCapabilities,
  type WorkerMetadata,
  type WorkerHealth,
  type ServiceEvent,
  type ServiceEventHandler,
  type Logger,
  type ExecutionRequest,
  type JournalTimes,
  type WorkflowDefinition,
  type TaskDefinition,
} from './types';
import { WorkflowExecutor } from './workflow-executor';

/**
 * How long shutdown waits for the workflow and task polling loops to end once
 * the native service has stopped. They normally end at once; this only bounds a
 * poll that never answers.
 */
const DRIVER_POLLER_STOP_TIMEOUT_MS = 5000;

/**
 * Whether a workflow or task poll failed because the native side has let go of
 * the slot: its channel closed once its driver stopped, or the service
 * was torn down. Either way there is nothing left to poll.
 */
function isDriverSlotClosed(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Workflow slot channel closed') ||
    message.includes('Task slot channel closed') ||
    message.includes('Service not started')
  );
}

/**
 * The declared release, defaulting from the environment.
 *
 * The value normally comes from CI, so `ORCHER_VERSION_ID` is the usual way to
 * supply it and an explicit option wins. Blank is treated as *not declared*:
 * the wire type is a bare string, so an exported-but-empty variable would
 * otherwise bind executions to a release literally named "", which is
 * indistinguishable from a real one and would make versioning look like it works.
 */
function resolveVersionId(explicit?: string): string | undefined {
  const value = explicit ?? process.env['ORCHER_VERSION_ID'];
  return value && value.trim() !== '' ? value : undefined;
}

/** The failure kinds the engine accepts on a completion. */
const EXECUTION_ERROR_TYPES = new Set([
  'NonDeterminism',
  'WorkflowCode',
  'Timeout',
  'TaskFailed',
  'Cancelled',
  'InternalError',
]);

/**
 * A duration in milliseconds as sdk-core deserializes a `Duration`.
 */
function msToDuration(ms: number): { secs: number; nanos: number } {
  return { secs: Math.floor(ms / 1000), nanos: Math.round((ms % 1000) * 1_000_000) };
}

/**
 * Coerce a failure kind to one the engine can parse.
 *
 * The engine rejects the entire completion if the kind is not one it accepts,
 * and answers with a parse error about an enum variant, so the workflow's real
 * message is lost. An error class reporting its own name, such as
 * `WorkflowError`, is not an accepted kind.
 *
 * Anything unrecognized is reported as `WorkflowCode`, which is what a throw
 * from a workflow is.
 */
function toExecutionErrorType(kind: unknown): string {
  return typeof kind === 'string' && EXECUTION_ERROR_TYPES.has(kind) ? kind : 'WorkflowCode';
}

/**
 * Polls the Orcher engine for workflow and task work and runs the registered handlers.
 *
 * Polling starts when the worker is constructed. `run()` connects the worker's
 * client and fails if the pollers could not start; `shutdown()` drains in-flight
 * work and stops polling.
 *
 * @example
 * ```typescript
 * import { Worker, task, workflow, TaskContext, WorkflowContext } from '@orcher/sdk';
 *
 * const sendEmail = task({
 *   name: 'send-email',
 *   execute: async (ctx: TaskContext, input: { to: string }) => {
 *     await mailer.send(input.to);
 *     return { sent: true };
 *   },
 * });
 *
 * const orderWorkflow = workflow({
 *   name: 'order-workflow',
 *   run: async (ctx: WorkflowContext, order: { email: string }) => {
 *     await ctx.executeTask(sendEmail, { to: order.email });
 *     return { status: 'completed' };
 *   },
 * });
 *
 * const worker = new Worker({
 *   serverUrl: 'http://localhost:50051',
 *   namespace: 'default',
 *   taskQueue: 'orders',
 *   workflows: [orderWorkflow],
 *   tasks: [sendEmail],
 * });
 *
 * await worker.run();
 *
 * // Later:
 * await worker.shutdown();
 * ```
 */
export class Worker {
  private readonly options: Required<
    Omit<
      WorkerOptions,
      'versionId' | 'binaryChecksum' | 'workflows' | 'tasks' | 'organizationId' | 'apiKey' | 'tls'
    >
  > &
    Pick<WorkerOptions, 'versionId' | 'binaryChecksum' | 'organizationId' | 'apiKey' | 'tls'> & {
      workflows: WorkflowDefinition[];
      tasks: TaskDefinition[];
    };
  private readonly eventEmitter: EventEmitter;
  private readonly logger: Logger;

  private state: WorkerState;
  /**
   * Settles when the native drivers have started polling, or rejects with why
   * they could not. Awaited by `run()`, so a worker whose pollers never came up
   * fails to start instead of reporting itself running.
   */
  private driversStarted: Promise<void> = Promise.resolve();
  private client: Client | null = null;
  private nativeService: NativeServiceHandle | null = null;
  // Per-poller native service handles, each with a unique identity so that
  // pollers do not conflict when claiming work.
  private pollerServiceHandles: NativeServiceHandle[] = [];
  private startTime: Date | null = null;
  private stopTime: Date | null = null;

  private sessionManager: SessionManager | null = null;

  private stats = {
    workflowsExecuted: 0,
    tasksExecuted: 0,
    workflowsInProgress: 0,
    tasksInProgress: 0,
    actorOperationsExecuted: 0,
    actorOperationsInProgress: 0,
    errors: 0,
  };

  private readonly workerId: string;

  private readonly workflowSemaphore: Semaphore;
  private readonly taskSemaphore: Semaphore;

  private shutdownPromise: Promise<void> | null = null;
  private pullModelShutdown = false;
  // The workflow and task polling loops outlive `pullModelShutdown`: see
  // `runWorkflowPollingLoop`. Set once they must stop regardless.
  private driverPollingStopped = false;
  private driverPollingLoops: Promise<void>[] = [];

  private readonly workflowMap: Map<string, any>;
  private readonly taskMap: Map<string, any>;

  private readonly workflowExecutor: WorkflowExecutor;
  private readonly taskExecutor: TaskExecutor;
  private readonly actorExecutor: ActorExecutor | null = null;

  private readonly actorSemaphore: Semaphore;

  private readonly container: OrcherContainer;

  /**
   * Create a worker and start polling.
   *
   * Polling begins here, before `run()` is called; `run()` then reports whether
   * the pollers came up.
   *
   * @param options - Worker configuration options
   * @throws {WorkerError} If a required option is missing or invalid, or the
   *   native service cannot be created.
   *
   * @example
   * ```typescript
   * const worker = new Worker({
   *   serverUrl: 'http://localhost:50051',
   *   namespace: 'default',
   *   taskQueue: 'orders',
   *   workflows: [orderWorkflow, invoiceWorkflow],
   *   tasks: [sendEmail, chargeCard],
   *   maxConcurrentWorkflows: 50,
   *   maxConcurrentTasks: 100,
   * });
   * ```
   */
  constructor(options: WorkerOptions) {
    this.validateOptions(options);

    // Auto-discover workflows and tasks from DI GlobalRegistry if not provided.
    // When they ARE provided, normalize them first: the runtime needs the shape
    // the converters build, and the public factories return a different one.
    const workflows = options.workflows
      ? this.normalizeWorkflowEntries(options.workflows)
      : this.convertDIWorkflowsToDefinitions();
    const tasks = options.tasks
      ? this.normalizeTaskEntries(options.tasks)
      : this.convertDITasksToDefinitions();

    this.options = {
      serverUrl: options.serverUrl,
      namespace: options.namespace,
      taskQueue: options.taskQueue,
      workflows,
      tasks,
      maxConcurrentWorkflows: options.maxConcurrentWorkflows ?? 100,
      maxConcurrentTasks: options.maxConcurrentTasks ?? 100,
      workflowPollInterval: options.workflowPollInterval ?? 100,
      taskPollInterval: options.taskPollInterval ?? 100,
      workflowPollerCount: options.workflowPollerCount ?? 4,
      taskPollerCount: options.taskPollerCount ?? 4,
      shutdownGraceTime: durationToMillis(options.shutdownGraceTime ?? 30000),
      forceShutdownTimeout: options.forceShutdownTimeout ?? 60000,
      identity: options.identity ?? this.generateWorkerId(),
      versionId: resolveVersionId(options.versionId),
      binaryChecksum: options.binaryChecksum,
      logger: options.logger ?? this.createDefaultLogger(),
      organizationId: options.organizationId,
      apiKey: options.apiKey,
      tls: tlsForUrl(options.serverUrl, options.tls),
      heartbeatInterval: options.heartbeatInterval ?? 30000,
      maxConcurrentActorOperations: options.maxConcurrentActorOperations ?? 100,
      actorPollerCount: options.actorPollerCount ?? 2,
    };

    this.logger = this.options.logger;
    this.workerId = this.options.identity;
    this.state = WorkerState.STOPPED;
    this.eventEmitter = new EventEmitter();

    if (workflows.length > 0 || tasks.length > 0) {
      this.logger.info(
        `Service initialized with ${workflows.length} workflow(s) and ${tasks.length} task(s)`
      );
      if (workflows.length > 0) {
        this.logger.debug(
          `Workflows: ${workflows.map((w: any) => w.name || 'anonymous').join(', ')}`
        );
      }
      if (tasks.length > 0) {
        this.logger.debug(`Tasks: ${tasks.map((t: any) => t.name || 'anonymous').join(', ')}`);
      }
    }

    this.workflowSemaphore = new Semaphore(this.options.maxConcurrentWorkflows);
    this.taskSemaphore = new Semaphore(this.options.maxConcurrentTasks);
    this.actorSemaphore = new Semaphore(options.maxConcurrentActorOperations ?? 100);

    this.workflowMap = new Map(workflows.map((w: any) => [w.name, w]));
    this.taskMap = new Map(tasks.map((t: any) => [t.name, t]));

    // The DI container comes first: the task and actor executors resolve from it.
    this.container = new OrcherContainer();
    this.initializeDIContainer();

    // The workflow executor gets no DI container. Workflows must be
    // deterministic, so they only schedule tasks; injected dependencies are
    // used by tasks, which run through the task executor.
    this.workflowExecutor = new WorkflowExecutor({
      logger: this.logger,
      defaultTimeout: 3600000, // 1 hour
      enableTimeout: true,
    });

    // The executor's own heartbeat timer is off: the native worker heartbeats
    // every running task itself, and heartbeats a handler records reach it
    // through `taskHeartbeatBinding`.
    this.taskExecutor = new TaskExecutor({
      logger: this.logger,
      container: this.container,
      defaultTimeout: 600000, // 10 minutes
      enableTimeout: true,
      enableHeartbeat: false,
    });

    // An actor executor exists only when actors are registered.
    const registeredActors = diGlobalRegistry.getAllActors();
    if (registeredActors.size > 0) {
      const stateClient = this.createActorStateClient();
      this.actorExecutor = new ActorExecutor({
        logger: this.logger,
        container: this.container,
        stateClient,
      });
      this.logger.info(`Actor executor initialized with ${registeredActors.size} actor(s)`);
    }

    this.logger.info(`Service created with ID: ${this.workerId}`);
    this.logger.info(`Runtime mode: Direct-Bindings (Rust polling)`);

    // Polling starts during construction, not in run(). run() waits for the
    // pollers and fails if they could not start.
    this.initializeEagerPolling();
  }

  /**
   * Create a `WorkerBuilder` for fluent construction.
   *
   * @returns A new `WorkerBuilder`
   *
   * @example
   * ```typescript
   * // With auto-discovery
   * const worker = await Worker.builder()
   *   .serverUrl('http://localhost:50051')
   *   .namespace('default')
   *   .taskQueue('orders')
   *   .autoDiscover()
   *   .build();
   *
   * // Without auto-discovery: import the files that register handlers
   * import './tasks/order.tasks';
   * import './workflows/order.workflow';
   *
   * const worker = await Worker.builder()
   *   .serverUrl('http://localhost:50051')
   *   .namespace('default')
   *   .taskQueue('orders')
   *   .build();
   * ```
   */
  static builder(): WorkerBuilder {
    return WorkerBuilder.create();
  }

  /**
   * Register every decorated class from the DI GlobalRegistry with the container.
   *
   * - Services (@Injectable) are registered based on their scope
   * - Task handlers (@Tasks) are registered as transient (new instance per execution)
   * - Workflows are NOT registered (they must be stateless and deterministic)
   *
   * @private
   */
  private initializeDIContainer(): void {
    this.logger.debug('Initializing DI container...');

    const services = diGlobalRegistry.getAllServices();
    for (const [serviceClass, metadata] of services) {
      try {
        if (metadata.scope === 'singleton') {
          this.container.registerSingleton(serviceClass);
          this.logger.debug(`Registered service as singleton: ${serviceClass.name || 'anonymous'}`);
        } else if (metadata.scope === 'transient') {
          this.container.registerTransient(serviceClass);
          this.logger.debug(`Registered service as transient: ${serviceClass.name || 'anonymous'}`);
        } else {
          // Not supported yet: request scope. A scoped service is registered as
          // a singleton.
          this.container.registerSingleton(serviceClass);
          this.logger.debug(
            `Registered service as singleton (scoped): ${serviceClass.name || 'anonymous'}`
          );
        }
      } catch (error) {
        this.logger.error(`Failed to register service ${serviceClass.name || 'anonymous'}:`, error);
      }
    }

    // Task handlers are always transient: a new instance per task execution.
    const taskHandlers = diGlobalRegistry.getAllTaskHandlers();
    for (const [handlerClass] of taskHandlers) {
      try {
        this.container.registerTransient(handlerClass);
        this.logger.debug(`Registered task handler: ${handlerClass.name || 'anonymous'}`);
      } catch (error) {
        this.logger.error(
          `Failed to register task handler ${handlerClass.name || 'anonymous'}:`,
          error
        );
      }
    }

    // Register query and update handler classes. The worker resolves them from
    // the container when a query or update arrives; unregistered, every one
    // was answered with a missing-dependency error.
    const handlerClasses = [
      ...diGlobalRegistry.getAllQueryHandlers().keys(),
      ...diGlobalRegistry.getAllUpdateHandlers().keys(),
    ];
    for (const handlerClass of handlerClasses) {
      try {
        if (!this.container.has(handlerClass)) {
          this.container.registerTransient(handlerClass);
        }
      } catch (error) {
        this.logger.error(
          `Failed to register query/update handler ${handlerClass.name || 'anonymous'}:`,
          error
        );
      }
    }

    // Actors are transient: a new instance per operation, since their state
    // lives on the server.
    const actors = diGlobalRegistry.getAllActors();
    for (const [actorName, metadata] of actors) {
      try {
        this.container.registerTransient(metadata.actorClass);
        this.logger.debug(`Registered actor: ${actorName}`);
      } catch (error) {
        this.logger.error(`Failed to register actor ${actorName}:`, error);
      }
    }

    const diStats = diGlobalRegistry.getStats();
    const containerStats = this.container.getStats();

    this.logger.info('DI Container initialized:');
    this.logger.info(`   Services: ${diStats.services} (${containerStats.providers} providers)`);
    this.logger.info(`   Task Handlers: ${diStats.taskHandlers}`);
    this.logger.info(`   Tasks: ${diStats.tasks}`);
    this.logger.info(`   Workflows: ${diStats.workflows} (not managed by DI - deterministic)`);
    if (diStats.actors > 0) {
      this.logger.info(`   Actors: ${diStats.actors} (${diStats.operations} operations)`);
    }

    if (diStats.services === 0 && diStats.taskHandlers === 0) {
      this.logger.warn(
        '⚠️  No services or task handlers registered with DI. ' +
          'If you are using DI, ensure your files are imported or use auto-discovery.'
      );
    }
  }

  /**
   * Start the worker.
   *
   * Polling began when the worker was constructed. `run()` connects the worker's
   * client to the engine, waits for the pollers to come up, marks the worker
   * running and emits `started`. It resolves once the worker has started; it does
   * not wait for shutdown. If the pollers could not start, `run()` rejects
   * instead of reporting a worker that never polls.
   *
   * @throws {WorkerError} If the worker is not stopped, or fails to connect or start polling
   *
   * @example
   * ```typescript
   * await worker.run();
   * console.log('Worker is now polling for work');
   * ```
   */
  async run(): Promise<void> {
    if (this.state !== WorkerState.STOPPED) {
      throw new WorkerError(`Cannot start service in state: ${this.state}`);
    }

    this.logger.info('Starting service...');
    this.state = WorkerState.STARTING;

    try {
      // The native service was already created in the constructor.
      this.logger.info('Connecting to orchestrator...');

      const clientConfig: ClientConfig = {
        serverUrl: this.options.serverUrl,
        namespace: this.options.namespace,
        identity: this.options.identity,
        // The worker's own client reaches the same server the pollers do,
        // so it carries the same credential and the same TLS setting.
        apiKey: this.options.apiKey,
        tls: this.options.tls,
      };

      this.client = new Client(clientConfig);
      await this.client.connect();

      this.logger.info('Connected to orchestrator successfully');

      // The pollers were started in the constructor; this is where their
      // outcome is judged. If they could not connect, that is the error the
      // caller gets — not a worker that says it is running and never polls.
      await this.driversStarted;

      await this.registerWorker();

      this.state = WorkerState.RUNNING;
      this.startTime = new Date();
      this.stopTime = null;

      this.logger.info('Service started successfully (polling began during initialization)');
      this.emit('started');
    } catch (error) {
      this.state = WorkerState.STOPPED;
      this.logger.error('Failed to start service:', error);
      throw new WorkerError(
        `Failed to start service: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Shut the worker down gracefully.
   *
   * Shutdown runs in this order:
   * 1. The native drivers stop starting new polls.
   * 2. In-flight executions get up to the timeout to complete (skipped with `force`).
   * 3. The native service stops, and the polling loops end.
   * 4. The DI container is disposed and the worker emits `stopped`.
   *
   * Concurrent calls share one shutdown. Calling it on a stopped worker does nothing.
   *
   * @param options - Shutdown configuration
   *
   * @example
   * ```typescript
   * // Graceful shutdown with the default timeout
   * await worker.shutdown();
   *
   * // Do not wait for in-flight executions
   * await worker.shutdown({ force: true });
   *
   * // Custom timeout
   * await worker.shutdown({ timeout: 60000 });
   * ```
   */
  async shutdown(options?: ShutdownOptions): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    if (this.state === WorkerState.STOPPED) {
      return;
    }

    this.shutdownPromise = this.performShutdown(options);
    return this.shutdownPromise;
  }

  /**
   * Whether the worker is running.
   *
   * @returns True if the worker is in the RUNNING state
   */
  isRunning(): boolean {
    return this.state === WorkerState.RUNNING;
  }

  /**
   * Get execution statistics for this worker.
   *
   * @returns Current worker statistics
   *
   * @example
   * ```typescript
   * const stats = worker.getStats();
   * console.log('Workflows executed:', stats.workflowsExecuted);
   * console.log('Tasks in progress:', stats.tasksInProgress);
   * ```
   */
  getStats(): WorkerStats {
    return {
      workflowsExecuted: this.stats.workflowsExecuted,
      tasksExecuted: this.stats.tasksExecuted,
      workflowsInProgress: this.stats.workflowsInProgress,
      tasksInProgress: this.stats.tasksInProgress,
      errors: this.stats.errors,
      uptime: this.getUptime(),
      state: this.state,
      workerId: this.workerId,
      startedAt: this.startTime ?? undefined,
      stoppedAt: this.stopTime ?? undefined,
      actorOperationsExecuted: this.stats.actorOperationsExecuted,
      actorOperationsInProgress: this.stats.actorOperationsInProgress,
    };
  }

  /**
   * Register an event listener.
   *
   * Not supported yet: the per-execution events (`workflow-*`, `task-*`). The
   * worker emits `started`, `stopped` and `error` only.
   *
   * @param event - Event name
   * @param handler - Event handler function
   *
   * @example
   * ```typescript
   * worker.on('started', () => {
   *   console.log('Worker started');
   * });
   *
   * worker.on('error', (error) => {
   *   console.error('Shutdown failed:', error);
   * });
   * ```
   */
  on(event: ServiceEvent, handler: ServiceEventHandler): void {
    this.eventEmitter.on(event, handler);
  }

  /**
   * Remove an event listener.
   *
   * @param event - Event name
   * @param handler - Event handler function
   */
  off(event: ServiceEvent, handler: ServiceEventHandler): void {
    this.eventEmitter.off(event, handler);
  }

  /**
   * Get the worker's identity.
   *
   * @returns Worker identity information
   */
  getIdentity(): WorkerIdentity {
    return {
      workerId: this.workerId,
      versionId: this.options.versionId,
      binaryChecksum: this.options.binaryChecksum,
    };
  }

  /**
   * Get the workflow and task types this worker handles, and its concurrency limits.
   *
   * @returns Worker capabilities
   */
  getCapabilities(): WorkerCapabilities {
    return {
      workflows: this.options.workflows.map((w: any) => w.name),
      tasks: this.options.tasks.map((t: any) => t.name),
      maxConcurrentWorkflows: this.options.maxConcurrentWorkflows,
      maxConcurrentTasks: this.options.maxConcurrentTasks,
    };
  }

  /**
   * Get the worker's identity, capabilities and health together.
   *
   * @returns Complete worker metadata
   */
  getMetadata(): WorkerMetadata {
    return {
      identity: this.getIdentity(),
      capabilities: this.getCapabilities(),
      health: this.getHealth(),
    };
  }

  /**
   * Get the DI container instance.
   *
   * Provides access to the DI container for advanced use cases.
   * Most users should not need to access the container directly.
   *
   * @returns The DI container instance
   *
   * @example
   * ```typescript
   * const container = worker.getContainer();
   * const myService = container.resolve(MyService);
   * ```
   */
  getContainer(): OrcherContainer {
    return this.container;
  }

  /**
   * Get the worker's health, derived from its state and error rate.
   *
   * @returns Worker health status
   */
  getHealth(): WorkerHealth {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      status: this.determineHealthStatus(),
      lastHeartbeat: new Date(),
      uptime: this.getUptime(),
      memoryUsage: memUsage.heapUsed,
      cpuUsage: this.calculateCpuPercentage(cpuUsage),
    };
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  /**
   * Validate worker options.
   */
  private validateOptions(options: WorkerOptions): void {
    if (!options.serverUrl || options.serverUrl.trim().length === 0) {
      throw new WorkerError('serverUrl is required');
    }

    if (!options.namespace || options.namespace.trim().length === 0) {
      throw new WorkerError('namespace is required');
    }

    if (!options.taskQueue || options.taskQueue.trim().length === 0) {
      throw new WorkerError('taskQueue is required');
    }

    if (!options.workflows || options.workflows.length === 0) {
      this.logger?.warn('No workflows registered - service will only execute tasks');
    }

    if (!options.tasks || options.tasks.length === 0) {
      this.logger?.warn('No tasks registered - service will only execute workflows');
    }

    if (options.maxConcurrentWorkflows !== undefined && options.maxConcurrentWorkflows < 1) {
      throw new WorkerError('maxConcurrentWorkflows must be >= 1');
    }

    if (options.maxConcurrentTasks !== undefined && options.maxConcurrentTasks < 1) {
      throw new WorkerError('maxConcurrentTasks must be >= 1');
    }

    // A poller count of 0 starts a worker that reports healthy and never picks
    // up work — reject it rather than let it look like a server-side problem.
    // Note `?? 4` elsewhere does not catch 0, since 0 is not nullish.
    for (const key of ['workflowPollerCount', 'taskPollerCount', 'actorPollerCount'] as const) {
      const value = options[key];
      if (value !== undefined && value < 1) {
        throw new WorkerError(`${key} must be >= 1 (a worker with 0 pollers never receives work)`);
      }
    }
  }

  /**
   * Generate a unique worker ID
   */
  private generateWorkerId(): string {
    const hostname = os.hostname();
    const pid = process.pid;
    const timestamp = Date.now();
    return `worker-${hostname}-${pid}-${timestamp}`;
  }

  /**
   * Create default console logger
   */
  private createDefaultLogger(): Logger {
    return {
      debug: (message: string, ...args: any[]) => console.debug(`[Service] ${message}`, ...args),
      info: (message: string, ...args: any[]) => console.info(`[Service] ${message}`, ...args),
      warn: (message: string, ...args: any[]) => console.warn(`[Service] ${message}`, ...args),
      error: (message: string, ...args: any[]) => console.error(`[Service] ${message}`, ...args),
    };
  }

  /**
   * Register worker with orchestrator
   */
  private async registerWorker(): Promise<void> {
    // Worker registration is handled automatically by the native WorkerRegistrationDriver
    // which is spawned in serviceStart(). It registers on startup and sends periodic
    // heartbeats to the server. No action needed here.
    this.logger.info(
      'Worker registration handled by native driver (automatic register + heartbeat)'
    );
  }

  /**
   * Create the native service and start polling. Called from the constructor.
   */
  private initializeEagerPolling(): void {
    this.logger.info('Initializing eager polling (Pull Model - like Python SDK)...');

    try {
      const nativeModule = getNativeModule();
      this.nativeService = nativeModule.serviceCreate({
        serverUrl: this.options.serverUrl,
        namespace: this.options.namespace,
        taskQueue: this.options.taskQueue,
        identity: this.options.identity,
        maxConcurrentWorkflows: this.options.maxConcurrentWorkflows,
        maxConcurrentTasks: this.options.maxConcurrentTasks,
        organizationId: this.options.organizationId,
        // Without this the worker accepts a configured apiKey and then polls
        // unauthenticated.
        apiKey: this.options.apiKey,
        // Without this the release is accepted but never sent, so no
        // execution binds to it.
        versionId: this.options.versionId,
        // The driver reads `tls` from here; without it the worker cannot reach
        // a TLS endpoint at all.
        tls: this.options.tls,
      });

      this.logger.info('Native service handle created');

      this.sessionManager = new SessionManager(this.nativeService, nativeModule, {
        maxSessions: 10,
      });

      // Pull model: this side calls the native poll methods in a loop.
      this.startPullModelPolling();

      this.logger.info('Eager polling initialized - pull model polling active');
    } catch (error) {
      this.logger.error('Failed to initialize eager polling:', error);
      throw new WorkerError(
        `Failed to initialize eager polling: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Start pull-model polling: TypeScript calls the native poll methods in a loop.
   *
   * Architecture:
   * - sdk-core handles gRPC long-polling and state machines
   * - TypeScript calls pollWorkflowTask/pollTask in a loop to receive work
   * - TypeScript executes handlers and calls completeWorkflowTask/completeTask
   *
   * This is more efficient than a callback (push) model because it needs:
   * - No Neon event channel marshalling
   * - No promise callback machinery
   * - Direct function calls with JSON serialization
   */
  private startPullModelPolling(): void {
    // Started here, judged in run(). The promise is kept so run() can await
    // it: a worker whose pollers failed to connect must fail to start, not log
    // "running" and sit idle. The trailing catch only stops an unobserved
    // rejection from being fatal before run() gets there.
    const started = this.startPullModelPollingAsync();
    this.driversStarted = started;
    started.catch(() => undefined);
  }

  private async startPullModelPollingAsync(): Promise<void> {
    const nativeModule = getNativeModule();

    // An older native build may lack the pull-model functions.
    if (!nativeModule.serviceStart || !nativeModule.pollWorkflowTask || !nativeModule.pollTask) {
      throw new WorkerError(
        'Pull model functions not available - ensure native module is up to date'
      );
    }

    this.logger.info('Starting pull model polling (like Python SDK)...');

    const workflowPollerCount = this.options.workflowPollerCount ?? 4;
    const taskPollerCount = this.options.taskPollerCount ?? 4;
    const actorPollerCount = this.actorExecutor ? (this.options.actorPollerCount ?? 2) : 0;

    if (!this.nativeService) {
      throw new WorkerError('Native service handle not created');
    }

    // Register actor handlers with the server before starting drivers
    let actorRegistrationId: string | undefined;
    if (actorPollerCount > 0 && nativeModule.registerActorHandlers) {
      try {
        actorRegistrationId = await this.registerActorHandlersWithServer(nativeModule);
      } catch (error) {
        this.logger.error('Failed to register actor handlers:', error);
        // Continue without registration — heartbeat will work without registration_id
      }
    }

    try {
      // Start the sdk-core drivers (creates WorkflowDriver, TaskDriver, and optionally ActorDriver)
      await nativeModule.serviceStart(
        this.nativeService,
        workflowPollerCount,
        taskPollerCount,
        actorPollerCount > 0 ? actorPollerCount : undefined,
        actorRegistrationId
      );

      this.logger.info('sdk-core drivers started successfully with multi-channel fan-out');

      // One polling loop per slot. Each slot has its own channel, so the loops
      // do not contend on a lock.
      for (let slot = 0; slot < workflowPollerCount; slot++) {
        this.driverPollingLoops.push(this.runWorkflowPollingLoop(slot));
      }
      for (let slot = 0; slot < taskPollerCount; slot++) {
        this.driverPollingLoops.push(this.runTaskPollingLoop(slot));
      }

      // Start actor polling loops if actors are registered
      if (actorPollerCount > 0) {
        for (let slot = 0; slot < actorPollerCount; slot++) {
          void this.runActorPollingLoop(slot);
        }
        this.logger.info(`Started ${actorPollerCount} actor polling loops`);
      }

      this.logger.info(
        `Started ${workflowPollerCount} workflow polling loops and ${taskPollerCount} task polling loops (multi-channel fan-out, fire-and-forget execution)`
      );
    } catch (error) {
      this.logger.error('Failed to start sdk-core drivers:', error);
      // Rethrown so run() fails. A worker that cannot poll is not running.
      throw error;
    }
  }

  /**
   * Register actor handlers with the server via native module.
   * Returns the registration_id on success.
   */
  private async registerActorHandlersWithServer(nativeModule: any): Promise<string | undefined> {
    const actors = diGlobalRegistry.getAllActors();
    if (actors.size === 0) return undefined;

    // Build handler list from registry: one entry per (actor, operation) pair
    const handlers: Array<{ actor_name: string; operation: string; mode: string }> = [];
    for (const [actorName] of actors) {
      const operations = diGlobalRegistry.getOperationsForActor(actorName);
      for (const op of operations) {
        handlers.push({
          actor_name: actorName,
          operation: op.name,
          mode: op.mode ?? 'exclusive',
        });
      }
    }

    if (handlers.length === 0) {
      this.logger.warn('Actors registered but no operations found — skipping server registration');
      return undefined;
    }

    const metadata: Record<string, string> = {
      sdk: 'typescript',
      version: '0.1.0',
    };

    this.logger.info(`Registering ${handlers.length} actor handler(s) with server...`);

    const resultJson: string = await nativeModule.registerActorHandlers(
      this.nativeService,
      JSON.stringify(handlers),
      JSON.stringify(metadata)
    );

    const result = JSON.parse(resultJson);

    if (result.success) {
      this.logger.info(
        `Actor handlers registered: ${result.handlers_registered} handler(s), registration_id=${result.registration_id}`
      );
      return result.registration_id;
    } else {
      this.logger.error(`Actor handler registration failed: ${result.error_message}`);
      return undefined;
    }
  }

  /**
   * Run the workflow polling loop for one slot.
   *
   * Each loop polls its own slot channel, so loops do not contend on a lock.
   * Workflow tasks are not awaited, so several run concurrently while polling
   * continues.
   */
  private async runWorkflowPollingLoop(slotIndex: number): Promise<void> {
    const nativeModule = getNativeModule();
    this.logger.debug(`[Workflow Slot ${slotIndex}] Starting polling loop`);

    // Not bounded by `pullModelShutdown`. During shutdown the workflow driver
    // still hands over what the polls it already had out bring back, each
    // claimed on the engine; stopping here first would leave it to wait out
    // the claim timeout. The loop ends when the native side closes this slot's
    // channel, once the driver has stopped.
    while (!this.driverPollingStopped) {
      try {
        if (!this.nativeService) {
          this.logger.debug(`[Workflow Slot ${slotIndex}] Service handle is null, stopping`);
          break;
        }

        const workJson = await nativeModule.pollWorkflowTask(this.nativeService, slotIndex);

        if (!workJson) {
          // The poll timed out with no work.
          continue;
        }

        const work = JSON.parse(workJson);
        const executionRequest = work.execution_request;
        const workflowId = work.workflow_id;
        const runId = work.run_id;
        const taskToken = work.task_token;
        const streamEntryId = work.stream_entry_id;

        this.logger.debug(
          `[Workflow Slot ${slotIndex}] Received workflow task: ${workflowId}/${runId}`
        );

        // Not awaited, so the loop keeps polling while the workflow runs.
        void this.handleWorkflowTask(
          nativeModule,
          executionRequest,
          workflowId,
          runId,
          taskToken,
          streamEntryId
        ).catch((error) => {
          this.logger.error(
            `[Workflow Slot ${slotIndex}] Unhandled error in workflow ${workflowId}/${runId}:`,
            error
          );
        });
      } catch (error) {
        if (this.driverPollingStopped || isDriverSlotClosed(error)) {
          break; // Expected during shutdown
        }
        this.logger.error(`[Workflow Slot ${slotIndex}] Polling error:`, error);
        // Brief pause before retry to avoid tight error loop
        await this.sleep(100);
      }
    }

    this.logger.debug(`[Workflow Slot ${slotIndex}] Polling loop stopped`);
  }

  /**
   * Run one workflow task and report its outcome to sdk-core.
   *
   * Called without being awaited, so workflow tasks run concurrently.
   */
  private async handleWorkflowTask(
    nativeModule: any,
    executionRequest: any,
    workflowId: string,
    runId: string,
    taskToken: string,
    streamEntryId: string | null
  ): Promise<void> {
    try {
      const result = await this.executeWorkflowDirectBindings(executionRequest);

      const resultJson = JSON.stringify(result);
      await nativeModule.completeWorkflowTask(
        this.nativeService,
        workflowId,
        runId,
        resultJson,
        taskToken,
        streamEntryId
      );

      this.logger.debug(`[Workflow Handler] Completed workflow task: ${workflowId}/${runId}`);
    } catch (execError) {
      // Send failure back to sdk-core
      const errorMessage = execError instanceof Error ? execError.message : String(execError);
      await nativeModule.failWorkflowTask(
        this.nativeService,
        workflowId,
        runId,
        taskToken,
        errorMessage,
        streamEntryId
      );

      this.logger.error(
        `[Workflow Handler] Failed workflow task: ${workflowId}/${runId}`,
        execError
      );
    }
  }

  /**
   * Run the task polling loop for one slot.
   *
   * Each loop polls its own slot channel, so loops do not contend on a lock.
   * Tasks are not awaited, so several run concurrently while polling continues.
   */
  private async runTaskPollingLoop(slotIndex: number): Promise<void> {
    const nativeModule = getNativeModule();
    this.logger.debug(`[Task Slot ${slotIndex}] Starting polling loop`);

    // Not bounded by `pullModelShutdown`, for the same reason as the workflow
    // loop: the task driver still hands over, during shutdown, tasks the engine
    // already has claimed. The loop ends when the native side closes this
    // slot's channel, once the driver has stopped.
    while (!this.driverPollingStopped) {
      try {
        if (!this.nativeService) {
          this.logger.debug(`[Task Slot ${slotIndex}] Service handle is null, stopping`);
          break;
        }

        const workJson = await nativeModule.pollTask(this.nativeService, slotIndex);

        if (!workJson) {
          // The poll timed out with no work.
          continue;
        }

        const work = JSON.parse(workJson);

        this.logger.debug(
          `[Task Slot ${slotIndex}] Received task: ${work.task_type}/${work.task_id}`
        );

        // Not awaited, so the loop keeps polling while the task runs.
        void this.handleTask(nativeModule, work).catch((error) => {
          this.logger.error(
            `[Task Slot ${slotIndex}] Unhandled error in task ${work.task_type}/${work.task_id}:`,
            error
          );
        });
      } catch (error) {
        if (this.driverPollingStopped || isDriverSlotClosed(error)) {
          break; // Expected during shutdown
        }
        this.logger.error(`[Task Slot ${slotIndex}] Polling error:`, error);
        // Brief pause before retry to avoid tight error loop
        await this.sleep(100);
      }
    }

    this.logger.debug(`[Task Slot ${slotIndex}] Polling loop stopped`);
  }

  /**
   * Run one task and report its outcome to sdk-core.
   *
   * Called without being awaited, so tasks run concurrently. Internal session
   * tasks go to the `SessionManager` instead of a registered handler.
   */
  private async handleTask(nativeModule: any, work: any): Promise<void> {
    const taskToken = work.task_token;
    const taskType = work.task_type;
    const taskId = work.task_id;

    // The native worker heartbeats the task on its own while it runs, from
    // the moment it was handed over until its outcome reaches the engine.
    try {
      // Internal session tasks are handled by the SessionManager.
      const { SESSION_CREATE_TASK, SESSION_COMPLETE_TASK } = await import('../workflow/session');

      if (taskType === SESSION_CREATE_TASK && this.sessionManager) {
        const result = await this.sessionManager.handleCreateSession(
          work.input,
          work.task_queue ?? ''
        );
        const resultJson = JSON.stringify(result);
        await nativeModule.completeTask(this.nativeService, taskToken, resultJson);
        this.logger.debug(`[Session] Created session via ${taskType}/${taskId}`);
        return;
      }

      if (taskType === SESSION_COMPLETE_TASK && this.sessionManager) {
        const result = await this.sessionManager.handleCompleteSession(work.input);
        const resultJson = JSON.stringify(result);
        await nativeModule.completeTask(this.nativeService, taskToken, resultJson);
        this.logger.debug(`[Session] Completed session via ${taskType}/${taskId}`);
        return;
      }

      const result = await this.executeTaskDirectBindings(work);

      if (result && result.successful === false) {
        // The task handler threw or returned a failure: report a task failure to the
        // engine, not a completion. A failing task reported as a completion is journaled
        // as completed, and replay never surfaces the failure to the workflow.
        const errorMessage = result.error?.message || 'Task failed';
        await nativeModule.failTask(
          this.nativeService,
          taskToken,
          errorMessage,
          result.error?.type ?? 'TaskExecutionError',
          result.error?.nonRetryable === true
        );
        this.logger.debug(`[Task Handler] Failed task: ${taskType}/${taskId}`);
      } else {
        // Send the task's actual output (not the execution envelope) so the workflow
        // receives the real return value on replay.
        const resultJson = JSON.stringify(result.output ?? null);
        await nativeModule.completeTask(this.nativeService, taskToken, resultJson);
        this.logger.debug(`[Task Handler] Completed task: ${taskType}/${taskId}`);
      }
    } catch (execError) {
      // Send failure back to sdk-core
      const failure = describeTaskFailure(execError);
      await nativeModule.failTask(
        this.nativeService,
        taskToken,
        failure.message,
        failure.type,
        failure.nonRetryable
      );

      this.logger.error(`[Task Handler] Failed task: ${taskType}/${taskId}`, execError);
    }
  }

  // =========================================================================
  // Actor Polling and Execution
  // =========================================================================

  /**
   * Create an ActorStateClient that bridges to the native module for state RPCs.
   *
   * When the native module lacks a state function, the client answers as if no
   * state exists and writes succeed without being stored.
   */
  private createActorStateClient(): ActorStateClient {
    const nativeModule = getNativeModule();
    const service = this;

    return {
      async getState(actorName, key, stateKey, executionId) {
        if (!service.nativeService) {
          throw new Error('Native service not initialized');
        }
        if (nativeModule.actorGetState) {
          const result = await nativeModule.actorGetState(
            service.nativeService,
            actorName,
            key,
            stateKey,
            executionId
          );
          return {
            value: result?.value ?? new Uint8Array(0),
            exists: result?.exists ?? false,
          };
        }
        // The native module has no state support: report the key as absent.
        return { value: new Uint8Array(0), exists: false };
      },

      async setState(actorName, key, stateKey, value, executionId) {
        if (!service.nativeService) {
          throw new Error('Native service not initialized');
        }
        if (nativeModule.actorSetState) {
          const result = await nativeModule.actorSetState(
            service.nativeService,
            actorName,
            key,
            stateKey,
            value,
            executionId
          );
          return { success: result?.success ?? true };
        }
        return { success: true };
      },

      async deleteState(actorName, key, stateKey, executionId) {
        if (!service.nativeService) {
          throw new Error('Native service not initialized');
        }
        if (nativeModule.actorDeleteState) {
          const result = await nativeModule.actorDeleteState(
            service.nativeService,
            actorName,
            key,
            stateKey,
            executionId
          );
          return { existed: result?.existed ?? false };
        }
        return { existed: false };
      },

      async listStateKeys(actorName, key, executionId, prefix?) {
        if (!service.nativeService) {
          throw new Error('Native service not initialized');
        }
        if (nativeModule.actorListStateKeys) {
          const result = await nativeModule.actorListStateKeys(
            service.nativeService,
            actorName,
            key,
            executionId,
            prefix
          );
          return { keys: result?.keys ?? [] };
        }
        return { keys: [] };
      },
    };
  }

  /**
   * Run the actor operation polling loop for one slot.
   *
   * Operations are not awaited, so several run concurrently while polling
   * continues. Unlike the workflow and task loops, this one stops as soon as
   * shutdown begins.
   */
  private async runActorPollingLoop(slotIndex: number): Promise<void> {
    const nativeModule = getNativeModule();
    this.logger.debug(`[Actor Slot ${slotIndex}] Starting polling loop`);

    while (!this.pullModelShutdown) {
      try {
        if (!this.nativeService) {
          this.logger.debug(`[Actor Slot ${slotIndex}] Service handle is null, stopping`);
          break;
        }

        if (!nativeModule.pollActorOperation) {
          this.logger.debug(`[Actor Slot ${slotIndex}] pollActorOperation not available, stopping`);
          break;
        }

        const workJson = await nativeModule.pollActorOperation(this.nativeService, slotIndex);

        if (!workJson) {
          continue; // The poll timed out with no work.
        }

        const operation = JSON.parse(workJson);

        this.logger.debug(
          `[Actor Slot ${slotIndex}] Received actor operation: ${operation.actor_name}.${operation.operation} (key=${operation.key})`
        );

        // Not awaited, so the loop keeps polling while the operation runs.
        void this.handleActorOperation(nativeModule, operation).catch((error) => {
          this.logger.error(`[Actor Slot ${slotIndex}] Unhandled error in actor operation:`, error);
        });
      } catch (error) {
        if (this.pullModelShutdown) {
          break;
        }
        this.logger.error(`[Actor Slot ${slotIndex}] Polling error:`, error);
        await this.sleep(100);
      }
    }

    this.logger.debug(`[Actor Slot ${slotIndex}] Polling loop stopped`);
  }

  /**
   * Run one actor operation and report its outcome to the server.
   */
  private async handleActorOperation(nativeModule: any, work: any): Promise<void> {
    if (!this.actorExecutor) {
      this.logger.error('[Actor Handler] Actor executor not initialized');
      return;
    }

    await this.actorSemaphore.acquire();
    this.stats.actorOperationsInProgress++;

    try {
      // Convert snake_case from native to camelCase for proto type
      const operation = {
        operationId: work.operation_id ?? work.operationId ?? '',
        actorName: work.actor_name ?? work.actorName ?? '',
        key: work.key ?? '',
        operation: work.operation ?? '',
        payload:
          work.payload instanceof Uint8Array
            ? work.payload
            : typeof work.payload === 'string'
              ? // The native bridge JSON-encodes payload bytes as base64 —
                // decode them (text-encoding the base64 chars would hand the
                // handler garbage bytes instead of its input).
                Buffer.from(work.payload, 'base64')
              : new Uint8Array(work.payload ?? []),
        mode: work.mode ?? 0,
        executionId: work.execution_id ?? work.executionId ?? '',
        metadata: work.metadata ?? {},
      };

      const result = await this.actorExecutor.execute(operation);

      this.stats.actorOperationsExecuted++;
      this.stats.actorOperationsInProgress--;
      this.actorSemaphore.release();

      // Complete the operation back to the server
      if (nativeModule.completeActorOperation) {
        await nativeModule.completeActorOperation(
          this.nativeService,
          operation.operationId,
          operation.executionId,
          result.result,
          result.success,
          result.error
        );
      }

      this.logger.debug(
        `[Actor Handler] Completed: ${operation.actorName}.${operation.operation} (key=${operation.key})`
      );
    } catch (error) {
      this.stats.errors++;
      this.stats.actorOperationsInProgress--;
      this.actorSemaphore.release();

      this.logger.error('[Actor Handler] Failed:', error);

      // Report failure back to server
      if (nativeModule.completeActorOperation) {
        await nativeModule.completeActorOperation(
          this.nativeService,
          work.operation_id ?? work.operationId,
          work.execution_id ?? work.executionId,
          new Uint8Array(0),
          false,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  /**
   * Run a workflow activation and convert the result to the shape sdk-core expects.
   *
   * Never throws: any failure is returned as an unsuccessful completion.
   */
  private async executeWorkflowDirectBindings(nativeRequest: any): Promise<any> {
    try {
      this.logger.debug(
        `[DIRECT-BINDINGS] Workflow request received: ${nativeRequest.run_id || nativeRequest.runId}`
      );

      // Convert the native request to an ExecutionRequest
      const request = this.convertNativeToServiceRequest(nativeRequest);

      const workflowDef = this.workflowMap.get(request.type);
      if (!workflowDef) {
        this.logger.error(`[DIRECT-BINDINGS] Workflow not registered: ${request.type}`);
        return {
          run_id: request.executionId,
          successful: false,
          commands: [],
          query_responses: [],
          update_results: [],
          error: {
            message: `Workflow not registered: ${request.type}`,
            error_type: 'WorkflowCode',
            // sdk-core's ExecutionError requires this; without it the payload
            // fails to parse and masks the message above with a JSON error.
            retryable: false,
          },
        };
      }

      await this.workflowSemaphore.acquire();
      this.stats.workflowsInProgress++;

      try {
        const result = await this.workflowExecutor.execute(workflowDef, request);
        this.stats.workflowsExecuted++;
        this.stats.workflowsInProgress--;
        this.workflowSemaphore.release();

        this.logger.debug(
          `[DIRECT-BINDINGS] Workflow completed: ${request.executionId}, commands: ${result.commands?.length || 0}`
        );

        // Convert TypeScript commands to Rust enum format
        // TypeScript: {type: "SCHEDULE_TASK", sequence: 0, taskId: "...", ...}
        // Rust: {"ScheduleTask": {sequence: 0, task_id: "...", ...}}
        const rustCommands = (result.commands || []).map((cmd: any) => {
          const cmdType = cmd.type;

          // Map TypeScript command type to Rust variant name
          const variantMap: Record<string, string> = {
            SCHEDULE_TASK: 'ScheduleTask',
            START_TIMER: 'StartTimer',
            CANCEL_TIMER: 'CancelTimer',
            COMPLETE_WORKFLOW: 'CompleteWorkflow',
            FAIL_WORKFLOW: 'FailWorkflow',
            RECORD_STEP_RESULT: 'RecordStepResult',
            WAIT_FOR_EVENT: 'WaitForEvent',
            START_CHILD_WORKFLOW: 'StartChildWorkflow',
            CANCEL_CHILD_WORKFLOW: 'CancelChildWorkflow',
            SEND_EVENT: 'SendEvent',
            RESTART_FRESH: 'RestartFresh',
          };

          const variantName = variantMap[cmdType] || cmdType;

          // An event to another workflow: the payload is the JSON encoding the
          // receiving workflow decodes, and any run of the target receives it.
          if (cmdType === 'SEND_EVENT') {
            return {
              SendEvent: {
                workflow_id: cmd.targetWorkflowId,
                run_id: null,
                event_name: cmd.eventName,
                payload: {
                  data: Array.from(new TextEncoder().encode(JSON.stringify(cmd.payload ?? null))),
                  metadata: {},
                },
                headers: [],
              },
            };
          }
          // The engine identifies the child by the id its parent gave it; the run
          // id is left empty because the child's run changes when it is retried.
          if (cmdType === 'CANCEL_CHILD_WORKFLOW') {
            return { CancelChildWorkflow: { workflow_id: cmd.workflowId, run_id: '' } };
          }
          // The workflow gave up on a cancellation request it was told of.
          if (cmdType === 'CANCEL_WORKFLOW') {
            return { CancelWorkflowExecution: { details: null } };
          }

          // Create command data with snake_case field names for Rust
          const cmdData: any = {};
          for (const [key, value] of Object.entries(cmd)) {
            if (key === 'type') continue; // Skip the type field
            // Convert camelCase to snake_case
            const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

            // Special handling for input field - Rust expects Vec<Payload>
            if (key === 'input') {
              // Convert input value(s) to Payload format
              const inputs = Array.isArray(value) ? value : [value];
              cmdData[snakeKey] = inputs.map((v) => {
                const payload = toPayload(v);
                // Convert Uint8Array to regular array for JSON serialization
                return {
                  data: Array.from(payload.data),
                  metadata: Object.fromEntries(
                    Object.entries(payload.metadata).map(([k, u]) => [k, Array.from(u)])
                  ),
                };
              });
            } else {
              cmdData[snakeKey] = value;
            }
          }

          // Add required fields with defaults for ScheduleTask command
          if (cmdType === 'SCHEDULE_TASK') {
            // sdk-core wants Durations as { secs, nanos }. The generic
            // camelCase→snake_case pass leaves millisecond numbers alone, so
            // anything set per-call has to be converted here or serde rejects
            // the whole batch and the task never reaches the engine.
            if (typeof cmdData.timeout === 'number') {
              cmdData.timeout = msToDuration(cmdData.timeout);
            }
            if (!cmdData.timeout) {
              cmdData.timeout = { secs: 300, nanos: 0 }; // 5 minutes default
            }
            // Declared heartbeat supervision, or none. `heartbeat_timeout` is
            // serde(default) in sdk-core, so null and absent both mean none.
            if (typeof cmdData.heartbeat_timeout_ms === 'number') {
              cmdData.heartbeat_timeout = msToDuration(cmdData.heartbeat_timeout_ms);
            } else {
              cmdData.heartbeat_timeout = null;
            }
            delete cmdData.heartbeat_timeout_ms;
            // The queue-wait limit is its own option, separate from `timeout`;
            // deriving it from `timeout` would double the effective total.
            if (typeof cmdData.queue_timeout_ms === 'number') {
              cmdData.queue_timeout = msToDuration(cmdData.queue_timeout_ms);
            } else {
              cmdData.queue_timeout = null;
            }
            delete cmdData.queue_timeout_ms;
            if (cmdData.retry_policy) {
              // The generic camelCase→snake_case conversion only touches top-level keys, so the
              // nested RetryPolicy (camelCase, ms intervals) must be converted to sdk-core's
              // shape here: snake_case fields with Duration { secs, nanos }.
              const rp = cmdData.retry_policy;
              const toDuration = (ms: number) => ({
                secs: Math.floor((ms ?? 0) / 1000),
                nanos: ((ms ?? 0) % 1000) * 1_000_000,
              });
              cmdData.retry_policy = {
                max_attempts: rp.maxAttempts ?? rp.max_attempts ?? 3,
                initial_interval: toDuration(rp.initialInterval ?? rp.initial_interval ?? 1000),
                max_interval: toDuration(rp.maxInterval ?? rp.max_interval ?? 60000),
                backoff_coefficient: rp.backoffCoefficient ?? rp.backoff_coefficient ?? 2.0,
                // `nonRetryableErrorTypes` is the typed field; the other two
                // spellings are accepted from untyped policies.
                non_retryable_errors:
                  rp.nonRetryableErrorTypes ??
                  rp.nonRetryableErrors ??
                  rp.non_retryable_errors ??
                  [],
              };
            } else {
              cmdData.retry_policy = null;
            }
            if (!cmdData.headers) {
              cmdData.headers = [];
            }
          }

          // sdk-core's StartTimerCommand expects `duration` as a std::time::Duration
          // ({ secs, nanos }), not `duration_ms`. Convert and drop the ms field, or
          // the native bridge rejects the batch and the timer never reaches the engine.
          if (cmdType === 'START_TIMER') {
            const ms = cmdData.duration_ms ?? 0;
            delete cmdData.duration_ms;
            cmdData.duration = {
              secs: Math.floor(ms / 1000),
              nanos: (ms % 1000) * 1_000_000,
            };
          }

          // sdk-core's StartChildWorkflowCommand expects `orphan_policy`
          // (OrphanPolicy: Terminate/Cancel/Abandon), not `parent_close_policy`
          // (ParentClosePolicy: TERMINATE/REQUEST_CANCEL/ABANDON). Map both the
          // field name and the value; default timeout to None.
          if (cmdType === 'START_CHILD_WORKFLOW') {
            const policyMap: Record<string, string> = {
              TERMINATE: 'Terminate',
              REQUEST_CANCEL: 'Cancel',
              ABANDON: 'Abandon',
            };
            const pcp = cmdData.parent_close_policy;
            delete cmdData.parent_close_policy;
            cmdData.orphan_policy = policyMap[pcp] ?? 'Cancel';
            // A Duration, like the task timeout above; milliseconds would make
            // serde reject the batch.
            cmdData.timeout =
              typeof cmdData.timeout === 'number' ? msToDuration(cmdData.timeout) : null;
          }

          // sdk-core's RecordStepResultCommand carries the result as bytes (the
          // JSON encoding, as the journal returns it on replay) and the attempt
          // that produced it. A bare value fails to deserialize, and the whole
          // activation with it.
          if (cmdType === 'RECORD_STEP_RESULT') {
            cmdData.result = Array.from(
              new TextEncoder().encode(JSON.stringify(cmdData.result ?? null))
            );
            cmdData.failure = null;
            cmdData.execution_attempt = 1;
            // The step's number is already in its name; the command has no field for it.
            delete cmdData.sequence;
          }

          // sdk-core's RestartFreshCommand requires workflow_type (a String —
          // "" means "restart as the same type"); task_queue/timeout are
          // optional. The generic conversion drops undefined fields, so default
          // the required ones to present values.
          if (cmdType === 'RESTART_FRESH') {
            if (cmdData.workflow_type === undefined || cmdData.workflow_type === null) {
              cmdData.workflow_type = '';
            }
            if (cmdData.task_queue === undefined) {
              cmdData.task_queue = null;
            }
            // Milliseconds on the command, a Duration for sdk-core.
            cmdData.timeout =
              typeof cmdData.timeout === 'number' ? msToDuration(cmdData.timeout) : null;
          }

          // Return in Rust enum format
          return { [variantName]: cmdData };
        });

        // Process query and update jobs from the execution request
        const queryResponses = this.processQueryJobs(nativeRequest, result.context);
        const updateResults = await this.processUpdateJobs(nativeRequest, result.context);

        // Convert TypeScript ExecutionResult to bridge format for Rust
        // TypeScript uses: {executionId, success, result, commands, error}
        // Rust expects: {run_id, successful, commands, error} (snake_case)
        return {
          run_id: result.executionId,
          successful: result.success,
          commands: rustCommands,
          query_responses: queryResponses,
          update_results: updateResults,
          // The steps the code reached, so sdk-core can tell code that no
          // longer replays the run; an sdk-core that predates the field
          // ignores it.
          reached_steps: result.reachedSteps,
          error: result.error
            ? {
                message: result.error.message || 'Unknown error',
                error_type: toExecutionErrorType(result.error.type),
                retryable: false,
              }
            : undefined,
        };
      } catch (error) {
        this.stats.errors++;
        this.stats.workflowsInProgress--;
        this.workflowSemaphore.release();
        throw error;
      }
    } catch (error) {
      this.logger.error('[DIRECT-BINDINGS] Workflow execution error:', error);
      return {
        run_id: nativeRequest.run_id || nativeRequest.runId || 'unknown',
        successful: false,
        commands: [],
        query_responses: [],
        update_results: [],
        error: {
          message: error instanceof Error ? error.message : String(error),
          error_type: 'WorkflowCode',
          retryable: false,
        },
      };
    }
  }

  /**
   * How a task's heartbeats reach the native worker, which heartbeats every
   * task on its own. Undefined when the native module does not provide task
   * heartbeats.
   */
  private taskHeartbeatBinding(taskToken: string | undefined): TaskHeartbeatBinding | undefined {
    const nativeModule = getNativeModule();
    const svc = this.nativeService;
    const heartbeatTask = nativeModule.heartbeatTask?.bind(nativeModule);
    const waitTaskCancelled = nativeModule.waitTaskCancelled?.bind(nativeModule);
    if (!taskToken || !svc || !heartbeatTask || !waitTaskCancelled) {
      return undefined;
    }
    return {
      record: async (details?: unknown) => {
        const answer = await heartbeatTask(
          svc,
          taskToken,
          details === undefined ? undefined : JSON.stringify(details)
        );
        const parsed = typeof answer === 'string' ? JSON.parse(answer) : answer;
        return parsed?.cancelRequested === true;
      },
      cancelled: async () => (await waitTaskCancelled(svc, taskToken)) === true,
    };
  }

  /**
   * Run a task and return a task-shaped result.
   *
   * Never throws: any failure is returned as `successful: false` with an `error`.
   */
  private async executeTaskDirectBindings(nativeRequest: any): Promise<any> {
    try {
      this.logger.debug(
        `[DIRECT-BINDINGS] Task request received: ${nativeRequest.run_id || nativeRequest.runId}`
      );

      // Convert the native request to an ExecutionRequest
      const request = this.convertNativeToServiceTaskRequest(nativeRequest);

      const taskDef = this.taskMap.get(request.type);
      if (!taskDef) {
        this.logger.error(`[DIRECT-BINDINGS] Task not registered: ${request.type}`);
        return {
          successful: false,
          output: undefined,
          error: {
            message: `Task not registered: ${request.type}`,
            error_type: 'WorkflowCode',
          },
        };
      }

      await this.taskSemaphore.acquire();
      this.stats.tasksInProgress++;

      try {
        // Execute task, its heartbeats going to the native worker
        const result = await this.taskExecutor.execute(
          taskDef,
          request,
          this.taskHeartbeatBinding(nativeRequest.task_token)
        );
        this.stats.tasksExecuted++;
        this.stats.tasksInProgress--;
        this.taskSemaphore.release();

        this.logger.debug(`[DIRECT-BINDINGS] Task completed: ${request.executionId}`);

        // Return a task-shaped result. On success the caller sends only `output` to
        // completeTask, so the workflow receives the task's real return value rather
        // than the execution envelope. On failure it reports `error` via failTask.
        return {
          successful: result.success,
          output: result.success ? result.result : undefined,
          error: result.success
            ? null
            : {
                message: result.error?.message || 'Unknown error',
                error_type: 'WorkflowCode',
                // What the engine's retry decision reads.
                type: result.error?.type,
                nonRetryable: result.error?.nonRetryable === true,
              },
        };
      } catch (error) {
        this.stats.errors++;
        this.stats.tasksInProgress--;
        this.taskSemaphore.release();
        throw error;
      }
    } catch (error) {
      this.logger.error('[DIRECT-BINDINGS] Task execution error:', error);
      return {
        successful: false,
        output: undefined,
        error: {
          message: error instanceof Error ? error.message : String(error),
          error_type: 'WorkflowCode',
        },
      };
    }
  }

  /**
   * Process ProcessQuery jobs from the execution request.
   *
   * Dispatches each query to the registered handler (via GlobalRegistry @Query()
   * decorator or WorkflowContext manual registration) and returns query responses
   * in the bridge format expected by Rust.
   */
  private processQueryJobs(nativeRequest: any, context: any): any[] {
    const queryResponses: any[] = [];
    if (!nativeRequest.jobs || !Array.isArray(nativeRequest.jobs)) {
      return queryResponses;
    }

    for (const job of nativeRequest.jobs) {
      const queryJob = job.ProcessQuery || (job.jobType === 'ProcessQuery' ? job : null);
      if (!queryJob) continue;

      const queryId = queryJob.query_id || queryJob.queryId || '';
      const queryType = queryJob.query_type || queryJob.queryType || '';

      try {
        let result: any;

        // Try GlobalRegistry @Query() decorator first
        const queryMeta = diGlobalRegistry.getQuery(queryType);
        if (queryMeta) {
          const instance = this.container.resolve(queryMeta.handlerClass);
          result = instance[queryMeta.methodName]();
        }
        // Fall back to WorkflowContext manual handler
        else if (context && context.hasQueryHandler && context.hasQueryHandler(queryType)) {
          result = context.executeQuery(queryType);
        } else {
          queryResponses.push({
            query_id: queryId,
            result: { Failed: { message: `No handler registered for query '${queryType}'` } },
          });
          continue;
        }

        // Serialize result to Payload format for Rust bridge
        const payload = toPayload(result);
        const output = {
          data: Array.from(payload.data),
          metadata: Object.fromEntries(
            Object.entries(payload.metadata).map(([k, v]) => [k, Array.from(v as Uint8Array)])
          ),
        };

        queryResponses.push({
          query_id: queryId,
          result: { Success: { output } },
        });
      } catch (err) {
        queryResponses.push({
          query_id: queryId,
          result: {
            Failed: { message: err instanceof Error ? err.message : String(err) },
          },
        });
      }
    }

    return queryResponses;
  }

  /**
   * Process UpdateState jobs from the execution request.
   *
   * Dispatches each update to the registered handler (via GlobalRegistry @Update()
   * decorator) and returns update responses in the bridge format expected by Rust.
   */
  private async processUpdateJobs(nativeRequest: any, context: any): Promise<any[]> {
    const updateResults: any[] = [];
    if (!nativeRequest.jobs || !Array.isArray(nativeRequest.jobs)) {
      return updateResults;
    }

    for (const job of nativeRequest.jobs) {
      const updateJob = job.UpdateState || (job.jobType === 'UpdateState' ? job : null);
      if (!updateJob) continue;

      const updateId = updateJob.update_id || updateJob.updateId || '';
      // sdk-core names the update `update_name`.
      const updateType =
        updateJob.update_name ||
        updateJob.updateName ||
        updateJob.update_type ||
        updateJob.updateType ||
        '';

      try {
        const updateMeta = diGlobalRegistry.getUpdate(updateType);
        if (!updateMeta) {
          updateResults.push({
            update_id: updateId,
            result: { Rejected: { message: `No handler registered for update '${updateType}'` } },
          });
          continue;
        }

        // A handler takes the activation's context and the client's argument,
        // as `@Update` documents; the argument arrives as its JSON encoding.
        const instance = this.container.resolve(updateMeta.handlerClass);
        const data: number[] | undefined = updateJob.payload?.data;
        const input =
          Array.isArray(data) && data.length > 0
            ? JSON.parse(new TextDecoder().decode(new Uint8Array(data)))
            : undefined;
        const result = await instance[updateMeta.methodName](context, input);

        // Serialize result to Payload format for Rust bridge
        const payload = toPayload(result);
        const output = {
          data: Array.from(payload.data),
          metadata: Object.fromEntries(
            Object.entries(payload.metadata).map(([k, v]) => [k, Array.from(v as Uint8Array)])
          ),
        };

        updateResults.push({
          update_id: updateId,
          result: { Completed: { output } },
        });
      } catch (err) {
        updateResults.push({
          update_id: updateId,
          result: {
            Failed: { message: err instanceof Error ? err.message : String(err) },
          },
        });
      }
    }

    return updateResults;
  }

  /**
   * Convert native ExecutionRequest format to service ExecutionRequest format
   *
   * This bridges the gap between Rust's ExecutionRequest and TypeScript's ExecutionRequest
   */
  private convertNativeToServiceRequest(nativeRequest: any): ExecutionRequest {
    this.logger.debug('[CONVERT] Native request:', JSON.stringify(nativeRequest, null, 2));

    // Extract workflow info from the StartWorkflow job
    let workflowType = 'unknown';
    let input: any = [];
    let attempt = 1;

    if (nativeRequest.jobs && Array.isArray(nativeRequest.jobs)) {
      this.logger.debug(`[CONVERT] Found ${nativeRequest.jobs.length} jobs`);
      this.logger.debug('[CONVERT] All jobs:', JSON.stringify(nativeRequest.jobs, null, 2));

      // Support both flat structure (from sdk-core driver) and tagged union structure
      // Flat: { jobType: 'StartWorkflow', workflowType: '...', input: ... }
      // Tagged: { StartWorkflow: { workflow_type: '...', input: ... } }
      const startWorkflowJob = nativeRequest.jobs.find(
        (job: any) => job.jobType === 'StartWorkflow' || job.StartWorkflow
      );
      this.logger.debug('[CONVERT] StartWorkflow job:', JSON.stringify(startWorkflowJob, null, 2));

      if (startWorkflowJob) {
        // Handle flat structure from sdk-core driver
        if (startWorkflowJob.jobType === 'StartWorkflow') {
          workflowType =
            startWorkflowJob.workflowType || startWorkflowJob.workflow_type || 'unknown';

          this.logger.debug(
            `[CONVERT] Input type: ${typeof startWorkflowJob.input}, value:`,
            startWorkflowJob.input
          );

          // Input is already a proper JavaScript value from Rust
          input =
            startWorkflowJob.input !== undefined && startWorkflowJob.input !== null
              ? startWorkflowJob.input
              : [];
          this.logger.debug('[CONVERT] Using input as JavaScript value:', input);

          attempt = startWorkflowJob.attempt || 1;
        }
        // Handle tagged union structure
        else if (startWorkflowJob.StartWorkflow) {
          const startWorkflow = startWorkflowJob.StartWorkflow;
          workflowType = startWorkflow.workflow_type || 'unknown';

          this.logger.debug(
            `[CONVERT] Input type: ${typeof startWorkflow.input}, value:`,
            startWorkflow.input
          );

          // Input is already a proper JavaScript value from Rust
          input =
            startWorkflow.input !== undefined && startWorkflow.input !== null
              ? startWorkflow.input
              : [];
          this.logger.debug('[CONVERT] Using input as JavaScript value:', input);

          attempt = startWorkflow.attempt || 1;
        }
      } else {
        this.logger.warn('[CONVERT] No StartWorkflow job data found');
      }
    } else {
      this.logger.warn('[CONVERT] No jobs array in native request');
    }

    const executionId = nativeRequest.run_id || nativeRequest.runId || 'unknown';
    const workflowId =
      nativeRequest.execution?.workflow_id || nativeRequest.workflow_id || executionId;
    const runId = nativeRequest.execution?.run_id || nativeRequest.run_id || executionId;

    // When the engine journaled what this activation hands the workflow. The
    // jobs carry no times, so the native layer reads them from the journal.
    const nativeTimes = nativeRequest.journal_times;
    const journalTimes: JournalTimes | undefined = nativeTimes
      ? {
          startedAtMs:
            typeof nativeTimes.started_at_ms === 'number' ? nativeTimes.started_at_ms : undefined,
          resolvedAt: nativeTimes.resolved_at ?? {},
          cancelRequestedAt:
            typeof nativeTimes.cancel_requested_at === 'number'
              ? nativeTimes.cancel_requested_at
              : undefined,
        }
      : undefined;
    // A request to cancel the workflow. It is told at its first wait whose result
    // the journal did not record before the request, by the journal's times: the
    // engine adds step results after the journal's own entries, so where a job
    // sits says nothing about when it happened.
    const cancelRequested = ((nativeRequest.jobs as any[] | undefined) ?? []).some(
      (job: any) => job?.CancelWorkflow !== undefined || job?.type === 'CancelWorkflow'
    );
    // The n-th event of a name is the n-th journaled under it.
    const eventTimes = new Map<string, number[]>(
      Object.entries((nativeTimes?.events ?? {}) as Record<string, number[]>).map(
        ([name, times]) => [name, [...times]]
      )
    );

    // Extract cached step results (for replay)
    const cachedStepResults: any[] = [];
    const bufferedEvents: Array<{
      eventName: string;
      payload: any;
      position: number;
      atMs?: number;
    }> = [];
    if (nativeRequest.jobs && Array.isArray(nativeRequest.jobs)) {
      // Jobs arrive in journal order; the index is what lets a wait with a
      // timeout tell whether its event or its deadline came first.
      for (const [position, job] of (nativeRequest.jobs as any[]).entries()) {
        // Handle HandleEvent jobs (signals delivered via SendEvent)
        const isHandleEvent = job.type === 'HandleEvent' || job.HandleEvent;
        if (isHandleEvent) {
          const evt = job.HandleEvent || job;
          const eventName = evt.event_name || evt.eventName || '';
          const payloadData = evt.payload?.data || [];
          let payload: any = null;
          if (payloadData.length > 0) {
            try {
              const decoded = new TextDecoder().decode(new Uint8Array(payloadData));
              payload = JSON.parse(decoded);
            } catch {
              payload = null;
            }
          }
          if (eventName) {
            bufferedEvents.push({
              eventName,
              payload,
              position,
              atMs: eventTimes.get(eventName)?.shift(),
            });
          }
        }

        // Support both flat structure (jobType) and tagged union structure (CompleteStep)
        const isCompleteStep = job.jobType === 'CompleteStep' || job.CompleteStep;
        if (isCompleteStep) {
          const step = job.CompleteStep || job; // Flat structure uses job directly
          try {
            let result: any = null;
            const stepFailure = step.failure;
            if (stepFailure) {
              // Terminal task/step failure: inject a sentinel keyed by step name so the
              // workflow decodes it on replay and throws instead of treating it as success.
              result = {
                [TASK_FAILED_SENTINEL_KEY]: true,
                message: stepFailure.message ?? 'Task failed',
                error_type:
                  stepFailure.failure_type ?? stepFailure.errorType ?? stepFailure.error_type ?? '',
                // How many times the task actually ran, as the engine reports on
                // the step. Without it the workflow's decode falls back to 1, and a
                // task that ran three times reports one attempt.
                attempts: step.execution_attempt ?? step.executionAttempt,
              };
            } else {
              const stepResult = step.result;
              // Handle both array of bytes and direct result object
              if (stepResult) {
                if (Array.isArray(stepResult) && stepResult.length > 0) {
                  const resultStr = new TextDecoder().decode(new Uint8Array(stepResult));
                  result = JSON.parse(resultStr);
                } else if (typeof stepResult === 'object') {
                  result = stepResult;
                }
              }
            }

            cachedStepResults.push({
              stepId: step.step_name || step.stepName,
              stepType: step.step_type || step.stepType || 2,
              result,
            });
          } catch (error) {
            this.logger.warn(
              `Failed to parse cached step result for ${step.step_name || step.stepName}:`,
              error
            );
          }
        }

        // Handle CompleteTask jobs (distributed task results)
        // Support both flat structure (jobType) and tagged union structure (CompleteTask)
        const isCompleteTask = job.jobType === 'CompleteTask' || job.CompleteTask;
        if (isCompleteTask) {
          const task = job.CompleteTask || job; // Flat structure uses job directly
          try {
            let result: any = null;
            // Handle flat structure result
            if (task.result) {
              if (task.result.success !== undefined) {
                // Flat structure: { success: true, output: ... }
                result = task.result.output;
              } else if (task.result?.Success?.output) {
                // Tagged structure: { Success: { output: { data: [...] } } }
                const output = task.result.Success.output;
                if (output.data && Array.isArray(output.data) && output.data.length > 0) {
                  const resultStr = new TextDecoder().decode(new Uint8Array(output.data));
                  result = JSON.parse(resultStr);
                }
              }
            }

            cachedStepResults.push({
              stepId: task.task_id || task.taskId,
              stepType: 1,
              result,
              failed: task.result?.Failed !== undefined || task.result?.success === false,
              executionAttempt: task.sequence || 1,
            });
          } catch (error) {
            this.logger.warn(
              `Failed to parse CompleteTask result for ${task.task_id || task.taskId}:`,
              error
            );
          }
        }

        // Handle ChildWorkflowCompleted jobs (child workflow results). Inject the
        // child's result under `child:{workflowId}` — the key executeChildWorkflow
        // checks on replay — mirroring the CompleteTask path above.
        const isChildCompleted =
          job.jobType === 'ChildWorkflowCompleted' || job.ChildWorkflowCompleted;
        if (isChildCompleted) {
          const child = job.ChildWorkflowCompleted || job;
          const childId =
            child.child_workflow_id ||
            child.childWorkflowId ||
            child.workflow_id ||
            child.workflowId;
          try {
            let result: any = null;
            const data = child.result?.data;
            if (Array.isArray(data) && data.length > 0) {
              result = JSON.parse(new TextDecoder().decode(new Uint8Array(data)));
            }
            cachedStepResults.push({
              stepId: `child:${childId}`,
              stepType: 3,
              result,
              failed: false,
              executionAttempt: 1,
            });
          } catch (error) {
            this.logger.warn(
              `Failed to parse ChildWorkflowCompleted result for ${childId}:`,
              error
            );
          }
        }

        // Handle ChildWorkflowFailed jobs. Inject a failure sentinel (not a
        // failed step — the injector skips those); executeChildWorkflow decodes
        // it on replay and throws ChildWorkflowFailedError, mirroring how a
        // task failure is surfaced.
        const isChildFailed = job.jobType === 'ChildWorkflowFailed' || job.ChildWorkflowFailed;
        if (isChildFailed) {
          const child = job.ChildWorkflowFailed || job;
          const childId =
            child.child_workflow_id ||
            child.childWorkflowId ||
            child.workflow_id ||
            child.workflowId;
          const failure = child.failure ?? {};
          const message =
            (typeof failure === 'object' ? failure.message : undefined) ||
            child.failure_reason ||
            (typeof failure === 'string' ? failure : undefined) ||
            'Child workflow failed';
          cachedStepResults.push({
            stepId: `child:${childId}`,
            stepType: 3,
            result: { __orcher_child_failed__: true, message },
            failed: false,
            executionAttempt: 1,
          });
        }

        // A child that ended without a result failed as far as its parent is
        // concerned: result() throws ChildWorkflowFailedError with the reason.
        // Without these the parent would wait on the child forever.
        const childEnded =
          job.ChildWorkflowCanceled ?? job.ChildWorkflowTerminated ?? job.ChildWorkflowTimedOut;
        if (childEnded) {
          const childId = childEnded.workflow_id || childEnded.workflowId;
          let message: string;
          if (job.ChildWorkflowCanceled) {
            message = 'child workflow was canceled';
          } else if (job.ChildWorkflowTerminated) {
            message = childEnded.reason
              ? `child workflow was terminated: ${childEnded.reason}`
              : 'child workflow was terminated';
          } else {
            message = 'child workflow timed out';
          }
          cachedStepResults.push({
            stepId: `child:${childId}`,
            stepType: 3,
            result: { __orcher_child_failed__: true, message },
            failed: false,
            executionAttempt: 1,
          });
        }

        // Handle FireTimer jobs (a durable timer fired). Inject a truthy marker
        // under `timer:{id}` — the key sleep()/sleepWithId() check on replay —
        // so the timer call returns instead of re-emitting StartTimer. The
        // marker carries the job's journal position for waits with a timeout.
        const isFireTimer = job.jobType === 'FireTimer' || job.FireTimer;
        if (isFireTimer) {
          const timer = job.FireTimer || job;
          const timerId = timer.timer_id || timer.timerId;
          if (timerId) {
            cachedStepResults.push({
              stepId: `timer:${timerId}`,
              stepType: 1,
              result: { firedAt: position },
              failed: false,
              executionAttempt: 1,
            });
          }
        }
      }
    }

    return {
      executionId,
      type: workflowType,
      input,
      metadata: {
        workflowId,
        runId,
        attempt,
        namespace: this.options.namespace,
        taskQueue: this.options.taskQueue,
      },
      cachedStepResults,
      bufferedEvents,
      journalTimes,
      cancelRequested,
    };
  }

  /**
   * Convert native task ExecutionRequest format to service ExecutionRequest format
   *
   * This bridges the gap between Rust's ExecutionRequest and TypeScript's ExecutionRequest for tasks
   *
   * Supports two formats:
   * 1. Flat structure from sdk-core: { taskType: 'myTask', task_type: 'myTask', input: {...}, ... }
   * 2. Tagged union structure: { jobs: [{ ExecuteTask: { task_type: '...', ... } }] }
   */
  private convertNativeToServiceTaskRequest(nativeRequest: any): ExecutionRequest {
    // Extract task info
    let taskType = 'unknown';
    let input: any = [];
    let attempt = 1;
    let timeout: number | undefined;

    // First, try flat structure from sdk-core driver (direct fields on the request)
    // sdk-core sends: { taskType, task_type, type, taskId, input, attempt, ... }
    if (nativeRequest.taskType || nativeRequest.task_type || nativeRequest.type) {
      taskType =
        nativeRequest.taskType || nativeRequest.task_type || nativeRequest.type || 'unknown';
      input = nativeRequest.input !== undefined ? nativeRequest.input : [];
      attempt = nativeRequest.attempt || 1;

      // Extract timeout if present
      if (nativeRequest.timeout) {
        const timeoutSecs = nativeRequest.timeout.secs || nativeRequest.timeout;
        const timeoutNanos = nativeRequest.timeout.nanos || 0;
        timeout =
          typeof timeoutSecs === 'number'
            ? timeoutSecs * 1000 + Math.floor(timeoutNanos / 1000000)
            : undefined;
      }
    }
    // Fall back to jobs array (tagged union structure)
    else if (nativeRequest.jobs && Array.isArray(nativeRequest.jobs)) {
      const executeTaskJob = nativeRequest.jobs.find(
        (job: any) => job.ExecuteTask || job.ScheduleTask
      );

      if (executeTaskJob) {
        const taskJob = executeTaskJob.ExecuteTask || executeTaskJob.ScheduleTask;
        taskType = taskJob.task_type || 'unknown';
        input = taskJob.input !== undefined ? taskJob.input : [];
        attempt = taskJob.attempt || 1;

        // Extract timeout if present
        if (taskJob.timeout) {
          const timeoutSecs = taskJob.timeout.secs || 0;
          const timeoutNanos = taskJob.timeout.nanos || 0;
          timeout = timeoutSecs * 1000 + Math.floor(timeoutNanos / 1000000);
        }
      }
    }

    const executionId =
      nativeRequest.run_id || nativeRequest.runId || nativeRequest.executionId || 'unknown';
    const workflowId =
      nativeRequest.execution?.workflow_id ||
      nativeRequest.workflow_id ||
      nativeRequest.workflowId ||
      executionId;
    const runId =
      nativeRequest.execution?.run_id || nativeRequest.run_id || nativeRequest.runId || executionId;

    return {
      executionId,
      type: taskType,
      input,
      metadata: {
        workflowId,
        runId,
        attempt,
        namespace: this.options.namespace,
        taskQueue: this.options.taskQueue,
        timeout,
        // The heartbeat interval the engine will judge this task by. Carried so
        // the handler can pace itself; `ctx.heartbeatTimeout()` reads it.
        heartbeatTimeoutMs:
          typeof nativeRequest.heartbeat_timeout_ms === 'number'
            ? nativeRequest.heartbeat_timeout_ms
            : undefined,
      },
      cachedStepResults: [],
    };
  }

  /**
   * Run the shutdown sequence described on {@link Worker.shutdown}.
   */
  private async performShutdown(options?: ShutdownOptions): Promise<void> {
    const force = options?.force ?? false;
    const timeout = durationToMillis(options?.timeout ?? this.options.shutdownGraceTime ?? 30000);

    this.logger.info(`Shutting down service (force=${force}, timeout=${timeout}ms)...`);
    this.state = force ? WorkerState.FORCE_SHUTDOWN : WorkerState.SHUTTING_DOWN;

    try {
      // Tell the workflow and task drivers first, so they start no new polls.
      // They still hand over what the polls they already had out bring back,
      // which is why the workflow and task polling loops keep running below.
      if (this.nativeService) {
        getNativeModule().serviceRequestShutdown?.(this.nativeService);
      }

      // Signal the actor polling loops to stop
      this.pullModelShutdown = true;

      if (force) {
        this.driverPollingStopped = true;
      } else {
        await this.waitForInFlightExecutions(timeout);
      }

      // Shutdown native service (stops sdk-core drivers). This returns once
      // the workflow and task drivers have stopped, having run whatever they
      // handed over meanwhile; only then do those polling loops stop.
      let slotsClosed = false;
      if (this.nativeService) {
        const nativeModule = getNativeModule();
        if (nativeModule.serviceShutdown) {
          this.logger.debug('Shutting down native service...');
          await nativeModule.serviceShutdown(this.nativeService);
          slotsClosed = true;
        }
        this.nativeService = null;
      }
      this.driverPollingStopped = true;
      if (slotsClosed) {
        // They see their channels closed at once. Bounded all the same, so a
        // poll that never answers cannot hold shutdown up.
        await this.settleWithin(this.driverPollingLoops, DRIVER_POLLER_STOP_TIMEOUT_MS);
      }
      this.driverPollingLoops = [];

      // Dispose DI container (cleanup resources, call lifecycle hooks). After
      // the native shutdown, since workflow activations run until then and
      // their queries and updates resolve handlers from it.
      this.logger.debug('Disposing DI container...');
      await this.container.dispose();

      if (this.pollerServiceHandles.length > 0) {
        this.logger.debug(
          `Cleaning up ${this.pollerServiceHandles.length} per-poller service handles...`
        );
        // The native module has no explicit close; dropping the handles lets them
        // be garbage collected.
        this.pollerServiceHandles = [];
        this.logger.debug('Per-poller service handles cleaned up');
      }

      // Close client connection
      if (this.client) {
        this.client.close();
        this.client = null;
      }

      this.state = WorkerState.STOPPED;
      this.stopTime = new Date();

      this.logger.info('Service shutdown complete');
      this.emit('stopped');
    } catch (error) {
      this.logger.error('Error during shutdown:', error);
      this.emit('error', error);
      throw error;
    } finally {
      this.driverPollingStopped = true;
      this.shutdownPromise = null;
    }
  }

  /**
   * Wait for `promises` to settle, or for `ms` to pass, whichever is first.
   */
  private async settleWithin(promises: Promise<unknown>[], ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const elapsed = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
      timer.unref?.();
    });
    try {
      await Promise.race([Promise.allSettled(promises), elapsed]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Wait for in-flight executions to complete
   */
  private async waitForInFlightExecutions(timeout: number): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 100;

    this.logger.info(
      `Waiting for ${this.stats.workflowsInProgress + this.stats.tasksInProgress} in-flight executions...`
    );

    while (this.stats.workflowsInProgress > 0 || this.stats.tasksInProgress > 0) {
      const elapsed = Date.now() - startTime;

      if (elapsed >= timeout) {
        this.logger.warn(
          `Shutdown timeout reached with ${this.stats.workflowsInProgress + this.stats.tasksInProgress} executions still in progress`
        );
        break;
      }

      await this.sleep(checkInterval);
    }

    const elapsed = Date.now() - startTime;
    this.logger.info(`All in-flight executions completed in ${elapsed}ms`);
  }

  /**
   * Emit an event
   */
  private emit(event: ServiceEvent, ...args: any[]): void {
    this.eventEmitter.emit(event, ...args);
  }

  /**
   * Get worker uptime in milliseconds
   */
  private getUptime(): number {
    if (!this.startTime) {
      return 0;
    }

    const endTime = this.stopTime ?? new Date();
    return endTime.getTime() - this.startTime.getTime();
  }

  /**
   * Determine health status from the current state and error rate
   */
  private determineHealthStatus(): 'healthy' | 'degraded' | 'unhealthy' {
    if (this.state === WorkerState.RUNNING) {
      // Check if error rate is high
      const totalExecutions = this.stats.workflowsExecuted + this.stats.tasksExecuted;
      if (totalExecutions > 0) {
        const errorRate = this.stats.errors / totalExecutions;
        if (errorRate > 0.5) {
          return 'unhealthy';
        }
        if (errorRate > 0.1) {
          return 'degraded';
        }
      }
      return 'healthy';
    }

    if (this.state === WorkerState.SHUTTING_DOWN) {
      return 'degraded';
    }

    return 'unhealthy';
  }

  /**
   * Calculate CPU percentage
   */
  private calculateCpuPercentage(cpuUsage: NodeJS.CpuUsage): number {
    // Simple approximation
    const totalCpu = cpuUsage.user + cpuUsage.system;
    const totalTime = this.getUptime() * 1000; // Convert to microseconds
    if (totalTime === 0) {
      return 0;
    }
    return Math.min(100, (totalCpu / totalTime) * 100);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Accept either registration shape for `WorkerOptions.workflows`.
   *
   * The runtime looks handlers up by `entry.name`, the shape
   * `convertDIWorkflowsToDefinitions()` builds: a callable carrying `name`. The
   * public `workflow()` factory returns a `WorkflowReference`
   * (`{ workflowName, workflowClass }`), which has no `name`. Registered as-is,
   * it would sit under `undefined`, every activation would fail to find it, and
   * the run would end with an unparseable completion rather than a useful error.
   *
   * A reference resolves through the registry, because `workflow()` already
   * registered itself there; that keeps one construction path for both.
   */
  private normalizeWorkflowEntries(provided: any[]): any[] {
    const byName = new Map<string, any>(
      this.convertDIWorkflowsToDefinitions().map((d: any) => [d.name, d])
    );
    return provided.map((entry: any) => {
      if (typeof entry === 'function' && entry.name) return entry;
      const name = entry?.workflowName ?? entry?.name;
      const resolved = name ? byName.get(name) : undefined;
      if (resolved) return resolved;
      throw new WorkerError(
        `Cannot register workflow ${name ? `'${name}'` : '(unnamed entry)'}: pass the value ` +
          `returned by workflow({ name, run }) or a @Workflow class. Received: ${typeof entry}`
      );
    });
  }

  /**
   * Accept either registration shape for `WorkerOptions.tasks`.
   * Mirrors {@link normalizeWorkflowEntries}; `task()` returns a `TaskReference`
   * (`{ taskName, handlerClass, methodName }`), which likewise carries no `name`.
   */
  private normalizeTaskEntries(provided: any[]): any[] {
    const byName = new Map<string, any>(
      this.convertDITasksToDefinitions().map((d: any) => [d.name, d])
    );
    return provided.map((entry: any) => {
      if (typeof entry === 'function' && entry.name) return entry;
      const name = entry?.taskName ?? entry?.name;
      const resolved = name ? byName.get(name) : undefined;
      if (resolved) return resolved;
      throw new WorkerError(
        `Cannot register task ${name ? `'${name}'` : '(unnamed entry)'}: pass the value ` +
          `returned by task({ name, execute }) or a @Task method. Received: ${typeof entry}`
      );
    });
  }

  /**
   * Convert DI workflows from the GlobalRegistry to workflow functions.
   */
  private convertDIWorkflowsToDefinitions(): any[] {
    const diWorkflows = diGlobalRegistry.getAllWorkflows();
    const definitions: any[] = [];

    for (const [workflowName, metadata] of diWorkflows) {
      const workflowFn = async (ctx: any, ...args: any[]) => {
        // Create workflow instance from class (no DI for workflows - they must be deterministic)
        const WorkflowClass = metadata.workflowClass;
        const instance = new WorkflowClass();

        if (typeof instance.run === 'function') {
          return await instance.run(ctx, ...args);
        }
        throw new Error(`Workflow ${workflowName} does not have a run() method`);
      };

      // The worker looks definitions up by name; defineProperty is needed because
      // a function's `name` is read-only.
      Object.defineProperty(workflowFn, 'name', {
        value: workflowName,
        writable: false,
        configurable: true,
      });
      Object.defineProperty(workflowFn, 'metadata', {
        value: {
          name: workflowName,
          version: metadata.version || '1.0',
        },
        writable: false,
        configurable: true,
      });

      definitions.push(workflowFn);
    }

    return definitions;
  }

  /**
   * Convert DI tasks from the GlobalRegistry to task functions.
   */
  private convertDITasksToDefinitions(): any[] {
    const diTasks = diGlobalRegistry.getAllTasks();
    const definitions: any[] = [];

    for (const [taskName, metadata] of diTasks) {
      const taskFn = async (ctx: any, ...args: any[]) => {
        // Resolve task handler instance from DI container
        const HandlerClass = metadata.handlerClass;
        const instance = this.container.resolve(HandlerClass);

        const method = instance[metadata.methodName];
        if (typeof method === 'function') {
          return await method.call(instance, ctx, ...args);
        }
        throw new Error(`Task ${taskName} method ${metadata.methodName} not found`);
      };

      // The worker looks definitions up by name; defineProperty is needed because
      // a function's `name` is read-only.
      Object.defineProperty(taskFn, 'name', {
        value: taskName,
        writable: false,
        configurable: true,
      });
      Object.defineProperty(taskFn, 'metadata', {
        value: {
          name: taskName,
        },
        writable: false,
        configurable: true,
      });

      definitions.push(taskFn);
    }

    return definitions;
  }
}
