/**
 * Guards the single error base.
 *
 * The errors the client throws must be the same classes the package root
 * exports. Two parallel hierarchies with the same class names would still
 * build, but `instanceof` would always return false, and the only way to notice
 * would be to catch a real error and inspect it. These tests fail if that split
 * appears.
 */

import * as sdk from '../../index';
import { ClientError as CoreClientError, OrcherError as CoreOrcherError } from '../../core/errors';
import { OrchestrationError, WorkflowError, TaskError } from '../index';

describe('error identity', () => {
  it('exports the same class object the client throws', () => {
    // Same name must mean same class.
    expect(sdk.ClientError).toBe(CoreClientError);
    expect(sdk.OrcherError).toBe(CoreOrcherError);
  });

  it('gives transport and orchestration errors one shared base', () => {
    const client = new CoreClientError('nope');
    const workflow = WorkflowError.taskFailed('t', 1, 'boom');

    expect(client).toBeInstanceOf(sdk.OrcherError);
    expect(workflow).toBeInstanceOf(sdk.OrcherError);
    expect(workflow).toBeInstanceOf(OrchestrationError);

    // ...while staying distinguishable.
    expect(client).not.toBeInstanceOf(OrchestrationError);
  });

  it('reports both through isOrcherError, and narrows correctly', () => {
    const client = new CoreClientError('nope');
    const workflow = WorkflowError.taskFailed('t', 1, 'boom');

    expect(sdk.isOrcherError(client)).toBe(true);
    expect(sdk.isOrcherError(workflow)).toBe(true);

    expect(sdk.isClientError(client)).toBe(true);
    expect(sdk.isClientError(workflow)).toBe(false);

    expect(sdk.isOrchestrationError(workflow)).toBe(true);
    expect(sdk.isOrchestrationError(client)).toBe(false);
  });

  it('keeps subclass instanceof intact through the layered base', () => {
    // A base that pins `Object.setPrototypeOf(this, Base.prototype)` rather than
    // `new.target.prototype` silently breaks every subclass.
    expect(TaskError.executionFailed('boom')).toBeInstanceOf(TaskError);
    expect(WorkflowError.taskFailed('t', 1, 'boom')).toBeInstanceOf(WorkflowError);
  });

  it('preserves the orchestration payload on the layered class', () => {
    const workflow = WorkflowError.taskFailed('t', 1, 'boom');

    expect(workflow.code).toBe(sdk.ExecutionErrorCode.TASK_EXECUTION_FAILED);
    expect(workflow.severity).toBeDefined();
    expect(workflow.timestamp).toBeInstanceOf(Date);
  });

  it('exposes both code vocabularies as runtime values', () => {
    // `ErrorCode` must be a runtime export, not `export type`, so that
    // `err.code === ErrorCode.X` can be written.
    expect(typeof sdk.ErrorCode).toBe('object');
    expect(sdk.ErrorCode.NotFound).toBe('NOT_FOUND');
    expect(sdk.ExecutionErrorCode.WORKFLOW_NOT_FOUND).toBe('WORKFLOW_NOT_FOUND');

    // The parser and the enum users compare against must agree.
    expect(sdk.parseErrorCode('[NOT_FOUND] missing')).toBe(sdk.ErrorCode.NotFound);
  });
});
