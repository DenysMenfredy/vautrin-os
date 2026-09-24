import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { parseDomainEvent } from '@vautrin/contracts';
import {
  assertDurableEventJob,
  DOMAIN_EVENT_JOB,
  type DurableEventJob,
  QUEUE,
} from '@vautrin/queues';
import type { Job } from 'bullmq';

import { DatabaseService } from '../database/database.service.js';

/** Creates at most one pending run per event + workflow version. */
@Processor(QUEUE.WORKFLOW)
export class DomainEventProcessor extends WorkerHost {
  private readonly logger = new Logger(DomainEventProcessor.name);

  constructor(private readonly database: DatabaseService) {
    super();
  }

  process(job: Job<DurableEventJob>): Promise<{ created: number; replayed: number }> {
    if (job.name !== DOMAIN_EVENT_JOB) throw new Error(`Unknown workflow job: ${job.name}`);
    return this.handle(job.data);
  }

  handle(data: unknown): Promise<{ created: number; replayed: number }> {
    assertDurableEventJob(data);
    return this.database.withJobTenant(data, async (tx, context) => {
      const event = await tx.event.findFirst({
        where: { id: data.eventId, tenantId: context.tenantId },
      });
      if (!event) throw new Error('Event not found in job tenant.');
      parseDomainEvent({ name: event.name, version: event.version, payload: event.payload });

      const workflows = await tx.workflow.findMany({
        where: { tenantId: context.tenantId, trigger: event.name, status: 'ACTIVE' },
        select: { id: true, version: true },
      });
      let created = 0;
      let replayed = 0;
      for (const workflow of workflows) {
        const idempotencyKey = `event-${event.id}-workflow-${workflow.id}-v${workflow.version}`;
        const result = await tx.workflowRun.createMany({
          data: [
            {
              tenantId: context.tenantId,
              workflowId: workflow.id,
              workflowVersion: workflow.version,
              triggerEvent: event.name,
              triggerEventId: event.id,
              correlationId: event.correlationId,
              idempotencyKey,
              context: { eventId: event.id },
            },
          ],
          skipDuplicates: true,
        });
        if (result.count === 0) {
          replayed++;
          continue;
        }
        const run = await tx.workflowRun.findFirst({
          where: { tenantId: context.tenantId, idempotencyKey },
          select: { id: true },
        });
        if (!run) throw new Error('New workflow run was not visible.');
        await tx.auditLog.create({
          data: {
            tenantId: context.tenantId,
            actorType: 'SYSTEM',
            action: 'workflow.run.created',
            resourceType: 'workflow_run',
            resourceId: run.id,
            correlationId: event.correlationId,
          },
        });
        created++;
      }
      this.logger.log(
        `Processed event tenantId=${context.tenantId} eventId=${event.id} created=${created} replayed=${replayed}`,
      );
      return { created, replayed };
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<DurableEventJob> | undefined, error: Error): void {
    this.logger.error(
      `Workflow job failed tenantId=${job?.data?.tenantId ?? 'unknown'} jobId=${job?.id ?? 'unknown'} error=${error.name}`,
    );
  }
}
