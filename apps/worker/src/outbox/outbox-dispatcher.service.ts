import { getQueueToken } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@vautrin/database';
import { DOMAIN_EVENT_JOB, type DurableEventJob, durableEventJobId, QUEUE } from '@vautrin/queues';
import type { Queue } from 'bullmq';

import { DatabaseService } from '../database/database.service.js';

const TENANT_BATCH_SIZE = 50;
const EVENT_BATCH_SIZE = 25;
const POLL_INTERVAL_MS = 5_000;
const CLAIM_TRANSACTION_TIMEOUT_MS = 30_000;

interface PendingTenant {
  readonly tenant_id: string;
  readonly oldest_at: Date;
}

interface ClaimedEvent {
  readonly id: string;
  readonly tenant_id: string;
  readonly correlation_id: string | null;
  readonly idempotency_key: string | null;
}

export interface DispatchMetrics {
  readonly scanned: number;
  readonly enqueued: number;
  readonly duplicateOrReplayed: number;
  readonly failed: number;
  readonly oldestUnpublishedAgeSeconds: number;
}

/**
 * Polling is also reconciliation: any event left unpublished after a Redis
 * outage or process crash will be found again. No event is marked published
 * until BullMQ accepts it. Concurrent instances skip each other's row locks.
 */
@Injectable()
export class OutboxDispatcher implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private stopped = false;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly database: DatabaseService,
    @Inject(getQueueToken(QUEUE.WORKFLOW)) private readonly queue: Queue<DurableEventJob>,
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

  async dispatchOnce(): Promise<DispatchMetrics> {
    // Discovery has no tenant context yet. The SECURITY DEFINER function
    // returns only bounded tenant IDs and oldest timestamps; event rows are
    // claimed below inside withJobTenant() under RLS.
    // nosemgrep: semgrep.vautrin-unscoped-database-access
    const candidates = await this.database.unscoped.$queryRaw<PendingTenant[]>(
      Prisma.sql`SELECT tenant_id, oldest_at FROM app.pending_event_tenants(${TENANT_BATCH_SIZE}::integer)`,
    );
    const metrics = {
      scanned: 0,
      enqueued: 0,
      duplicateOrReplayed: 0,
      failed: 0,
      oldestUnpublishedAgeSeconds: 0,
    };
    if (candidates[0]) {
      metrics.oldestUnpublishedAgeSeconds = Math.max(
        0,
        Math.floor((Date.now() - candidates[0].oldest_at.getTime()) / 1_000),
      );
    }

    for (const candidate of candidates) {
      try {
        const batch = await this.database.withJobTenant(
          { tenantId: candidate.tenant_id },
          async (tx) => {
            const rows = await tx.$queryRaw<ClaimedEvent[]>`
              SELECT id, tenant_id, correlation_id, idempotency_key
              FROM public.events
              WHERE tenant_id = ${candidate.tenant_id}::uuid
                AND published_at IS NULL
              ORDER BY occurred_at ASC, id ASC
              LIMIT ${EVENT_BATCH_SIZE}
              FOR UPDATE SKIP LOCKED
            `;
            let enqueued = 0;
            let duplicateOrReplayed = 0;
            for (const event of rows) {
              const jobId = durableEventJobId(event.id);
              if (await this.queue.getJob(jobId)) duplicateOrReplayed++;
              await this.queue.add(
                DOMAIN_EVENT_JOB,
                {
                  eventId: event.id,
                  tenantId: event.tenant_id,
                  ...(event.correlation_id ? { correlationId: event.correlation_id } : {}),
                  ...(event.idempotency_key ? { idempotencyKey: event.idempotency_key } : {}),
                },
                { jobId },
              );
              const updated = await tx.event.updateMany({
                where: { id: event.id, tenantId: candidate.tenant_id, publishedAt: null },
                data: { publishedAt: new Date() },
              });
              if (updated.count !== 1) throw new Error('Claimed event changed before dispatch.');
              enqueued++;
            }
            return { scanned: rows.length, enqueued, duplicateOrReplayed };
          },
          { timeout: CLAIM_TRANSACTION_TIMEOUT_MS },
        );
        metrics.scanned += batch.scanned;
        metrics.enqueued += batch.enqueued;
        metrics.duplicateOrReplayed += batch.duplicateOrReplayed;
      } catch (error) {
        metrics.failed++;
        this.logger.error(
          `Outbox dispatch failed tenantId=${candidate.tenant_id} error=${errorClass(error)}`,
        );
      }
    }
    this.logger.log(`Outbox dispatch ${JSON.stringify(metrics)}`);
    return metrics;
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.stopped || this.running) return;
      this.running = true;
      this.inFlight = this.dispatchOnce()
        .then(() => undefined)
        .catch((error: unknown) => {
          this.logger.error(`Outbox discovery failed error=${errorClass(error)}`);
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
