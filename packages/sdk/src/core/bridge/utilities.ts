/**
 * Helper functions for ExecutionRequests, RequestJobs and other bridge types.
 *
 * @module @orcher/sdk/core/bridge/utilities
 */

import type {
  ExecutionRequest,
  RequestJob,
  StartWorkflowJob,
  FireTimerJob,
  CompleteTaskJob,
  HandleEventJob,
  ProcessQueryJob,
  CancelWorkflowJob,
  UpdateStateJob,
  EvictFromCacheJob,
  ChildWorkflowStartedJob,
  ChildWorkflowCompletedJob,
  ChildWorkflowFailedJob,
  ChildWorkflowTimedOutJob,
  ChildWorkflowCanceledJob,
  ChildWorkflowTerminatedJob,
  CompleteStepJob,
  FailStepJob,
} from './types';

// ============================================================================
// ExecutionRequest Helpers
// ============================================================================

/**
 * Whether this is the first execution: not a replay, and the journal is empty.
 */
export function isFirstExecution(request: ExecutionRequest): boolean {
  return !request.isReplaying && request.journalLength === 0;
}

/**
 * Check if this is a replay of historical events
 */
export function isReplay(request: ExecutionRequest): boolean {
  return request.isReplaying;
}

/**
 * Check if the workflow should restart fresh
 */
export function shouldRestartFresh(request: ExecutionRequest): boolean {
  return request.restartFresh;
}

/**
 * Check if the request has any jobs to process
 */
export function hasJobs(request: ExecutionRequest): boolean {
  return request.jobs.length > 0;
}

/**
 * Get the number of jobs in the request
 */
export function getJobCount(request: ExecutionRequest): number {
  return request.jobs.length;
}

/**
 * Check if the request only contains cache eviction
 */
export function isEvictionOnly(request: ExecutionRequest): boolean {
  return request.jobs.length === 1 && request.jobs[0]!.type === 'EvictFromCache';
}

/**
 * Get workflow ID from the request
 */
export function getWorkflowId(request: ExecutionRequest): string {
  return request.execution.workflowId;
}

/**
 * Get run ID from the request
 */
export function getRunId(request: ExecutionRequest): string {
  return request.runId;
}

/**
 * Get execution timestamp
 */
export function getTimestamp(request: ExecutionRequest): Date {
  return new Date(request.timestamp);
}

// ============================================================================
// Job Type Filtering
// ============================================================================

/**
 * Filter jobs by type
 */
export function filterJobs<T extends RequestJob['type']>(
  request: ExecutionRequest,
  type: T
): Extract<RequestJob, { type: T }>[] {
  return request.jobs.filter((job) => job.type === type) as Extract<RequestJob, { type: T }>[];
}

/**
 * Get StartWorkflow jobs
 */
export function getStartWorkflowJobs(request: ExecutionRequest): StartWorkflowJob[] {
  return filterJobs(request, 'StartWorkflow').map((j) => j.job);
}

/**
 * Get FireTimer jobs
 */
export function getFireTimerJobs(request: ExecutionRequest): FireTimerJob[] {
  return filterJobs(request, 'FireTimer').map((j) => j.job);
}

/**
 * Get CompleteTask jobs
 */
export function getCompleteTaskJobs(request: ExecutionRequest): CompleteTaskJob[] {
  return filterJobs(request, 'CompleteTask').map((j) => j.job);
}

/**
 * Get HandleEvent jobs
 */
export function getHandleEventJobs(request: ExecutionRequest): HandleEventJob[] {
  return filterJobs(request, 'HandleEvent').map((j) => j.job);
}

/**
 * Get ProcessQuery jobs
 */
export function getProcessQueryJobs(request: ExecutionRequest): ProcessQueryJob[] {
  return filterJobs(request, 'ProcessQuery').map((j) => j.job);
}

/**
 * Get CancelWorkflow jobs
 */
export function getCancelWorkflowJobs(request: ExecutionRequest): CancelWorkflowJob[] {
  return filterJobs(request, 'CancelWorkflow').map((j) => j.job);
}

/**
 * Get UpdateState jobs
 */
export function getUpdateStateJobs(request: ExecutionRequest): UpdateStateJob[] {
  return filterJobs(request, 'UpdateState').map((j) => j.job);
}

/**
 * Get EvictFromCache jobs
 */
export function getEvictFromCacheJobs(request: ExecutionRequest): EvictFromCacheJob[] {
  return filterJobs(request, 'EvictFromCache').map((j) => j.job);
}

/**
 * Get ChildWorkflowStarted jobs
 */
export function getChildWorkflowStartedJobs(request: ExecutionRequest): ChildWorkflowStartedJob[] {
  return filterJobs(request, 'ChildWorkflowStarted').map((j) => j.job);
}

/**
 * Get ChildWorkflowCompleted jobs
 */
export function getChildWorkflowCompletedJobs(request: ExecutionRequest): ChildWorkflowCompletedJob[] {
  return filterJobs(request, 'ChildWorkflowCompleted').map((j) => j.job);
}

/**
 * Get ChildWorkflowFailed jobs
 */
export function getChildWorkflowFailedJobs(request: ExecutionRequest): ChildWorkflowFailedJob[] {
  return filterJobs(request, 'ChildWorkflowFailed').map((j) => j.job);
}

/**
 * Get ChildWorkflowTimedOut jobs
 */
export function getChildWorkflowTimedOutJobs(request: ExecutionRequest): ChildWorkflowTimedOutJob[] {
  return filterJobs(request, 'ChildWorkflowTimedOut').map((j) => j.job);
}

/**
 * Get ChildWorkflowCanceled jobs
 */
export function getChildWorkflowCanceledJobs(request: ExecutionRequest): ChildWorkflowCanceledJob[] {
  return filterJobs(request, 'ChildWorkflowCanceled').map((j) => j.job);
}

/**
 * Get ChildWorkflowTerminated jobs
 */
export function getChildWorkflowTerminatedJobs(request: ExecutionRequest): ChildWorkflowTerminatedJob[] {
  return filterJobs(request, 'ChildWorkflowTerminated').map((j) => j.job);
}

/**
 * Get CompleteStep jobs
 */
export function getCompleteStepJobs(request: ExecutionRequest): CompleteStepJob[] {
  return filterJobs(request, 'CompleteStep').map((j) => j.job);
}

/**
 * Get FailStep jobs
 */
export function getFailStepJobs(request: ExecutionRequest): FailStepJob[] {
  return filterJobs(request, 'FailStep').map((j) => j.job);
}

// ============================================================================
// Job Type Checks
// ============================================================================

/**
 * Check if request contains StartWorkflow jobs
 */
export function hasStartWorkflowJobs(request: ExecutionRequest): boolean {
  return request.jobs.some((job) => job.type === 'StartWorkflow');
}

/**
 * Check if request contains FireTimer jobs
 */
export function hasFireTimerJobs(request: ExecutionRequest): boolean {
  return request.jobs.some((job) => job.type === 'FireTimer');
}

/**
 * Check if request contains CompleteTask jobs
 */
export function hasCompleteTaskJobs(request: ExecutionRequest): boolean {
  return request.jobs.some((job) => job.type === 'CompleteTask');
}

/**
 * Check if request contains HandleEvent jobs
 */
export function hasHandleEventJobs(request: ExecutionRequest): boolean {
  return request.jobs.some((job) => job.type === 'HandleEvent');
}

/**
 * Check if request contains ProcessQuery jobs
 */
export function hasProcessQueryJobs(request: ExecutionRequest): boolean {
  return request.jobs.some((job) => job.type === 'ProcessQuery');
}

/**
 * Check if request contains CancelWorkflow jobs
 */
export function hasCancelWorkflowJobs(request: ExecutionRequest): boolean {
  return request.jobs.some((job) => job.type === 'CancelWorkflow');
}

/**
 * Check if request contains child workflow lifecycle jobs
 */
export function hasChildWorkflowJobs(request: ExecutionRequest): boolean {
  return request.jobs.some(
    (job) =>
      job.type === 'ChildWorkflowStarted' ||
      job.type === 'ChildWorkflowCompleted' ||
      job.type === 'ChildWorkflowFailed' ||
      job.type === 'ChildWorkflowTimedOut' ||
      job.type === 'ChildWorkflowCanceled' ||
      job.type === 'ChildWorkflowTerminated'
  );
}

/**
 * Check if request contains step-related jobs
 */
export function hasStepJobs(request: ExecutionRequest): boolean {
  return request.jobs.some((job) => job.type === 'CompleteStep' || job.type === 'FailStep');
}

// ============================================================================
// Job Counting
// ============================================================================

/**
 * Count jobs of a specific type
 */
export function countJobs(request: ExecutionRequest, type: RequestJob['type']): number {
  return request.jobs.filter((job) => job.type === type).length;
}

/**
 * Get a summary of job counts by type
 */
export function getJobSummary(request: ExecutionRequest): Record<string, number> {
  const summary: Record<string, number> = {};

  for (const job of request.jobs) {
    summary[job.type] = (summary[job.type] || 0) + 1;
  }

  return summary;
}

// ============================================================================
// Debugging Helpers
// ============================================================================

/**
 * Get a human-readable description of the execution request
 */
export function describeRequest(request: ExecutionRequest): string {
  const parts: string[] = [];

  parts.push(`ExecutionRequest for ${request.execution.workflowId}/${request.runId}`);
  parts.push(`Jobs: ${request.jobs.length}`);
  parts.push(`Journal Length: ${request.journalLength}`);
  parts.push(`Is Replaying: ${request.isReplaying}`);

  const summary = getJobSummary(request);
  for (const [type, count] of Object.entries(summary)) {
    parts.push(`  ${type}: ${count}`);
  }

  return parts.join('\n');
}

/**
 * Get a compact summary string of the request
 */
export function summarizeRequest(request: ExecutionRequest): string {
  const jobTypes = [...new Set(request.jobs.map((job) => job.type))];
  return `${request.execution.workflowId}/${request.runId} (${request.jobs.length} jobs: ${jobTypes.join(', ')})`;
}

/**
 * Log request details to console (for debugging)
 */
export function logRequest(request: ExecutionRequest): void {
  console.log(describeRequest(request));
}

// ============================================================================
// Sequence Number Helpers
// ============================================================================

/**
 * Get the highest sequence number among the jobs, or 0 if no job has one.
 */
export function getMaxSequence(request: ExecutionRequest): number {
  let maxSeq = 0;

  for (const job of request.jobs) {
    if ('seq' in job.job && typeof job.job.seq === 'number') {
      maxSeq = Math.max(maxSeq, job.job.seq);
    }
  }

  return maxSeq;
}

/**
 * Get the lowest sequence number among the jobs, or 0 if no job has one.
 */
export function getMinSequence(request: ExecutionRequest): number {
  let minSeq = Infinity;

  for (const job of request.jobs) {
    if ('seq' in job.job && typeof job.job.seq === 'number') {
      minSeq = Math.min(minSeq, job.job.seq);
    }
  }

  return minSeq === Infinity ? 0 : minSeq;
}

/**
 * Return a copy of the jobs sorted by ascending sequence number.
 *
 * Jobs without a sequence number sort as 0.
 */
export function sortJobsBySequence(jobs: RequestJob[]): RequestJob[] {
  return [...jobs].sort((a, b) => {
    const seqA = 'seq' in a.job && typeof a.job.seq === 'number' ? a.job.seq : 0;
    const seqB = 'seq' in b.job && typeof b.job.seq === 'number' ? b.job.seq : 0;
    return seqA - seqB;
  });
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate that an ExecutionRequest has all required fields.
 *
 * Does not validate the individual jobs; see {@link validateAllJobs}.
 *
 * @throws {Error} Naming the first missing or mistyped field
 */
export function validateRequest(request: ExecutionRequest): void {
  if (!request.runId) {
    throw new Error('ExecutionRequest.runId is required');
  }

  if (!request.execution) {
    throw new Error('ExecutionRequest.execution is required');
  }

  if (!request.execution.workflowId) {
    throw new Error('ExecutionRequest.execution.workflowId is required');
  }

  if (!request.execution.runId) {
    throw new Error('ExecutionRequest.execution.runId is required');
  }

  if (!Array.isArray(request.jobs)) {
    throw new Error('ExecutionRequest.jobs must be an array');
  }

  if (typeof request.journalLength !== 'number') {
    throw new Error('ExecutionRequest.journalLength must be a number');
  }

  if (typeof request.isReplaying !== 'boolean') {
    throw new Error('ExecutionRequest.isReplaying must be a boolean');
  }
}

/**
 * Validate a RequestJob
 */
export function validateJob(job: RequestJob): void {
  if (!job.type) {
    throw new Error('RequestJob.type is required');
  }

  if (!job.job) {
    throw new Error('RequestJob.job is required');
  }
}

/**
 * Validate all jobs in a request
 */
export function validateAllJobs(request: ExecutionRequest): void {
  for (const job of request.jobs) {
    validateJob(job);
  }
}
