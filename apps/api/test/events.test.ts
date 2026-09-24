import {
  leadCreatedEvent,
  leadStatusChangedEvent,
  messageReceivedEvent,
  parseDomainEvent,
} from '@vautrin/contracts';
import { describe, expect, it } from 'vitest';

const leadId = '0192f1a0-1b2c-7d3e-8f40-51627384950a';
const contactId = '0192f1a0-1b2c-7d3e-8f40-51627384950b';

describe('versioned event schema (VOS-080)', () => {
  it('accepts both lead events at version 1', () => {
    expect(parseDomainEvent(leadCreatedEvent(leadId, contactId))).toEqual(
      leadCreatedEvent(leadId, contactId),
    );
    expect(parseDomainEvent(leadStatusChangedEvent(leadId, 'NEW', 'CONTACTED'))).toEqual(
      leadStatusChangedEvent(leadId, 'NEW', 'CONTACTED'),
    );
  });

  it('accepts the versioned inbound-message event', () => {
    const event = messageReceivedEvent(leadId, contactId, leadId);
    expect(parseDomainEvent(event)).toEqual(event);
  });

  it('rejects unknown versions and malformed payloads', () => {
    expect(() =>
      parseDomainEvent({ ...leadCreatedEvent(leadId, contactId), version: 2 }),
    ).toThrow();
    expect(() => parseDomainEvent(leadCreatedEvent('other-tenant', contactId))).toThrow();
    expect(() =>
      parseDomainEvent({
        name: 'lead.status_changed',
        version: 1,
        payload: { leadId, from: 'NEW', to: 'UNKNOWN' },
      }),
    ).toThrow();
  });
});
