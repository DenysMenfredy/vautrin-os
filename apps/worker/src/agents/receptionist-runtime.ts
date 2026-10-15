import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { businessHoursSchema, messageSendRequestedEvent } from '@vautrin/contracts';
import { type Agent, Prisma } from '@vautrin/database';
import {
  type LLMMessage,
  type LLMProvider,
  LLMProviderError,
  type LLMUsage,
} from '@vautrin/integrations';
import { RECEPTIONIST_POLICY, responsePlanSchema } from '@vautrin/revenue';
import { DatabaseService } from '../database/database.service.js';
import { type AgentBusinessContext, AgentContextBuilder } from './agent-context.builder.js';
import { DatabaseAgentToolAuditSink } from './agent-tool-audit.sink.js';
import { ReceptionistTools } from './receptionist-tools.js';
import type { AgentToolContext } from './tool-registry.js';

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
export interface ReceptionistTask {
  readonly tenantId: string;
  readonly workflowRunId: string;
  readonly stepId: string;
  readonly agentKey: string;
  readonly purpose: 'recovery' | 'qualification';
  readonly conversationId: string;
  readonly leadId: string;
  readonly correlationId?: string;
}
export interface ReceptionistResult {
  readonly agentRunId: string;
  readonly status: 'COMPLETED' | 'HANDED_OFF' | 'SUPPRESSED';
  readonly messageId?: string;
}

@Injectable()
export class ReceptionistRuntime {
  constructor(
    private readonly database: DatabaseService,
    private readonly contexts: AgentContextBuilder,
    private readonly tools: ReceptionistTools,
    private readonly audit: DatabaseAgentToolAuditSink,
    @Inject(LLM_PROVIDER) private readonly provider: LLMProvider,
  ) {}

  async execute(task: ReceptionistTask): Promise<ReceptionistResult> {
    const lease = randomUUID();
    const key = `workflow-${task.workflowRunId}-step-${task.stepId}`;
    const selected = await this.database.withJobTenant(task, async (tx) => {
      const conversation = await tx.conversation.findFirst({
        where: { id: task.conversationId, tenantId: task.tenantId, leadId: task.leadId },
      });
      if (!conversation) throw new LLMProviderError('agent_context_unavailable', false);
      const existing = await tx.agentRun.findFirst({
        where: { tenantId: task.tenantId, idempotencyKey: key },
      });
      const agent = await tx.agent.findFirst({
        where: existing
          ? { tenantId: task.tenantId, id: existing.agentId, version: existing.agentVersion }
          : { tenantId: task.tenantId, key: task.agentKey, status: 'ACTIVE' },
        orderBy: { version: 'desc' },
      });
      if (!agent) throw new LLMProviderError('agent_configuration_missing', false);
      const config = record(agent.modelConfiguration);
      if (config.provider !== 'openai' || typeof config.model !== 'string' || !config.model.trim())
        throw new LLMProviderError('agent_model_configuration_invalid', false);
      await tx.agentRun.createMany({
        data: [
          {
            tenantId: task.tenantId,
            agentId: agent.id,
            agentVersion: agent.version,
            promptVersion: agent.promptVersion,
            provider: 'openai',
            model: config.model,
            conversationId: task.conversationId,
            leadId: task.leadId,
            workflowRunId: task.workflowRunId,
            correlationId: task.correlationId ?? null,
            idempotencyKey: key,
          },
        ],
        skipDuplicates: true,
      });
      const run = await tx.agentRun.findFirst({
        where: { tenantId: task.tenantId, idempotencyKey: key },
      });
      if (!run) throw new Error('agent_run_missing');
      if (run.status !== 'RUNNING') return { agent, run, cached: true };
      const claim = await tx.agentRun.updateMany({
        where: {
          id: run.id,
          tenantId: task.tenantId,
          status: 'RUNNING',
          OR: [{ executionLease: null }, { leaseExpiresAt: { lt: new Date() } }],
        },
        data: { executionLease: lease, leaseExpiresAt: new Date(Date.now() + 120_000) },
      });
      if (claim.count !== 1) throw new LLMProviderError('agent_execution_busy', true);
      const pinned = await tx.agent.findFirst({
        where: { tenantId: task.tenantId, id: run.agentId, version: run.agentVersion },
      });
      if (!pinned) throw new LLMProviderError('agent_configuration_missing', false);
      return { agent: pinned, run, cached: false };
    });
    const runId = selected.run.id;
    if (selected.cached)
      return {
        agentRunId: runId,
        status: selected.run.handoff ? 'HANDED_OFF' : 'COMPLETED',
        ...(typeof record(selected.run.result).messageId === 'string'
          ? { messageId: String(record(selected.run.result).messageId) }
          : {}),
      };
    const toolContext: AgentToolContext = {
      tenantId: task.tenantId,
      agentId: selected.agent.id,
      agentRunId: runId,
      conversationId: task.conversationId,
      leadId: task.leadId,
      ...(task.correlationId ? { correlationId: task.correlationId } : {}),
    };
    let toolCount = 0;
    const usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number } = {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    };
    try {
      const context = await this.database.withJobTenant(task, (tx) =>
        this.contexts.build(tx, task.tenantId, task),
      );
      const suppressed = await this.isSuppressed(task);
      if (suppressed)
        return await this.finish(
          task,
          runId,
          lease,
          selected.agent,
          usage,
          toolCount,
          null,
          'SUPPRESSED',
        );
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content: `${RECEPTIONIST_POLICY}\nTenant instructions (subordinate to this policy):\n${selected.agent.instructions}\nStructured context:\n${JSON.stringify(context)}\nPurpose: ${task.purpose}`,
        },
        ...(context.conversation?.messages.map((message) => ({
          role: message.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const),
          content: JSON.stringify({ messageId: message.id, text: message.body }),
        })) ?? []),
        {
          role: 'user',
          content:
            task.purpose === 'recovery'
              ? 'Use a recovery response plan introducing this business and asking what project we can help with.'
              : 'Respond to the latest customer message using authorized tools and grounded response plans.',
        },
      ];
      const capabilities = record(selected.agent.guardrails).capabilities;
      const allowed = selected.agent.allowedTools;
      let continuation: string | undefined;
      let pendingToolResults: LLMMessage[] = [];
      for (let turn = 0; turn < 6; turn++) {
        await this.renewLease(task.tenantId, runId, lease);
        if (await this.isSuppressed(task))
          return await this.finish(
            task,
            runId,
            lease,
            selected.agent,
            usage,
            toolCount,
            null,
            'SUPPRESSED',
          );
        const response = await this.provider.generate({
          model: selected.run.model,
          messages: continuation ? pendingToolResults : messages,
          ...(continuation ? { continuation } : {}),
          tools: [
            ...this.tools.registry.describe(allowed),
            {
              name: 'respond',
              description:
                'Finish with an application-rendered response plan. This never accepts free-form customer text.',
              inputSchema: responsePlanSchema,
            },
          ],
          maxOutputTokens: 2_000,
        });
        addUsage(usage, response.usage);
        await this.database.withJobTenant(task, async (tx) => {
          await tx.$executeRaw`UPDATE public.agent_runs SET input_tokens = COALESCE(input_tokens, 0) + ${response.usage?.inputTokens ?? 0}::integer, output_tokens = COALESCE(output_tokens, 0) + ${response.usage?.outputTokens ?? 0}::integer, cached_input_tokens = COALESCE(cached_input_tokens, 0) + ${response.usage?.cachedInputTokens ?? 0}::integer WHERE tenant_id = ${task.tenantId}::uuid AND id = ${runId}::uuid AND execution_lease = ${lease}::uuid`;
        });
        continuation = response.continuation;
        pendingToolResults = [];
        if (response.finishReason === 'length' || !response.toolCalls.length)
          throw new LLMProviderError('agent_response_plan_required', false);
        messages.push({ role: 'assistant', content: '', toolCalls: response.toolCalls });
        for (const call of response.toolCalls) {
          if (++toolCount > 12) throw new LLMProviderError('agent_tool_limit', false);
          if (call.name === 'respond') {
            if (response.toolCalls.length !== 1)
              throw new LLMProviderError('agent_response_plan_must_be_last', false);
            const body = await this.renderPlan(task, runId, record(call.input), context);
            return await this.finish(
              task,
              runId,
              lease,
              selected.agent,
              usage,
              toolCount,
              body,
              'COMPLETED',
              response.model,
            );
          }
          const idempotencyKey = `${runId}-${call.name}-${createHash('sha256').update(JSON.stringify(call.input)).digest('hex')}`;
          const result = await this.tools.registry.invoke(
            call.name,
            call.input,
            { ...toolContext, idempotencyKey },
            allowed,
            {
              isAuthorized: (_context, permission) =>
                Promise.resolve(Array.isArray(capabilities) && capabilities.includes(permission)),
              isApproved: () => Promise.resolve(false),
            },
            this.audit,
          );
          if (result.status !== 'SUCCEEDED')
            throw new LLMProviderError(
              result.status === 'FAILED' ? result.errorCode : 'agent_unauthorized_tool',
              result.status === 'FAILED' && result.errorCode === 'provider_retryable',
            );
          messages.push({
            role: 'tool',
            content: JSON.stringify(result.output),
            toolCallId: call.id,
          });
          pendingToolResults.push({
            role: 'tool',
            content: JSON.stringify(result.output),
            toolCallId: call.id,
          });
          if (call.name === 'human_handoff')
            return await this.finish(
              task,
              runId,
              lease,
              selected.agent,
              usage,
              toolCount,
              'Our team will follow up with you. A person will take over this conversation.',
              'HANDED_OFF',
              response.model,
              String(record(call.input).reason),
            );
        }
      }
      throw new LLMProviderError('agent_turn_limit', false);
    } catch (error) {
      if (error instanceof LLMProviderError && error.retryable) throw error;
      const reason =
        error instanceof LLMProviderError && /^[a-z][a-z0-9_]{0,127}$/.test(error.code)
          ? error.code
          : 'agent_execution_failed';
      await this.tools.handoff(toolContext, reason);
      return await this.finish(
        task,
        runId,
        lease,
        selected.agent,
        usage,
        toolCount,
        null,
        'HANDED_OFF',
        undefined,
        reason,
      );
    } finally {
      await this.database.withJobTenant(task, (tx) =>
        tx.agentRun.updateMany({
          where: { id: runId, tenantId: task.tenantId, executionLease: lease },
          data: { executionLease: null, leaseExpiresAt: null },
        }),
      );
    }
  }

  private async renderPlan(
    task: ReceptionistTask,
    runId: string,
    plan: Record<string, unknown>,
    context: AgentBusinessContext,
  ): Promise<string> {
    if (Object.keys(plan).some((key) => !['kind', 'field', 'fact'].includes(key)))
      throw new LLMProviderError('agent_invalid_response_plan', false);
    const name = context.business.displayName;
    if (plan.kind === 'recovery' && task.purpose === 'recovery')
      return `Hi, this is ${name}. Sorry we missed your call. What remodeling project can we help you with? Reply STOP to opt out.`;
    if (plan.kind === 'ask') {
      const questions: Record<string, string> = {
        serviceKey: 'What type of remodeling project are you planning?',
        propertyType: 'What type of property is this project for?',
        postalCode: 'What is the project postal code?',
        budgetRange: 'What budget range are you considering?',
        timeline: 'When would you like to start?',
        description: 'Could you describe the work you need?',
        name: 'What name should we use for the appointment?',
        appointment: 'Which appointment day and time works for you?',
      };
      const question = typeof plan.field === 'string' ? questions[plan.field] : undefined;
      if (question) return question;
    }
    if (plan.kind === 'business_info') {
      if (plan.fact === 'services')
        return `${name} offers: ${context.services.map((service) => service.name).join(', ')}.`;
      if (plan.fact === 'service_areas')
        return `Our configured service areas are: ${context.serviceAreas.map((area) => `${area.type}: ${area.value}`).join(', ')}.`;
      if (plan.fact === 'hours') {
        const hours = businessHoursSchema.safeParse(context.business.businessHours);
        if (!hours.success) throw new LLMProviderError('business_hours_unavailable', false);
        return `Our business hours (${context.business.timezone}) are: ${Object.entries(
          hours.data.weekly,
        )
          .map(
            ([day, windows]) =>
              `${day}: ${windows.enabled ? windows.periods.map((window) => `${window.start}-${window.end}`).join(', ') : 'closed'}`,
          )
          .join('; ')}.`;
      }
    }
    if (plan.kind === 'offer_slots' || plan.kind === 'booked' || plan.kind === 'handoff') {
      const executions = await this.database.withJobTenant(task, (tx) =>
        tx.toolExecution.findMany({
          where: { tenantId: task.tenantId, agentRunId: runId, status: 'SUCCEEDED' },
          orderBy: { createdAt: 'desc' },
        }),
      );
      if (plan.kind === 'handoff' && executions.some((item) => item.toolName === 'human_handoff'))
        return 'Our team will follow up with you. A person will take over this conversation.';
      const booking = executions.find((item) => item.toolName === 'create_appointment');
      if (plan.kind === 'booked' && booking)
        return `Your appointment is booked for ${formatTime(String(record(booking.output).startsAt), context.business.timezone)}. Our team will follow up with the details.`;
      const availability = executions.find((item) => item.toolName === 'check_availability');
      const slots = record(availability?.output).slots;
      if (plan.kind === 'offer_slots' && Array.isArray(slots))
        return slots.length
          ? `Available times: ${slots
              .slice(0, 3)
              .map((slot) => formatTime(String(record(slot).startsAt), context.business.timezone))
              .join('; ')}. Which time would you like?`
          : 'There are no available appointments in that period. Which other day works for you?';
    }
    throw new LLMProviderError('agent_ungrounded_response_plan', false);
  }

  private isSuppressed(task: ReceptionistTask): Promise<boolean> {
    return this.database.withJobTenant(task, async (tx) => {
      const workflow = await tx.workflowRun.findFirst({
        where: {
          id: task.workflowRunId,
          tenantId: task.tenantId,
          status: 'WAITING',
          currentStepId: task.stepId,
        },
      });
      if (!workflow) return true;
      const conversation = await tx.conversation.findFirst({
        where: { id: task.conversationId, tenantId: task.tenantId },
      });
      if (conversation?.status !== 'OPEN') return true;
      return Boolean(
        await tx.contactChannelPreference.findFirst({
          where: {
            tenantId: task.tenantId,
            contactId: conversation.contactId,
            channel: 'SMS',
            optedOutAt: { not: null },
          },
        }),
      );
    });
  }
  private async renewLease(tenantId: string, runId: string, lease: string): Promise<void> {
    const updated = await this.database.withJobTenant({ tenantId }, (tx) =>
      tx.agentRun.updateMany({
        where: { id: runId, tenantId, status: 'RUNNING', executionLease: lease },
        data: { leaseExpiresAt: new Date(Date.now() + 120_000) },
      }),
    );
    if (updated.count !== 1) throw new LLMProviderError('agent_execution_lease_lost', true);
  }

  private finish(
    task: ReceptionistTask,
    runId: string,
    lease: string,
    agent: Agent,
    _usage: LLMUsage,
    toolCount: number,
    body: string | null,
    status: ReceptionistResult['status'],
    model?: string,
    reason?: string,
  ): Promise<ReceptionistResult> {
    return this.database.withJobTenant(task, async (tx) => {
      const run = await tx.agentRun.findFirst({
        where: { id: runId, tenantId: task.tenantId, executionLease: lease, status: 'RUNNING' },
      });
      if (!run) throw new LLMProviderError('agent_execution_lease_lost', true);
      const conversation = await tx.conversation.findFirst({
        where: { id: task.conversationId, tenantId: task.tenantId },
        include: { contact: true },
      });
      const optedOut = conversation
        ? await tx.contactChannelPreference.findFirst({
            where: {
              tenantId: task.tenantId,
              contactId: conversation.contactId,
              channel: 'SMS',
              optedOutAt: { not: null },
            },
          })
        : true;
      await tx.$queryRaw`SELECT id FROM public.workflow_runs WHERE id = ${task.workflowRunId}::uuid AND tenant_id = ${task.tenantId}::uuid FOR UPDATE`;
      const actionable = await tx.workflowRun.findFirst({
        where: {
          id: task.workflowRunId,
          tenantId: task.tenantId,
          status: 'WAITING',
          currentStepId: task.stepId,
        },
      });
      let messageId: string | undefined;
      if (
        body &&
        actionable &&
        !optedOut &&
        conversation &&
        (conversation.status === 'OPEN' ||
          (status === 'HANDED_OFF' && conversation.status === 'PENDING'))
      ) {
        const sender = conversation.externalId?.split(':')[0];
        const integrations = await tx.integration.findMany({
          where: {
            tenantId: task.tenantId,
            provider: 'twilio',
            category: 'MESSAGING',
            status: { in: ['CONNECTED', 'HEALTHY', 'DEGRADED'] },
          },
        });
        const choices = integrations.filter((item) =>
          sender ? record(item.configuration).phoneNumber === sender : integrations.length === 1,
        );
        const integration = choices[0];
        if (
          choices.length !== 1 ||
          !integration ||
          !conversation.contact.phone ||
          conversation.contact.deletedAt
        )
          throw new LLMProviderError('sms_sender_unavailable', false);
        const availability = body.startsWith('Available times: ')
          ? await tx.toolExecution.findFirst({
              where: {
                tenantId: task.tenantId,
                agentRunId: runId,
                toolName: 'check_availability',
                status: 'SUCCEEDED',
              },
              orderBy: { createdAt: 'desc' },
            })
          : null;
        const slots = record(availability?.output).slots;
        const message = await tx.message.create({
          data: {
            tenantId: task.tenantId,
            conversationId: task.conversationId,
            direction: 'OUTBOUND',
            channel: 'SMS',
            status: 'QUEUED',
            body,
            provider: 'twilio',
            fromAddress: String(record(integration.configuration).phoneNumber),
            toAddress: conversation.contact.phone,
            idempotencyKey: `agent-response-${runId}`,
            agentRunId: runId,
            correlationId: task.correlationId ?? null,
            metadata: {
              integrationId: integration.id,
              workflowRunId: task.workflowRunId,
              handoffAcknowledgement: status === 'HANDED_OFF',
              promptVersion: agent.promptVersion,
              ...(Array.isArray(slots)
                ? { offeredSlots: slots.slice(0, 3) as Prisma.InputJsonValue }
                : {}),
            },
          },
        });
        const event = messageSendRequestedEvent(
          message.id,
          conversation.id,
          conversation.contactId,
        );
        await tx.event.create({
          data: {
            tenantId: task.tenantId,
            ...event,
            payload: event.payload as Prisma.InputJsonValue,
            aggregateType: 'message',
            aggregateId: message.id,
            correlationId: task.correlationId ?? null,
            idempotencyKey: `message.send_requested:${message.id}`,
          },
        });
        await tx.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: message.createdAt },
        });
        await tx.auditLog.create({
          data: {
            tenantId: task.tenantId,
            actorType: 'AGENT',
            actorId: runId,
            action: 'message.outbound.queued',
            resourceType: 'message',
            resourceId: message.id,
            correlationId: task.correlationId ?? null,
            metadata: { agentRunId: runId },
          },
        });
        messageId = message.id;
      }
      const handoff = status === 'HANDED_OFF' || record(conversation?.metadata).handoff === true;
      await tx.agentRun.update({
        where: { id: runId, tenantId: task.tenantId },
        data: {
          status: handoff ? 'HANDED_OFF' : 'COMPLETED',
          completedAt: new Date(),
          latencyMs: Math.min(2_147_483_647, Date.now() - run.startedAt.getTime()),
          toolCount,
          ...(model ? { model } : {}),
          handoff,
          handoffReason: reason ?? null,
          failureReason: reason ?? null,
          result: { status, ...(messageId ? { messageId } : {}) },
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: task.tenantId,
          actorType: 'AGENT',
          actorId: runId,
          action: handoff ? 'agent.run.handed_off' : 'agent.run.completed',
          resourceType: 'agent_run',
          resourceId: runId,
          correlationId: task.correlationId ?? null,
          metadata: { status, toolCount },
        },
      });
      return {
        agentRunId: runId,
        status: handoff ? 'HANDED_OFF' : status,
        ...(messageId ? { messageId } : {}),
      };
    });
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function addUsage(
  target: { inputTokens: number; outputTokens: number; cachedInputTokens: number },
  source: LLMUsage | undefined,
): void {
  target.inputTokens += source?.inputTokens ?? 0;
  target.outputTokens += source?.outputTokens ?? 0;
  target.cachedInputTokens += source?.cachedInputTokens ?? 0;
}
function formatTime(value: string, timezone: string): string {
  return (
    new Date(value).toLocaleString('en-US', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }) + ` (${timezone})`
  );
}
