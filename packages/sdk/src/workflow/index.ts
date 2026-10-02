/**
 * Workflow-side APIs: the workflow context, deterministic helpers, events,
 * queries, child workflows, sagas, and worker sessions.
 *
 * Workflows themselves are defined with the `workflow()` function or the
 * class-based `@Workflow()` decorator, both exported from `@orcher/sdk`.
 *
 * @packageDocumentation
 */

// Workflow context
export { WorkflowContext, StepType } from './context';
export type {
  WorkflowExecution,
  WorkflowCommand,
  WorkflowCommandType,
  ScheduleTaskCommand,
  StartTimerCommand,
  StartChildWorkflowCommand,
  CancelChildWorkflowCommand,
  RecordStepResultCommand,
  RestartFreshCommand,
  RetryPolicy as ContextRetryPolicy,
  TaskFunction as ContextTaskFunction,
  ChildWorkflowOptions as ContextChildWorkflowOptions,
} from './context';
export { ParentClosePolicy as ContextParentClosePolicy } from './context';

// Deterministic helpers
export { WorkflowRandom } from './random';
export { WorkflowTime } from './time';

// Event handling
export { EventBuffer, EventManager, EventHelpers } from './events';
export type { EventData, WaitForEventCommand, SendEventCommand } from './events';

// Query handling
export { QueryManager, QueryHelpers, QueryError } from './query';
export type { QueryHandler, QueryResult } from './query';

// Child workflow handling
export {
  ChildWorkflowHandle,
  ChildWorkflowFailedError,
  ChildWorkflowCanceledError,
  ChildWorkflowTimedOutError,
} from './child-handle';

// Saga pattern
export { Saga, SagaBuilder } from './saga';

// Session management
export { SessionContext, SessionState, buildSessionQueue, isSessionQueue } from './session';
export type { SessionOptions, SessionInfo, CreateSessionInput } from './session';

// Common types
export { Duration, ParentClosePolicy, QueryRejectCondition } from './types';
export type {
  WorkflowFunction as TypesWorkflowFunction,
  TaskFunction,
  RetryPolicy,
  ChildWorkflowOptions,
  RestartFreshOptions,
  EventOptions,
  QueryOptions,
} from './types';

// Workflow metadata is exported from `@orcher/sdk` as `DIWorkflowMetadata`.
