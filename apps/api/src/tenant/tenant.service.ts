import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hashPassword, type Role } from '@vautrin/auth';

import { DatabaseService } from '../database/database.service.js';

/**
 * Tenant provisioning and membership (VOS-031, VOS-032).
 *
 * Provisioning looks like it needs to bypass RLS — the policy on `tenants`
 * is `id = app.current_tenant_id()`, so a row cannot insert itself under an
 * empty context. It does not. Generating the id first and setting the
 * tenant context to that id makes the policy's WITH CHECK pass, so the
 * whole flow runs as the least-privileged role.
 *
 * That matters: the alternative is handing the API process a connection
 * that bypasses RLS entirely, which is a much larger thing to get wrong
 * than a slightly awkward insert.
 */
@Injectable()
export class TenantService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Creates a tenant together with its first owner.
   *
   * One transaction: a tenant with no owner is unreachable — nobody can log
   * in to it and nobody can grant membership — so a half-completed
   * provisioning is worse than none.
   */
  async provision(input: {
    slug: string;
    name: string;
    vertical?: string;
    owner: { email: string; password: string; name?: string };
  }): Promise<{ tenantId: string; userId: string }> {
    const email = input.owner.email.toLowerCase().trim();
    const passwordHash = await hashPassword(input.owner.password);

    try {
      return await this.createTenantWithOwner(input, email, passwordHash);
    } catch (error) {
      // A slug collision cannot be pre-checked: RLS hides other tenants
      // from this role, which is the point. The unique index is the real
      // guard, and it is also race-free — a pre-check would not be.
      if (isUniqueViolation(error, 'slug')) {
        throw new ConflictException(`Tenant slug "${input.slug}" is already taken.`);
      }
      throw error;
    }
  }

  private async createTenantWithOwner(
    input: {
      slug: string;
      name: string;
      vertical?: string;
      owner: { email: string; password: string; name?: string };
    },
    email: string,
    passwordHash: string,
  ): Promise<{ tenantId: string; userId: string }> {
    // SDD-05 §4: bootstrap sets transaction-local tenant context below before
    // any tenant write; the connection still uses the RLS-constrained role.
    // nosemgrep: semgrep.vautrin-unscoped-database-access
    return await this.database.unscoped.$transaction(async (tx) => {
      // Ask the database for the id so UUIDv7 generation stays in one place
      // (SDD-04 §5), then adopt it as the tenant context for this
      // transaction. `true` scopes the setting to the transaction, so it
      // cannot leak onto a pooled connection (SDD-05 §4).
      const [generated] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT uuidv7()::text AS id
      `;
      const tenantId = generated?.id;
      if (!tenantId) throw new Error('Failed to generate a tenant id.');

      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const tenant = await tx.tenant.create({
        data: {
          id: tenantId,
          slug: input.slug,
          name: input.name,
          vertical: input.vertical ?? 'generic-local-business',
        },
      });

      // An existing person joining a new tenant keeps their credentials.
      const user = await tx.user.upsert({
        where: { email },
        update: {},
        create: {
          email,
          name: input.owner.name ?? null,
          passwordHash,
          status: 'ACTIVE',
        },
      });

      await tx.tenantUser.create({
        data: { tenantId: tenant.id, userId: user.id, role: 'OWNER', status: 'ACTIVE' },
      });

      return { tenantId: tenant.id, userId: user.id };
    });
  }

  /** Adds a member to an existing tenant. */
  async addMember(input: {
    tenantId: string;
    email: string;
    role: Role;
    password?: string;
    name?: string;
  }): Promise<{ userId: string }> {
    const email = input.email.toLowerCase().trim();

    const [tenant] = await this.database.withTenant(input.tenantId, (tx) =>
      tx.tenant.findMany({ where: { id: input.tenantId }, select: { id: true } }),
    );
    if (!tenant) throw new NotFoundException('Tenant not found.');

    const passwordHash = input.password ? await hashPassword(input.password) : null;

    // tenant_users is tenant-scoped, so this must run under tenant context.
    return this.database.withTenant(input.tenantId, async (tx) => {
      const user = await tx.user.upsert({
        where: { email },
        update: {},
        create: {
          email,
          name: input.name ?? null,
          passwordHash,
          // No password means an invitation that has not been accepted.
          status: passwordHash ? 'ACTIVE' : 'INVITED',
        },
      });

      await tx.tenantUser.upsert({
        where: { tenantId_userId: { tenantId: input.tenantId, userId: user.id } },
        update: { role: input.role, status: 'ACTIVE' },
        create: {
          tenantId: input.tenantId,
          userId: user.id,
          role: input.role,
          status: 'ACTIVE',
        },
      });

      return { userId: user.id };
    });
  }

  /**
   * Revokes a membership and its relevant sessions as one security use case.
   *
   * The access token keeps working until it expires (ADR-013). Revoking the
   * active-tenant refresh sessions here prevents them from minting a fresh
   * token for the removed tenant, and the audit record commits with the same
   * transaction as the membership change.
   */
  async revokeMembership(
    tenantId: string,
    userId: string,
    actorUserId?: string | undefined,
  ): Promise<void> {
    // This operation intentionally uses one transaction over tenant-scoped
    // and global tables. It does not use the AuditService because that service
    // is best-effort for ordinary telemetry; membership revocation requires a
    // durable atomic security record.
    // nosemgrep: semgrep.vautrin-unscoped-database-access
    await this.database.unscoped.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const membership = await tx.tenantUser.findFirst({
        where: { tenantId, userId },
        select: { id: true },
      });
      if (!membership) throw new NotFoundException('Membership not found.');

      await tx.tenantUser.update({
        where: { id: membership.id },
        data: { status: 'REVOKED' },
      });

      await tx.refreshToken.updateMany({
        where: { userId, activeTenantId: tenantId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'membership_revoked' },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: actorUserId ? 'USER' : 'SYSTEM',
          actorId: actorUserId ?? null,
          action: 'tenant.membership.revoked',
          outcome: 'SUCCESS',
          resourceType: 'tenant_membership',
          resourceId: membership.id,
          metadata: { revokedUserId: userId },
        },
      });
    });
  }
}

/**
 * Whether an error is a Prisma unique-constraint violation on a field.
 *
 * Matched structurally rather than by `instanceof`, so this does not need
 * to import Prisma's error classes into the domain-facing layer.
 */
function isUniqueViolation(error: unknown, field: string): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== 'P2002') return false;

  const target = candidate.meta?.target;
  if (Array.isArray(target)) return target.includes(field);
  return typeof target === 'string' && target.includes(field);
}
