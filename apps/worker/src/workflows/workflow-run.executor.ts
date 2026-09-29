import { Injectable } from '@nestjs/common';
import {
  parseWorkflowConditionStepConfig,
  parseWorkflowDefinition,
  type WorkflowStepDefinition,
} from '@vautrin/contracts';
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
import { evaluateWorkflowCondition, WorkflowConditionError } from './condition-evaluator.js';
import { parseWaitStepDuration } from './wait-duration.js';
import {
  WorkflowContextBuildError,
  WorkflowContextBuilder,
  type WorkflowContextMetadata,
} from './workflow-context.builder.js';

interface LockedWorkflowRun {
  readonly id: string;
  readonly is_due: boolean;
}

export interface WorkflowExecutionResult {
  readonly result: 'advanced' | 'ignored' | 'waiting' | 'completed' | 'failed';
  readonly runId: string;
}

/** Executes the explicitly implemented v0.3 CONDITION, WAIT, and END steps. */
@Injectable()
export class WorkflowRunExecutor {
  constructor(
    private readonly database: DatabaseService,
    private readonly workflowContextBuilder: WorkflowContextBuilder,
  ) {}

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
        select: { id: true, key: true, version: true, trigger: true, definition: true },
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

      return this.executeFrom(
        tx,
        run,
        context.tenantId,
        {
          id: workflow.id,
          key: workflow.key,
          version: workflow.version,
          trigger: workflow.trigger,
        },
        definition.steps,
        nextIndex,
      );
    });
  }

  private async executeFrom(
    tx: TenantScopedClient,
    run: WorkflowRun,
    tenantId: string,
    workflow: WorkflowContextMetadata,
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
    if (step.type === 'condition') {
      return this.executeCondition(tx, run, tenantId, workflow, steps, startIndex, step);
    }

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

  private async executeCondition(
    tx: TenantScopedClient,
    run: WorkflowRun,
    tenantId: string,
    workflow: WorkflowContextMetadata,
    steps: readonly WorkflowStepDefinition[],
    stepIndex: number,
    step: WorkflowStepDefinition,
  ): Promise<WorkflowExecutionResult> {
    const idempotencyKey = `run-${run.id}-step-${step.id}`;
    const startedAt = new Date();
    let config: ReturnType<typeof parseWorkflowConditionStepConfig>;
    try {
      config = parseWorkflowConditionStepConfig(step.config, steps, stepIndex);
    } catch {
      await this.persistConditionFailure(
        tx,
        run,
        tenantId,
        step,
        stepIndex,
        idempotencyKey,
        startedAt,
        'invalid_condition_configuration',
      );
      return this.failRun(tx, run.id, tenantId, 'invalid_condition_configuration', step.id);
    }

    let result: boolean;
    try {
      const context = await this.workflowContextBuilder.build(
        tx,
        tenantId,
        run,
        workflow,
        stepIndex,
      );
      result = evaluateWorkflowCondition(config.condition, context);
    } catch (error) {
      const reason =
        error instanceof WorkflowConditionError
          ? `condition_${error.code}`
          : error instanceof WorkflowContextBuildError
            ? `condition_${error.code}`
            : 'condition_evaluation_failed';
      await this.persistConditionFailure(
        tx,
        run,
        tenantId,
        step,
        stepIndex,
        idempotencyKey,
        startedAt,
        reason,
      );
      return this.failRun(tx, run.id, tenantId, reason, step.id);
    }

    const selectedBranch = result ? 'onTrue' : 'onFalse';
    const nextStepId = result ? config.onTrue : config.onFalse;
    const completedAt = new Date();
    const stepRun = await tx.workflowStepRun.create({
      data: {
        tenantId,
        workflowRunId: run.id,
        stepId: step.id,
        stepIndex,
        stepType: WorkflowStepType.CONDITION,
        status: StepRunStatus.COMPLETED,
        input: config as unknown as Prisma.InputJsonValue,
        output: {
          condition: config.condition,
          result,
          selectedBranch,
          nextStepId: nextStepId ?? null,
        } as Prisma.InputJsonValue,
        idempotencyKey,
        startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
      },
    });
    await this.auditCondition(tx, tenantId, run, stepRun.id, {
      condition: config.condition,
      result,
      selectedBranch,
      nextStepId: nextStepId ?? null,
    });

    const nextIndex = nextStepId ? steps.findIndex((candidate) => candidate.id === nextStepId) : -1;
    const skipUntil = nextStepId ? nextIndex : steps.length;
    if (skipUntil < 0) {
      return this.failRun(tx, run.id, tenantId, 'invalid_condition_branch', step.id);
    }
    if (skipUntil > stepIndex + 1) {
      await tx.workflowStepRun.createMany({
        data: steps.slice(stepIndex + 1, skipUntil).map((skipped, offset) => ({
          tenantId,
          workflowRunId: run.id,
          stepId: skipped.id,
          stepIndex: stepIndex + 1 + offset,
          stepType: toDatabaseStepType(skipped.type),
          status: StepRunStatus.SKIPPED,
          idempotencyKey: `run-${run.id}-step-${skipped.id}`,
          error: 'condition_branch_not_selected',
          completedAt,
        })),
      });
    }

    if (!nextStepId) {
      await tx.workflowRun.update({
        where: { id: run.id, tenantId },
        data: {
          status: WorkflowRunStatus.COMPLETED,
          currentStepId: step.id,
          scheduledFor: null,
          completedAt,
          error: null,
        },
      });
      await this.audit(tx, tenantId, run.id, 'workflow.run.completed');
      return { result: 'completed', runId: run.id };
    }
    return this.executeFrom(tx, run, tenantId, workflow, steps, nextIndex);
  }

  private async persistConditionFailure(
    tx: TenantScopedClient,
    run: WorkflowRun,
    tenantId: string,
    step: WorkflowStepDefinition,
    stepIndex: number,
    idempotencyKey: string,
    startedAt: Date,
    reason: string,
  ): Promise<void> {
    const completedAt = new Date();
    await tx.workflowStepRun.create({
      data: {
        tenantId,
        workflowRunId: run.id,
        stepId: step.id,
        stepIndex,
        stepType: WorkflowStepType.CONDITION,
        status: StepRunStatus.FAILED,
        input: step.config as Prisma.InputJsonValue,
        idempotencyKey,
        error: reason,
        startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
      },
    });
  }

  private auditCondition(
    tx: TenantScopedClient,
    tenantId: string,
    run: WorkflowRun,
    stepRunId: string,
    result: {
      readonly condition: unknown;
      readonly result: boolean;
      readonly selectedBranch: 'onTrue' | 'onFalse';
      readonly nextStepId: string | null;
    },
  ): Promise<unknown> {
    return tx.auditLog.create({
      data: {
        tenantId,
        actorType: 'SYSTEM',
        action: 'workflow.condition.evaluated',
        resourceType: 'workflow_step_run',
        resourceId: stepRunId,
        correlationId: run.correlationId,
        metadata: result as Prisma.InputJsonValue,
      },
    });
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
