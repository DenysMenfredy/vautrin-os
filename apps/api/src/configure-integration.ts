import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createPrismaClient, withTenant } from '@vautrin/database';
import { IntegrationCredentialStore } from '@vautrin/integrations';

/** Operator-only provisioning. Credentials are supplied through an environment variable. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'tenant-id': { type: 'string' },
      'phone-number': { type: 'string' },
      'public-api-origin': { type: 'string' },
      'credentials-env': { type: 'string' },
    },
  });
  const tenantId = values['tenant-id'] ?? '';
  const phoneNumber = values['phone-number'] ?? '';
  const secretName = values['credentials-env'] ?? '';
  if (
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(tenantId) ||
    !/^\+[1-9]\d{7,14}$/.test(phoneNumber) ||
    !/^VAUTRIN_TWILIO_[A-Z0-9_]+$/.test(secretName)
  )
    throw new Error('invalid_arguments');
  const origin = new URL(values['public-api-origin'] ?? '');
  if (origin.origin !== origin.href.replace(/\/$/, '') || origin.protocol !== 'https:')
    throw new Error('public_origin_must_be_https');
  const secret: unknown = JSON.parse(process.env[secretName] ?? '');
  if (!secret || typeof secret !== 'object' || Array.isArray(secret))
    throw new Error('invalid_credentials');
  const fields = secret as Record<string, unknown>;
  if (
    typeof fields.accountSid !== 'string' ||
    !/^AC[0-9a-f]{32}$/i.test(fields.accountSid) ||
    typeof fields.apiKeySid !== 'string' ||
    !/^SK[0-9a-f]{32}$/i.test(fields.apiKeySid) ||
    typeof fields.messagingServiceSid !== 'string' ||
    !/^MG[0-9a-f]{32}$/i.test(fields.messagingServiceSid) ||
    typeof fields.apiKeySecret !== 'string' ||
    !fields.apiKeySecret ||
    typeof fields.webhookAuthToken !== 'string' ||
    !fields.webhookAuthToken
  )
    throw new Error('invalid_credentials');
  const prisma = createPrismaClient();
  try {
    const prior = await withTenant(prisma, tenantId, (tx) =>
      tx.integration.findFirst({ where: { tenantId, provider: 'twilio', category: 'MESSAGING' } }),
    );
    const id = prior?.id ?? randomUUID();
    const credentialsRef = await new IntegrationCredentialStore().write(tenantId, 'twilio', fields);
    const webhookUrl = `${origin.origin}/${process.env.API_GLOBAL_PREFIX ?? 'api'}/webhooks/twilio/inbound/${id}`;
    await withTenant(prisma, tenantId, async (tx) => {
      const data = {
        credentialsRef,
        externalAccountId: String(fields.accountSid),
        configuration: {
          phoneNumber,
          messagingServiceSid: String(fields.messagingServiceSid),
          webhookUrl,
        },
        status: 'CONNECTED' as const,
        connectedAt: new Date(),
      };
      if (prior) await tx.integration.update({ where: { id, tenantId }, data });
      else
        await tx.integration.create({
          data: { id, tenantId, provider: 'twilio', category: 'MESSAGING', ...data },
        });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: 'SYSTEM',
          actorLabel: 'operator',
          action: 'integration.twilio.configured',
          resourceType: 'integration',
          resourceId: id,
        },
      });
    });
    process.stdout.write(JSON.stringify({ integrationId: id, webhookUrl }) + '\n');
  } finally {
    await prisma.$disconnect();
  }
}
main().catch(() => {
  process.stderr.write(
    'Integration provisioning failed. Check arguments, environment credentials, secret-store configuration, and database access.\n',
  );
  process.exitCode = 1;
});
