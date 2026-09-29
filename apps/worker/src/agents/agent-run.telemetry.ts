import { Injectable } from '@nestjs/common';
import { Prisma, type TenantScopedClient } from '@vautrin/database';

import { DatabaseService } from '../database/database.service.js';

export interface StartAgentRunInput {
  readonly tenantId: string;
  readonly agentId: string;
  readonly agentVersion: number;
  readonly promptVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly conversationId?: string;
  readonly leadId?: string;
  readonly workflowRunId?: string;
  readonly correlationId?: string;
}

export interface AgentRunUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly estimatedCost?: { readonly amount: string; readonly currency: string };
}

@Injectable()
export class AgentRunTelemetry {
  constructor(private readonly database: DatabaseService) {}

  start(input: StartAgentRunInput): Promise<{ readonly id: string; readonly startedAt: Date }> {
    return this.database.withJobTenant({ tenantId: input.tenantId }, async (tx) => {
      const agent = await tx.agent.findFirst({
        where: {
          id: input.agentId,
          tenantId: input.tenantId,
          version: input.agentVersion,
          status: 'ACTIVE',
        },
        select: { promptVersion: true },
      });
      if (!agent || agent.promptVersion !== input.promptVersion) {
        throw new Error('agent_version_unavailable');
      }
      const run = await tx.agentRun.create({
        data: {
          tenantId: input.tenantId,
          agentId: input.agentId,
          agentVersion: input.agentVersion,
          promptVersion: input.promptVersion,
          provider: requireIdentifier(input.provider, 'provider'),
          model: requireIdentifier(input.model, 'model'),
          ...(input.conversationId ? { conversationId: input.conversationId } : {}),
          ...(input.leadId ? { leadId: input.leadId } : {}),
          ...(input.workflowRunId ? { workflowRunId: input.workflowRunId } : {}),
          ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        },
        select: { id: true, startedAt: true },
      });
      return run;
    });
  }

  complete(
    tenantId: string,
    runId: string,
    usage: AgentRunUsage,
    toolCount: number,
    structuredResult: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    if (!Number.isSafeInteger(toolCount) || toolCount < 0) throw new Error('tool_count_invalid');
    const estimatedCost = validateCost(usage.estimatedCost);
    const inputTokens = readTokenCount(usage.inputTokens);
    const outputTokens = readTokenCount(usage.outputTokens);
    const cachedInputTokens = readTokenCount(usage.cachedInputTokens);
    return this.database.withJobTenant({ tenantId }, async (tx) => {
      const changed = await tx.agentRun.updateMany({
        where: { id: runId, tenantId, status: 'RUNNING' },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          latencyMs: await runLatency(tx, tenantId, runId),
          ...(inputTokens !== undefined ? { inputTokens } : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
          ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
          ...(estimatedCost
            ? { costAmount: estimatedCost.amount, costCurrency: estimatedCost.currency }
            : {}),
          toolCount,
          result: structuredResult as Prisma.InputJsonValue,
        },
      });
      if (changed.count !== 1) throw new Error('agent_run_not_running');
    });
  }

  fail(
    tenantId: string,
    runId: string,
    failureReason: string,
    handoffReason?: string,
  ): Promise<void> {
    if (!/^[a-z][a-z0-9_.:-]{0,127}$/.test(failureReason)) {
      throw new Error('agent_failure_code_invalid');
    }
    if (handoffReason !== undefined && !/^[a-z][a-z0-9_.:-]{0,127}$/.test(handoffReason)) {
      throw new Error('agent_handoff_code_invalid');
    }
    return this.database.withJobTenant({ tenantId }, async (tx) => {
      const changed = await tx.agentRun.updateMany({
        where: { id: runId, tenantId, status: 'RUNNING' },
        data: {
          status: handoffReason ? 'HANDED_OFF' : 'FAILED',
          completedAt: new Date(),
          latencyMs: await runLatency(tx, tenantId, runId),
          failureReason,
          handoff: Boolean(handoffReason),
          ...(handoffReason ? { handoffReason } : {}),
        },
      });
      if (changed.count !== 1) throw new Error('agent_run_not_running');
      if (handoffReason) {
        await tx.auditLog.create({
          data: {
            tenantId,
            actorType: 'AGENT',
            actorId: runId,
            action: 'agent.run.handoff_requested',
            resourceType: 'agent_run',
            resourceId: runId,
            metadata: { reason: handoffReason },
          },
        });
      }
    });
  }
}

async function runLatency(
  tx: TenantScopedClient,
  tenantId: string,
  runId: string,
): Promise<number> {
  const run = await tx.agentRun.findFirst({
    where: { id: runId, tenantId, status: 'RUNNING' },
    select: { startedAt: true },
  });
  if (!run) throw new Error('agent_run_not_running');
  return Math.min(2_147_483_647, Math.max(0, Date.now() - run.startedAt.getTime()));
}

function readTokenCount(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new Error('agent_token_count_invalid');
  }
  return value;
}

function validateCost(
  value: AgentRunUsage['estimatedCost'],
): { readonly amount: string; readonly currency: string } | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+(?:\.\d{1,6})?$/.test(value.amount) || !/^[A-Z]{3}$/.test(value.currency)) {
    throw new Error('agent_cost_invalid');
  }
  return value;
}

function requireIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 100) throw new Error(`agent_${field}_invalid`);
  return normalized;
}
