import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  InvitationResponse,
  PlatformAudit,
  PlatformDashboard,
  PlatformPermission,
  PlatformPrincipal,
  PlatformTenant,
  PlatformTenantDetail,
  PlatformUser,
  PlatformUserDetail,
} from '@vautrin/contracts';
import { Prisma } from '@vautrin/database';
import { DatabaseService } from '../database/database.service.js';
import { issueTenantInvitation } from '../tenant/invitation-issuance.js';
import { provisionTenantConfiguration } from '../tenant/provisioning.js';
import type {
  AdminAuditQuery,
  AdminCreateTenantDto,
  AdminEditTenantDto,
  AdminInvitationDto,
  AdminListQuery,
  AdminPlatformAccessDto,
} from './admin.dto.js';
import { PlatformRepository } from './platform.repository.js';
import { createdRange, cursorWhere, platformPage } from './platform-pagination.js';
import {
  assertSuperAdminRemoval,
  assertUserLifecycle,
  monthlySeries,
  platformError,
  requirePlatformPermission,
  tenantStatusAfterTransition,
  utcMonthlyPeriod,
} from './platform-policy.js';

export interface PlatformMutationContext extends PlatformPrincipal {
  requestId?: string | undefined;
  correlationId?: string | undefined;
  idempotencyKey?: string | undefined;
}
const userSelect = {
  id: true,
  email: true,
  name: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
  disabledAt: true,
  deletedAt: true,
  memberships: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 25,
    select: {
      id: true,
      tenantId: true,
      role: true,
      status: true,
      createdAt: true,
      tenant: { select: { name: true } },
    },
  },
  platformAccess: true,
} satisfies Prisma.UserSelect;
type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;
const tenantInclude = {
  businessProfile: { select: { displayName: true, timezone: true, locale: true, currency: true } },
  _count: { select: { members: true } },
} satisfies Prisma.TenantInclude;
type TenantRow = Prisma.TenantGetPayload<{ include: typeof tenantInclude }>;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  constructor(
    private readonly repository: PlatformRepository,
    private readonly database: DatabaseService,
  ) {}

  dashboard(): Promise<PlatformDashboard> {
    return this.repository.read(async (db) => {
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const [
        usersTotal,
        usersActive,
        usersDisabled,
        usersDeleted,
        tenantsTotal,
        tenantsActive,
        usersCreatedThisMonth,
        tenantsCreatedThisMonth,
        pendingInvitations,
      ] = await Promise.all([
        db.user.count(),
        db.user.count({ where: { status: 'ACTIVE', deletedAt: null } }),
        db.user.count({ where: { status: 'DISABLED', deletedAt: null } }),
        db.user.count({ where: { deletedAt: { not: null } } }),
        db.tenant.count(),
        db.tenant.count({ where: { status: 'ACTIVE', deletedAt: null } }),
        db.user.count({ where: { createdAt: { gte: start, lte: now } } }),
        db.tenant.count({ where: { createdAt: { gte: start, lte: now } } }),
        db.tenantInvitation.count({
          where: {
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
            tenant: { status: 'ACTIVE', deletedAt: null },
          },
        }),
      ]);
      return {
        generatedAt: now.toISOString(),
        timezone: 'UTC',
        summary: {
          usersTotal,
          usersActive,
          usersDisabled,
          usersDeleted,
          tenantsTotal,
          tenantsActive,
          usersCreatedThisMonth,
          tenantsCreatedThisMonth,
          pendingInvitations,
        },
      };
    });
  }
  analytics(kind: 'users' | 'tenants', months: number) {
    const now = new Date();
    const { from, to } = utcMonthlyPeriod(months, now);
    return this.repository.read(async (db) => {
      const rows =
        kind === 'users'
          ? await db.$queryRaw<Array<{ month: string; count: bigint }>>`
        SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month, count(*) AS count
        FROM public.users WHERE created_at >= ${from} AND created_at < ${to} GROUP BY 1 ORDER BY 1
      `
          : await db.$queryRaw<Array<{ month: string; count: bigint }>>`
        SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month, count(*) AS count
        FROM public.tenants WHERE created_at >= ${from} AND created_at < ${to} GROUP BY 1 ORDER BY 1
      `;
      return monthlySeries(months, rows, now);
    });
  }
  users(query: AdminListQuery, actor: PlatformPrincipal) {
    const state: Prisma.UserWhereInput =
      query.status === 'DELETED'
        ? { deletedAt: { not: null } }
        : {
            deletedAt: null,
            ...(query.status
              ? {
                  status:
                    query.status === 'PENDING'
                      ? 'INVITED'
                      : (query.status as 'ACTIVE' | 'DISABLED'),
                }
              : {}),
          };
    if (query.status && !['PENDING', 'ACTIVE', 'DISABLED', 'DELETED'].includes(query.status))
      throw new BadRequestException('Invalid user status.');
    const where: Prisma.UserWhereInput = {
      ...state,
      ...cursorWhere(query.cursor, query.sort),
      createdAt: createdRange(query.createdFrom, query.createdTo),
      ...(query.q?.trim()
        ? {
            OR: [
              { email: { contains: query.q.trim(), mode: 'insensitive' } },
              { name: { contains: query.q.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.tenantId || query.role
        ? {
            memberships: {
              some: {
                ...(query.tenantId ? { tenantId: query.tenantId } : {}),
                ...(query.role ? { role: query.role } : {}),
                status: { not: 'REVOKED' },
              },
            },
          }
        : {}),
    };
    // Search OR and cursor OR must both hold.
    if (query.q?.trim() && query.cursor) {
      const cursor = cursorWhere(query.cursor, query.sort);
      where.AND = [cursor];
    }
    const direction = query.sort === 'createdAt:asc' ? 'asc' : 'desc';
    return this.repository.read(async (db) =>
      platformPage(
        await db.user.findMany({
          where,
          select: userSelect,
          orderBy: [{ createdAt: direction }, { id: direction }],
          take: query.limit + 1,
        }),
        query.limit,
        (row) => mapUser(row, actor),
        query.sort,
      ),
    );
  }
  user(userId: string, actor: PlatformPrincipal): Promise<PlatformUserDetail> {
    return this.repository.read(async (db) => {
      const user = await db.user.findUnique({ where: { id: userId }, select: userSelect });
      if (!user) platformError('USER_NOT_FOUND', 'User not found.', 404);
      const [tenantSessions, adminSessions] = await Promise.all([
        db.refreshToken.count({
          where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        }),
        db.platformSession.count({
          where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        }),
      ]);
      return { ...mapUser(user, actor), sessions: { tenantSessions, adminSessions } };
    });
  }
  memberships(userId: string, query: AdminListQuery) {
    return this.repository.read(async (db) =>
      platformPage(
        await db.tenantUser.findMany({
          where: { userId, ...cursorWhere(query.cursor, query.sort) },
          include: { tenant: { select: { name: true } } },
          orderBy: [
            { createdAt: query.sort === 'createdAt:asc' ? 'asc' : 'desc' },
            { id: query.sort === 'createdAt:asc' ? 'asc' : 'desc' },
          ],
          take: query.limit + 1,
        }),
        query.limit,
        (row) => ({
          id: row.id,
          tenantId: row.tenantId,
          tenantName: row.tenant.name,
          role: row.role,
          status: row.status,
        }),
        query.sort,
      ),
    );
  }
  tenants(query: AdminListQuery) {
    if (query.status && !['ACTIVE', 'SUSPENDED', 'ARCHIVED'].includes(query.status))
      throw new BadRequestException('Invalid tenant status.');
    const where: Prisma.TenantWhereInput = {
      AND: [
        cursorWhere(query.cursor, query.sort),
        ...(query.q?.trim()
          ? [
              {
                OR: [
                  { name: { contains: query.q.trim(), mode: 'insensitive' as const } },
                  { slug: { contains: query.q.trim(), mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
      ],
      ...(query.status
        ? {
            status:
              query.status === 'ARCHIVED'
                ? { in: ['ARCHIVED', 'PENDING_DELETION'] }
                : (query.status as 'ACTIVE' | 'SUSPENDED'),
          }
        : {}),
      createdAt: createdRange(query.createdFrom, query.createdTo),
    };
    return this.repository.read(async (db) => {
      const direction = query.sort === 'createdAt:asc' ? 'asc' : 'desc';
      const rows = await db.tenant.findMany({
        where,
        include: tenantInclude,
        orderBy: [{ createdAt: direction }, { id: direction }],
        take: query.limit + 1,
      });
      const active = await db.tenantUser.groupBy({
        by: ['tenantId'],
        where: {
          tenantId: { in: rows.map((row) => row.id) },
          status: 'ACTIVE',
          user: { status: 'ACTIVE', deletedAt: null },
        },
        _count: true,
      });
      const counts = new Map(active.map((row) => [row.tenantId, row._count]));
      return platformPage(
        rows,
        query.limit,
        (row) => mapTenant(row, counts.get(row.id) ?? 0),
        query.sort,
      );
    });
  }
  tenant(tenantId: string): Promise<PlatformTenantDetail> {
    return this.repository.read(async (db) => {
      const tenant = await db.tenant.findUnique({
        where: { id: tenantId },
        include: tenantInclude,
      });
      if (!tenant) platformError('TENANT_NOT_FOUND', 'Tenant not found.', 404);
      const [active, pending] = await Promise.all([
        db.tenantUser.count({
          where: { tenantId, status: 'ACTIVE', user: { status: 'ACTIVE', deletedAt: null } },
        }),
        db.tenantInvitation.count({
          where: { tenantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        }),
      ]);
      return {
        ...mapTenant(tenant, active),
        businessProfile: tenant.businessProfile,
        pendingInvitations: pending,
      };
    });
  }
  audit(query: AdminAuditQuery) {
    return this.repository.read(async (db) =>
      platformPage(
        await db.platformAuditLog.findMany({
          where: {
            ...cursorWhere(query.cursor),
            ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
            ...(query.tenantId ? { tenantId: query.tenantId } : {}),
            ...(query.targetType ? { targetType: query.targetType } : {}),
            ...(query.targetId ? { targetId: query.targetId } : {}),
            ...(query.action ? { action: query.action } : {}),
            createdAt: createdRange(query.from ?? query.createdFrom, query.to ?? query.createdTo),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: query.limit + 1,
        }),
        query.limit,
        mapAudit,
      ),
    );
  }

  createTenant(context: PlatformMutationContext, input: AdminCreateTenantDto) {
    validateTimezone(input.timezone);
    const slug =
      input.slug ??
      input.name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 63);
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug))
      throw new BadRequestException('Supply a valid tenant slug.');
    return this.mutate(
      context,
      'tenant.manage',
      'platform.tenant.created',
      'tenant',
      undefined,
      undefined,
      async (tx) => {
        const tenant = await provisionTenantConfiguration(tx, {
          slug,
          name: input.name,
          vertical: input.template,
          timezone: input.timezone,
        });
        const invitation = input.owner
          ? await issueTenantInvitation(tx, {
              tenantId: tenant.id,
              email: input.owner.email,
              role: 'OWNER',
              actorUserId: context.userId,
            })
          : null;
        if (invitation)
          await this.appendAudit(
            tx,
            context,
            'platform.user.invited',
            'invitation',
            invitation.invitationId,
            tenant.id,
            undefined,
            { role: 'OWNER' },
          );
        return {
          result: { tenantId: tenant.id, invitation },
          targetId: tenant.id,
          tenantId: tenant.id,
        };
      },
    );
  }
  invite(context: PlatformMutationContext, input: AdminInvitationDto): Promise<InvitationResponse> {
    return this.mutate(
      context,
      'user.invite',
      'platform.user.invited',
      'invitation',
      undefined,
      undefined,
      async (tx) => {
        const invitation = await issueTenantInvitation(tx, {
          ...input,
          actorUserId: context.userId,
        });
        return {
          result: invitation,
          targetId: invitation.invitationId,
          tenantId: input.tenantId,
          metadata: { role: input.role, reissued: input.reissue ?? false },
        };
      },
    );
  }
  editUser(context: PlatformMutationContext, userId: string, name: string) {
    return this.mutate(
      context,
      'user.edit',
      'platform.user.updated',
      'user',
      userId,
      undefined,
      async (tx) => {
        const user = await this.userForMutation(tx, context, userId);
        if (user.deletedAt)
          platformError('USER_ALREADY_DELETED', 'This user is logically deleted.');
        await tx.user.update({ where: { id: userId }, data: { name }, select: { id: true } });
        return { result: { id: userId } };
      },
    );
  }
  userLifecycle(
    context: PlatformMutationContext,
    userId: string,
    action: 'disable' | 'enable' | 'delete',
    reason: string,
  ) {
    return this.mutate(
      context,
      action === 'delete' ? 'user.delete' : 'user.disable',
      `platform.user.${action === 'delete' ? 'deleted' : action === 'disable' ? 'disabled' : 'enabled'}`,
      'user',
      userId,
      reason,
      async (tx) => {
        const user = await this.userForMutation(tx, context, userId);
        assertUserLifecycle(user, context.userId, action);
        if (action === 'enable') {
          // Password hashes are checked through the identity store and never
          // granted to or read through the restricted platform repository.
          // nosemgrep: semgrep.vautrin-unscoped-database-access
          const credentials = await this.database.unscoped.user.findUnique({
            where: { id: userId },
            select: { passwordHash: true },
          });
          if (!credentials?.passwordHash)
            throw new BadRequestException('A pending identity must accept an invitation.');
        }
        if (action !== 'enable') await this.protectSuperAdmin(tx, userId);
        const now = new Date();
        await tx.user.update({
          where: { id: userId },
          data:
            action === 'enable'
              ? { status: 'ACTIVE', disabledAt: null }
              : {
                  status: 'DISABLED',
                  disabledAt: now,
                  ...(action === 'delete' ? { deletedAt: now } : {}),
                },
          select: { id: true },
        });
        await revokeUserSessions(tx, userId, `platform_user_${action}`);
        if (action === 'delete') {
          await tx.tenantUser.updateMany({
            where: { userId, status: { not: 'REVOKED' } },
            data: { status: 'REVOKED' },
          });
          await tx.tenantInvitation.updateMany({
            where: { email: user.email, acceptedAt: null, revokedAt: null },
            data: { revokedAt: now },
          });
          await tx.platformAccess.updateMany({ where: { userId }, data: { status: 'SUSPENDED' } });
        }
        return {
          result: {
            id: userId,
            status: action === 'delete' ? 'DELETED' : action === 'disable' ? 'DISABLED' : 'ACTIVE',
          },
        };
      },
    );
  }
  addMembership(
    context: PlatformMutationContext,
    userId: string,
    tenantId: string,
    role: AdminInvitationDto['role'],
  ) {
    return this.mutate(
      context,
      'membership.manage',
      'platform.membership.created',
      'membership',
      undefined,
      undefined,
      async (tx) => {
        const user = await this.userForMutation(tx, context, userId);
        if (user.status !== 'ACTIVE' || user.deletedAt)
          throw new BadRequestException('New or inactive users must use invitation acceptance.');
        await this.activeTenant(tx, tenantId);
        const existing = await tx.tenantUser.findUnique({
          where: { tenantId_userId: { tenantId, userId } },
        });
        if (existing?.status === 'ACTIVE')
          platformError('MEMBERSHIP_ALREADY_EXISTS', 'This membership already exists.');
        const membership = await tx.tenantUser.upsert({
          where: { tenantId_userId: { tenantId, userId } },
          create: { tenantId, userId, role, status: 'ACTIVE' },
          update: { role, status: 'ACTIVE' },
        });
        await revokeUserSessions(tx, userId, 'platform_membership_created');
        return {
          result: { id: membership.id },
          targetId: membership.id,
          tenantId,
          metadata: { userId, role },
        };
      },
    );
  }
  changeMembership(
    context: PlatformMutationContext,
    userId: string,
    membershipId: string,
    role?: AdminInvitationDto['role'],
  ) {
    return this.mutate(
      context,
      'membership.manage',
      role ? 'platform.membership.role_changed' : 'platform.membership.removed',
      'membership',
      membershipId,
      undefined,
      async (tx) => {
        await this.userForMutation(tx, context, userId);
        const membership = await tx.tenantUser.findFirst({ where: { id: membershipId, userId } });
        if (!membership) platformError('MEMBERSHIP_NOT_FOUND', 'Membership not found.', 404);
        if (role && membership.status !== 'ACTIVE')
          throw new BadRequestException('Only an active membership can change role.');
        await tx.tenantUser.update({
          where: { id: membership.id },
          data: role ? { role } : { status: 'REVOKED' },
        });
        await tx.refreshToken.updateMany({
          where: { userId, activeTenantId: membership.tenantId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'platform_membership_changed' },
        });
        return {
          result: { id: membership.id },
          tenantId: membership.tenantId,
          metadata: { userId, ...(role ? { role } : {}) },
        };
      },
    );
  }
  editTenant(context: PlatformMutationContext, tenantId: string, input: AdminEditTenantDto) {
    if (Object.keys(input).length === 0)
      throw new BadRequestException('Supply at least one tenant field.');
    if (input.timezone) validateTimezone(input.timezone);
    return this.mutate(
      context,
      'tenant.manage',
      'platform.tenant.updated',
      'tenant',
      tenantId,
      undefined,
      async (tx) => {
        const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) platformError('TENANT_NOT_FOUND', 'Tenant not found.', 404);
        await tx.tenant.update({
          where: { id: tenantId },
          data: {
            ...(input.name ? { name: input.name } : {}),
            ...(input.template ? { vertical: input.template } : {}),
          },
        });
        if (input.name || input.timezone)
          await tx.businessProfile.updateMany({
            where: { tenantId },
            data: {
              ...(input.name ? { displayName: input.name } : {}),
              ...(input.timezone ? { timezone: input.timezone } : {}),
            },
          });
        return { result: { id: tenantId }, tenantId };
      },
    );
  }
  tenantLifecycle(
    context: PlatformMutationContext,
    tenantId: string,
    action: 'suspend' | 'reactivate' | 'archive',
    reason: string,
  ) {
    return this.mutate(
      context,
      'tenant.manage',
      `platform.tenant.${action === 'suspend' ? 'suspended' : action === 'archive' ? 'archived' : 'reactivated'}`,
      'tenant',
      tenantId,
      reason,
      async (tx) => {
        const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) platformError('TENANT_NOT_FOUND', 'Tenant not found.', 404);
        const status = tenantStatusAfterTransition(tenant.status, tenant.deletedAt, action);
        await tx.tenant.update({
          where: { id: tenantId },
          data: {
            status,
          },
        });
        if (action !== 'reactivate') {
          await tx.refreshToken.updateMany({
            where: { activeTenantId: tenantId, revokedAt: null },
            data: { revokedAt: new Date(), revokedReason: `tenant_${action}` },
          });
          await tx.tenantInvitation.updateMany({
            where: { tenantId, acceptedAt: null, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        return { result: { id: tenantId }, tenantId };
      },
    );
  }
  platformAccess(context: PlatformMutationContext, userId: string, input: AdminPlatformAccessDto) {
    return this.mutate(
      context,
      'access.manage',
      'platform.access.changed',
      'user',
      userId,
      input.reason,
      async (tx) => {
        const user = await this.userForMutation(tx, context, userId);
        if (user.status !== 'ACTIVE' || user.deletedAt)
          throw new BadRequestException(
            'Platform access requires an active, invitation-accepted identity.',
          );
        if (input.role !== 'SUPER_ADMIN' || input.status !== 'ACTIVE')
          await this.protectSuperAdmin(tx, userId);
        const existing = await tx.platformAccess.findUnique({ where: { userId } });
        const access = await tx.platformAccess.upsert({
          where: { userId },
          create: {
            userId,
            role: input.role,
            status: input.status,
            createdByUserId: context.userId,
          },
          update: { role: input.role, status: input.status },
        });
        await tx.platformSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return {
          result: { id: access.id },
          metadata: {
            role: input.role,
            status: input.status,
            event: !existing
              ? 'platform.access.granted'
              : input.status === 'SUSPENDED'
                ? 'platform.access.revoked'
                : 'platform.access.changed',
          },
        };
      },
    );
  }

  private async userForMutation(
    tx: Prisma.TransactionClient,
    actor: PlatformPrincipal,
    userId: string,
  ) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
        deletedAt: true,
        platformAccess: true,
      },
    });
    if (!user) platformError('USER_NOT_FOUND', 'User not found.', 404);
    if (user.platformAccess && actor.platformRole !== 'SUPER_ADMIN')
      platformError(
        'PLATFORM_PERMISSION_DENIED',
        'Only a super administrator can change a platform identity.',
        403,
      );
    return user;
  }
  private async activeTenant(tx: Prisma.TransactionClient, tenantId: string) {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) platformError('TENANT_NOT_FOUND', 'Tenant not found.', 404);
    if (tenant.status !== 'ACTIVE' || tenant.deletedAt)
      throw new BadRequestException('Tenant is not active.');
    return tenant;
  }
  private async protectSuperAdmin(tx: Prisma.TransactionClient, userId: string) {
    const access = await tx.platformAccess.findUnique({
      where: { userId },
      include: { user: { select: { status: true, deletedAt: true } } },
    });
    if (
      access?.role !== 'SUPER_ADMIN' ||
      access.status !== 'ACTIVE' ||
      access.user.status !== 'ACTIVE' ||
      access.user.deletedAt
    )
      return;
    const count = await tx.platformAccess.count({
      where: { role: 'SUPER_ADMIN', status: 'ACTIVE', user: { status: 'ACTIVE', deletedAt: null } },
    });
    assertSuperAdminRemoval(count);
  }
  private async mutate<T>(
    context: PlatformMutationContext,
    permission: PlatformPermission,
    action: string,
    targetType: string,
    targetId: string | undefined,
    reason: string | undefined,
    operation: (tx: Prisma.TransactionClient) => Promise<{
      result: T;
      targetId?: string;
      tenantId?: string;
      metadata?: Prisma.InputJsonObject;
    }>,
  ) {
    const started = performance.now();
    try {
      const result = await this.repository.transaction(async (tx) => {
        const session = await tx.platformSession.findFirst({
          where: {
            id: context.sessionId,
            userId: context.userId,
            audience: 'platform-admin',
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          include: {
            user: { select: { status: true, deletedAt: true, platformAccess: true } },
          },
        });
        if (
          session?.user.status !== 'ACTIVE' ||
          session.user.deletedAt ||
          session.user.platformAccess?.status !== 'ACTIVE'
        )
          platformError('PLATFORM_ACCESS_REQUIRED', 'Platform access is unavailable.', 401);
        requirePlatformPermission(session.user.platformAccess.role, permission);
        if (session.user.platformAccess.role !== context.platformRole)
          platformError(
            'PLATFORM_ACCESS_REQUIRED',
            'The platform role changed. Reload your session.',
            401,
          );
        if (
          context.idempotencyKey &&
          (await tx.platformAuditLog.findUnique({
            where: {
              actorUserId_idempotencyKey: {
                actorUserId: context.userId,
                idempotencyKey: context.idempotencyKey,
              },
            },
            select: { id: true },
          }))
        )
          platformError(
            'PLATFORM_OPERATION_REPLAYED',
            'This operation already completed. Refresh the record before trying again.',
          );
        const outcome = await operation(tx);
        await this.appendAudit(
          tx,
          context,
          action,
          targetType,
          outcome.targetId ?? targetId,
          outcome.tenantId,
          reason,
          outcome.metadata,
          context.idempotencyKey,
        );
        return outcome.result;
      });
      this.logger.log({
        operation: action,
        platformActorUserId: context.userId,
        platformRole: context.platformRole,
        targetType,
        targetId,
        requestId: context.requestId,
        correlationId: context.correlationId,
        durationMs: Math.round(performance.now() - started),
        outcome: 'SUCCESS',
      });
      return result;
    } catch (error) {
      this.logger.warn({
        operation: action,
        platformActorUserId: context.userId,
        platformRole: context.platformRole,
        targetType,
        targetId,
        requestId: context.requestId,
        correlationId: context.correlationId,
        durationMs: Math.round(performance.now() - started),
        outcome: 'DENIED',
        errorCode: mutationErrorCode(error),
      });
      throw error;
    }
  }
  private appendAudit(
    tx: Prisma.TransactionClient,
    context: PlatformMutationContext,
    action: string,
    targetType: string,
    targetId?: string,
    tenantId?: string,
    reason?: string,
    metadata?: Prisma.InputJsonObject,
    idempotencyKey?: string,
  ) {
    const event = metadata?.event;
    return tx.platformAuditLog.create({
      data: {
        actorUserId: context.userId,
        actorRole: context.platformRole,
        action: typeof event === 'string' ? event : action,
        targetType,
        targetId: targetId ?? null,
        tenantId: tenantId ?? null,
        reason: reason ?? null,
        requestId: context.requestId ?? null,
        correlationId: context.correlationId ?? null,
        idempotencyKey: idempotencyKey ?? null,
        metadata: metadata ?? {},
      },
    });
  }
}
function mutationErrorCode(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return `DATABASE_${error.code}`;
  if (error && typeof error === 'object' && 'getResponse' in error) {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    if (
      response &&
      typeof response === 'object' &&
      'code' in response &&
      typeof response.code === 'string'
    )
      return response.code;
  }
  return error instanceof Error ? error.name : 'UnknownError';
}
function mapUser(row: UserRow, actor: PlatformPrincipal): PlatformUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    status: row.deletedAt ? 'DELETED' : row.status === 'INVITED' ? 'PENDING' : row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    memberships: row.memberships.map((membership) => ({
      id: membership.id,
      tenantId: membership.tenantId,
      tenantName: membership.tenant.name,
      role: membership.role,
      status: membership.status,
    })),
    protectedIdentity: row.platformAccess !== null,
    ...(actor.platformRole === 'SUPER_ADMIN'
      ? {
          platformAccess: row.platformAccess
            ? { role: row.platformAccess.role, status: row.platformAccess.status }
            : null,
        }
      : {}),
  };
}
function mapTenant(row: TenantRow, activeUserCount: number): PlatformTenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status === 'PENDING_DELETION' ? 'ARCHIVED' : row.status,
    vertical: row.vertical,
    timezone: row.businessProfile?.timezone ?? null,
    userCount: row._count.members,
    activeUserCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function mapAudit(row: Prisma.PlatformAuditLogGetPayload<Record<string, never>>): PlatformAudit {
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    actorRole: row.actorRole,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    tenantId: row.tenantId,
    reason: row.reason,
    requestId: row.requestId,
    correlationId: row.correlationId,
    outcome: row.outcome,
    createdAt: row.createdAt.toISOString(),
  };
}
async function revokeUserSessions(
  tx: Prisma.TransactionClient,
  userId: string,
  reason: string,
): Promise<void> {
  await tx.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  await tx.platformSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new BadRequestException('Supply a valid IANA timezone.');
  }
}
