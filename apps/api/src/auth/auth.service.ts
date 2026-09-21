import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  capabilitiesFor,
  DUMMY_PASSWORD_DIGEST,
  type Role,
  signAccessToken,
  verifyPassword,
} from '@vautrin/auth';
import type { Environment } from '@vautrin/config';
import type {
  AuthTokensResponse,
  CurrentSessionResponse,
  TenantMembershipSummary,
} from '@vautrin/contracts';

import { AuditService } from '../audit/audit.service.js';
import { ENVIRONMENT } from '../config/environment.module.js';
import { DatabaseService } from '../database/database.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

export interface RequestContext {
  readonly userAgent?: string | undefined;
  readonly ipAddress?: string | undefined;
}

@Injectable()
export class AuthService {
  private readonly secret: Uint8Array;

  constructor(
    @Inject(ENVIRONMENT) environment: Environment,
    private readonly database: DatabaseService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly audit: AuditService,
  ) {
    this.secret = new TextEncoder().encode(environment.JWT_SECRET);
  }

  /**
   * Authenticates by email and password.
   *
   * Every failure returns the same error. Distinguishing "no such user"
   * from "wrong password" turns the login form into an account-enumeration
   * oracle, and the timing has to match too — see the dummy verification
   * below.
   */
  async login(
    email: string,
    password: string,
    context: RequestContext,
  ): Promise<AuthTokensResponse> {
    // Global lookup: authentication precedes any tenant (SDD-04 §3).
    const user = await this.database.unscoped.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    // Always verify something, so an unknown email costs the same as a
    // known one with a bad password.
    const digest = user?.passwordHash ?? DUMMY_PASSWORD_DIGEST;
    const passwordMatches = await verifyPassword(digest, password);

    if (!user?.passwordHash || !passwordMatches) {
      this.audit.recordAuthFailure({
        email,
        reason: user ? 'bad_password' : 'unknown_user',
        context,
      });
      throw new UnauthorizedException('Invalid email or password.');
    }

    if (user.status === 'DISABLED' || user.deletedAt !== null) {
      this.audit.recordAuthFailure({ email, reason: 'account_disabled', context });
      throw new UnauthorizedException('Invalid email or password.');
    }

    const memberships = await this.loadMemberships(user.id);
    // A user with exactly one tenant is placed in it, which is the common
    // case. With several, the client must choose explicitly (ADR-011).
    const active = memberships.length === 1 ? memberships[0] : undefined;

    const [accessToken, refreshToken] = await Promise.all([
      this.issueAccessToken(user.id, active),
      this.refreshTokens.issue({ userId: user.id, ...context }),
    ]);

    await this.database.unscoped.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.recordAuthSuccess({
      userId: user.id,
      tenantId: active?.tenantId,
      action: 'auth.login',
      context,
    });

    return {
      accessToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name },
      activeTenantId: active?.tenantId ?? null,
      memberships,
    };
  }

  /** Redeems a refresh token for a new pair (ADR-013 rotation). */
  async refresh(presentedToken: string, context: RequestContext): Promise<AuthTokensResponse> {
    const rotated = await this.refreshTokens.rotate(presentedToken, context);
    if (!rotated) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const user = await this.database.unscoped.user.findUnique({
      where: { id: rotated.userId },
    });

    if (!user || user.status === 'DISABLED' || user.deletedAt !== null) {
      // The account was disabled while the session was alive.
      await this.refreshTokens.revokeAllForUser(rotated.userId, 'account_disabled');
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const memberships = await this.loadMemberships(user.id);
    const active = memberships.length === 1 ? memberships[0] : undefined;

    return {
      accessToken: await this.issueAccessToken(user.id, active),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: rotated.token,
      user: { id: user.id, email: user.email, name: user.name },
      activeTenantId: active?.tenantId ?? null,
      memberships,
    };
  }

  async logout(presentedToken: string | undefined, userId: string | undefined): Promise<void> {
    if (presentedToken) await this.refreshTokens.revoke(presentedToken);
    if (userId) {
      await this.audit.recordAuthSuccess({ userId, action: 'auth.logout', context: {} });
    }
  }

  /**
   * Switches the active tenant.
   *
   * Membership is re-verified here rather than trusted from the request:
   * SDD-05 §2 — "A client-provided arbitrary tenant ID is never sufficient
   * authorization."
   */
  async switchTenant(
    userId: string,
    tenantId: string,
  ): Promise<{ accessToken: string; expiresIn: number; activeTenantId: string }> {
    const memberships = await this.loadMemberships(userId);
    const target = memberships.find((m) => m.tenantId === tenantId);

    if (!target) {
      // Same response whether the tenant does not exist or the user is not
      // a member, so this cannot be used to probe for tenants.
      throw new UnauthorizedException('No active membership for that tenant.');
    }

    return {
      accessToken: await this.issueAccessToken(userId, target),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      activeTenantId: target.tenantId,
    };
  }

  async currentSession(
    userId: string,
    activeTenantId: string | null,
    role: Role | null,
  ): Promise<CurrentSessionResponse> {
    const user = await this.database.unscoped.user.findUniqueOrThrow({ where: { id: userId } });
    const memberships = await this.loadMemberships(userId);

    return {
      user: { id: user.id, email: user.email, name: user.name },
      activeTenantId,
      role,
      capabilities: role ? [...capabilitiesFor(role)] : [],
      memberships,
    };
  }

  /**
   * Active memberships only — a revoked one must not grant a tenant.
   *
   * Runs under user context, not unscoped: `tenant_users` and `tenants`
   * are RLS-protected, and an unscoped read returns nothing. The policies
   * added in migration 20260919000600 expose exactly this person's own
   * memberships and no one else's.
   */
  private async loadMemberships(userId: string): Promise<TenantMembershipSummary[]> {
    const rows = await this.database.withUser(userId, (tx) =>
      tx.tenantUser.findMany({
        where: {
          userId,
          status: 'ACTIVE',
          tenant: { status: 'ACTIVE', deletedAt: null },
        },
        include: { tenant: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    );

    return rows.map((row) => ({
      tenantId: row.tenant.id,
      name: row.tenant.name,
      slug: row.tenant.slug,
      role: row.role,
    }));
  }

  private issueAccessToken(
    userId: string,
    membership: TenantMembershipSummary | undefined,
  ): Promise<string> {
    return signAccessToken({
      userId,
      secret: this.secret,
      ...(membership ? { tenantId: membership.tenantId, role: membership.role } : {}),
    });
  }
}
