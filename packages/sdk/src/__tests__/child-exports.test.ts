/**
 * A workflow can tell a failed child apart from other errors with the
 * package's own exports.
 */

import * as sdk from '../index';
import { ChildWorkflowFailedError } from '../workflow/child-handle';

describe('child workflow exports', () => {
  it('exports the error a failed child raises, and its handle', () => {
    expect(sdk.ChildWorkflowFailedError).toBe(ChildWorkflowFailedError);
    expect(typeof sdk.ChildWorkflowHandle).toBe('function');
  });
});
