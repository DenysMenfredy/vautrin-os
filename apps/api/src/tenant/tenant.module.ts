import { Module } from '@nestjs/common';

import { TenantService } from './tenant.service.js';

/**
 * No controller yet. Tenant provisioning is a platform operation, not a
 * request-scoped one, and exposing it over HTTP needs a decision about who
 * may call it (self-service signup vs. operator-only) that V0.1 has not
 * made.
 */
@Module({
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}
