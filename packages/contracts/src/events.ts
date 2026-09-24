import { LEAD_STATUSES, type LeadStatus } from './leads.js';

/** VOS-080: the initial, versioned durable event payloads. */
export type DomainEventV1 =
  | {
      readonly name: 'lead.created';
      readonly version: 1;
      readonly payload: { readonly leadId: string; readonly contactId: string };
    }
  | {
      readonly name: 'lead.status_changed';
      readonly version: 1;
      readonly payload: {
        readonly leadId: string;
        readonly from: LeadStatus;
        readonly to: LeadStatus;
      };
    }
  | {
      readonly name: 'message.received';
      readonly version: 1;
      readonly payload: {
        readonly messageId: string;
        readonly conversationId: string;
        readonly contactId: string;
      };
    }
  | {
      readonly name: 'message.send_requested';
      readonly version: 1;
      readonly payload: {
        readonly messageId: string;
        readonly conversationId: string;
        readonly contactId: string;
      };
    };

export function leadCreatedEvent(leadId: string, contactId: string): DomainEventV1 {
  return { name: 'lead.created', version: 1, payload: { leadId, contactId } };
}

export function leadStatusChangedEvent(
  leadId: string,
  from: LeadStatus,
  to: LeadStatus,
): DomainEventV1 {
  return { name: 'lead.status_changed', version: 1, payload: { leadId, from, to } };
}

export function messageReceivedEvent(
  messageId: string,
  conversationId: string,
  contactId: string,
): DomainEventV1 {
  return {
    name: 'message.received',
    version: 1,
    payload: { messageId, conversationId, contactId },
  };
}

export function messageSendRequestedEvent(
  messageId: string,
  conversationId: string,
  contactId: string,
): DomainEventV1 {
  return {
    name: 'message.send_requested',
    version: 1,
    payload: { messageId, conversationId, contactId },
  };
}

/** Validates JSON read from the outbox before a queue consumer acts on it. */
export function parseDomainEvent(value: unknown): DomainEventV1 {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.payload)) {
    throw new Error('Unsupported event schema version or payload.');
  }
  const payload = value.payload;
  if (value.name === 'lead.created' && isUuid(payload.leadId) && isUuid(payload.contactId)) {
    return leadCreatedEvent(payload.leadId, payload.contactId);
  }
  if (
    value.name === 'lead.status_changed' &&
    isUuid(payload.leadId) &&
    isLeadStatus(payload.from) &&
    isLeadStatus(payload.to)
  ) {
    return leadStatusChangedEvent(payload.leadId, payload.from, payload.to);
  }
  if (
    value.name === 'message.received' &&
    isUuid(payload.messageId) &&
    isUuid(payload.conversationId) &&
    isUuid(payload.contactId)
  ) {
    return messageReceivedEvent(payload.messageId, payload.conversationId, payload.contactId);
  }
  if (
    value.name === 'message.send_requested' &&
    isUuid(payload.messageId) &&
    isUuid(payload.conversationId) &&
    isUuid(payload.contactId)
  ) {
    return messageSendRequestedEvent(payload.messageId, payload.conversationId, payload.contactId);
  }
  throw new Error('Unsupported event name or payload.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === 'string' && LEAD_STATUSES.some((status) => status === value);
}
