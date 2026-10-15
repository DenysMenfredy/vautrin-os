import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export type CredentialProvider = 'twilio' | 'google_calendar' | 'openai';
export interface CredentialStore {
  read(
    tenantId: string,
    provider: CredentialProvider,
    reference: string,
  ): Promise<Record<string, unknown>>;
  write(
    tenantId: string,
    provider: CredentialProvider,
    value: Readonly<Record<string, unknown>>,
  ): Promise<string>;
}
export class CredentialStoreError extends Error {
  constructor() {
    super('integration_unavailable');
    this.name = 'CredentialStoreError';
  }
}

/** Tenant-bound Secret Manager, or encrypted local development files. No plaintext DB secrets. */
export class IntegrationCredentialStore implements CredentialStore {
  constructor(
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly http: typeof fetch = fetch,
  ) {}

  async read(
    tenantId: string,
    provider: CredentialProvider,
    reference: string,
  ): Promise<Record<string, unknown>> {
    validateTenant(tenantId);
    const prefix =
      provider === 'google_calendar'
        ? 'VAUTRIN_GOOGLE_CALENDAR_'
        : provider === 'twilio'
          ? 'VAUTRIN_TWILIO_'
          : 'VAUTRIN_OPENAI_';
    const localVersion = reference.startsWith(`local:${tenantId}:${provider}:`)
      ? reference.slice(`local:${tenantId}:${provider}:`.length)
      : '';
    const gcpVersion = reference.startsWith(`gcp:${tenantId}:${provider}:`)
      ? reference.slice(`gcp:${tenantId}:${provider}:`.length)
      : '';
    let raw: string;
    if (reference.startsWith('env:')) {
      const name = reference.slice(4);
      if (!new RegExp(`^${prefix}[A-Z0-9_]+$`).test(name)) throw new CredentialStoreError();
      raw = this.environment[name] ?? '';
    } else if (
      (reference === `local:${tenantId}:${provider}` || /^[a-f0-9]{32}$/.test(localVersion)) &&
      this.environment.NODE_ENV !== 'production'
    ) {
      const { directory, key } = this.localConfiguration();
      try {
        const envelope = JSON.parse(
          await readFile(
            join(
              directory,
              `${tenantId}-${provider}${localVersion ? `-${localVersion}` : ''}.json`,
            ),
            'utf8',
          ),
        ) as { iv: string; tag: string; ciphertext: string };
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'), {
          authTagLength: 16,
        });
        decipher.setAAD(Buffer.from(reference));
        decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
        raw = Buffer.concat([
          decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
          decipher.final(),
        ]).toString('utf8');
      } catch {
        throw new CredentialStoreError();
      }
    } else if (
      reference === `gcp:${tenantId}:${provider}` ||
      /^[1-9][0-9]{0,19}$/.test(gcpVersion)
    ) {
      const resource = this.resource(tenantId, provider);
      const data = await this.gcp(`${resource}/versions/${gcpVersion || 'latest'}:access`, 'GET');
      const payload = object(data.payload);
      raw =
        typeof payload.data === 'string'
          ? Buffer.from(payload.data, 'base64').toString('utf8')
          : '';
    } else throw new CredentialStoreError();
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value as Record<string, unknown>;
    } catch {
      throw new CredentialStoreError();
    }
  }

  async write(
    tenantId: string,
    provider: CredentialProvider,
    value: Readonly<Record<string, unknown>>,
  ): Promise<string> {
    validateTenant(tenantId);
    if (this.environment.GCP_PROJECT_ID) {
      const resource = this.resource(tenantId, provider);
      await this.gcp(
        `projects/${this.environment.GCP_PROJECT_ID}/secrets?secretId=vautrin-tenant-${tenantId}-${provider}`,
        'POST',
        { replication: { automatic: {} } },
        true,
      );
      const created = await this.gcp(`${resource}:addVersion`, 'POST', {
        payload: { data: Buffer.from(JSON.stringify(value)).toString('base64') },
      });
      const match =
        typeof created.name === 'string'
          ? created.name.match(
              new RegExp(
                `/secrets/vautrin-tenant-${tenantId}-${provider}/versions/([1-9][0-9]{0,19})$`,
              ),
            )
          : null;
      if (!match?.[1]) throw new CredentialStoreError();
      return `gcp:${tenantId}:${provider}:${match[1]}`;
    }
    if (this.environment.NODE_ENV === 'production') throw new CredentialStoreError();
    const { directory, key } = this.localConfiguration();
    const version = randomBytes(16).toString('hex');
    const reference = `local:${tenantId}:${provider}:${version}`;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(reference));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, `${tenantId}-${provider}-${version}.json`);
    const temporary = `${file}.${randomBytes(8).toString('hex')}`;
    await writeFile(
      temporary,
      JSON.stringify({
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      }),
      { mode: 0o600, flag: 'wx' },
    );
    await rename(temporary, file);
    return reference;
  }

  private localConfiguration(): { directory: string; key: Buffer } {
    const directory = this.environment.LOCAL_SECRET_DIRECTORY ?? '';
    const encoded = this.environment.LOCAL_SECRET_ENCRYPTION_KEY ?? '';
    if (!isAbsolute(directory) || !/^[0-9a-f]{64}$/i.test(encoded))
      throw new CredentialStoreError();
    return { directory, key: Buffer.from(encoded, 'hex') };
  }
  private resource(tenantId: string, provider: CredentialProvider): string {
    const project = this.environment.GCP_PROJECT_ID;
    if (!project || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project))
      throw new CredentialStoreError();
    return `projects/${project}/secrets/vautrin-tenant-${tenantId}-${provider}`;
  }
  private async gcp(
    resource: string,
    method: 'GET' | 'POST',
    body?: unknown,
    allowConflict = false,
  ): Promise<Record<string, unknown>> {
    try {
      const identity = await this.http(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5_000) },
      );
      if (!identity.ok) throw new CredentialStoreError();
      const token = object(await identity.json()).access_token;
      if (typeof token !== 'string') throw new CredentialStoreError();
      const response = await this.http(`https://secretmanager.googleapis.com/v1/${resource}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (allowConflict && response.status === 409) return {};
      if (!response.ok) throw new CredentialStoreError();
      return object(await response.json());
    } catch {
      throw new CredentialStoreError();
    }
  }
}
function validateTenant(value: string): void {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value))
    throw new CredentialStoreError();
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
