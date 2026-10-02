/**
 * Fluent builder for {@link Worker} instances, with optional auto-discovery.
 *
 * Auto-discovery is optional: importing the decorated files yourself works just as well.
 *
 * @module @orcher/sdk/worker/worker-builder
 */

import type { DurationInput } from '../workflow/types';
import { Worker } from './worker';
import type { WorkerOptions } from './types';
import { autoDiscover, type AutoDiscoverOptions, type AutoDiscoverResult } from './auto-discover';

/**
 * Fluent builder that configures and creates a {@link Worker}.
 *
 * `serverUrl`, `namespace` and `taskQueue` are required. Workflows and tasks come from the
 * global registry unless set explicitly, so decorated classes only need to be imported before
 * `build()`, either by `autoDiscover()` or by plain imports.
 *
 * @example
 * ```typescript
 * import { Worker } from '@orcher/sdk';
 *
 * // With auto-discovery using the default patterns
 * const worker = await Worker.builder()
 *   .serverUrl('http://localhost:50051')
 *   .namespace('default')
 *   .taskQueue('my-queue')
 *   .autoDiscover() // Scans ./src/**\/*.{ts,js}
 *   .build();
 *
 * // With custom auto-discovery patterns
 * const worker = await Worker.builder()
 *   .serverUrl('http://localhost:50051')
 *   .namespace('default')
 *   .taskQueue('my-queue')
 *   .autoDiscover({
 *     patterns: ['./src/tasks/**\/*.ts', './src/workflows/**\/*.ts'],
 *     exclude: ['**\/*.test.ts'],
 *   })
 *   .build();
 *
 * // With manual imports and no auto-discovery
 * import './tasks/order.tasks';
 * import './workflows/order.workflow';
 *
 * const worker = await Worker.builder()
 *   .serverUrl('http://localhost:50051')
 *   .namespace('default')
 *   .taskQueue('my-queue')
 *   .build(); // Registers everything in the global registry
 * ```
 */
export class WorkerBuilder {
  private options: Partial<WorkerOptions> = {};
  private shouldAutoDiscover = false;
  private autoDiscoverOptions?: AutoDiscoverOptions;
  private autoDiscoverResult?: AutoDiscoverResult;

  /**
   * Set the server URL
   *
   * @param url - Server URL (e.g., 'http://localhost:50051')
   * @returns Builder instance for chaining
   */
  serverUrl(url: string): this {
    this.options.serverUrl = url;
    return this;
  }

  /**
   * Set the namespace
   *
   * @param namespace - Namespace to operate in
   * @returns Builder instance for chaining
   */
  namespace(namespace: string): this {
    this.options.namespace = namespace;
    return this;
  }

  /**
   * Set the task queue
   *
   * @param queue - Task queue name
   * @returns Builder instance for chaining
   */
  taskQueue(queue: string): this {
    this.options.taskQueue = queue;
    return this;
  }

  /**
   * Set maximum concurrent workflows
   *
   * @param max - Maximum concurrent workflows
   * @returns Builder instance for chaining
   */
  maxConcurrentWorkflows(max: number): this {
    this.options.maxConcurrentWorkflows = max;
    return this;
  }

  /**
   * Set maximum concurrent tasks
   *
   * @param max - Maximum concurrent tasks
   * @returns Builder instance for chaining
   */
  maxConcurrentTasks(max: number): this {
    this.options.maxConcurrentTasks = max;
    return this;
  }

  /**
   * Set workflow polling interval
   *
   * @param interval - Polling interval in milliseconds
   * @returns Builder instance for chaining
   */
  workflowPollInterval(interval: number): this {
    this.options.workflowPollInterval = interval;
    return this;
  }

  /**
   * Set task polling interval
   *
   * @param interval - Polling interval in milliseconds
   * @returns Builder instance for chaining
   */
  taskPollInterval(interval: number): this {
    this.options.taskPollInterval = interval;
    return this;
  }

  /**
   * Set number of concurrent workflow pollers
   *
   * @param count - Number of workflow pollers
   * @returns Builder instance for chaining
   */
  workflowPollerCount(count: number): this {
    this.options.workflowPollerCount = count;
    return this;
  }

  /**
   * Set number of concurrent task pollers
   *
   * @param count - Number of task pollers
   * @returns Builder instance for chaining
   */
  taskPollerCount(count: number): this {
    this.options.taskPollerCount = count;
    return this;
  }

  /**
   * Set how long shutdown waits for in-flight work before forcing it
   *
   * @param timeout - Grace time, as a `Duration` or a number of milliseconds
   * @returns Builder instance for chaining
   */
  shutdownGraceTime(timeout: DurationInput): this {
    this.options.shutdownGraceTime = timeout;
    return this;
  }

  /**
   * Set the maximum time before the worker is terminated forcefully
   *
   * @param timeout - Timeout in milliseconds
   * @returns Builder instance for chaining
   */
  forceShutdownTimeout(timeout: number): this {
    this.options.forceShutdownTimeout = timeout;
    return this;
  }

  /**
   * Set worker identity
   *
   * @param identity - Worker identity string
   * @returns Builder instance for chaining
   */
  identity(identity: string): this {
    this.options.identity = identity;
    return this;
  }

  /**
   * Declare the code release this worker is running
   *
   * Opaque — a git sha, an image digest, a release tag. The server records it
   * on an execution the first time this worker claims one, so that execution
   * keeps replaying against the code it started on.
   *
   * @param versionId - Release identifier
   * @returns Builder instance for chaining
   */
  versionId(versionId: string): this {
    this.options.versionId = versionId;
    return this;
  }

  /**
   * Set the worker binary checksum, used for determinism verification
   *
   * @param checksum - Binary checksum
   * @returns Builder instance for chaining
   */
  binaryChecksum(checksum: string): this {
    this.options.binaryChecksum = checksum;
    return this;
  }

  /**
   * Set custom logger
   *
   * @param logger - Logger implementation
   * @returns Builder instance for chaining
   */
  logger(logger: WorkerOptions['logger']): this {
    this.options.logger = logger;
    return this;
  }

  /**
   * Set the workflows explicitly instead of taking them from the global registry
   *
   * @param workflows - Array of workflow definitions
   * @returns Builder instance for chaining
   */
  workflows(workflows: WorkerOptions['workflows']): this {
    this.options.workflows = workflows;
    return this;
  }

  /**
   * Set the tasks explicitly instead of taking them from the global registry
   *
   * @param tasks - Array of task definitions
   * @returns Builder instance for chaining
   */
  tasks(tasks: WorkerOptions['tasks']): this {
    this.options.tasks = tasks;
    return this;
  }

  /**
   * Set the organization ID sent to the server
   *
   * The worker sends it on every request in the `X-Organization-Id` header, which the
   * server uses for organization-level quotas and billing attribution.
   *
   * @param orgId - Organization ID
   * @returns Builder instance for chaining
   *
   * @example
   * ```typescript
   * builder.organizationId('org_abc123')
   * ```
   */
  organizationId(orgId: string): this {
    this.options.organizationId = orgId;
    return this;
  }

  /**
   * Enable auto-discovery of decorated classes
   *
   * During `build()`, imports every file that matches the patterns so their decorators
   * register workflows and tasks. Without it, import the decorated classes yourself before
   * calling `build()`; decorators behave the same either way.
   *
   * @param options - Auto-discovery configuration (optional)
   * @returns Builder instance for chaining
   *
   * @example
   * ```typescript
   * // Use defaults (scans ./src/**\/*.{ts,js})
   * builder.autoDiscover()
   *
   * // Custom patterns
   * builder.autoDiscover({
   *   patterns: ['./src/tasks/**\/*.ts', './src/workflows/**\/*.ts'],
   *   exclude: ['**\/*.test.ts'],
   * })
   *
   * // With verbose logging
   * builder.autoDiscover({ verbose: true })
   * ```
   */
  autoDiscover(options?: AutoDiscoverOptions): this {
    this.shouldAutoDiscover = true;
    this.autoDiscoverOptions = options;
    return this;
  }

  /**
   * Get the auto-discovery result, which is set only after `build()`
   *
   * @returns Auto-discovery result, or undefined if not used
   */
  getAutoDiscoverResult(): AutoDiscoverResult | undefined {
    return this.autoDiscoverResult;
  }

  /**
   * Build the Worker instance
   *
   * Runs auto-discovery first if it is enabled, then creates the Worker, which registers
   * the workflows and tasks in the global registry unless they were set explicitly.
   *
   * @returns Worker instance
   * @throws Error if `serverUrl`, `namespace` or `taskQueue` is missing
   *
   * @example
   * ```typescript
   * const worker = await builder.build();
   * await worker.run();
   * ```
   */
  async build(): Promise<Worker> {
    if (this.shouldAutoDiscover) {
      const logger = this.options.logger;
      if (logger) {
        logger.info('Running auto-discovery...');
      }

      this.autoDiscoverResult = await autoDiscover({
        ...this.autoDiscoverOptions,
        logger: this.options.logger,
      });

      if (logger && this.autoDiscoverResult.filesFailed > 0) {
        logger.warn(
          `Auto-discovery completed with ${this.autoDiscoverResult.filesFailed} failed imports. ` +
            'Check logs for details.'
        );
      }
    }

    if (!this.options.serverUrl) {
      throw new Error('serverUrl is required. Call .serverUrl(url) before .build()');
    }

    if (!this.options.namespace) {
      throw new Error('namespace is required. Call .namespace(ns) before .build()');
    }

    if (!this.options.taskQueue) {
      throw new Error('taskQueue is required. Call .taskQueue(queue) before .build()');
    }

    const service = new Worker(this.options as WorkerOptions);

    return service;
  }

  /**
   * Create a new WorkerBuilder instance
   *
   * @returns New builder instance
   *
   * @example
   * ```typescript
   * const worker = await WorkerBuilder.create()
   *   .serverUrl('http://localhost:50051')
   *   .namespace('default')
   *   .taskQueue('my-queue')
   *   .build();
   * ```
   */
  static create(): WorkerBuilder {
    return new WorkerBuilder();
  }
}
