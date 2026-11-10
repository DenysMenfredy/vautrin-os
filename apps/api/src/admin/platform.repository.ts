import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Environment } from '@vautrin/config';
import { createPrismaClient, type Prisma, type PrismaClient } from '@vautrin/database';
import { ENVIRONMENT } from '../config/environment.module.js';
import { platformError } from './platform-policy.js';

/** The only HTTP cross-tenant boundary. Never falls back to the schema owner. */
@Injectable()
export class PlatformRepository implements OnModuleInit, OnModuleDestroy {
  private readonly client: PrismaClient | null;
  constructor(@Inject(ENVIRONMENT) environment: Environment) {
    this.client = environment.DATABASE_PLATFORM_URL
      ? createPrismaClient({ url: environment.DATABASE_PLATFORM_URL })
      : null;
  }
  async onModuleInit(): Promise<void> {
    if (!this.client) return;
    await this.client.$connect();
    const [role] = await this.client.$queryRaw<
      Array<{
        name: string;
        unsafe: boolean;
        hasRoleMemberships: boolean;
        ownsPublicObjects: boolean;
      }>
    >`
      SELECT
        current_user::text AS name,
        (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit) AS unsafe,
        EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid) AS "hasRoleMemberships",
        EXISTS (
          SELECT 1 FROM pg_namespace
          WHERE nspname = 'public' AND nspowner = r.oid
          UNION ALL
          SELECT 1 FROM pg_class
          WHERE relnamespace = 'public'::regnamespace AND relowner = r.oid
        ) AS "ownsPublicObjects"
      FROM pg_roles AS r WHERE r.rolname = current_user
    `;
    if (
      role?.name !== 'vautrin_platform_admin' ||
      role.unsafe ||
      role.hasRoleMemberships ||
      role.ownsPublicObjects
    )
      throw new Error('DATABASE_PLATFORM_URL must use the restricted vautrin_platform_admin role.');
  }
  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }
  read<T>(operation: (client: PrismaClient) => Promise<T>): Promise<T> {
    if (!this.client)
      platformError('PLATFORM_UNAVAILABLE', 'Platform administration is not configured.', 503);
    return operation(this.client);
  }
  transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.read((client) =>
      client.$transaction(
        async (tx) => {
          // Consistent lock order covers session issuance, access changes and the
          // last-super-admin invariant across concurrent requests/processes.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(415007, 1)`;
          return operation(tx);
        },
        { timeout: 15000 },
      ),
    );
  }
}
