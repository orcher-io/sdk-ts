/**
 * Client calls through sdk-core's client protocol (`orcher.client.v1`).
 *
 * Every client call is one encoded `ClientCall` handed to the native
 * connection, answered with one encoded `ClientAnswer`. This module builds the
 * calls, reads the answers, and turns a refused call into the error the SDK
 * documents, from the protocol's error code rather than any message text.
 *
 * @internal
 */

import {
  ClientAnswer,
  ClientCall,
  ErrorCode as ProtocolErrorCode,
  WorkflowStatus as ProtocolStatus,
} from '../core/generated/client';
import type {
  ClientError as ProtocolError,
  WorkflowDescription,
  WorkflowPage,
  WorkflowSummary,
} from '../core/generated/client';
import type { Duration } from '../core/generated/google/protobuf/duration';
import type { Timestamp } from '../core/generated/google/protobuf/timestamp';
import { getNativeModule } from '../core/native';
import type {
  NativeClientHandle,
  ParentExecutionInfo,
  WorkflowExecutionDescription,
  WorkflowExecutionInfo,
  WorkflowListPage,
} from '../core/types';
import { WorkflowStatus } from '../core/types';

/** A call, without the envelope fields every call may leave out. */
export type Call = ClientCall['call'];

/** What a call answered, when it did not fail. */
export type Answer = Exclude<ClientAnswer['answer'], { oneofKind: 'error' | undefined }>;

/**
 * The error a refused call is, in the tagged form the SDK's error mapping
 * reads (`[CODE run_id=…] message`), with how the run ended when it ended
 * without a result.
 */
export class RefusedCall extends Error {
  constructor(
    readonly refusal: ProtocolError,
    readonly status: WorkflowStatus | undefined
  ) {
    const code = ProtocolErrorCode[refusal.code] ?? 'UNKNOWN';
    const runId = refusal.runId && !/[\s\]]/.test(refusal.runId) ? ` run_id=${refusal.runId}` : '';
    super(`[${code}${runId}] ${refusal.message}`);
    this.name = 'RefusedCall';
  }
}

/**
 * Make `call` on `client` and return what it answered.
 *
 * @throws {RefusedCall} If the call was refused
 */
export async function call(
  client: NativeClientHandle,
  what: Call,
  envelope: { namespace?: string; timeoutMs?: number } = {}
): Promise<Answer> {
  const message = ClientCall.create({
    call: what,
    namespace: envelope.namespace ?? '',
    ...(envelope.timeoutMs !== undefined ? { timeout: duration(envelope.timeoutMs) } : {}),
  });
  const bytes = await getNativeModule().clientCall(client, ClientCall.toBinary(message));
  const answer = ClientAnswer.fromBinary(new Uint8Array(bytes)).answer;
  if (answer.oneofKind === 'error') {
    throw new RefusedCall(answer.error, statusOf(answer.error.status));
  }
  if (answer.oneofKind === undefined) {
    throw new Error('[INTERNAL] the call was answered with nothing');
  }
  return answer;
}

/** The answer of kind `kind`, or an error naming what came instead. */
export function expect<K extends Answer['oneofKind']>(
  answer: Answer,
  kind: K
): Extract<Answer, { oneofKind: K }> {
  if (answer.oneofKind !== kind) {
    throw new Error(`[INTERNAL] expected a ${kind} answer, got ${answer.oneofKind}`);
  }
  return answer as Extract<Answer, { oneofKind: K }>;
}

// ---- Values ----

/** A value as the JSON a workflow, query, update or event reads. */
export function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value === undefined ? null : value) ?? 'null');
}

/** A JSON value as it came back; `null` for nothing at all. */
export function decodeJson(data: Uint8Array): unknown {
  return data.length === 0 ? null : JSON.parse(new TextDecoder().decode(data));
}

/** `ms` milliseconds as a protocol duration. */
export function duration(ms: number): Duration {
  const whole = Math.floor(ms);
  return { seconds: String(Math.floor(whole / 1000)), nanos: (whole % 1000) * 1_000_000 };
}

// ---- Statuses ----

const STATUSES: Partial<Record<ProtocolStatus, WorkflowStatus>> = {
  [ProtocolStatus.RUNNING]: WorkflowStatus.Running,
  [ProtocolStatus.COMPLETED]: WorkflowStatus.Completed,
  [ProtocolStatus.FAILED]: WorkflowStatus.Failed,
  [ProtocolStatus.CANCELLED]: WorkflowStatus.Cancelled,
  [ProtocolStatus.TERMINATED]: WorkflowStatus.Terminated,
  [ProtocolStatus.TIMED_OUT]: WorkflowStatus.TimedOut,
};

/** A protocol status as the SDK's; `undefined` for none. */
export function statusOf(status: ProtocolStatus): WorkflowStatus | undefined {
  if (status === ProtocolStatus.UNSPECIFIED) {
    return undefined;
  }
  return STATUSES[status] ?? WorkflowStatus.Unknown;
}

/** A status the SDK names, as the protocol numbers it. */
export function protocolStatus(status: string): ProtocolStatus {
  const named = (ProtocolStatus as unknown as Record<string, ProtocolStatus>)[status.toUpperCase()];
  if (named === undefined) {
    throw new Error(`[INVALID_ARGUMENT] unknown workflow status ${status}`);
  }
  return named;
}

// ---- Reading what a call answered ----

type SystemTime = { secs_since_epoch: number; nanos_since_epoch: number };

function time(t: Timestamp | undefined): SystemTime | undefined {
  return t ? { secs_since_epoch: Number(t.seconds), nanos_since_epoch: t.nanos } : undefined;
}

function seconds(d: Duration | undefined): number | undefined {
  return d ? Number(d.seconds) : undefined;
}

function parent(summary: WorkflowSummary): ParentExecutionInfo | undefined {
  return summary.parent
    ? {
        namespace: summary.parent.namespace,
        workflowId: summary.parent.workflow?.workflowId ?? '',
        executionId: summary.parent.workflow?.runId ?? '',
      }
    : undefined;
}

function statusName(status: ProtocolStatus): string {
  return statusOf(status) ?? WorkflowStatus.Unknown;
}

/** A run as a list or search reports it. */
export function executionInfo(summary: WorkflowSummary): WorkflowExecutionInfo {
  return {
    workflowId: summary.workflow?.workflowId ?? '',
    executionId: summary.workflow?.runId ?? '',
    workflowType: summary.workflowType,
    taskQueue: summary.taskQueue,
    namespace: summary.namespace,
    status: statusName(summary.status),
    startTime: time(summary.startTime),
    closeTime: time(summary.closeTime),
    executionDurationSeconds: seconds(summary.executionDuration),
    journalLength: Number(summary.journalLength),
    parentExecution: parent(summary),
    searchAttributes: { ...summary.labels },
    memo: { ...summary.annotations },
    tags: [...summary.tags],
    startedBy: summary.startedBy,
    attempt: summary.attempt,
    cronSchedule: summary.cronSchedule,
    stateTransitionCount: Number(summary.stateTransitionCount),
  };
}

/** One page of runs. */
export function listPage(page: WorkflowPage): WorkflowListPage {
  return {
    executions: page.workflows.map(executionInfo),
    nextPageToken: Array.from(page.nextPageToken),
  };
}

/** A run in full. */
export function description(d: WorkflowDescription): WorkflowExecutionDescription {
  const summary = d.summary;
  const info = summary ? executionInfo(summary) : undefined;
  const config = d.config;
  return {
    execution: { workflowId: info?.workflowId ?? '', runId: info?.executionId ?? '' },
    workflowType: info?.workflowType ?? '',
    taskQueue: info?.taskQueue ?? '',
    status: info?.status ?? WorkflowStatus.Unknown,
    startTime: info?.startTime,
    closeTime: info?.closeTime,
    journalLength: info?.journalLength ?? 0,
    attempt: info?.attempt ?? 0,
    searchAttributes: info?.searchAttributes ?? {},
    memo: info?.memo ?? {},
    tags: info?.tags ?? [],
    startedBy: info?.startedBy ?? '',
    cronSchedule: info?.cronSchedule ?? '',
    stateTransitionCount: info?.stateTransitionCount ?? 0,
    parentExecution: info?.parentExecution,
    pendingTasks: d.pendingTasks,
    pendingTimers: d.pendingTimers,
    pendingEvents: d.pendingEvents,
    executionConfig: config
      ? {
          taskQueue: config.taskQueue,
          executionTimeoutSeconds: seconds(config.executionTimeout),
          runTimeoutSeconds: seconds(config.runTimeout),
          defaultTaskTimeoutSeconds: seconds(config.taskTimeout),
          retryPolicy: config.retryPolicy
            ? {
                initialIntervalSeconds: seconds(config.retryPolicy.initialInterval) ?? 0,
                backoffCoefficient: config.retryPolicy.backoffCoefficient,
                maxIntervalSeconds: seconds(config.retryPolicy.maxInterval) ?? 0,
                maxAttempts: config.retryPolicy.maxAttempts,
                nonRetryableErrorTypes: [...config.retryPolicy.nonRetryableErrors],
              }
            : undefined,
          cronSchedule: config.cronSchedule,
        }
      : undefined,
  };
}
