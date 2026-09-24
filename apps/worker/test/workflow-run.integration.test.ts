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

  it('fails unsupported step types explicitly instead of skipping them', async () => {
    const unsupportedRunId = await withTenant(runtime, tenantA, async (tx) => {
      const workflow = await tx.workflow.create({
        data: {
          tenantId: tenantA,
          key: `workflow-run-unsupported-${suffix}`,
          version: 1,
          name: 'Unsupported action',
          trigger: 'test.trigger',
          status: 'ACTIVE',
          publishedAt: new Date(),
          definition: {
            steps: [{ id: 'check-reply', type: 'condition', config: {} }],
          },
        },
      });
      const run = await tx.workflowRun.create({
        data: {
          tenantId: tenantA,
          workflowId: workflow.id,
          workflowVersion: workflow.version,
          triggerEvent: workflow.trigger,
          idempotencyKey: `workflow-run-unsupported-${suffix}`,
        },
      });
      return run.id;
    });

    expect(
      (await executor.handle({ tenantId: tenantA, runId: unsupportedRunId, action: 'start' }))
        .result,
    ).toBe('failed');
    const failed = await withTenant(runtime, tenantA, async (tx) => ({
      run: await tx.workflowRun.findFirst({ where: { id: unsupportedRunId, tenantId: tenantA } }),
      step: await tx.workflowStepRun.findFirst({
        where: { tenantId: tenantA, workflowRunId: unsupportedRunId, stepId: 'check-reply' },
      }),
    }));
    expect(failed.run).toMatchObject({ status: 'FAILED', currentStepId: 'check-reply' });
    expect(failed.run?.error).toBe('step_type_not_implemented:condition');
    expect(failed.step).toMatchObject({ status: 'FAILED', error: 'step_type_not_implemented' });
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
