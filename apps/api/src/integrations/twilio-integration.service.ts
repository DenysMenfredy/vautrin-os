import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  IntegrationCredentialStore,
  type TwilioCredentialResolver,
  type TwilioCredentials,
} from '@vautrin/integrations';

import { DatabaseService } from '../database/database.service.js';

const ACCOUNT_SID = /^AC[0-9a-f]{32}$/i;
const KEY_SID = /^SK[0-9a-f]{32}$/i;
const SERVICE_SID = /^MG[0-9a-f]{32}$/i;

/**
 * First-10-customer secret boundary: credentialsRef names a tenant-specific
 * secret injected into the process environment by deployment/Secret Manager.
 * It cannot name arbitrary variables such as JWT_SECRET or DATABASE_URL.
 */
@Injectable()
export class TwilioIntegrationService implements TwilioCredentialResolver {
  constructor(private readonly database: DatabaseService) {}

  async resolve(tenantId: string, integrationId: string): Promise<TwilioCredentials> {
    const integration = await this.database.withTenant(tenantId, (tx) =>
      tx.integration.findFirst({
        where: {
          id: integrationId,
          tenantId,
          provider: 'twilio',
          category: 'MESSAGING',
          status: { in: ['CONNECTED', 'HEALTHY', 'DEGRADED'] },
        },
      }),
    );
    if (!integration?.credentialsRef) throw new ForbiddenException('Integration unavailable.');
    let value: unknown;
    try {
      value = await new IntegrationCredentialStore().read(
        tenantId,
        'twilio',
        integration.credentialsRef,
      );
    } catch {
      throw new ForbiddenException('Integration unavailable.');
    }
    if (!isRecord(value)) throw new ForbiddenException('Integration unavailable.');
    const credentials: TwilioCredentials = {
      accountSid: stringField(value.accountSid),
      apiKeySid: stringField(value.apiKeySid),
      apiKeySecret: stringField(value.apiKeySecret),
      webhookAuthToken: stringField(value.webhookAuthToken),
      messagingServiceSid: stringField(value.messagingServiceSid),
    };
    const configuration = isRecord(integration.configuration) ? integration.configuration : {};
    if (
      !ACCOUNT_SID.test(credentials.accountSid) ||
      !KEY_SID.test(credentials.apiKeySid) ||
      !SERVICE_SID.test(credentials.messagingServiceSid) ||
      !credentials.apiKeySecret ||
      !credentials.webhookAuthToken ||
      credentials.accountSid !== integration.externalAccountId ||
      credentials.messagingServiceSid !== configuration.messagingServiceSid
    ) {
      throw new ForbiddenException('Integration unavailable.');
    }
    return credentials;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
