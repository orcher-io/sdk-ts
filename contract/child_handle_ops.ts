/**
 * Checks that a parent workflow can send an event to, and cancel, a child it
 * started, through its `ChildWorkflowHandle`.
 *
 * The event check also guards replay: the parent sleeps after sending, so its
 * code runs again before it reads the child's result, and the child reports
 * whether a second copy of the event arrived.
 *
 * Not part of `scenarios.json`: the catalog there is shared by every SDK.
 * Equivalent: `sdk-rust/contract/src/bin/child_handle_ops.rs`.
 *
 *   npx ts-node --project contract/tsconfig.json contract/child_handle_ops.ts
 */
import { randomUUID } from 'crypto';
import {
  ChildWorkflowFailedError,
  Client,
  Duration,
  Worker,
  isWorkflowSuspension,
  workflow,
  type WorkflowContext,
} from '@orcher/sdk';

const serverUrl = process.env.ORCHER_SERVER_URL ?? 'http://localhost:50051';
const namespace = process.env.ORCHER_NAMESPACE ?? 'contract';
const taskQueue = 'child-handle-ops';
const deadlineMs = 60_000;

interface EventOutcome {
  got: string;
  duplicate: boolean;
}

/** Waits for `go`, then gives a second copy a few seconds to arrive. */
const receiver = workflow<unknown, EventOutcome>({
  name: 'child_handle_ops_receiver',
  run: async (ctx: WorkflowContext) => {
    const got = await ctx.waitForEvent<string>('go');
    const again = await ctx.waitForEventWithTimeout<string>('go', Duration.fromSeconds(3));
    return { got, duplicate: again !== null };
  },
});

/** Sends `go` to its child, sleeps so it is replayed, then returns the child's outcome. */
const sender = workflow<unknown, EventOutcome>({
  name: 'child_handle_ops_sender',
  run: async (ctx: WorkflowContext) => {
    const child = await ctx.startChildWorkflow<EventOutcome>('child_handle_ops_receiver', {});
    await child.sendEvent('go', 'now');
    await ctx.sleep(Duration.fromSeconds(1));
    return child.result();
  },
});

/** Sleeps far longer than the check waits. */
const sleeper = workflow<unknown, string>({
  name: 'child_handle_ops_sleeper',
  run: async (ctx: WorkflowContext) => {
    await ctx.sleep(Duration.fromSeconds(600));
    return 'slept';
  },
});

/** Starts a sleeping child, cancels it, and reports how the child ended. */
const canceler = workflow<unknown, string>({
  name: 'child_handle_ops_canceler',
  run: async (ctx: WorkflowContext) => {
    const child = await ctx.startChildWorkflow<string>('child_handle_ops_sleeper', {});
    await ctx.sleep(Duration.fromSeconds(1));
    await child.cancel();
    try {
      return `completed: ${await child.result()}`;
    } catch (e) {
      if (isWorkflowSuspension(e)) throw e;
      if (e instanceof ChildWorkflowFailedError) return 'canceled';
      throw e;
    }
  },
});

async function main(): Promise<void> {
  const worker = new Worker({
    serverUrl,
    namespace,
    taskQueue,
    workflows: [receiver, sender, sleeper, canceler],
    tasks: [],
  });
  await worker.run();
  await new Promise((r) => setTimeout(r, 2000));

  const client = new Client({ serverUrl, namespace });
  await client.connect();
  const run = async (workflowType: string) => {
    const handle = await client.startWorkflow({
      workflowType,
      workflowId: `${workflowType}-${randomUUID()}`,
      taskQueue,
      args: [{}],
    });
    return handle.resultWithTimeout(deadlineMs);
  };

  const failures: string[] = [];
  try {
    const outcome = (await run('child_handle_ops_sender')) as EventOutcome | null;
    if (outcome?.got === 'now' && outcome.duplicate === false) {
      console.log('  sendEvent ok');
    } else {
      console.log(`  sendEvent FAILED: child saw ${JSON.stringify(outcome)}`);
      failures.push('sendEvent');
    }
  } catch (e) {
    console.log(`  sendEvent FAILED: ${e}`);
    failures.push('sendEvent');
  }
  try {
    const outcome = await run('child_handle_ops_canceler');
    if (outcome === 'canceled') {
      console.log('  cancel    ok');
    } else {
      console.log(`  cancel    FAILED: parent reported ${JSON.stringify(outcome)}`);
      failures.push('cancel');
    }
  } catch (e) {
    console.log(`  cancel    FAILED: ${e}`);
    failures.push('cancel');
  }

  await worker.shutdown();
  if (failures.length > 0) {
    console.log(`\nCHILD-HANDLE-OPS: FAIL (${failures.join(', ')})`);
    process.exit(1);
  }
  console.log('\nCHILD-HANDLE-OPS: PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
