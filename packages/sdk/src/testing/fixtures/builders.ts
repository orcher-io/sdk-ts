/**
 * Fluent builders for workflow and task test data.
 *
 * @module @orcher/sdk/testing/fixtures/builders
 *
 * @example
 * ```typescript
 * import { WorkflowInputBuilder, TaskInputBuilder } from '@orcher/sdk/testing';
 *
 * const input = new WorkflowInputBuilder<OrderInput>()
 *   .withDefaults({ orderId: 'order-123', amount: 99.99 })
 *   .with({ orderId: 'custom-123' })
 *   .build();
 *
 * const taskInput = new TaskInputBuilder<ChargeCardInput>()
 *   .withDefaults({ amount: 10, cardNumber: '4111111111111111' })
 *   .with({ amount: 99.99 })
 *   .build();
 * ```
 */

/**
 * Generic fluent builder for test objects with defaults and overrides.
 *
 * @typeParam T - The type of object being built
 *
 * @example
 * ```typescript
 * interface Order {
 *   orderId: string;
 *   amount: number;
 *   items: string[];
 *   customerId: string;
 * }
 *
 * const builder = new TestDataBuilder<Order>({
 *   orderId: 'order-123',
 *   amount: 99.99,
 *   items: ['item1'],
 *   customerId: 'customer-456'
 * });
 *
 * const order = builder
 *   .with({ amount: 149.99 })
 *   .with({ items: ['item1', 'item2'] })
 *   .build();
 * ```
 */
export class TestDataBuilder<T extends Record<string, any>> {
  private data: Partial<T>;

  /**
   * Create a new test data builder.
   *
   * @param defaults - Default values for the object
   */
  constructor(defaults: Partial<T> = {}) {
    this.data = { ...defaults };
  }

  /**
   * Set a property value.
   *
   * @param key - Property key
   * @param value - Property value
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.set('orderId', 'order-123').set('amount', 99.99);
   * ```
   */
  set<K extends keyof T>(key: K, value: T[K]): this {
    this.data[key] = value;
    return this;
  }

  /**
   * Merge overrides into the object.
   *
   * @param overrides - Properties to override
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.with({ orderId: 'order-123', amount: 99.99 });
   * ```
   */
  with(overrides: Partial<T>): this {
    this.data = { ...this.data, ...overrides };
    return this;
  }

  /**
   * Apply a transformation function.
   *
   * @param fn - Transformation function
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.transform(data => ({
   *   ...data,
   *   amount: data.amount * 1.1 // Add 10% tax
   * }));
   * ```
   */
  transform(fn: (data: Partial<T>) => Partial<T>): this {
    this.data = fn(this.data);
    return this;
  }

  /**
   * Conditionally apply overrides.
   *
   * @param condition - Condition to check
   * @param overrides - Overrides to apply if condition is true
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.when(isPremium, { discount: 0.1 });
   * ```
   */
  when(condition: boolean, overrides: Partial<T>): this {
    if (condition) {
      this.with(overrides);
    }
    return this;
  }

  /**
   * Build the final object as a shallow copy of the builder's data.
   *
   * @returns The built object
   *
   * @example
   * ```typescript
   * const order = builder.build();
   * ```
   */
  build(): T {
    return { ...this.data } as T;
  }

  /**
   * Build several objects, optionally customizing each one.
   *
   * @param count - Number of objects to build
   * @param fn - Optional function to customize each object
   * @returns Array of built objects
   *
   * @example
   * ```typescript
   * const orders = builder.buildMany(3, (data, index) => ({
   *   ...data,
   *   orderId: `order-${index}`
   * }));
   * ```
   */
  buildMany(count: number, fn?: (data: Partial<T>, index: number) => Partial<T>): T[] {
    const results: T[] = [];
    for (let i = 0; i < count; i++) {
      const data = fn ? fn(this.data, i) : this.data;
      results.push({ ...data } as T);
    }
    return results;
  }

  /**
   * Clear all data, including the defaults passed to the constructor.
   *
   * @returns This builder for chaining
   */
  reset(): this {
    this.data = {};
    return this;
  }

  /**
   * Clone this builder.
   *
   * The clone is a plain `TestDataBuilder` holding a shallow copy of this
   * builder's data.
   *
   * @returns New builder with the same data
   *
   * @example
   * ```typescript
   * const builder2 = builder.clone().with({ amount: 149.99 });
   * ```
   */
  clone(): TestDataBuilder<T> {
    return new TestDataBuilder<T>(this.data);
  }
}

/**
 * Builder for workflow input data.
 *
 * @typeParam T - The type of workflow input
 *
 * @example
 * ```typescript
 * interface OrderInput {
 *   orderId: string;
 *   amount: number;
 *   items: string[];
 * }
 *
 * const input = new WorkflowInputBuilder<OrderInput>()
 *   .withDefaults({
 *     orderId: 'order-123',
 *     amount: 99.99,
 *     items: ['item1']
 *   })
 *   .with({ amount: 149.99 })
 *   .build();
 * ```
 */
export class WorkflowInputBuilder<T extends Record<string, any>> extends TestDataBuilder<T> {
  /**
   * Merge default values; same as `with()`.
   *
   * @param defaults - Default values
   * @returns This builder for chaining
   */
  withDefaults(defaults: Partial<T>): this {
    return this.with(defaults);
  }

  /**
   * Set the `workflowId` field.
   *
   * @param workflowId - Workflow ID
   * @returns This builder for chaining
   */
  withWorkflowId(workflowId: string): this {
    return this.set('workflowId' as keyof T, workflowId as T[keyof T]);
  }

  /**
   * Set the `timestamp` field.
   *
   * @param timestamp - Timestamp
   * @returns This builder for chaining
   */
  withTimestamp(timestamp: Date): this {
    return this.set('timestamp' as keyof T, timestamp as T[keyof T]);
  }
}

/**
 * Builder for task input data.
 *
 * @typeParam T - The type of task input
 *
 * @example
 * ```typescript
 * interface ChargeCardInput {
 *   amount: number;
 *   cardNumber: string;
 *   cvv: string;
 * }
 *
 * const input = new TaskInputBuilder<ChargeCardInput>()
 *   .withDefaults({
 *     amount: 99.99,
 *     cardNumber: '4111111111111111',
 *     cvv: '123'
 *   })
 *   .with({ amount: 149.99 })
 *   .build();
 * ```
 */
export class TaskInputBuilder<T extends Record<string, any>> extends TestDataBuilder<T> {
  /**
   * Merge default values; same as `with()`.
   *
   * @param defaults - Default values
   * @returns This builder for chaining
   */
  withDefaults(defaults: Partial<T>): this {
    return this.with(defaults);
  }

  /**
   * Set the `attempt` field (retry attempt number).
   *
   * @param attempt - Attempt number
   * @returns This builder for chaining
   */
  withAttempt(attempt: number): this {
    return this.set('attempt' as keyof T, attempt as T[keyof T]);
  }
}

/**
 * Builder for workflow execution options (`TestWorkflowOptions` fields).
 *
 * @example
 * ```typescript
 * const options = new WorkflowOptionsBuilder()
 *   .withWorkflowId('wf-123')
 *   .withTaskQueue('orders')
 *   .withTimeout(5000)
 *   .build();
 * ```
 */
export class WorkflowOptionsBuilder {
  private options: Record<string, any> = {};

  /**
   * Set workflow ID.
   *
   * @param workflowId - Workflow ID
   * @returns This builder for chaining
   */
  withWorkflowId(workflowId: string): this {
    this.options['workflowId'] = workflowId;
    return this;
  }

  /**
   * Set task queue.
   *
   * @param taskQueue - Task queue name
   * @returns This builder for chaining
   */
  withTaskQueue(taskQueue: string): this {
    this.options['taskQueue'] = taskQueue;
    return this;
  }

  /**
   * Set timeout.
   *
   * @param timeout - Timeout in milliseconds
   * @returns This builder for chaining
   */
  withTimeout(timeout: number): this {
    this.options['timeout'] = timeout;
    return this;
  }

  /**
   * Set namespace.
   *
   * @param namespace - Namespace
   * @returns This builder for chaining
   */
  withNamespace(namespace: string): this {
    this.options['namespace'] = namespace;
    return this;
  }

  /**
   * Set initial state.
   *
   * @param state - Initial state
   * @returns This builder for chaining
   */
  withInitialState(state: Record<string, any>): this {
    this.options['initialState'] = state;
    return this;
  }

  /**
   * Enable tracing for this execution (sets `trace`).
   *
   * @param enabled - Whether to enable tracing
   * @returns This builder for chaining
   */
  withTracing(enabled: boolean = true): this {
    this.options['trace'] = enabled;
    return this;
  }

  /**
   * Merge additional options.
   *
   * @param options - Additional options
   * @returns This builder for chaining
   */
  with(options: Record<string, any>): this {
    this.options = { ...this.options, ...options };
    return this;
  }

  /**
   * Build the options object.
   *
   * @returns Built options
   */
  build(): Record<string, any> {
    return { ...this.options };
  }
}

/**
 * Builder for test environment options (`TestEnvOptions` fields).
 *
 * @example
 * ```typescript
 * const options = new TestEnvOptionsBuilder()
 *   .withNamespace('test')
 *   .withTaskQueue('test-queue')
 *   .withInitialTime(new Date('2025-01-01'))
 *   .enableSnapshots()
 *   .build();
 * ```
 */
export class TestEnvOptionsBuilder {
  private options: Record<string, any> = {};

  /**
   * Set namespace.
   *
   * @param namespace - Namespace
   * @returns This builder for chaining
   */
  withNamespace(namespace: string): this {
    this.options['namespace'] = namespace;
    return this;
  }

  /**
   * Set task queue.
   *
   * @param taskQueue - Task queue name
   * @returns This builder for chaining
   */
  withTaskQueue(taskQueue: string): this {
    this.options['taskQueue'] = taskQueue;
    return this;
  }

  /**
   * Set initial time.
   *
   * @param time - Initial time
   * @returns This builder for chaining
   */
  withInitialTime(time: Date): this {
    this.options['initialTime'] = time;
    return this;
  }

  /**
   * Set timeout.
   *
   * @param timeout - Timeout in milliseconds
   * @returns This builder for chaining
   */
  withTimeout(timeout: number): this {
    this.options['timeout'] = timeout;
    return this;
  }

  /**
   * Enable snapshot capture.
   *
   * @param enabled - Whether to enable snapshots
   * @returns This builder for chaining
   */
  enableSnapshots(enabled: boolean = true): this {
    this.options['captureSnapshots'] = enabled;
    return this;
  }

  /**
   * Enable tracing.
   *
   * @param enabled - Whether to enable tracing
   * @returns This builder for chaining
   */
  enableTracing(enabled: boolean = true): this {
    this.options['enableTracing'] = enabled;
    return this;
  }

  /**
   * Enable strict mode.
   *
   * @param enabled - Whether to enable strict mode
   * @returns This builder for chaining
   */
  enableStrictMode(enabled: boolean = true): this {
    this.options['strictMode'] = enabled;
    return this;
  }

  /**
   * Merge additional options.
   *
   * @param options - Additional options
   * @returns This builder for chaining
   */
  with(options: Record<string, any>): this {
    this.options = { ...this.options, ...options };
    return this;
  }

  /**
   * Build the options object.
   *
   * @returns Built options
   */
  build(): Record<string, any> {
    return { ...this.options };
  }
}

/**
 * Create a new workflow input builder.
 *
 * @typeParam T - The type of workflow input
 * @param defaults - Optional default values
 * @returns New workflow input builder
 *
 * @example
 * ```typescript
 * const input = createWorkflowInput<OrderInput>({
 *   orderId: 'order-123',
 *   amount: 99.99
 * })
 *   .with({ items: ['item1', 'item2'] })
 *   .build();
 * ```
 */
export function createWorkflowInput<T extends Record<string, any>>(
  defaults?: Partial<T>
): WorkflowInputBuilder<T> {
  return new WorkflowInputBuilder<T>(defaults);
}

/**
 * Create a new task input builder.
 *
 * @typeParam T - The type of task input
 * @param defaults - Optional default values
 * @returns New task input builder
 *
 * @example
 * ```typescript
 * const input = createTaskInput<ChargeCardInput>({
 *   amount: 99.99,
 *   cardNumber: '4111111111111111'
 * })
 *   .with({ cvv: '123' })
 *   .build();
 * ```
 */
export function createTaskInput<T extends Record<string, any>>(
  defaults?: Partial<T>
): TaskInputBuilder<T> {
  return new TaskInputBuilder<T>(defaults);
}

/**
 * Create a new test data builder.
 *
 * @typeParam T - The type of data being built
 * @param defaults - Optional default values
 * @returns New test data builder
 *
 * @example
 * ```typescript
 * const order = createTestData<Order>({
 *   orderId: 'order-123',
 *   amount: 99.99
 * })
 *   .with({ items: ['item1'] })
 *   .build();
 * ```
 */
export function createTestData<T extends Record<string, any>>(
  defaults?: Partial<T>
): TestDataBuilder<T> {
  return new TestDataBuilder<T>(defaults);
}
