/**
 * `WorkflowHandle.result()` says how a workflow ended without a result.
 *
 * sdk-core reports every such ending as one error, which reached callers as a
 * generic `OrcherError` with code `UNKNOWN`: a failed, a canceled and a
 * terminated workflow could not be told apart. The binding now tags it
 * `WORKFLOW_EXECUTION_FAILED`, and the handle reads the run's status to pick
 * the class.
 *
 * The native messages below are the binding's exact format:
 * `[CODE] <context>: <sdk-core error>`.
 */

const mockNative = {
  workflowHandleGetResult: jest.fn(),
  workflowHandleGetStatus: jest.fn(),
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

const ended = (recorded: string) =>
  new Error(
    `[WORKFLOW_EXECUTION_FAILED] Failed to get workflow result: Workflow execution failed: ${recorded}`
  );

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
    mockNative.workflowHandleGetResult.mockRejectedValue(
      ended('card declined: insufficient funds')
    );
    mockNative.workflowHandleGetStatus.mockResolvedValue('FAILED');

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
    [
      'CANCELLED',
      WorkflowCanceledError,
      ExecutionErrorCode.WORKFLOW_CANCELED,
      'Workflow was canceled',
    ],
    [
      'TERMINATED',
      WorkflowTerminatedError,
      ExecutionErrorCode.WORKFLOW_TERMINATED,
      'Workflow was terminated',
    ],
    [
      'TIMED_OUT',
      WorkflowTimedOutError,
      ExecutionErrorCode.WORKFLOW_TIMEOUT,
      'Workflow execution timed out',
    ],
  ])('rejects a %s workflow with its own class', async (status, Class, code, recorded) => {
    mockNative.workflowHandleGetResult.mockRejectedValue(ended(recorded));
    mockNative.workflowHandleGetStatus.mockResolvedValue(status);

    const err = await rejection(handle().result());

    expect(err).toBeInstanceOf(Class);
    expect(err.code).toBe(code);
    expect(err).not.toBeInstanceOf(WorkflowFailedError);
  });

  it('keeps every outcome error an OrcherError and a WorkflowError', async () => {
    mockNative.workflowHandleGetResult.mockRejectedValue(ended('boom'));
    mockNative.workflowHandleGetStatus.mockResolvedValue('FAILED');

    const err = await rejection(handle().result());

    expect(err).toBeInstanceOf(WorkflowOutcomeError);
    expect(err).toBeInstanceOf(WorkflowError);
    expect(err).toBeInstanceOf(OrcherError);
  });

  it('takes the status over a failure message that looks like another ending', async () => {
    // A workflow may throw an error whose message is the one the server
    // records for a cancellation; the status says it failed.
    mockNative.workflowHandleGetResult.mockRejectedValue(ended('Workflow was canceled'));
    mockNative.workflowHandleGetStatus.mockResolvedValue('FAILED');

    expect(await rejection(handle().result())).toBeInstanceOf(WorkflowFailedError);
  });

  it('falls back to the recorded message when the status cannot be read', async () => {
    mockNative.workflowHandleGetResult.mockRejectedValue(ended('Workflow was terminated'));
    mockNative.workflowHandleGetStatus.mockRejectedValue(new Error('[UNAVAILABLE] gone'));

    expect(await rejection(handle().result())).toBeInstanceOf(WorkflowTerminatedError);
  });

  it('is still a WorkflowFailedError when neither status nor message says more', async () => {
    mockNative.workflowHandleGetResult.mockRejectedValue(ended('boom'));
    mockNative.workflowHandleGetStatus.mockRejectedValue(new Error('[UNAVAILABLE] gone'));

    const err = await rejection(handle().result());
    expect(err).toBeInstanceOf(WorkflowFailedError);
    expect(err.failure).toBe('boom');
  });

  it('maps the cancellation and termination sdk-core can report directly', async () => {
    mockNative.workflowHandleGetResult.mockRejectedValue(
      new Error(
        '[WORKFLOW_CANCELED] Failed to get workflow result: Workflow cancelled: workflow_id=order-1'
      )
    );
    expect(await rejection(handle().result())).toBeInstanceOf(WorkflowCanceledError);

    mockNative.workflowHandleGetResult.mockRejectedValue(
      new Error(
        '[WORKFLOW_TERMINATED] Failed to get workflow result: Workflow terminated: workflow_id=order-1, reason=None'
      )
    );
    expect(await rejection(handle().result())).toBeInstanceOf(WorkflowTerminatedError);
    expect(mockNative.workflowHandleGetStatus).not.toHaveBeenCalled();
  });

  it('leaves failures to read the result on their own classes, without a status read', async () => {
    mockNative.workflowHandleGetResult.mockRejectedValue(
      new Error('[UNAVAILABLE] Failed to get workflow result: connection refused')
    );
    const unavailable = await rejection(handle().result());
    expect(unavailable).toBeInstanceOf(UnavailableError);
    expect(unavailable).not.toBeInstanceOf(WorkflowOutcomeError);

    mockNative.workflowHandleGetResult.mockRejectedValue(
      new Error('[WORKFLOW_NOT_FOUND] Failed to get workflow result: Workflow not found')
    );
    const missing = await rejection(handle().result());
    expect(missing.code).toBe(ExecutionErrorCode.WORKFLOW_NOT_FOUND);
    expect(missing).not.toBeInstanceOf(WorkflowOutcomeError);

    expect(mockNative.workflowHandleGetStatus).not.toHaveBeenCalled();
  });

  it('gives resultWithTimeout() the same classes', async () => {
    mockNative.workflowHandleGetResult.mockRejectedValue(ended('boom'));
    mockNative.workflowHandleGetStatus.mockResolvedValue('CANCELLED');

    expect(await rejection(handle().resultWithTimeout(1_000))).toBeInstanceOf(
      WorkflowCanceledError
    );
  });

  it('keeps the caller giving up waiting a TimeoutError, not a timed-out workflow', async () => {
    mockNative.workflowHandleGetResult.mockReturnValue(new Promise(() => undefined));

    const err = await rejection(handle().resultWithTimeout(5));
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err).not.toBeInstanceOf(WorkflowTimedOutError);
  });
});
