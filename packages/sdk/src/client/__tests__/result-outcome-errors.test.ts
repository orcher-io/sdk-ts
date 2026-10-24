/**
 * `WorkflowHandle.result()` says how a workflow ended without a result.
 *
 * sdk-core refuses the wait with an error code and, for a run that ended, its
 * status, so a failed, a canceled, a terminated and a timed-out workflow each
 * reach the caller as their own class, without a second call to read the
 * status. A refusal that carries no status is classified from the failure the
 * server recorded.
 */

const mockNative = {
  clientCall: jest.fn(),
};

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => mockNative),
  isNativeAvailable: jest.fn(() => true),
}));

import { WorkflowHandle } from '../workflow-handle';
import {
  OrcherError,
  WorkflowError,
  WorkflowOutcomeError,
  WorkflowFailedError,
  WorkflowCanceledError,
  WorkflowTerminatedError,
  WorkflowTimedOutError,
  ExecutionErrorCode,
  TimeoutError,
  UnavailableError,
} from '../../index';
import { ErrorCode, WorkflowStatus, refusal } from './support/client-call';

/** A run that ended without a result, as sdk-core refuses the wait. */
const ended = (recorded: string, status = WorkflowStatus.UNSPECIFIED) =>
  refusal(ErrorCode.WORKFLOW_EXECUTION_FAILED, `Workflow execution failed: ${recorded}`, {
    status,
  });

const handle = () => new WorkflowHandle({} as never, 'order-1', 'run-1');

async function rejection(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected a rejection');
}

describe('WorkflowHandle.result() outcome errors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a failed workflow with WorkflowFailedError and what the server recorded', async () => {
    mockNative.clientCall.mockResolvedValue(
      ended('card declined: insufficient funds', WorkflowStatus.FAILED)
    );

    const err = await rejection(handle().result());

    expect(err).toBeInstanceOf(WorkflowFailedError);
    expect(err.code).toBe(ExecutionErrorCode.WORKFLOW_EXECUTION_FAILED);
    expect(err.failure).toBe('card declined: insufficient funds');
    expect(err.message).toBe('Workflow order-1 failed: card declined: insufficient funds');
    expect(err.workflowId).toBe('order-1');
    expect(err.runId).toBe('run-1');
    expect(err.cause).toBeInstanceOf(Error);
    expect(err.cause.message).toContain('card declined');
  });

  it.each([
    [WorkflowStatus.CANCELLED, WorkflowCanceledError, ExecutionErrorCode.WORKFLOW_CANCELED],
    [WorkflowStatus.TERMINATED, WorkflowTerminatedError, ExecutionErrorCode.WORKFLOW_TERMINATED],
    [WorkflowStatus.TIMED_OUT, WorkflowTimedOutError, ExecutionErrorCode.WORKFLOW_TIMEOUT],
  ])('rejects a workflow ended as %s with its own class', async (status, Class, code) => {
    mockNative.clientCall.mockResolvedValue(ended('ended', status));

    const err = await rejection(handle().result());

    expect(err).toBeInstanceOf(Class);
    expect(err.code).toBe(code);
    expect(err).not.toBeInstanceOf(WorkflowFailedError);
  });

  it.each([
    [ErrorCode.WORKFLOW_CANCELED, WorkflowCanceledError],
    [ErrorCode.WORKFLOW_TERMINATED, WorkflowTerminatedError],
    [ErrorCode.WORKFLOW_TIMEOUT, WorkflowTimedOutError],
  ])('maps the ending sdk-core names by its code (%s)', async (code, Class) => {
    mockNative.clientCall.mockResolvedValue(refusal(code, 'ended'));

    expect(await rejection(handle().result())).toBeInstanceOf(Class);
    expect(mockNative.clientCall).toHaveBeenCalledTimes(1);
  });

  it('keeps every outcome error an OrcherError and a WorkflowError', async () => {
    mockNative.clientCall.mockResolvedValue(ended('boom', WorkflowStatus.FAILED));

    const err = await rejection(handle().result());

    expect(err).toBeInstanceOf(WorkflowOutcomeError);
    expect(err).toBeInstanceOf(WorkflowError);
    expect(err).toBeInstanceOf(OrcherError);
  });

  it('takes the status over a failure message that looks like another ending', async () => {
    // A workflow may throw an error whose message is the one the server
    // records for a cancellation; the status says it failed.
    mockNative.clientCall.mockResolvedValue(ended('Workflow was canceled', WorkflowStatus.FAILED));

    expect(await rejection(handle().result())).toBeInstanceOf(WorkflowFailedError);
  });

  it('falls back to the recorded message when the refusal carries no status', async () => {
    mockNative.clientCall.mockResolvedValue(ended('Workflow was terminated'));

    expect(await rejection(handle().result())).toBeInstanceOf(WorkflowTerminatedError);
  });

  it('is still a WorkflowFailedError when neither status nor message says more', async () => {
    mockNative.clientCall.mockResolvedValue(ended('boom'));

    const err = await rejection(handle().result());
    expect(err).toBeInstanceOf(WorkflowFailedError);
    expect(err.failure).toBe('boom');
  });

  it('leaves failures to read the result on their own classes', async () => {
    mockNative.clientCall.mockResolvedValue(refusal(ErrorCode.UNAVAILABLE, 'connection refused'));
    const unavailable = await rejection(handle().result());
    expect(unavailable).toBeInstanceOf(UnavailableError);
    expect(unavailable).not.toBeInstanceOf(WorkflowOutcomeError);

    mockNative.clientCall.mockResolvedValue(
      refusal(ErrorCode.WORKFLOW_NOT_FOUND, 'Workflow not found')
    );
    const missing = await rejection(handle().result());
    expect(missing.code).toBe(ExecutionErrorCode.WORKFLOW_NOT_FOUND);
    expect(missing).not.toBeInstanceOf(WorkflowOutcomeError);
  });

  it('gives resultWithTimeout() the same classes', async () => {
    mockNative.clientCall.mockResolvedValue(ended('boom', WorkflowStatus.CANCELLED));

    expect(await rejection(handle().resultWithTimeout(1_000))).toBeInstanceOf(
      WorkflowCanceledError
    );
  });

  it('keeps the caller giving up waiting a TimeoutError, not a timed-out workflow', async () => {
    mockNative.clientCall.mockReturnValue(new Promise(() => undefined));

    const err = await rejection(handle().resultWithTimeout(5));
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err).not.toBeInstanceOf(WorkflowTimedOutError);
  });
});
