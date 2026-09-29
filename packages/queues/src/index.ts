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
export const SEND_MESSAGE_JOB = 'message.send';
export const WORKFLOW_RUN_JOB = 'workflow.run';

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

export interface SendMessageJob extends TenantQueueJob {
  readonly messageId: string;
}

export type WorkflowRunJob = TenantQueueJob &
  (
    | { readonly runId: string; readonly action: 'start' }
    | { readonly runId: string; readonly action: 'wake'; readonly stepId: string }
    | {
        readonly runId: string;
        readonly action: 'retry';
        readonly stepId: string;
        readonly attempt: number;
      }
  );

export function sendMessageJobId(messageId: string): string {
  if (!isUuid(messageId)) throw new Error('messageId must be a UUID.');
  return `message-${messageId}`;
}

export function workflowRunJobId(job: WorkflowRunJob): string {
  if (!isUuid(job.runId)) throw new Error('runId must be a UUID.');
  if (job.action === 'wake') {
    if (!isStepId(job.stepId)) throw new Error('stepId is invalid.');
    return `workflow-${job.runId}-wake-${job.stepId}`;
  }
  if (job.action === 'retry') {
    if (!isStepId(job.stepId)) throw new Error('stepId is invalid.');
    if (!Number.isSafeInteger(job.attempt) || job.attempt < 2 || job.attempt > 10) {
      throw new Error('attempt must be an integer from 2 to 10.');
    }
    return `workflow-${job.runId}-retry-${job.stepId}-${job.attempt}`;
  }
  if (job.action !== 'start') throw new Error('workflow action is invalid.');
  return `workflow-${job.runId}-start`;
}

export function assertWorkflowRunJob(value: unknown): asserts value is WorkflowRunJob {
  if (!isRecord(value) || !isUuid(value.tenantId) || !isUuid(value.runId)) {
    throw new Error('A workflow run job requires tenantId and runId UUIDs.');
  }
  if (value.action === 'wake') {
    if (!isStepId(value.stepId)) throw new Error('A workflow wake job requires a valid stepId.');
  } else if (value.action === 'retry') {
    if (!isStepId(value.stepId)) throw new Error('A workflow retry job requires a valid stepId.');
    if (
      !Number.isSafeInteger(value.attempt) ||
      Number(value.attempt) < 2 ||
      Number(value.attempt) > 10
    ) {
      throw new Error('A workflow retry job requires an attempt from 2 to 10.');
    }
  } else if (value.action !== 'start' || value.stepId !== undefined) {
    throw new Error('Workflow run action is invalid.');
  }
  if (value.correlationId !== undefined && !isUuid(value.correlationId)) {
    throw new Error('correlationId must be a UUID.');
  }
  if (value.idempotencyKey !== undefined && typeof value.idempotencyKey !== 'string') {
    throw new Error('idempotencyKey must be a string.');
  }
}

export function assertSendMessageJob(value: unknown): asserts value is SendMessageJob {
  if (!isRecord(value) || !isUuid(value.tenantId) || !isUuid(value.messageId)) {
    throw new Error('A send message job requires tenantId and messageId UUIDs.');
  }
  if (value.correlationId !== undefined && !isUuid(value.correlationId)) {
    throw new Error('correlationId must be a UUID.');
  }
  if (value.idempotencyKey !== undefined && typeof value.idempotencyKey !== 'string') {
    throw new Error('idempotencyKey must be a string.');
  }
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

function isStepId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
}
