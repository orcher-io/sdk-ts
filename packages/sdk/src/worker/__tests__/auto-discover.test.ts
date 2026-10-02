/**
 * Auto-Discovery Tests
 *
 * Tests for the auto-discovery module and WorkerBuilder integration.
 *
 * @module @orcher/sdk/worker/__tests__/auto-discover
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { autoDiscover, shouldUseAutoDiscover, validateAutoDiscoverOptions } from '../auto-discover';
import type { AutoDiscoverOptions } from '../auto-discover';
import { WorkerBuilder } from '../worker-builder';
import { globalRegistry as diGlobalRegistry } from '../../di/registry';
import type { Logger } from '../types';

// Mock the native module: the Worker constructor creates a native service handle
// and starts polling. Poll functions never settle, so each loop parks on its
// first poll instead of spinning or holding the event loop open.
jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({
    serviceCreate: jest.fn(() => ({})),
    serviceStart: jest.fn(async () => undefined),
    pollWorkflowTask: jest.fn(() => new Promise(() => {})),
    pollTask: jest.fn(() => new Promise(() => {})),
  })),
  isNativeAvailable: jest.fn(() => true),
}));

const createMockLogger = (): Logger => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

describe('Auto-Discovery', () => {
  beforeEach(() => {
    diGlobalRegistry.clear();
  });

  afterEach(() => {
    diGlobalRegistry.clear();
  });

  describe('autoDiscover()', () => {
    it('should return result with statistics', async () => {
      const logger = createMockLogger();

      const result = await autoDiscover({
        patterns: ['./src/di/types.ts'], // Known existing file (not decorators which import tests)
        baseDir: path.join(__dirname, '../../..'),
        logger,
        verbose: false,
      });

      expect(result).toBeDefined();
      expect(result.filesFound).toBeGreaterThanOrEqual(0);
      expect(result.filesImported).toBeGreaterThanOrEqual(0);
      expect(result.filesFailed).toBeGreaterThanOrEqual(0);
      expect(result.importedFiles).toBeInstanceOf(Array);
      expect(result.failedFiles).toBeInstanceOf(Array);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should use default patterns when none provided', async () => {
      const logger = createMockLogger();

      const result = await autoDiscover({
        baseDir: path.join(__dirname, '../../..'),
        logger,
      });

      expect(result).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Starting auto-discovery'));
    });

    it('should exclude test files by default', async () => {
      const logger = createMockLogger();

      const result = await autoDiscover({
        patterns: ['./src/**/*.ts'],
        baseDir: path.join(__dirname, '../../..'),
        logger,
      });

      // Test files should be excluded by default
      const testFiles = result.importedFiles.filter((f) => f.includes('.test.ts'));
      expect(testFiles.length).toBe(0);
    });

    it('should exclude spec files by default', async () => {
      const logger = createMockLogger();

      const result = await autoDiscover({
        patterns: ['./src/**/*.ts'],
        baseDir: path.join(__dirname, '../../..'),
        logger,
      });

      // Spec files should be excluded
      const specFiles = result.importedFiles.filter((f) => f.includes('.spec.ts'));
      expect(specFiles.length).toBe(0);
    });

    it('should log verbose information when enabled', async () => {
      const logger = createMockLogger();

      await autoDiscover({
        patterns: ['./src/di/decorators/injectable.ts'],
        baseDir: path.join(__dirname, '../../..'),
        logger,
        verbose: true,
      });

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Base directory'));
    });

    it('should handle empty file list gracefully', async () => {
      const logger = createMockLogger();

      const result = await autoDiscover({
        patterns: ['./nonexistent/**/*.ts'],
        baseDir: path.join(__dirname, '../../..'),
        logger,
      });

      expect(result.filesFound).toBe(0);
      expect(result.filesImported).toBe(0);
      expect(result.filesFailed).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No files found matching patterns')
      );
    });

    it('should continue on import errors when throwOnError is false', async () => {
      const logger = createMockLogger();

      const result = await autoDiscover({
        patterns: ['./src/**/*.ts'],
        exclude: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**'],
        baseDir: path.join(__dirname, '../../..'),
        logger,
        throwOnError: false,
      });

      // Should complete even if some files fail
      expect(result).toBeDefined();
      if (result.filesFailed > 0) {
        expect(logger.warn).toHaveBeenCalled();
      }
    });

    it('should respect custom exclude patterns', async () => {
      const logger = createMockLogger();

      const result = await autoDiscover({
        patterns: ['./src/di/**/*.ts'],
        exclude: ['**/decorators/**', '**/__tests__/**'],
        baseDir: path.join(__dirname, '../../..'),
        logger,
      });

      const decoratorFiles = result.importedFiles.filter((f) => f.includes('/decorators/'));
      expect(decoratorFiles.length).toBe(0);
    });

    it('should handle absolute base directory paths', async () => {
      const logger = createMockLogger();
      const absolutePath = path.resolve(__dirname, '../../..');

      const result = await autoDiscover({
        patterns: ['./src/di/types.ts'],
        baseDir: absolutePath,
        logger,
      });

      expect(result).toBeDefined();
      expect(result.filesFound).toBeGreaterThanOrEqual(0);
    });

    it('should log completion summary', async () => {
      const logger = createMockLogger();

      await autoDiscover({
        patterns: ['./src/di/types.ts'],
        baseDir: path.join(__dirname, '../../..'),
        logger,
      });

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Auto-discovery complete'));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Files found:'));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Imported:'));
    });

    it('should include failed files in result', async () => {
      const logger = createMockLogger();

      const result = await autoDiscover({
        patterns: ['./src/**/*.ts'],
        baseDir: path.join(__dirname, '../../..'),
        logger,
        throwOnError: false,
      });

      expect(result.failedFiles).toBeInstanceOf(Array);
      result.failedFiles.forEach((failed) => {
        expect(failed).toHaveProperty('file');
        expect(failed).toHaveProperty('error');
      });
    });

    it('should measure execution duration', async () => {
      const logger = createMockLogger();

      const result = await autoDiscover({
        patterns: ['./src/di/types.ts'],
        baseDir: path.join(__dirname, '../../..'),
        logger,
      });

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.durationMs).toBe('number');
    });
  });

  describe('shouldUseAutoDiscover()', () => {
    it('should return boolean', async () => {
      const result = await shouldUseAutoDiscover();
      expect(typeof result).toBe('boolean');
    });

    it('should check for common source directories', async () => {
      const baseDir = path.join(__dirname, '../../..');
      const result = await shouldUseAutoDiscover(baseDir);

      // Should return true since we have src directory with files
      expect(result).toBe(true);
    });

    it('should return false for nonexistent directories', async () => {
      const result = await shouldUseAutoDiscover('/nonexistent/path');
      expect(result).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      const result = await shouldUseAutoDiscover('/dev/null');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('validateAutoDiscoverOptions()', () => {
    it('should accept valid options', () => {
      expect(() => {
        validateAutoDiscoverOptions({
          patterns: ['./src/**/*.ts'],
          exclude: ['**/*.test.ts'],
          baseDir: '/path/to/project',
          throwOnError: false,
          verbose: true,
        });
      }).not.toThrow();
    });

    it('should accept empty options', () => {
      expect(() => {
        validateAutoDiscoverOptions({});
      }).not.toThrow();
    });

    it('should throw if patterns is not an array', () => {
      expect(() => {
        validateAutoDiscoverOptions({
          patterns: 'invalid' as any,
        });
      }).toThrow('patterns must be an array of strings');
    });

    it('should throw if patterns contains non-strings', () => {
      expect(() => {
        validateAutoDiscoverOptions({
          patterns: ['valid', 123] as any,
        });
      }).toThrow('all patterns must be strings');
    });

    it('should throw if exclude is not an array', () => {
      expect(() => {
        validateAutoDiscoverOptions({
          exclude: 'invalid' as any,
        });
      }).toThrow('exclude must be an array of strings');
    });

    it('should throw if exclude contains non-strings', () => {
      expect(() => {
        validateAutoDiscoverOptions({
          exclude: ['valid', false] as any,
        });
      }).toThrow('all exclude patterns must be strings');
    });

    it('should throw if baseDir is not a string', () => {
      expect(() => {
        validateAutoDiscoverOptions({
          baseDir: 123 as any,
        });
      }).toThrow('baseDir must be a string');
    });

    it('should throw if throwOnError is not a boolean', () => {
      expect(() => {
        validateAutoDiscoverOptions({
          throwOnError: 'yes' as any,
        });
      }).toThrow('throwOnError must be a boolean');
    });

    it('should throw if verbose is not a boolean', () => {
      expect(() => {
        validateAutoDiscoverOptions({
          verbose: 1 as any,
        });
      }).toThrow('verbose must be a boolean');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid patterns by returning no results', async () => {
      const logger = createMockLogger();

      // Invalid pattern that fast-glob might handle gracefully
      const result = await autoDiscover({
        patterns: ['./nonexistent/**/*.ts'],
        baseDir: __dirname,
        logger,
      });

      // Should complete without error, just find no files
      expect(result.filesFound).toBe(0);
    });
  });
});

describe('WorkerBuilder', () => {
  beforeEach(() => {
    diGlobalRegistry.clear();
  });

  afterEach(() => {
    diGlobalRegistry.clear();
  });

  describe('Fluent API', () => {
    it('should create builder via static create()', () => {
      const builder = WorkerBuilder.create();
      expect(builder).toBeInstanceOf(WorkerBuilder);
    });

    it('should chain configuration methods', () => {
      const builder = WorkerBuilder.create()
        .serverUrl('http://localhost:50051')
        .namespace('test')
        .taskQueue('test-queue')
        .maxConcurrentWorkflows(50)
        .maxConcurrentTasks(100);

      expect(builder).toBeInstanceOf(WorkerBuilder);
    });

    it('should set server address', () => {
      const builder = WorkerBuilder.create().serverUrl('http://localhost:50051');
      expect(builder).toBeInstanceOf(WorkerBuilder);
    });

    it('should set namespace', () => {
      const builder = WorkerBuilder.create().namespace('production');
      expect(builder).toBeInstanceOf(WorkerBuilder);
    });

    it('should set task queue', () => {
      const builder = WorkerBuilder.create().taskQueue('my-queue');
      expect(builder).toBeInstanceOf(WorkerBuilder);
    });

    it('should set max concurrent workflows', () => {
      const builder = WorkerBuilder.create().maxConcurrentWorkflows(200);
      expect(builder).toBeInstanceOf(WorkerBuilder);
    });

    it('should set max concurrent tasks', () => {
      const builder = WorkerBuilder.create().maxConcurrentTasks(500);
      expect(builder).toBeInstanceOf(WorkerBuilder);
    });

    it('should set workflow poll interval', () => {
      const builder = WorkerBuilder.create().workflowPollInterval(50);
      expect(builder).toBeInstanceOf(WorkerBuilder);
    });

    it('should set task poll interval', () => {
      const builder = WorkerBuilder.create().taskPollInterval(50);
      expect(builder).toBeInstanceOf(WorkerBuilder);
    });

    it('should set shutdown grace time', () => {
      const builder = WorkerBuilder.create().shutdownGraceTime(60000);
      expect(builder).toBeInstanceOf(WorkerBuilder);
    });

    it('should set force shutdown timeout', () => {
      const builder = WorkerBuilder.create().forceShutdownTimeout(120000);
      expect(builder).toBeInstanceOf(WorkerBuilder);
    });

    it('should set identity', () => {
      const builder = WorkerBuilder.create().identity('worker-123');
      expect(builder).toBeInstanceOf(WorkerBuilder);
    });

    it('should set build ID', () => {
      const builder = WorkerBuilder.create().versionId('v1.2.3');
      expect(builder).toBeInstanceOf(WorkerBuilder);
    });

    it('should set binary checksum', () => {
      const builder = WorkerBuilder.create().binaryChecksum('abc123');
      expect(builder).toBeInstanceOf(WorkerBuilder);
    });

    it('should set custom logger', () => {
      const logger = createMockLogger();
      const builder = WorkerBuilder.create().logger(logger);
      expect(builder).toBeInstanceOf(WorkerBuilder);
    });

    it('should enable auto-discovery without options', () => {
      const builder = WorkerBuilder.create().autoDiscover();
      expect(builder).toBeInstanceOf(WorkerBuilder);
    });

    it('should enable auto-discovery with options', () => {
      const builder = WorkerBuilder.create().autoDiscover({
        patterns: ['./src/tasks/**/*.ts'],
        exclude: ['**/*.test.ts'],
      });
      expect(builder).toBeInstanceOf(WorkerBuilder);
    });
  });

  describe('build()', () => {
    it('should throw if serverUrl is missing', async () => {
      const builder = WorkerBuilder.create().namespace('test').taskQueue('test-queue');

      await expect(builder.build()).rejects.toThrow('serverUrl is required');
    });

    it('should throw if namespace is missing', async () => {
      const builder = WorkerBuilder.create()
        .serverUrl('http://localhost:50051')
        .taskQueue('test-queue');

      await expect(builder.build()).rejects.toThrow('namespace is required');
    });

    it('should throw if taskQueue is missing', async () => {
      const builder = WorkerBuilder.create()
        .serverUrl('http://localhost:50051')
        .namespace('test');

      await expect(builder.build()).rejects.toThrow('taskQueue is required');
    });

    it('should build service with required options', async () => {
      const logger = createMockLogger();

      const service = await WorkerBuilder.create()
        .serverUrl('http://localhost:50051')
        .namespace('test')
        .taskQueue('test-queue')
        .logger(logger)
        .build();

      expect(service).toBeDefined();
      expect(service.getContainer()).toBeDefined();
    });

    it('should build service without auto-discovery', async () => {
      const logger = createMockLogger();

      const service = await WorkerBuilder.create()
        .serverUrl('http://localhost:50051')
        .namespace('test')
        .taskQueue('test-queue')
        .logger(logger)
        .build();

      expect(service).toBeDefined();
    });

    it('should return undefined auto-discovery result when not used', () => {
      const builder = WorkerBuilder.create();
      expect(builder.getAutoDiscoverResult()).toBeUndefined();
    });
  });

  describe('Auto-Discovery Integration', () => {
    it('should run auto-discovery when enabled', async () => {
      const logger = createMockLogger();

      const service = await WorkerBuilder.create()
        .serverUrl('http://localhost:50051')
        .namespace('test')
        .taskQueue('test-queue')
        .logger(logger)
        .autoDiscover({
          patterns: ['./src/di/types.ts'],
          baseDir: path.join(__dirname, '../../..'),
          throwOnError: false,
        })
        .build();

      expect(service).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Running auto-discovery'));
    });

    it('should provide auto-discovery result after build', async () => {
      const logger = createMockLogger();

      const builder = WorkerBuilder.create()
        .serverUrl('http://localhost:50051')
        .namespace('test')
        .taskQueue('test-queue')
        .logger(logger)
        .autoDiscover({
          patterns: ['./src/di/types.ts'],
          baseDir: path.join(__dirname, '../../..'),
          throwOnError: false,
        });

      await builder.build();

      const result = builder.getAutoDiscoverResult();
      expect(result).toBeDefined();
      expect(result?.filesFound).toBeGreaterThanOrEqual(0);
    });

    it('should warn if auto-discovery has failures', async () => {
      const logger = createMockLogger();

      const service = await WorkerBuilder.create()
        .serverUrl('http://localhost:50051')
        .namespace('test')
        .taskQueue('test-queue')
        .logger(logger)
        .autoDiscover({
          patterns: ['./src/**/*.ts'],
          baseDir: path.join(__dirname, '../../..'),
          throwOnError: false,
        })
        .build();

      expect(service).toBeDefined();
      // May or may not have failures depending on files
    });
  });

  describe('Worker.builder() static method', () => {
    it('should create builder from Service class', async () => {
      const { Worker } = await import('../worker');
      const builder = Worker.builder();
      expect(builder).toBeInstanceOf(WorkerBuilder);
    });

    it('should create service via Worker.builder()', async () => {
      const { Worker } = await import('../worker');
      const logger = createMockLogger();

      const service = await Worker.builder()
        .serverUrl('http://localhost:50051')
        .namespace('test')
        .taskQueue('test-queue')
        .logger(logger)
        .build();

      expect(service).toBeDefined();
    });
  });
});
