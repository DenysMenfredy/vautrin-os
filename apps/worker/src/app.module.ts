import { Module } from '@nestjs/common';

import { EnvironmentModule } from './config/environment.module.js';
import { DatabaseModule } from './database/database.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { QueuesModule } from './queues/queues.module.js';
import { WorkflowsModule } from './workflows/workflows.module.js';

/**
 * Worker composition root (ADR-009).
 *
 * Durable-event dispatch and tenant-aware outbound SMS are the first feature
 * processors. Workflow actions and agent execution follow later.
 */
@Module({
  imports: [
    EnvironmentModule,
    DatabaseModule,
    QueuesModule,
    WorkflowsModule,
    OutboxModule,
    MessagingModule,
  ],
})
export class AppModule {}
