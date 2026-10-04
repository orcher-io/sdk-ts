<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/orcher-io/sdk-ts/main/assets/banner.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/orcher-io/sdk-ts/main/assets/banner-light.svg">
    <img alt="ORCHER TypeScript SDK" src="https://raw.githubusercontent.com/orcher-io/sdk-ts/main/assets/banner.svg" width="100%">
  </picture>
</p>

<p align="center"><sub>Crash-proof workflows, written as plain async TypeScript.</sub></p>

<br />

<div>
  <a href="https://www.npmjs.com/package/@orcher/sdk"><img src="https://img.shields.io/npm/v/@orcher/sdk?style=flat-square&labelColor=0a0a0a&color=04B385&logo=npm&logoColor=white" alt="npm"></a>
  <a href="https://github.com/orcher-io/sdk-ts/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/orcher-io/sdk-ts/ci.yml?branch=main&style=flat-square&labelColor=0a0a0a&color=38BDF0&logo=github&logoColor=white&label=CI" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-04B385?style=flat-square&labelColor=0a0a0a" alt="Apache 2.0"></a>
</div>

<br />

Write async functions; ORCHER journals each step and resumes interrupted runs where they stopped.

- <img height="14" src="https://octicons-col.vercel.app/sync/38BDF0"> **Durable**: every step journaled; crashed runs resume on another worker
- <img height="14" src="https://octicons-col.vercel.app/code/38BDF0"> **Plain TypeScript**: `@Workflow` and `@Task` decorated classes, or plain functions; no DSL
- <img height="14" src="https://octicons-col.vercel.app/history/38BDF0"> **Deterministic replay**: step ids, time and randomness stay the same on every replay
- <img height="14" src="https://octicons-col.vercel.app/iterations/38BDF0"> **Smart retries**: per-task policies and never-retry error types
- <img height="14" src="https://octicons-col.vercel.app/clock/38BDF0"> **Timers and events**: sleep for days or wait for an outside event
- <img height="14" src="https://octicons-col.vercel.app/git-branch/38BDF0"> **Child workflows**: compose and run workflows in parallel
- <img height="14" src="https://octicons-col.vercel.app/database/38BDF0"> **Actors**: stateful objects with a single writer per key
- <img height="14" src="https://octicons-col.vercel.app/beaker/38BDF0"> **Testing**: run workflows in memory with mocks and a fake clock
- <img height="14" src="https://octicons-col.vercel.app/shield-lock/38BDF0"> **Multi-tenant**: API keys, organizations and namespaces built in

<br />

### <img height="16" src="https://octicons-col.vercel.app/download/38BDF0"> Install

```bash
npm install @orcher/sdk
```

Workflows and tasks are decorated classes, so enable decorators in
`tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

> [!NOTE]
> You need Node.js 22 or later and an ORCHER engine to run workflows against.
> The SDK runs on a native core; npm installs the prebuilt one for your
> platform (macOS arm64 and x64, Linux x64 and arm64 with glibc or musl). The
> SDK is pre-1.0: the API may change between minor releases, and every
> breaking change is listed in [CHANGELOG.md](packages/sdk/CHANGELOG.md).

<br />

### <img height="16" src="https://octicons-col.vercel.app/play/38BDF0"> Quick start

Define tasks as methods of a `@Tasks()` class and a workflow as a
`@Workflow()` class with a `run` method. Both register themselves when their
module is imported, and the worker runs everything registered:

```typescript
import {
  Task, Tasks, Worker, Workflow, createTaskRefs,
  type TaskContext, type WorkflowContext,
} from '@orcher/sdk';

interface Order {
  id: string;
  email: string;
}

@Tasks()
export class OrderTasks {
  @Task({ retryPolicy: { maxAttempts: 3 } })
  async sendConfirmation(_ctx: TaskContext, order: Order): Promise<string> {
    return `sent confirmation for ${order.id} to ${order.email}`;
  }
}

export const orderTasks = createTaskRefs(OrderTasks);

@Workflow({ name: 'confirm-order' })
export class ConfirmOrder {
  async run(ctx: WorkflowContext, order: Order): Promise<string> {
    return ctx.executeTask(orderTasks.sendConfirmation, order);
  }
}

const worker = await Worker.builder()
  .serverUrl('http://localhost:50051')
  .namespace('default')
  .taskQueue('orders')
  .build();

await worker.run();
```

A `@Tasks()` class can take constructor dependencies, which the worker injects
for each task run; a workflow class takes none, because it is replayed.

<details>
<summary>Prefer plain functions? The same workflow without decorators</summary>

<br />

```typescript
import { task, workflow, type TaskContext, type WorkflowContext } from '@orcher/sdk';

export const sendConfirmation = task({
  name: 'send-confirmation',
  retryPolicy: { maxAttempts: 3 },
  execute: async (_ctx: TaskContext, order: Order) =>
    `sent confirmation for ${order.id} to ${order.email}`,
});

export const confirmOrder = workflow({
  name: 'confirm-order',
  run: async (ctx: WorkflowContext, order: Order) => ctx.executeTask(sendConfirmation, order),
});
```

</details>

Start it from any process and wait for the result:

```typescript
import { Client } from '@orcher/sdk';

const client = new Client({ serverUrl: 'http://localhost:50051', namespace: 'default' });
await client.connect();

const handle = await client.startWorkflow<string>({
  workflowType: 'confirm-order',
  taskQueue: 'orders',
  args: [{ id: 'order-1', email: 'ada@example.com' }],
});
const receipt = await handle.result();
```

> [!TIP]
> Workflow code is replayed from its history every time it resumes, so it must
> be deterministic. Do I/O and anything else that touches the outside world in
> tasks, and use `ctx.time`, `ctx.random` and `ctx.sleep()` in workflows.

<br />

### <img height="16" src="https://octicons-col.vercel.app/book/38BDF0"> Guide

<details>
<summary><b>Timers</b>: sleep for minutes or months</summary>

<br />

A timer is recorded by the engine, so no worker is busy while it runs, and a
restart doesn't reset it:

```typescript
import { Duration, Workflow, type WorkflowContext } from '@orcher/sdk';

@Workflow({ name: 'trial' })
export class Trial {
  async run(ctx: WorkflowContext, email: string): Promise<void> {
    await ctx.sleep(Duration.fromDays(14));
    await ctx.executeTask(accountTasks.sendTrialEnded, email);
  }
}
```

</details>

<details>
<summary><b>Events</b>: wait for something outside the workflow</summary>

<br />

A workflow can park until a named event arrives, optionally with a deadline:

```typescript
import { Duration, Workflow, type WorkflowContext } from '@orcher/sdk';

@Workflow({ name: 'approval' })
export class Approval {
  async run(ctx: WorkflowContext, requestId: string): Promise<string> {
    const approved = await ctx.waitForEventWithTimeout<boolean>('approved', Duration.fromDays(3));
    if (approved === null) return `${requestId} expired`;
    return approved ? `${requestId} approved` : `${requestId} rejected`;
  }
}
```

Send the event from a client:

```typescript
const handle = client.getWorkflowHandle({ workflowId: 'approval-42' });
await handle.sendEvent('approved', true);
```

</details>

<details>
<summary><b>Child workflows</b>: compose workflows from workflows</summary>

<br />

```typescript
import { Workflow, type WorkflowContext } from '@orcher/sdk';

@Workflow({ name: 'ship-order' })
export class ShipOrder {
  async run(ctx: WorkflowContext, orderId: string): Promise<string> {
    const label = await ctx.executeChildWorkflow<string>('print-label', orderId);
    return `${orderId} shipped with ${label}`;
  }
}
```

`ctx.startChildWorkflow()` returns a handle instead, to run several children
at once and collect their results later.

</details>

<details>
<summary><b>Retries</b>: decide which failures are worth retrying</summary>

<br />

A failure's type is the error's `name`, or its class name when it has none.
List the types never to retry in the task's policy. An error with a truthy
`nonRetryable` property is never retried, whatever the policy allows:

```typescript
import { Task, Tasks, type TaskContext } from '@orcher/sdk';

class CardDeclined extends Error {}

class AccountClosed extends Error {
  readonly nonRetryable = true;
}

@Tasks()
export class PaymentTasks {
  @Task({ retryPolicy: { maxAttempts: 5, nonRetryableErrorTypes: ['CardDeclined'] } })
  async charge(_ctx: TaskContext, orderId: string): Promise<string> {
    // Runs once:
    throw new CardDeclined(`card declined for ${orderId}`);
    // Also runs once, listed or not:
    // throw new AccountClosed(`account closed for ${orderId}`);
  }
}
```

Any other error is retried. Set `name` in the constructor if your build
minifies class names.

</details>

<details>
<summary><b>Large payloads</b>: what fits, and what happens when it doesn't</summary>

<br />

Workers and clients send and receive gRPC messages of up to 32 MiB; set
`ORCHER_MAX_MESSAGE_BYTES` to change that. The engine accepts one payload (an
input, a result, an event) of up to 8 MiB unless configured otherwise. A task
whose result is too large fails straight away with a `PayloadTooLarge` failure
that says how large it was, and is not retried: store large data elsewhere and
pass a reference.

</details>

<details>
<summary><b>Time and randomness</b>: the replay-safe way</summary>

<br />

`ctx.time` reads the time the engine recorded, and `ctx.random` is seeded from
the run, so both give the same answer every time the workflow is replayed:

```typescript
import { Workflow, type WorkflowContext } from '@orcher/sdk';

@Workflow({ name: 'invoice' })
export class Invoice {
  async run(ctx: WorkflowContext, customer: string): Promise<string> {
    const number = ctx.random.uuid();
    const issuedAt = ctx.time.now();
    return `invoice ${number} for ${customer}, issued at ${issuedAt.toISOString()}`;
  }
}
```

</details>

<details>
<summary><b>Testing</b>: run workflows in memory</summary>

<br />

`@orcher/sdk/testing` runs a workflow without an engine, with its tasks
mocked by name (a task's name is its method name unless `@Task` sets one):

```typescript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkflowContext } from '@orcher/sdk';
import { TestWorkflowEnvironment } from '@orcher/sdk/testing';

test('confirms the order', async () => {
  const env = await TestWorkflowEnvironment.create();
  env.mockTask('sendConfirmation').returns('sent');

  const receipt = await env.executeWorkflow(
    (ctx: WorkflowContext, order: Order) => new ConfirmOrder().run(ctx, order),
    { id: 'order-1', email: 'ada@example.com' },
  );

  assert.equal(receipt, 'sent');
  await env.cleanup();
});
```

Mocks can also fail, return a sequence or compute their result, and the
environment controls the clock. See the
[testing guide](packages/sdk/src/testing/README.md).

</details>

<br />

### <img height="16" src="https://octicons-col.vercel.app/package/38BDF0"> Packages

| Package | What it is |
|---------|------------|
| [`@orcher/sdk`](https://www.npmjs.com/package/@orcher/sdk) | The SDK: workflows, tasks, actors, the worker and the client |
| `@orcher/sdk/testing` | In-memory test environment, task mocks and a mock clock |
| `@orcher/sdk-<platform>` | The prebuilt native core, one package per platform; installed for you |

Depend on `@orcher/sdk` alone; npm installs the right native package for
your platform.

<br />

### <img height="16" src="https://octicons-col.vercel.app/heart/38BDF0"> Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md)
for how to build, test and propose a change.

### <img height="16" src="https://octicons-col.vercel.app/law/38BDF0"> License

Licensed under the [Apache License, Version 2.0](LICENSE).

<sub>TypeScript and the TypeScript logo are trademarks of Microsoft, shown here to indicate the language this SDK is for.</sub>
