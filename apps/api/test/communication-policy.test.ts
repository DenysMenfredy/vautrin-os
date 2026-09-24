import { describe, expect, it } from 'vitest';

import { isStopCommand } from '../src/conversations/communication-policy.js';

describe('deterministic communication suppression', () => {
  it('recognizes only an exact STOP command on text channels', () => {
    expect(isStopCommand('SMS', ' stop ')).toBe(true);
    expect(isStopCommand('WHATSAPP', 'STOP')).toBe(true);
    expect(isStopCommand('EMAIL', 'STOP')).toBe(false);
    expect(isStopCommand('SMS', 'Please stop by tomorrow')).toBe(false);
  });
});
