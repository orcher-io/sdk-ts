/**
 * The worker: polls the Orcher engine for workflow and task work, runs the
 * registered handlers, and reports the results.
 *
 * @module @orcher/sdk/worker
 */

export { Worker } from './worker';

export { WorkerBuilder } from './worker-builder';

export { autoDiscover, shouldUseAutoDiscover, validateAutoDiscoverOptions } from './auto-discover';
export type { AutoDiscoverOptions, AutoDiscoverResult } from './auto-discover';

export { SessionManager } from './session';
export type { SessionManagerOptions } from './session';

export { Semaphore } from './semaphore';
export type { SemaphoreStats } from './semaphore';

export { WorkflowExecutor } from './workflow-executor';
export type { WorkflowExecutorOptions, WorkflowExecutorStats } from './workflow-executor';

export { TaskExecutor } from './task-executor';
export type { TaskExecutorOptions, TaskExecutorStats } from './task-executor';

export type {
  WorkerOptions,
  WorkerStats,
  ShutdownOptions,
  WorkerIdentity,
  WorkerCapabilities,
  WorkerHealth,
  WorkerMetadata,
  PollerOptions,
  ServiceEvent,
  ExecutionMetadata,
  ExecutionResult,
  ExecutionRequest,
  CachedStepResult,
  WorkflowDefinition,
  TaskDefinition,
} from './types';

export { WorkerState } from './types';

export {
  WorkerError,
  ServiceConfigurationError,
  ServiceStartupError,
  ServiceShutdownError,
  PollingError,
  HandlerNotFoundError,
  ConcurrencyLimitError,
  ExecutionTimeoutError,
  isWorkerError,
  isExecutionError,
  isHandlerNotFoundError,
} from './errors';

export { ExecutionError } from './errors';
