import { Injectable, Logger } from '@nestjs/common';

import { DatabaseService } from '../database/database.service.js';

/**
 * Writes audit records (FR-013, SDD-09 §10).
 *
 * SDD-09 §10 requires auditing authentication, authorization, AI tools,
 * integrations, workflow activation and customer mutations. This covers the
 * authentication half; the rest is added as those modules land.
 *
 * Audit writes must never break the operation they describe — a failure to
 * record a login is a monitoring problem, not a reason to deny the login.
 * Every method here swallows its errors and logs them instead.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly database: DatabaseService) {}

  async recordAuthSuccess(input: {
    userId: string;
    tenantId?: string | undefined;
    action: string;
    context: { userAgent?: string | undefined; ipAddress?: string | undefined };
  }): Promise<void> {
    // audit_logs is tenant-scoped, so a pre-tenant event (a login by a user
    // with no membership) has nowhere to go. Those are logged, not dropped
    // silently, and get a row once a tenant is known.
    if (!input.tenantId) {
      this.logger.log(`${input.action} user=${input.userId} (no active tenant)`);
      return;
    }

    await this.write(input.tenantId, {
      actorType: 'USER',
      actorId: input.userId,
      action: input.action,
      outcome: 'SUCCESS',
      ipAddress: input.context.ipAddress ?? null,
      userAgent: input.context.userAgent ?? null,
    });
  }

  /**
   * Records a failed authentication.
   *
   * Note what is NOT stored: the submitted password, and the email when the
   * user is unknown. A table of attempted emails is itself a disclosure,
   * and SDD-09 §8 says not to log unnecessary PII. The reason code is
   * enough to spot a credential-stuffing run.
   */
  recordAuthFailure(input: {
    email: string;
    reason: string;
    context: { userAgent?: string | undefined; ipAddress?: string | undefined };
  }): void {
    this.logger.warn(
      `auth.login.failed reason=${input.reason} ip=${input.context.ipAddress ?? 'unknown'}`,
    );
  }

  /** Records a denied authorization check (SDD-09 §10). */
  async recordAccessDenied(input: {
    tenantId: string;
    userId: string;
    action: string;
    resourceType?: string | undefined;
  }): Promise<void> {
    await this.write(input.tenantId, {
      actorType: 'USER',
      actorId: input.userId,
      action: input.action,
      outcome: 'DENIED',
      resourceType: input.resourceType ?? null,
    });
  }

  private async write(
    tenantId: string,
    data: {
      actorType: 'USER' | 'AGENT' | 'SYSTEM' | 'INTEGRATION';
      actorId: string | null;
      action: string;
      outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
      resourceType?: string | null;
      ipAddress?: string | null;
      userAgent?: string | null;
    },
  ): Promise<void> {
    try {
      await this.database.withTenant(tenantId, (tx) =>
        tx.auditLog.create({ data: { tenantId, ...data } }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to write audit record "${data.action}" for tenant ${tenantId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
