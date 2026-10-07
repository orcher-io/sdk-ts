/**
 * There is one `ParentClosePolicy`.
 *
 * Two enums shared the name: the package root exported one (`CANCEL`) and
 * the workflow context typed its child workflow options with the other
 * (`REQUEST_CANCEL`). String enums are nominal, so the exported one could not be
 * passed to `ctx.executeChildWorkflow()`. The type assertions are checked by
 * `npm run type-check:tests`; the runtime ones by jest.
 */

import { ParentClosePolicy } from '../index';
import type { WorkflowContext } from '../workflow/context';
import { ParentClosePolicy as ContextParentClosePolicy } from '../workflow/context';

type ChildOptions = NonNullable<Parameters<WorkflowContext['executeChildWorkflow']>[2]>;
type StartChildOptions = NonNullable<Parameters<WorkflowContext['startChildWorkflow']>[2]>;

// The exported enum is the one the context's child workflow calls take.
export const execute: ChildOptions = { parentClosePolicy: ParentClosePolicy.ABANDON };
export const start: StartChildOptions = { parentClosePolicy: ParentClosePolicy.TERMINATE };
export const deprecatedName: ChildOptions = { parentClosePolicy: ParentClosePolicy.CANCEL };

describe('ParentClosePolicy', () => {
  it('is one enum, wherever it is imported from', () => {
    expect(ParentClosePolicy).toBe(ContextParentClosePolicy);
  });

  it('keeps CANCEL as another name for REQUEST_CANCEL', () => {
    // The worker maps REQUEST_CANCEL to the engine's Cancel policy; CANCEL
    // must mean the same rather than falling through to a default.
    expect(ParentClosePolicy.CANCEL).toBe(ParentClosePolicy.REQUEST_CANCEL);
    expect(ParentClosePolicy.REQUEST_CANCEL).toBe('REQUEST_CANCEL');
    expect(ParentClosePolicy.TERMINATE).toBe('TERMINATE');
    expect(ParentClosePolicy.ABANDON).toBe('ABANDON');
  });
});
