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
import { ErrorCode, WorkflowError } from './index';

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
