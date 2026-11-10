import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import {
  DUMMY_PASSWORD_DIGEST,
  generateRefreshToken,
  hashRefreshToken,
  verifyPassword,
} from '@vautrin/auth';
import type { Environment } from '@vautrin/config';
import type { PlatformPrincipal, PlatformSessionResponse } from '@vautrin/contracts';
import { ENVIRONMENT } from '../config/environment.module.js';
import { DatabaseService } from '../database/database.service.js';
import { PlatformRepository } from './platform.repository.js';
import { permissionsForPlatform, platformError } from './platform-policy.js';

export const ADMIN_COOKIE = 'vos_admin_session';
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

@Injectable()
export class PlatformAuthService {
  private readonly logger = new Logger(PlatformAuthService.name);
  constructor(
    private readonly repository: PlatformRepository,
    private readonly database: DatabaseService,
    @Inject(ENVIRONMENT) readonly environment: Environment,
  ) {}
  async login(
    email: string,
    password: string,
    requestId?: string,
  ): Promise<{ token: string; session: PlatformSessionResponse }> {
    // Verify the global identity through the existing identity store. The
    // restricted platform role never receives SELECT on password_hash.
    // nosemgrep: semgrep.vautrin-unscoped-database-access
    const user = await this.database.unscoped.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        status: true,
        deletedAt: true,
      },
    });
    const valid = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_DIGEST, password);
    if (!valid || !user?.passwordHash || user.status !== 'ACTIVE' || user.deletedAt)
      this.rejectLogin(requestId);
    const secret = generateRefreshToken();
    return this.repository.transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: user.id },
        select: { id: true, email: true, name: true, status: true, deletedAt: true },
      });
      const access = await tx.platformAccess.findUnique({ where: { userId: user.id } });
      if (current?.status !== 'ACTIVE' || current.deletedAt || access?.status !== 'ACTIVE')
        this.rejectLogin(requestId);
      const session = await tx.platformSession.create({
        data: {
          userId: current.id,
          tokenHash: secret.tokenHash,
          expiresAt: new Date(Date.now() + ADMIN_SESSION_SECONDS * 1000),
        },
        select: { id: true, expiresAt: true },
      });
      await tx.user.update({
        where: { id: current.id },
        data: { lastLoginAt: new Date() },
        select: { id: true },
      });
      await tx.platformAuditLog.create({
        data: {
          actorUserId: current.id,
          actorRole: access.role,
          action: 'platform.session.created',
          targetType: 'user',
          targetId: current.id,
          requestId: requestId ?? null,
        },
      });
      return {
        token: secret.token,
        session: {
          user: { id: current.id, name: current.name, email: current.email },
          platformRole: access.role,
          permissions: permissionsForPlatform(access.role),
          expiresAt: session.expiresAt.toISOString(),
        },
      };
    });
  }
  async authenticate(token: string | undefined): Promise<PlatformPrincipal> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      platformError('PLATFORM_ACCESS_REQUIRED', 'A platform-admin session is required.', 401);
    const session = await this.repository.read((db) =>
      db.platformSession.findUnique({
        where: { tokenHash: hashRefreshToken(token) },
        select: {
          id: true,
          userId: true,
          audience: true,
          expiresAt: true,
          revokedAt: true,
          user: { select: { status: true, deletedAt: true, platformAccess: true } },
        },
      }),
    );
    if (
      session?.audience !== 'platform-admin' ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== 'ACTIVE' ||
      session.user.deletedAt ||
      session.user.platformAccess?.status !== 'ACTIVE'
    )
      platformError(
        'PLATFORM_ACCESS_REQUIRED',
        'The platform-admin session is no longer valid.',
        401,
      );
    return {
      userId: session.userId,
      sessionId: session.id,
      platformRole: session.user.platformAccess.role,
      audience: 'platform-admin',
    };
  }
  session(principal: PlatformPrincipal): Promise<PlatformSessionResponse> {
    return this.repository.read(async (db) => {
      const session = await db.platformSession.findUniqueOrThrow({
        where: { id: principal.sessionId },
        select: {
          expiresAt: true,
          user: { select: { id: true, email: true, name: true } },
        },
      });
      return {
        user: session.user,
        platformRole: principal.platformRole,
        permissions: permissionsForPlatform(principal.platformRole),
        expiresAt: session.expiresAt.toISOString(),
      };
    });
  }
  async logout(token: string | undefined, requestId?: string): Promise<void> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    await this.repository.transaction(async (tx) => {
      const session = await tx.platformSession.findUnique({
        where: { tokenHash: hashRefreshToken(token) },
        select: {
          id: true,
          userId: true,
          revokedAt: true,
          user: { select: { platformAccess: true } },
        },
      });
      if (!session || session.revokedAt) return;
      await tx.platformSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      if (session.user.platformAccess)
        await tx.platformAuditLog.create({
          data: {
            actorUserId: session.userId,
            actorRole: session.user.platformAccess.role,
            action: 'platform.session.revoked',
            targetType: 'user',
            targetId: session.userId,
            requestId: requestId ?? null,
          },
        });
    });
  }
  private rejectLogin(requestId?: string): never {
    this.logger.warn({
      operation: 'platform.session.login',
      outcome: 'DENIED',
      errorCode: 'PLATFORM_ACCESS_REQUIRED',
      requestId,
    });
    throw new UnauthorizedException({
      code: 'PLATFORM_ACCESS_REQUIRED',
      message: 'Invalid credentials or platform access is unavailable.',
    });
  }
}
