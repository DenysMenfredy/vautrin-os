import { describe, expect, it } from 'vitest';

import {
  jsonRecord,
  normalizedSmsAddress,
  parseWorkflowSendMessageStepConfig,
  stringValue,
} from './send-message-step.js';

describe('workflow send_message step configuration', () => {
  it('accepts and trims a literal message body', () => {
    expect(parseWorkflowSendMessageStepConfig({ body: '  We got your message.  ' })).toEqual({
      body: 'We got your message.',
    });
  });

  it('rejects empty, oversized, non-string, or extra configuration', () => {
    expect(() => parseWorkflowSendMessageStepConfig({ body: '  ' })).toThrow();
    expect(() => parseWorkflowSendMessageStepConfig({ body: 'x'.repeat(1601) })).toThrow();
    expect(() => parseWorkflowSendMessageStepConfig({ body: 12 })).toThrow();
    expect(() =>
      parseWorkflowSendMessageStepConfig({ body: 'hello', expression: 'unsafe' }),
    ).toThrow();
  });
});

describe('workflow message value guards', () => {
  it('accepts E.164 SMS addresses and rejects malformed values', () => {
    expect(normalizedSmsAddress(' +15551234567 ')).toBe('+15551234567');
    expect(normalizedSmsAddress('5551234567')).toBeUndefined();
  });

  it('projects JSON objects and strings without coercion', () => {
    expect(jsonRecord({ phoneNumber: '+15551234567' })).toEqual({
      phoneNumber: '+15551234567',
    });
    expect(jsonRecord(['not', 'an', 'object'])).toEqual({});
    expect(stringValue('value')).toBe('value');
    expect(stringValue(12)).toBeUndefined();
  });
});
