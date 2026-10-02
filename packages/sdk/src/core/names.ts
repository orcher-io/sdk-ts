/**
 * Naming rules for events and queries.
 *
 * The same rule is enforced in four places: the workflow-side event helpers,
 * the client-side ones, the workflow handle, and query names. Sharing one
 * definition guarantees that a name the sender accepts is never rejected by
 * the receiver.
 *
 * Dots are allowed. `provider.status` and `order.shipped` are how most
 * codebases name events, and nothing below this layer objects to them.
 */

/** Characters an event or query name may contain. */
export const NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

/** Human-readable form of {@link NAME_PATTERN}, for error messages. */
export const NAME_RULE = 'alphanumeric characters, dots, underscores, and hyphens';

/** Longest accepted event or query name. */
export const MAX_NAME_LENGTH = 255;

/**
 * Whether a name is made only of the characters events and queries allow.
 *
 * Emptiness and length are checked by the caller, which owns the error type.
 */
export function hasValidNameCharacters(name: string): boolean {
  return NAME_PATTERN.test(name);
}
