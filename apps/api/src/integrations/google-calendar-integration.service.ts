import { ForbiddenException, Injectable } from '@nestjs/common';
import type {
  CalendarConnectionResolver,
  CalendarContext,
  GoogleOAuthCredentials,
} from '@vautrin/integrations';
import { GoogleOAuthTokenProvider } from '@vautrin/integrations';

import { DatabaseService } from '../database/database.service.js';

const SECRET_REF = /^env:(VAUTRIN_GOOGLE_CALENDAR_[A-Z0-9_]+)$/;

/** Resolves a tenant calendar and refreshes its OAuth token only when needed. */
@Injectable()
export class GoogleCalendarIntegrationService implements CalendarConnectionResolver {
  constructor(
    private readonly database: DatabaseService,
    private readonly tokens: GoogleOAuthTokenProvider,
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
    if (!integration?.credentialsRef) throw new ForbiddenException('Integration unavailable.');
    const match = SECRET_REF.exec(integration.credentialsRef);
    const calendarId = isRecord(integration.configuration)
      ? integration.configuration.calendarId
      : null;
    if (
      !match?.[1] ||
      typeof calendarId !== 'string' ||
      !calendarId.trim() ||
      calendarId.length > 1024
    ) {
      throw new ForbiddenException('Integration unavailable.');
    }
    const secret = process.env[match[1]];
    if (!secret) throw new ForbiddenException('Integration unavailable.');
    let value: unknown;
    try {
      value = JSON.parse(secret);
    } catch {
      throw new ForbiddenException('Integration unavailable.');
    }
    if (!isRecord(value)) throw new ForbiddenException('Integration unavailable.');
    const credentials: GoogleOAuthCredentials = {
      clientId: stringField(value.clientId),
      clientSecret: stringField(value.clientSecret),
      refreshToken: stringField(value.refreshToken),
    };
    if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) {
      throw new ForbiddenException('Integration unavailable.');
    }
    const accessToken = await this.tokens.accessToken(credentials);
    return { tenantId, calendarId, accessToken };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
