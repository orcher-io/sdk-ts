/**
 * Imports source files so their decorators register workflows and tasks.
 *
 * Auto-discovery is optional: decorators behave the same when the files are imported by hand.
 *
 * @module @orcher/sdk/worker/auto-discover
 */

import glob from 'fast-glob';
import * as path from 'path';
import type { Logger } from './types';

/**
 * Auto-discovery configuration options
 */
export interface AutoDiscoverOptions {
  /**
   * Glob patterns to scan for decorated files
   *
   * @default ['./src/**\/*.ts', './src/**\/*.js']
   *
   * @example
   * ```typescript
   * patterns: ['./src/tasks/**\/*.ts', './src/workflows/**\/*.ts']
   * ```
   */
  patterns?: string[];

  /**
   * Patterns to exclude from scanning
   *
   * Setting this replaces the default list rather than extending it.
   *
   * @default Test and spec files, declaration files, node_modules, and build output folders
   *
   * @example
   * ```typescript
   * exclude: ['**\/*.test.ts', '**\/dist/**']
   * ```
   */
  exclude?: string[];

  /**
   * Base directory that patterns are resolved against
   *
   * @default process.cwd()
   *
   * @example
   * ```typescript
   * baseDir: '/path/to/project'
   * ```
   */
  baseDir?: string;

  /**
   * Custom logger
   *
   * @default console
   */
  logger?: Logger;

  /**
   * Whether to throw on the first import error
   *
   * When false, a failed import is logged as a warning, recorded in the result, and
   * scanning continues.
   *
   * @default false
   *
   * @example
   * ```typescript
   * throwOnError: true  // Fail fast on import errors
   * ```
   */
  throwOnError?: boolean;

  /**
   * Enable verbose logging
   *
   * @default false
   */
  verbose?: boolean;
}

/**
 * Auto-discovery result
 */
export interface AutoDiscoverResult {
  /**
   * Total files found matching patterns
   */
  filesFound: number;

  /**
   * Number of files successfully imported
   */
  filesImported: number;

  /**
   * Number of files that failed to import
   */
  filesFailed: number;

  /**
   * List of files that were imported
   */
  importedFiles: string[];

  /**
   * List of files that failed with error messages
   */
  failedFiles: Array<{ file: string; error: string }>;

  /**
   * Duration in milliseconds
   */
  durationMs: number;
}

const DEFAULT_EXCLUDE_PATTERNS = [
  '**/*.test.ts',
  '**/*.test.js',
  '**/*.spec.ts',
  '**/*.spec.js',
  '**/*.d.ts',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/__tests__/**',
  '**/__mocks__/**',
];

const DEFAULT_SCAN_PATTERNS = ['./src/**/*.ts', './src/**/*.js'];

/** Console logger that prefixes every message with `[AutoDiscover]`. */
function createDefaultLogger(): Logger {
  return {
    debug: (message: string, ...args: any[]) => console.debug(`[AutoDiscover] ${message}`, ...args),
    info: (message: string, ...args: any[]) => console.info(`[AutoDiscover] ${message}`, ...args),
    warn: (message: string, ...args: any[]) => console.warn(`[AutoDiscover] ${message}`, ...args),
    error: (message: string, ...args: any[]) => console.error(`[AutoDiscover] ${message}`, ...args),
  };
}

/**
 * Discover decorated classes by importing every file that matches the patterns.
 *
 * Importing a file runs its decorators, which register its workflows and tasks. Decorators
 * behave the same with manual imports, so this is a convenience, not a requirement.
 *
 * @param options - Auto-discovery configuration
 * @returns Summary of the files found, imported and failed
 * @throws Error if scanning fails, or if an import fails and `throwOnError` is set
 *
 * @example
 * ```typescript
 * // Use the defaults (scans ./src/**\/*.{ts,js})
 * await autoDiscover();
 *
 * // Custom patterns
 * await autoDiscover({
 *   patterns: ['./src/tasks/**\/*.ts', './src/workflows/**\/*.ts'],
 *   exclude: ['**\/*.test.ts'],
 * });
 *
 * // Custom logger with verbose output
 * await autoDiscover({
 *   logger: customLogger,
 *   verbose: true,
 * });
 * ```
 */
export async function autoDiscover(options: AutoDiscoverOptions = {}): Promise<AutoDiscoverResult> {
  const startTime = Date.now();

  const {
    patterns = DEFAULT_SCAN_PATTERNS,
    exclude = DEFAULT_EXCLUDE_PATTERNS,
    baseDir = process.cwd(),
    logger = createDefaultLogger(),
    throwOnError = false,
    verbose = false,
  } = options;

  const normalizedBaseDir = path.resolve(baseDir);

  logger.info('🔍 Starting auto-discovery...');
  if (verbose) {
    logger.debug(`Base directory: ${normalizedBaseDir}`);
    logger.debug(`Patterns: ${patterns.join(', ')}`);
    logger.debug(`Exclude: ${exclude.join(', ')}`);
  }

  let files: string[];
  try {
    files = await glob(patterns, {
      cwd: normalizedBaseDir,
      ignore: exclude,
      absolute: true,
      onlyFiles: true,
      followSymbolicLinks: false,
    });
  } catch (error) {
    logger.error('Failed to scan files:', error);
    throw new Error(
      `Auto-discovery failed to scan files: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  logger.info(`Found ${files.length} files to scan`);

  if (files.length === 0) {
    logger.warn(
      'No files found matching patterns. Check your patterns and baseDir. ' +
        'You may need to manually import decorated files.'
    );
  }

  const importedFiles: string[] = [];
  const failedFiles: Array<{ file: string; error: string }> = [];
  let imported = 0;
  let failed = 0;

  for (const file of files) {
    try {
      // Importing the module runs its decorators, which register its workflows and tasks.
      await import(file);

      imported++;
      importedFiles.push(file);

      if (verbose) {
        logger.debug(`✓ Imported: ${path.relative(normalizedBaseDir, file)}`);
      }
    } catch (error) {
      failed++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      failedFiles.push({ file, error: errorMessage });

      const relativeFile = path.relative(normalizedBaseDir, file);

      if (throwOnError) {
        logger.error(`✗ Failed to import: ${relativeFile}`);
        throw new Error(`Auto-discovery failed to import ${relativeFile}: ${errorMessage}`);
      } else {
        logger.warn(`⚠️  Failed to import: ${relativeFile} - ${errorMessage}`);
      }
    }
  }

  const durationMs = Date.now() - startTime;

  logger.info(`✅ Auto-discovery complete in ${durationMs}ms`);
  logger.info(`   Files found: ${files.length}`);
  logger.info(`   Imported: ${imported}`);
  if (failed > 0) {
    logger.warn(`   Failed: ${failed}`);
    if (!verbose && failedFiles.length > 0) {
      logger.warn('   Run with verbose: true to see details, or check failed files list');
    }
  }

  return {
    filesFound: files.length,
    filesImported: imported,
    filesFailed: failed,
    importedFiles,
    failedFiles,
    durationMs,
  };
}

/**
 * Check whether auto-discovery would find anything to import
 *
 * Returns true if `src`, `lib` or `app` under `baseDir` contains at least one `.ts` or `.js`
 * file outside the default exclusions. It does not check the registry. Any error while
 * scanning yields false.
 *
 * @param baseDir - Base directory to check
 * @returns Whether auto-discovery is recommended
 *
 * @example
 * ```typescript
 * if (await shouldUseAutoDiscover()) {
 *   await autoDiscover();
 * }
 * ```
 */
export async function shouldUseAutoDiscover(baseDir: string = process.cwd()): Promise<boolean> {
  try {
    const commonDirs = ['./src', './lib', './app'];
    const normalizedBaseDir = path.resolve(baseDir);

    for (const dir of commonDirs) {
      const fullPath = path.join(normalizedBaseDir, dir);
      const files = await glob('**/*.{ts,js}', {
        cwd: fullPath,
        ignore: DEFAULT_EXCLUDE_PATTERNS,
        absolute: false,
        onlyFiles: true,
      });

      if (files.length > 0) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Validate auto-discover options
 *
 * @param options - Options to validate
 * @throws TypeError if an option has the wrong type
 */
export function validateAutoDiscoverOptions(options: AutoDiscoverOptions): void {
  if (options.patterns && !Array.isArray(options.patterns)) {
    throw new TypeError('patterns must be an array of strings');
  }

  if (options.patterns && options.patterns.some((p) => typeof p !== 'string')) {
    throw new TypeError('all patterns must be strings');
  }

  if (options.exclude && !Array.isArray(options.exclude)) {
    throw new TypeError('exclude must be an array of strings');
  }

  if (options.exclude && options.exclude.some((p) => typeof p !== 'string')) {
    throw new TypeError('all exclude patterns must be strings');
  }

  if (options.baseDir && typeof options.baseDir !== 'string') {
    throw new TypeError('baseDir must be a string');
  }

  if (options.throwOnError && typeof options.throwOnError !== 'boolean') {
    throw new TypeError('throwOnError must be a boolean');
  }

  if (options.verbose && typeof options.verbose !== 'boolean') {
    throw new TypeError('verbose must be a boolean');
  }
}
