import { Module } from '@nestjs/common';
import {
  GoogleCalendarProvider,
  GoogleOAuthTokenProvider,
  TwilioMessagingProvider,
} from '@vautrin/integrations';

import { ConversationsModule } from '../conversations/conversations.module.js';
import { GoogleCalendarIntegrationService } from './google-calendar-integration.service.js';
import { TwilioIntegrationService } from './twilio-integration.service.js';
import { TwilioWebhookController } from './twilio-webhook.controller.js';
import { TwilioWebhookService } from './twilio-webhook.service.js';

@Module({
  imports: [ConversationsModule],
  controllers: [TwilioWebhookController],
  providers: [
    { provide: GoogleCalendarProvider, useFactory: () => new GoogleCalendarProvider() },
    { provide: GoogleOAuthTokenProvider, useFactory: () => new GoogleOAuthTokenProvider() },
    GoogleCalendarIntegrationService,
    TwilioIntegrationService,
    {
      provide: TwilioMessagingProvider,
      useFactory: (credentials: TwilioIntegrationService) =>
        new TwilioMessagingProvider(credentials),
      inject: [TwilioIntegrationService],
    },
    TwilioWebhookService,
  ],
  exports: [GoogleCalendarProvider, GoogleCalendarIntegrationService],
})
export class IntegrationsModule {}
