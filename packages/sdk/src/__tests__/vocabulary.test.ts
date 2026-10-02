/**
 * The public API speaks Orcher's own terms: events, tasks, restart fresh.
 */

import { ExecutionErrorCode, WorkflowHandle } from '../index';
import { WorkflowHandle as CoreWorkflowHandle } from '../core/client';

describe('public vocabulary', () => {
  it('sends events with sendEvent() alone', () => {
    expect('sendEvent' in WorkflowHandle.prototype).toBe(true);
    expect('signal' in WorkflowHandle.prototype).toBe(false);
    expect('signal' in CoreWorkflowHandle.prototype).toBe(false);
  });

  it('names event errors as events', () => {
    expect(ExecutionErrorCode.EVENT_ERROR).toBe('EVENT_ERROR');
    expect(
      Object.keys(ExecutionErrorCode).filter((code) => /SIGNAL|ACTIVITY|CONTINUE/.test(code))
    ).toEqual([]);
  });
});
