import { describe, expect, it } from 'vitest';

import { ALL_QUEUES, QUEUE } from '../src/queues/queues.constants.js';

describe('queue catalogue', () => {
  it('matches the queues named in ADR-009', () => {
    // Renaming a queue orphans whatever is already enqueued under the old
    // name, so this list is a contract rather than a detail.
    expect([...ALL_QUEUES].sort()).toEqual(['ai', 'notifications', 'webhooks', 'workflow']);
  });

  it('exposes each queue as a distinct name', () => {
    const names = Object.values(QUEUE);
    expect(new Set(names).size).toBe(names.length);
  });
});
