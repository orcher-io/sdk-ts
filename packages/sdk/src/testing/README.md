# Orcher Testing Utilities

Test Orcher workflows and tasks without a running Orcher server. Workflows run in
memory, tasks are replaced by mocks, and a test clock drives timers, so tests are fast
and deterministic.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
  - [TestWorkflowEnvironment](#testworkflowenvironment)
  - [Task Mocking](#task-mocking)
  - [Time Control](#time-control)
  - [Assertions](#assertions)
  - [Mock Client](#mock-client)
  - [Test Fixtures](#test-fixtures)
- [Testing Patterns](#testing-patterns)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [Examples](#examples)

---

## Quick Start

### Installation

The testing utilities ship with the SDK:

```bash
npm install @orcher/sdk
```

### Basic Example

Workflows under test are ordinary workflow functions that take a `WorkflowContext` and
call tasks through `ctx.executeTask()`. Mocks are matched by task name, which is the
name of the `@Task` method.

```typescript
import { TestWorkflowEnvironment } from '@orcher/sdk/testing';
import { orderWorkflow } from './workflows/orderWorkflow';

describe('Order Processing', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeEach(async () => {
    testEnv = await TestWorkflowEnvironment.create();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('should process order successfully', async () => {
    testEnv.mockTask('chargeCard').returns({ chargeId: 'ch_123', success: true });
    testEnv.mockTask('reserveInventory').returns({ reserved: true });

    const result = await testEnv.executeWorkflow(orderWorkflow, {
      orderId: 'order-123',
      amount: 99.99,
      items: ['item1', 'item2'],
    });

    // `result` is whatever orderWorkflow returns.
    expect(result.status).toBe('completed');
    testEnv.assertTaskCalled('chargeCard', 1);
    testEnv.assertTaskCalled('reserveInventory', 1);
  });
});
```

---

## Core Concepts

### In-Memory Execution

Workflows execute in memory without a server connection. Tests need no infrastructure,
have no network variability, and each environment is independent of the others.

### Task Mocking

Every task a workflow calls must be mocked. Calling a task that has no mock fails the
workflow with an error naming the task.

```typescript
// Return a fixed value
testEnv.mockTask('chargeCard').returns({ chargeId: 'ch_123' });

// Return a different value on each call; Error entries are thrown
testEnv
  .mockTask('chargeCard')
  .returnsSequence([
    new Error('Timeout'),
    new Error('Timeout'),
    { chargeId: 'ch_456', success: true },
  ]);

// Compute the result from the input
testEnv.mockTask('calculateDiscount').withFn(async (input) => {
  return input.amount * 0.1;
});
```

### Time Control

The environment has its own clock. `ctx.sleep()`, `ctx.now()`, and `ctx.time.now()` in
the workflow read this clock, and it moves only when the test advances it:

```typescript
const testEnv = await TestWorkflowEnvironment.create({
  initialTime: new Date('2025-01-01T00:00:00Z'),
});

await testEnv.advanceTime(60000); // 1 minute
await testEnv.advanceTimeTo(new Date('2025-01-01T12:00:00Z'));
```

### Execution Tracing

Every execution is recorded as an `ExecutionTrace`, keyed by workflow ID:

```typescript
await testEnv.executeWorkflow(orderWorkflow, input, { workflowId: 'order-wf-1' });

const trace = testEnv.getExecutionTrace('order-wf-1')!;
console.log(trace.status); // 'completed'
console.log(trace.tasksExecuted.map((t) => t.taskName)); // ['chargeCard', 'reserveInventory']
console.log(trace.timers); // timers the workflow created
```

---

## API Reference

### TestWorkflowEnvironment

The main harness for executing workflows.

#### Creating an Environment

```typescript
const testEnv = await TestWorkflowEnvironment.create();

const testEnv = await TestWorkflowEnvironment.create({
  initialTime: new Date('2025-01-01T00:00:00Z'),
  namespace: 'test-namespace',
  timeout: 5000,
});
```

`createTestWorkflowEnvironment(options)` is an equivalent function form.

**Options (`TestEnvOptions`):**

- `initialTime?: Date` - Starting time of the test clock (default: current time)
- `namespace?: string` - Namespace shown in the summary (default: `'test'`)
- `taskQueue?: string` - Default task queue (default: `'test-queue'`)
- `timeout?: number` - Default execution timeout in milliseconds of real time
  (default: `30000`)
- `captureSnapshots?`, `enableTracing?`, `strictMode?` - Accepted but not acted on yet;
  traces are always recorded

#### Executing Workflows

```typescript
const result = await testEnv.executeWorkflow(
  myWorkflow,
  { arg1: 'value1', arg2: 42 },
  { workflowId: 'test-wf-1', taskQueue: 'test-queue' }
);

// With a generated workflow ID
const result = await testEnv.executeWorkflow(myWorkflow, input);
```

**Returns:** the workflow's return value, typed from the workflow function. If the
workflow throws, `executeWorkflow` rejects with that error.

**Options (`TestWorkflowOptions`):**

- `workflowId?: string` - Workflow ID (default: generated)
- `taskQueue?: string` - Task queue name (default: the environment's `taskQueue`)
- `timeout?: number` - Execution timeout in milliseconds of real time (default: the
  environment's `timeout`)

`startWorkflow()` takes the same arguments. Use it when the test needs to advance time
before awaiting the result.

#### Inspecting Executions

```typescript
testEnv.getExecutionTrace('test-wf-1'); // ExecutionTrace | undefined
testEnv.getAllExecutionTraces(); // Map<workflowId, ExecutionTrace>
testEnv.getWorkflowState('test-wf-1', 'counter'); // one state key
testEnv.getWorkflowState('test-wf-1'); // the whole state map
testEnv.getStats(); // counts and total execution time
console.log(testEnv.getSummary()); // human-readable summary
```

#### Cleanup

```typescript
afterEach(async () => {
  await testEnv.cleanup(); // clears mocks, traces, and timers
});
```

`reset()` also clears statistics and sets the clock back to `initialTime`.

---

### Task Mocking

`testEnv.mockTask(name)` returns a `MockTaskBuilder`. Each builder method sets the mock's
behavior, replacing any mock registered earlier for that task along with its recorded
calls.

#### Basic Mocking

```typescript
testEnv.mockTask('myTask').returns({ result: 'success' });
testEnv.mockTask('failingTask').throws(new Error('Task failed'));

// Promise-style aliases for returns() and throws()
testEnv.mockTask('asyncTask').resolves({ success: true });
testEnv.mockTask('asyncFailure').rejects(new Error('Failed'));
```

#### Sequence Mocking

```typescript
// Fail twice, then succeed
testEnv
  .mockTask('unreliableTask')
  .returnsSequence([new Error('Network timeout'), new Error('Network timeout'), { success: true }]);
```

A call after the last value fails with a "Mock sequence exhausted" error.

#### Function Mocking

```typescript
testEnv.mockTask('calculatePrice').withFn(async (input) => {
  const basePrice = input.quantity * input.unitPrice;
  const discount = input.premium ? basePrice * 0.1 : 0;
  return basePrice - discount;
});
```

#### Other Behaviors

```typescript
// Alternate success and failure, `count` values in total (default 10)
testEnv.mockTask('flaky').alternates({ success: true }, new Error('Flaky error'), 5);

// Fail once, then succeed; or succeed once, then fail
testEnv.mockTask('recoverable').throwsOnceThen(new Error('Temporary error'), { success: true });
testEnv.mockTask('oneShot').returnsOnceThen({ success: true }, new Error('Already used'));

// Settle after a delay on the test clock; advance time to release them
testEnv.mockTask('slow').resolvesAfter({ result: 'done' }, 5000);
testEnv.mockTask('slowFailure').rejectsAfter(new Error('Timeout'), 5000);
```

#### Call Verification

```typescript
const mock = testEnv.getMockTask('chargeCard');

mock.callCount; // 2
mock.wasCalled; // true
mock.calls[0].input; // input of the first call
mock.calls[0].result; // value the first call returned
mock.wasCalledWith(expectedInput); // true if any call had this input

mock.reset(); // forget recorded calls; the mock's behavior is kept
```

`testEnv.isTaskMocked(name)` and `testEnv.getTaskCallCount(name)` are also available.

---

### Time Control

```typescript
await testEnv.advanceTime(60000); // advance by 1 minute
await testEnv.advanceTimeTo(new Date('2025-01-01T12:00:00Z')); // advance to a time
const now = testEnv.getCurrentTime();
testEnv.setCurrentTime(new Date('2025-01-01T00:00:00Z')); // set without firing timers
```

Advancing fires the timers that fall due in the advanced window, in due order. Each timer
fires with the clock at its due time, and the code it wakes runs before the next timer is
considered, so a workflow that sleeps in a loop sees every wake-up. `advanceTimeTo()`
throws if the target is earlier than the current test time.

The execution `timeout` is measured in real time, not on the test clock. A workflow
waiting on a timer that the test never advances past fails with a timeout error.

---

### Assertions

#### Environment Assertions

These throw an `Error` when the assertion fails:

```typescript
testEnv.assertTaskCalled('chargeCard', 1); // exactly once
testEnv.assertTaskCalled('sendEmail'); // at least once
testEnv.assertTaskCalled('refund', 0); // never

testEnv.assertTaskCalledWith('chargeCard', { amount: 99.99, cardToken: 'tok_123' });

testEnv.assertWorkflowCompleted('workflow-id');
testEnv.assertWorkflowFailed('workflow-id');
testEnv.assertWorkflowFailed('workflow-id', /insufficient funds/i);
testEnv.assertStateEquals('workflow-id', 'counter', 5);
```

#### Trace Assertions

Standalone assertion functions work on an `ExecutionTrace` and throw an `AssertionError`:

```typescript
import {
  assertWorkflowCompleted,
  assertWorkflowTaskCount,
  assertWorkflowState,
} from '@orcher/sdk/testing';

const trace = testEnv.getExecutionTrace('workflow-id')!;
assertWorkflowCompleted(trace);
assertWorkflowTaskCount(trace, 2); // tasks executed in total
assertWorkflowState(trace, 'counter', 5);
```

#### Custom Matchers

Register the Jest or Vitest matchers once in your test setup file:

```typescript
import { expect } from 'vitest';
import { extendExpect } from '@orcher/sdk/testing';

extendExpect(expect);
```

Then assert on traces:

```typescript
const trace = testEnv.getExecutionTrace('workflow-id')!;

expect(trace).toHaveCompletedSuccessfully();
expect(trace).toHaveExecutedTask('chargeCard');
expect(trace).toHaveExecutedTask('chargeCard', 2);
expect(trace).toHaveState('counter', 5);
expect(trace).toHaveFailedWith(/declined/);
```

---

### Mock Client

`MockOrcherClient` stands in for the Orcher client when testing code that starts
workflows, such as an HTTP handler.

#### Starting Workflows

```typescript
import { MockOrcherClient } from '@orcher/sdk/testing';

const client = new MockOrcherClient();

// Workflows of this type complete with this result as soon as they start
client.mockWorkflowResult(orderWorkflow, { orderId: 'order-123', status: 'completed' });

const handle = await client.startWorkflow(orderWorkflow, {
  workflowId: 'order-123',
  input: { orderId: 'order-123', amount: 99.99 },
});

const result = await handle.result();
expect(result.status).toBe('completed');
```

`client.mockWorkflowError(workflow, error)` makes started workflows fail instead.
`createMockClient(namespace)` is a shorthand for `new MockOrcherClient({ namespace })`.

#### Mock Handles

Without a mocked result, the handle stays running until the test settles it:

```typescript
const handle = await client.startWorkflow(approvalWorkflow, { workflowId: 'wf-123' });

// Record events the code under test sends
await handle.sendEvent('approval', { approved: true });
handle.verifyEventSent('approval', { approved: true });

// Answer queries
handle.mockQuery('getStatus', { status: 'processing', progress: 50 });
const status = await handle.query('getStatus');

// Settle the workflow
handle.completeWith({ success: true });
// or: handle.failWith(new Error('Workflow failed'));
// or: await handle.cancel();
```

#### Verification

```typescript
client.verifyWorkflowStarted('order-123');
client.verifyWorkflowTypeStarted('orderWorkflow', 1);

const started = client.getWorkflowsStartedByType('orderWorkflow');
expect(started).toHaveLength(1);
expect(client.getWorkflowStartCount()).toBe(1);
```

---

### Test Fixtures

Helpers for creating test data. All of them are exported from `@orcher/sdk/testing`.

#### Builders

```typescript
import { TestDataBuilder, WorkflowInputBuilder } from '@orcher/sdk/testing';

const order = new TestDataBuilder<Order>({
  orderId: 'order-123',
  amount: 99.99,
  items: ['item1'],
})
  .with({ amount: 149.99 })
  .set('discount', 10)
  .build();

const input = new WorkflowInputBuilder<OrderInput>({
  orderId: 'order-123',
  amount: 99.99,
})
  .with({ items: ['item1', 'item2'] })
  .build();
```

`TaskInputBuilder`, `WorkflowOptionsBuilder`, and `TestEnvOptionsBuilder` follow the same
pattern.

#### Factories

```typescript
import { createOrder, createOrders, createUser } from '@orcher/sdk/testing';

const order = createOrder();
const premiumOrder = createOrder({ amount: 999.99, priority: 'high' });
const user = createUser({ role: 'admin' });

const orders = createOrders(5, (order, index) => ({ ...order, status: 'pending' }));
```

Other factories include `createPayment`, `createProduct`, `createAddress`,
`createNotification`, task inputs such as `createChargeCardInput` and
`createSendEmailInput`, and results such as `createSuccessResult` and
`createFailureResult`.

#### Scenarios

Scenarios generate related data whose IDs and amounts agree:

```typescript
import { createOrderScenario } from '@orcher/sdk/testing';

const scenario = createOrderScenario({
  order: { amount: 149.99 },
  user: { email: 'test@example.com' },
  payment: { method: 'credit_card' },
});

testEnv.mockTask('chargeCard').returns({ chargeId: 'ch_123', amount: scenario.order.amount });
const result = await testEnv.executeWorkflow(orderWorkflow, scenario.input);
```

`createPaymentScenario`, `createNotificationScenario`, and `createBatchScenario` cover
other common workflows.

---

## Testing Patterns

### Happy Path

```typescript
it('should complete order successfully', async () => {
  testEnv.mockTask('chargeCard').returns({ chargeId: 'ch_123' });
  testEnv.mockTask('reserveInventory').returns({ reserved: true });
  testEnv.mockTask('sendEmail').returns({ sent: true });

  const result = await testEnv.executeWorkflow(orderWorkflow, {
    orderId: 'order-123',
    amount: 99.99,
    items: ['item1'],
  });

  expect(result.orderId).toBe('order-123');
  testEnv.assertTaskCalled('chargeCard', 1);
  testEnv.assertTaskCalled('reserveInventory', 1);
  testEnv.assertTaskCalled('sendEmail', 1);
});
```

### Error Handling

```typescript
it('should handle payment failure', async () => {
  testEnv.mockTask('chargeCard').throws(new Error('Insufficient funds'));
  testEnv.mockTask('reserveInventory').returns({ reserved: true });

  await expect(testEnv.executeWorkflow(orderWorkflow, { orderId: 'order-123' })).rejects.toThrow(
    'Insufficient funds'
  );

  testEnv.assertTaskCalled('chargeCard', 1);
  testEnv.assertTaskCalled('reserveInventory', 0);
});
```

### Retries

Retries belong on the task: set a `retryPolicy` when you define it, and the
engine retries failed attempts with backoff (see the Retries section of the
repository README). The in-memory environment does not simulate the engine's
retries; each task call runs once. Test what the workflow does when a task
fails for good:

```typescript
export const chargeCard = task({
  name: 'chargeCard',
  retryPolicy: { maxAttempts: 5, nonRetryableErrorTypes: ['CardDeclined'] },
  execute: async (ctx, order: Order) => payments.charge(order),
});

it('should fail the order when the charge fails', async () => {
  testEnv.mockTask('chargeCard').throws(new Error('Timeout'));

  await expect(testEnv.executeWorkflow(orderWorkflow, input)).rejects.toThrow();
  expect(testEnv.getMockTask('chargeCard').callCount).toBe(1);
});
```

### Timers and Deadlines

Start the workflow, advance the clock, then await the result:

```typescript
it('should cancel when approval does not arrive in time', async () => {
  testEnv.mockTask('checkStatus').returns({ status: 'pending' });
  testEnv.mockTask('cancelOrder').returns({ cancelled: true });

  // The workflow polls checkStatus every second until a 5-minute deadline
  const promise = testEnv.startWorkflow(approvalWorkflow, { orderId: 'order-123' });

  await testEnv.advanceTime(300001);

  const result = await promise;
  expect(result.timedOut).toBe(true);
  testEnv.assertTaskCalled('cancelOrder', 1);
});
```

### Workflow State

```typescript
it('should update counter correctly', async () => {
  testEnv.mockTask('processItem').returns({ processed: true });

  await testEnv.executeWorkflow(
    counterWorkflow,
    { items: ['a', 'b', 'c'] },
    { workflowId: 'counter-wf-1' }
  );

  testEnv.assertStateEquals('counter-wf-1', 'counter', 3);
  testEnv.assertStateEquals('counter-wf-1', 'processed', ['a', 'b', 'c']);
});
```

### Call Order

```typescript
it('should charge before shipping', async () => {
  const calls: string[] = [];

  testEnv.mockTask('chargeCard').withFn(async () => {
    calls.push('charge');
    return { chargeId: 'ch_123' };
  });

  testEnv.mockTask('shipOrder').withFn(async () => {
    calls.push('ship');
    return { shipped: true };
  });

  await testEnv.executeWorkflow(orderWorkflow, input);

  expect(calls).toEqual(['charge', 'ship']);
});
```

### Batch Processing

```typescript
it('should process every item', async () => {
  const items = Array.from({ length: 100 }, (_, i) => `item-${i}`);
  testEnv.mockTask('processItem').returns({ processed: true });

  await testEnv.executeWorkflow(batchWorkflow, { items, batchSize: 10 });

  expect(testEnv.getMockTask('processItem').callCount).toBe(100);
});
```

---

## Best Practices

- **Create a fresh environment per test** in `beforeEach` and call `cleanup()` in
  `afterEach`, so mocks and traces do not leak between tests.
- **Mock every task the workflow calls.** An unmocked task fails the workflow.
- **Pass an explicit `workflowId`** when the test inspects the trace or state afterwards.
- **Set `initialTime`** and drive timers with `advanceTime()` instead of real delays.
  Real delays make tests slow and non-deterministic.
- **Test success and failure paths separately**, one behavior per test.
- **Use fixtures for bulky input data** instead of large inline objects.
- **Type your mocks** when the task types are available:

  ```typescript
  testEnv.mockTask<ChargeCardInput, ChargeCardResult>('chargeCard').returns({ chargeId: 'ch_123' });
  ```

---

## Troubleshooting

### "Task 'myTask' is not mocked"

The workflow called a task with no mock. Register one before executing:

```typescript
testEnv.mockTask('myTask').returns({ result: 'done' });
```

### "Workflow ... timed out after 30000ms"

The workflow did not finish within the execution timeout, which is measured in real
time. Common causes:

- The workflow is waiting on `ctx.sleep()` or a delayed mock, and the test never advanced
  the clock. Use `startWorkflow()`, then `advanceTime()`, then await the result.
- The workflow is waiting for an event that nothing sends.
- The workflow loops forever.

### "Mock sequence exhausted"

A `returnsSequence()` mock was called more times than it has values. Add values, or use
`withFn()` for open-ended behavior.

### "Cannot read property of undefined"

A mock returned `undefined` where the workflow expected an object. Return the shape the
workflow reads:

```typescript
testEnv.mockTask('myTask').returns({ result: 'done' });
```

### Type errors with mock inputs

Pass the input and output types to `mockTask`:

```typescript
testEnv.mockTask<MyInput, MyOutput>('myTask').returns({ result: 'done' });
```

### Flaky tests

- Set `initialTime` so the clock starts at the same point on every run.
- Avoid real `setTimeout` delays in tests and workflows.
- Avoid the `random*` fixture helpers where the exact value matters.

---

## Examples

Complete, runnable examples live in [`__tests__/examples`](../__tests__/examples):

- **[basic-workflow.test.ts](../__tests__/examples/basic-workflow.test.ts)** - Environment
  setup, mocking, and assertions
- **[task-mocking.test.ts](../__tests__/examples/task-mocking.test.ts)** - Mocking patterns
- **[retry-testing.test.ts](../__tests__/examples/retry-testing.test.ts)** - Failure
  sequences, compensation, and error handling
- **[time-control.test.ts](../__tests__/examples/time-control.test.ts)** - Timers,
  deadlines, and scheduled work
