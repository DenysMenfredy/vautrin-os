import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { generateRefreshToken, hashRefreshToken, refreshTokenExpiry } from '@vautrin/auth';

import { DatabaseService } from '../database/database.service.js';

/**
 * Issues, rotates and revokes refresh tokens (ADR-013).
 *
 * Uses `unscoped` throughout, and that is correct here rather than a
 * shortcut: refresh tokens are global like users (SDD-04 §3 "Global
 * tables") and are redeemed before any tenant is known, so there is no
 * tenant context to run under.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(private readonly database: DatabaseService) {}

  /** Starts a new token family. Called on login. */
  async issue(input: {
    userId: string;
    activeTenantId?: string | null | undefined;
    userAgent?: string | undefined;
    ipAddress?: string | undefined;
  }): Promise<string> {
    const { token, tokenHash } = generateRefreshToken();

    // ADR-013: refresh tokens are global, user-scoped session records.
    // nosemgrep: semgrep.vautrin-unscoped-database-access
    await this.database.unscoped.refreshToken.create({
      data: {
        userId: input.userId,
        tokenHash,
        familyId: randomUUID(),
        activeTenantId: input.activeTenantId ?? null,
        expiresAt: refreshTokenExpiry(),
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
      },
    });

    return token;
  }

  /**
   * Redeems a refresh token and issues its successor.
   *
   * Returns null when the token is unusable, without saying why — the
   * caller turns that into a single 401 so an attacker cannot distinguish
   * "expired" from "revoked" from "never existed".
   *
   * Reuse detection: presenting a token that has already been rotated means
   * someone holds a copy that should have been discarded. The only safe
   * reading is that the family leaked, so every token in it is revoked and
   * both the attacker and the legitimate user are forced to log in again.
   */
  async rotate(
    presentedToken: string,
    context: { userAgent?: string | undefined; ipAddress?: string | undefined },
  ): Promise<{ userId: string; token: string; activeTenantId: string | null } | null> {
    const presentedHash = hashRefreshToken(presentedToken);

    // ADR-013: redeem by token digest before any active tenant is known.
    // nosemgrep: semgrep.vautrin-unscoped-database-access
    const existing = await this.database.unscoped.refreshToken.findUnique({
      where: { tokenHash: presentedHash },
    });

    if (!existing) return null;

    if (existing.revokedAt !== null || existing.replacedById !== null) {
      await this.revokeFamily(existing.familyId, 'reuse_detected');
      this.logger.warn(
        `Refresh token reuse detected for user ${existing.userId}; ` +
          `revoked family ${existing.familyId}`,
      );
      return null;
    }

    if (existing.expiresAt.getTime() <= Date.now()) return null;

    const { token, tokenHash } = generateRefreshToken();
    const successorId = randomUUID();
    let claimed = false;

    // The predecessor claim is a compare-and-set. The conditional UPDATE is
    // the security boundary: PostgreSQL serializes concurrent updates to this
    // row, and exactly one transaction can observe count=1. The losing
    // transaction rolls back its candidate successor and then invokes the
    // family reuse policy below.
    // ADR-013: this transaction accesses only the global refresh_tokens table.
    // nosemgrep: semgrep.vautrin-unscoped-database-access
    await this.database.unscoped
      .$transaction(async (tx) => {
        const successor = await tx.refreshToken.create({
          data: {
            id: successorId,
            userId: existing.userId,
            tokenHash,
            familyId: existing.familyId,
            activeTenantId: existing.activeTenantId,
            expiresAt: refreshTokenExpiry(),
            userAgent: context.userAgent ?? null,
            ipAddress: context.ipAddress ?? null,
          },
        });

        const result = await tx.refreshToken.updateMany({
          where: {
            id: existing.id,
            revokedAt: null,
            replacedById: null,
            expiresAt: { gt: new Date() },
          },
          data: {
            usedAt: new Date(),
            revokedAt: new Date(),
            revokedReason: 'rotated',
            replacedById: successor.id,
          },
        });

        claimed = result.count === 1;
        if (!claimed) {
          // Throwing rolls back the candidate successor. The caller applies
          // reuse detection after the transaction has released the row lock.
          throw new ConcurrentRefreshClaimError();
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof ConcurrentRefreshClaimError)) throw error;
      });

    if (!claimed) {
      await this.revokeFamily(existing.familyId, 'reuse_detected');
      this.logger.warn(
        `Refresh token reuse detected for user ${existing.userId}; ` +
          `revoked family ${existing.familyId}`,
      );
      return null;
    }

    return { userId: existing.userId, token, activeTenantId: existing.activeTenantId };
  }

  /** Updates the active tenant for every live token in one session family. */
  async setActiveTenant(
    userId: string,
    activeTenantId: string,
    presentedToken?: string | undefined,
  ): Promise<void> {
    // A browser presents the current refresh cookie. Updating the family keeps
    // a just-rotated successor consistent. API clients without a cookie use
    // the user's live sessions as the fallback, after membership validation.
    if (presentedToken) {
      // nosemgrep: semgrep.vautrin-unscoped-database-access
      const session = await this.database.unscoped.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(presentedToken) },
        select: { userId: true, familyId: true },
      });
      if (session?.userId !== userId) return;

      // nosemgrep: semgrep.vautrin-unscoped-database-access
      await this.database.unscoped.refreshToken.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { activeTenantId },
      });
      return;
    }

    // nosemgrep: semgrep.vautrin-unscoped-database-access
    await this.database.unscoped.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { activeTenantId },
    });
  }

  /** Stores the membership-validated tenant on the newly issued successor. */
  async setActiveTenantForToken(
    userId: string,
    token: string,
    activeTenantId: string | null,
  ): Promise<void> {
    // nosemgrep: semgrep.vautrin-unscoped-database-access
    await this.database.unscoped.refreshToken.updateMany({
      where: { userId, tokenHash: hashRefreshToken(token), revokedAt: null },
      data: { activeTenantId },
    });
  }

  /** Revokes sessions currently scoped to a membership being removed. */
  async revokeForMembership(userId: string, tenantId: string, reason: string): Promise<number> {
    // nosemgrep: semgrep.vautrin-unscoped-database-access
    const { count } = await this.database.unscoped.refreshToken.updateMany({
      where: { userId, activeTenantId: tenantId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  /** Revokes a single token. Used on logout. */
  async revoke(presentedToken: string): Promise<void> {
    // ADR-013: logout revokes a global session using its presented digest.
    // nosemgrep: semgrep.vautrin-unscoped-database-access
    await this.database.unscoped.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(presentedToken), revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'logout' },
    });
  }

  /** Revokes every live token in a family. */
  async revokeFamily(familyId: string, reason: string): Promise<void> {
    // ADR-013: a token family spans active-tenant selections for one user.
    // nosemgrep: semgrep.vautrin-unscoped-database-access
    await this.database.unscoped.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Revokes every live token for a user. For password changes and lockout. */
  async revokeAllForUser(userId: string, reason: string): Promise<number> {
    // ADR-013: account-wide revocation must cover all of the user's sessions.
    // nosemgrep: semgrep.vautrin-unscoped-database-access
    const { count } = await this.database.unscoped.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }
}

class ConcurrentRefreshClaimError extends Error {
  override readonly name = 'ConcurrentRefreshClaimError';
}
