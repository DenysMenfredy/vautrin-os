import { describe, expect, it } from 'vitest';

import { parseWaitDuration, parseWaitStepDuration } from './wait-duration.js';

describe('parseWaitDuration', () => {
  it.each([
    ['30s', 30_000],
    ['2h', 7_200_000],
    ['24h', 86_400_000],
  ])('parses %s', (value, expected) => {
    expect(parseWaitDuration(value)).toBe(expected);
  });

  it.each(['', '0s', '-1h', '1.5h', ' 30s', '30seconds', '2m', '1d', '999999999999999999h', 30])(
    'rejects invalid duration %s',
    (value) => {
      expect(() => parseWaitDuration(value)).toThrow();
    },
  );
});

describe('parseWaitStepDuration', () => {
  it('accepts only the documented duration config', () => {
    expect(parseWaitStepDuration({ duration: '30s' })).toBe(30_000);
    expect(() => parseWaitStepDuration({ duration: '30s', unit: 'seconds' })).toThrow();
    expect(() => parseWaitStepDuration({})).toThrow();
    expect(() => parseWaitStepDuration(null)).toThrow();
  });
});
