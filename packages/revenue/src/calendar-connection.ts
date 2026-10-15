import {
  type CalendarConnectionResolver,
  type CalendarContext,
  type CredentialStore,
  CredentialStoreError,
  type GoogleOAuthTokenProvider,
} from '@vautrin/integrations';
import type { RevenueDatabase } from './ports.js';

export class CalendarConnection implements CalendarConnectionResolver {
  constructor(
    private readonly database: RevenueDatabase,
    private readonly tokens: GoogleOAuthTokenProvider,
    private readonly secrets: CredentialStore,
  ) {}
  async resolve(tenantId: string, integrationId: string): Promise<CalendarContext> {
    const integration = await this.database.withTenant(tenantId, (tx) =>
      tx.integration.findFirst({
        where: {
          id: integrationId,
          tenantId,
          provider: 'google_calendar',
          category: 'CALENDAR',
          status: { in: ['CONNECTED', 'HEALTHY', 'DEGRADED'] },
        },
      }),
    );
    if (!integration?.credentialsRef) throw new CredentialStoreError();
    const config = integration.configuration;
    const calendarId =
      config && typeof config === 'object' && !Array.isArray(config)
        ? config.calendarId
        : undefined;
    if (typeof calendarId !== 'string' || !calendarId.trim() || calendarId.length > 1_024)
      throw new CredentialStoreError();
    const credentials = await this.secrets.read(
      tenantId,
      'google_calendar',
      integration.credentialsRef,
    );
    if (
      typeof credentials.clientId !== 'string' ||
      typeof credentials.clientSecret !== 'string' ||
      typeof credentials.refreshToken !== 'string'
    )
      throw new CredentialStoreError();
    const accessToken = await this.tokens.accessToken({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: credentials.refreshToken,
    });
    return { tenantId, calendarId, accessToken };
  }
}
