import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Environment } from '@vautrin/config';
import {
  createPlatformClient,
  createPrismaClient,
  type PrismaClient,
  withTenant,
} from '@vautrin/database';
import { GoogleOAuthConsentProvider, IntegrationCredentialStore } from '@vautrin/integrations';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../src/database/database.service.js';
import { IntegrationManagementService } from '../src/integrations/integration-management.service.js';

let platform: PrismaClient;
let runtime: PrismaClient;
let service: IntegrationManagementService;
let tenantA = '';
let tenantB = '';
let userId = '';
let directory = '';
const saved = { ...process.env };
const exchange = vi.fn(() => Promise.resolve({ refreshToken: 'synthetic-refresh-token' }));
class MockConsent extends GoogleOAuthConsentProvider {
  override exchange(): Promise<{ refreshToken: string }> {
    return exchange();
  }
}
const consent = new MockConsent();
const suffix = randomUUID();
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vautrin-oauth-'));
  process.env.LOCAL_SECRET_DIRECTORY = directory;
  process.env.LOCAL_SECRET_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'synthetic-client';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'synthetic-client-secret';
  process.env.GOOGLE_OAUTH_REDIRECT_URI =
    'http://localhost/api/integrations/google-calendar/callback';
  delete process.env.GCP_PROJECT_ID;
  platform = createPlatformClient();
  runtime = createPrismaClient();
  tenantA = (await platform.tenant.create({ data: { slug: `oauth-a-${suffix}`, name: 'OAuth A' } }))
    .id;
  tenantB = (await platform.tenant.create({ data: { slug: `oauth-b-${suffix}`, name: 'OAuth B' } }))
    .id;
  userId = (
    await platform.user.create({
      data: { email: `oauth-${suffix}@example.test`, status: 'ACTIVE' },
    })
  ).id;
  await withTenant(runtime, tenantA, (tx) =>
    tx.tenantUser.create({ data: { tenantId: tenantA, userId, role: 'OWNER' } }),
  );
  const database = {
    withTenant: <T>(id: string, fn: Parameters<DatabaseService['withTenant']>[1]) =>
      withTenant(runtime, id, fn) as Promise<T>,
  } as DatabaseService;
  service = new IntegrationManagementService(database, consent, {
    REDIS_URL: process.env.REDIS_URL,
  } as Environment);
});
afterAll(async () => {
  service?.onModuleDestroy();
  await runtime?.$disconnect();
  await platform?.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await platform?.user.deleteMany({ where: { id: userId } });
  await platform?.$disconnect();
  await rm(directory, { recursive: true, force: true });
  for (const key of [
    'LOCAL_SECRET_DIRECTORY',
    'LOCAL_SECRET_ENCRYPTION_KEY',
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'GOOGLE_OAUTH_REDIRECT_URI',
    'GCP_PROJECT_ID',
  ]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});
async function begin() {
  const value = await service.begin(tenantA, userId, 'primary');
  const url = new URL(value.authorizationUrl);
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('redirect_uri')).toBe(process.env.GOOGLE_OAUTH_REDIRECT_URI);
  return { state: url.searchParams.get('state') ?? '', nonce: value.nonce };
}
describe('browser-bound one-time calendar OAuth consent', () => {
  it('rejects forged state and wrong-browser nonce before exchanging credentials', async () => {
    const request = await begin();
    await expect(
      service.callback(randomBytes(32).toString('base64url'), 'code', request.nonce),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.callback(request.state, 'code', randomBytes(32).toString('base64url')),
    ).rejects.toMatchObject({ status: 403 });
    expect(exchange).not.toHaveBeenCalled();
    await service.callback(request.state, 'code', request.nonce);
    await expect(service.callback(request.state, 'code', request.nonce)).rejects.toMatchObject({
      status: 403,
    });
    expect(exchange).toHaveBeenCalledTimes(1);
  });
  it('stores encrypted tenant-bound credentials, hides references and denies cross-tenant disconnect', async () => {
    const request = await begin();
    await service.callback(request.state, 'code', request.nonce);
    const page = await service.list(tenantA);
    expect(JSON.stringify(page)).not.toMatch(/refresh-token|client-secret|credentialsRef|local:/);
    const id = page.items[0]?.id ?? '';
    expect((await service.list(tenantB)).items).toHaveLength(0);
    await expect(service.disconnect(tenantB, userId, id)).rejects.toMatchObject({ status: 404 });
    const stored = await withTenant(runtime, tenantA, (tx) =>
      tx.integration.findFirstOrThrow({ where: { id } }),
    );
    const encrypted = await readFile(
      join(directory, `${tenantA}-google_calendar-${stored.credentialsRef?.split(':')[3]}.json`),
      'utf8',
    );
    expect(encrypted).not.toMatch(/synthetic-refresh-token|synthetic-client-secret/);
    await service.disconnect(tenantA, userId, id);
    expect(
      await withTenant(runtime, tenantA, (tx) =>
        tx.integration.findFirstOrThrow({ where: { id } }),
      ),
    ).toMatchObject({ status: 'DISCONNECTED', credentialsRef: null });
  });
  it('rejects permission revoked during consent and burns the state once', async () => {
    const request = await begin();
    await withTenant(runtime, tenantA, (tx) =>
      tx.tenantUser.updateMany({ where: { tenantId: tenantA, userId }, data: { role: 'STAFF' } }),
    );
    try {
      await expect(service.callback(request.state, 'code', request.nonce)).rejects.toMatchObject({
        status: 403,
      });
      expect(exchange).not.toHaveBeenCalled();
    } finally {
      await withTenant(runtime, tenantA, (tx) =>
        tx.tenantUser.updateMany({ where: { tenantId: tenantA, userId }, data: { role: 'OWNER' } }),
      );
    }
    await expect(service.callback(request.state, 'code', request.nonce)).rejects.toMatchObject({
      status: 403,
    });
  });
  it('rechecks membership after the external exchange', async () => {
    const request = await begin();
    exchange.mockImplementationOnce(async () => {
      await withTenant(runtime, tenantA, (tx) =>
        tx.tenantUser.updateMany({ where: { tenantId: tenantA, userId }, data: { role: 'STAFF' } }),
      );
      return { refreshToken: 'synthetic-refresh-token' };
    });
    try {
      await expect(service.callback(request.state, 'code', request.nonce)).rejects.toMatchObject({
        status: 403,
      });
    } finally {
      await withTenant(runtime, tenantA, (tx) =>
        tx.tenantUser.updateMany({ where: { tenantId: tenantA, userId }, data: { role: 'OWNER' } }),
      );
    }
    expect((await service.list(tenantA)).items[0]?.status).toBe('DISCONNECTED');
  });
  it('fails closed on provider consent errors without storing or exposing the error', async () => {
    const request = await begin();
    exchange.mockRejectedValueOnce(new Error('synthetic secret provider failure'));
    const result = await service
      .callback(request.state, 'code', request.nonce)
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ status: 400 });
    expect(String(result)).not.toContain('synthetic secret');
    expect((await service.list(tenantA)).items[0]?.status).toBe('DISCONNECTED');
  });
  it('keeps the active credential version unchanged when permission is revoked during rotation', async () => {
    const initial = await begin();
    await service.callback(initial.state, 'code', initial.nonce);
    const original = await withTenant(runtime, tenantA, (tx) =>
      tx.integration.findFirstOrThrow({
        where: { tenantId: tenantA, provider: 'google_calendar' },
      }),
    );
    const rotation = await begin();
    exchange.mockImplementationOnce(async () => {
      await withTenant(runtime, tenantA, (tx) =>
        tx.tenantUser.updateMany({ where: { tenantId: tenantA, userId }, data: { role: 'STAFF' } }),
      );
      return { refreshToken: 'uncommitted-replacement' };
    });
    try {
      await expect(service.callback(rotation.state, 'code', rotation.nonce)).rejects.toMatchObject({
        status: 403,
      });
    } finally {
      await withTenant(runtime, tenantA, (tx) =>
        tx.tenantUser.updateMany({ where: { tenantId: tenantA, userId }, data: { role: 'OWNER' } }),
      );
    }
    const unchanged = await withTenant(runtime, tenantA, (tx) =>
      tx.integration.findFirstOrThrow({ where: { id: original.id } }),
    );
    expect(unchanged.credentialsRef).toBe(original.credentialsRef);
    expect(
      await new IntegrationCredentialStore().read(
        tenantA,
        'google_calendar',
        unchanged.credentialsRef ?? '',
      ),
    ).toMatchObject({ refreshToken: 'synthetic-refresh-token' });
  });
});
