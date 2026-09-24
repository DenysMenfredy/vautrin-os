export { createRedisConnection } from './redis-connection.js';

/** ADR-009's four logical queues, shared by producers and the worker. */
export const QUEUE = {
  WORKFLOW: 'workflow',
  AI: 'ai',
  NOTIFICATIONS: 'notifications',
  WEBHOOKS: 'webhooks',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];
export const ALL_QUEUES: readonly QueueName[] = Object.values(QUEUE);
export const DOMAIN_EVENT_JOB = 'domain.event';

/** Bounded retry policy for jobs; each side effect still needs idempotency. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 24 * 3_600 },
} as const;

/** SDD-05 §5: every job names the tenant and carries trace/actor data. */
export interface TenantQueueJob {
  readonly tenantId: string;
  readonly correlationId?: string;
  readonly actorId?: string;
  readonly actorType?: 'USER' | 'AGENT' | 'SYSTEM' | 'INTEGRATION';
  readonly idempotencyKey?: string;
}

/** A durable outbox event delivered to a future workflow processor. */
export interface DurableEventJob extends TenantQueueJob {
  readonly eventId: string;
}

/** Stable across crashes, retries, and competing dispatchers. */
export function durableEventJobId(eventId: string): string {
  if (!isUuid(eventId)) throw new Error('eventId must be a UUID.');
  return `event-${eventId}`;
}

export function assertDurableEventJob(value: unknown): asserts value is DurableEventJob {
  if (!isRecord(value) || !isUuid(value.tenantId) || !isUuid(value.eventId)) {
    throw new Error('A durable event job requires tenantId and eventId UUIDs.');
  }
  if (value.correlationId !== undefined && !isUuid(value.correlationId)) {
    throw new Error('correlationId must be a UUID.');
  }
  if (value.actorId !== undefined && !isUuid(value.actorId)) {
    throw new Error('actorId must be a UUID.');
  }
  if (value.idempotencyKey !== undefined && typeof value.idempotencyKey !== 'string') {
    throw new Error('idempotencyKey must be a string.');
  }
  if (
    value.actorType !== undefined &&
    !['USER', 'AGENT', 'SYSTEM', 'INTEGRATION'].includes(String(value.actorType))
  ) {
    throw new Error('actorType is invalid.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
