import type { PageRequest, PageResponse } from './business.js';

export const CONVERSATION_CHANNELS = ['SMS', 'EMAIL', 'VOICE', 'WHATSAPP', 'WEB'] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];
export const CONVERSATION_STATUSES = ['OPEN', 'PENDING', 'SNOOZED', 'CLOSED'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export const MESSAGE_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];
export const MESSAGE_STATUSES = [
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export interface ConversationResponse {
  readonly id: string;
  readonly contactId: string;
  readonly leadId: string | null;
  readonly channel: ConversationChannel;
  readonly status: ConversationStatus;
  readonly subject: string | null;
  readonly assignedUserId: string | null;
  readonly lastMessageAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateConversationRequest {
  readonly contactId: string;
  readonly leadId?: string;
  readonly channel: ConversationChannel;
  readonly subject?: string;
}

export interface ListConversationsRequest extends PageRequest {
  readonly contactId?: string;
  readonly leadId?: string;
  readonly channel?: ConversationChannel;
  readonly status?: ConversationStatus;
}

export interface ChangeConversationStatusRequest {
  readonly status: ConversationStatus;
}

export type ConversationPageResponse = PageResponse<ConversationResponse>;

export interface MessageResponse {
  readonly id: string;
  readonly conversationId: string;
  readonly direction: MessageDirection;
  readonly channel: ConversationChannel;
  readonly status: MessageStatus;
  readonly body: string;
  readonly fromAddress: string | null;
  readonly toAddress: string | null;
  readonly provider: string | null;
  readonly providerMessageId: string | null;
  readonly sentAt: string | null;
  readonly deliveredAt: string | null;
  readonly failedAt: string | null;
  readonly failureReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type MessagePageResponse = PageResponse<MessageResponse>;
