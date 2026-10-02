/**
 * Dependency injection for Orcher workers.
 * @packageDocumentation
 *
 * Decorated classes register themselves in the {@link GlobalRegistry} when their module loads.
 * The worker reads the registry, registers services in an {@link OrcherContainer}, and builds
 * task handler instances with their constructor dependencies injected.
 *
 * Main pieces:
 * - `@Injectable()` registers a service (`singleton` by default, or `transient`).
 * - `@Tasks()` marks a class whose methods are tasks; its constructor receives injected
 *   services.
 * - `@Task()` marks a task method and attaches a static `TaskReference` to the class.
 * - `@Workflow()` registers a workflow class. Workflows take no injected dependencies.
 * - `@Inject()` injects by a custom token (symbol, string, or class).
 * - `createTaskRefs()` returns the typed task references of a `@Tasks` class.
 *
 * @example
 * Basic usage:
 * ```typescript
 * import { Injectable, Tasks, Task, Workflow, createTaskRefs } from '@orcher/sdk';
 * import type { TaskContext, WorkflowContext } from '@orcher/sdk';
 *
 * @Injectable()
 * class EmailService {
 *   async send(to: string, subject: string) {
 *     return { messageId: 'msg_123', to, subject };
 *   }
 * }
 *
 * @Tasks()
 * class EmailTasks {
 *   constructor(private email: EmailService) {}
 *
 *   @Task()
 *   async sendReceipt(ctx: TaskContext, input: { to: string; orderId: string }) {
 *     return this.email.send(input.to, `Receipt for order ${input.orderId}`);
 *   }
 * }
 *
 * const emailTasks = createTaskRefs(EmailTasks);
 *
 * @Workflow({ name: 'order-receipt' })
 * class OrderReceiptWorkflow {
 *   async run(ctx: WorkflowContext, input: { to: string; orderId: string }) {
 *     return ctx.executeTask(emailTasks.sendReceipt, input);
 *   }
 * }
 * ```
 *
 * @example
 * Custom token injection:
 * ```typescript
 * const ILogger = Symbol('ILogger');
 *
 * @Injectable()
 * class UserService {
 *   constructor(
 *     @Inject(ILogger) private logger: any,
 *     @Inject('API_KEY') private apiKey: string
 *   ) {}
 * }
 * ```
 *
 * Workflows take no injected dependencies: workflow code is replayed from the
 * journal and must produce the same commands each time, which an injected
 * service cannot be relied on to do. Side effects belong in tasks.
 */

export { OrcherContainer } from './container';
export { GlobalRegistry, globalRegistry } from './registry';

export * from './types';

export * from './errors';

export * from './decorators';

export type {
  Token,
  Type,
  Scope,
  Provider,
  TaskReference,
  TaskRefs,
  OnInit,
  OnDestroy,
  InjectableOptions,
  TasksOptions,
  TaskOptions,
  WorkflowOptions,
} from './types';

export { createTaskRefs } from './types';

