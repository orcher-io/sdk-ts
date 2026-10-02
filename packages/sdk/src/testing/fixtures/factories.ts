/**
 * Factory functions for common test data (orders, payments, users, emails).
 *
 * Each factory returns a plain object with default values; pass overrides to
 * change any field.
 *
 * @module @orcher/sdk/testing/fixtures/factories
 *
 * @example
 * ```typescript
 * import { createOrder, createPayment, createUser } from '@orcher/sdk/testing';
 *
 * const order = createOrder();
 * const payment = createPayment({ amount: 99.99 });
 * const user = createUser({ email: 'test@example.com' });
 * ```
 */

/**
 * Counter for generating unique IDs.
 */
let idCounter = 0;

/**
 * Generate a unique ID of the form `<prefix>-<counter>-<timestamp>`.
 *
 * @param prefix - Optional prefix
 * @returns Unique ID
 */
function generateId(prefix: string = 'test'): string {
  idCounter++;
  return `${prefix}-${idCounter}-${Date.now()}`;
}

/**
 * Reset the counter used in generated IDs, user names, and emails.
 *
 * Generated IDs also contain a timestamp, so they stay unique across resets.
 *
 * @example
 * ```typescript
 * beforeEach(() => {
 *   resetIdCounter();
 * });
 * ```
 */
export function resetIdCounter(): void {
  idCounter = 0;
}

// ----------------------------------------------------------------------------
// Common data factories
// ----------------------------------------------------------------------------

/**
 * Create a mock order for testing.
 *
 * @param overrides - Property overrides
 * @returns Mock order object
 *
 * @example
 * ```typescript
 * const order = createOrder({
 *   orderId: 'custom-123',
 *   amount: 149.99
 * });
 * ```
 */
export function createOrder(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    orderId: generateId('order'),
    customerId: generateId('customer'),
    amount: 99.99,
    currency: 'USD',
    items: ['item1'],
    status: 'pending',
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Create a mock payment for testing.
 *
 * @param overrides - Property overrides
 * @returns Mock payment object
 *
 * @example
 * ```typescript
 * const payment = createPayment({
 *   amount: 199.99,
 *   method: 'credit_card'
 * });
 * ```
 */
export function createPayment(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    paymentId: generateId('payment'),
    amount: 99.99,
    currency: 'USD',
    method: 'credit_card',
    status: 'pending',
    cardNumber: '4111111111111111',
    cardExpiry: '12/25',
    cvv: '123',
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Create a mock user for testing.
 *
 * @param overrides - Property overrides
 * @returns Mock user object
 *
 * @example
 * ```typescript
 * const user = createUser({
 *   email: 'john@example.com',
 *   role: 'admin'
 * });
 * ```
 */
export function createUser(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    userId: generateId('user'),
    email: `user${idCounter}@example.com`,
    name: `Test User ${idCounter}`,
    role: 'customer',
    createdAt: new Date(),
    active: true,
    ...overrides,
  };
}

/**
 * Create a mock product for testing.
 *
 * @param overrides - Property overrides
 * @returns Mock product object
 *
 * @example
 * ```typescript
 * const product = createProduct({
 *   name: 'Premium Widget',
 *   price: 199.99
 * });
 * ```
 */
export function createProduct(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    productId: generateId('product'),
    name: `Test Product ${idCounter}`,
    description: 'A test product',
    price: 49.99,
    currency: 'USD',
    stock: 100,
    category: 'general',
    active: true,
    ...overrides,
  };
}

/**
 * Create a mock address for testing.
 *
 * @param overrides - Property overrides
 * @returns Mock address object
 *
 * @example
 * ```typescript
 * const address = createAddress({
 *   city: 'San Francisco',
 *   state: 'CA'
 * });
 * ```
 */
export function createAddress(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    street: '123 Test Street',
    city: 'Test City',
    state: 'TS',
    zipCode: '12345',
    country: 'US',
    ...overrides,
  };
}

/**
 * Create a mock notification for testing.
 *
 * @param overrides - Property overrides
 * @returns Mock notification object
 *
 * @example
 * ```typescript
 * const notification = createNotification({
 *   type: 'email',
 *   recipient: 'user@example.com'
 * });
 * ```
 */
export function createNotification(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    notificationId: generateId('notification'),
    type: 'email',
    recipient: 'test@example.com',
    subject: 'Test Notification',
    body: 'This is a test notification',
    status: 'pending',
    createdAt: new Date(),
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// Workflow input factories
// ----------------------------------------------------------------------------

/**
 * Create workflow input for order processing.
 *
 * @param overrides - Property overrides
 * @returns Order processing workflow input
 *
 * @example
 * ```typescript
 * const input = createOrderProcessingInput({
 *   amount: 199.99
 * });
 * ```
 */
export function createOrderProcessingInput(
  overrides: Record<string, any> = {}
): Record<string, any> {
  return {
    orderId: generateId('order'),
    customerId: generateId('customer'),
    amount: 99.99,
    currency: 'USD',
    items: [
      {
        productId: generateId('product'),
        quantity: 1,
        price: 99.99,
      },
    ],
    shippingAddress: createAddress(),
    billingAddress: createAddress(),
    paymentMethod: {
      type: 'credit_card',
      cardNumber: '4111111111111111',
      cardExpiry: '12/25',
      cvv: '123',
    },
    ...overrides,
  };
}

/**
 * Create workflow input for payment processing.
 *
 * @param overrides - Property overrides
 * @returns Payment processing workflow input
 *
 * @example
 * ```typescript
 * const input = createPaymentProcessingInput({
 *   amount: 299.99
 * });
 * ```
 */
export function createPaymentProcessingInput(
  overrides: Record<string, any> = {}
): Record<string, any> {
  return {
    paymentId: generateId('payment'),
    orderId: generateId('order'),
    amount: 99.99,
    currency: 'USD',
    method: 'credit_card',
    cardNumber: '4111111111111111',
    cardExpiry: '12/25',
    cvv: '123',
    ...overrides,
  };
}

/**
 * Create workflow input for notification sending.
 *
 * @param overrides - Property overrides
 * @returns Notification workflow input
 *
 * @example
 * ```typescript
 * const input = createNotificationInput({
 *   recipient: 'john@example.com'
 * });
 * ```
 */
export function createNotificationInput(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    notificationId: generateId('notification'),
    type: 'email',
    recipient: 'test@example.com',
    subject: 'Test Subject',
    body: 'Test message body',
    priority: 'normal',
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// Task input factories
// ----------------------------------------------------------------------------

/**
 * Create task input for charging a credit card.
 *
 * @param overrides - Property overrides
 * @returns Charge card task input
 *
 * @example
 * ```typescript
 * const input = createChargeCardInput({
 *   amount: 149.99
 * });
 * ```
 */
export function createChargeCardInput(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    amount: 99.99,
    currency: 'USD',
    cardNumber: '4111111111111111',
    cardExpiry: '12/25',
    cvv: '123',
    ...overrides,
  };
}

/**
 * Create task input for sending an email.
 *
 * @param overrides - Property overrides
 * @returns Send email task input
 *
 * @example
 * ```typescript
 * const input = createSendEmailInput({
 *   to: 'customer@example.com'
 * });
 * ```
 */
export function createSendEmailInput(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    to: 'test@example.com',
    from: 'noreply@example.com',
    subject: 'Test Email',
    body: 'This is a test email',
    ...overrides,
  };
}

/**
 * Create task input for validating an order.
 *
 * @param overrides - Property overrides
 * @returns Validate order task input
 *
 * @example
 * ```typescript
 * const input = createValidateOrderInput({
 *   orderId: 'order-123'
 * });
 * ```
 */
export function createValidateOrderInput(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    orderId: generateId('order'),
    items: ['item1'],
    amount: 99.99,
    currency: 'USD',
    ...overrides,
  };
}

/**
 * Create task input for reserving inventory.
 *
 * @param overrides - Property overrides
 * @returns Reserve inventory task input
 *
 * @example
 * ```typescript
 * const input = createReserveInventoryInput({
 *   productId: 'product-123',
 *   quantity: 5
 * });
 * ```
 */
export function createReserveInventoryInput(
  overrides: Record<string, any> = {}
): Record<string, any> {
  return {
    productId: generateId('product'),
    quantity: 1,
    warehouseId: generateId('warehouse'),
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// Result factories
// ----------------------------------------------------------------------------

/**
 * Create a successful task result.
 *
 * @param data - Result data
 * @returns Success result object
 *
 * @example
 * ```typescript
 * const result = createSuccessResult({ chargeId: 'ch_123' });
 * ```
 */
export function createSuccessResult(data: Record<string, any> = {}): Record<string, any> {
  return {
    success: true,
    timestamp: new Date(),
    ...data,
  };
}

/**
 * Create a failed task result.
 *
 * @param error - Error message, wrapped as `{ message }`, or an error object
 * @returns Failure result object
 *
 * @example
 * ```typescript
 * const result = createFailureResult('Payment declined');
 * ```
 */
export function createFailureResult(error: string | Record<string, any>): Record<string, any> {
  const errorData = typeof error === 'string' ? { message: error } : error;

  return {
    success: false,
    error: errorData,
    timestamp: new Date(),
  };
}

/**
 * Create a charge card result.
 *
 * @param overrides - Property overrides
 * @returns Charge card result
 *
 * @example
 * ```typescript
 * const result = createChargeCardResult({
 *   amount: 149.99
 * });
 * ```
 */
export function createChargeCardResult(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    chargeId: generateId('charge'),
    success: true,
    amount: 99.99,
    currency: 'USD',
    status: 'succeeded',
    timestamp: new Date(),
    ...overrides,
  };
}

/**
 * Create a validation result.
 *
 * @param valid - Whether validation passed
 * @param errors - Optional validation errors
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = createValidationResult(false, ['Invalid email']);
 * ```
 */
export function createValidationResult(
  valid: boolean = true,
  errors: string[] = []
): Record<string, any> {
  return {
    valid,
    errors,
    timestamp: new Date(),
  };
}

// ----------------------------------------------------------------------------
// Collection factories
// ----------------------------------------------------------------------------

/**
 * Create multiple orders.
 *
 * @param count - Number of orders to create
 * @param overrideFn - Optional function to customize each order
 * @returns Array of orders
 *
 * @example
 * ```typescript
 * const orders = createOrders(5, (order, index) => ({
 *   ...order,
 *   amount: 100 + (index * 10)
 * }));
 * ```
 */
export function createOrders(
  count: number,
  overrideFn?: (order: Record<string, any>, index: number) => Record<string, any>
): Record<string, any>[] {
  const orders: Record<string, any>[] = [];
  for (let i = 0; i < count; i++) {
    const order = createOrder();
    orders.push(overrideFn ? overrideFn(order, i) : order);
  }
  return orders;
}

/**
 * Create multiple users.
 *
 * @param count - Number of users to create
 * @param overrideFn - Optional function to customize each user
 * @returns Array of users
 *
 * @example
 * ```typescript
 * const users = createUsers(3, (user, index) => ({
 *   ...user,
 *   role: index === 0 ? 'admin' : 'customer'
 * }));
 * ```
 */
export function createUsers(
  count: number,
  overrideFn?: (user: Record<string, any>, index: number) => Record<string, any>
): Record<string, any>[] {
  const users: Record<string, any>[] = [];
  for (let i = 0; i < count; i++) {
    const user = createUser();
    users.push(overrideFn ? overrideFn(user, i) : user);
  }
  return users;
}

/**
 * Create multiple products.
 *
 * @param count - Number of products to create
 * @param overrideFn - Optional function to customize each product
 * @returns Array of products
 *
 * @example
 * ```typescript
 * const products = createProducts(10, (product, index) => ({
 *   ...product,
 *   price: 49.99 + (index * 10)
 * }));
 * ```
 */
export function createProducts(
  count: number,
  overrideFn?: (product: Record<string, any>, index: number) => Record<string, any>
): Record<string, any>[] {
  const products: Record<string, any>[] = [];
  for (let i = 0; i < count; i++) {
    const product = createProduct();
    products.push(overrideFn ? overrideFn(product, i) : product);
  }
  return products;
}

// ----------------------------------------------------------------------------
// Random data generators
// ----------------------------------------------------------------------------
//
// These use Math.random(), so their output differs between runs. Use them in
// tests only where the exact value does not matter.

/**
 * Generate a unique email address.
 *
 * @param domain - Email domain (default: 'example.com')
 * @returns Email address of the form `user-test-<counter>-<timestamp>@<domain>`
 *
 * @example
 * ```typescript
 * const email = randomEmail(); // e.g. 'user-test-1-1735689600000@example.com'
 * const email2 = randomEmail('test.com');
 * ```
 */
export function randomEmail(domain: string = 'example.com'): string {
  return `user-${generateId()}@${domain}`;
}

/**
 * Generate a random amount between min and max, rounded to two decimals.
 *
 * @param min - Minimum amount
 * @param max - Maximum amount
 * @returns Random amount
 *
 * @example
 * ```typescript
 * const amount = randomAmount(10, 100); // e.g., 47.32
 * ```
 */
export function randomAmount(min: number = 10, max: number = 1000): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

/**
 * Pick a random item from an array.
 *
 * @param items - Array of items
 * @returns Random item
 *
 * @example
 * ```typescript
 * const status = randomPick(['pending', 'processing', 'completed']);
 * ```
 */
export function randomPick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

/**
 * Generate a random boolean.
 *
 * @param trueProbability - Probability of true (0-1, default: 0.5)
 * @returns Random boolean
 *
 * @example
 * ```typescript
 * const isPremium = randomBoolean(0.2); // 20% chance of true
 * ```
 */
export function randomBoolean(trueProbability: number = 0.5): boolean {
  return Math.random() < trueProbability;
}
