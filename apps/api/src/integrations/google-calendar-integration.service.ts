import { ForbiddenException, Injectable } from '@nestjs/common';
import { GoogleOAuthTokenProvider, IntegrationCredentialStore } from '@vautrin/integrations';
import { CalendarConnection } from '@vautrin/revenue';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class GoogleCalendarIntegrationService extends CalendarConnection {
  constructor(database: DatabaseService, tokens: GoogleOAuthTokenProvider) {
    super(database, tokens, new IntegrationCredentialStore());
  }
  override async resolve(tenantId: string, integrationId: string) {
    try {
      return await super.resolve(tenantId, integrationId);
    } catch (error) {
      if (error instanceof Error && error.message === 'integration_unavailable')
        throw new ForbiddenException('Integration unavailable.');
      throw error;
    }
  }
}
