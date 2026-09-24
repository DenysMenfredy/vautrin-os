import { Injectable } from '@nestjs/common';
import { parseWorkflowDefinition, type WorkflowStepDefinition } from '@vautrin/contracts';
import {
  type Prisma,
  StepRunStatus,
  type TenantScopedClient,
  type WorkflowRun,
  WorkflowRunStatus,
  WorkflowStepType,
} from '@vautrin/database';
import { assertWorkflowRunJob, type WorkflowRunJob } from '@vautrin/queues';

import { DatabaseService } from '../database/database.service.js';
import { parseWaitStepDuration } from './wait-duration.js';

interface LockedWorkflowRun {
  readonly id: string;
  readonly is_due: boolean;
}

export interface WorkflowExecutionResult {
  readonly result: 'advanced' | 'ignored' | 'waiting' | 'completed' | 'failed';
  readonly runId: string;
}

/** Executes the explicitly implemented v0.3 WAIT and END step types. */
@Injectable()
export class WorkflowRunExecutor {
  constructor(private readonly database: DatabaseService) {}

  handle(value: unknown): Promise<WorkflowExecutionResult> {
    assertWorkflowRunJob(value);
    const job: WorkflowRunJob = value;

    return this.database.withJobTenant(job, async (tx, context) => {
      const locked = await tx.$queryRaw<LockedWorkflowRun[]>`
        SELECT
          id,
          scheduled_for IS NOT NULL AND scheduled_for <= clock_timestamp() AS is_due
        FROM public.workflow_runs
        WHERE tenant_id = ${context.tenantId}::uuid
          AND id = ${job.runId}::uuid
        FOR UPDATE
      `;
      if (!locked[0]) return { result: 'ignored', runId: job.runId };

      const run = await tx.workflowRun.findFirst({
        where: { id: job.runId, tenantId: context.tenantId },
      });
      if (!run) return { result: 'ignored', runId: job.runId };

      if (job.action === 'start' && run.status !== WorkflowRunStatus.PENDING) {
        return { result: 'ignored', runId: run.id };
      }
      if (job.action === 'wake') {
        if (
          run.status !== WorkflowRunStatus.WAITING ||
          run.currentStepId !== job.stepId ||
          !run.scheduledFor ||
          !locked[0].is_due
        ) {
          return { result: 'ignored', runId: run.id };
        }
      }

      const workflow = await tx.workflow.findFirst({
        where: {
          id: run.workflowId,
          tenantId: context.tenantId,
          version: run.workflowVersion,
        },
        select: { definition: true },
      });
      if (!workflow) return this.failRun(tx, run.id, context.tenantId, 'workflow_version_missing');

      let definition: ReturnType<typeof parseWorkflowDefinition>;
      try {
        definition = parseWorkflowDefinition(workflow.definition);
      } catch {
        return this.failRun(tx, run.id, context.tenantId, 'invalid_workflow_definition');
      }

      if (job.action === 'start') {
        await tx.workflowRun.update({
          where: { id: run.id, tenantId: context.tenantId },
          data: { status: WorkflowRunStatus.RUNNING, startedAt: new Date() },
        });
      }

      let nextIndex = 0;
      if (job.action === 'wake') {
        nextIndex = definition.steps.findIndex((step) => step.id === job.stepId);
        const waitStep = definition.steps[nextIndex];
        if (waitStep?.type !== 'wait') {
          return this.failRun(tx, run.id, context.tenantId, 'invalid_wait_state', job.stepId);
        }
        const waitingStep = await tx.workflowStepRun.findFirst({
          where: {
            tenantId: context.tenantId,
            workflowRunId: run.id,
            stepId: waitStep.id,
            status: StepRunStatus.SCHEDULED,
            scheduledFor: run.scheduledFor,
          },
        });
        if (!waitingStep) {
          return this.failRun(tx, run.id, context.tenantId, 'invalid_wait_state', job.stepId);
        }
        const completedAt = new Date();
        await tx.workflowStepRun.update({
          where: { id: waitingStep.id, tenantId: context.tenantId },
          data: {
            status: StepRunStatus.COMPLETED,
            completedAt,
            durationMs: waitingStep.startedAt
              ? Math.max(0, completedAt.getTime() - waitingStep.startedAt.getTime())
              : null,
          },
        });
        await tx.workflowRun.update({
          where: { id: run.id, tenantId: context.tenantId },
          data: { status: WorkflowRunStatus.RUNNING, scheduledFor: null },
        });
        nextIndex++;
      }

      return this.executeFrom(tx, run, context.tenantId, definition.steps, nextIndex);
    });
  }

  private async executeFrom(
    tx: TenantScopedClient,
    run: WorkflowRun,
    tenantId: string,
    steps: readonly WorkflowStepDefinition[],
    startIndex: number,
  ): Promise<WorkflowExecutionResult> {
    const step = steps[startIndex];
    if (!step) {
      const now = new Date();
      await tx.workflowRun.update({
        where: { id: run.id, tenantId },
        data: {
          status: WorkflowRunStatus.COMPLETED,
          scheduledFor: null,
          completedAt: now,
          error: null,
        },
      });
      await this.audit(tx, tenantId, run.id, 'workflow.run.completed');
      return { result: 'completed', runId: run.id };
    }

    const idempotencyKey = `run-${run.id}-step-${step.id}`;
    if (step.type === 'wait') {
      let durationMs: number;
      try {
        durationMs = parseWaitStepDuration(step.config);
      } catch {
        await tx.workflowStepRun.create({
          data: {
            tenantId,
            workflowRunId: run.id,
            stepId: step.id,
            stepIndex: startIndex,
            stepType: WorkflowStepType.WAIT,
            status: StepRunStatus.FAILED,
            input: step.config as Prisma.InputJsonValue,
            idempotencyKey,
            error: 'invalid_wait_configuration',
            completedAt: new Date(),
          },
        });
        return this.failRun(tx, run.id, tenantId, 'invalid_wait_configuration', step.id);
      }

      const [scheduled] = await tx.$queryRaw<Array<{ scheduled_for: Date }>>`
        SELECT clock_timestamp() + (${durationMs}::double precision * interval '1 millisecond') AS scheduled_for
      `;
      if (!scheduled) throw new Error('Database did not return a workflow schedule time.');
      await tx.workflowStepRun.create({
        data: {
          tenantId,
          workflowRunId: run.id,
          stepId: step.id,
          stepIndex: startIndex,
          stepType: WorkflowStepType.WAIT,
          status: StepRunStatus.SCHEDULED,
          input: step.config as Prisma.InputJsonValue,
          idempotencyKey,
          startedAt: new Date(),
          scheduledFor: scheduled.scheduled_for,
        },
      });
      await tx.workflowRun.update({
        where: { id: run.id, tenantId },
        data: {
          status: WorkflowRunStatus.WAITING,
          currentStepId: step.id,
          scheduledFor: scheduled.scheduled_for,
        },
      });
      await this.audit(tx, tenantId, run.id, 'workflow.step.scheduled');
      return { result: 'waiting', runId: run.id };
    }

    if (step.type === 'end') {
      const now = new Date();
      await tx.workflowStepRun.create({
        data: {
          tenantId,
          workflowRunId: run.id,
          stepId: step.id,
          stepIndex: startIndex,
          stepType: WorkflowStepType.END,
          status: StepRunStatus.COMPLETED,
          idempotencyKey,
          startedAt: now,
          completedAt: now,
          durationMs: 0,
        },
      });
      await tx.workflowRun.update({
        where: { id: run.id, tenantId },
        data: {
          status: WorkflowRunStatus.COMPLETED,
          currentStepId: step.id,
          scheduledFor: null,
          completedAt: now,
          error: null,
        },
      });
      await this.audit(tx, tenantId, run.id, 'workflow.run.completed');
      return { result: 'completed', runId: run.id };
    }

    await tx.workflowStepRun.create({
      data: {
        tenantId,
        workflowRunId: run.id,
        stepId: step.id,
        stepIndex: startIndex,
        stepType: toDatabaseStepType(step.type),
        status: StepRunStatus.FAILED,
        idempotencyKey,
        error: 'step_type_not_implemented',
        completedAt: new Date(),
      },
    });
    return this.failRun(tx, run.id, tenantId, `step_type_not_implemented:${step.type}`, step.id);
  }

  private async failRun(
    tx: TenantScopedClient,
    runId: string,
    tenantId: string,
    reason: string,
    currentStepId?: string,
  ): Promise<WorkflowExecutionResult> {
    const now = new Date();
    await tx.workflowRun.updateMany({
      where: { id: runId, tenantId },
      data: {
        status: WorkflowRunStatus.FAILED,
        failedAt: now,
        scheduledFor: null,
        error: reason,
        ...(currentStepId ? { currentStepId } : {}),
      },
    });
    await this.audit(tx, tenantId, runId, 'workflow.run.failed');
    return { result: 'failed', runId };
  }

  private async audit(
    tx: TenantScopedClient,
    tenantId: string,
    runId: string,
    action: string,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId,
        actorType: 'SYSTEM',
        action,
        resourceType: 'workflow_run',
        resourceId: runId,
      },
    });
  }
}

function toDatabaseStepType(type: WorkflowStepDefinition['type']): WorkflowStepType {
  return type.toUpperCase() as WorkflowStepType;
}
