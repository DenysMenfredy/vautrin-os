import { describe, expect, it } from 'vitest';

import {
  ALL_QUEUES,
  assertDurableEventJob,
  assertWorkflowRunJob,
  DEFAULT_JOB_OPTIONS,
  DOMAIN_EVENT_JOB,
  durableEventJobId,
  QUEUE,
  WORKFLOW_RUN_JOB,
  workflowRunJobId,
} from '../src/index.js';

describe('shared queue contract (VOS-012)', () => {
  it('keeps ADR-009 queue names distinct and bounded retries', () => {
    expect([...ALL_QUEUES].sort()).toEqual(['ai', 'notifications', 'webhooks', 'workflow']);
    expect(new Set(Object.values(QUEUE)).size).toBe(4);
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(3);
  });

  it('gives durable events a stable BullMQ identity', () => {
    const eventId = '0192f1a0-1b2c-7d3e-8f40-51627384950a';
    expect(DOMAIN_EVENT_JOB).toBe('domain.event');
    expect(durableEventJobId(eventId)).toBe(`event-${eventId}`);
    expect(() => durableEventJobId('invalid')).toThrow();
  });

  it('requires a tenant and durable event id before a worker acts', () => {
    const job = {
      tenantId: '0192f1a0-1b2c-7d3e-8f40-51627384950a',
      eventId: '0192f1a0-1b2c-7d3e-8f40-51627384950b',
    };
    expect(() => assertDurableEventJob(job)).not.toThrow();
    expect(() => assertDurableEventJob({ ...job, tenantId: 'other-tenant' })).toThrow();
    expect(() => assertDurableEventJob({ tenantId: job.tenantId })).toThrow();
  });

  it('gives workflow starts and delayed wakes tenant-bearing stable identities', () => {
    const tenantId = '0192f1a0-1b2c-7d3e-8f40-51627384950a';
    const runId = '0192f1a0-1b2c-7d3e-8f40-51627384950b';
    const start = { tenantId, runId, action: 'start' as const };
    const wake = { tenantId, runId, action: 'wake' as const, stepId: 'wait-before-send' };
    const retry = {
      tenantId,
      runId,
      action: 'retry' as const,
      stepId: 'send-before-wait',
      attempt: 2,
    };

    expect(WORKFLOW_RUN_JOB).toBe('workflow.run');
    expect(workflowRunJobId(start)).toBe(`workflow-${runId}-start`);
    expect(workflowRunJobId(wake)).toBe(`workflow-${runId}-wake-wait-before-send`);
    expect(workflowRunJobId(retry)).toBe(`workflow-${runId}-retry-send-before-wait-2`);
    expect(() => assertWorkflowRunJob(start)).not.toThrow();
    expect(() => assertWorkflowRunJob(wake)).not.toThrow();
    expect(() => assertWorkflowRunJob(retry)).not.toThrow();
    expect(() => assertWorkflowRunJob({ ...wake, tenantId: 'invalid' })).toThrow();
    expect(() => assertWorkflowRunJob({ ...wake, stepId: 'not valid' })).toThrow();
    expect(() => assertWorkflowRunJob({ ...retry, attempt: 1 })).toThrow();
  });
});
