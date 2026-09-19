import { Module } from '@nestjs/common';

import { EnvironmentModule } from './config/environment.module.js';
import { DatabaseModule } from './database/database.module.js';
import { QueuesModule } from './queues/queues.module.js';

/**
 * Worker composition root (ADR-009).
 *
 * Queue infrastructure only so far. Processors arrive with their backlog
 * items: workflow execution (VOS-083), agent runs (VOS-087), outbound
 * messaging (VOS-086) and webhook ingestion (VOS-064).
 */
@Module({
  imports: [EnvironmentModule, DatabaseModule, QueuesModule],
})
export class AppModule {}
