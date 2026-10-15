import { Injectable } from '@nestjs/common';
import {
  isWorkflowErrorRetryable,
  parseWorkflowConditionStepConfig,
  parseWorkflowDefinition,
  parseWorkflowFailurePolicy,
  parseWorkflowRetryPolicy,
  type WorkflowFailurePolicy,
  type WorkflowRetryPolicy,
  type WorkflowStepDefinition,
  workflowRetryDelayMs,
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
import { WorkflowMessageStepExecutor } from './workflow-message-step.executor.js';

interface LockedWorkflowRun {
  readonly id: string;
  readonly is_due: boolean;
}

interface RuntimeWorkflowPolicy {
  readonly retry: WorkflowRetryPolicy;
  readonly failure: WorkflowFailurePolicy;
}

export interface WorkflowExecutionResult {
  readonly result: 'advanced' | 'ignored' | 'waiting' | 'completed' | 'failed';
  readonly runId: string;
}

/** Executes the explicitly implemented v0.3 CONDITION, WAIT, SEND_MESSAGE, and END steps. */
@Injectable()
export class WorkflowRunExecutor {
  constructor(
    private readonly database: DatabaseService,
    private readonly workflowContextBuilder: WorkflowContextBuilder,
    private readonly workflowMessageStep: WorkflowMessageStepExecutor,
  ) {}

  handle(value: unknown): Promise<WorkflowExecutionResult> {
    assertWorkflowRunJob(value);
    const job: WorkflowRunJob = value;
    if (job.action === 'execute')
      throw new Error('Asynchronous actions must run on the AI processor.');

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
      if (job.action === 'retry') {
        if (
          run.status !== WorkflowRunStatus.WAITING ||
          run.currentStepId !== job.stepId ||
          run.attempt !== job.attempt ||
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
        select: {
          id: true,
          key: true,
          version: true,
          trigger: true,
          definition: true,
          retryPolicy: true,
          failurePolicy: true,
        },
      });
      if (!workflow) return this.failRun(tx, run.id, context.tenantId, 'workflow_version_missing');

      let policies: RuntimeWorkflowPolicy;
      try {
        policies = {
          retry: parseWorkflowRetryPolicy(workflow.retryPolicy),
          failure: parseWorkflowFailurePolicy(workflow.failurePolicy),
        };
      } catch {
        return this.failRun(tx, run.id, context.tenantId, 'invalid_workflow_policy');
      }

      let definition: ReturnType<typeof parseWorkflowDefinition>;
      try {
        definition = parseWorkflowDefinition(workflow.definition);
      } catch {
        return this.failRun(tx, run.id, context.tenantId, 'invalid_workflow_definition');
      }

      if (job.action === 'start') {
        await tx.workflowRun.update({
          where: { id: run.id, tenantId: context.tenantId },
          data: { status: WorkflowRunStatus.RUNNING, startedAt: new Date(), attempt: 1 },
        });
      }

      let nextIndex = 0;
      if (job.action === 'start' && run.currentStepId) {
        const completed = await tx.workflowStepRun.findFirst({
          where: {
            tenantId: context.tenantId,
            workflowRunId: run.id,
            stepId: run.currentStepId,
            status: 'COMPLETED',
          },
        });
        if (completed) nextIndex = completed.stepIndex + 1;
      }
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
          data: { status: WorkflowRunStatus.RUNNING, scheduledFor: null, attempt: 1 },
        });
        nextIndex++;
      }

      if (job.action === 'retry') {
        nextIndex = definition.steps.findIndex((step) => step.id === job.stepId);
        const retryStep = definition.steps[nextIndex];
        const scheduledStep = await tx.workflowStepRun.findFirst({
          where: {
            tenantId: context.tenantId,
            workflowRunId: run.id,
            stepId: job.stepId,
            status: StepRunStatus.SCHEDULED,
            attempt: job.attempt - 1,
          },
        });
        if (!retryStep || !scheduledStep || retryStep.type === 'wait') {
          return this.failRun(tx, run.id, context.tenantId, 'invalid_retry_state', job.stepId);
        }
        await tx.workflowStepRun.delete({
          where: { id: scheduledStep.id, tenantId: context.tenantId },
        });
        await tx.workflowRun.update({
          where: { id: run.id, tenantId: context.tenantId },
          data: { status: WorkflowRunStatus.RUNNING, scheduledFor: null, attempt: job.attempt },
        });
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
        policies,
        job.action === 'retry' ? job.attempt : 1,
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
    policies: RuntimeWorkflowPolicy,
    attempt: number,
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
    if (step.type === 'call_agent' || step.type === 'create_appointment') {
      const scheduledFor = new Date();
      await tx.workflowStepRun.create({
        data: {
          tenantId,
          workflowRunId: run.id,
          stepId: step.id,
          stepIndex: startIndex,
          stepType: toDatabaseStepType(step.type),
          status: 'SCHEDULED',
          input: step.config as Prisma.InputJsonValue,
          idempotencyKey,
          attempt: 1,
          maxAttempts: 3,
          scheduledFor,
        },
      });
      await tx.workflowRun.update({
        where: { id: run.id, tenantId },
        data: { status: 'WAITING', currentStepId: step.id, scheduledFor },
      });
      await this.audit(tx, tenantId, run.id, 'workflow.action.scheduled');
      return { result: 'waiting', runId: run.id };
    }
    if (step.type === 'human_handoff') {
      const context = await this.workflowContextBuilder.build(
        tx,
        tenantId,
        run,
        workflow,
        startIndex,
      );
      const conversationId =
        typeof context.conversation?.id === 'string' ? context.conversation.id : undefined;
      if (!conversationId)
        return this.failRun(tx, run.id, tenantId, 'handoff_conversation_missing', step.id);
      const conversation = await tx.conversation.findFirst({
        where: { id: conversationId, tenantId },
      });
      const metadata =
        conversation?.metadata &&
        typeof conversation.metadata === 'object' &&
        !Array.isArray(conversation.metadata)
          ? conversation.metadata
          : {};
      const reason =
        typeof step.config.reason === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(step.config.reason)
          ? step.config.reason
          : 'workflow_requested';
      await tx.conversation.update({
        where: { id: conversationId, tenantId },
        data: {
          status: 'PENDING',
          metadata: { ...metadata, handoff: true, handoffReason: reason, workflowRunId: run.id },
        },
      });
      await tx.workflowStepRun.create({
        data: {
          tenantId,
          workflowRunId: run.id,
          stepId: step.id,
          stepIndex: startIndex,
          stepType: 'HUMAN_HANDOFF',
          status: 'COMPLETED',
          idempotencyKey,
          output: { conversationId, reason },
          completedAt: new Date(),
        },
      });
      await this.audit(tx, tenantId, run.id, 'conversation.handoff');
      return this.executeFrom(tx, run, tenantId, workflow, steps, startIndex + 1, policies, 1);
    }
    if (step.type === 'condition') {
      return this.executeCondition(
        tx,
        run,
        tenantId,
        workflow,
        steps,
        startIndex,
        step,
        policies,
        attempt,
      );
    }

    if (step.type === 'send_message') {
      return this.executeSendMessage(
        tx,
        run,
        tenantId,
        workflow,
        steps,
        startIndex,
        step,
        policies,
        attempt,
      );
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
            attempt,
            maxAttempts: policies.retry.maxAttempts,
            completedAt: new Date(),
          },
        });
        return this.handleStepFailure(
          tx,
          run,
          tenantId,
          workflow,
          steps,
          startIndex,
          'invalid_wait_configuration',
          policies,
          attempt,
        );
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
          attempt,
          maxAttempts: policies.retry.maxAttempts,
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
          attempt,
          maxAttempts: policies.retry.maxAttempts,
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
        attempt,
        maxAttempts: policies.retry.maxAttempts,
        error: 'step_type_not_implemented',
        completedAt: new Date(),
      },
    });
    return this.handleStepFailure(
      tx,
      run,
      tenantId,
      workflow,
      steps,
      startIndex,
      `step_type_not_implemented:${step.type}`,
      policies,
      attempt,
    );
  }

  private async executeSendMessage(
    tx: TenantScopedClient,
    run: WorkflowRun,
    tenantId: string,
    workflow: WorkflowContextMetadata,
    steps: readonly WorkflowStepDefinition[],
    stepIndex: number,
    step: WorkflowStepDefinition,
    policies: RuntimeWorkflowPolicy,
    attempt: number,
  ): Promise<WorkflowExecutionResult> {
    const startedAt = new Date();
    const idempotencyKey = `run-${run.id}-step-${step.id}`;
    const result = await this.workflowMessageStep.execute(
      tx,
      run,
      tenantId,
      workflow,
      stepIndex,
      step,
    );
    const completedAt = new Date();
    await tx.workflowStepRun.create({
      data: {
        tenantId,
        workflowRunId: run.id,
        stepId: step.id,
        stepIndex,
        stepType: WorkflowStepType.SEND_MESSAGE,
        status: result.ok ? StepRunStatus.COMPLETED : StepRunStatus.FAILED,
        input: result.conversationId ? { conversationId: result.conversationId } : {},
        ...(result.ok
          ? { output: { messageId: result.messageId, status: 'QUEUED' } }
          : { error: result.reason }),
        idempotencyKey,
        attempt,
        maxAttempts: policies.retry.maxAttempts,
        startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
      },
    });
    if (!result.ok) {
      return this.handleStepFailure(
        tx,
        run,
        tenantId,
        workflow,
        steps,
        stepIndex,
        result.reason,
        policies,
        attempt,
      );
    }
    return this.executeFrom(tx, run, tenantId, workflow, steps, stepIndex + 1, policies, 1);
  }

  private async executeCondition(
    tx: TenantScopedClient,
    run: WorkflowRun,
    tenantId: string,
    workflow: WorkflowContextMetadata,
    steps: readonly WorkflowStepDefinition[],
    stepIndex: number,
    step: WorkflowStepDefinition,
    policies: RuntimeWorkflowPolicy,
    attempt: number,
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
        attempt,
        policies.retry.maxAttempts,
      );
      return this.handleStepFailure(
        tx,
        run,
        tenantId,
        workflow,
        steps,
        stepIndex,
        'invalid_condition_configuration',
        policies,
        attempt,
      );
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
        attempt,
        policies.retry.maxAttempts,
      );
      return this.handleStepFailure(
        tx,
        run,
        tenantId,
        workflow,
        steps,
        stepIndex,
        reason,
        policies,
        attempt,
      );
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
        attempt,
        maxAttempts: policies.retry.maxAttempts,
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
      return this.handleStepFailure(
        tx,
        run,
        tenantId,
        workflow,
        steps,
        stepIndex,
        'invalid_condition_branch',
        policies,
        attempt,
      );
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
    return this.executeFrom(tx, run, tenantId, workflow, steps, nextIndex, policies, 1);
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
    attempt: number,
    maxAttempts: number,
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
        attempt,
        maxAttempts,
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

  private async handleStepFailure(
    tx: TenantScopedClient,
    run: WorkflowRun,
    tenantId: string,
    workflow: WorkflowContextMetadata,
    steps: readonly WorkflowStepDefinition[],
    stepIndex: number,
    reason: string,
    policies: RuntimeWorkflowPolicy,
    attempt: number,
  ): Promise<WorkflowExecutionResult> {
    const step = steps[stepIndex];
    if (!step) return this.failRun(tx, run.id, tenantId, 'invalid_failure_step');

    if (
      policies.failure.action === 'retry' &&
      attempt < policies.retry.maxAttempts &&
      isWorkflowErrorRetryable(reason, policies.retry)
    ) {
      const delayMs = workflowRetryDelayMs(attempt, policies.retry);
      const [scheduled] = await tx.$queryRaw<Array<{ scheduled_for: Date }>>`
        SELECT clock_timestamp() + (${delayMs}::double precision * interval '1 millisecond') AS scheduled_for
      `;
      if (!scheduled) throw new Error('Database did not return a workflow retry time.');

      await tx.workflowStepRun.updateMany({
        where: {
          tenantId,
          workflowRunId: run.id,
          stepId: step.id,
          idempotencyKey: `run-${run.id}-step-${step.id}`,
        },
        data: {
          status: StepRunStatus.SCHEDULED,
          attempt,
          maxAttempts: policies.retry.maxAttempts,
          error: reason,
          scheduledFor: scheduled.scheduled_for,
        },
      });
      await tx.workflowRun.update({
        where: { id: run.id, tenantId },
        data: {
          status: WorkflowRunStatus.WAITING,
          currentStepId: step.id,
          attempt: attempt + 1,
          scheduledFor: scheduled.scheduled_for,
          error: null,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: 'SYSTEM',
          action: 'workflow.step.retry_scheduled',
          resourceType: 'workflow_run',
          resourceId: run.id,
          correlationId: run.correlationId,
          metadata: {
            stepId: step.id,
            error: reason,
            attempt,
            nextAttempt: attempt + 1,
            maxAttempts: policies.retry.maxAttempts,
            retryAt: scheduled.scheduled_for.toISOString(),
          },
        },
      });
      return { result: 'waiting', runId: run.id };
    }

    if (policies.failure.action === 'skip') {
      await tx.workflowStepRun.updateMany({
        where: {
          tenantId,
          workflowRunId: run.id,
          stepId: step.id,
          idempotencyKey: `run-${run.id}-step-${step.id}`,
        },
        data: { status: StepRunStatus.FAILED, error: reason, scheduledFor: null },
      });
      await tx.workflowRun.update({
        where: { id: run.id, tenantId },
        data: {
          status: WorkflowRunStatus.RUNNING,
          currentStepId: step.id,
          scheduledFor: null,
          attempt,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: 'SYSTEM',
          action: 'workflow.step.failure_skipped',
          resourceType: 'workflow_run',
          resourceId: run.id,
          correlationId: run.correlationId,
          metadata: { stepId: step.id, error: reason, attempt },
        },
      });
      return this.executeFrom(tx, run, tenantId, workflow, steps, stepIndex + 1, policies, 1);
    }

    const terminalAction = policies.failure.action === 'retry' ? 'stop' : policies.failure.action;
    return this.failRun(tx, run.id, tenantId, reason, step.id, terminalAction);
  }

  private async failRun(
    tx: TenantScopedClient,
    runId: string,
    tenantId: string,
    reason: string,
    currentStepId?: string,
    failureAction: WorkflowFailurePolicy['action'] = 'stop',
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
    if (failureAction === 'escalate' || failureAction === 'human_handoff') {
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: 'SYSTEM',
          action:
            failureAction === 'escalate'
              ? 'workflow.run.escalation_requested'
              : 'workflow.run.handoff_requested',
          resourceType: 'workflow_run',
          resourceId: runId,
          metadata: { reason, currentStepId: currentStepId ?? null },
        },
      });
    }
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
