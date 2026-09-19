import { defineIntegrationTestConfig } from '@vautrin/testing';

/**
 * Integration tests — require PostgreSQL from infra/docker-compose.yml
 * and migrations applied (SDD-11 §3, §4).
 */
export default defineIntegrationTestConfig();
