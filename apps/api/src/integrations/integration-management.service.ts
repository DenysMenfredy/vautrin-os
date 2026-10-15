import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { roleHasCapability } from '@vautrin/auth';
import { type Environment, redisTlsOptions } from '@vautrin/config';
import type { IntegrationPage, IntegrationSummary } from '@vautrin/contracts';
import {
  type GoogleConsentConfiguration,
  GoogleOAuthConsentProvider,
  IntegrationCredentialStore,
} from '@vautrin/integrations';
import { Redis } from 'ioredis';
import { buildPage, cursorFilter, decodeCursor } from '../common/cursor-page.js';
import { ENVIRONMENT } from '../config/environment.module.js';
import { DatabaseService } from '../database/database.service.js';

interface ConsentState {
  tenantId: string;
  userId: string;
  nonceHash: string;
  verifier: string;
  calendarId: string;
}
@Injectable()
export class IntegrationManagementService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly secrets = new IntegrationCredentialStore();
  constructor(
    private readonly database: DatabaseService,
    private readonly consent: GoogleOAuthConsentProvider,
    @Inject(ENVIRONMENT) environment: Environment,
  ) {
    this.redis = new Redis(environment.REDIS_URL, {
      ...redisTlsOptions(environment.REDIS_URL),
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
  }
  onModuleDestroy() {
    this.redis.disconnect();
  }
  list(tenantId: string, limit = 25, cursorValue?: string): Promise<IntegrationPage> {
    const cursor = decodeCursor(cursorValue);
    return this.database.withTenant(tenantId, async (tx) => {
      const rows = await tx.integration.findMany({
        where: { tenantId, ...(cursor ? { AND: [cursorFilter(cursor)] } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      return buildPage(rows, limit, (row) => ({
        id: row.id,
        provider: row.provider,
        category: row.category,
        status: row.status,
        connectedAt: row.connectedAt?.toISOString() ?? null,
        configuration: publicConfiguration(row.configuration),
      }));
    });
  }
  async disconnect(tenantId: string, userId: string, integrationId: string): Promise<void> {
    await this.database.withTenant(tenantId, async (tx) => {
      const changed = await tx.integration.updateMany({
        where: { id: integrationId, tenantId },
        data: { status: 'DISCONNECTED', disconnectedAt: new Date(), credentialsRef: null },
      });
      if (!changed.count) throw new NotFoundException('Integration not found.');
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: 'USER',
          actorId: userId,
          action: 'integration.disconnected',
          resourceType: 'integration',
          resourceId: integrationId,
        },
      });
    });
  }
  async begin(
    tenantId: string,
    userId: string,
    calendarId: string,
  ): Promise<{ authorizationUrl: string; nonce: string }> {
    const config = this.configuration();
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    await this.redis.set(
      `vautrin:oauth:${hash(state)}`,
      JSON.stringify({
        tenantId,
        userId,
        calendarId,
        nonceHash: hash(nonce),
        verifier,
      } satisfies ConsentState),
      'EX',
      600,
    );
    return {
      authorizationUrl: this.consent.authorizationUrl(
        config,
        state,
        createHash('sha256').update(verifier).digest('base64url'),
      ),
      nonce,
    };
  }
  async callback(state: string, code: string, nonce: string): Promise<void> {
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(state) ||
      !/^[A-Za-z0-9_-]{43}$/.test(nonce) ||
      !code ||
      code.length > 4096
    )
      throw new ForbiddenException('Invalid or expired calendar connection request.');
    const key = `vautrin:oauth:${hash(state)}`;
    const stored = await this.redis.get(key);
    if (!stored) throw new ForbiddenException('Invalid or expired calendar connection request.');
    const input = JSON.parse(stored) as ConsentState;
    if (hash(nonce) !== input.nonceHash || (await this.redis.getdel(key)) !== stored)
      throw new ForbiddenException('Invalid or expired calendar connection request.');
    const member = await this.database.withTenant(input.tenantId, (tx) =>
      tx.tenantUser.findFirst({
        where: {
          tenantId: input.tenantId,
          userId: input.userId,
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
        },
      }),
    );
    if (!member || !roleHasCapability(member.role, 'integration.manage'))
      throw new ForbiddenException('Calendar connection permission was revoked.');
    const config = this.configuration();
    let tokens: { refreshToken: string };
    try {
      tokens = await this.consent.exchange(config, code, input.verifier, input.calendarId);
    } catch {
      throw new BadRequestException('Calendar authorization failed. Start the connection again.');
    }
    const reference = await this.secrets.write(input.tenantId, 'google_calendar', {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: tokens.refreshToken,
    });
    await this.database.withTenant(input.tenantId, async (tx) => {
      const current = await tx.tenantUser.findFirst({
        where: {
          tenantId: input.tenantId,
          userId: input.userId,
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
        },
      });
      if (!current || !roleHasCapability(current.role, 'integration.manage'))
        throw new ForbiddenException('Calendar connection permission was revoked.');
      const existing = await tx.integration.findFirst({
        where: { tenantId: input.tenantId, provider: 'google_calendar', category: 'CALENDAR' },
        orderBy: { createdAt: 'asc' },
      });
      const data = {
        status: 'CONNECTED' as const,
        connectedAt: new Date(),
        disconnectedAt: null,
        credentialsRef: reference,
        configuration: { calendarId: input.calendarId },
        externalAccountId: input.calendarId,
        healthError: null,
      };
      const integration = existing
        ? await tx.integration.update({
            where: { id: existing.id, tenantId: input.tenantId },
            data,
          })
        : await tx.integration.create({
            data: {
              tenantId: input.tenantId,
              provider: 'google_calendar',
              category: 'CALENDAR',
              ...data,
            },
          });
      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorType: 'USER',
          actorId: input.userId,
          action: 'integration.google_calendar.connected',
          resourceType: 'integration',
          resourceId: integration.id,
        },
      });
    });
  }
  private configuration(): GoogleConsentConfiguration {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? '';
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI ?? '';
    if (!clientId || !clientSecret || !redirectUri)
      throw new BadRequestException('Google Calendar OAuth is not configured.');
    let url: URL;
    try {
      url = new URL(redirectUri);
    } catch {
      throw new BadRequestException('Google Calendar OAuth is not configured.');
    }
    if (
      url.protocol !== 'https:' &&
      !(
        process.env.NODE_ENV !== 'production' &&
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)
      )
    )
      throw new BadRequestException('Google Calendar OAuth redirect is not configured.');
    return { clientId, clientSecret, redirectUri };
  }
}
function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function publicConfiguration(value: unknown): IntegrationSummary['configuration'] {
  const row =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    Object.entries(row).filter(
      ([key, item]) =>
        ['calendarId', 'phoneNumber', 'messagingServiceSid', 'webhookUrl'].includes(key) &&
        typeof item === 'string',
    ),
  );
}
