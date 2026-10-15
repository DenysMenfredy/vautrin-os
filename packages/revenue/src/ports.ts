import type { TenantScopedClient, WithTenantOptions } from '@vautrin/database';

export interface RevenueDatabase {
  withTenant<T>(
    tenantId: string,
    work: (tx: TenantScopedClient) => Promise<T>,
    options?: WithTenantOptions,
  ): Promise<T>;
}
