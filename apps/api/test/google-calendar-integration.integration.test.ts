import 'reflect-metadata';

import {
  createPlatformClient,
  createPrismaClient,
  type PrismaClient,
  withTenant,
} from '@vautrin/database';
import { GoogleOAuthTokenProvider } from '@vautrin/integrations';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DatabaseService } from '../src/database/database.service.js';
import { GoogleCalendarIntegrationService } from '../src/integrations/google-calendar-integration.service.js';

const suffix = Date.now();
const secretName = 'VAUTRIN_GOOGLE_CALENDAR_INTEGRATION_TEST';
const calendarId = 'business@example.test';
let platform: PrismaClient;
let runtime: PrismaClient;
let tenantA = '';
let tenantB = '';
let integrationId = '';
let service: GoogleCalendarIntegrationService;
const refresh = vi
  .fn<typeof fetch>()
  .mockResolvedValue(
    new Response(JSON.stringify({ access_token: 'short-lived-token', token_type: 'Bearer' })),
  );

beforeAll(async () => {
  process.env[secretName] = JSON.stringify({
    clientId: 'local-client',
    clientSecret: 'local-secret',
    refreshToken: 'local-refresh-token',
  });
  platform = createPlatformClient();
  runtime = createPrismaClient();
  [tenantA, tenantB] = await Promise.all([
    platform.tenant
      .create({ data: { slug: `google-calendar-a-${suffix}`, name: 'Calendar A' } })
      .then((row) => row.id),
    platform.tenant
      .create({ data: { slug: `google-calendar-b-${suffix}`, name: 'Calendar B' } })
      .then((row) => row.id),
  ]);
  integrationId = await withTenant(runtime, tenantA, (tx) =>
    tx.integration
      .create({
        data: {
          tenantId: tenantA,
          provider: 'google_calendar',
          category: 'CALENDAR',
          status: 'CONNECTED',
          credentialsRef: `env:${secretName}`,
          configuration: { calendarId },
        },
      })
      .then((row) => row.id),
  );
  const database = {
    withTenant: <T>(tenantId: string, fn: Parameters<DatabaseService['withTenant']>[1]) =>
      withTenant(runtime, tenantId, fn) as Promise<T>,
  } as DatabaseService;
  service = new GoogleCalendarIntegrationService(database, new GoogleOAuthTokenProvider(refresh));
});

afterAll(async () => {
  delete process.env[secretName];
  await runtime?.$disconnect();
  await platform?.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await platform?.$disconnect();
});

describe('Google Calendar tenant credential boundary', () => {
  it('resolves only the connected tenant calendar and refreshes without exposing its secret', async () => {
    expect(await service.resolve(tenantA, integrationId)).toEqual({
      tenantId: tenantA,
      calendarId,
      accessToken: 'short-lived-token',
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(String(refresh.mock.calls[0]?.[1]?.body)).toContain('grant_type=refresh_token');
  });

  it('rejects a cross-tenant integration before requesting a token', async () => {
    await expect(service.resolve(tenantB, integrationId)).rejects.toMatchObject({ status: 403 });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('rejects disconnected integrations and non-allowlisted secret references', async () => {
    await withTenant(runtime, tenantA, (tx) =>
      tx.integration.update({ where: { id: integrationId }, data: { status: 'DISCONNECTED' } }),
    );
    try {
      await expect(service.resolve(tenantA, integrationId)).rejects.toMatchObject({ status: 403 });
    } finally {
      await withTenant(runtime, tenantA, (tx) =>
        tx.integration.update({ where: { id: integrationId }, data: { status: 'CONNECTED' } }),
      );
    }
    await withTenant(runtime, tenantA, (tx) =>
      tx.integration.update({
        where: { id: integrationId },
        data: { credentialsRef: 'env:DATABASE_URL' },
      }),
    );
    await expect(service.resolve(tenantA, integrationId)).rejects.toMatchObject({ status: 403 });
    expect(refresh).not.toHaveBeenCalled();
  });
});
