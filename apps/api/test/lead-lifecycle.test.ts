import { describe, expect, it } from 'vitest';

import { assertLeadTransition } from '../src/leads/lead-lifecycle.js';

describe('lead lifecycle (VOS-053)', () => {
  it('permits forward progress, including a direct close', () => {
    expect(() => assertLeadTransition('NEW', 'QUALIFIED')).not.toThrow();
    expect(() => assertLeadTransition('QUALIFIED', 'WON')).not.toThrow();
    expect(() => assertLeadTransition('NEW', 'LOST')).not.toThrow();
  });

  it('rejects the same stage and backward moves', () => {
    expect(() => assertLeadTransition('CONTACTED', 'CONTACTED')).toThrow();
    expect(() => assertLeadTransition('QUALIFIED', 'NEW')).toThrow();
  });

  it('keeps won and lost terminal', () => {
    expect(() => assertLeadTransition('WON', 'LOST')).toThrow();
    expect(() => assertLeadTransition('LOST', 'WON')).toThrow();
  });
});
