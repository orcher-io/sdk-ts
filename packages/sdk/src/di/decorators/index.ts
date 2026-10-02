/**
 * Class and method decorators for dependency injection, tasks, workflows, actors, updates,
 * and queries.
 * @packageDocumentation
 */

export { Injectable, isInjectable, getInjectableScope, getInjectableMetadata } from './injectable';

export { Tasks, isTasks, isTaskHandler, getTaskHandlerMetadata, getTaskMethods } from './tasks';

export {
  Task,
  isTask,
  getTaskMetadata,
  getTaskName,
  hasTaskReference,
  getTaskReference,
  getAllTaskReferences,
} from './task';

export {
  Workflow,
  isWorkflow,
  getWorkflowMetadata,
  getWorkflowName,
  getWorkflowVersion,
} from './workflow';

export { Inject, getInjectTokens, getInjectToken, hasInject, getInjectCount } from './inject';

export { Actor, isActor, getActorMetadata, getActorName, getOperationMethods } from './actor';

export {
  Operation,
  isOperation,
  getOperationMetadata,
  getOperationName,
  hasOperationReference,
  getAllOperationReferences,
} from './operation';

export {
  Updates,
  isUpdates,
  isUpdateHandler,
  getUpdateHandlerMetadata,
  getUpdateMethods,
} from './updates';

export {
  Update,
  isUpdate,
  getUpdateMetadata,
  getUpdateName,
  hasUpdateReference,
  getAllUpdateReferences,
} from './update';

export {
  Queries,
  isQueries,
  isQueryHandler,
  getQueryHandlerMetadata,
  getQueryMethods,
} from './queries';

export {
  Query,
  isQuery,
  getQueryMetadata,
  getQueryName,
  hasQueryReference,
  getAllQueryReferences,
} from './query';
