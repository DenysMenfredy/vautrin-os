import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

interface TurboConfiguration {
  tasks: Record<string, { passThroughEnv?: string[]; cache?: boolean }>;
}

const turbo = JSON.parse(
  readFileSync(new URL('../../../turbo.json', import.meta.url), 'utf8'),
) as TurboConfiguration;

describe('CI integration environment', () => {
  it('forwards the signing key through Turbo strict environment mode', () => {
    expect(turbo.tasks['test:integration']?.passThroughEnv).toContain('JWT_SECRET');
  });

  it('never caches integration results that depend on disposable sessions and live services', () => {
    expect(turbo.tasks['test:integration']?.cache).toBe(false);
  });
});
