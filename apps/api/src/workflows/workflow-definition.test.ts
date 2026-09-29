import { validateWorkflowDefinitionForActivation } from '@vautrin/contracts';
import { describe, expect, it } from 'vitest';

import { validateWorkflowDefinition } from './workflow-definition.js';

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
