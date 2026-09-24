import twilio from 'twilio';
import { describe, expect, it, vi } from 'vitest';

import {
  type TwilioCredentials,
  TwilioMessagingProvider,
} from '../src/twilio-messaging.provider.js';

const credentials: TwilioCredentials = {
  accountSid: `AC${'a'.repeat(32)}`,
  apiKeySid: `SK${'b'.repeat(32)}`,
  apiKeySecret: 'secret-api-key',
  webhookAuthToken: 'secret-auth-token',
  messagingServiceSid: `MG${'c'.repeat(32)}`,
};
const resolver = { resolve: vi.fn().mockResolvedValue(credentials) };
const url = 'https://example.test/api/webhooks/twilio/inbound';
const fields = {
  AccountSid: credentials.accountSid,
  MessageSid: `SM${'d'.repeat(32)}`,
  From: '+15551234567',
  To: '+15557654321',
  Body: 'STOP',
};

describe('Twilio messaging adapter', () => {
  it('validates the exact form parameters and normalizes a signed inbound SMS', () => {
    const provider = new TwilioMessagingProvider(resolver);
    const signature = twilio.getExpectedTwilioSignature(credentials.webhookAuthToken, url, fields);
    expect(
      provider.validateInboundWebhook({ url, signature, fields }, credentials.webhookAuthToken),
    ).toBe(true);
    expect(
      provider.validateInboundWebhook(
        { url, signature, fields: { ...fields, Body: 'tampered' } },
        credentials.webhookAuthToken,
      ),
    ).toBe(false);
    expect(
      provider.validateInboundWebhook(
        { url: url.replace('https:', 'http:'), signature, fields },
        credentials.webhookAuthToken,
      ),
    ).toBe(false);
    expect(provider.normalizeInboundWebhook(fields)).toMatchObject({
      provider: 'twilio',
      providerEventId: fields.MessageSid,
      providerAccountId: credentials.accountSid,
      body: 'STOP',
      channel: 'SMS',
    });
    expect(() => provider.normalizeInboundWebhook({ ...fields, To: '+0' })).toThrow(
      'invalid_inbound_payload',
    );
  });

  it('uses a tenant credential resolver and Messaging Service for the send', async () => {
    const create = vi.fn().mockResolvedValue({ sid: `SM${'e'.repeat(32)}`, status: 'queued' });
    const provider = new TwilioMessagingProvider(
      resolver,
      () => ({ messages: { create } }) as never,
    );
    const result = await provider.sendText({
      tenantId: crypto.randomUUID(),
      integrationId: crypto.randomUUID(),
      to: '+15551234567',
      body: 'Appointment reminder',
      idempotencyKey: 'message-1',
    });
    expect(result).toMatchObject({ provider: 'twilio', status: 'QUEUED' });
    expect(create).toHaveBeenCalledWith({
      messagingServiceSid: credentials.messagingServiceSid,
      to: '+15551234567',
      body: 'Appointment reminder',
    });
  });

  it('sanitizes provider failures and never claims an uncertain send is safe to retry', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(new Error('secret-api-key could be in a transport error'));
    const provider = new TwilioMessagingProvider(
      resolver,
      () => ({ messages: { create } }) as never,
    );
    const input = {
      tenantId: crypto.randomUUID(),
      integrationId: crypto.randomUUID(),
      to: '+15551234567',
      body: 'hello',
      idempotencyKey: 'message-2',
    };
    const error = await provider.sendText(input).catch((value: unknown) => value);
    expect(String(error)).toContain('send_unknown');
    expect(String(error)).not.toContain(credentials.apiKeySecret);
  });
});
