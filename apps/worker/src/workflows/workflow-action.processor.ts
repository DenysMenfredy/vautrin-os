import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  agentStepSchema,
  parseWorkflowDefinition,
  parseWorkflowRetryPolicy,
  workflowRetryDelayMs,
} from '@vautrin/contracts';
import { Prisma } from '@vautrin/database';
import { LLMProviderError } from '@vautrin/integrations';
import {
  assertWorkflowRunJob,
  QUEUE,
  WORKFLOW_RUN_JOB,
  type WorkflowRunJob,
} from '@vautrin/queues';
import type { Job } from 'bullmq';
import { DatabaseAgentToolAuditSink } from '../agents/agent-tool-audit.sink.js';
import { ReceptionistRuntime } from '../agents/receptionist-runtime.js';
import { ReceptionistTools } from '../agents/receptionist-tools.js';
import { DatabaseService } from '../database/database.service.js';
import { WorkflowContextBuilder } from './workflow-context.builder.js';

@Injectable()
@Processor(QUEUE.AI)
export class WorkflowActionProcessor extends WorkerHost {
  private readonly logger = new Logger(WorkflowActionProcessor.name);
  constructor(
    private readonly database: DatabaseService,
    private readonly contexts: WorkflowContextBuilder,
    private readonly receptionist: ReceptionistRuntime,
    private readonly tools: ReceptionistTools,
    private readonly audit: DatabaseAgentToolAuditSink,
  ) {
    super();
  }
  process(job: Job<WorkflowRunJob>): Promise<unknown> {
    if (job.name !== WORKFLOW_RUN_JOB) throw new Error('Unknown AI job.');
    return this.handle(job.data);
  }
  async handle(value: unknown): Promise<unknown> {
    assertWorkflowRunJob(value);
    if (value.action !== 'execute') throw new Error('Expected an asynchronous workflow action.');
    const job = value;
    const snapshot = await this.database.withJobTenant(job, async (tx) => {
      await tx.$queryRaw`SELECT id FROM public.workflow_runs WHERE id = ${job.runId}::uuid AND tenant_id = ${job.tenantId}::uuid FOR UPDATE`;
      const run = await tx.workflowRun.findFirst({
        where: {
          id: job.runId,
          tenantId: job.tenantId,
          status: 'WAITING',
          currentStepId: job.stepId,
          scheduledFor: { lte: new Date() },
        },
      });
      if (!run) return null;
      const workflow = await tx.workflow.findFirst({
        where: { id: run.workflowId, tenantId: job.tenantId, version: run.workflowVersion },
      });
      if (!workflow) throw new LLMProviderError('workflow_version_missing', false);
      const definition = parseWorkflowDefinition(workflow.definition);
      const index = definition.steps.findIndex((step) => step.id === job.stepId);
      const step = definition.steps[index];
      if (!step) throw new LLMProviderError('workflow_step_missing', false);
      const context = await this.contexts.build(tx, job.tenantId, run, workflow, index);
      const stepRun = await tx.workflowStepRun.findFirstOrThrow({
        where: {
          tenantId: job.tenantId,
          workflowRunId: run.id,
          stepId: job.stepId,
          status: 'SCHEDULED',
        },
      });
      const startedAt = stepRun.startedAt ?? new Date();
      await tx.workflowStepRun.update({
        where: { id: stepRun.id, tenantId: job.tenantId },
        data: { startedAt },
      });
      return {
        run,
        step,
        context,
        stepRun,
        startedAt,
        retryPolicy: parseWorkflowRetryPolicy(workflow.retryPolicy),
      };
    });
    if (!snapshot) return { result: 'ignored' };
    const conversationId = snapshot.context.conversation?.id;
    const leadId = snapshot.context.conversation?.leadId ?? snapshot.context.lead?.id;
    if (typeof conversationId !== 'string' || typeof leadId !== 'string') {
      await this.fail(job, 'workflow_agent_context_missing');
      return { result: 'failed' };
    }
    let output: unknown;
    try {
      if (snapshot.step.type === 'call_agent') {
        const config = agentStepSchema.parse(snapshot.step.config);
        output = await this.receptionist.execute({
          tenantId: job.tenantId,
          workflowRunId: job.runId,
          stepId: job.stepId,
          conversationId,
          leadId,
          ...config,
          ...(job.correlationId ? { correlationId: job.correlationId } : {}),
        });
      } else if (snapshot.step.type === 'create_appointment') {
        const agent = await this.database.withJobTenant(job, (tx) =>
          tx.agentRun.findFirst({
            where: {
              tenantId: job.tenantId,
              workflowRunId: job.runId,
              conversationId,
              leadId,
              status: 'COMPLETED',
            },
            orderBy: { startedAt: 'desc' },
            include: { agent: true },
          }),
        );
        if (!agent?.agent.allowedTools.includes('create_appointment'))
          throw new LLMProviderError('agent_booking_not_authorized', false);
        output = await this.tools.registry.invoke(
          'create_appointment',
          snapshot.step.config,
          {
            tenantId: job.tenantId,
            agentId: agent.agentId,
            agentRunId: agent.id,
            conversationId,
            leadId,
            idempotencyKey: `workflow-booking-${job.runId}-${job.stepId}`,
          },
          agent.agent.allowedTools,
          {
            isAuthorized: (_context, permission) => {
              const guards = agent.agent.guardrails;
              return Promise.resolve(
                Boolean(
                  guards &&
                    typeof guards === 'object' &&
                    !Array.isArray(guards) &&
                    Array.isArray(guards.capabilities) &&
                    guards.capabilities.includes(permission),
                ),
              );
            },
            isApproved: () => Promise.resolve(false),
          },
          this.audit,
        );
        if (
          !output ||
          typeof output !== 'object' ||
          !('status' in output) ||
          output.status !== 'SUCCEEDED'
        )
          throw new LLMProviderError('booking_tool_failed', false);
      } else throw new LLMProviderError('workflow_action_unavailable', false);
    } catch (error) {
      if (
        error instanceof LLMProviderError &&
        ['agent_execution_busy', 'agent_execution_lease_lost'].includes(error.code)
      )
        throw error;
      if (
        error instanceof LLMProviderError &&
        error.retryable &&
        !snapshot.retryPolicy.terminalErrors.includes(error.code) &&
        (snapshot.retryPolicy.retryableErrors.includes('*') ||
          snapshot.retryPolicy.retryableErrors.includes(error.code))
      ) {
        if (error.code === 'agent_execution_busy' || error.code === 'agent_execution_lease_lost')
          throw error;
        if (snapshot.stepRun.attempt >= snapshot.retryPolicy.maxAttempts) {
          await this.fail(job, 'provider_retries_exhausted');
          return { result: 'failed' };
        }
        await this.database.withJobTenant(job, async (tx) => {
          const scheduledFor = new Date(
            Date.now() + workflowRetryDelayMs(snapshot.stepRun.attempt, snapshot.retryPolicy),
          );
          const changed = await tx.workflowRun.updateMany({
            where: {
              id: job.runId,
              tenantId: job.tenantId,
              status: 'WAITING',
              currentStepId: job.stepId,
            },
            data: { scheduledFor },
          });
          if (!changed.count) return;
          await tx.workflowStepRun.updateMany({
            where: {
              tenantId: job.tenantId,
              id: snapshot.stepRun.id,
              status: 'SCHEDULED',
              attempt: snapshot.stepRun.attempt,
            },
            data: { attempt: { increment: 1 }, scheduledFor, error: error.code },
          });
          await tx.auditLog.create({
            data: {
              tenantId: job.tenantId,
              actorType: 'SYSTEM',
              action: 'workflow.action.retry_scheduled',
              resourceType: 'workflow_run',
              resourceId: job.runId,
              correlationId: job.correlationId ?? null,
              metadata: {
                stepId: job.stepId,
                attempt: snapshot.stepRun.attempt + 1,
                reason: error.code,
                scheduledFor: scheduledFor.toISOString(),
              },
            },
          });
        });
        return { result: 'retry_scheduled' };
      }
      await this.fail(
        job,
        error instanceof LLMProviderError ? error.code : 'workflow_action_failed',
      );
      return { result: 'failed' };
    }
    await this.database.withJobTenant(job, async (tx) => {
      const changed = await tx.workflowRun.updateMany({
        where: {
          id: job.runId,
          tenantId: job.tenantId,
          status: 'WAITING',
          currentStepId: job.stepId,
        },
        data: { status: 'PENDING', scheduledFor: null },
      });
      if (!changed.count) return;
      await tx.workflowStepRun.updateMany({
        where: {
          tenantId: job.tenantId,
          workflowRunId: job.runId,
          stepId: job.stepId,
          status: 'SCHEDULED',
        },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          error: null,
          durationMs: Math.min(2_147_483_647, Date.now() - snapshot.startedAt.getTime()),
          output: output as Prisma.InputJsonValue,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: job.tenantId,
          actorType: 'SYSTEM',
          action: 'workflow.action.completed',
          resourceType: 'workflow_run',
          resourceId: job.runId,
          correlationId: job.correlationId ?? null,
          metadata: { stepId: job.stepId },
        },
      });
    });
    return { result: 'advanced', output };
  }
  @OnWorkerEvent('failed')
  async onFailed(job: Job<WorkflowRunJob> | undefined): Promise<void> {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1))
      await this.fail(job.data, 'provider_retries_exhausted');
  }
  @OnWorkerEvent('active')
  onActive(job: Job<WorkflowRunJob>): void {
    this.logger.log({
      operation: 'worker.job.started',
      queue: QUEUE.AI,
      tenantId: job.data.tenantId,
      runId: job.data.runId,
      correlationId: job.data.correlationId ?? null,
      attempt: job.attemptsMade + 1,
    });
  }
  @OnWorkerEvent('completed')
  onCompleted(job: Job<WorkflowRunJob>): void {
    this.logger.log({
      operation: 'worker.job.completed',
      queue: QUEUE.AI,
      tenantId: job.data.tenantId,
      runId: job.data.runId,
      durationMs: job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : null,
    });
  }
  private async fail(job: WorkflowRunJob, reason: string): Promise<void> {
    this.logger.error({
      operation: 'workflow.action.failed',
      tenantId: job.tenantId,
      runId: job.runId,
      correlationId: job.correlationId ?? null,
      reason,
    });
    await this.database.withJobTenant(job, async (tx) => {
      await tx.$queryRaw`SELECT id FROM public.workflow_runs WHERE id = ${job.runId}::uuid AND tenant_id = ${job.tenantId}::uuid FOR UPDATE`;
      const run = await tx.workflowRun.findFirst({
        where: { id: job.runId, tenantId: job.tenantId, status: 'WAITING' },
      });
      if (!run) return;
      await tx.workflowRun.update({
        where: { id: run.id, tenantId: job.tenantId },
        data: { status: 'FAILED', error: reason, failedAt: new Date(), scheduledFor: null },
      });
      await tx.workflowStepRun.updateMany({
        where: { tenantId: job.tenantId, workflowRunId: run.id, stepId: run.currentStepId ?? '' },
        data: { status: 'FAILED', error: reason, completedAt: new Date() },
      });
      await tx.agentRun.updateMany({
        where: { tenantId: job.tenantId, workflowRunId: run.id, status: 'RUNNING' },
        data: {
          status: 'HANDED_OFF',
          handoff: true,
          handoffReason: reason,
          failureReason: reason,
          completedAt: new Date(),
          executionLease: null,
          leaseExpiresAt: null,
        },
      });
      const workflow = await tx.workflow.findFirst({
        where: { id: run.workflowId, tenantId: job.tenantId },
      });
      if (workflow) {
        const context = await this.contexts.build(tx, job.tenantId, run, workflow, 100);
        if (typeof context.conversation?.id === 'string') {
          const conversation = await tx.conversation.findFirst({
            where: { id: context.conversation.id, tenantId: job.tenantId },
          });
          const metadata =
            conversation?.metadata &&
            typeof conversation.metadata === 'object' &&
            !Array.isArray(conversation.metadata)
              ? conversation.metadata
              : {};
          await tx.conversation.updateMany({
            where: { id: context.conversation.id, tenantId: job.tenantId },
            data: {
              status: 'PENDING',
              metadata: { ...metadata, handoff: true, handoffReason: reason },
            },
          });
        }
      }
      await tx.auditLog.create({
        data: {
          tenantId: job.tenantId,
          actorType: 'SYSTEM',
          action: 'workflow.action.failed',
          resourceType: 'workflow_run',
          resourceId: run.id,
          correlationId: job.correlationId ?? null,
          metadata: { reason },
        },
      });
    });
  }
}
