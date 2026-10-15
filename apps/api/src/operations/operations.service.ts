import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  OperationsSummary,
  WorkflowRunDetail,
  WorkflowRunPage,
  WorkflowRunSummary,
} from '@vautrin/contracts';
import { Prisma, type WorkflowRun } from '@vautrin/database';
import { buildPage, cursorFilter, decodeCursor } from '../common/cursor-page.js';
import { DatabaseService } from '../database/database.service.js';
import type { OperationsListDto } from './operations.dto.js';

@Injectable()
export class OperationsService {
  constructor(private readonly database: DatabaseService) {}
  summary(tenantId: string): Promise<OperationsSummary> {
    return this.database.withTenant(tenantId, async (tx) => {
      const [
        workflowRuns,
        failedWorkflows,
        waitingWorkflows,
        agentRuns,
        handoffs,
        usage,
        outboundMessages,
        failedMessages,
        bookedAppointments,
        missedCalls,
        pendingEvents,
        oldest,
      ] = await Promise.all([
        tx.workflowRun.count({ where: { tenantId } }),
        tx.workflowRun.count({ where: { tenantId, status: 'FAILED' } }),
        tx.workflowRun.count({ where: { tenantId, status: 'WAITING' } }),
        tx.agentRun.count({ where: { tenantId } }),
        tx.conversation.count({
          where: { tenantId, status: 'PENDING', metadata: { path: ['handoff'], equals: true } },
        }),
        tx.agentRun.aggregate({
          where: { tenantId },
          _sum: { inputTokens: true, outputTokens: true, cachedInputTokens: true },
        }),
        tx.message.count({ where: { tenantId, direction: 'OUTBOUND' } }),
        tx.message.count({ where: { tenantId, status: 'FAILED' } }),
        tx.appointment.count({
          where: {
            tenantId,
            status: { in: ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED', 'COMPLETED'] },
          },
        }),
        tx.call.count({ where: { tenantId, status: 'MISSED' } }),
        tx.event.count({ where: { tenantId, publishedAt: null } }),
        tx.event.findFirst({
          where: { tenantId, publishedAt: null },
          orderBy: { occurredAt: 'asc' },
          select: { occurredAt: true },
        }),
      ]);
      return {
        workflowRuns,
        failedWorkflows,
        waitingWorkflows,
        agentRuns,
        handoffs,
        inputTokens: usage._sum.inputTokens ?? 0,
        outputTokens: usage._sum.outputTokens ?? 0,
        cachedInputTokens: usage._sum.cachedInputTokens ?? 0,
        outboundMessages,
        failedMessages,
        bookedAppointments,
        missedCalls,
        pendingEvents,
        oldestPendingEventAgeSeconds: oldest
          ? Math.max(0, Math.floor((Date.now() - oldest.occurredAt.getTime()) / 1000))
          : null,
      };
    });
  }
  list(tenantId: string, query: OperationsListDto): Promise<WorkflowRunPage> {
    return this.database.withTenant(tenantId, async (tx) => {
      const cursor = decodeCursor(query.cursor);
      const limit = query.limit ?? 25;
      const matching = query.leadId
        ? await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT wr.id FROM public.workflow_runs wr
        JOIN public.events e ON e.id = wr.trigger_event_id AND e.tenant_id = wr.tenant_id
        WHERE wr.tenant_id = ${tenantId}::uuid
        AND (e.payload->>'leadId' = ${query.leadId} OR EXISTS (
          SELECT 1 FROM public.conversations c
          WHERE c.tenant_id = wr.tenant_id AND c.lead_id = ${query.leadId}::uuid
          AND (c.id::text = e.payload->>'conversationId' OR EXISTS (
            SELECT 1 FROM public.messages m WHERE m.tenant_id = c.tenant_id AND m.conversation_id = c.id
            AND e.aggregate_type = 'message' AND e.aggregate_id = m.id
          ))
        ))
        ${query.status ? Prisma.sql`AND wr.status::text = ${query.status}` : Prisma.empty}
        ${cursor ? Prisma.sql`AND (wr.created_at, wr.id) < (${cursor.createdAt}, ${cursor.id}::uuid)` : Prisma.empty}
        ORDER BY wr.created_at DESC, wr.id DESC LIMIT ${limit + 1}
      `)
        : null;
      const leadFilter: Prisma.WorkflowRunWhereInput = matching
        ? { id: { in: matching.map((row) => row.id) } }
        : {};
      const rows = await tx.workflowRun.findMany({
        where: {
          tenantId,
          ...leadFilter,
          ...(query.status ? { status: query.status } : {}),
          ...(cursor ? { AND: [cursorFilter(cursor)] } : {}),
        },
        include: { workflow: { select: { key: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      return buildPage(rows, limit, mapRun);
    });
  }
  detail(tenantId: string, runId: string): Promise<WorkflowRunDetail> {
    return this.database.withTenant(tenantId, async (tx) => {
      const run = await tx.workflowRun.findFirst({
        where: { id: runId, tenantId },
        include: {
          workflow: { select: { key: true } },
          stepRuns: { orderBy: { stepIndex: 'asc' }, take: 100 },
          agentRuns: { orderBy: { startedAt: 'desc' }, take: 100 },
        },
      });
      if (!run) throw new NotFoundException('Workflow run not found.');
      return {
        ...mapRun(run),
        steps: run.stepRuns.map((step) => ({
          id: step.id,
          stepId: step.stepId,
          stepType: step.stepType,
          status: step.status,
          attempt: step.attempt,
          error: step.error,
          durationMs: step.durationMs,
          scheduledFor: step.scheduledFor?.toISOString() ?? null,
        })),
        agents: run.agentRuns.map((agent) => ({
          id: agent.id,
          status: agent.status,
          provider: agent.provider,
          model: agent.model,
          promptVersion: agent.promptVersion,
          inputTokens: agent.inputTokens,
          outputTokens: agent.outputTokens,
          cachedInputTokens: agent.cachedInputTokens,
          toolCount: agent.toolCount,
          latencyMs: agent.latencyMs,
          failureReason: agent.failureReason,
          handoffReason: agent.handoffReason,
        })),
      };
    });
  }
  async cancel(tenantId: string, actorId: string, runId: string): Promise<WorkflowRunDetail> {
    await this.database.withTenant(tenantId, async (tx) => {
      const run = await tx.workflowRun.findFirst({ where: { id: runId, tenantId } });
      if (!run) throw new NotFoundException('Workflow run not found.');
      const changed = await tx.workflowRun.updateMany({
        where: { id: runId, tenantId, status: { in: ['PENDING', 'RUNNING', 'WAITING'] } },
        data: { status: 'CANCELLED', scheduledFor: null, completedAt: new Date() },
      });
      if (!changed.count) return;
      await tx.workflowStepRun.updateMany({
        where: {
          tenantId,
          workflowRunId: runId,
          status: { in: ['PENDING', 'SCHEDULED', 'RUNNING'] },
        },
        data: { status: 'SKIPPED', error: 'workflow_cancelled', completedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: 'USER',
          actorId,
          action: 'workflow.run.cancelled',
          resourceType: 'workflow_run',
          resourceId: runId,
          correlationId: run.correlationId,
        },
      });
    });
    return this.detail(tenantId, runId);
  }
}
function mapRun(row: WorkflowRun & { workflow: { key: string } }): WorkflowRunSummary {
  return {
    id: row.id,
    workflowKey: row.workflow.key,
    workflowVersion: row.workflowVersion,
    triggerEvent: row.triggerEvent,
    status: row.status,
    currentStepId: row.currentStepId,
    error: row.error,
    correlationId: row.correlationId,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
