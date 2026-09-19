import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import type { Environment } from '@vautrin/config';

import { ENVIRONMENT } from '../config/environment.module.js';
import { ALL_QUEUES } from './queues.constants.js';
import { createRedisConnection } from './redis-connection.js';

/**
 * Registers the BullMQ queues this worker consumes (ADR-009).
 *
 * Defaults applied to every job:
 *   - bounded retries with exponential backoff (SDD-07 §7); unbounded retries
 *     turn one poisoned job into an endless load source;
 *   - completed jobs are trimmed, failed jobs are kept longer, because a
 *     failure still has to be explainable the next morning.
 *
 * Idempotency is NOT solved here. Retries mean a step can run twice, so
 * side-effecting steps carry an idempotency key enforced by a unique
 * constraint in the database (SDD-07 §6).
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment) => ({
        connection: createRedisConnection(environment.REDIS_URL),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { age: 3_600, count: 1_000 },
          removeOnFail: { age: 24 * 3_600 },
        },
      }),
    }),
    ...ALL_QUEUES.map((name) => BullModule.registerQueue({ name })),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
