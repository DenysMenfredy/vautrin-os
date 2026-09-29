import {
  isWorkflowErrorRetryable,
  validateWorkflowDefinitionForActivation,
  workflowRetryDelayMs,
} from '@vautrin/contracts';
import { describe, expect, it } from 'vitest';

import {
  validateWorkflowDefinition,
  validateWorkflowFailurePolicy,
  validateWorkflowRetryPolicy,
} from './workflow-definition.js';

describe('validateWorkflowDefinition', () => {
  it('accepts ordered, uniquely identified supported steps', () => {
    expect(
      validateWorkflowDefinition({
        steps: [
          { id: 'wait-before-response', type: 'wait', config: { duration: '30s' } },
          { id: 'respond', type: 'send_message', config: { channel: 'SMS' } },
        ],
      }),
    ).toEqual({
      steps: [
        { id: 'wait-before-response', type: 'wait', config: { duration: '30s' } },
        { id: 'respond', type: 'send_message', config: { channel: 'SMS' } },
      ],
    });
  });

  it.each([
    null,
    {},
    { steps: [] },
    { steps: [{ id: 'step', type: 'execute_code', config: {} }] },
    { steps: [{ id: 'step', type: 'wait', config: [] }] },
    { steps: [{ id: 'not valid', type: 'wait', config: {} }] },
    {
      steps: [
        { id: 'duplicate', type: 'wait', config: {} },
        { id: 'duplicate', type: 'end', config: {} },
      ],
    },
    { steps: [{ id: 'step', type: 'wait', config: {}, extra: true }] },
    { steps: [{ id: 'step', type: 'wait', config: {} }], extra: true },
  ])('rejects malformed or unsupported definition %#', (definition) => {
    expect(() => validateWorkflowDefinition(definition)).toThrow();
  });
});

describe('validateWorkflowDefinitionForActivation', () => {
  it('accepts a structured condition and forward branch references', () => {
    expect(
      validateWorkflowDefinitionForActivation({
        steps: [
          {
            id: 'check-status',
            type: 'condition',
            config: {
              condition: {
                all: [
                  { field: 'lead.status', operator: 'eq', value: 'QUALIFIED' },
                  { field: 'event.payload.to', operator: 'in', value: ['QUALIFIED', 'WON'] },
                ],
              },
              onTrue: 'continue',
            },
          },
          { id: 'continue', type: 'end', config: {} },
        ],
      }).steps[0],
    ).toMatchObject({ id: 'check-status', type: 'condition' });
  });

  it.each([
    { condition: { field: 'lead.status', operator: 'execute', value: 'NEW' } },
    { condition: { field: 'contact.email', operator: 'exists' } },
    { condition: { field: 'unknown.value', operator: 'exists' } },
    { condition: { field: 'lead.status', operator: 'eq' } },
    { condition: { field: 'lead.status', operator: 'exists', value: true } },
    { condition: { field: 'lead.status', operator: 'in', value: 'NEW' } },
    { condition: { all: 'not-an-array' } },
    { condition: { field: 'steps.current.output', operator: 'exists' } },
    { condition: { field: 'event.payload.to.nested', operator: 'exists' } },
  ])('rejects invalid condition configuration %#', (config) => {
    expect(() =>
      validateWorkflowDefinitionForActivation({
        steps: [
          { id: 'condition', type: 'condition', config },
          { id: 'finish', type: 'end', config: {} },
        ],
      }),
    ).toThrow();
  });

  it('rejects branch references that are missing or point backwards', () => {
    for (const onTrue of ['missing', 'prior']) {
      expect(() =>
        validateWorkflowDefinitionForActivation({
          steps: [
            { id: 'prior', type: 'end', config: {} },
            {
              id: 'condition',
              type: 'condition',
              config: {
                condition: { field: 'event.name', operator: 'exists' },
                onTrue,
              },
            },
          ],
        }),
      ).toThrow();
    }
  });
});

describe('workflow retry and failure policies', () => {
  it('normalizes conservative bounded defaults', () => {
    expect(validateWorkflowRetryPolicy({})).toEqual({
      maxAttempts: 3,
      initialDelayMs: 5_000,
      maxDelayMs: 300_000,
      retryableErrors: [],
      terminalErrors: [],
    });
    expect(validateWorkflowFailurePolicy({})).toEqual({ action: 'stop' });
  });

  it('accepts explicit exponential retry and escalation policies', () => {
    expect(
      validateWorkflowRetryPolicy({
        maxAttempts: 5,
        initialDelayMs: 250,
        maxDelayMs: 10_000,
        retryableErrors: ['provider.rate_limited', '*'],
        terminalErrors: ['provider.invalid_request'],
      }),
    ).toMatchObject({ maxAttempts: 5, retryableErrors: ['provider.rate_limited', '*'] });
    expect(validateWorkflowFailurePolicy({ action: 'human_handoff' })).toEqual({
      action: 'human_handoff',
    });
  });

  it('applies bounded exponential backoff with terminal errors taking precedence', () => {
    const policy = validateWorkflowRetryPolicy({
      maxAttempts: 4,
      initialDelayMs: 500,
      maxDelayMs: 1_500,
      retryableErrors: ['*'],
      terminalErrors: ['configuration.invalid'],
    });
    expect(workflowRetryDelayMs(1, policy)).toBe(500);
    expect(workflowRetryDelayMs(2, policy)).toBe(1_000);
    expect(workflowRetryDelayMs(4, policy)).toBe(1_500);
    expect(isWorkflowErrorRetryable('provider.timeout', policy)).toBe(true);
    expect(isWorkflowErrorRetryable('configuration.invalid', policy)).toBe(false);
  });

  it.each([
    { maxAttempts: 0 },
    { maxAttempts: 11 },
    { initialDelayMs: 99 },
    { initialDelayMs: 10_000, maxDelayMs: 9_999 },
    { retryableErrors: ['Not A Code'] },
    { retryableErrors: ['provider.failed', 'provider.failed'] },
    { terminalErrors: ['*'] },
    { other: true },
  ])('rejects invalid retry policy %#', (policy) => {
    expect(() => validateWorkflowRetryPolicy(policy)).toThrow();
  });

  it('rejects invalid failure actions and extra fields', () => {
    expect(() => validateWorkflowFailurePolicy({ action: 'continue' })).toThrow();
    expect(() => validateWorkflowFailurePolicy({ action: 'skip', extra: true })).toThrow();
  });
});
