/**
 * A heartbeat timeout declared on the Task decorator goes out with the task,
 * as one declared on the functional `task()` does.
 */

import 'reflect-metadata';
import { Tasks } from '../../di/decorators/tasks';
import { createTaskRefs } from '../../di/types';
import { Task } from '../../di/decorators/task';
import { Worker } from '../worker';
import type { Logger } from '../types';
import { FakeEngine, runner } from './support/fake-engine';

// A worker connects to nothing until run(), which none of these call.
jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({})),
  isNativeAvailable: jest.fn(() => true),
}));

@Tasks()
class ImportTasks {
  @Task({ heartbeatTimeout: 2_500 })
  async importRows(_ctx: unknown, _file: string) {
    return 0;
  }

  @Task()
  async unsupervised(_ctx: unknown) {
    return 0;
  }
}

const tasks = createTaskRefs(ImportTasks);

describe('Task decorator heartbeatTimeout', () => {
  it('carries the heartbeat timeout on the task reference', () => {
    expect(tasks.importRows.heartbeatTimeout).toBe(2_500);
    expect(tasks.unsupervised.heartbeatTimeout).toBeUndefined();
  });

  it('schedules the task with that heartbeat timeout', async () => {
    const commands = await runner(async (ctx) => ctx.executeTask(tasks.importRows, 'rows.csv'))(
      new FakeEngine()
    );

    const scheduled = commands.find((c) => c.what.oneofKind === 'runTask')!.what as any;
    expect(scheduled.runTask.heartbeatTimeout).toEqual({ seconds: '2', nanos: 500_000_000 });
  });

  it('schedules an undeclared task without heartbeat supervision', async () => {
    const commands = await runner(async (ctx) => ctx.executeTask(tasks.unsupervised, null))(
      new FakeEngine()
    );

    const scheduled = commands.find((c) => c.what.oneofKind === 'runTask')!.what as any;
    expect(scheduled.runTask.heartbeatTimeout).toBeUndefined();
  });
});

describe('WorkerOptions.heartbeatInterval', () => {
  it('is accepted but deprecated, and warns that it has no effect', () => {
    const warn = jest.fn();
    const logger: Logger = { debug() {}, info() {}, warn, error() {} };

    new Worker({
      serverUrl: 'http://localhost:1',
      namespace: 'default',
      taskQueue: 'q',
      workflows: [],
      tasks: [],
      logger,
      heartbeatInterval: 5_000,
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('heartbeatInterval'));
  });
});
