/**
 * @vautrin/contracts — the shared API surface (SDD-02 §6).
 *
 * What belongs here: request schemas, response DTOs, event schemas and
 * public enums. What does not: domain entities, Prisma types, anything
 * framework-specific. SDD-02 §6 — "Frontend must not depend on backend
 * internal domain entities."
 *
 * Most exports are plain types; the Booking Rules V1 Zod schemas are shared
 * runtime validation contracts. Both a NestJS server and a Nuxt browser bundle
 * can import them. The API's DTO classes carry the
 * OpenAPI decorators and `implements` these interfaces, which means a change
 * to a response shape fails to compile on the server rather than silently
 * breaking the client.
 */

export * from './agents.js';
export * from './appointments.js';
export * from './auth.js';
export * from './booking-rules.js';
export * from './business.js';
export * from './contacts.js';
export * from './conversations.js';
export * from './errors.js';
export * from './events.js';
export * from './health.js';
export * from './leads.js';
export * from './workflow-policies.js';
export * from './workflows.js';
