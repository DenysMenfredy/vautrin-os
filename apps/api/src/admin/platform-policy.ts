import { HttpException } from '@nestjs/common';
import {
  PLATFORM_PERMISSIONS,
  type PlatformErrorCode,
  type PlatformMonthlyAnalytics,
  type PlatformPermission,
  type PlatformRoleName,
} from '@vautrin/contracts';

export function permissionsForPlatform(role: PlatformRoleName): readonly PlatformPermission[] {
  if (role === 'SUPER_ADMIN') return PLATFORM_PERMISSIONS;
  if (role === 'OPERATOR')
    return PLATFORM_PERMISSIONS.filter(
      (permission) => permission !== 'user.delete' && permission !== 'access.manage',
    );
  return ['read'];
}
export function platformError(code: PlatformErrorCode, message: string, status = 409): never {
  throw new HttpException({ code, message }, status);
}
export function requirePlatformPermission(
  role: PlatformRoleName,
  permission: PlatformPermission,
): void {
  if (!permissionsForPlatform(role).includes(permission))
    platformError(
      'PLATFORM_PERMISSION_DENIED',
      'This platform role cannot perform this operation.',
      403,
    );
}
export function utcMonthlyPeriod(months: number, now = new Date()): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1)),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}
export function monthlySeries(
  months: number,
  counts: readonly { month: string; count: number | bigint }[],
  now = new Date(),
): PlatformMonthlyAnalytics {
  const { from, to } = utcMonthlyPeriod(months, now);
  const values = new Map(counts.map((row) => [row.month, Number(row.count)]));
  return {
    timezone: 'UTC',
    period: { months, from: from.toISOString(), to: new Date(to.getTime() - 1).toISOString() },
    series: Array.from({ length: months }, (_, index) => {
      const month = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + index, 1))
        .toISOString()
        .slice(0, 7);
      return { month, count: values.get(month) ?? 0 };
    }),
  };
}

export function assertUserLifecycle(
  user: { id: string; status: string; deletedAt: Date | null },
  actorId: string,
  action: 'enable' | 'disable' | 'delete',
): void {
  if (action === 'delete' && user.id === actorId)
    platformError('USER_DELETE_SELF_FORBIDDEN', 'You cannot delete your own admin identity.');
  if (user.deletedAt) platformError('USER_ALREADY_DELETED', 'This user is logically deleted.');
  if (action === 'disable' && user.status === 'DISABLED')
    platformError('USER_ALREADY_DISABLED', 'This user is already disabled.');
}
export function tenantStatusAfterTransition(
  current: string,
  deletedAt: Date | null,
  action: 'suspend' | 'reactivate' | 'archive',
): 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' {
  if (current === 'ARCHIVED' || current === 'PENDING_DELETION' || deletedAt)
    platformError(
      'TENANT_ALREADY_ARCHIVED',
      'Archived tenants cannot be reactivated through this operation.',
    );
  if (action === 'suspend' && current === 'SUSPENDED')
    platformError('TENANT_ALREADY_SUSPENDED', 'This tenant is already suspended.');
  if (action === 'reactivate' && current !== 'SUSPENDED')
    throw new HttpException('Only suspended tenants can be reactivated.', 400);
  return action === 'archive' ? 'ARCHIVED' : action === 'suspend' ? 'SUSPENDED' : 'ACTIVE';
}
export function assertSuperAdminRemoval(activeSuperAdmins: number): void {
  if (activeSuperAdmins <= 1)
    platformError(
      'LAST_SUPER_ADMIN_PROTECTED',
      'The last active super administrator must remain enabled.',
    );
}
