/** SDD-08 / ADR-010: business-facing messaging contract. */
export interface SendTextInput {
  readonly tenantId: string;
  readonly integrationId: string;
  readonly to: string;
  readonly body: string;
  readonly statusCallbackUrl?: string;
  /** Stable local operation identity; persistence must enforce uniqueness. */
  readonly idempotencyKey: string;
}

export interface SendTextResult {
  readonly provider: string;
  readonly providerMessageId: string;
  readonly status: 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'FAILED';
}

export interface InboundWebhookRequest {
  /** Exact configured public URL, including its query string. */
  readonly url: string;
  readonly signature: string;
  /** All x-www-form-urlencoded parameters, unmodified. */
  readonly fields: Readonly<Record<string, string>>;
}

export interface NormalizedInboundMessage {
  readonly provider: string;
  readonly providerEventId: string;
  readonly providerMessageId: string;
  readonly providerAccountId: string;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly body: string;
  readonly channel: 'SMS';
}

export interface NormalizedMessageStatus {
  readonly providerMessageId: string;
  readonly providerAccountId: string;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly status: 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  /** Safe provider error code only; never include raw provider descriptions. */
  readonly failureReason: string | null;
}

export interface MessagingProvider {
  sendText(input: SendTextInput): Promise<SendTextResult>;
  validateInboundWebhook(input: InboundWebhookRequest, authToken: string): boolean;
  normalizeInboundWebhook(fields: Readonly<Record<string, string>>): NormalizedInboundMessage;
  normalizeStatusWebhook(fields: Readonly<Record<string, string>>): NormalizedMessageStatus;
}

/** Never include customer body or credentials in a provider error. */
export class MessagingProviderError extends Error {
  override readonly name = 'MessagingProviderError';

  constructor(
    readonly code: string,
    readonly retryable = false,
    readonly outcomeUnknown = false,
  ) {
    super(`Messaging provider operation failed: ${code}`);
  }
}
