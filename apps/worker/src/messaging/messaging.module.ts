import { Module } from '@nestjs/common';
import { TwilioMessagingProvider } from '@vautrin/integrations';

import { QueuesModule } from '../queues/queues.module.js';
import { OutboundMessageProcessor } from './outbound-message.processor.js';
import { WorkerTwilioCredentialResolver } from './twilio-credential-resolver.service.js';

@Module({
  imports: [QueuesModule],
  providers: [
    WorkerTwilioCredentialResolver,
    {
      provide: TwilioMessagingProvider,
      useFactory: (credentials: WorkerTwilioCredentialResolver) =>
        new TwilioMessagingProvider(credentials),
      inject: [WorkerTwilioCredentialResolver],
    },
    OutboundMessageProcessor,
  ],
})
export class MessagingModule {}
