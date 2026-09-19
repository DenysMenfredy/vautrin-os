import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Environment } from '@vautrin/config';
import {
  assertEmbeddingDimensions,
  createPrismaClient,
  type PrismaClient,
  type TenantScopedClient,
  withTenant,
} from '@vautrin/database';

import { ENVIRONMENT } from '../config/environment.module.js';

/**
 * Owns the Prisma connection for the API process.
 *
 * The shape of this class is deliberate. `withTenant` is the prominent method
 * and `unscoped` is the awkwardly named one, because tenant-scoped access
 * should be the path of least resistance — AGENTS.md §3: "Every repository
 * query must be tenant-aware."
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly prisma: PrismaClient;

  constructor(@Inject(ENVIRONMENT) environment: Environment) {
    // Connects as the least-privileged role, which RLS constrains (ADR-005).
    this.prisma = createPrismaClient({ url: environment.DATABASE_URL });
  }

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    // Fail at boot if the embedding column and EMBEDDING_DIMENSIONS disagree,
    // rather than deep inside the embedding pipeline later (SDD-04 §2).
    await assertEmbeddingDimensions(this.prisma);
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  /**
   * Runs `fn` with PostgreSQL tenant context set, inside one transaction.
   * This is the supported way to reach tenant-scoped data (SDD-05 §3).
   */
  withTenant<T>(tenantId: string, fn: (tx: TenantScopedClient) => Promise<T>): Promise<T> {
    return withTenant(this.prisma, tenantId, fn);
  }

  /**
   * The raw client, with no tenant context.
   *
   * Valid only for genuinely tenant-independent work: health probes and the
   * authentication lookup that has to find a user before any tenant is known.
   * Tenant-scoped tables return zero rows through it, by design.
   */
  get unscoped(): PrismaClient {
    return this.prisma;
  }
}
