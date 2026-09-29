import { Injectable } from '@nestjs/common';
import { messageSendRequestedEvent, type WorkflowStepDefinition } from '@vautrin/contracts';
import type { TenantScopedClient, WorkflowRun } from '@vautrin/database';
import {
  jsonRecord,
  normalizedSmsAddress,
  parseWorkflowSendMessageStepConfig,
  stringValue,
} from './send-message-step.js';
import {
  WorkflowContextBuilder,
  type WorkflowContextMetadata,
} from './workflow-context.builder.js';

export type WorkflowMessageStepResult =
  | { readonly ok: true; readonly conversationId: string; readonly messageId: string }
  | { readonly ok: false; readonly reason: string; readonly conversationId?: string };

/** Queues a workflow SMS and its outbox event atomically under tenant RLS. */
@Injectable()
export class WorkflowMessageStepExecutor {
  constructor(private readonly workflowContextBuilder: WorkflowContextBuilder) {}

  async execute(
    tx: TenantScopedClient,
    run: WorkflowRun,
    tenantId: string,
    workflow: WorkflowContextMetadata,
    stepIndex: number,
    step: WorkflowStepDefinition,
  ): Promise<WorkflowMessageStepResult> {
    const idempotencyKey = `run-${run.id}-step-${step.id}`;
    let body: string;
    try {
      body = parseWorkflowSendMessageStepConfig(step.config).body;
    } catch {
      return { ok: false, reason: 'invalid_send_message_configuration' };
    }

    let conversationId: string | undefined;
    try {
      const context = await this.workflowContextBuilder.build(
        tx,
        tenantId,
        run,
        workflow,
        stepIndex,
      );
      conversationId = stringValue(context.conversation?.id);
    } catch {
      return { ok: false, reason: 'workflow_conversation_context_unavailable' };
    }
    if (!conversationId) {
      return { ok: false, reason: 'workflow_conversation_context_unavailable' };
    }

    const existingMessage = await tx.message.findFirst({
      where: { tenantId, idempotencyKey },
    });
    if (existingMessage) {
      if (
        existingMessage.conversationId !== conversationId ||
        existingMessage.direction !== 'OUTBOUND' ||
        existingMessage.body !== body ||
        existingMessage.provider !== 'twilio'
      ) {
        return { ok: false, reason: 'message_idempotency_conflict', conversationId };
      }
      return { ok: true, conversationId, messageId: existingMessage.id };
    }

    const conversation = await tx.conversation.findFirst({
      where: { id: conversationId, tenantId },
      select: { id: true, contactId: true, channel: true, status: true, externalId: true },
    });
    if (!conversation) {
      return { ok: false, reason: 'workflow_conversation_context_unavailable', conversationId };
    }
    if (conversation.channel !== 'SMS') {
      return { ok: false, reason: 'unsupported_message_channel', conversationId };
    }
    if (conversation.status === 'CLOSED') {
      return { ok: false, reason: 'conversation_closed', conversationId };
    }

    const contact = await tx.contact.findFirst({
      where: { id: conversation.contactId, tenantId, deletedAt: null },
      select: { id: true, phone: true },
    });
    if (!contact) {
      return { ok: false, reason: 'conversation_contact_unavailable', conversationId };
    }
    const recipient = normalizedSmsAddress(contact.phone ?? '');
    if (!recipient) return { ok: false, reason: 'invalid_sms_recipient', conversationId };

    const optedOut = await tx.contactChannelPreference.findFirst({
      where: {
        tenantId,
        contactId: contact.id,
        channel: 'SMS',
        optedOutAt: { not: null },
      },
      select: { id: true },
    });
    if (optedOut) return { ok: false, reason: 'contact_opted_out', conversationId };

    const integrations = await tx.integration.findMany({
      where: {
        tenantId,
        provider: 'twilio',
        category: 'MESSAGING',
        status: { in: ['CONNECTED', 'HEALTHY', 'DEGRADED'] },
      },
      select: { id: true, configuration: true },
    });
    const configuredSender = conversation.externalId?.split(':')[0];
    const matchingIntegrations = integrations.filter((integration) => {
      const phoneNumber = stringValue(jsonRecord(integration.configuration).phoneNumber) ?? '';
      return configuredSender
        ? phoneNumber === configuredSender
        : integrations.length === 1 && phoneNumber.length > 0;
    });
    const integration = matchingIntegrations[0];
    const sender = integration
      ? normalizedSmsAddress(stringValue(jsonRecord(integration.configuration).phoneNumber) ?? '')
      : undefined;
    if (matchingIntegrations.length !== 1 || !integration || !sender) {
      return { ok: false, reason: 'sms_sender_unavailable', conversationId };
    }

    const message = await tx.message.create({
      data: {
        tenantId,
        conversationId,
        direction: 'OUTBOUND',
        channel: 'SMS',
        status: 'QUEUED',
        body,
        fromAddress: sender,
        toAddress: recipient,
        provider: 'twilio',
        correlationId: run.correlationId,
        idempotencyKey,
        metadata: { integrationId: integration.id },
      },
    });
    const event = messageSendRequestedEvent(message.id, conversationId, contact.id);
    await tx.event.create({
      data: {
        tenantId,
        name: event.name,
        version: event.version,
        aggregateType: 'message',
        aggregateId: message.id,
        payload: event.payload,
        correlationId: run.correlationId,
        idempotencyKey: `message.send_requested:${message.id}`,
      },
    });
    await tx.conversation.updateMany({
      where: {
        id: conversationId,
        tenantId,
        OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: message.createdAt } }],
      },
      data: { lastMessageAt: message.createdAt },
    });
    await tx.auditLog.create({
      data: {
        tenantId,
        actorType: 'SYSTEM',
        actorLabel: 'workflow',
        action: 'message.outbound.queued',
        resourceType: 'message',
        resourceId: message.id,
        correlationId: run.correlationId,
        metadata: { workflowRunId: run.id, stepId: step.id },
      },
    });

    return { ok: true, conversationId, messageId: message.id };
  }
}
