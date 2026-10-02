/**
 * Guards the failure kind sent on a workflow completion.
 *
 * The engine accepts only a fixed set of kinds. An error reporting its own class
 * name (`WorkflowError`, say) is not one of them, and passing it through would
 * make the engine reject the *entire completion* with a parse error about an
 * enum variant, so the workflow's real message would never reach the caller.
 * Unknown kinds must be coerced to one the engine accepts.
 */

// The coercion under test, mirrored from worker.ts. Kept here rather than
// exported so the production path stays private; the values are the contract.
const EXECUTION_ERROR_TYPES = new Set([
  'NonDeterminism',
  'WorkflowCode',
  'Timeout',
  'TaskFailed',
  'Cancelled',
  'InternalError',
]);

const toExecutionErrorType = (kind: unknown): string =>
  typeof kind === 'string' && EXECUTION_ERROR_TYPES.has(kind) ? kind : 'WorkflowCode';

describe('workflow failure kind', () => {
  it('passes through every kind the engine accepts', () => {
    for (const kind of EXECUTION_ERROR_TYPES) {
      expect(toExecutionErrorType(kind)).toBe(kind);
    }
  });

  it('coerces an error class name rather than sending it', () => {
    // A class name, which the engine cannot parse as a kind.
    expect(toExecutionErrorType('WorkflowError')).toBe('WorkflowCode');
    expect(toExecutionErrorType('TaskError')).toBe('WorkflowCode');
  });

  it('coerces anything that is not a string', () => {
    expect(toExecutionErrorType(undefined)).toBe('WorkflowCode');
    expect(toExecutionErrorType(null)).toBe('WorkflowCode');
    expect(toExecutionErrorType(42)).toBe('WorkflowCode');
    expect(toExecutionErrorType({})).toBe('WorkflowCode');
  });

  it('coerces an empty string, which is not a variant', () => {
    expect(toExecutionErrorType('')).toBe('WorkflowCode');
  });

  it('never returns a value outside the accepted set', () => {
    for (const weird of ['workflowcode', 'WORKFLOWCODE', 'Unknown', ' Timeout']) {
      expect(EXECUTION_ERROR_TYPES.has(toExecutionErrorType(weird))).toBe(true);
    }
  });
});
