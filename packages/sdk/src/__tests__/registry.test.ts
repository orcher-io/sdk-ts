/**
 * Tests for the GlobalRegistry auto-registration system.
 *
 * @packageDocumentation
 */

import 'reflect-metadata';
import { globalRegistry, workflow } from '../index';
import { task } from '../task/decorator';

// SKIPPED: these tests apply `@workflow(...)` / `@task(...)` as decorators on
// *function declarations*, which TypeScript does not support — decorators are
// only valid on classes and class members. The API is a functional wrapper
// (`workflow({ name }, handler)`), and the class decorators live in
// `di/decorators/`. Reviving this file means rewriting each case against one of
// those two paradigms, which is a deliberate rewrite rather than an import fix,
// so the suite is skipped explicitly instead of failing in every local run.
//
// The registry is still covered: the suites in `src/di/__tests__` exercise the
// container and the class decorators, and
// `worker/__tests__/service-di-integration.test.ts` registers @Injectable /
// @Tasks / @Task through a real Worker and resolves them.
describe.skip('GlobalRegistry', () => {
  beforeEach(() => {
    globalRegistry.clear();
  });

  afterEach(() => {
    globalRegistry.clear();
  });

  describe('Workflow Registration', () => {
    it('should automatically register workflow when decorator is applied', () => {
      @workflow({ name: 'testWorkflow' })
      async function testWorkflow(ctx: any) {
        return 'success';
      }

      const registered = globalRegistry.getWorkflow('testWorkflow');
      expect(registered).toBeDefined();
      expect(registered?.metadata.name).toBe('testWorkflow');
      expect(registered?.handler).toBe(testWorkflow);
    });

    it('should use function name as default workflow name', () => {
      @workflow()
      async function myCustomWorkflow(ctx: any) {
        return 'success';
      }

      const registered = globalRegistry.getWorkflow('myCustomWorkflow');
      expect(registered).toBeDefined();
      expect(registered?.metadata.name).toBe('myCustomWorkflow');
    });

    it('should track all registered workflows', () => {
      @workflow({ name: 'workflow1' })
      async function wf1(ctx: any) {}

      @workflow({ name: 'workflow2' })
      async function wf2(ctx: any) {}

      const allWorkflows = globalRegistry.getAllWorkflows();
      expect(allWorkflows).toHaveLength(2);
      expect(globalRegistry.hasWorkflow('workflow1')).toBe(true);
      expect(globalRegistry.hasWorkflow('workflow2')).toBe(true);
    });

    it('should prevent duplicate workflow registration', () => {
      @workflow({ name: 'duplicateWorkflow' })
      async function wf1(ctx: any) {}

      // Second decorator with same name should log warning
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      @workflow({ name: 'duplicateWorkflow' })
      async function wf2(ctx: any) {}

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to register workflow'),
        expect.anything()
      );

      consoleSpy.mockRestore();
    });

    it('should include workflow metadata', () => {
      @workflow({
        name: 'orderWorkflow',
        description: 'Process customer orders',
        taskQueue: 'orders',
        executionTimeout: 300000,
      })
      async function orderWorkflow(ctx: any, order: any) {
        return { orderId: order.id };
      }

      const registered = globalRegistry.getWorkflow('orderWorkflow');
      expect(registered?.metadata).toMatchObject({
        name: 'orderWorkflow',
        description: 'Process customer orders',
        taskQueue: 'orders',
        executionTimeout: 300000,
        registered: true,
      });
    });
  });

  describe('Task Registration', () => {
    it('should automatically register task when decorator is applied', () => {
      @task({ name: 'testTask' })
      async function testTask(arg: string) {
        return `processed: ${arg}`;
      }

      const registered = globalRegistry.getTask('testTask');
      expect(registered).toBeDefined();
      expect(registered?.metadata.name).toBe('testTask');
      expect(registered?.handler).toBe(testTask);
    });

    it('should use function name as default task name', () => {
      @task()
      async function sendEmail(to: string, subject: string) {
        return { sent: true };
      }

      const registered = globalRegistry.getTask('sendEmail');
      expect(registered).toBeDefined();
      expect(registered?.metadata.name).toBe('sendEmail');
    });

    it('should track all registered tasks', () => {
      @task({ name: 'task1' })
      async function t1(arg: string) {}

      @task({ name: 'task2' })
      async function t2(arg: number) {}

      @task({ name: 'task3' })
      async function t3(arg: boolean) {}

      const allTasks = globalRegistry.getAllTasks();
      expect(allTasks).toHaveLength(3);
      expect(globalRegistry.hasTask('task1')).toBe(true);
      expect(globalRegistry.hasTask('task2')).toBe(true);
      expect(globalRegistry.hasTask('task3')).toBe(true);
    });

    it('should prevent duplicate task registration', () => {
      @task({ name: 'duplicateTask' })
      async function t1(arg: string) {}

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      @task({ name: 'duplicateTask' })
      async function t2(arg: string) {}

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to register task'),
        expect.anything()
      );

      consoleSpy.mockRestore();
    });

    it('should include task metadata with retry policy', () => {
      @task({
        name: 'processPayment',
        description: 'Process payment via gateway',
        executionTimeout: 30000,
        retryPolicy: {
          maxAttempts: 5,
          initialInterval: 2000,
          backoffCoefficient: 2.0,
          maxInterval: 60000,
          nonRetryableErrors: ['InvalidCardError'],
        },
      })
      async function processPayment(orderId: string, amount: number) {
        return { transactionId: '123' };
      }

      const registered = globalRegistry.getTask('processPayment');
      expect(registered?.metadata).toMatchObject({
        name: 'processPayment',
        description: 'Process payment via gateway',
        executionTimeout: 30000,
        registered: true,
      });
      expect(registered?.metadata.retryPolicy).toMatchObject({
        maxAttempts: 5,
        initialInterval: 2000,
        backoffCoefficient: 2.0,
        maxInterval: 60000,
        nonRetryableErrors: ['InvalidCardError'],
      });
    });
  });

  describe('Registry Operations', () => {
    it('should get workflow by name', () => {
      @workflow({ name: 'myWorkflow' })
      async function wf(ctx: any) {}

      const result = globalRegistry.getWorkflow('myWorkflow');
      expect(result).toBeDefined();
      expect(result?.metadata.name).toBe('myWorkflow');
    });

    it('should return undefined for non-existent workflow', () => {
      const result = globalRegistry.getWorkflow('nonExistent');
      expect(result).toBeUndefined();
    });

    it('should get task by name', () => {
      @task({ name: 'myTask' })
      async function t(arg: string) {}

      const result = globalRegistry.getTask('myTask');
      expect(result).toBeDefined();
      expect(result?.metadata.name).toBe('myTask');
    });

    it('should return undefined for non-existent task', () => {
      const result = globalRegistry.getTask('nonExistent');
      expect(result).toBeUndefined();
    });

    it('should get workflow names', () => {
      @workflow({ name: 'wf1' })
      async function workflow1(ctx: any) {}

      @workflow({ name: 'wf2' })
      async function workflow2(ctx: any) {}

      const names = globalRegistry.getWorkflowNames();
      expect(names).toEqual(expect.arrayContaining(['wf1', 'wf2']));
      expect(names).toHaveLength(2);
    });

    it('should get task names', () => {
      @task({ name: 't1' })
      async function task1(arg: string) {}

      @task({ name: 't2' })
      async function task2(arg: number) {}

      const names = globalRegistry.getTaskNames();
      expect(names).toEqual(expect.arrayContaining(['t1', 't2']));
      expect(names).toHaveLength(2);
    });

    it('should clear all registrations', () => {
      @workflow({ name: 'wf1' })
      async function wf(ctx: any) {}

      @task({ name: 't1' })
      async function t(arg: string) {}

      expect(globalRegistry.getAllWorkflows()).toHaveLength(1);
      expect(globalRegistry.getAllTasks()).toHaveLength(1);

      globalRegistry.clear();

      expect(globalRegistry.getAllWorkflows()).toHaveLength(0);
      expect(globalRegistry.getAllTasks()).toHaveLength(0);
    });

    it('should clear only workflows', () => {
      @workflow({ name: 'wf1' })
      async function wf(ctx: any) {}

      @task({ name: 't1' })
      async function t(arg: string) {}

      globalRegistry.clearWorkflows();

      expect(globalRegistry.getAllWorkflows()).toHaveLength(0);
      expect(globalRegistry.getAllTasks()).toHaveLength(1);
    });

    it('should clear only tasks', () => {
      @workflow({ name: 'wf1' })
      async function wf(ctx: any) {}

      @task({ name: 't1' })
      async function t(arg: string) {}

      globalRegistry.clearTasks();

      expect(globalRegistry.getAllWorkflows()).toHaveLength(1);
      expect(globalRegistry.getAllTasks()).toHaveLength(0);
    });
  });

  describe('Registry Statistics', () => {
    it('should provide accurate statistics', () => {
      @workflow({ name: 'wf1' })
      async function workflow1(ctx: any) {}

      @workflow({ name: 'wf2' })
      async function workflow2(ctx: any) {}

      @task({ name: 't1' })
      async function task1(arg: string) {}

      @task({ name: 't2' })
      async function task2(arg: number) {}

      @task({ name: 't3' })
      async function task3(arg: boolean) {}

      const stats = globalRegistry.getStats();

      expect(stats.workflows).toBe(2);
      expect(stats.tasks).toBe(3);
      expect(stats.actors).toBe(0);
      expect(stats.queries).toBe(0);
      expect(stats.events).toBe(0);
      expect(stats.workflowNames).toEqual(expect.arrayContaining(['wf1', 'wf2']));
      expect(stats.taskNames).toEqual(expect.arrayContaining(['t1', 't2', 't3']));
    });

    it('should generate summary string', () => {
      @workflow({ name: 'orderWorkflow' })
      async function orderWorkflow(ctx: any) {}

      @task({ name: 'processPayment' })
      async function processPayment(orderId: string) {}

      @task({ name: 'sendEmail' })
      async function sendEmail(to: string) {}

      const summary = globalRegistry.getSummary();

      expect(summary).toContain('ORCHER Global Registry Summary');
      expect(summary).toContain('Workflows: 1');
      expect(summary).toContain('Tasks: 2');
      expect(summary).toContain('orderWorkflow');
      expect(summary).toContain('processPayment');
      expect(summary).toContain('sendEmail');
      expect(summary).toContain('Total Handlers: 3');
    });
  });

  describe('Registry Validation', () => {
    it('should validate registry integrity', () => {
      @workflow({ name: 'validWorkflow' })
      async function wf(ctx: any) {}

      @task({ name: 'validTask' })
      async function t(arg: string) {}

      const errors = globalRegistry.validate();
      expect(errors).toEqual([]);
    });

    it('should detect validation errors', () => {
      @workflow({ name: 'wf1' })
      async function wf(ctx: any) {}

      // Manually corrupt the registry for testing
      const workflow = globalRegistry.getWorkflow('wf1');
      if (workflow) {
        // @ts-ignore - Intentional corruption for testing
        workflow.handler = null;
      }

      const errors = globalRegistry.validate();
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('invalid handler');
    });
  });

  describe('Real-World Usage Scenarios', () => {
    it('should handle e-commerce order workflow', () => {
      @workflow({
        name: 'orderProcessing',
        description: 'Process customer orders',
        taskQueue: 'orders',
        executionTimeout: 300000,
      })
      async function orderProcessing(ctx: any, order: any) {
        return { orderId: order.id, status: 'completed' };
      }

      @task({ name: 'chargeCard' })
      async function chargeCard(orderId: string, amount: number) {
        return { transactionId: '123', charged: amount };
      }

      @task({ name: 'reserveInventory' })
      async function reserveInventory(items: any[]) {
        return { reserved: true };
      }

      @task({ name: 'sendConfirmationEmail' })
      async function sendConfirmationEmail(email: string, orderId: string) {
        return { sent: true };
      }

      expect(globalRegistry.hasWorkflow('orderProcessing')).toBe(true);
      expect(globalRegistry.hasTask('chargeCard')).toBe(true);
      expect(globalRegistry.hasTask('reserveInventory')).toBe(true);
      expect(globalRegistry.hasTask('sendConfirmationEmail')).toBe(true);

      const stats = globalRegistry.getStats();
      expect(stats.workflows).toBe(1);
      expect(stats.tasks).toBe(3);
    });

    it('should handle multiple workflow definitions', () => {
      @workflow({ name: 'userOnboarding' })
      async function userOnboarding(ctx: any, user: any) {
        return { userId: user.id };
      }

      @workflow({ name: 'dailyReport' })
      async function dailyReport(ctx: any, date: string) {
        return { reportId: 'report-123' };
      }

      @workflow({ name: 'dataSync' })
      async function dataSync(ctx: any) {
        return { synced: true };
      }

      const workflows = globalRegistry.getAllWorkflows();
      expect(workflows).toHaveLength(3);

      const names = globalRegistry.getWorkflowNames();
      expect(names).toContain('userOnboarding');
      expect(names).toContain('dailyReport');
      expect(names).toContain('dataSync');
    });
  });

  describe('Debug Mode', () => {
    it('should enable debug logging', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      globalRegistry.setDebug(true);

      @workflow({ name: 'testWorkflow' })
      async function wf(ctx: any) {}

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[GlobalRegistry]')
      );

      globalRegistry.setDebug(false);
      consoleSpy.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    it('should handle workflow with no options', () => {
      @workflow()
      async function simpleWorkflow(ctx: any) {
        return 'done';
      }

      const registered = globalRegistry.getWorkflow('simpleWorkflow');
      expect(registered).toBeDefined();
      expect(registered?.metadata.name).toBe('simpleWorkflow');
    });

    it('should handle task with no options', () => {
      @task()
      async function simpleTask(arg: string) {
        return arg;
      }

      const registered = globalRegistry.getTask('simpleTask');
      expect(registered).toBeDefined();
      expect(registered?.metadata.name).toBe('simpleTask');
    });

    it('should handle empty registry', () => {
      expect(globalRegistry.getAllWorkflows()).toEqual([]);
      expect(globalRegistry.getAllTasks()).toEqual([]);
      expect(globalRegistry.getWorkflowNames()).toEqual([]);
      expect(globalRegistry.getTaskNames()).toEqual([]);

      const stats = globalRegistry.getStats();
      expect(stats.workflows).toBe(0);
      expect(stats.tasks).toBe(0);
    });
  });
});
