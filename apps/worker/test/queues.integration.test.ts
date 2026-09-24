import 'reflect-metadata';

import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ALL_QUEUES, QUEUE } from '@vautrin/queues';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EnvironmentModule } from '../src/config/environment.module.js';
import { QueuesModule } from '../src/queues/queues.module.js';

/**
 * Proves the worker actually reaches Redis (ADR-009).
 *
 * Booting is not evidence of a working queue: BullMQ constructs its client
 * lazily, so a misconfigured connection stays invisible until the first
 * command. Enqueuing and reading back a job is the cheapest check that
 * exercises the real path.
 */
describe('worker queues', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [EnvironmentModule, QueuesModule] }).compile();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('registers every queue named in ADR-009', () => {
    for (const name of ALL_QUEUES) {
      const queue = app.get<Queue>(getQueueToken(name));
      expect(queue.name).toBe(name);
    }
  });

  it('round-trips a job through Redis', async () => {
    const queue = app.get<Queue>(getQueueToken(QUEUE.WORKFLOW));
    const jobName = `probe-${Date.now()}`;

    // SDD-05 §5 — a job carries its tenant explicitly.
    const job = await queue.add(jobName, {
      tenantId: '0192f1a0-1b2c-7d3e-8f40-51627384950a',
      correlationId: crypto.randomUUID(),
    });

    expect(job.id).toBeDefined();

    const stored = await queue.getJob(job.id as string);
    expect(stored?.data.tenantId).toBe('0192f1a0-1b2c-7d3e-8f40-51627384950a');

    await stored?.remove();
  });

  it('applies the bounded retry policy from the module defaults', async () => {
    // SDD-07 §7: retries must be bounded. An unbounded default would turn a
    // single poisoned job into a permanent load source.
    const queue = app.get<Queue>(getQueueToken(QUEUE.NOTIFICATIONS));
    const job = await queue.add('probe-retry', { tenantId: 'x' });

    expect(job.opts.attempts).toBe(3);
    expect(job.opts.backoff).toMatchObject({ type: 'exponential' });

    await job.remove();
  });
});
