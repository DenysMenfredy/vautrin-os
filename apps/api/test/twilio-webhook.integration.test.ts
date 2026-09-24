import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createPlatformClient,
  createPrismaClient,
  type PrismaClient,
  withTenant,
} from '@vautrin/database';
import twilio from 'twilio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';

const suffix = Date.now();
const accountA = `AC${'a'.repeat(32)}`;
const accountB = `AC${'b'.repeat(32)}`;
const senderA = '+15557654321';
const senderB = '+15557654322';
const customer = '+15551234567';
const secretRefA = 'VAUTRIN_TWILIO_WEBHOOK_TEST_A';
const secretRefB = 'VAUTRIN_TWILIO_WEBHOOK_TEST_B';
const authTokenA = 'local-test-auth-token-a';
const authTokenB = 'local-test-auth-token-b';
const messageSid = `SM${'c'.repeat(32)}`;

let app: INestApplication;
let baseUrl = '';
let platform: PrismaClient;
let runtime: PrismaClient;
let tenantA = '';
let tenantB = '';
let integrationA = '';
let integrationB = '';

function credentials(accountSid: string, authToken: string) {
  return JSON.stringify({
    accountSid,
    apiKeySid: `SK${'d'.repeat(32)}`,
    apiKeySecret: 'local-test-key-secret',
    webhookAuthToken: authToken,
    messagingServiceSid: `MG${'e'.repeat(32)}`,
  });
}

function webhookUrl(integrationId: string): string {
  return `https://webhooks.example.test/api/webhooks/twilio/inbound/${integrationId}`;
}

function fields(accountSid = accountA) {
  return {
    AccountSid: accountSid,
    MessageSid: messageSid,
    From: customer,
    To: senderA,
    Body: 'STOP',
  };
}

function post(
  integrationId: string,
  body: Record<string, string>,
  signature: string,
  contentType = 'application/x-www-form-urlencoded',
): Promise<Response> {
  return fetch(`${baseUrl}/api/webhooks/twilio/inbound/${integrationId}`, {
    method: 'POST',
    headers: { 'content-type': contentType, 'x-twilio-signature': signature },
    body: contentType === 'application/json' ? JSON.stringify(body) : new URLSearchParams(body),
  });
}

beforeAll(async () => {
  process.env[secretRefA] = credentials(accountA, authTokenA);
  process.env[secretRefB] = credentials(accountB, authTokenB);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0);
  baseUrl = await app.getUrl();
  platform = createPlatformClient();
  runtime = createPrismaClient();
  [tenantA, tenantB] = await Promise.all([
    platform.tenant
      .create({ data: { slug: `twilio-a-${suffix}`, name: 'Twilio A' } })
      .then((row) => row.id),
    platform.tenant
      .create({ data: { slug: `twilio-b-${suffix}`, name: 'Twilio B' } })
      .then((row) => row.id),
  ]);
  integrationA = await withTenant(runtime, tenantA, async (tx) => {
    const row = await tx.integration.create({
      data: {
        tenantId: tenantA,
        provider: 'twilio',
        category: 'MESSAGING',
        status: 'CONNECTED',
        externalAccountId: accountA,
        credentialsRef: `env:${secretRefA}`,
        configuration: { phoneNumber: senderA, messagingServiceSid: `MG${'e'.repeat(32)}` },
      },
    });
    await tx.integration.update({
      where: { id: row.id },
      data: {
        configuration: {
          phoneNumber: senderA,
          messagingServiceSid: `MG${'e'.repeat(32)}`,
          webhookUrl: webhookUrl(row.id),
        },
      },
    });
    return row.id;
  });
  integrationB = await withTenant(runtime, tenantB, async (tx) => {
    const row = await tx.integration.create({
      data: {
        tenantId: tenantB,
        provider: 'twilio',
        category: 'MESSAGING',
        status: 'CONNECTED',
        externalAccountId: accountB,
        credentialsRef: `env:${secretRefB}`,
        configuration: { phoneNumber: senderB, messagingServiceSid: `MG${'e'.repeat(32)}` },
      },
    });
    await tx.integration.update({
      where: { id: row.id },
      data: {
        configuration: {
          phoneNumber: senderB,
          messagingServiceSid: `MG${'e'.repeat(32)}`,
          webhookUrl: webhookUrl(row.id),
        },
      },
    });
    return row.id;
  });
});

afterAll(async () => {
  delete process.env[secretRefA];
  delete process.env[secretRefB];
  await runtime?.$disconnect();
  await platform?.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await platform?.$disconnect();
  await app?.close();
});

describe('Twilio signed inbound webhook', () => {
  it('rejects unsigned, invalid, disabled and cross-integration requests', async () => {
    expect((await post(integrationA, fields(), 'forged')).status).toBe(403);
    expect((await post(crypto.randomUUID(), fields(), 'forged')).status).toBe(403);
    expect((await post(integrationA, fields(), 'forged', 'application/json')).status).toBe(415);
    const wrongRouteSignature = twilio.getExpectedTwilioSignature(
      authTokenA,
      webhookUrl(integrationA),
      fields(),
    );
    expect((await post(integrationB, fields(), wrongRouteSignature)).status).toBe(403);
    const wrongAccount = fields(accountB);
    const wrongAccountSignature = twilio.getExpectedTwilioSignature(
      authTokenA,
      webhookUrl(integrationA),
      wrongAccount,
    );
    expect((await post(integrationA, wrongAccount, wrongAccountSignature)).status).toBe(403);
    const wrongRecipient = { ...fields(), To: senderB };
    const wrongRecipientSignature = twilio.getExpectedTwilioSignature(
      authTokenA,
      webhookUrl(integrationA),
      wrongRecipient,
    );
    expect((await post(integrationA, wrongRecipient, wrongRecipientSignature)).status).toBe(403);
    const malformed = { ...fields(), To: 'not-a-phone-number' };
    const malformedSignature = twilio.getExpectedTwilioSignature(
      authTokenA,
      webhookUrl(integrationA),
      malformed,
    );
    expect((await post(integrationA, malformed, malformedSignature)).status).toBe(400);
    await withTenant(runtime, tenantA, (tx) =>
      tx.integration.update({ where: { id: integrationA }, data: { status: 'DISCONNECTED' } }),
    );
    try {
      expect((await post(integrationA, fields(), wrongRouteSignature)).status).toBe(403);
    } finally {
      await withTenant(runtime, tenantA, (tx) =>
        tx.integration.update({ where: { id: integrationA }, data: { status: 'CONNECTED' } }),
      );
    }
    expect(await withTenant(runtime, tenantA, (tx) => tx.message.count())).toBe(0);
    expect(await withTenant(runtime, tenantB, (tx) => tx.message.count())).toBe(0);
  });

  it('commits one contact, conversation, message, event, audit and opt-out despite webhook replay', async () => {
    const payload = fields();
    const signature = twilio.getExpectedTwilioSignature(
      authTokenA,
      webhookUrl(integrationA),
      payload,
    );
    expect((await post(integrationA, payload, signature)).status).toBe(204);
    expect((await post(integrationA, payload, signature)).status).toBe(204);
    const state = await withTenant(runtime, tenantA, async (tx) => ({
      contacts: await tx.contact.findMany(),
      conversations: await tx.conversation.findMany(),
      messages: await tx.message.findMany(),
      events: await tx.event.findMany({ where: { name: 'message.received' } }),
      preferences: await tx.contactChannelPreference.findMany(),
      audits: await tx.auditLog.findMany(),
    }));
    expect(state.contacts).toHaveLength(1);
    expect(state.conversations).toHaveLength(1);
    expect(state.messages).toHaveLength(1);
    expect(state.events).toHaveLength(1);
    expect(state.preferences).toHaveLength(1);
    expect(state.preferences[0]?.optedOutAt).not.toBeNull();
    expect(state.audits.map((row) => row.action)).toContain('message.inbound.recorded');
    expect(await withTenant(runtime, tenantB, (tx) => tx.message.count())).toBe(0);
  });
});
