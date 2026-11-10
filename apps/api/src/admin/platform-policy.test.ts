import { PLATFORM_PERMISSIONS, PLATFORM_ROLES } from '@vautrin/contracts';
import { describe, expect, it } from 'vitest';
import { cursorWhere, platformPage } from './platform-pagination.js';
import {
  assertSuperAdminRemoval,
  assertUserLifecycle,
  monthlySeries,
  permissionsForPlatform,
  requirePlatformPermission,
  tenantStatusAfterTransition,
} from './platform-policy.js';

describe('platform authorization, independent of tenant RBAC', () => {
  it.each(PLATFORM_ROLES)('enforces every %s permission', (role) => {
    for (const permission of PLATFORM_PERMISSIONS) {
      const allowed =
        role === 'SUPER_ADMIN' ||
        (role === 'OPERATOR' && !['access.manage', 'user.delete'].includes(permission)) ||
        permission === 'read';
      expect(permissionsForPlatform(role).includes(permission)).toBe(allowed);
      if (allowed) expect(() => requirePlatformPermission(role, permission)).not.toThrow();
      else expect(() => requirePlatformPermission(role, permission)).toThrow(/cannot perform/);
    }
  });
});
describe('UTC calendar registration analytics', () => {
  it('fills zero months across a year boundary and preserves the full current month', () => {
    const result = monthlySeries(
      3,
      [
        { month: '2025-12', count: 2n },
        { month: '2026-02', count: 7 },
      ],
      new Date('2026-02-15T00:15:00+14:00'),
    );
    expect(result.series).toEqual([
      { month: '2025-12', count: 2 },
      { month: '2026-01', count: 0 },
      { month: '2026-02', count: 7 },
    ]);
    expect(result.period).toEqual({
      months: 3,
      from: '2025-12-01T00:00:00.000Z',
      to: '2026-02-28T23:59:59.999Z',
    });
  });
  it('uses UTC rather than the local calendar date', () => {
    const result = monthlySeries(1, [], new Date('2026-03-01T00:01:00+14:00'));
    expect(result.series).toEqual([{ month: '2026-02', count: 0 }]);
  });
});
describe('platform list cursor confinement', () => {
  const rows = [
    { id: '11111111-1111-4111-8111-111111111111', createdAt: new Date('2026-01-01') },
    { id: '22222222-2222-4222-8222-222222222222', createdAt: new Date('2026-01-01') },
  ];
  it('ties equal timestamps to IDs and never returns the lookahead row', () => {
    const page = platformPage(rows, 1, (row) => row.id);
    expect(page.items).toEqual([rows[0]?.id]);
    expect(cursorWhere(page.nextCursor ?? undefined)).toEqual({
      OR: [
        { createdAt: { lt: rows[0]?.createdAt } },
        { createdAt: rows[0]?.createdAt, id: { lt: rows[0]?.id } },
      ],
    });
  });
  it('rejects malformed cursors and changing sort order mid-page', () => {
    expect(() => cursorWhere('invalid')).toThrow(/Invalid pagination/);
    expect(() =>
      cursorWhere(platformPage(rows, 1, (row) => row.id).nextCursor ?? undefined, 'createdAt:asc'),
    ).toThrow(/Invalid pagination/);
  });
});

describe('lifecycle state transitions', () => {
  it('prevents self deletion, repeat disable, and editing deleted lifecycle', () => {
    expect(() =>
      assertUserLifecycle({ id: 'self', status: 'ACTIVE', deletedAt: null }, 'self', 'delete'),
    ).toThrow(/cannot delete/);
    expect(() =>
      assertUserLifecycle({ id: 'other', status: 'DISABLED', deletedAt: null }, 'self', 'disable'),
    ).toThrow(/already disabled/);
    expect(() =>
      assertUserLifecycle(
        { id: 'other', status: 'DISABLED', deletedAt: new Date() },
        'self',
        'enable',
      ),
    ).toThrow(/logically deleted/);
    expect(() =>
      assertUserLifecycle({ id: 'other', status: 'DISABLED', deletedAt: null }, 'self', 'enable'),
    ).not.toThrow();
  });
  it('permits reversible suspension and prevents archive revival', () => {
    expect(tenantStatusAfterTransition('ACTIVE', null, 'suspend')).toBe('SUSPENDED');
    expect(tenantStatusAfterTransition('SUSPENDED', null, 'reactivate')).toBe('ACTIVE');
    expect(tenantStatusAfterTransition('SUSPENDED', null, 'archive')).toBe('ARCHIVED');
    expect(() => tenantStatusAfterTransition('ARCHIVED', null, 'reactivate')).toThrow(
      /Archived tenants/,
    );
  });
  it('requires another active super administrator before privilege removal', () => {
    expect(() => assertSuperAdminRemoval(1)).toThrow(/last active/);
    expect(() => assertSuperAdminRemoval(2)).not.toThrow();
  });
});
