/**
 * SDD-07's v0.3 example uses compact seconds/hours values such as `30s` and
 * `24h`. Keep parsing to those documented units and reject fractions, signs,
 * and overflow.
 */
export function parseWaitDuration(value: unknown): number {
  if (typeof value !== 'string') throw new Error('wait duration must be a string.');

  const match = /^([1-9]\d*)(s|h)$/.exec(value);
  if (!match) throw new Error('wait duration must use a positive integer and s or h.');

  const amount = Number(match[1]);
  const unitMilliseconds = match[2] === 's' ? 1_000 : 3_600_000;
  const duration = amount * unitMilliseconds;
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    throw new Error('wait duration must be a positive safe integer in milliseconds.');
  }

  return duration;
}

export function parseWaitStepDuration(config: unknown): number {
  if (
    config &&
    typeof config === 'object' &&
    !Array.isArray(config) &&
    Object.keys(config).length === 1 &&
    'durationMs' in config
  ) {
    const value = config.durationMs;
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > 604_800_000
    )
      throw new Error('durationMs must be an integer from 1 to 604800000.');
    return value;
  }
  if (
    typeof config !== 'object' ||
    config === null ||
    Array.isArray(config) ||
    Object.keys(config).length !== 1 ||
    !Object.hasOwn(config, 'duration')
  ) {
    throw new Error('wait config must contain only duration.');
  }

  return parseWaitDuration((config as { readonly duration?: unknown }).duration);
}
