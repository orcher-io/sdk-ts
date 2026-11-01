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
import type { ClientConfig, HostConfig, HostRegistrations, NativeHostHandle } from '../core/types';
import { OrcherContainer } from '../di/container';
import { globalRegistry as diGlobalRegistry } from '../di/registry';
import { getWorkflowName } from '../di/decorators/workflow';
import { getAllTaskReferences } from '../di/decorators/task';
import { isTaskHandler } from '../di/decorators/tasks';

import { ActorExecutor } from './actor-executor';
import type { ActorStateClient } from '../actor/context';
import { WorkerError, describeTaskFailure } from './errors';
import { Semaphore } from './semaphore';
import { WorkerBuilder } from './worker-builder';
import { TaskExecutor, type TaskHeartbeatBinding } from './task-executor';
import {
  WorkerState,
  type WorkerOptions,
  type WorkerStats,
  type WireMetrics,
  type MethodStats,
  type ShutdownOptions,
  type WorkerIdentity,
  type WorkerCapabilities,
  type WorkerMetadata,
  type WorkerHealth,
  type ServiceEvent,
  type ServiceEventHandler,
  type Logger,
  type ExecutionRequest,
  type WorkflowDefinition,
  type TaskDefinition,
} from './types';
import { WorkflowExecutor } from './workflow-executor';
import {
  answerActivation,
  loadActivation,
  protocolError,
  type AskedQuery,
  type AskedUpdate,
  type HandlerQueryResponse,
  type HandlerUpdateResponse,
  type LoadedActivation,
} from './activation';
import { FailureCode, RunActivation, RunActivationResult } from '../core/generated/kernel';
import {
  ActorOperation as HostActorOperation,
  ActorResult,
  HeartbeatAnswer,
  TaskAssignment,
  TaskHeartbeat,
  TaskOutcome,
} from '../core/generated/host';
import { ActorOperation as ActorServiceOperation } from '../core/generated/actor_service';

/**
 * How long shutdown waits for the pull loops to end once the worker host has
 * stopped. They end at once, since every pull then resolves null; this only
 * bounds a pull that never answers.
 */
const PULL_LOOP_STOP_TIMEOUT_MS = 5000;

/** The SDK's version, reported to the engine when the worker registers. */
const SDK_VERSION: string = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../../package.json').version as string;
  } catch {
    return '';
  }
})();

const encoder = new TextEncoder();

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

/**
 * Runs the registered workflows, tasks and actors on the worker host.
 *
 * The worker host (`orcher-sdk-host`, in the native module) polls the engine,
 * reports results, registers the worker and runs its sessions; the worker
 * pulls the work it hands over, as much at a time as it is configured to run,
 * runs the handlers and hands back the outcomes. `run()` starts the host and
 * fails if it cannot start; `shutdown()` drains it.
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
      | 'versionId'
      | 'binaryChecksum'
      | 'workflows'
      | 'tasks'
      | 'organizationId'
      | 'apiKey'
      | 'tls'
      | 'heartbeatInterval'
    >
  > &
    Pick<WorkerOptions, 'versionId' | 'binaryChecksum' | 'organizationId' | 'apiKey' | 'tls'> & {
      workflows: WorkflowDefinition[];
      tasks: TaskDefinition[];
    };
  private readonly eventEmitter: EventEmitter;
  private readonly logger: Logger;

  private state: WorkerState;
  private client: Client | null = null;
  /** The running worker host, from `run()` until `shutdown()`. */
  private host: NativeHostHandle | null = null;
  /** The host's measurements as it stopped, kept for `wireMetrics()`. */
  private finalWireMetrics: WireMetrics | null = null;
  /** The loops pulling work from the host; they end once it has stopped. */
  private pullLoops: Promise<void>[] = [];
  private startTime: Date | null = null;
  private stopTime: Date | null = null;

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

  /** Room for workflow activations: a pull is made only with room to run what it brings. */
  private readonly workflowRoom: Semaphore;

  private shutdownPromise: Promise<void> | null = null;

  private readonly workflowMap: Map<string, any>;
  private readonly taskMap: Map<string, any>;

  private readonly workflowExecutor: WorkflowExecutor;
  private readonly taskExecutor: TaskExecutor;
  private readonly actorExecutor: ActorExecutor | null = null;

  private readonly actorSemaphore: Semaphore;

  private readonly container: OrcherContainer;

  /**
   * Create a worker. It connects to nothing until `run()`.
   *
   * @param options - Worker configuration options
   * @throws {WorkerError} If a required option is missing or invalid.
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
      maxConcurrentActorOperations: options.maxConcurrentActorOperations ?? 100,
      actorPollerCount: options.actorPollerCount ?? 2,
    };

    this.logger = this.options.logger;
    if (options.heartbeatInterval !== undefined) {
      this.logger.warn(
        'WorkerOptions.heartbeatInterval is deprecated and has no effect: each task is ' +
          'heartbeated at a third of its heartbeatTimeout. Set heartbeatTimeout on the task instead.'
      );
    }
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
    this.workflowRoom = new Semaphore(this.options.maxConcurrentWorkflows);
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

    // The executor's own heartbeat timer is off: the worker host heartbeats
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
   * Connects the worker's client, starts the worker host (which polls the
   * engine, registers the worker and its actor handlers, and runs its
   * sessions) and starts pulling the work it hands over. Resolves once the
   * worker has started; it does not wait for shutdown. Rejects when the host
   * cannot start: the engine cannot be reached, nothing is registered, or the
   * actor service refuses the worker's actor handlers.
   *
   * @throws {WorkerError} If the worker is not stopped, or fails to start
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
      const clientConfig: ClientConfig = {
        serverUrl: this.options.serverUrl,
        namespace: this.options.namespace,
        identity: this.options.identity,
        // The worker's own client reaches the same server the host does, so
        // it carries the same credential and the same TLS setting.
        apiKey: this.options.apiKey,
        tls: this.options.tls,
      };

      this.client = new Client(clientConfig);
      await this.client.connect();

      const host = await getNativeModule().hostStart(
        JSON.stringify(this.hostConfig()),
        JSON.stringify(this.hostRegistrations())
      );
      this.host = host;
      this.startPullLoops(host);

      this.state = WorkerState.RUNNING;
      this.startTime = new Date();
      this.stopTime = null;

      this.logger.info('Service started: the worker host is polling');
      this.emit('started');
    } catch (error) {
      this.state = WorkerState.STOPPED;
      this.client?.close();
      this.client = null;
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
   * 1. The worker host stops claiming work. Work its polls already brought
   *    back is still handed over and run.
   * 2. Running work gets the worker's `shutdownGraceTime` to finish. Workflow
   *    activations still unanswered after it are handed back to the engine for
   *    another worker; tasks and actor operations still running are left to
   *    their timeouts, since the engine cannot take them back.
   * 3. The host closes its sessions and deregisters the worker, and the pull
   *    loops end.
   * 4. The DI container is disposed and the worker emits `stopped`.
   *
   * Concurrent calls share one shutdown. Calling it on a stopped worker does nothing.
   *
   * @param options - Shutdown configuration. The grace is fixed when the
   *   worker starts (`shutdownGraceTime`); `timeout` and `force` do not
   *   shorten it.
   *
   * @example
   * ```typescript
   * // Running work gets the worker's shutdownGraceTime
   * await worker.shutdown();
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
  /**
   * What the worker measured of its calls to the engine, by gRPC method, and
   * of the activations and tasks it ran. `null` before `run()` has started
   * the worker; after it stops, its final measurements.
   */
  wireMetrics(): WireMetrics | null {
    return this.host ? readWireMetrics(this.host) : this.finalWireMetrics;
  }

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
   * The worker host's configuration, from this worker's options. Options left
   * unset keep the host's defaults.
   */
  private hostConfig(): HostConfig {
    const o = this.options;
    return {
      serverUrl: o.serverUrl,
      taskQueue: o.taskQueue,
      namespace: o.namespace,
      identity: o.identity,
      apiKey: o.apiKey,
      organizationId: o.organizationId,
      versionId: o.versionId,
      tls: o.tls,
      maxConcurrentWorkflows: o.maxConcurrentWorkflows,
      maxConcurrentTasks: o.maxConcurrentTasks,
      maxConcurrentActorOperations: o.maxConcurrentActorOperations,
      workflowPollers: o.workflowPollerCount,
      taskPollers: o.taskPollerCount,
      actorPollers: o.actorPollerCount,
      shutdownGraceMs: durationToMillis(o.shutdownGraceTime),
      sdkName: 'typescript',
      sdkVersion: SDK_VERSION,
    };
  }

  /**
   * What the worker runs: its workflow and task types, and the operations of
   * the actors in the registry with their modes.
   */
  private hostRegistrations(): HostRegistrations {
    const actorHandlers: HostRegistrations['actorHandlers'] = [];
    if (this.actorExecutor) {
      for (const [actorName] of diGlobalRegistry.getAllActors()) {
        for (const op of diGlobalRegistry.getOperationsForActor(actorName)) {
          actorHandlers.push({ actorName, operation: op.name, shared: op.mode === 'shared' });
        }
      }
    }
    return {
      workflowTypes: this.options.workflows.map((w: any) => w.name),
      taskTypes: this.options.tasks.map((t: any) => t.name),
      actorHandlers,
    };
  }

  /**
   * Pull workflow activations, tasks and actor operations from the host, each
   * kind as many at a time as the worker runs. A worker that runs none of a
   * kind has its loop end at once.
   */
  private startPullLoops(host: NativeHostHandle): void {
    const native = getNativeModule();
    this.pullLoops = [
      this.pullLoop(
        'workflow',
        this.workflowRoom,
        () => native.hostNextActivation(host),
        (bytes) => this.handleActivation(host, bytes)
      ),
      this.pullLoop(
        'task',
        this.taskSemaphore,
        () => native.hostNextTask(host),
        (bytes) => this.handleTask(host, bytes)
      ),
      this.pullLoop(
        'actor',
        this.actorSemaphore,
        () => native.hostNextActorOperation(host),
        (bytes) => this.handleActorOperation(host, bytes)
      ),
    ];
  }

  /**
   * Take room, pull one piece of work, run it without waiting, and give the
   * room back once it has been answered. Ends when the host has stopped.
   */
  private async pullLoop(
    kind: string,
    room: Semaphore,
    next: () => Promise<Uint8Array | null>,
    run: (bytes: Uint8Array) => Promise<void>
  ): Promise<void> {
    for (;;) {
      await room.acquire();
      let bytes: Uint8Array | null;
      try {
        bytes = await next();
      } catch (error) {
        room.release();
        this.logger.error(`[${kind}] Pulling work from the worker host failed; stopping`, error);
        return;
      }
      if (bytes === null) {
        room.release();
        this.logger.debug(`[${kind}] The worker host has stopped; no more work`);
        return;
      }
      void run(bytes)
        .catch((error) => this.logger.error(`[${kind}] Unhandled error running work:`, error))
        .finally(() => room.release());
    }
  }

  /** Run one workflow activation and hand its answer to the host. */
  private async handleActivation(host: NativeHostHandle, bytes: Uint8Array): Promise<void> {
    const activation = RunActivation.fromBinary(bytes);
    const answer = await this.runActivation(activation);
    try {
      await getNativeModule().hostCompleteActivation(host, RunActivationResult.toBinary(answer));
    } catch (error) {
      this.logger.error(
        `[Workflow] The answer to ${activation.run?.workflowId}/${activation.run?.runId} was not taken:`,
        error
      );
    }
  }

  /**
   * How a running task's heartbeats and cancellation reach the worker host,
   * which also heartbeats every task on its own.
   */
  private taskHeartbeatBinding(host: NativeHostHandle, token: Uint8Array): TaskHeartbeatBinding {
    const native = getNativeModule();
    return {
      record: async (details?: unknown) =>
        HeartbeatAnswer.fromBinary(
          native.hostHeartbeat(
            host,
            TaskHeartbeat.toBinary({
              token,
              details:
                details === undefined
                  ? undefined
                  : {
                      data: encoder.encode(JSON.stringify(details)),
                      metadata: { encoding: encoder.encode('json') },
                    },
            })
          )
        ).cancelRequested,
      cancelled: async () => (await native.hostTaskCancelled(host, token)) === true,
    };
  }

  /** Run one task and report its outcome to the host. */
  private async handleTask(host: NativeHostHandle, bytes: Uint8Array): Promise<void> {
    const assignment = TaskAssignment.fromBinary(bytes);
    const result = await this.runTask(host, assignment);
    try {
      await getNativeModule().hostCompleteTask(
        host,
        TaskOutcome.toBinary({ token: assignment.token, result })
      );
    } catch (error) {
      this.logger.error(
        `[Task] The outcome of ${assignment.taskType}/${assignment.taskId} was not taken:`,
        error
      );
    }
  }

  /**
   * Run a task handler for an assignment: its value, or its failure with the
   * error type and retryability the engine's retry decision reads. Never throws.
   */
  private async runTask(
    host: NativeHostHandle,
    assignment: TaskAssignment
  ): Promise<TaskOutcome['result']> {
    const failed = (message: string, errorType: string, nonRetryable: boolean) => ({
      oneofKind: 'failure' as const,
      failure: {
        message,
        errorType,
        nonRetryable,
        code: FailureCode.APPLICATION,
        details: new Uint8Array(),
      },
    });

    const taskDef = this.taskMap.get(assignment.taskType);
    if (!taskDef) {
      this.logger.error(`[Task] Task not registered: ${assignment.taskType}`);
      return failed(`Task not registered: ${assignment.taskType}`, 'TaskExecutionError', false);
    }

    const run = assignment.run;
    const millis = (d?: { seconds: string; nanos: number }) =>
      d ? Number(d.seconds) * 1000 + Math.floor(d.nanos / 1_000_000) : undefined;
    // The task's input arrives as the bytes of its JSON encoding; the executor
    // decodes them into the handler's one argument.
    const request: ExecutionRequest = {
      executionId: assignment.taskId || 'unknown',
      type: assignment.taskType,
      input: Array.from(assignment.input[0]?.data ?? []),
      metadata: {
        workflowId: run?.workflowId || 'unknown',
        runId: run?.runId || 'unknown',
        attempt: assignment.attempt || 1,
        namespace: this.options.namespace,
        taskQueue: this.options.taskQueue,
        // How long this attempt may run, as the engine judges it.
        timeout: millis(assignment.attemptTimeout),
        // The heartbeat interval the engine will judge this task by, which
        // `ctx.heartbeatTimeout()` exposes so a handler can pace itself.
        heartbeatTimeoutMs: millis(assignment.heartbeatTimeout),
      },
      cachedStepResults: [],
    };

    this.stats.tasksInProgress++;
    try {
      const result = await this.taskExecutor.execute(
        taskDef,
        request,
        this.taskHeartbeatBinding(host, assignment.token)
      );
      this.stats.tasksExecuted++;
      if (result.success) {
        // The task's own return value, not the execution envelope: it is what
        // the workflow receives.
        return {
          oneofKind: 'value',
          value: { data: encoder.encode(JSON.stringify(result.result ?? null)), metadata: {} },
        };
      }
      // A failing task is reported as a failure, not a completion: a completion
      // is journaled as completed, and replay never surfaces the failure.
      return failed(
        result.error?.message || 'Unknown error',
        result.error?.type ?? 'TaskExecutionError',
        result.error?.nonRetryable === true
      );
    } catch (error) {
      this.stats.errors++;
      this.logger.error(`[Task] Failed task: ${assignment.taskType}/${assignment.taskId}`, error);
      const failure = describeTaskFailure(error);
      return failed(failure.message, failure.type, failure.nonRetryable);
    } finally {
      this.stats.tasksInProgress--;
    }
  }

  /**
   * An actor state client that reads and writes through the worker host, on
   * its connection, with the worker's credentials.
   */
  private createActorStateClient(): ActorStateClient {
    const hostOf = (): NativeHostHandle => {
      if (!this.host) {
        throw new WorkerError('The worker is not running');
      }
      return this.host;
    };
    return {
      async getState(actorName, key, stateKey, executionId) {
        const state = await getNativeModule().hostGetActorState(
          hostOf(),
          actorName,
          key,
          executionId,
          stateKey
        );
        return { value: state?.value ?? new Uint8Array(0), exists: state !== null };
      },
      async setState(actorName, key, stateKey, value, executionId) {
        // The host rejects a write the actor service refuses.
        await getNativeModule().hostSetActorState(
          hostOf(),
          actorName,
          key,
          executionId,
          stateKey,
          value
        );
        return { success: true };
      },
      async deleteState(actorName, key, stateKey, executionId) {
        const existed = await getNativeModule().hostDeleteActorState(
          hostOf(),
          actorName,
          key,
          executionId,
          stateKey
        );
        return { existed };
      },
      async listStateKeys(actorName, key, executionId, prefix?) {
        const keys = await getNativeModule().hostActorStateKeys(
          hostOf(),
          actorName,
          key,
          executionId,
          prefix ?? ''
        );
        return { keys };
      },
    };
  }

  /** Run one actor operation and report its result to the host. */
  private async handleActorOperation(host: NativeHostHandle, bytes: Uint8Array): Promise<void> {
    const operation = HostActorOperation.fromBinary(bytes);
    let result: ActorResult['result'];
    this.stats.actorOperationsInProgress++;
    try {
      if (!this.actorExecutor) {
        throw new WorkerError('No actors are registered with this worker');
      }
      // The executor takes the operation as the actor service delivers it;
      // the two protocols number the modes alike.
      const executed = await this.actorExecutor.execute(
        ActorServiceOperation.create({
          operationId: operation.operationId,
          actorName: operation.actorName,
          key: operation.key,
          operation: operation.operation,
          payload: operation.payload?.data ?? new Uint8Array(0),
          mode: operation.mode as number,
          executionId: operation.executionId,
          metadata: operation.metadata,
        })
      );
      this.stats.actorOperationsExecuted++;
      result = executed.success
        ? { oneofKind: 'value', value: { data: executed.result, metadata: {} } }
        : {
            oneofKind: 'failure',
            failure: {
              message: executed.error ?? 'Actor operation failed',
              errorType: '',
              nonRetryable: false,
              code: FailureCode.APPLICATION,
              details: new Uint8Array(),
            },
          };
    } catch (error) {
      this.stats.errors++;
      this.logger.error('[Actor] Failed:', error);
      result = {
        oneofKind: 'failure',
        failure: {
          message: error instanceof Error ? error.message : String(error),
          errorType: '',
          nonRetryable: false,
          code: FailureCode.APPLICATION,
          details: new Uint8Array(),
        },
      };
    } finally {
      this.stats.actorOperationsInProgress--;
    }
    try {
      await getNativeModule().hostCompleteActorOperation(
        host,
        ActorResult.toBinary({
          operationId: operation.operationId,
          executionId: operation.executionId,
          result,
        })
      );
    } catch (error) {
      this.logger.error(
        `[Actor] The result of ${operation.actorName}.${operation.operation} was not taken:`,
        error
      );
    }
  }

  /**
   * Run one workflow activation as the kernel protocol carries it, and answer it.
   *
   * The activation's resolutions are loaded into a fresh context, the workflow's
   * code runs in it, and the answer carries every durable call the code made, in issue order, those
   * answered from history marked satisfied. A workflow that fails answers
   * `workflowFailed`; an activation this SDK cannot process, or a command the
   * protocol cannot carry, answers `protocolError`.
   *
   * The worker host hands activations over this way; the replay check
   * (`contract/replay-check.ts`) runs recorded ones through it too.
   *
   * @internal
   */
  async runActivation(activation: RunActivation): Promise<RunActivationResult> {
    const activationId = activation.activationId;
    let loaded: LoadedActivation;
    try {
      loaded = loadActivation(activation, this.options.namespace);
    } catch (error) {
      return protocolError(activationId, error instanceof Error ? error.message : String(error));
    }

    const workflowDef = this.workflowMap.get(loaded.workflowType);
    if (!workflowDef) {
      this.logger.error(`[KERNEL] Workflow not registered: ${loaded.workflowType}`);
      return answerActivation(
        activationId,
        { success: false, error: { message: `Workflow not registered: ${loaded.workflowType}` } },
        [],
        []
      );
    }

    await this.workflowSemaphore.acquire();
    this.stats.workflowsInProgress++;
    try {
      const result = await this.workflowExecutor.executeIn(workflowDef, loaded.context, {
        executionId: loaded.executionId,
        type: loaded.workflowType,
        input: loaded.input,
        metadata: {
          workflowId: loaded.context.workflowId(),
          runId: loaded.context.runId(),
          attempt: loaded.context.attempt(),
          namespace: loaded.context.namespace(),
          taskQueue: loaded.context.taskQueue(),
        },
      });
      this.stats.workflowsExecuted++;
      const queries = this.answerQueries(loaded.queries, result.context);
      const updates = await this.answerUpdates(loaded.updates, result.context);
      return answerActivation(activationId, result, queries, updates);
    } catch (error) {
      this.stats.errors++;
      this.logger.error('[KERNEL] Workflow activation error:', error);
      return protocolError(activationId, error instanceof Error ? error.message : String(error));
    } finally {
      this.stats.workflowsInProgress--;
      this.workflowSemaphore.release();
    }
  }

  /**
   * Answer each query from its registered handler (via GlobalRegistry @Query()
   * decorator or WorkflowContext manual registration), in the bridge format
   * expected by Rust.
   */
  private answerQueries(asked: AskedQuery[], context: any): HandlerQueryResponse[] {
    const queryResponses: HandlerQueryResponse[] = [];
    for (const { queryId, queryType } of asked) {
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
   * Apply each update with its registered handler (via GlobalRegistry
   * @Update() decorator), answering in the bridge format expected by Rust.
   */
  private async answerUpdates(
    asked: AskedUpdate[],
    context: any
  ): Promise<HandlerUpdateResponse[]> {
    const updateResults: HandlerUpdateResponse[] = [];
    for (const { updateId, updateType, args } of asked) {
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
        const input =
          args && args.length > 0 ? JSON.parse(new TextDecoder().decode(args)) : undefined;
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
   * Run the shutdown sequence described on {@link Worker.shutdown}.
   */
  private async performShutdown(options?: ShutdownOptions): Promise<void> {
    const force = options?.force ?? false;
    if (options?.timeout !== undefined || force) {
      this.logger.warn(
        'ShutdownOptions.timeout and force have no effect: running work gets the ' +
          'shutdownGraceTime the worker was created with.'
      );
    }

    this.logger.info('Shutting down service...');
    this.state = force ? WorkerState.FORCE_SHUTDOWN : WorkerState.SHUTTING_DOWN;

    try {
      // Drains: the host stops claiming, gives running work its grace, hands
      // back the activations still unanswered, and deregisters. Every pull
      // then resolves null, which ends the pull loops.
      const host = this.host;
      if (host) {
        await getNativeModule().hostShutdown(host);
        this.finalWireMetrics = readWireMetrics(host);
        await this.settleWithin(this.pullLoops, PULL_LOOP_STOP_TIMEOUT_MS);
      }
      this.host = null;
      this.pullLoops = [];

      // Dispose DI container (cleanup resources, call lifecycle hooks). After
      // the host has stopped, since workflow activations run until then and
      // their queries and updates resolve handlers from it.
      this.logger.debug('Disposing DI container...');
      await this.container.dispose();

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
   * registered itself there; that keeps one construction path for both. So does
   * a `@Workflow` class, by the name its decorator declares: a class is also a
   * function with a `name`, but that is its JavaScript class name, which no
   * start uses, and a class cannot be called without `new`.
   */
  private normalizeWorkflowEntries(provided: any[]): any[] {
    const byName = new Map<string, any>(
      this.convertDIWorkflowsToDefinitions().map((d: any) => [d.name, d])
    );
    return provided.map((entry: any) => {
      const declared = typeof entry === 'function' ? getWorkflowName(entry) : undefined;
      if (typeof entry === 'function' && entry.name && !declared) return entry;
      const name = declared ?? entry?.workflowName ?? entry?.name;
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
   * A `@Tasks` class stands for every `@Task` method on it, each under its task
   * name.
   */
  private normalizeTaskEntries(provided: any[]): any[] {
    const byName = new Map<string, any>(
      this.convertDITasksToDefinitions().map((d: any) => [d.name, d])
    );
    const entries = provided.flatMap((entry: any) =>
      typeof entry === 'function' && isTaskHandler(entry) ? getAllTaskReferences(entry) : [entry]
    );
    return entries.map((entry: any) => {
      if (typeof entry === 'function' && entry.name) return entry;
      const name = entry?.taskName ?? entry?.name;
      const resolved = name ? byName.get(name) : undefined;
      if (resolved) return resolved;
      throw new WorkerError(
        `Cannot register task ${name ? `'${name}'` : '(unnamed entry)'}: pass the value ` +
          `returned by task({ name, execute }), a @Task reference or a @Tasks class. ` +
          `Received: ${typeof entry}`
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

/** The host's measurements, with the field names TypeScript code uses. */
function readWireMetrics(host: NativeHostHandle): WireMetrics {
  const raw = JSON.parse(getNativeModule().hostWireMetrics(host)) as {
    methods: Record<string, Record<string, unknown>>;
    work: Record<string, number>;
  };
  const methods: Record<string, MethodStats> = {};
  for (const [method, stats] of Object.entries(raw.methods)) {
    methods[method] = {
      calls: stats['calls'] as number,
      statusErrors: stats['status_errors'] as Record<string, number>,
      transportErrors: stats['transport_errors'] as number,
      retries: stats['retries'] as number,
      latencyBuckets: stats['latency_buckets'] as number[],
      latencyTotalUs: stats['latency_total_us'] as number,
    };
  }
  const w = raw.work;
  return {
    methods,
    work: {
      activations: w['activations'] ?? 0,
      activationJournalEntries: w['activation_journal_entries'] ?? 0,
      workflowReports: w['workflow_reports'] ?? 0,
      workflowCommands: w['workflow_commands'] ?? 0,
      workflowFailures: w['workflow_failures'] ?? 0,
      tasks: w['tasks'] ?? 0,
      taskInputBytes: w['task_input_bytes'] ?? 0,
      taskReports: w['task_reports'] ?? 0,
      taskResultBytes: w['task_result_bytes'] ?? 0,
      taskFailures: w['task_failures'] ?? 0,
    },
  };
}
