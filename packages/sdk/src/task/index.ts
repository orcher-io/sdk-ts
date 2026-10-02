/**
 * Task execution context and cancellation.
 *
 * Tasks themselves are defined with the class-based `@Tasks()` and `@Task()`
 * decorators or the functional `task()` API.
 *
 * ## Key Exports
 *
 * - **TaskContext**: Execution context passed to task functions
 * - **CancellationToken**: Token for advanced cancellation patterns
 * - **Types**: Task execution metadata and heartbeat messages
 *
 * @packageDocumentation
 */

export { TaskContext, CancellationToken } from './context';
export type { TaskExecution, HeartbeatMessage } from './context';

// Task metadata is part of the DI system; the package root exports it as
// `DITaskMetadata`.
