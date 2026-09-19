/**
 * @vautrin/contracts — the shared API surface (SDD-02 §6).
 *
 * What belongs here: request schemas, response DTOs, event schemas and
 * public enums. What does not: domain entities, Prisma types, anything
 * framework-specific. SDD-02 §6 — "Frontend must not depend on backend
 * internal domain entities."
 *
 * These are plain types with no runtime dependency, so both a NestJS server
 * and a Nuxt browser bundle can import them. The API's DTO classes carry the
 * OpenAPI decorators and `implements` these interfaces, which means a change
 * to a response shape fails to compile on the server rather than silently
 * breaking the client.
 */

export * from './errors.js';
export * from './health.js';
