import { Module } from '@nestjs/common';

import { EnvironmentModule } from './config/environment.module.js';
import { DatabaseModule } from './database/database.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { QueuesModule } from './queues/queues.module.js';

/**
 * Worker composition root (ADR-009).
 *
 * Durable-event dispatch and run creation are the first processors. Workflow
 * steps, agent runs, outbound messaging, and webhook handling follow later.
 */
@Module({
  imports: [EnvironmentModule, DatabaseModule, QueuesModule, OutboxModule],
})
export class AppModule {}
