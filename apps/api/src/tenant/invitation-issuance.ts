import { createHash, randomBytes } from 'node:crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { InvitationResponse, TenantRoleName } from '@vautrin/contracts';
import type { Prisma } from '@vautrin/database';

/** The single invitation issuance path for tenant members, CLI and platform operators. */
export async function issueTenantInvitation(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    email: string;
    role: TenantRoleName;
    actorUserId?: string;
    reissue?: boolean;
  },
): Promise<InvitationResponse> {
  const email = input.email.trim().toLowerCase();
  const tenant = await tx.tenant.findUnique({ where: { id: input.tenantId } });
  if (tenant?.status !== 'ACTIVE' || tenant.deletedAt)
    throw new ForbiddenException('Tenant is not active.');
  // Serialize same-email issuance even when no invitation or user exists yet.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:${email}`}, 0))`;
  const user = await tx.user.findUnique({
    where: { email },
    select: { id: true, status: true, deletedAt: true },
  });
  if (user?.status === 'DISABLED' || user?.deletedAt)
    throw new ForbiddenException('This identity cannot accept invitations.');
  if (user) {
    const membership = await tx.tenantUser.findUnique({
      where: { tenantId_userId: { tenantId: input.tenantId, userId: user.id } },
      select: { status: true },
    });
    if (membership?.status === 'ACTIVE' && user.status === 'ACTIVE')
      throw new ConflictException({
        code: 'MEMBERSHIP_ALREADY_EXISTS',
        message: 'This user is already an active member.',
      });
  }
  const pending = await tx.tenantInvitation.findFirst({
    where: {
      tenantId: input.tenantId,
      email,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (pending && !input.reissue)
    throw new ConflictException({
      code: 'INVITATION_ALREADY_PENDING',
      message: 'An invitation is already pending. Explicitly reissue it to replace the old link.',
    });
  await tx.tenantInvitation.updateMany({
    where: { tenantId: input.tenantId, email, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  const token = randomBytes(32).toString('base64url');
  const invitation = await tx.tenantInvitation.create({
    data: {
      tenantId: input.tenantId,
      email,
      role: input.role,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 7 * 86400000),
      invitedBy: input.actorUserId ?? null,
    },
    select: { id: true, expiresAt: true },
  });
  await tx.auditLog.createMany({
    data: {
      tenantId: input.tenantId,
      actorType: input.actorUserId ? 'USER' : 'SYSTEM',
      actorId: input.actorUserId ?? null,
      action: 'tenant.invitation.issued',
      resourceType: 'tenant_invitation',
      resourceId: invitation.id,
      metadata: { role: input.role },
    },
  });
  return { invitationId: invitation.id, token, expiresAt: invitation.expiresAt.toISOString() };
}
