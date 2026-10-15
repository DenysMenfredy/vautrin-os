import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CredentialStoreError, IntegrationCredentialStore } from '../src/credential-store.js';

describe('tenant-bound encrypted local credentials', () => {
  it('round-trips without plaintext storage and rejects another tenant, provider, or encryption key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vautrin-secrets-'));
    try {
      const tenantId = randomUUID();
      const other = randomUUID();
      const environment = {
        NODE_ENV: 'development',
        LOCAL_SECRET_DIRECTORY: directory,
        LOCAL_SECRET_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      };
      const store = new IntegrationCredentialStore(environment);
      const reference = await store.write(tenantId, 'google_calendar', {
        refreshToken: 'synthetic-sensitive-token',
      });
      expect(
        await readFile(
          join(directory, `${tenantId}-google_calendar-${reference.split(':')[3]}.json`),
          'utf8',
        ),
      ).not.toContain('synthetic-sensitive-token');
      expect(await store.read(tenantId, 'google_calendar', reference)).toEqual({
        refreshToken: 'synthetic-sensitive-token',
      });
      const rotated = await store.write(tenantId, 'google_calendar', {
        refreshToken: 'replacement-token',
      });
      expect(rotated).not.toBe(reference);
      expect(await store.read(tenantId, 'google_calendar', reference)).toEqual({
        refreshToken: 'synthetic-sensitive-token',
      });
      await expect(store.read(other, 'google_calendar', reference)).rejects.toThrow(
        'integration_unavailable',
      );
      await expect(store.read(tenantId, 'twilio', reference)).rejects.toThrow(
        'integration_unavailable',
      );
      await expect(
        new IntegrationCredentialStore({
          ...environment,
          LOCAL_SECRET_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        }).read(tenantId, 'google_calendar', reference),
      ).rejects.toThrow('integration_unavailable');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it.each([0, 4, 8, 12, 13, 14, 15, 17])('rejects a %i-byte authentication tag', async (length) => {
    const directory = await mkdtemp(join(tmpdir(), 'vautrin-secrets-tag-'));
    try {
      const tenantId = randomUUID();
      const store = new IntegrationCredentialStore({
        NODE_ENV: 'development',
        LOCAL_SECRET_DIRECTORY: directory,
        LOCAL_SECRET_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      });
      const reference = await store.write(tenantId, 'google_calendar', {
        refreshToken: 'synthetic-sensitive-token',
      });
      const file = join(directory, `${tenantId}-google_calendar-${reference.split(':')[3]}.json`);
      const envelope = JSON.parse(await readFile(file, 'utf8')) as {
        iv: string;
        tag: string;
        ciphertext: string;
      };
      const tag = Buffer.from(envelope.tag, 'base64');
      expect(tag.length).toBe(16);
      envelope.tag = (
        length < tag.length
          ? tag.subarray(0, length)
          : Buffer.concat([tag, Buffer.alloc(length - tag.length)])
      ).toString('base64');
      await writeFile(file, JSON.stringify(envelope));
      await expect(store.read(tenantId, 'google_calendar', reference)).rejects.toBeInstanceOf(
        CredentialStoreError,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('pins the returned Secret Manager version and rejects another tenant before any network call', async () => {
    const tenantId = randomUUID();
    const resource = `projects/vautrin-test/secrets/vautrin-tenant-${tenantId}-twilio`;
    const http = vi.fn<typeof fetch>((input) => {
      const url = String(input);
      return Promise.resolve(
        new Response(
          JSON.stringify(
            url.includes('metadata.google')
              ? { access_token: 'synthetic-access' }
              : url.endsWith(':addVersion')
                ? { name: `${resource}/versions/7` }
                : url.endsWith(':access')
                  ? { payload: { data: Buffer.from('{"secret":"synthetic"}').toString('base64') } }
                  : {},
          ),
        ),
      );
    });
    const store = new IntegrationCredentialStore(
      { NODE_ENV: 'production', GCP_PROJECT_ID: 'vautrin-test' },
      http,
    );
    const reference = await store.write(tenantId, 'twilio', { secret: 'synthetic' });
    expect(reference).toBe(`gcp:${tenantId}:twilio:7`);
    expect(await store.read(tenantId, 'twilio', reference)).toEqual({ secret: 'synthetic' });
    expect(http.mock.calls.some((call) => String(call[0]).endsWith('/versions/7:access'))).toBe(
      true,
    );
    const calls = http.mock.calls.length;
    await expect(store.read(randomUUID(), 'twilio', reference)).rejects.toThrow(
      'integration_unavailable',
    );
    expect(http).toHaveBeenCalledTimes(calls);
  });
  it('rejects arbitrary environment names and production local storage', async () => {
    const store = new IntegrationCredentialStore({ NODE_ENV: 'production', JWT_SECRET: 'secret' });
    await expect(store.read(randomUUID(), 'twilio', 'env:JWT_SECRET')).rejects.toThrow(
      'integration_unavailable',
    );
    await expect(store.write(randomUUID(), 'twilio', {})).rejects.toThrow(
      'integration_unavailable',
    );
  });
});
