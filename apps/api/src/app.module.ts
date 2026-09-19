import { Module } from '@nestjs/common';

import { EnvironmentModule } from './config/environment.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';

/**
 * API composition root (ADR-002 — modular monolith).
 *
 * The backend module map in SDD-02 §4 (Auth, Tenant, Business, Contact, Lead,
 * Conversation, Appointment, Estimate, Workflow, Agent, Knowledge,
 * Integration, Analytics, Audit) is added here module by module as each
 * backlog item lands. Only infrastructure is wired so far.
 */
@Module({
  imports: [EnvironmentModule, DatabaseModule, HealthModule],
})
export class AppModule {}
