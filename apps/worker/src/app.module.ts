import { Module } from '@nestjs/common';
import { AgentsModule } from './agents/agents.module.js';
import { EnvironmentModule } from './config/environment.module.js';
import { DatabaseModule } from './database/database.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { QueuesModule } from './queues/queues.module.js';
import { WorkflowsModule } from './workflows/workflows.module.js';

/**
 * Worker composition root (ADR-009).
 *
 * Durable-event dispatch, tenant-aware outbound SMS, and the v0.3 workflow
 * message action are the first feature processors. Agent execution follows.
 */
@Module({
  providers: [WorkerHeartbeat],
  imports: [
    EnvironmentModule,
    DatabaseModule,
    AgentsModule,
    QueuesModule,
    WorkflowsModule,
    OutboxModule,
    MessagingModule,
  ],
})
export class AppModule {}

import { WorkerHeartbeat } from './worker-heartbeat.service.js';
