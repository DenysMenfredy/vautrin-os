import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { CapabilityGuard } from './authz/capability.guard.js';
import { EnvironmentModule } from './config/environment.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { TenantModule } from './tenant/tenant.module.js';

/**
 * API composition root (ADR-002 — modular monolith).
 *
 * The backend module map in SDD-02 §4 (Business, Contact, Lead,
 * Conversation, Appointment, Estimate, Workflow, Agent, Knowledge,
 * Integration, Analytics) is added here as each backlog item lands.
 *
 * Both guards are registered globally, in order. That ordering is load-
 * bearing: JwtAuthGuard resolves identity, CapabilityGuard reads it.
 * Registering them globally means routes are protected by default and
 * opening one requires an explicit @Public() — the opposite arrangement
 * fails open when somebody forgets.
 */
@Module({
  imports: [EnvironmentModule, DatabaseModule, AuditModule, AuthModule, TenantModule, HealthModule],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CapabilityGuard },
  ],
})
export class AppModule {}
