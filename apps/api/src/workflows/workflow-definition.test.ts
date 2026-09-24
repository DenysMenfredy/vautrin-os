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
