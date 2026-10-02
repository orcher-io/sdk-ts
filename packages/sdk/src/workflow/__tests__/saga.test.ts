import { Saga } from '../saga';
import { WorkflowError } from '../../errors';

describe('Saga (imperative, converged shape)', () => {
  const log: string[] = [];
  const act = (tag: string, fail = false) => async () => {
    if (fail) throw new Error(`${tag}-failed`);
    log.push(`do:${tag}`);
    return tag;
  };
  const comp = (tag: string) => async () => {
    log.push(`undo:${tag}`);
  };

  beforeEach(() => {
    log.length = 0;
  });

  it('runs compensations in reverse order (LIFO) and re-throws on failure', async () => {
    const saga = new Saga();
    await expect(
      (async () => {
        await saga.addStep(act('A'), comp('A'));
        await saga.addStep(act('B'), comp('B'));
        await saga.addStep(act('C', true), comp('C')); // C fails
      })()
    ).rejects.toThrow('C-failed');
    expect(log).toEqual(['do:A', 'do:B', 'undo:B', 'undo:A']);
  });

  it('commit() prevents compensation', async () => {
    const saga = new Saga();
    await saga.addStep(act('A'), comp('A'));
    saga.commit();
    await expect(saga.compensate()).resolves.toBe(0);
    expect(log).toEqual(['do:A']);
  });

  it('addCompensation() registers output-dependent compensation, runs LIFO', async () => {
    const saga = new Saga();
    await saga.addStep(act('A'), comp('A'));
    const chargeId = 'id123';
    saga.addCompensation(comp(`refund:${chargeId}`));
    await expect(saga.compensate()).resolves.toBe(2);
    expect(log).toEqual(['do:A', 'undo:refund:id123', 'undo:A']);
  });

  it('re-throws durable suspension without compensating', async () => {
    const saga = new Saga();
    await saga.addStep(act('A'), comp('A'));
    await saga.addStep(act('B'), comp('B'));
    const suspending = async () => {
      throw WorkflowError.suspended('scheduling', []);
    };
    await expect(saga.addStep(suspending, comp('X'))).rejects.toBeInstanceOf(WorkflowError);
    // No compensation ran — suspension is control flow, not failure.
    expect(log).toEqual(['do:A', 'do:B']);
  });

  it('compensate() is idempotent', async () => {
    const saga = new Saga();
    await saga.addStep(act('A'), comp('A'));
    await expect(saga.compensate()).resolves.toBe(1);
    await expect(saga.compensate()).resolves.toBe(0);
  });

  it('SagaBuilder is an alias of Saga', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SagaBuilder } = require('../saga');
    expect(SagaBuilder).toBe(Saga);
  });
});
