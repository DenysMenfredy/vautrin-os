import { Module } from '@nestjs/common';

import { QueuesModule } from '../queues/queues.module.js';
import { WorkflowsModule } from '../workflows/workflows.module.js';
import { DomainEventProcessor } from './domain-event.processor.js';
import { OutboxDispatcher } from './outbox-dispatcher.service.js';

@Module({
  imports: [QueuesModule, WorkflowsModule],
  providers: [OutboxDispatcher, DomainEventProcessor],
  exports: [OutboxDispatcher],
})
export class OutboxModule {}
