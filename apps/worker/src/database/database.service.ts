import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Environment } from '@vautrin/config';
import {
  assertTenantJobContext,
  createPrismaClient,
  type PrismaClient,
  type TenantJobContext,
  type TenantScopedClient,
  type WithTenantOptions,
  withTenant,
} from '@vautrin/database';

import { ENVIRONMENT } from '../config/environment.module.js';

/**
 * Owns the Prisma connection for the worker process.
 *
 * This differs from the API's equivalent on purpose. An HTTP request derives
 * its tenant from authenticated membership; a job has no ambient request at
 * all, so the tenant travels inside the payload and is validated on arrival.
 * SDD-05 §5: "A worker must never infer tenant context from mutable global
 * process state."
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly prisma: PrismaClient;

  constructor(@Inject(ENVIRONMENT) environment: Environment) {
    this.prisma = createPrismaClient({ url: environment.DATABASE_URL });
  }

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  /**
   * Runs `fn` under the tenant carried by a job payload.
   *
   * Validates the context first: a job whose payload lost its tenant must
   * fail loudly, not quietly execute against no tenant and appear to succeed
   * with zero rows.
   */
  withJobTenant<T>(
    context: unknown,
    fn: (tx: TenantScopedClient, context: TenantJobContext) => Promise<T>,
    options?: WithTenantOptions,
  ): Promise<T> {
    assertTenantJobContext(context);
    return withTenant(this.prisma, context.tenantId, (tx) => fn(tx, context), options);
  }

  /** Tenant-independent access. Health probes and platform maintenance only. */
  get unscoped(): PrismaClient {
    return this.prisma;
  }
}
