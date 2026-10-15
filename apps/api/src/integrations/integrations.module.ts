import { Module } from '@nestjs/common';
import {
  GoogleCalendarProvider,
  GoogleOAuthConsentProvider,
  GoogleOAuthTokenProvider,
  TwilioMessagingProvider,
} from '@vautrin/integrations';

import { ConversationsModule } from '../conversations/conversations.module.js';
import { GoogleCalendarIntegrationService } from './google-calendar-integration.service.js';
import { IntegrationManagementController } from './integration-management.controller.js';
import { IntegrationManagementService } from './integration-management.service.js';
import { TwilioIntegrationService } from './twilio-integration.service.js';
import { TwilioWebhookController } from './twilio-webhook.controller.js';
import { TwilioWebhookService } from './twilio-webhook.service.js';

@Module({
  imports: [ConversationsModule],
  controllers: [TwilioWebhookController, IntegrationManagementController],
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
    { provide: GoogleOAuthConsentProvider, useFactory: () => new GoogleOAuthConsentProvider() },
    IntegrationManagementService,
  ],
  exports: [GoogleCalendarProvider, GoogleCalendarIntegrationService],
})
export class IntegrationsModule {}
