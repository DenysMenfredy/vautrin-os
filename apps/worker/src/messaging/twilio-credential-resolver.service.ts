import { Injectable } from '@nestjs/common';
import {
  IntegrationCredentialStore,
  MessagingProviderError,
  type TwilioCredentialResolver,
  type TwilioCredentials,
} from '@vautrin/integrations';

import { DatabaseService } from '../database/database.service.js';

const ACCOUNT_SID = /^AC[0-9a-f]{32}$/i;
const KEY_SID = /^SK[0-9a-f]{32}$/i;
const SERVICE_SID = /^MG[0-9a-f]{32}$/i;

/** Worker-side tenant-scoped resolver; secret values never enter job payloads. */
@Injectable()
export class WorkerTwilioCredentialResolver implements TwilioCredentialResolver {
  constructor(private readonly database: DatabaseService) {}

  resolve(tenantId: string, integrationId: string): Promise<TwilioCredentials> {
    return this.database.withJobTenant({ tenantId }, async (tx) => {
      const integration = await tx.integration.findFirst({
        where: {
          id: integrationId,
          tenantId,
          provider: 'twilio',
          category: 'MESSAGING',
          status: { in: ['CONNECTED', 'HEALTHY', 'DEGRADED'] },
        },
      });
      if (!integration?.credentialsRef) throw new MessagingProviderError('integration_unavailable');
      let value: unknown;
      try {
        value = await new IntegrationCredentialStore().read(
          tenantId,
          'twilio',
          integration.credentialsRef,
        );
      } catch {
        throw new MessagingProviderError('integration_unavailable');
      }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new MessagingProviderError('integration_unavailable');
      }
      const fields = value as Record<string, unknown>;
      const configuration = record(integration.configuration);
      const credentials: TwilioCredentials = {
        accountSid: stringField(fields.accountSid),
        apiKeySid: stringField(fields.apiKeySid),
        apiKeySecret: stringField(fields.apiKeySecret),
        webhookAuthToken: stringField(fields.webhookAuthToken),
        messagingServiceSid: stringField(fields.messagingServiceSid),
      };
      if (
        !ACCOUNT_SID.test(credentials.accountSid) ||
        !KEY_SID.test(credentials.apiKeySid) ||
        !SERVICE_SID.test(credentials.messagingServiceSid) ||
        !credentials.apiKeySecret ||
        !credentials.webhookAuthToken ||
        credentials.accountSid !== integration.externalAccountId ||
        credentials.messagingServiceSid !== configuration.messagingServiceSid
      ) {
        throw new MessagingProviderError('integration_unavailable');
      }
      return credentials;
    });
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
