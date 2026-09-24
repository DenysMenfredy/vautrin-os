import 'reflect-metadata';

import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { leadCreatedEvent } from '@vautrin/contracts';
import {
  createPlatformClient,
  createPrismaClient,
  type PrismaClient,
  withTenant,
} from '@vautrin/database';
import { DOMAIN_EVENT_JOB, durableEventJobId, QUEUE } from '@vautrin/queues';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { DomainEventProcessor } from '../src/outbox/domain-event.processor.js';
import { OutboxDispatcher } from '../src/outbox/outbox-dispatcher.service.js';

const suffix = Date.now();
let app: INestApplicationContext;
let platform: PrismaClient;
let runtime: PrismaClient;
let tenantA = '';
let tenantB = '';
let eventId = '';
let failedEventId = '';
let dispatcher: OutboxDispatcher;
let processor: DomainEventProcessor;
let queue: Queue;

beforeAll(async () => {
  app = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await app.init();
  platform = createPlatformClient();
  runtime = createPrismaClient();
  [tenantA, tenantB] = await Promise.all([
    platform.tenant
      .create({ data: { slug: `outbox-a-${suffix}`, name: 'Outbox Tenant A' } })
      .then((t) => t.id),
    platform.tenant
      .create({ data: { slug: `outbox-b-${suffix}`, name: 'Outbox Tenant B' } })
      .then((t) => t.id),
  ]);
  dispatcher = app.get(OutboxDispatcher);
  processor = app.get(DomainEventProcessor);
  queue = app.get<Queue>(getQueueToken(QUEUE.WORKFLOW));
});

afterAll(async () => {
  vi.restoreAllMocks();
  await runtime?.$disconnect();
  await platform?.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await platform?.$disconnect();
  await app?.close();
});

function createEvent(tenantId: string, suffixValue: string, published = false): Promise<string> {
  const event = leadCreatedEvent(crypto.randomUUID(), crypto.randomUUID());
  return withTenant(runtime, tenantId, async (tx) => {
    const row = await tx.event.create({
      data: {
        tenantId,
        name: event.name,
        version: event.version,
        payload: event.payload,
        idempotencyKey: `outbox-test:${suffixValue}:${suffix}`,
        ...(published ? { publishedAt: new Date() } : {}),
      },
    });
    return row.id;
  });
}

describe('v0.3 durable outbox', () => {
  it('discovers only tenant IDs and keeps event rows protected by RLS', async () => {
    eventId = await createEvent(tenantA, 'first');
    expect(await runtime.event.findMany({ where: { id: eventId } })).toHaveLength(0);
    expect(
      await withTenant(runtime, tenantB, (tx) => tx.event.findMany({ where: { id: eventId } })),
    ).toHaveLength(0);
    const candidates = await runtime.$queryRaw<Array<{ tenant_id: string }>>`
      SELECT tenant_id FROM app.pending_event_tenants(50)
    `;
    expect(candidates.some((candidate) => candidate.tenant_id === tenantA)).toBe(true);
  });

  it('claims once across competing dispatchers and enqueues tenant-bearing jobs', async () => {
    const attempts = await Promise.all([dispatcher.dispatchOnce(), dispatcher.dispatchOnce()]);
    expect(attempts.reduce((sum, item) => sum + item.enqueued, 0)).toBe(1);
    const row = await withTenant(runtime, tenantA, (tx) =>
      tx.event.findFirst({ where: { id: eventId, tenantId: tenantA } }),
    );
    expect(row?.publishedAt).not.toBeNull();
    const job = await queue.getJob(durableEventJobId(eventId));
    expect(job?.name).toBe(DOMAIN_EVENT_JOB);
    expect(job?.data).toMatchObject({ tenantId: tenantA, eventId });
  });

  it('creates one workflow run for duplicate deliveries and rejects another tenant', async () => {
    await withTenant(runtime, tenantA, (tx) =>
      tx.workflow.create({
        data: {
          tenantId: tenantA,
          key: `outbox-test-${suffix}`,
          version: 1,
          name: 'Outbox integration workflow',
          trigger: 'lead.created',
          status: 'ACTIVE',
          definition: { steps: [] },
        },
      }),
    );
    const manualEventId = await createEvent(tenantA, 'manual-consumer', true);
    const first = await processor.handle({ tenantId: tenantA, eventId: manualEventId });
    const replay = await processor.handle({ tenantId: tenantA, eventId: manualEventId });
    expect(first.created + replay.created).toBe(1);
    expect(first.replayed + replay.replayed).toBe(1);
    const runs = await withTenant(runtime, tenantA, (tx) =>
      tx.workflowRun.findMany({ where: { tenantId: tenantA, triggerEventId: manualEventId } }),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('PENDING');
    await expect(processor.handle({ tenantId: tenantB, eventId: manualEventId })).rejects.toThrow(
      'Event not found',
    );
    expect(await withTenant(runtime, tenantB, (tx) => tx.workflowRun.findMany())).toHaveLength(0);
  });

  it('leaves a failed enqueue unpublished and reconciles it on retry', async () => {
    failedEventId = await createEvent(tenantB, 'failed');
    const addSpy = vi
      .spyOn(queue, 'add')
      .mockRejectedValueOnce(new Error('simulated Redis outage'));
    const failed = await dispatcher.dispatchOnce();
    expect(failed.failed).toBe(1);
    expect(
      (
        await withTenant(runtime, tenantB, (tx) =>
          tx.event.findFirst({ where: { id: failedEventId } }),
        )
      )?.publishedAt,
    ).toBeNull();
    addSpy.mockRestore();
    const recovered = await dispatcher.dispatchOnce();
    expect(recovered.enqueued).toBe(1);
    expect(
      (
        await withTenant(runtime, tenantB, (tx) =>
          tx.event.findFirst({ where: { id: failedEventId } }),
        )
      )?.publishedAt,
    ).not.toBeNull();
  });

  it('replays an event already queued before its published marker committed', async () => {
    const replayEventId = await createEvent(tenantA, 'crash-window');
    await queue.add(
      DOMAIN_EVENT_JOB,
      { tenantId: tenantA, eventId: replayEventId },
      { jobId: durableEventJobId(replayEventId) },
    );
    const recovered = await dispatcher.dispatchOnce();
    expect(recovered.enqueued).toBe(1);
    expect(recovered.duplicateOrReplayed).toBe(1);
    const event = await withTenant(runtime, tenantA, (tx) =>
      tx.event.findFirst({ where: { id: replayEventId, tenantId: tenantA } }),
    );
    expect(event?.publishedAt).not.toBeNull();
    await processor.handle({ tenantId: tenantA, eventId: replayEventId });
    const runs = await withTenant(runtime, tenantA, (tx) =>
      tx.workflowRun.findMany({ where: { tenantId: tenantA, triggerEventId: replayEventId } }),
    );
    expect(runs).toHaveLength(1);
  });
});
