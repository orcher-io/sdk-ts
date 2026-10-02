/**
 * Counting semaphore that bounds concurrent executions.
 *
 * The worker uses it to enforce the `maxConcurrentWorkflows` and `maxConcurrentTasks` limits.
 *
 * @module @orcher/sdk/worker/semaphore
 */

/**
 * Counting semaphore for limiting concurrent access to a resource.
 *
 * A semaphore holds a fixed number of permits. `acquire()` waits until a permit is free and
 * takes it. `release()` hands the permit to the oldest waiter, or returns it to the pool if
 * nobody is waiting.
 *
 * @example
 * ```typescript
 * const semaphore = new Semaphore(5); // Max 5 concurrent operations
 *
 * async function doWork() {
 *   await semaphore.acquire();
 *   try {
 *     // Do work
 *   } finally {
 *     semaphore.release();
 *   }
 * }
 * ```
 */
export class Semaphore {
  private permits: number;
  private readonly maxPermits: number;
  private readonly waiters: Array<() => void> = [];

  /**
   * Create a new Semaphore
   *
   * @param maxPermits - Maximum number of concurrent permits
   * @throws Error if `maxPermits` is less than 1
   *
   * @example
   * ```typescript
   * const semaphore = new Semaphore(10); // Max 10 concurrent
   * ```
   */
  constructor(maxPermits: number) {
    if (maxPermits < 1) {
      throw new Error('maxPermits must be >= 1');
    }
    this.maxPermits = maxPermits;
    this.permits = maxPermits;
  }

  /**
   * Acquire a permit, waiting if none are available
   *
   * Waiters are served in FIFO order.
   *
   * @returns Promise that resolves when permit is acquired
   *
   * @example
   * ```typescript
   * await semaphore.acquire();
   * // Permit acquired, do work
   * ```
   */
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /**
   * Release a permit
   *
   * If acquirers are waiting, the permit passes directly to the oldest one instead of
   * returning to the pool.
   *
   * @example
   * ```typescript
   * semaphore.release();
   * // Permit released, waiting acquirers can proceed
   * ```
   */
  release(): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter();
    } else {
      this.permits++;
    }
  }

  /**
   * Try to acquire a permit without blocking
   *
   * @returns True if permit was acquired, false otherwise
   *
   * @example
   * ```typescript
   * if (semaphore.tryAcquire()) {
   *   // Permit acquired
   * } else {
   *   // No permits available
   * }
   * ```
   */
  tryAcquire(): boolean {
    if (this.permits > 0) {
      this.permits--;
      return true;
    }
    return false;
  }

  /**
   * Get number of available permits
   *
   * @returns Number of permits currently available
   *
   * @example
   * ```typescript
   * const available = semaphore.available();
   * console.log(`${available} slots available`);
   * ```
   */
  available(): number {
    return this.permits;
  }

  /**
   * Get number of permits currently in use
   *
   * @returns Number of permits currently acquired
   *
   * @example
   * ```typescript
   * const inUse = semaphore.inUse();
   * console.log(`${inUse} slots in use`);
   * ```
   */
  inUse(): number {
    return this.maxPermits - this.permits;
  }

  /**
   * Get number of waiters
   *
   * @returns Number of acquirers waiting for permits
   *
   * @example
   * ```typescript
   * const waiters = semaphore.getWaiters();
   * console.log(`${waiters} acquirers waiting`);
   * ```
   */
  getWaiters(): number {
    return this.waiters.length;
  }

  /**
   * Get maximum number of permits
   *
   * @returns Maximum permits configured
   */
  getMaxPermits(): number {
    return this.maxPermits;
  }

  /**
   * Check if semaphore is at capacity
   *
   * @returns True if all permits are in use
   */
  isFull(): boolean {
    return this.permits === 0;
  }

  /**
   * Check if semaphore has available permits
   *
   * @returns True if permits are available
   */
  hasAvailable(): boolean {
    return this.permits > 0;
  }

  /**
   * Execute a function with automatic acquire/release
   *
   * The permit is released even if the function throws.
   *
   * @param fn - Function to execute
   * @returns Promise that resolves with function result
   *
   * @example
   * ```typescript
   * const result = await semaphore.withPermit(async () => {
   *   // Do work
   *   return 'result';
   * });
   * ```
   */
  async withPermit<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Drain all permits by taking every available permit
   *
   * Useful during shutdown to stop new work from starting. Permits held by in-flight work are
   * not affected.
   *
   * @returns Number of permits drained
   *
   * @example
   * ```typescript
   * const drained = semaphore.drain();
   * console.log(`Drained ${drained} permits`);
   * ```
   */
  drain(): number {
    const drained = this.permits;
    this.permits = 0;
    return drained;
  }

  /**
   * Restore permits taken by `drain()`
   *
   * Each restored permit goes to a waiting acquirer first, as with `release()`.
   *
   * @param count - Number of permits to restore
   * @throws Error if `count` is negative or would exceed the maximum permits
   *
   * @example
   * ```typescript
   * const drained = semaphore.drain();
   * // Later...
   * semaphore.restore(drained);
   * ```
   */
  restore(count: number): void {
    if (count < 0) {
      throw new Error('count must be >= 0');
    }
    if (this.permits + count > this.maxPermits) {
      throw new Error('cannot restore more permits than max');
    }

    for (let i = 0; i < count; i++) {
      this.release();
    }
  }

  /**
   * Clear all waiters without releasing permits
   *
   * Useful in error paths that abandon all waiting operations. The cleared waiters' promises
   * stay pending forever; they never resolve or reject.
   *
   * @returns Number of waiters cleared
   */
  clearWaiters(): number {
    const count = this.waiters.length;
    this.waiters.length = 0;
    return count;
  }

  /**
   * Get semaphore statistics
   *
   * @returns Statistics object
   */
  getStats(): SemaphoreStats {
    return {
      maxPermits: this.maxPermits,
      available: this.permits,
      inUse: this.inUse(),
      waiters: this.waiters.length,
      utilizationPercent: (this.inUse() / this.maxPermits) * 100,
    };
  }
}

/**
 * Semaphore statistics
 */
export interface SemaphoreStats {
  /**
   * Maximum number of permits
   */
  maxPermits: number;

  /**
   * Currently available permits
   */
  available: number;

  /**
   * Permits currently in use
   */
  inUse: number;

  /**
   * Number of acquirers waiting for permits
   */
  waiters: number;

  /**
   * Utilization percentage (0-100)
   */
  utilizationPercent: number;
}
