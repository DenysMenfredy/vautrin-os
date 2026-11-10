import type { TenantRoleName } from './auth.js';
import type { PageResponse } from './business.js';

export const PLATFORM_ROLES = ['SUPER_ADMIN', 'OPERATOR', 'SUPPORT_READ_ONLY'] as const;
export type PlatformRoleName = (typeof PLATFORM_ROLES)[number];
export const PLATFORM_PERMISSIONS = [
  'read',
  'user.invite',
  'user.edit',
  'user.disable',
  'user.delete',
  'membership.manage',
  'tenant.manage',
  'access.manage',
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];
export type PlatformUserStatus = 'PENDING' | 'ACTIVE' | 'DISABLED' | 'DELETED';
export type PlatformTenantStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

export interface PlatformPrincipal {
  readonly userId: string;
  readonly platformRole: PlatformRoleName;
  readonly sessionId: string;
  readonly audience: 'platform-admin';
}
export interface PlatformSessionResponse {
  readonly user: { readonly id: string; readonly email: string; readonly name: string | null };
  readonly platformRole: PlatformRoleName;
  readonly permissions: readonly PlatformPermission[];
  readonly expiresAt: string;
}
export interface PlatformMembership {
  readonly id: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly role: TenantRoleName;
  readonly status: 'ACTIVE' | 'INVITED' | 'REVOKED';
}
export interface PlatformUser {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly status: PlatformUserStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastLoginAt: string | null;
  readonly disabledAt: string | null;
  readonly deletedAt: string | null;
  readonly memberships: readonly PlatformMembership[];
  readonly protectedIdentity: boolean;
  readonly platformAccess?: {
    readonly role: PlatformRoleName;
    readonly status: 'ACTIVE' | 'SUSPENDED';
  } | null;
}
export interface PlatformUserDetail extends PlatformUser {
  readonly sessions: { readonly tenantSessions: number; readonly adminSessions: number };
}
export interface PlatformTenant {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: PlatformTenantStatus;
  readonly vertical: string;
  readonly timezone: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly userCount: number;
  readonly activeUserCount: number;
}
export interface PlatformTenantDetail extends PlatformTenant {
  readonly businessProfile: {
    readonly displayName: string;
    readonly timezone: string;
    readonly locale: string;
    readonly currency: string;
  } | null;
  readonly pendingInvitations: number;
}
export interface PlatformDashboard {
  readonly generatedAt: string;
  readonly timezone: 'UTC';
  readonly summary: {
    readonly usersTotal: number;
    readonly usersActive: number;
    readonly usersDisabled: number;
    readonly usersDeleted: number;
    readonly tenantsTotal: number;
    readonly tenantsActive: number;
    readonly usersCreatedThisMonth: number;
    readonly tenantsCreatedThisMonth: number;
    readonly pendingInvitations: number;
  };
}
export interface PlatformMonthlyAnalytics {
  readonly timezone: 'UTC';
  readonly period: { readonly months: number; readonly from: string; readonly to: string };
  readonly series: readonly { readonly month: string; readonly count: number }[];
}
export interface PlatformAudit {
  readonly id: string;
  readonly actorUserId: string;
  readonly actorRole: PlatformRoleName;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly tenantId: string | null;
  readonly reason: string | null;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly outcome: string;
  readonly createdAt: string;
}
export type PlatformUserPage = PageResponse<PlatformUser>;
export type PlatformTenantPage = PageResponse<PlatformTenant>;
export type PlatformAuditPage = PageResponse<PlatformAudit>;
export const PLATFORM_ERROR_CODES = [
  'PLATFORM_ACCESS_REQUIRED',
  'PLATFORM_PERMISSION_DENIED',
  'PLATFORM_UNAVAILABLE',
  'PLATFORM_OPERATION_REPLAYED',
  'USER_NOT_FOUND',
  'USER_ALREADY_DISABLED',
  'USER_ALREADY_DELETED',
  'USER_DELETE_SELF_FORBIDDEN',
  'LAST_SUPER_ADMIN_PROTECTED',
  'TENANT_NOT_FOUND',
  'TENANT_ALREADY_SUSPENDED',
  'TENANT_ALREADY_ARCHIVED',
  'MEMBERSHIP_NOT_FOUND',
  'MEMBERSHIP_ALREADY_EXISTS',
  'INVITATION_ALREADY_PENDING',
] as const;
export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[number];
