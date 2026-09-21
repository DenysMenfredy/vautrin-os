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
    userAgent?: string | undefined;
    ipAddress?: string | undefined;
  }): Promise<string> {
    const { token, tokenHash } = generateRefreshToken();

    await this.database.unscoped.refreshToken.create({
      data: {
        userId: input.userId,
        tokenHash,
        familyId: randomUUID(),
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
  ): Promise<{ userId: string; token: string } | null> {
    const presentedHash = hashRefreshToken(presentedToken);

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

    // One transaction: a crash between creating the successor and marking
    // the predecessor replaced would leave two live tokens in the family,
    // and the next legitimate refresh would look like reuse.
    await this.database.unscoped.$transaction(async (tx) => {
      const successor = await tx.refreshToken.create({
        data: {
          userId: existing.userId,
          tokenHash,
          familyId: existing.familyId,
          expiresAt: refreshTokenExpiry(),
          userAgent: context.userAgent ?? null,
          ipAddress: context.ipAddress ?? null,
        },
      });

      await tx.refreshToken.update({
        where: { id: existing.id },
        data: {
          usedAt: new Date(),
          revokedAt: new Date(),
          revokedReason: 'rotated',
          replacedById: successor.id,
        },
      });
    });

    return { userId: existing.userId, token };
  }

  /** Revokes a single token. Used on logout. */
  async revoke(presentedToken: string): Promise<void> {
    await this.database.unscoped.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(presentedToken), revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'logout' },
    });
  }

  /** Revokes every live token in a family. */
  async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.database.unscoped.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Revokes every live token for a user. For password changes and lockout. */
  async revokeAllForUser(userId: string, reason: string): Promise<number> {
    const { count } = await this.database.unscoped.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }
}
