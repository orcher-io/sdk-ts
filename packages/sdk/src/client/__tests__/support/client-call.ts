/**
 * Encoded client protocol messages, for tests that stand in for the native
 * `clientCall`: what a call carried, and answers to give it.
 */

import {
  ClientAnswer,
  ClientCall,
  ErrorCode,
  WorkflowStatus,
} from '../../../core/generated/client';

/** The call a `clientCall` was handed. */
export function sentCall(bytes: Uint8Array): ClientCall {
  return ClientCall.fromBinary(bytes);
}

/** An encoded answer. */
export function answer(what: ClientAnswer['answer']): Uint8Array {
  return ClientAnswer.toBinary(ClientAnswer.create({ answer: what }));
}

/** An encoded refusal with `code`, `message` and how the run ended. */
export function refusal(
  code: ErrorCode,
  message: string,
  extra: { status?: WorkflowStatus; runId?: string } = {}
): Uint8Array {
  return answer({
    oneofKind: 'error',
    error: {
      code,
      message,
      retryable: false,
      runId: extra.runId ?? '',
      status: extra.status ?? WorkflowStatus.UNSPECIFIED,
    },
  });
}

/** The encoded answer of a call that answers nothing. */
export function done(): Uint8Array {
  return answer({ oneofKind: 'done', done: {} });
}

export { ErrorCode, WorkflowStatus };
