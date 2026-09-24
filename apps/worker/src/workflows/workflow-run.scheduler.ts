import { getQueueToken } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  Prisma,
  StepRunStatus,
  type TenantScopedClient,
  WorkflowRunStatus,
} from '@vautrin/database';
import { QUEUE, WORKFLOW_RUN_JOB, type WorkflowRunJob, workflowRunJobId } from '@vautrin/queues';
import type { Queue } from 'bullmq';

import { DatabaseService } from '../database/database.service.js';

const TENANT_BATCH_SIZE = 50;
const RUN_BATCH_SIZE = 25;
const POLL_INTERVAL_MS = 5_000;
const CLAIM_TRANSACTION_TIMEOUT_MS = 30_000;

interface PendingTenant {
  readonly tenant_id: string;
  readonly oldest_at: Date;
}

interface PendingWorkflowRun {
  readonly id: string;
  readonly status: 'PENDING' | 'WAITING';
  readonly current_step_id: string | null;
  readonly scheduled_for: Date | null;
  readonly delay_ms: number;
  readonly correlation_id: string | null;
}

export interface WorkflowRunDispatchMetrics {
  readonly scanned: number;
  readonly enqueued: number;
  readonly existing: number;
  readonly failed: number;
  readonly oldestPendingAgeSeconds: number;
}

/**
 * PostgreSQL owns future workflow intent. This reconciler periodically
 * recreates missing BullMQ start/delayed-wake jobs after Redis loss or a crash.
 */
@Injectable()
export class WorkflowRunScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(WorkflowRunScheduler.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private stopped = false;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly database: DatabaseService,
    @Inject(getQueueToken(QUEUE.WORKFLOW)) private readonly queue: Queue<WorkflowRunJob>,
  ) {}

  start(): void {
    if (this.timer || this.running || this.stopped) return;
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  async dispatchOnce(): Promise<WorkflowRunDispatchMetrics> {
    // This SECURITY DEFINER function exposes only bounded tenant IDs and
    // timestamps; individual workflow rows are selected under tenant RLS.
    // nosemgrep: semgrep.vautrin-unscoped-database-access
    const candidates = await this.database.unscoped.$queryRaw<PendingTenant[]>(
      Prisma.sql`SELECT tenant_id, oldest_at FROM app.pending_workflow_run_tenants(${TENANT_BATCH_SIZE}::integer)`,
    );
    const metrics = {
      scanned: 0,
      enqueued: 0,
      existing: 0,
      failed: 0,
      oldestPendingAgeSeconds: candidates[0]
        ? Math.max(0, Math.floor((Date.now() - candidates[0].oldest_at.getTime()) / 1_000))
        : 0,
    };

    for (const candidate of candidates) {
      try {
        const batch = await this.database.withJobTenant(
          { tenantId: candidate.tenant_id },
          async (tx) => {
            const rows = await tx.$queryRaw<PendingWorkflowRun[]>`
              SELECT
                id,
                status,
                current_step_id,
                scheduled_for,
                correlation_id,
                CASE
                  WHEN status = 'WAITING' AND scheduled_for IS NOT NULL THEN
                    GREATEST(0, CEIL(EXTRACT(EPOCH FROM (scheduled_for - clock_timestamp())) * 1000))::double precision
                  ELSE 0::double precision
                END AS delay_ms
              FROM public.workflow_runs
              WHERE tenant_id = ${candidate.tenant_id}::uuid
                AND status IN ('PENDING', 'WAITING')
              ORDER BY COALESCE(scheduled_for, created_at), id
              LIMIT ${RUN_BATCH_SIZE}
              FOR UPDATE SKIP LOCKED
            `;
            let enqueued = 0;
            let existing = 0;
            let failed = 0;

            for (const row of rows) {
              const job = this.toJob(candidate.tenant_id, row);
              if (!job) {
                await this.failMalformedRun(tx, candidate.tenant_id, row.id);
                failed++;
                continue;
              }

              const jobId = workflowRunJobId(job);
              const queuedJob = await this.queue.getJob(jobId);
              if (queuedJob) {
                const state = await queuedJob.getState();
                if (state === 'failed') {
                  await this.failRun(
                    tx,
                    candidate.tenant_id,
                    row,
                    'workflow_job_retries_exhausted',
                  );
                  failed++;
                  continue;
                }
                if (state !== 'completed') {
                  existing++;
                  continue;
                }
                // A completed job with an actionable DB row means the DB
                // transition did not stick (or a delayed wake arrived early).
                await queuedJob.remove();
              }

              const delay = job.action === 'wake' ? Math.max(0, row.delay_ms) : 0;
              await this.queue.add(WORKFLOW_RUN_JOB, job, {
                jobId,
                ...(delay > 0 ? { delay } : {}),
              });
              enqueued++;
            }
            return { scanned: rows.length, enqueued, existing, failed };
          },
          { timeout: CLAIM_TRANSACTION_TIMEOUT_MS },
        );
        metrics.scanned += batch.scanned;
        metrics.enqueued += batch.enqueued;
        metrics.existing += batch.existing;
        metrics.failed += batch.failed;
      } catch (error) {
        metrics.failed++;
        this.logger.error(
          `Workflow reconciliation failed tenantId=${candidate.tenant_id} error=${errorClass(error)}`,
        );
      }
    }

    this.logger.log(`Workflow reconciliation ${JSON.stringify(metrics)}`);
    return metrics;
  }

  private toJob(tenantId: string, row: PendingWorkflowRun): WorkflowRunJob | null {
    if (row.status === WorkflowRunStatus.PENDING) {
      return {
        tenantId,
        runId: row.id,
        action: 'start',
        ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
      };
    }
    if (row.status === WorkflowRunStatus.WAITING && row.current_step_id && row.scheduled_for) {
      return {
        tenantId,
        runId: row.id,
        action: 'wake',
        stepId: row.current_step_id,
        ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
      };
    }
    return null;
  }

  private async failMalformedRun(
    tx: TenantScopedClient,
    tenantId: string,
    runId: string,
  ): Promise<void> {
    await this.failRun(
      tx,
      tenantId,
      { id: runId, status: 'WAITING', current_step_id: null },
      'invalid_wait_state',
    );
  }

  private async failRun(
    tx: TenantScopedClient,
    tenantId: string,
    row: Pick<PendingWorkflowRun, 'id' | 'status' | 'current_step_id'>,
    reason: string,
  ): Promise<void> {
    const now = new Date();
    await tx.workflowRun.updateMany({
      where: { id: row.id, tenantId, status: row.status },
      data: { status: WorkflowRunStatus.FAILED, failedAt: now, scheduledFor: null, error: reason },
    });
    if (row.status === WorkflowRunStatus.WAITING && row.current_step_id) {
      await tx.workflowStepRun.updateMany({
        where: {
          tenantId,
          workflowRunId: row.id,
          stepId: row.current_step_id,
          status: StepRunStatus.SCHEDULED,
        },
        data: { status: StepRunStatus.FAILED, error: reason, completedAt: now },
      });
    }
    await tx.auditLog.create({
      data: {
        tenantId,
        actorType: 'SYSTEM',
        action: 'workflow.run.failed',
        resourceType: 'workflow_run',
        resourceId: row.id,
      },
    });
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.stopped || this.running) return;
      this.running = true;
      this.inFlight = this.dispatchOnce()
        .then(() => undefined)
        .catch((error: unknown) => {
          this.logger.error(`Workflow run discovery failed error=${errorClass(error)}`);
        })
        .finally(() => {
          this.running = false;
          this.inFlight = undefined;
          if (!this.stopped) this.schedule(POLL_INTERVAL_MS);
        });
    }, delay);
    this.timer.unref();
  }
}

function errorClass(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';
  const code = 'code' in error && typeof error.code === 'string' ? `:${error.code}` : '';
  return `${error.name}${code}`;
}
