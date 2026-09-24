import { Module } from '@nestjs/common';

import { QueuesModule } from '../queues/queues.module.js';
import { DomainEventProcessor } from './domain-event.processor.js';
import { OutboxDispatcher } from './outbox-dispatcher.service.js';

@Module({
  imports: [QueuesModule],
  providers: [OutboxDispatcher, DomainEventProcessor],
  exports: [OutboxDispatcher],
})
export class OutboxModule {}
