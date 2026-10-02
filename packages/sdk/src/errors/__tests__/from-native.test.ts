/**
 * Guards cross-SDK agreement on what a failure is called.
 *
 * The same server condition must produce the same code in the Rust, Python and
 * TypeScript SDKs (for example `WORKFLOW_NOT_FOUND`), so error handling can be
 * written once and read across languages.
 */

import { wrapWorkflowError } from '../from-native';
import { ErrorCode, WorkflowError } from '../index';
import { NotFoundError, UnavailableError } from '../../core/errors';

const tagged = (code: string, message: string) => new Error(`[${code}] ${message}`);

describe('wrapWorkflowError', () => {
  it('maps a workflow-scoped miss to the orchestration class and code', () => {
    const err = wrapWorkflowError(
      tagged('WORKFLOW_NOT_FOUND', 'Workflow not found: wf-1'),
      'Failed to get workflow status',
      'wf-1'
    );

    expect(err).toBeInstanceOf(WorkflowError);
    expect(err.code).toBe(ErrorCode.WORKFLOW_NOT_FOUND);
    expect(err.message).toContain('wf-1');
  });

  it('maps a duplicate start to the orchestration class and code', () => {
    const err = wrapWorkflowError(
      tagged('WORKFLOW_ALREADY_EXISTS', 'exists'),
      'Failed to start workflow',
      'wf-1'
    );

    expect(err).toBeInstanceOf(WorkflowError);
    expect(err.code).toBe(ErrorCode.WORKFLOW_ALREADY_EXISTS);
  });

  it('names the run holding the id, when the refusal does', () => {
    // A caller that meant to start the workflow once needs the run already
    // doing the work; dropping it leaves them no way to reach that run.
    const err = wrapWorkflowError(
      tagged('WORKFLOW_ALREADY_EXISTS run_id=5b0c6a1e-run', 'Failed to start workflow: exists'),
      'Failed to start workflow',
      'wf-1'
    ) as WorkflowError;

    expect(err).toBeInstanceOf(WorkflowError);
    expect(err.code).toBe(ErrorCode.WORKFLOW_ALREADY_EXISTS);
    expect(err.details).toEqual({ workflowId: 'wf-1', runId: '5b0c6a1e-run' });
  });

  it('leaves genuine transport failures on the transport vocabulary', () => {
    // A workflow-scoped call can still fail for reasons that are not about the
    // workflow. Those keep the gRPC spelling rather than being relabeled.
    const err = wrapWorkflowError(
      tagged('UNAVAILABLE', 'connection refused'),
      'Failed to get workflow status',
      'wf-1'
    );

    expect(err).toBeInstanceOf(UnavailableError);
    expect(err).not.toBeInstanceOf(WorkflowError);
  });

  it('still maps a bare NOT_FOUND, which is not attributable to a workflow', () => {
    const err = wrapWorkflowError(tagged('NOT_FOUND', 'missing'), 'ctx', 'wf-1');

    expect(err).toBeInstanceOf(NotFoundError);
  });

  it('passes through an untagged error rather than inventing a code', () => {
    const err = wrapWorkflowError(new Error('something else'), 'ctx', 'wf-1');

    expect(err).not.toBeInstanceOf(WorkflowError);
    expect(err.message).toContain('something else');
  });
});
