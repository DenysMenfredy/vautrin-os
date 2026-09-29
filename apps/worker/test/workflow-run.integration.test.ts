import 'reflect-metadata';

import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { messageReceivedEvent } from '@vautrin/contracts';
import {
  createPlatformClient,
  createPrismaClient,
  type PrismaClient,
  withTenant,
} from '@vautrin/database';
import {
  QUEUE,
  SEND_MESSAGE_JOB,
  sendMessageJobId,
  WORKFLOW_RUN_JOB,
  type WorkflowRunJob,
  workflowRunJobId,
} from '@vautrin/queues';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AgentContextBuilder } from '../src/agents/agent-context.builder.js';
import { AgentRunTelemetry } from '../src/agents/agent-run.telemetry.js';
import { DatabaseAgentToolAuditSink } from '../src/agents/agent-tool-audit.sink.js';
import { AppModule } from '../src/app.module.js';
import { DomainEventProcessor } from '../src/outbox/domain-event.processor.js';
import { WorkflowRunExecutor } from '../src/workflows/workflow-run.executor.js';
import { WorkflowRunScheduler } from '../src/workflows/workflow-run.scheduler.js';

const suffix = Date.now();
let app: INestApplicationContext;
let platform: PrismaClient;
let runtime: PrismaClient;
let tenantA = '';
let tenantB = '';
let runId = '';
let executor: WorkflowRunExecutor;
let agentContext: AgentContextBuilder;

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
  agentContext = app.get(AgentContextBuilder);

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

  it('queues one tenant-scoped SMS from a send_message step and suppresses opted-out contacts', async () => {
    const sender = '+15557654321';
    await withTenant(runtime, tenantA, (tx) =>
      tx.integration.create({
        data: {
          tenantId: tenantA,
          provider: 'twilio',
          category: 'MESSAGING',
          status: 'HEALTHY',
          configuration: { phoneNumber: sender },
        },
      }),
    );

    const createMessageRun = (key: string, optedOut = false) =>
      withTenant(runtime, tenantA, async (tx) => {
        const contact = await tx.contact.create({
          data: { tenantId: tenantA, phone: `+1555${String(Date.now()).slice(-7)}` },
        });
        const recipient = contact.phone;
        if (!recipient) throw new Error('Integration fixture requires a contact phone.');
        const conversation = await tx.conversation.create({
          data: { tenantId: tenantA, contactId: contact.id, channel: 'SMS' },
        });
        if (optedOut) {
          await tx.contactChannelPreference.create({
            data: {
              tenantId: tenantA,
              contactId: contact.id,
              channel: 'SMS',
              optedOutAt: new Date(),
              source: 'integration_test',
            },
          });
        }
        const inbound = await tx.message.create({
          data: {
            tenantId: tenantA,
            conversationId: conversation.id,
            direction: 'INBOUND',
            channel: 'SMS',
            status: 'DELIVERED',
            body: 'I need help with a remodel.',
            fromAddress: recipient,
            toAddress: sender,
            provider: 'twilio',
            providerMessageId: `workflow-message-in-${key}`,
            providerEventId: `workflow-message-event-${key}`,
          },
        });
        const eventData = messageReceivedEvent(inbound.id, conversation.id, contact.id);
        const event = await tx.event.create({
          data: {
            tenantId: tenantA,
            name: eventData.name,
            version: eventData.version,
            aggregateType: 'message',
            aggregateId: inbound.id,
            payload: eventData.payload,
            idempotencyKey: `workflow-message-trigger-${key}`,
          },
        });
        const workflow = await tx.workflow.create({
          data: {
            tenantId: tenantA,
            key: `workflow-message-${key}`,
            version: 1,
            name: 'Send workflow message',
            trigger: event.name,
            status: 'ACTIVE',
            publishedAt: new Date(),
            definition: {
              steps: [
                {
                  id: 'reply',
                  type: 'send_message',
                  config: { body: 'Thanks—we received your request.' },
                },
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
            triggerEvent: event.name,
            triggerEventId: event.id,
            idempotencyKey: `workflow-message-run-${key}`,
          },
        });
        return { runId: run.id, conversationId: conversation.id };
      });

    const queuedCase = await createMessageRun(`sent-${suffix}`);
    expect(
      (await executor.handle({ tenantId: tenantA, runId: queuedCase.runId, action: 'start' }))
        .result,
    ).toBe('completed');
    const queued = await withTenant(runtime, tenantA, async (tx) => {
      const run = await tx.workflowRun.findFirst({
        where: { id: queuedCase.runId, tenantId: tenantA },
      });
      const step = await tx.workflowStepRun.findFirst({
        where: { tenantId: tenantA, workflowRunId: queuedCase.runId, stepId: 'reply' },
      });
      const output = step?.output;
      const messageId =
        typeof output === 'object' &&
        output !== null &&
        !Array.isArray(output) &&
        typeof output.messageId === 'string'
          ? output.messageId
          : undefined;
      const message = messageId
        ? await tx.message.findFirst({ where: { id: messageId, tenantId: tenantA } })
        : null;
      return {
        run,
        step,
        message,
        sendEvents: messageId
          ? await tx.event.count({
              where: { tenantId: tenantA, name: 'message.send_requested', aggregateId: messageId },
            })
          : 0,
      };
    });
    expect(queued.run?.status).toBe('COMPLETED');
    expect(queued.step).toMatchObject({ status: 'COMPLETED', output: { status: 'QUEUED' } });
    expect(queued.message).toMatchObject({
      conversationId: queuedCase.conversationId,
      direction: 'OUTBOUND',
      status: 'QUEUED',
      body: 'Thanks—we received your request.',
      fromAddress: sender,
      provider: 'twilio',
    });
    expect(queued.sendEvents).toBe(1);
    const queuedMessage = queued.message;
    if (!queuedMessage) throw new Error('Workflow message was not saved.');
    const outboundEvent = await withTenant(runtime, tenantA, (tx) =>
      tx.event.findFirst({
        where: {
          tenantId: tenantA,
          name: 'message.send_requested',
          aggregateId: queuedMessage.id,
        },
        select: { id: true },
      }),
    );
    if (!outboundEvent) throw new Error('Outbound event fixture was not saved.');
    const notifications = app.get<Queue>(getQueueToken(QUEUE.NOTIFICATIONS));
    const enqueueSpy = vi.spyOn(notifications, 'add').mockResolvedValue({} as never);
    try {
      await app.get(DomainEventProcessor).handle({ tenantId: tenantA, eventId: outboundEvent.id });
      expect(enqueueSpy).toHaveBeenCalledWith(
        SEND_MESSAGE_JOB,
        expect.objectContaining({ tenantId: tenantA, messageId: queuedMessage.id }),
        { jobId: sendMessageJobId(queuedMessage.id) },
      );
    } finally {
      enqueueSpy.mockRestore();
    }
    expect(
      await withTenant(runtime, tenantA, (tx) =>
        tx.auditLog.count({
          where: {
            tenantId: tenantA,
            action: 'message.outbound.queued',
            ...(queued.message ? { resourceId: queued.message.id } : {}),
          },
        }),
      ),
    ).toBe(1);
    expect(
      (await executor.handle({ tenantId: tenantA, runId: queuedCase.runId, action: 'start' }))
        .result,
    ).toBe('ignored');
    expect(
      await withTenant(runtime, tenantA, (tx) =>
        tx.message.count({
          where: {
            tenantId: tenantA,
            conversationId: queuedCase.conversationId,
            direction: 'OUTBOUND',
          },
        }),
      ),
    ).toBe(1);

    const suppressedCase = await createMessageRun(`suppressed-${suffix}`, true);
    expect(
      (
        await executor.handle({
          tenantId: tenantA,
          runId: suppressedCase.runId,
          action: 'start',
        })
      ).result,
    ).toBe('failed');
    const suppressed = await withTenant(runtime, tenantA, async (tx) => ({
      run: await tx.workflowRun.findFirst({
        where: { id: suppressedCase.runId, tenantId: tenantA },
      }),
      step: await tx.workflowStepRun.findFirst({
        where: { tenantId: tenantA, workflowRunId: suppressedCase.runId, stepId: 'reply' },
      }),
      messages: await tx.message.count({
        where: {
          tenantId: tenantA,
          conversationId: suppressedCase.conversationId,
          direction: 'OUTBOUND',
        },
      }),
    }));
    expect(suppressed.run).toMatchObject({ status: 'FAILED', error: 'contact_opted_out' });
    expect(suppressed.step).toMatchObject({ status: 'FAILED', error: 'contact_opted_out' });
    expect(suppressed.messages).toBe(0);
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

  it('persists a bounded retry schedule, then applies the configured terminal outcome', async () => {
    const retryRunId = await withTenant(runtime, tenantA, async (tx) => {
      const workflow = await tx.workflow.create({
        data: {
          tenantId: tenantA,
          key: `workflow-run-retry-${suffix}`,
          version: 1,
          name: 'Retry a retryable step failure',
          trigger: 'test.trigger',
          status: 'ACTIVE',
          publishedAt: new Date(),
          retryPolicy: {
            maxAttempts: 2,
            initialDelayMs: 5_000,
            maxDelayMs: 5_000,
            retryableErrors: ['step_type_not_implemented:create_lead'],
            terminalErrors: [],
          },
          failurePolicy: { action: 'retry' },
          definition: {
            steps: [
              { id: 'create', type: 'create_lead', config: {} },
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
          idempotencyKey: `workflow-run-retry-${suffix}`,
        },
      });
      return run.id;
    });

    expect(
      (await executor.handle({ tenantId: tenantA, runId: retryRunId, action: 'start' })).result,
    ).toBe('waiting');
    const scheduled = await withTenant(runtime, tenantA, async (tx) => ({
      run: await tx.workflowRun.findFirst({ where: { id: retryRunId, tenantId: tenantA } }),
      step: await tx.workflowStepRun.findFirst({
        where: { tenantId: tenantA, workflowRunId: retryRunId, stepId: 'create' },
      }),
    }));
    expect(scheduled.run).toMatchObject({ status: 'WAITING', currentStepId: 'create', attempt: 2 });
    expect(scheduled.step).toMatchObject({
      status: 'SCHEDULED',
      attempt: 1,
      maxAttempts: 2,
      error: 'step_type_not_implemented:create_lead',
    });

    const workflowQueue = app.get<Queue<WorkflowRunJob>>(getQueueToken(QUEUE.WORKFLOW));
    const enqueueSpy = vi.spyOn(workflowQueue, 'add').mockResolvedValue({} as never);
    try {
      await app.get(WorkflowRunScheduler).dispatchOnce();
      expect(enqueueSpy).toHaveBeenCalledWith(
        WORKFLOW_RUN_JOB,
        expect.objectContaining({
          tenantId: tenantA,
          runId: retryRunId,
          action: 'retry',
          stepId: 'create',
          attempt: 2,
        }),
        expect.objectContaining({
          jobId: workflowRunJobId({
            tenantId: tenantA,
            runId: retryRunId,
            action: 'retry',
            stepId: 'create',
            attempt: 2,
          }),
          delay: expect.any(Number),
        }),
      );
    } finally {
      enqueueSpy.mockRestore();
    }

    await withTenant(runtime, tenantA, async (tx) => {
      const past = new Date(Date.now() - 1_000);
      await tx.workflowRun.update({
        where: { id: retryRunId, tenantId: tenantA },
        data: { scheduledFor: past },
      });
      await tx.workflowStepRun.updateMany({
        where: { tenantId: tenantA, workflowRunId: retryRunId, stepId: 'create' },
        data: { scheduledFor: past },
      });
    });

    const retried = await executor.handle({
      tenantId: tenantA,
      runId: retryRunId,
      action: 'retry',
      stepId: 'create',
      attempt: 2,
    });
    expect(retried.result).toBe('failed');
    const exhausted = await withTenant(runtime, tenantA, async (tx) => ({
      run: await tx.workflowRun.findFirst({ where: { id: retryRunId, tenantId: tenantA } }),
      step: await tx.workflowStepRun.findFirst({
        where: { tenantId: tenantA, workflowRunId: retryRunId, stepId: 'create' },
      }),
      retries: await tx.auditLog.count({
        where: {
          tenantId: tenantA,
          action: 'workflow.step.retry_scheduled',
          resourceId: retryRunId,
        },
      }),
    }));
    expect(exhausted.run).toMatchObject({ status: 'FAILED', attempt: 2 });
    expect(exhausted.step).toMatchObject({ status: 'FAILED', attempt: 2, maxAttempts: 2 });
    expect(exhausted.retries).toBe(1);
  });

  it('skips a failed step or persists an escalation/handoff request as configured', async () => {
    const createPolicyRun = (key: string, action: 'skip' | 'escalate' | 'human_handoff') =>
      withTenant(runtime, tenantA, async (tx) => {
        const workflow = await tx.workflow.create({
          data: {
            tenantId: tenantA,
            key: `workflow-run-${key}-${suffix}`,
            version: 1,
            name: `Failure policy ${action}`,
            trigger: 'test.trigger',
            status: 'ACTIVE',
            publishedAt: new Date(),
            failurePolicy: { action },
            definition: {
              steps: [
                { id: 'unsupported', type: 'create_lead', config: {} },
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
            idempotencyKey: `workflow-run-${key}-${suffix}`,
          },
        });
        return run.id;
      });

    const skipRunId = await createPolicyRun('skip', 'skip');
    expect(
      (await executor.handle({ tenantId: tenantA, runId: skipRunId, action: 'start' })).result,
    ).toBe('completed');
    const skipped = await withTenant(runtime, tenantA, async (tx) => ({
      run: await tx.workflowRun.findFirst({ where: { id: skipRunId, tenantId: tenantA } }),
      step: await tx.workflowStepRun.findFirst({
        where: { tenantId: tenantA, workflowRunId: skipRunId, stepId: 'unsupported' },
      }),
      audit: await tx.auditLog.findFirst({
        where: {
          tenantId: tenantA,
          action: 'workflow.step.failure_skipped',
          resourceId: skipRunId,
        },
      }),
    }));
    expect(skipped.run?.status).toBe('COMPLETED');
    expect(skipped.step).toMatchObject({
      status: 'FAILED',
      error: 'step_type_not_implemented:create_lead',
    });
    expect(skipped.audit).not.toBeNull();

    for (const action of ['escalate', 'human_handoff'] as const) {
      const runId = await createPolicyRun(action, action);
      expect((await executor.handle({ tenantId: tenantA, runId, action: 'start' })).result).toBe(
        'failed',
      );
      const audit = await withTenant(runtime, tenantA, (tx) =>
        tx.auditLog.findFirst({
          where: {
            tenantId: tenantA,
            action:
              action === 'escalate'
                ? 'workflow.run.escalation_requested'
                : 'workflow.run.handoff_requested',
            resourceId: runId,
          },
        }),
      );
      expect(audit).not.toBeNull();
    }
  });

  it('builds bounded tenant business context without exposing contact identifiers', async () => {
    const fixture = await withTenant(runtime, tenantA, async (tx) => {
      await tx.businessProfile.create({
        data: {
          tenantId: tenantA,
          displayName: 'Context Test Remodelers',
          businessHours: { weekdays: ['MONDAY'] },
          qualificationRules: { required: ['project_type'] },
        },
      });
      const service = await tx.service.create({
        data: { tenantId: tenantA, key: `context-${suffix}`, name: 'Kitchen remodel' },
      });
      await tx.serviceArea.create({
        data: { tenantId: tenantA, type: 'POSTAL_CODE', value: '19001' },
      });
      await tx.location.create({
        data: { tenantId: tenantA, name: 'Main office', city: 'Philadelphia', region: 'PA' },
      });
      const contact = await tx.contact.create({
        data: {
          tenantId: tenantA,
          firstName: 'Private',
          email: 'private@example.test',
          phone: '+15555550123',
          notes: 'Do not add these notes to model context.',
          company: 'Example household',
          tags: ['returning'],
        },
      });
      const lead = await tx.lead.create({
        data: {
          tenantId: tenantA,
          contactId: contact.id,
          service: service.key,
          title: 'Kitchen project',
        },
      });
      const conversation = await tx.conversation.create({
        data: { tenantId: tenantA, contactId: contact.id, leadId: lead.id, channel: 'SMS' },
      });
      await tx.message.create({
        data: {
          tenantId: tenantA,
          conversationId: conversation.id,
          direction: 'INBOUND',
          channel: 'SMS',
          status: 'DELIVERED',
          body: 'I am interested in a kitchen remodel.',
        },
      });
      return { serviceId: service.id, conversationId: conversation.id, leadId: lead.id };
    });

    const context = await withTenant(runtime, tenantA, (tx) =>
      agentContext.build(tx, tenantA, { conversationId: fixture.conversationId }),
    );
    expect(context).toMatchObject({
      tenantId: tenantA,
      business: { displayName: 'Context Test Remodelers' },
      services: [{ id: fixture.serviceId, name: 'Kitchen remodel' }],
      serviceAreas: [{ value: '19001' }],
      locations: [{ city: 'Philadelphia' }],
      lead: { id: fixture.leadId, service: `context-${suffix}` },
      contact: { tags: ['returning'] },
      conversation: {
        messages: [{ direction: 'INBOUND', body: 'I am interested in a kitchen remodel.' }],
      },
    });
    expect(context.contact).not.toHaveProperty('email');
    expect(context.contact).not.toHaveProperty('phone');
    expect(context.contact).not.toHaveProperty('firstName');
    expect(context.business).not.toHaveProperty('aiConfiguration');

    const foreignConversationId = await withTenant(runtime, tenantB, async (tx) => {
      await tx.businessProfile.create({ data: { tenantId: tenantB, displayName: 'Other Tenant' } });
      const contact = await tx.contact.create({ data: { tenantId: tenantB } });
      const conversation = await tx.conversation.create({
        data: { tenantId: tenantB, contactId: contact.id, channel: 'SMS' },
      });
      return conversation.id;
    });
    await expect(
      withTenant(runtime, tenantA, (tx) =>
        agentContext.build(tx, tenantA, { conversationId: foreignConversationId }),
      ),
    ).rejects.toMatchObject({ code: 'conversation_not_found' });
  });

  it('records provider-neutral agent usage and idempotent tool audit metadata', async () => {
    const agent = await withTenant(runtime, tenantA, async (tx) => {
      const draft = await tx.agent.create({
        data: {
          tenantId: tenantA,
          key: `agent-telemetry-${suffix}`,
          version: 1,
          name: 'Telemetry fixture',
          instructions: 'Test-only agent instructions.',
          promptVersion: 'test-v1',
          modelConfiguration: {},
        },
      });
      return tx.agent.update({
        where: { id: draft.id, tenantId: tenantA },
        data: { status: 'ACTIVE' },
      });
    });
    const telemetry = app.get(AgentRunTelemetry);
    const started = await telemetry.start({
      tenantId: tenantA,
      agentId: agent.id,
      agentVersion: agent.version,
      promptVersion: agent.promptVersion,
      provider: 'test-provider',
      model: 'test-model',
    });
    const toolAudit = app.get(DatabaseAgentToolAuditSink);
    const toolEvent = {
      tenantId: tenantA,
      agentRunId: started.id,
      idempotencyKey: `tool-call-${started.id}`,
      toolName: 'lead.lookup',
      permission: 'lead.read',
      sideEffect: 'none',
      status: 'SUCCEEDED',
      authorized: true,
      approvalRequired: false,
      latencyMs: 12,
    } as const;
    expect(await toolAudit.claim({ ...toolEvent, status: 'RUNNING' })).toBe(true);
    expect(await toolAudit.claim({ ...toolEvent, status: 'RUNNING' })).toBe(false);
    await toolAudit.record(toolEvent);
    await toolAudit.record(toolEvent);
    await telemetry.complete(
      tenantA,
      started.id,
      {
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 10,
        estimatedCost: { amount: '0.001200', currency: 'USD' },
      },
      1,
      { outcome: 'request_more_details' },
    );

    const stored = await withTenant(runtime, tenantA, async (tx) => ({
      run: await tx.agentRun.findFirst({ where: { id: started.id, tenantId: tenantA } }),
      tools: await tx.toolExecution.count({
        where: { tenantId: tenantA, agentRunId: started.id },
      }),
    }));
    expect(stored.run).toMatchObject({
      status: 'COMPLETED',
      provider: 'test-provider',
      model: 'test-model',
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 10,
      costCurrency: 'USD',
      toolCount: 1,
      result: { outcome: 'request_more_details' },
    });
    expect(stored.tools).toBe(1);
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
