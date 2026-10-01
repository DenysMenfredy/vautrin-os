import { describe, expect, it } from 'vitest';
import { emptyStep, toDraftSteps, toWorkflowDefinition } from '../app/utils/workflow-draft';

describe('workflow draft editor', () => {
  it('builds a worker-compatible linear flow with a forward condition', () => {
    const condition = {
      ...emptyStep(1),
      id: 'check_status',
      type: 'condition' as const,
      field: 'lead.status',
      operator: 'eq' as const,
      value: 'NEW',
      onTrue: 'send_sms',
    };
    const message = {
      ...emptyStep(2),
      id: 'send_sms',
      type: 'send_message' as const,
      body: 'Thanks for contacting us.',
    };
    const end = { ...emptyStep(3), id: 'finish' };
    const definition = toWorkflowDefinition([condition, message, end]);

    expect(definition.steps).toEqual([
      {
        id: 'check_status',
        type: 'condition',
        config: {
          condition: { field: 'lead.status', operator: 'eq', value: 'NEW' },
          onTrue: 'send_sms',
        },
      },
      { id: 'send_sms', type: 'send_message', config: { body: 'Thanks for contacting us.' } },
      { id: 'finish', type: 'end', config: {} },
    ]);
    expect(toDraftSteps(definition)?.map((step) => step.id)).toEqual([
      'check_status',
      'send_sms',
      'finish',
    ]);
  });

  it('keeps advanced definitions out of the simple editor instead of dropping configuration', () => {
    expect(
      toDraftSteps({
        steps: [{ id: 'delegate', type: 'call_agent', config: { agentKey: 'receptionist' } }],
      }),
    ).toBeNull();
    expect(
      toDraftSteps({
        steps: [{ id: 'wait', type: 'wait', config: { duration: '30s', extra: true } }],
      }),
    ).toBeNull();
  });

  it('rejects invalid worker step configuration before save', () => {
    expect(() => toWorkflowDefinition([{ ...emptyStep(1), type: 'wait', duration: '0s' }])).toThrow(
      'duration',
    );
    expect(() =>
      toWorkflowDefinition([{ ...emptyStep(1), type: 'wait', duration: '999999999999999999h' }]),
    ).toThrow('too large');
    expect(() =>
      toWorkflowDefinition([
        { ...emptyStep(1), type: 'condition', field: 'private.token', value: 'secret' },
      ]),
    ).toThrow('namespace');
  });
});
