import { Injectable } from '@nestjs/common';
import type { ToolExecutionStatus, ToolSideEffect } from '@vautrin/database';

import { DatabaseService } from '../database/database.service.js';
import type { AgentToolAuditEvent, AgentToolAuditSink } from './tool-registry.js';

@Injectable()
export class DatabaseAgentToolAuditSink implements AgentToolAuditSink {
  constructor(private readonly database: DatabaseService) {}

  claim(event: AgentToolAuditEvent): Promise<boolean> {
    const idempotencyKey = event.idempotencyKey;
    if (!idempotencyKey || event.status !== 'RUNNING') {
      throw new Error('tool_claim_requires_idempotency_key');
    }
    return this.database.withJobTenant({ tenantId: event.tenantId }, async (tx) => {
      const existing = await tx.toolExecution.findFirst({
        where: { tenantId: event.tenantId, idempotencyKey },
        select: { id: true, agentRunId: true, toolName: true, status: true },
      });
      if (existing) {
        if (existing.agentRunId !== event.agentRunId || existing.toolName !== event.toolName) {
          throw new Error('tool_idempotency_key_conflict');
        }
        if (existing.status !== 'AWAITING_APPROVAL') return false;
        const claimed = await tx.toolExecution.updateMany({
          where: {
            id: existing.id,
            tenantId: event.tenantId,
            status: 'AWAITING_APPROVAL',
          },
          data: { status: 'RUNNING', authorized: true },
        });
        return claimed.count === 1;
      }

      const created = await tx.toolExecution.createMany({
        data: [toDatabaseData(event)],
        skipDuplicates: true,
      });
      return created.count === 1;
    });
  }

  record(event: AgentToolAuditEvent): Promise<void> {
    return this.database.withJobTenant({ tenantId: event.tenantId }, async (tx) => {
      if (event.idempotencyKey) {
        const existing = await tx.toolExecution.findFirst({
          where: { tenantId: event.tenantId, idempotencyKey: event.idempotencyKey },
          select: { id: true, agentRunId: true, toolName: true, status: true },
        });
        if (existing) {
          if (existing.agentRunId !== event.agentRunId || existing.toolName !== event.toolName) {
            throw new Error('tool_idempotency_key_conflict');
          }
          if (existing.status === 'SUCCEEDED') return;
          await tx.toolExecution.updateMany({
            where: { id: existing.id, tenantId: event.tenantId, status: { not: 'SUCCEEDED' } },
            data: {
              status: toDatabaseStatus(event.status),
              error: event.errorCode ?? null,
              authorized: event.authorized,
              approvalRequired: event.approvalRequired,
              latencyMs: boundedLatency(event.latencyMs),
            },
          });
          return;
        }
      }

      await tx.toolExecution.createMany({ data: [toDatabaseData(event)], skipDuplicates: true });
    });
  }
}

function toDatabaseData(event: AgentToolAuditEvent) {
  return {
    tenantId: event.tenantId,
    agentRunId: event.agentRunId,
    toolName: event.toolName,
    permission: event.permission || null,
    sideEffect: toDatabaseSideEffect(event.sideEffect),
    status: toDatabaseStatus(event.status),
    input: {},
    output: {},
    error: event.errorCode ?? null,
    authorized: event.authorized,
    approvalRequired: event.approvalRequired,
    idempotencyKey: event.idempotencyKey ?? null,
    latencyMs: boundedLatency(event.latencyMs),
  };
}

function boundedLatency(value: number): number {
  return Math.min(2_147_483_647, Math.max(0, Math.trunc(value)));
}

function toDatabaseSideEffect(value: AgentToolAuditEvent['sideEffect']): ToolSideEffect {
  return value.toUpperCase() as ToolSideEffect;
}

function toDatabaseStatus(value: AgentToolAuditEvent['status']): ToolExecutionStatus {
  return value as ToolExecutionStatus;
}
