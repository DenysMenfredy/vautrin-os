import { describe, expect, it } from 'vitest';

import { EMBEDDING_DIMENSIONS } from '../src/config.js';
import { InvalidTenantContextError, SchemaMismatchError } from '../src/errors.js';
import { assertTenantId, assertTenantJobContext } from '../src/tenant-context.js';
import { toVectorLiteral } from '../src/vector.js';

describe('assertTenantId', () => {
  it('accepts a UUID', () => {
    expect(() => assertTenantId('0192f1a0-1b2c-7d3e-8f40-51627384950a')).not.toThrow();
  });

  it.each([
    ['empty string', ''],
    ['not a uuid', 'tenant-1'],
    ['sql fragment', "' OR 1=1 --"],
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
  ])('rejects %s', (_label, value) => {
    expect(() => assertTenantId(value)).toThrow(InvalidTenantContextError);
  });
});

describe('assertTenantJobContext', () => {
  it('accepts a payload carrying a tenant id (SDD-05 §5)', () => {
    expect(() =>
      assertTenantJobContext({ tenantId: '0192f1a0-1b2c-7d3e-8f40-51627384950a' }),
    ).not.toThrow();
  });

  it.each([
    ['a payload with no tenant', { correlationId: 'abc' }],
    ['null', null],
    ['a bare string', 'tenant'],
  ])('rejects %s', (_label, value) => {
    expect(() => assertTenantJobContext(value)).toThrow(InvalidTenantContextError);
  });
});

describe('toVectorLiteral', () => {
  it('formats a correctly sized embedding', () => {
    const literal = toVectorLiteral(new Array(EMBEDDING_DIMENSIONS).fill(0.5));
    expect(literal.startsWith('[0.5,0.5')).toBe(true);
    expect(literal.endsWith('0.5]')).toBe(true);
  });

  it('rejects the wrong number of dimensions', () => {
    expect(() => toVectorLiteral([0.1, 0.2])).toThrow(SchemaMismatchError);
  });

  it('rejects non-finite values before they reach PostgreSQL', () => {
    const values = new Array(EMBEDDING_DIMENSIONS).fill(0.1);
    values[7] = Number.NaN;
    expect(() => toVectorLiteral(values)).toThrow(SchemaMismatchError);
  });
});
