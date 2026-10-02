import { createHash, randomBytes } from 'node:crypto';

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { hashPassword, type Role, verifyPassword } from '@vautrin/auth';
import type { InvitationResponse } from '@vautrin/contracts';

import { DatabaseService } from '../database/database.service.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVALID_INVITATION = 'Invalid or expired invitation.';

/** Operator- and capability-controlled account activation; never public signup. */
@Injectable()
export class InvitationService {
  constructor(private readonly database: DatabaseService) {}

  /** Invoked only by the local operator command, never by an HTTP route. */
  bootstrapTenant(input: {
    slug: string;
    name: string;
    ownerEmail: string;
    vertical?: string;
  }): Promise<{ tenantId: string } & InvitationResponse> {
    const email = normalizeEmail(input.ownerEmail);
    const secret = newInvitationSecret();

    // A new tenant can satisfy tenants' FORCE RLS policy by setting its
    // generated id as the transaction-local context before the INSERT.
    // nosemgrep: semgrep.vautrin-unscoped-database-access
    return this.database.unscoped.$transaction(async (tx) => {
      const [generated] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT uuidv7()::text AS id
      `;
      if (!generated) throw new Error('Failed to generate tenant id.');
      const tenantId = generated.id;
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      try {
        await tx.tenant.create({
          data: {
            id: tenantId,
            slug: input.slug,
            name: input.name,
            vertical: input.vertical ?? 'generic-local-business',
          },
        });
      } catch (error) {
        // This insert has only one caller-controlled unique field (slug).
        // Some Prisma adapters omit meta.target and report "(not available)",
        // so classify P2002 at this exact operation instead of relying on it.
        if (isUniqueViolation(error)) {
          throw new ConflictException(`Tenant slug "${input.slug}" is already taken.`);
        }
        throw error;
      }

      const invitation = await tx.tenantInvitation.create({
        data: {
          tenantId,
          email,
          role: 'OWNER',
          tokenHash: secret.hash,
          expiresAt: expiry(),
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: 'SYSTEM',
          action: 'tenant.invitation.issued',
          resourceType: 'tenant_invitation',
          resourceId: invitation.id,
          metadata: { bootstrap: true, role: 'OWNER' },
        },
      });
      return { tenantId, ...issuedInvitation(invitation, secret.token) };
    });
  }

  /** Recovery for an unclaimed tenant; callable from the operator command only. */
  reissueBootstrapOwner(input: {
    tenantId: string;
    ownerEmail: string;
  }): Promise<InvitationResponse> {
    const email = normalizeEmail(input.ownerEmail);
    const secret = newInvitationSecret();
    return this.database.withTenant(input.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: input.tenantId } });
      if (tenant?.status !== 'ACTIVE' || tenant.deletedAt) {
        throw new ForbiddenException('Tenant is not active.');
      }
      const activeOwner = await tx.tenantUser.findFirst({
        where: { tenantId: input.tenantId, role: 'OWNER', status: 'ACTIVE' },
        select: { id: true },
      });
      if (activeOwner) {
        throw new ConflictException('Tenant already has an active owner.');
      }
      await tx.tenantInvitation.updateMany({
        where: {
          tenantId: input.tenantId,
          role: 'OWNER',
          acceptedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      const invitation = await tx.tenantInvitation.create({
        data: {
          tenantId: input.tenantId,
          email,
          role: 'OWNER',
          tokenHash: secret.hash,
          expiresAt: expiry(),
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorType: 'SYSTEM',
          action: 'tenant.invitation.reissued',
          resourceType: 'tenant_invitation',
          resourceId: invitation.id,
          metadata: { bootstrap: true, role: 'OWNER' },
        },
      });
      return issuedInvitation(invitation, secret.token);
    });
  }

  /** A member.manage principal may invite into *their active tenant* only. */
  invite(input: {
    tenantId: string;
    actorUserId: string;
    actorRole: Role;
    email: string;
    role: Role;
  }): Promise<InvitationResponse> {
    if (input.role === 'OWNER' && input.actorRole !== 'OWNER') {
      throw new ForbiddenException('Only an owner may invite another owner.');
    }
    const email = normalizeEmail(input.email);
    const secret = newInvitationSecret();

    return this.database.withTenant(input.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: input.tenantId } });
      if (tenant?.status !== 'ACTIVE' || tenant.deletedAt) {
        throw new ForbiddenException('Tenant is not active.');
      }

      const user = await tx.user.findUnique({
        where: { email },
        select: { id: true, status: true },
      });
      if (user) {
        const membership = await tx.tenantUser.findUnique({
          where: { tenantId_userId: { tenantId: input.tenantId, userId: user.id } },
          select: { status: true },
        });
        if (membership?.status === 'ACTIVE' && user.status === 'ACTIVE') {
          throw new ConflictException('This user is already an active member.');
        }
      }

      // Reissuing an invitation invalidates old links without removing audit
      // history; all writes stay inside the same tenant transaction.
      await tx.tenantInvitation.updateMany({
        where: { tenantId: input.tenantId, email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const invitation = await tx.tenantInvitation.create({
        data: {
          tenantId: input.tenantId,
          email,
          role: input.role,
          tokenHash: secret.hash,
          expiresAt: expiry(),
          invitedBy: input.actorUserId,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorType: 'USER',
          actorId: input.actorUserId,
          action: 'tenant.invitation.issued',
          resourceType: 'tenant_invitation',
          resourceId: invitation.id,
          metadata: { role: input.role },
        },
      });
      return issuedInvitation(invitation, secret.token);
    });
  }

  /** Public endpoint: token proves the invitation; password proves identity. */
  async accept(input: { token: string; password: string; name?: string }): Promise<void> {
    const tokenHash = digest(input.token);
    // This function reveals only the tenant id for a valid, live digest. It
    // is the single pre-tenant discovery step; all row access below uses RLS.
    // nosemgrep: semgrep.vautrin-unscoped-database-access
    const [target] = await this.database.unscoped.$queryRaw<Array<{ tenant_id: string | null }>>`
      SELECT app.invitation_tenant(${tokenHash}) AS tenant_id
    `;
    const tenantId = target?.tenant_id;
    if (!tenantId) throw new UnauthorizedException(INVALID_INVITATION);

    await this.database.withTenant(tenantId, async (tx) => {
      const invitation = await tx.tenantInvitation.findUnique({ where: { tokenHash } });
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (
        !invitation ||
        invitation.acceptedAt ||
        invitation.revokedAt ||
        invitation.expiresAt <= new Date() ||
        tenant?.status !== 'ACTIVE' ||
        tenant.deletedAt
      ) {
        throw new UnauthorizedException(INVALID_INVITATION);
      }

      const existing = await tx.user.findUnique({ where: { email: invitation.email } });
      if (existing?.status === 'DISABLED' || existing?.deletedAt) {
        throw new UnauthorizedException(INVALID_INVITATION);
      }
      // For an existing account the supplied password must match; accepting
      // an invite must never reset that account's credentials. New invitees
      // create their own password at acceptance.
      if (existing?.passwordHash) {
        if (!(await verifyPassword(existing.passwordHash, input.password))) {
          throw new UnauthorizedException(INVALID_INVITATION);
        }
      }

      const existingMembership = existing
        ? await tx.tenantUser.findUnique({
            where: { tenantId_userId: { tenantId: invitation.tenantId, userId: existing.id } },
          })
        : null;
      if (existingMembership?.status === 'ACTIVE' && existing?.status === 'ACTIVE') {
        throw new ConflictException('This user is already an active member.');
      }

      // Compare-and-set is the replay boundary. A concurrent acceptance can
      // read the row, but only one transaction may change it from pending.
      const consumed = await tx.tenantInvitation.updateMany({
        where: {
          id: invitation.id,
          tenantId: invitation.tenantId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { acceptedAt: new Date() },
      });
      if (consumed.count !== 1) throw new UnauthorizedException(INVALID_INVITATION);

      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              status: 'ACTIVE',
              ...(!existing.passwordHash
                ? { passwordHash: await hashPassword(input.password) }
                : {}),
              ...(!existing.name && input.name ? { name: input.name } : {}),
            },
          })
        : await tx.user.create({
            data: {
              email: invitation.email,
              name: input.name ?? null,
              passwordHash: await hashPassword(input.password),
              status: 'ACTIVE',
            },
          });

      await tx.tenantUser.upsert({
        where: { tenantId_userId: { tenantId: invitation.tenantId, userId: user.id } },
        update: { role: invitation.role, status: 'ACTIVE' },
        create: {
          tenantId: invitation.tenantId,
          userId: user.id,
          role: invitation.role,
          status: 'ACTIVE',
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: invitation.tenantId,
          actorType: 'USER',
          actorId: user.id,
          action: 'tenant.invitation.accepted',
          resourceType: 'tenant_invitation',
          resourceId: invitation.id,
          metadata: { role: invitation.role },
        },
      });
    });
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newInvitationSecret(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: digest(token) };
}

function expiry(): Date {
  return new Date(Date.now() + INVITATION_TTL_MS);
}

function issuedInvitation(
  invitation: { id: string; expiresAt: Date },
  token: string,
): InvitationResponse {
  return { invitationId: invitation.id, token, expiresAt: invitation.expiresAt.toISOString() };
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  return candidate.code === 'P2002';
}
