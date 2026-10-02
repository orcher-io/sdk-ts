/**
 * Bridge layer between the Orcher Rust core and the TypeScript SDK.
 *
 * TypeScript types and utilities that mirror the Rust bridge layer in sdk-core,
 * so the two sides can exchange data directly through the Neon bindings.
 *
 * @module @orcher/sdk/core/bridge
 */

export * from './types';
export * from './payload';
export * from './result';
export * from './utilities';
