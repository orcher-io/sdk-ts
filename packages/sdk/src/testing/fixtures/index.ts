/**
 * Builders, factories, and ready-made scenarios for workflow test data.
 *
 * @module @orcher/sdk/testing/fixtures
 *
 * @example Using builders
 * ```typescript
 * import { WorkflowInputBuilder } from '@orcher/sdk/testing';
 *
 * const input = new WorkflowInputBuilder()
 *   .withDefaults({ orderId: 'order-123', amount: 99.99 })
 *   .with({ items: ['item1', 'item2'] })
 *   .build();
 * ```
 *
 * @example Using factories
 * ```typescript
 * import { createOrder, createPayment, createUser } from '@orcher/sdk/testing';
 *
 * const order = createOrder({ amount: 149.99 });
 * const payment = createPayment({ method: 'credit_card' });
 * const user = createUser({ role: 'admin' });
 * ```
 *
 * @example Creating multiple items
 * ```typescript
 * import { createOrders, createUsers } from '@orcher/sdk/testing';
 *
 * const orders = createOrders(5, (order, index) => ({
 *   ...order,
 *   orderId: `order-${index}`
 * }));
 *
 * const users = createUsers(3, (user, index) => ({
 *   ...user,
 *   role: index === 0 ? 'admin' : 'customer'
 * }));
 * ```
 */

export {
  TestDataBuilder,
  WorkflowInputBuilder,
  TaskInputBuilder,
  WorkflowOptionsBuilder,
  TestEnvOptionsBuilder,
  createWorkflowInput,
  createTaskInput,
  createTestData,
} from './builders';

export {
  // Common data factories
  createOrder,
  createPayment,
  createUser,
  createProduct,
  createAddress,
  createNotification,
  // Workflow input factories
  createOrderProcessingInput,
  createPaymentProcessingInput,
  createNotificationInput,
  // Task input factories
  createChargeCardInput,
  createSendEmailInput,
  createValidateOrderInput,
  createReserveInventoryInput,
  // Result factories
  createSuccessResult,
  createFailureResult,
  createChargeCardResult,
  createValidationResult,
  // Collection factories
  createOrders,
  createUsers,
  createProducts,
  // Random data generators
  randomEmail,
  randomAmount,
  randomPick,
  randomBoolean,
  resetIdCounter,
} from './factories';

// ----------------------------------------------------------------------------
// Scenarios
// ----------------------------------------------------------------------------

/**
 * Create the test data for an order-processing workflow.
 *
 * The workflow `input` is built from the generated order, user, payment, and
 * products, so its IDs and amounts match them.
 *
 * @param overrides - Overrides for the order, user, payment, or products
 * @returns Complete test scenario
 *
 * @example
 * ```typescript
 * const scenario = createOrderScenario({
 *   order: { amount: 199.99 },
 *   user: { email: 'premium@example.com' }
 * });
 *
 * const result = await testEnv.executeWorkflow(
 *   orderWorkflow,
 *   scenario.input
 * );
 * ```
 */
export function createOrderScenario(
  overrides: {
    order?: Record<string, any>;
    user?: Record<string, any>;
    payment?: Record<string, any>;
    products?: Record<string, any>[];
  } = {}
): {
  order: Record<string, any>;
  user: Record<string, any>;
  payment: Record<string, any>;
  products: Record<string, any>[];
  input: Record<string, any>;
} {
  const {
    createOrder,
    createUser,
    createPayment,
    createProducts,
    createOrderProcessingInput,
  } = require('./factories');

  const order = createOrder(overrides.order);
  const user = createUser(overrides.user);
  const payment = createPayment(overrides.payment);
  const products = overrides.products || createProducts(2);

  const input = createOrderProcessingInput({
    orderId: order.orderId,
    customerId: user.userId,
    amount: order.amount,
    items: products.map((p: any) => ({
      productId: p.productId,
      quantity: 1,
      price: p.price,
    })),
    paymentMethod: payment,
  });

  return {
    order,
    user,
    payment,
    products,
    input,
  };
}

/**
 * Create the test data for a payment workflow.
 *
 * The workflow `input` carries the generated payment's ID, amount, and method
 * and the generated order's ID.
 *
 * @param overrides - Overrides for the payment or order
 * @returns Payment test scenario
 *
 * @example
 * ```typescript
 * const scenario = createPaymentScenario({
 *   payment: { amount: 299.99 }
 * });
 * ```
 */
export function createPaymentScenario(
  overrides: {
    payment?: Record<string, any>;
    order?: Record<string, any>;
  } = {}
): {
  payment: Record<string, any>;
  order: Record<string, any>;
  input: Record<string, any>;
} {
  const { createPayment, createOrder, createPaymentProcessingInput } = require('./factories');

  const payment = createPayment(overrides.payment);
  const order = createOrder(overrides.order);

  const input = createPaymentProcessingInput({
    paymentId: payment.paymentId,
    orderId: order.orderId,
    amount: payment.amount,
    method: payment.method,
  });

  return {
    payment,
    order,
    input,
  };
}

/**
 * Create the test data for a notification workflow.
 *
 * The workflow `input` is addressed to the generated user's email.
 *
 * @param overrides - Overrides for the notification or user
 * @returns Notification test scenario
 *
 * @example
 * ```typescript
 * const scenario = createNotificationScenario({
 *   user: { email: 'customer@example.com' }
 * });
 * ```
 */
export function createNotificationScenario(
  overrides: {
    notification?: Record<string, any>;
    user?: Record<string, any>;
  } = {}
): {
  notification: Record<string, any>;
  user: Record<string, any>;
  input: Record<string, any>;
} {
  const { createNotification, createUser, createNotificationInput } = require('./factories');

  const notification = createNotification(overrides.notification);
  const user = createUser(overrides.user);

  const input = createNotificationInput({
    notificationId: notification.notificationId,
    recipient: user.email,
    type: notification.type,
  });

  return {
    notification,
    user,
    input,
  };
}

/**
 * Create the test data for a batch-processing workflow.
 *
 * Generates `itemCount` orders. `batchSize` defaults to 10; every override is
 * also merged into `input`.
 *
 * @param itemCount - Number of items to process
 * @param overrides - Overrides merged into the workflow input
 * @returns Batch processing scenario
 *
 * @example
 * ```typescript
 * const scenario = createBatchScenario(100, {
 *   batchSize: 10
 * });
 * ```
 */
export function createBatchScenario(
  itemCount: number,
  overrides: Record<string, any> = {}
): {
  items: Record<string, any>[];
  batchSize: number;
  totalBatches: number;
  input: Record<string, any>;
} {
  const { createOrders } = require('./factories');

  const batchSize = overrides['batchSize'] || 10;
  const items = createOrders(itemCount);
  const totalBatches = Math.ceil(itemCount / batchSize);

  return {
    items,
    batchSize,
    totalBatches,
    input: {
      items,
      batchSize,
      ...overrides,
    },
  };
}
