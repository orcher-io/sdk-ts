/**
 * Loader for the Orcher core native module.
 *
 * Loads the native Rust/Neon module lazily on first use, verifies it, caches it,
 * and remembers a failed load so later calls fail fast with the original cause.
 *
 * @module @orcher/sdk/core/native
 */

import { ConnectionError } from './errors';
import { NativeModule } from './types';

let nativeModule: NativeModule | null = null;

/** The error from a failed load, rethrown (wrapped) on every later call. */
let loadError: Error | null = null;

/** Set before the first load attempt, so a failed load is never retried. */
let loadAttempted = false;

/**
 * Environment variable naming an explicit path to the native binding.
 * For local builds and debugging; not needed in normal use.
 */
export const NATIVE_MODULE_PATH_ENV = 'ORCHER_NATIVE_MODULE';

/**
 * The scope of the published packages that carry a prebuilt binding, one per
 * platform, named `@orcher/sdk-<platform>-<arch>[-<libc>]`. The SDK package
 * lists them all as optional dependencies, and each declares the `os`, `cpu`
 * and (on Linux) `libc` it runs on, so npm installs only the one that fits.
 */
export const NATIVE_PACKAGE_SCOPE = '@orcher';

/**
 * The platforms a prebuilt binding is published for.
 *
 * Keep in step with the platform packages under `npm/` (a test checks this)
 * and the build matrix in `.github/workflows/release.yml`.
 */
export const NATIVE_TARGETS: readonly string[] = [
  'darwin-arm64',
  'darwin-x64',
  'linux-x64-gnu',
  'linux-arm64-gnu',
  'linux-x64-musl',
  'linux-arm64-musl',
];

/**
 * Whether the running Node was linked against musl rather than glibc.
 *
 * Node's own report says which C library it runs on; on glibc it names the
 * version, on musl it names nothing. Alpine-based images, the usual case in
 * containers, need the musl build, and loading the glibc one there fails
 * with a message that says nothing about libc, so this must be decided up
 * front rather than discovered by trial.
 */
export function isMusl(): boolean {
  if (process.platform !== 'linux') {
    return false;
  }
  const report = process.report?.getReport() as
    | { header?: { glibcVersionRuntime?: string } }
    | undefined;
  return !report?.header?.glibcVersionRuntime;
}

/**
 * The target name for a platform, as used in the platform package names:
 * `<platform>-<arch>`, plus `-gnu` or `-musl` on Linux.
 */
export function nativeTarget(platform: NodeJS.Platform, arch: string, musl: boolean): string {
  const libc = platform === 'linux' ? (musl ? '-musl' : '-gnu') : '';
  return `${platform}-${arch}${libc}`;
}

/**
 * The name of the platform package for the given platform, or `null` when no
 * such package is published.
 *
 * Pure so it can be tested away from the machine the tests run on.
 */
export function nativePackageName(
  platform: NodeJS.Platform,
  arch: string,
  musl: boolean
): string | null {
  const target = nativeTarget(platform, arch, musl);
  return NATIVE_TARGETS.includes(target) ? `${NATIVE_PACKAGE_SCOPE}/sdk-${target}` : null;
}

/** Whether `err` is Node failing to find `request` itself (not one of its dependencies). */
function isNotFound(err: unknown, request: string): boolean {
  return (
    err instanceof Error &&
    (err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND' &&
    err.message.includes(`'${request}'`)
  );
}

/**
 * Locate and require the native binding.
 *
 * In order:
 * 1. an explicit path from `ORCHER_NATIVE_MODULE`;
 * 2. a binding built in place by `npm run build:native` (`dist/native`), which
 *    only exists in a checkout of this repository — the published package
 *    never carries one — so a local build always wins over a published one;
 * 3. the platform package for this machine.
 *
 * The error names this machine's platform and what was tried.
 */
function requireNativeBinding(): NativeModule {
  const explicit = process.env[NATIVE_MODULE_PATH_ENV];
  if (explicit) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(explicit) as NativeModule;
  }

  // From dist/core/native.js to dist/native/orcher_core.node.
  const local = '../native/orcher_core.node';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(local) as NativeModule;
  } catch (err) {
    if (!isNotFound(err, local)) {
      throw new Error(
        `the locally built binding failed to load: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const target = nativeTarget(process.platform, process.arch, isMusl());
  const packageName = nativePackageName(process.platform, process.arch, isMusl());
  if (!packageName) {
    throw new Error(
      `@orcher/sdk has no prebuilt native binding for ${target}; ` +
        `prebuilt bindings exist for ${NATIVE_TARGETS.join(', ')}. ` +
        `Build one from source (see CONTRIBUTING.md in https://github.com/orcher-io/sdk-ts) ` +
        `and set ${NATIVE_MODULE_PATH_ENV} to the built orcher_core.node.`
    );
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(packageName) as NativeModule;
  } catch (err) {
    if (isNotFound(err, packageName)) {
      throw new Error(
        `the native binding for ${target} is not installed: ${packageName} is missing. ` +
          `npm installs it as an optional dependency of @orcher/sdk; it is left out when ` +
          `optional dependencies are omitted (--omit=optional, --no-optional) or when ` +
          `node_modules was installed on a different platform. Reinstall on this machine ` +
          `with optional dependencies.`
      );
    }
    throw new Error(
      `${packageName} failed to load on ${target}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Load, verify and cache the native module.
 *
 * Only the first call attempts a load. After a failure every call throws,
 * carrying the original error when one was recorded.
 *
 * @throws {ConnectionError} If the native module cannot be loaded
 */
function loadNativeModule(): NativeModule {
  if (nativeModule) {
    return nativeModule;
  }

  if (loadError) {
    throw new ConnectionError(`Failed to load native module: ${loadError.message}`, loadError);
  }

  if (loadAttempted) {
    throw new ConnectionError('Native module failed to load on previous attempt');
  }

  loadAttempted = true;

  try {
    const native = requireNativeBinding();

    if (!native || typeof native.version !== 'function') {
      throw new Error('Native module does not export expected functions');
    }

    // Calling version() proves the binding actually runs, not just that it loaded.
    try {
      const version = native.version();
      if (typeof version !== 'string' || version.length === 0) {
        throw new Error('Native module version() returned invalid result');
      }
    } catch (err) {
      throw new Error(
        `Native module verification failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    nativeModule = native;
    return native;
  } catch (err) {
    loadError = err instanceof Error ? err : new Error(String(err));
    throw new ConnectionError(`Failed to load native module: ${loadError.message}`, loadError);
  }
}

/**
 * Get the native module, loading it on first access.
 *
 * This is the main entry point for the native module. The loaded module is cached.
 *
 * @returns The native module
 * @throws {ConnectionError} If the native module cannot be loaded
 *
 * @example
 * ```typescript
 * const native = getNativeModule();
 * const version = native.version();
 * console.log('Native module version:', version);
 * ```
 */
export function getNativeModule(): NativeModule {
  return loadNativeModule();
}

/**
 * Whether the native module can be loaded.
 *
 * Never throws, which makes it suitable for feature detection.
 *
 * @returns True if the native module is available, false otherwise
 *
 * @example
 * ```typescript
 * if (isNativeModuleAvailable()) {
 *   console.log('Native module is available');
 * } else {
 *   console.error('Native module is not available');
 * }
 * ```
 */
export function isNativeModuleAvailable(): boolean {
  try {
    loadNativeModule();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the native module version.
 *
 * @returns Native module version string
 * @throws {ConnectionError} If the native module cannot be loaded
 *
 * @example
 * ```typescript
 * const version = getNativeVersion();
 * console.log('Version:', version);
 * ```
 */
export function getNativeVersion(): string {
  const native = getNativeModule();
  return native.version();
}

/**
 * Get the FFI version reported by the native module (its `ffiVersion()`).
 *
 * @returns FFI version string
 * @throws {ConnectionError} If the native module cannot be loaded
 *
 * @example
 * ```typescript
 * const nativeVersion = getNativeModuleVersion();
 * console.log('Native Module Version:', nativeVersion);
 * ```
 */
export function getNativeModuleVersion(): string {
  const native = getNativeModule();
  return native.ffiVersion();
}

/**
 * Check that the native module loads and can reach the Rust core.
 *
 * @returns True if healthy; false otherwise, including when the module cannot be loaded
 *
 * @example
 * ```typescript
 * const healthy = performHealthCheck();
 * if (!healthy) {
 *   console.error('Native module health check failed');
 * }
 * ```
 */
export function performHealthCheck(): boolean {
  try {
    const native = getNativeModule();
    return native.healthCheck();
  } catch {
    return false;
  }
}

/**
 * Clear the cached native module and any recorded load failure.
 *
 * The next access loads the module again. Intended for tests.
 *
 * @internal
 */
export function resetNativeModule(): void {
  nativeModule = null;
  loadError = null;
  loadAttempted = false;
}

/**
 * Describe the native module: availability, versions and health.
 *
 * Never throws; a load failure is reported in `error` with `available: false`.
 *
 * @returns Information object
 *
 * @example
 * ```typescript
 * const info = getNativeModuleInfo();
 * console.log('Module info:', info);
 * ```
 */
export function getNativeModuleInfo(): {
  available: boolean;
  version?: string;
  nativeVersion?: string;
  healthy?: boolean;
  error?: string;
} {
  try {
    const native = getNativeModule();
    return {
      available: true,
      version: native.version(),
      nativeVersion: native.ffiVersion(),
      healthy: native.healthCheck(),
    };
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Whether the SDK runs in direct-bindings mode.
 *
 * Direct bindings (Neon calls into sdk-core) are the only mode the SDK supports,
 * so this always returns true.
 *
 * @returns Always true
 * @deprecated There is only one mode, so there is nothing to check.
 *
 * @example
 * ```typescript
 * // Always returns true
 * const isDirect = isDirectBindingsMode();
 * ```
 */
export function isDirectBindingsMode(): boolean {
  return true;
}
