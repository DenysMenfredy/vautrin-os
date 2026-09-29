import { describe, expect, it } from 'vitest';

import {
  redactAgentModelConfiguration,
  validateAgentConfiguration,
  validateAgentInstructions,
  validateAllowedTools,
} from './agent-definition.js';

describe('agent configuration validation', () => {
  it('rejects embedded secrets and unsafe tool identifiers', () => {
    expect(() =>
      validateAgentConfiguration({ nested: { apiKey: 'secret' } }, 'modelConfiguration'),
    ).toThrow('must not contain secret material');
    expect(() => validateAllowedTools(['lead.read', 'not a tool'])).toThrow();
    expect(() => validateAllowedTools(['lead.read', 'lead.read'])).toThrow();
  });

  it('accepts secret references, trims instructions, and redacts legacy secrets on reads', () => {
    expect(
      validateAgentConfiguration(
        { model: 'provider-neutral', secretRef: 'secret://models/1' },
        'config',
      ),
    ).toMatchObject({ secretRef: 'secret://models/1' });
    expect(validateAgentInstructions('  Answer from approved business facts.  ')).toBe(
      'Answer from approved business facts.',
    );
    expect(
      redactAgentModelConfiguration({
        model: 'model-a',
        apiKey: 'do-not-return',
        nested: { password: 'also-secret', region: 'us-east' },
      }),
    ).toEqual({ model: 'model-a', nested: { region: 'us-east' } });
  });
});
