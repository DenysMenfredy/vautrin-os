import twilio from 'twilio';

import type {
  InboundWebhookRequest,
  MessagingProvider,
  NormalizedInboundMessage,
  SendTextInput,
  SendTextResult,
} from './messaging-provider.js';
import { MessagingProviderError } from './messaging-provider.js';

const ACCOUNT_SID = /^AC[0-9a-f]{32}$/i;
const KEY_SID = /^SK[0-9a-f]{32}$/i;
const SERVICE_SID = /^MG[0-9a-f]{32}$/i;
const MESSAGE_SID = /^SM[0-9a-f]{32}$/i;
const PHONE = /^\+[1-9]\d{1,14}$/;

/** One credential set and Messaging Service per tenant Twilio subaccount. */
export interface TwilioCredentials {
  readonly accountSid: string;
  readonly apiKeySid: string;
  readonly apiKeySecret: string;
  /** Twilio signs webhooks with the account Auth Token, not the API key. */
  readonly webhookAuthToken: string;
  readonly messagingServiceSid: string;
}

export interface TwilioCredentialResolver {
  /** Resolve secrets from the integration's credentialsRef, never from client input. */
  resolve(tenantId: string, integrationId: string): Promise<TwilioCredentials>;
}

type TwilioClient = Pick<ReturnType<typeof twilio>, 'messages'>;
type ClientFactory = (credentials: TwilioCredentials) => TwilioClient;

/** The only module that imports the Twilio SDK. */
export class TwilioMessagingProvider implements MessagingProvider {
  constructor(
    private readonly credentials: TwilioCredentialResolver,
    private readonly clientFactory: ClientFactory = (credentials) =>
      twilio(credentials.apiKeySid, credentials.apiKeySecret, {
        accountSid: credentials.accountSid,
      }),
  ) {}

  async sendText(input: SendTextInput): Promise<SendTextResult> {
    if (!PHONE.test(input.to) || !input.body.trim() || !input.idempotencyKey.trim()) {
      throw new MessagingProviderError('invalid_send_input');
    }
    const credentials = await this.credentials.resolve(input.tenantId, input.integrationId);
    assertCredentials(credentials);
    try {
      const message = await this.clientFactory(credentials).messages.create({
        messagingServiceSid: credentials.messagingServiceSid,
        to: input.to,
        body: input.body,
        ...(input.statusCallbackUrl ? { statusCallback: input.statusCallbackUrl } : {}),
      });
      if (!MESSAGE_SID.test(message.sid)) {
        throw new MessagingProviderError('invalid_send_response');
      }
      return {
        provider: 'twilio',
        providerMessageId: message.sid,
        status: normalizeStatus(message.status),
      };
    } catch (error) {
      if (error instanceof MessagingProviderError) throw error;
      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'number'
          ? String(error.code)
          : 'send_unknown';
      // A timed-out create may have succeeded. Callers must not blindly retry
      // an unknown result because Twilio Message create has no idempotency key.
      throw new MessagingProviderError(code);
    }
  }

  validateInboundWebhook(input: InboundWebhookRequest, authToken: string): boolean {
    if (!authToken || !input.signature || !input.url.startsWith('https://')) return false;
    return twilio.validateRequest(authToken, input.signature, input.url, { ...input.fields });
  }

  normalizeInboundWebhook(fields: Readonly<Record<string, string>>): NormalizedInboundMessage {
    const accountSid = fields.AccountSid;
    const messageSid = fields.MessageSid;
    const fromAddress = fields.From;
    const toAddress = fields.To;
    const body = fields.Body;
    if (
      !accountSid ||
      !ACCOUNT_SID.test(accountSid) ||
      !messageSid ||
      !MESSAGE_SID.test(messageSid) ||
      !fromAddress ||
      !PHONE.test(fromAddress) ||
      !toAddress ||
      !PHONE.test(toAddress) ||
      typeof body !== 'string' ||
      !body.trim()
    ) {
      throw new MessagingProviderError('invalid_inbound_payload');
    }
    return {
      provider: 'twilio',
      providerEventId: messageSid,
      providerMessageId: messageSid,
      providerAccountId: accountSid,
      fromAddress,
      toAddress,
      body,
      channel: 'SMS',
    };
  }
}

function assertCredentials(credentials: TwilioCredentials): void {
  if (
    !ACCOUNT_SID.test(credentials.accountSid) ||
    !KEY_SID.test(credentials.apiKeySid) ||
    !credentials.apiKeySecret ||
    !credentials.webhookAuthToken ||
    !SERVICE_SID.test(credentials.messagingServiceSid)
  ) {
    throw new MessagingProviderError('invalid_credentials');
  }
}

function normalizeStatus(status: string): SendTextResult['status'] {
  switch (status) {
    case 'accepted':
    case 'scheduled':
    case 'queued':
      return 'QUEUED';
    case 'sending':
      return 'SENDING';
    case 'sent':
      return 'SENT';
    case 'delivered':
      return 'DELIVERED';
    case 'failed':
    case 'undelivered':
      return 'FAILED';
    default:
      throw new MessagingProviderError('invalid_send_response');
  }
}
