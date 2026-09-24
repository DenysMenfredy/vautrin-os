/** Normalized, signature-verified provider input. Never expose this as an HTTP DTO. */
export interface InboundMessageInput {
  readonly conversationId: string;
  readonly provider: string;
  readonly providerEventId: string;
  readonly providerMessageId?: string;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly body: string;
  readonly correlationId?: string;
}
