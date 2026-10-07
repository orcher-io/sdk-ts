/**
 * Convert a tagged native error into the class the SDK documents.
 *
 * Two vocabularies cross this boundary. Transport failures carry gRPC-shaped
 * codes (`UNAVAILABLE`, `DEADLINE_EXCEEDED`) and become the transport error
 * classes. Workflow-scoped failures carry orchestration codes
 * (`WORKFLOW_NOT_FOUND`) and become `WorkflowError` — the same class, code and
 * factory the Rust and Python SDKs produce for the identical server condition,
 * so the same failure is handled the same way in every language. A missing
 * workflow is therefore `WORKFLOW_NOT_FOUND`, not the transport `NOT_FOUND`.
 *
 * This lives outside both error modules so it can import each without creating a
 * cycle: the orchestration module already depends on the transport one.
 */

import { wrapError } from '../core/errors';
import type { OrcherError } from '../core/errors';
import {
  ErrorCode,
  WorkflowError,
  WorkflowFailedError,
  WorkflowCanceledError,
  WorkflowTerminatedError,
  WorkflowTimedOutError,
} from './index';
import type { WorkflowOutcomeDetails, WorkflowOutcomeError } from './index';

/** What a wrapped client failure can be: a transport error or a workflow one. */
type WrappedError = OrcherError | WorkflowError;

/**
 * Parse the `[CODE key=value ...]` tag the native layer prepends, if present.
 *
 * Returns the code and any attributes named beside it. For example, a refused
 * start names the run that holds the workflow id as `run_id`.
 */
function tag(error: unknown): { code: string; attributes: Record<string, string> } | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const match = /^\[([A-Z_]+)((?: [a-z_]+=[^\s\]]*)*)\]/.exec(message);
  if (!match) {
    return undefined;
  }
  const attributes: Record<string, string> = {};
  for (const pair of (match[2] ?? '').trim().split(' ').filter(Boolean)) {
    const at = pair.indexOf('=');
    attributes[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return { code: match[1]!, attributes };
}

/**
 * Wrap a native error thrown by a workflow-scoped client call.
 *
 * `workflowId` is used only for the orchestration codes, which name the
 * workflow in their message; anything else falls through to the transport
 * mapping unchanged.
 */
export function wrapWorkflowError(
  error: unknown,
  context: string,
  workflowId: string
): WrappedError {
  const tagged = tag(error);
  switch (tagged?.code) {
    case ErrorCode.WORKFLOW_NOT_FOUND:
      return WorkflowError.notFound(workflowId);

    case ErrorCode.WORKFLOW_ALREADY_EXISTS: {
      // The run holding the id, when the server names it. A caller that meant
      // to start the workflow only once can wait on that run instead.
      const runId = tagged.attributes['run_id'];
      return new WorkflowError(
        runId
          ? `Workflow already exists: ${workflowId} (run ${runId})`
          : `Workflow already exists: ${workflowId}`,
        ErrorCode.WORKFLOW_ALREADY_EXISTS,
        runId ? { workflowId, runId } : { workflowId }
      );
    }

    default:
      return wrapError(error, context);
  }
}

const FAILED_PREFIX = 'Workflow execution failed: ';

/**
 * The failure the server recorded, from a `WORKFLOW_EXECUTION_FAILED` message:
 * `[CODE] <context>: Workflow execution failed: <failure>`.
 */
function recordedFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const at = message.indexOf(FAILED_PREFIX);
  return at === -1
    ? message.replace(/^\[[^\]]*\]\s*/, '')
    : message.slice(at + FAILED_PREFIX.length);
}

/**
 * What the server records as the failure of a run that ended without failing.
 *
 * Read only when the run's status could not be: the status is what says how a
 * run ended, and a workflow could throw an error with one of these messages.
 */
const ENDED_BY: Record<
  string,
  (outcome: WorkflowOutcomeDetails, cause: Error) => WorkflowOutcomeError
> = {
  'Workflow was canceled': (outcome, cause) => new WorkflowCanceledError(outcome, cause),
  'Workflow was terminated': (outcome, cause) => new WorkflowTerminatedError(outcome, cause),
  'Workflow execution timed out': (outcome, cause) => new WorkflowTimedOutError(outcome, cause),
};

/**
 * Whether a native error from waiting for a result says the workflow ended
 * without one, so its status is worth reading to say how.
 */
export function isWorkflowOutcomeFailure(error: unknown): boolean {
  return tag(error)?.code === ErrorCode.WORKFLOW_EXECUTION_FAILED;
}

/**
 * Wrap a native error from waiting for a workflow's result.
 *
 * A run that ended without a result becomes the subclass of
 * `WorkflowOutcomeError` for how it ended. The server answers the wait with
 * only a message, so `status` (the run's status, as `WorkflowHandle.status()`
 * reads it) says which ending it was; without it, the messages the server
 * records for the endings that are not failures are recognized. Anything else
 * is wrapped as by {@link wrapWorkflowError}.
 */
export function wrapWorkflowResultError(
  error: unknown,
  outcome: WorkflowOutcomeDetails,
  status?: string
): WrappedError {
  const cause = error instanceof Error ? error : new Error(String(error));
  switch (tag(error)?.code) {
    case ErrorCode.WORKFLOW_CANCELED:
      return new WorkflowCanceledError(outcome, cause);
    case ErrorCode.WORKFLOW_TERMINATED:
      return new WorkflowTerminatedError(outcome, cause);
    case ErrorCode.WORKFLOW_EXECUTION_FAILED:
      break;
    default:
      return wrapWorkflowError(error, 'Failed to get workflow result', outcome.workflowId);
  }

  const failure = recordedFailure(error);
  switch (status) {
    case 'FAILED':
      return new WorkflowFailedError(outcome, failure, cause);
    case 'CANCELLED':
    case 'CANCELED':
      return new WorkflowCanceledError(outcome, cause);
    case 'TERMINATED':
      return new WorkflowTerminatedError(outcome, cause);
    case 'TIMED_OUT':
      return new WorkflowTimedOutError(outcome, cause);
    default: {
      const endedBy = ENDED_BY[failure];
      return endedBy ? endedBy(outcome, cause) : new WorkflowFailedError(outcome, failure, cause);
    }
  }
}
