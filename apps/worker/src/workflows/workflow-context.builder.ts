import { Injectable } from '@nestjs/common';
import { parseDomainEvent, type WorkflowContext } from '@vautrin/contracts';
import type { TenantScopedClient, WorkflowRun } from '@vautrin/database';

export interface WorkflowContextMetadata {
  readonly id: string;
  readonly key: string;
  readonly version: number;
  readonly trigger: string;
}

export class WorkflowContextBuildError extends Error {
  constructor(readonly code: 'invalid_trigger_event_context') {
    super(code);
    this.name = 'WorkflowContextBuildError';
  }
}

/** Builds a minimal, tenant-scoped projection; condition evaluation itself has no DB access. */
@Injectable()
export class WorkflowContextBuilder {
  async build(
    tx: TenantScopedClient,
    tenantId: string,
    run: WorkflowRun,
    workflow: WorkflowContextMetadata,
    currentStepIndex: number,
  ): Promise<WorkflowContext> {
    let event: WorkflowContext['event'] = { name: run.triggerEvent, payload: {} };
    let domainPayload: Record<string, unknown> = {};
    if (run.triggerEventId) {
      const storedEvent = await tx.event.findFirst({
        where: { id: run.triggerEventId, tenantId },
        select: { id: true, name: true, version: true, payload: true, occurredAt: true },
      });
      if (!storedEvent) throw new WorkflowContextBuildError('invalid_trigger_event_context');
      try {
        const parsed = parseDomainEvent({
          name: storedEvent.name,
          version: storedEvent.version,
          payload: storedEvent.payload,
        });
        if (parsed.name !== run.triggerEvent) {
          throw new WorkflowContextBuildError('invalid_trigger_event_context');
        }
        domainPayload = parsed.payload;
      } catch {
        throw new WorkflowContextBuildError('invalid_trigger_event_context');
      }
      event = {
        id: storedEvent.id,
        name: storedEvent.name,
        version: storedEvent.version,
        occurredAt: storedEvent.occurredAt.toISOString(),
        payload: domainPayload,
      };
    }

    const conversationId = stringValue(domainPayload.conversationId);
    const conversationRow = conversationId
      ? await tx.conversation.findFirst({
          where: { id: conversationId, tenantId },
          select: {
            id: true,
            leadId: true,
            contactId: true,
            channel: true,
            status: true,
            assignedUserId: true,
            lastMessageAt: true,
          },
        })
      : null;
    const leadId = stringValue(domainPayload.leadId) ?? conversationRow?.leadId;
    const eventContactId = stringValue(domainPayload.contactId);

    const leadRow = leadId
      ? await tx.lead.findFirst({
          where: { id: leadId, tenantId },
          select: {
            id: true,
            status: true,
            sourceId: true,
            service: true,
            assignedUserId: true,
            title: true,
            estimatedValue: true,
            version: true,
            createdAt: true,
            updatedAt: true,
            contactId: true,
          },
        })
      : null;
    const contactId = leadRow?.contactId ?? conversationRow?.contactId ?? eventContactId;
    const contactRow = contactId
      ? await tx.contact.findFirst({
          where: { id: contactId, tenantId },
          select: {
            id: true,
            company: true,
            tags: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      : null;
    const hasInboundReply = conversationRow
      ? (await tx.message.count({
          where: {
            tenantId,
            conversationId: conversationRow.id,
            direction: 'INBOUND',
            ...(typeof event.occurredAt === 'string'
              ? { createdAt: { gte: new Date(event.occurredAt) } }
              : {}),
          },
        })) > 0
      : false;
    const previousSteps = await tx.workflowStepRun.findMany({
      where: {
        tenantId,
        workflowRunId: run.id,
        stepIndex: { lt: currentStepIndex },
        status: 'COMPLETED',
      },
      select: { stepId: true, output: true },
      orderBy: { stepIndex: 'asc' },
    });

    const steps: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const prior of previousSteps) {
      if (prior.output !== null) steps[prior.stepId] = prior.output;
    }

    return {
      event,
      workflow: {
        id: workflow.id,
        key: workflow.key,
        version: workflow.version,
        trigger: workflow.trigger,
      },
      ...(leadRow
        ? {
            lead: {
              id: leadRow.id,
              status: leadRow.status,
              sourceId: leadRow.sourceId,
              service: leadRow.service,
              assignedUserId: leadRow.assignedUserId,
              title: leadRow.title,
              estimatedValue: leadRow.estimatedValue
                ? Number(leadRow.estimatedValue.toString())
                : null,
              version: leadRow.version,
              createdAt: leadRow.createdAt.toISOString(),
              updatedAt: leadRow.updatedAt.toISOString(),
            },
          }
        : {}),
      ...(contactRow
        ? {
            contact: {
              id: contactRow.id,
              company: contactRow.company,
              tags: contactRow.tags,
              createdAt: contactRow.createdAt.toISOString(),
              updatedAt: contactRow.updatedAt.toISOString(),
            },
          }
        : {}),
      ...(conversationRow
        ? {
            conversation: {
              id: conversationRow.id,
              leadId: conversationRow.leadId,
              contactId: conversationRow.contactId,
              channel: conversationRow.channel,
              status: conversationRow.status,
              hasInboundReply,
              assignedUserId: conversationRow.assignedUserId,
              lastMessageAt: conversationRow.lastMessageAt?.toISOString() ?? null,
            },
          }
        : {}),
      steps,
    };
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
