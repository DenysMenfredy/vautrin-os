import 'reflect-metadata';

import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createPlatformClient,
  createPrismaClient,
  type PrismaClient,
  withTenant,
} from '@vautrin/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { WorkflowRunExecutor } from '../src/workflows/workflow-run.executor.js';

const suffix = Date.now();
let app: INestApplicationContext;
let platform: PrismaClient;
let runtime: PrismaClient;
let tenantA = '';
let tenantB = '';
let runId = '';
let executor: WorkflowRunExecutor;

beforeAll(async () => {
  app = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await app.init();
  platform = createPlatformClient();
  runtime = createPrismaClient();
  [tenantA, tenantB] = await Promise.all([
    platform.tenant
      .create({ data: { slug: `workflow-run-a-${suffix}`, name: 'Workflow Run Tenant A' } })
      .then((tenant) => tenant.id),
    platform.tenant
      .create({ data: { slug: `workflow-run-b-${suffix}`, name: 'Workflow Run Tenant B' } })
      .then((tenant) => tenant.id),
  ]);
  executor = app.get(WorkflowRunExecutor);

  runId = await withTenant(runtime, tenantA, async (tx) => {
    const workflow = await tx.workflow.create({
      data: {
        tenantId: tenantA,
        key: `workflow-run-test-${suffix}`,
        version: 1,
        name: 'Wait then end',
        trigger: 'test.trigger',
        status: 'ACTIVE',
        publishedAt: new Date(),
        definition: {
          steps: [
            { id: 'wait-a', type: 'wait', config: { duration: '30s' } },
            { id: 'finish', type: 'end', config: {} },
          ],
        },
      },
    });
    const run = await tx.workflowRun.create({
      data: {
        tenantId: tenantA,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        triggerEvent: workflow.trigger,
        idempotencyKey: `workflow-run-test-${suffix}`,
      },
    });
    return run.id;
  });
});

afterAll(async () => {
  await runtime?.$disconnect();
  await platform?.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await platform?.$disconnect();
  await app?.close();
});

describe('durable workflow execution (VOS-083/084)', () => {
  it('persists a wait, resumes after its deadline, and treats duplicate jobs idempotently', async () => {
    const discoveredTenants = await runtime.$queryRaw<Array<{ tenant_id: string }>>`
      SELECT tenant_id FROM app.pending_workflow_run_tenants(50)
    `;
    expect(discoveredTenants.some((tenant) => tenant.tenant_id === tenantA)).toBe(true);

    const started = await executor.handle({ tenantId: tenantA, runId, action: 'start' });
    expect(started.result).toBe('waiting');
    expect(
      await withTenant(runtime, tenantA, (tx) =>
        tx.workflowRun.findFirst({ where: { id: runId, tenantId: tenantA } }),
      ),
    ).toMatchObject({ status: 'WAITING', currentStepId: 'wait-a' });
    const scheduledWait = await withTenant(runtime, tenantA, (tx) =>
      tx.workflowStepRun.findFirst({
        where: { tenantId: tenantA, workflowRunId: runId, stepId: 'wait-a' },
      }),
    );
    expect(scheduledWait?.status).toBe('SCHEDULED');
    expect(scheduledWait?.scheduledFor?.getTime()).toBeGreaterThan(Date.now());

    await withTenant(runtime, tenantA, async (tx) => {
      const past = new Date(Date.now() - 1_000);
      await tx.workflowRun.update({
        where: { id: runId, tenantId: tenantA },
        data: { scheduledFor: past },
      });
      await tx.workflowStepRun.updateMany({
        where: { tenantId: tenantA, workflowRunId: runId, stepId: 'wait-a' },
        data: { scheduledFor: past },
      });
    });

    const wake = { tenantId: tenantA, runId, action: 'wake' as const, stepId: 'wait-a' };
    expect((await executor.handle(wake)).result).toBe('completed');
    expect((await executor.handle(wake)).result).toBe('ignored');
    const result = await withTenant(runtime, tenantA, async (tx) => ({
      run: await tx.workflowRun.findFirst({ where: { id: runId, tenantId: tenantA } }),
      steps: await tx.workflowStepRun.findMany({
        where: { tenantId: tenantA, workflowRunId: runId },
        orderBy: { stepIndex: 'asc' },
      }),
    }));
    expect(result.run?.status).toBe('COMPLETED');
    expect(result.steps.map((step) => step.status)).toEqual(['COMPLETED', 'COMPLETED']);
  });

  it('completes a false condition, persists its decision, and follows onFalse', async () => {
    const conditionRunId = await withTenant(runtime, tenantA, async (tx) => {
      const workflow = await tx.workflow.create({
        data: {
          tenantId: tenantA,
          key: `workflow-run-condition-false-${suffix}`,
          version: 1,
          name: 'False condition branch',
          trigger: 'test.trigger',
          status: 'ACTIVE',
          publishedAt: new Date(),
          definition: {
            steps: [
              {
                id: 'check',
                type: 'condition',
                config: {
                  condition: { field: 'workflow.key', operator: 'eq', value: 'not-this-workflow' },
                  onTrue: 'true-end',
                  onFalse: 'false-end',
                },
              },
              { id: 'true-end', type: 'end', config: {} },
              { id: 'false-end', type: 'end', config: {} },
            ],
          },
        },
      });
      const run = await tx.workflowRun.create({
        data: {
          tenantId: tenantA,
          workflowId: workflow.id,
          workflowVersion: workflow.version,
          triggerEvent: workflow.trigger,
          idempotencyKey: `workflow-run-condition-false-${suffix}`,
        },
      });
      return run.id;
    });

    expect(
      (await executor.handle({ tenantId: tenantA, runId: conditionRunId, action: 'start' })).result,
    ).toBe('completed');
    const conditionResult = await withTenant(runtime, tenantA, async (tx) => {
      const run = await tx.workflowRun.findFirst({
        where: { id: conditionRunId, tenantId: tenantA },
      });
      const steps = await tx.workflowStepRun.findMany({
        where: { tenantId: tenantA, workflowRunId: conditionRunId },
        orderBy: { stepIndex: 'asc' },
      });
      const evaluatedStep = steps.find((step) => step.stepId === 'check');
      const audit = evaluatedStep
        ? await tx.auditLog.findFirst({
            where: {
              tenantId: tenantA,
              action: 'workflow.condition.evaluated',
              resourceType: 'workflow_step_run',
              resourceId: evaluatedStep.id,
            },
          })
        : null;
      return { run, steps, audit };
    });
    expect(conditionResult.run?.status).toBe('COMPLETED');
    expect(conditionResult.steps.map((step) => step.status)).toEqual([
      'COMPLETED',
      'SKIPPED',
      'COMPLETED',
    ]);
    expect(conditionResult.steps[0]?.output).toMatchObject({
      result: false,
      selectedBranch: 'onFalse',
      nextStepId: 'false-end',
    });
    expect(conditionResult.audit?.metadata).toMatchObject({
      result: false,
      selectedBranch: 'onFalse',
      nextStepId: 'false-end',
    });
  });

  it('completes successfully when the selected condition branch is absent', async () => {
    const noBranchRunId = await withTenant(runtime, tenantA, async (tx) => {
      const workflow = await tx.workflow.create({
        data: {
          tenantId: tenantA,
          key: `workflow-run-condition-no-branch-${suffix}`,
          version: 1,
          name: 'Condition without false branch',
          trigger: 'test.trigger',
          status: 'ACTIVE',
          publishedAt: new Date(),
          definition: {
            steps: [
              {
                id: 'check',
                type: 'condition',
                config: { condition: { field: 'lead.status', operator: 'eq', value: 'NEW' } },
              },
              { id: 'unused', type: 'end', config: {} },
            ],
          },
        },
      });
      const run = await tx.workflowRun.create({
        data: {
          tenantId: tenantA,
          workflowId: workflow.id,
          workflowVersion: workflow.version,
          triggerEvent: workflow.trigger,
          idempotencyKey: `workflow-run-condition-no-branch-${suffix}`,
        },
      });
      return run.id;
    });

    expect(
      (await executor.handle({ tenantId: tenantA, runId: noBranchRunId, action: 'start' })).result,
    ).toBe('completed');
    const noBranch = await withTenant(runtime, tenantA, async (tx) => ({
      run: await tx.workflowRun.findFirst({ where: { id: noBranchRunId, tenantId: tenantA } }),
      steps: await tx.workflowStepRun.findMany({
        where: { tenantId: tenantA, workflowRunId: noBranchRunId },
        orderBy: { stepIndex: 'asc' },
      }),
    }));
    expect(noBranch.run?.status).toBe('COMPLETED');
    expect(noBranch.steps.map((step) => step.status)).toEqual(['COMPLETED', 'SKIPPED']);
    expect(noBranch.steps[0]?.output).toMatchObject({ result: false, selectedBranch: 'onFalse' });
  });

  it('does not resolve domain context records owned by another tenant', async () => {
    const foreignIds = await withTenant(runtime, tenantB, async (tx) => {
      const contact = await tx.contact.create({ data: { tenantId: tenantB } });
      const lead = await tx.lead.create({ data: { tenantId: tenantB, contactId: contact.id } });
      return { contactId: contact.id, leadId: lead.id };
    });
    const contextRunId = await withTenant(runtime, tenantA, async (tx) => {
      const event = await tx.event.create({
        data: {
          tenantId: tenantA,
          name: 'lead.created',
          version: 1,
          payload: foreignIds,
          idempotencyKey: `workflow-run-foreign-context-event-${suffix}`,
        },
      });
      const workflow = await tx.workflow.create({
        data: {
          tenantId: tenantA,
          key: `workflow-run-foreign-context-${suffix}`,
          version: 1,
          name: 'Foreign context reference',
          trigger: event.name,
          status: 'ACTIVE',
          publishedAt: new Date(),
          definition: {
            steps: [
              {
                id: 'check',
                type: 'condition',
                config: {
                  condition: { field: 'lead.status', operator: 'exists' },
                  onTrue: 'leaked',
                  onFalse: 'safe',
                },
              },
              { id: 'leaked', type: 'end', config: {} },
              { id: 'safe', type: 'end', config: {} },
            ],
          },
        },
      });
      const run = await tx.workflowRun.create({
        data: {
          tenantId: tenantA,
          workflowId: workflow.id,
          workflowVersion: workflow.version,
          triggerEvent: event.name,
          triggerEventId: event.id,
          idempotencyKey: `workflow-run-foreign-context-${suffix}`,
        },
      });
      return run.id;
    });

    expect(
      (await executor.handle({ tenantId: tenantA, runId: contextRunId, action: 'start' })).result,
    ).toBe('completed');
    const contextRun = await withTenant(runtime, tenantA, (tx) =>
      tx.workflowStepRun.findFirst({
        where: { tenantId: tenantA, workflowRunId: contextRunId, stepId: 'check' },
      }),
    );
    expect(contextRun?.output).toMatchObject({ result: false, selectedBranch: 'onFalse' });
  });

  it('fails invalid runtime condition configuration with an explicit step error', async () => {
    const invalidRunId = await withTenant(runtime, tenantA, async (tx) => {
      const workflow = await tx.workflow.create({
        data: {
          tenantId: tenantA,
          key: `workflow-run-condition-invalid-${suffix}`,
          version: 1,
          name: 'Invalid condition',
          trigger: 'test.trigger',
          status: 'ACTIVE',
          publishedAt: new Date(),
          definition: { steps: [{ id: 'check', type: 'condition', config: {} }] },
        },
      });
      const run = await tx.workflowRun.create({
        data: {
          tenantId: tenantA,
          workflowId: workflow.id,
          workflowVersion: workflow.version,
          triggerEvent: workflow.trigger,
          idempotencyKey: `workflow-run-condition-invalid-${suffix}`,
        },
      });
      return run.id;
    });

    expect(
      (await executor.handle({ tenantId: tenantA, runId: invalidRunId, action: 'start' })).result,
    ).toBe('failed');
    const invalid = await withTenant(runtime, tenantA, async (tx) => ({
      run: await tx.workflowRun.findFirst({ where: { id: invalidRunId, tenantId: tenantA } }),
      step: await tx.workflowStepRun.findFirst({
        where: { tenantId: tenantA, workflowRunId: invalidRunId, stepId: 'check' },
      }),
    }));
    expect(invalid.run).toMatchObject({
      status: 'FAILED',
      error: 'invalid_condition_configuration',
    });
    expect(invalid.step).toMatchObject({
      status: 'FAILED',
      error: 'invalid_condition_configuration',
    });
  });

  it('cannot read or advance another tenant’s run', async () => {
    const before = await withTenant(runtime, tenantA, (tx) =>
      tx.workflowRun.findFirst({ where: { id: runId, tenantId: tenantA } }),
    );
    const result = await executor.handle({ tenantId: tenantB, runId, action: 'start' });
    expect(result.result).toBe('ignored');
    const after = await withTenant(runtime, tenantA, (tx) =>
      tx.workflowRun.findFirst({ where: { id: runId, tenantId: tenantA } }),
    );
    expect(after?.status).toBe(before?.status);
  });
});
