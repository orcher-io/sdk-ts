/**
 * Deterministic random values for workflows.
 *
 * Every value is derived from the workflow ID and a per-context counter, so a
 * replay produces the same values in the same order.
 *
 * @packageDocumentation
 */

import { createHash } from 'crypto';

/**
 * Deterministic random helper for workflows, available as `ctx.random`.
 *
 * Workflows are replayed after crashes and restarts, and a replay must make the
 * same decisions as the original run. `Math.random()` would return different
 * values on replay; this helper returns the same sequence every time.
 *
 * Each call hashes the workflow ID together with an internal counter (SHA-256)
 * and then increments the counter. The same workflow ID and the same sequence
 * of calls therefore always yield the same values.
 *
 * @example
 * Basic usage:
 * ```typescript
 * // Inside a workflow
 * const orderId = `ORD-${ctx.random.uuid()}`;
 * const delay = ctx.random.randomRange(1, 10);
 * const warehouse = ctx.random.choose(['east', 'west', 'central']);
 * ```
 *
 * @example
 * Multiple operations:
 * ```typescript
 * import { workflow, WorkflowContext } from '@orcher/sdk';
 *
 * export const processOrder = workflow({
 *   name: 'process-order',
 *   run: async (ctx: WorkflowContext, order: Order) => {
 *     // Each call increments the counter
 *     const uuid1 = ctx.random.uuid(); // counter: 0
 *     const uuid2 = ctx.random.uuid(); // counter: 1
 *     const uuid3 = ctx.random.uuid(); // counter: 2
 *
 *     // The same values are produced on every replay
 *     const priority = ctx.random.random();
 *     const warehouse = ctx.random.choose(['A', 'B', 'C']);
 *
 *     return { uuid1, uuid2, uuid3, priority, warehouse };
 *   },
 * });
 * ```
 */
export class WorkflowRandom {
  private counter: number = 0;
  private readonly seed: string;

  /**
   * Creates a helper seeded by a workflow ID.
   *
   * @param workflowId - Workflow ID used as the seed
   * @throws Error if `workflowId` is empty or whitespace
   *
   * @internal
   * WorkflowContext creates this instance. Workflow code uses `ctx.random`.
   */
  constructor(workflowId: string) {
    if (!workflowId || workflowId.trim().length === 0) {
      throw new Error('WorkflowRandom requires a non-empty workflow ID');
    }
    this.seed = workflowId;
  }

  /**
   * Generates a deterministic UUID v4.
   *
   * The UUID looks random but is derived from the workflow ID and the internal
   * counter. It has valid v4 version and variant bits.
   *
   * Calls need no name or key: the counter advances on every call, so each UUID
   * is unique within the workflow.
   *
   * @returns A deterministic UUID string
   *
   * @example
   * ```typescript
   * const orderId = `ORD-${ctx.random.uuid()}`;
   * const confirmationId = `CONF-${ctx.random.uuid()}`;
   * const trackingId = `TRACK-${ctx.random.uuid()}`;
   * ```
   *
   * @example
   * Use for correlation IDs:
   * ```typescript
   * // orderTasks = createTaskRefs(OrderTasks)
   * export const orderWorkflow = workflow({
   *   name: 'order-workflow',
   *   run: async (ctx: WorkflowContext, order: Order) => {
   *     const correlationId = ctx.random.uuid();
   *
   *     await ctx.executeTask(orderTasks.processPayment, {
   *       ...order.payment,
   *       correlationId,
   *     });
   *
   *     await ctx.executeTask(orderTasks.sendConfirmation, {
   *       email: order.email,
   *       correlationId,
   *     });
   *
   *     return { correlationId };
   *   },
   * });
   * ```
   */
  uuid(): string {
    const randomBytes = this.generateBytes(16);

    // Set version (4) and variant (RFC4122)
    randomBytes[6] = (randomBytes[6]! & 0x0f) | 0x40; // Version 4
    randomBytes[8] = (randomBytes[8]! & 0x3f) | 0x80; // Variant RFC4122

    const hex = randomBytes.map((b) => b.toString(16).padStart(2, '0')).join('');

    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join('-');
  }

  /**
   * Generates a deterministic number in [0, 1).
   *
   * The deterministic counterpart of `Math.random()`: a float between 0
   * (inclusive) and 1 (exclusive).
   *
   * @returns A deterministic random number in [0, 1)
   *
   * @example
   * ```typescript
   * const priority = ctx.random.random();
   * if (priority > 0.5) {
   *   // High priority handling
   * }
   * ```
   *
   * @example
   * Probability-based branching:
   * ```typescript
   * const roll = ctx.random.random();
   *
   * if (roll < 0.1) {
   *   // 10% chance - premium processing
   *   await ctx.executeTask(premiumProcessing, order);
   * } else {
   *   // 90% chance - standard processing
   *   await ctx.executeTask(standardProcessing, order);
   * }
   * ```
   */
  random(): number {
    const bytes = this.generateBytes(4);
    const value = bytes.reduce((acc, byte, i) => acc + byte * Math.pow(256, i), 0);
    const maxValue = Math.pow(256, 4);
    return value / maxValue;
  }

  /**
   * Generates a deterministic integer in [min, max].
   *
   * Both bounds are possible results.
   *
   * @param min - Minimum value (inclusive)
   * @param max - Maximum value (inclusive)
   * @returns A deterministic integer in [min, max]
   * @throws Error if either bound is not an integer, or if min > max
   *
   * @example
   * Random delay:
   * ```typescript
   * const delaySeconds = ctx.random.randomRange(1, 10);
   * await ctx.sleep(Duration.fromSeconds(delaySeconds));
   * ```
   *
   * @example
   * Random batch size:
   * ```typescript
   * const batchSize = ctx.random.randomRange(10, 50);
   * const batches = chunkArray(items, batchSize);
   * ```
   */
  randomRange(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new Error('randomRange requires integer arguments');
    }
    if (min > max) {
      throw new Error(`randomRange: min (${min}) cannot be greater than max (${max})`);
    }
    if (min === max) {
      return min;
    }

    const range = max - min + 1;
    return min + Math.floor(this.random() * range);
  }

  /**
   * Chooses one element of an array, each with equal probability.
   *
   * @param items - Array of items to choose from
   * @returns The chosen item
   * @throws Error if `items` is not an array or is empty
   *
   * @example
   * Choose random warehouse:
   * ```typescript
   * const warehouse = ctx.random.choose(['east', 'west', 'central']);
   * await ctx.executeTask(shipFromWarehouse, { warehouse, order });
   * ```
   *
   * @example
   * Random payment processor:
   * ```typescript
   * const processors = ['stripe', 'paypal', 'square'];
   * const processor = ctx.random.choose(processors);
   *
   * await ctx.executeTask(processPayment, {
   *   processor,
   *   amount: order.total,
   * });
   * ```
   *
   * @example
   * A/B testing:
   * ```typescript
   * const variant = ctx.random.choose(['control', 'variant_a', 'variant_b']);
   *
   * if (variant === 'variant_a') {
   *   await ctx.executeTask(newCheckoutFlow, order);
   * } else if (variant === 'variant_b') {
   *   await ctx.executeTask(experimentalFlow, order);
   * } else {
   *   await ctx.executeTask(standardCheckoutFlow, order);
   * }
   * ```
   */
  choose<T>(items: T[]): T {
    if (!Array.isArray(items)) {
      throw new Error('choose requires an array');
    }
    if (items.length === 0) {
      throw new Error('choose requires a non-empty array');
    }
    if (items.length === 1) {
      return items[0]!;
    }

    const index = Math.floor(this.random() * items.length);
    return items[index]!;
  }

  /**
   * Returns a deterministically shuffled copy of an array.
   *
   * Uses the Fisher-Yates algorithm. The original array is not modified.
   *
   * @param items - Array to shuffle
   * @returns A new shuffled array
   * @throws Error if `items` is not an array
   *
   * @example
   * Randomize task execution order:
   * ```typescript
   * const tasks = [task1, task2, task3, task4];
   * const shuffled = ctx.random.shuffle(tasks);
   *
   * for (const task of shuffled) {
   *   await ctx.executeTask(task, data);
   * }
   * ```
   *
   * @example
   * Random team assignment:
   * ```typescript
   * const teams = ['team_a', 'team_b', 'team_c', 'team_d'];
   * const randomizedTeams = ctx.random.shuffle(teams);
   *
   * for (let i = 0; i < orders.length; i++) {
   *   const team = randomizedTeams[i % randomizedTeams.length];
   *   await ctx.executeTask(assignToTeam, { order: orders[i], team });
   * }
   * ```
   */
  shuffle<T>(items: T[]): T[] {
    if (!Array.isArray(items)) {
      throw new Error('shuffle requires an array');
    }

    // Shuffle a copy so the caller's array is left untouched.
    const result = [...items];

    // Fisher-Yates
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [result[i], result[j]] = [result[j]!, result[i]!];
    }

    return result;
  }

  /**
   * Chooses one element with probability proportional to its weight.
   *
   * @param items - Array of `[item, weight]` tuples
   * @returns The chosen item
   * @throws Error if `items` is empty, a weight is negative or not finite, or
   *   all weights are zero
   *
   * @example
   * Weighted warehouse selection:
   * ```typescript
   * // 50% east, 30% west, 20% central
   * const warehouse = ctx.random.weightedChoose([
   *   ['east', 50],
   *   ['west', 30],
   *   ['central', 20],
   * ]);
   * ```
   *
   * @example
   * Gradual feature rollout:
   * ```typescript
   * // 10% new feature, 90% old feature
   * const feature = ctx.random.weightedChoose([
   *   ['new_checkout', 10],
   *   ['old_checkout', 90],
   * ]);
   *
   * if (feature === 'new_checkout') {
   *   await ctx.executeTask(newCheckoutFlow, order);
   * } else {
   *   await ctx.executeTask(oldCheckoutFlow, order);
   * }
   * ```
   *
   * @example
   * Priority-based processing:
   * ```typescript
   * const priority = ctx.random.weightedChoose([
   *   ['high', 20],
   *   ['medium', 50],
   *   ['low', 30],
   * ]);
   * ```
   */
  weightedChoose<T>(items: Array<[T, number]>): T {
    if (!Array.isArray(items)) {
      throw new Error('weightedChoose requires an array');
    }
    if (items.length === 0) {
      throw new Error('weightedChoose requires a non-empty array');
    }

    let totalWeight = 0;
    for (const [, weight] of items) {
      if (typeof weight !== 'number' || weight < 0 || !isFinite(weight)) {
        throw new Error('weightedChoose requires non-negative finite weights');
      }
      totalWeight += weight;
    }

    if (totalWeight === 0) {
      throw new Error('weightedChoose requires at least one positive weight');
    }

    const randomValue = this.random() * totalWeight;
    let cumulativeWeight = 0;

    for (const [item, weight] of items) {
      cumulativeWeight += weight;
      if (randomValue < cumulativeWeight) {
        return item;
      }
    }

    // Unreachable in practice: randomValue is below totalWeight. The return keeps
    // the function total in case floating-point rounding says otherwise.
    return items[items.length - 1]![0];
  }

  /**
   * Generates deterministic bytes and advances the counter.
   *
   * Every public method draws from here, so each call consumes exactly one
   * counter value.
   *
   * @param length - Number of bytes to generate
   * @returns Array of bytes
   *
   * @internal
   */
  private generateBytes(length: number): number[] {
    // The seed is the workflow ID plus the counter value for this call.
    const input = `${this.seed}:${this.counter++}`;

    const hash = createHash('sha256').update(input).digest();

    // A SHA-256 digest has 32 bytes; longer requests wrap around it.
    const bytes: number[] = [];
    for (let i = 0; i < length; i++) {
      bytes.push(hash[i % hash.length]!);
    }

    return bytes;
  }

  /**
   * Resets the internal counter to zero. For tests only.
   *
   * @internal
   */
  resetCounter(): void {
    this.counter = 0;
  }

  /**
   * Returns the current counter value. For tests and debugging.
   *
   * @internal
   */
  getCounter(): number {
    return this.counter;
  }
}
