import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { TenantScopedClient } from '@vautrin/database';
import {
  MessagingProviderError,
  TwilioMessagingProvider,
  twilioStatusCallbackUrl,
} from '@vautrin/integrations';
import {
  assertSendMessageJob,
  QUEUE,
  SEND_MESSAGE_JOB,
  type SendMessageJob,
} from '@vautrin/queues';
import type { Job } from 'bullmq';

import { DatabaseService } from '../database/database.service.js';

type SendContext = {
  readonly integrationId: string;
  readonly to: string;
  readonly body: string;
  readonly statusCallbackUrl: string;
  readonly idempotencyKey: string;
};

/** Tenant-scoped outbound SMS delivery with a durable, no-blind-resend claim. */
@Processor(QUEUE.NOTIFICATIONS)
export class OutboundMessageProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboundMessageProcessor.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly provider: TwilioMessagingProvider,
  ) {
    super();
  }

  async process(job: Job<SendMessageJob>): Promise<void> {
    if (job.name !== SEND_MESSAGE_JOB) throw new Error(`Unknown notification job: ${job.name}`);
    assertSendMessageJob(job.data);
    const context = await this.prepareAndClaim(job.data);
    if (!context) return;

    let result: Awaited<ReturnType<TwilioMessagingProvider['sendText']>>;
    try {
      result = await this.provider.sendText({
        tenantId: job.data.tenantId,
        integrationId: context.integrationId,
        to: context.to,
        body: context.body,
        statusCallbackUrl: context.statusCallbackUrl,
        idempotencyKey: context.idempotencyKey,
      });
    } catch (error) {
      if (error instanceof MessagingProviderError && error.retryable) {
        const attempts = job.opts.attempts ?? 1;
        const retryRemains = job.attemptsMade + 1 < attempts;
        if (retryRemains) {
          await this.requeueKnownRejection(job.data);
          throw error;
        }
      }
      if (error instanceof MessagingProviderError && error.outcomeUnknown) {
        this.logger.error(
          `Outbound SMS outcome unknown tenantId=${job.data.tenantId} messageId=${job.data.messageId}; awaiting provider status callback`,
        );
        return;
      }
      await this.failWithoutRetry(job.data, failureCode(error));
      this.logger.warn(
        `Outbound SMS failed tenantId=${job.data.tenantId} messageId=${job.data.messageId} reason=${failureCode(error)}`,
      );
      return;
    }
    await this.recordProviderAcceptance(job.data, result.providerMessageId, result.status);
  }

  private prepareAndClaim(data: SendMessageJob): Promise<SendContext | null> {
    return this.database.withJobTenant(data, async (tx) => {
      const message = await tx.message.findFirst({
        where: { id: data.messageId, tenantId: data.tenantId },
        include: { conversation: { select: { contactId: true, status: true, metadata: true } } },
      });
      if (!message) return null;
      if (message.status !== 'QUEUED') return null;
      if (
        message.direction !== 'OUTBOUND' ||
        message.channel !== 'SMS' ||
        message.provider !== 'twilio' ||
        !message.toAddress ||
        !message.fromAddress
      ) {
        await failQueuedMessage(tx, data.tenantId, message.id, 'invalid_message_configuration');
        return null;
      }

      const metadata = record(message.metadata);
      const workflowRunId = metadata.workflowRunId;
      if (typeof workflowRunId === 'string') {
        if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(workflowRunId)) {
          await failQueuedMessage(tx, data.tenantId, message.id, 'workflow_unavailable');
          return null;
        }
        const workflow = await tx.$queryRaw<
          { status: string }[]
        >`SELECT status FROM public.workflow_runs WHERE tenant_id = ${data.tenantId}::uuid AND id = ${workflowRunId}::uuid FOR UPDATE`;
        if (!workflow[0] || ['CANCELLED', 'FAILED'].includes(workflow[0].status)) {
          await failQueuedMessage(tx, data.tenantId, message.id, 'workflow_cancelled');
          return null;
        }
        if (
          message.conversation.status === 'PENDING' &&
          !(
            metadata.handoffAcknowledgement === true &&
            record(message.conversation.metadata).agentRunId === message.agentRunId
          )
        ) {
          await failQueuedMessage(tx, data.tenantId, message.id, 'conversation_handed_off');
          return null;
        }
      }

      const contact = await tx.contact.findFirst({
        where: { id: message.conversation.contactId, tenantId: data.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!contact) {
        await failQueuedMessage(tx, data.tenantId, message.id, 'contact_unavailable');
        return null;
      }
      if (message.conversation.status === 'CLOSED') {
        await failQueuedMessage(tx, data.tenantId, message.id, 'conversation_closed');
        return null;
      }
      const preference = await tx.contactChannelPreference.findFirst({
        where: {
          tenantId: data.tenantId,
          contactId: contact.id,
          channel: 'SMS',
          optedOutAt: { not: null },
        },
        select: { id: true },
      });
      if (preference) {
        await failQueuedMessage(tx, data.tenantId, message.id, 'recipient_opted_out');
        return null;
      }

      const integrationId = record(message.metadata).integrationId;
      if (typeof integrationId !== 'string') {
        await failQueuedMessage(tx, data.tenantId, message.id, 'integration_unavailable');
        return null;
      }
      const integration = await tx.integration.findFirst({
        where: {
          id: integrationId,
          tenantId: data.tenantId,
          provider: 'twilio',
          category: 'MESSAGING',
          status: { in: ['CONNECTED', 'HEALTHY', 'DEGRADED'] },
        },
        select: { configuration: true },
      });
      const configuration = integration ? record(integration.configuration) : {};
      if (
        !integration ||
        configuration.phoneNumber !== message.fromAddress ||
        typeof configuration.webhookUrl !== 'string'
      ) {
        await failQueuedMessage(tx, data.tenantId, message.id, 'integration_unavailable');
        return null;
      }

      let callbackUrl: string;
      try {
        callbackUrl = twilioStatusCallbackUrl(configuration.webhookUrl, message.id);
      } catch {
        await failQueuedMessage(tx, data.tenantId, message.id, 'integration_unavailable');
        return null;
      }

      const claimed = await tx.message.updateMany({
        where: {
          id: message.id,
          tenantId: data.tenantId,
          direction: 'OUTBOUND',
          status: 'QUEUED',
        },
        data: { status: 'SENDING' },
      });
      if (claimed.count !== 1) return null;
      await tx.auditLog.create({
        data: {
          tenantId: data.tenantId,
          actorType: 'SYSTEM',
          action: 'message.outbound.sending',
          resourceType: 'message',
          resourceId: message.id,
          correlationId: data.correlationId ?? null,
        },
      });
      return {
        integrationId,
        to: message.toAddress,
        body: message.body,
        statusCallbackUrl: callbackUrl,
        idempotencyKey: message.idempotencyKey ?? message.id,
      };
    });
  }

  private async recordProviderAcceptance(
    data: SendMessageJob,
    providerMessageId: string,
    providerStatus: 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'FAILED',
  ): Promise<void> {
    await this.database.withJobTenant(data, async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM public.messages
        WHERE tenant_id = ${data.tenantId}::uuid AND id = ${data.messageId}::uuid
        FOR UPDATE
      `;
      const message = await tx.message.findFirst({
        where: { id: data.messageId, tenantId: data.tenantId },
      });
      if (
        !message ||
        message.status === 'FAILED' ||
        message.status === 'DELIVERED' ||
        message.status === 'READ'
      ) {
        return;
      }
      const nextStatus = laterStatus(message.status, providerStatus);
      const providerIdChanged = message.providerMessageId !== providerMessageId;
      if (nextStatus === message.status && !providerIdChanged) return;
      const now = new Date();
      const changed = await tx.message.updateMany({
        where: {
          id: message.id,
          tenantId: data.tenantId,
          status: message.status,
          providerMessageId: message.providerMessageId,
        },
        data: {
          providerMessageId,
          status: nextStatus,
          ...(['SENT', 'DELIVERED'].includes(nextStatus) && message.sentAt === null
            ? { sentAt: now }
            : {}),
          ...(nextStatus === 'DELIVERED' && message.deliveredAt === null
            ? { deliveredAt: now }
            : {}),
          ...(nextStatus === 'FAILED'
            ? { failedAt: now, failureReason: 'provider_delivery_failed' }
            : {}),
        },
      });
      if (changed.count === 1) {
        await tx.auditLog.create({
          data: {
            tenantId: data.tenantId,
            actorType: 'SYSTEM',
            action: 'message.outbound.provider_accepted',
            resourceType: 'message',
            resourceId: message.id,
            correlationId: data.correlationId ?? null,
            metadata: { provider: 'twilio', providerMessageId, status: nextStatus },
          },
        });
      }
    });
  }

  private async requeueKnownRejection(data: SendMessageJob): Promise<void> {
    await this.database.withJobTenant(data, async (tx) => {
      await tx.message.updateMany({
        where: { id: data.messageId, tenantId: data.tenantId, status: 'SENDING' },
        data: { status: 'QUEUED' },
      });
    });
  }

  private async failWithoutRetry(data: SendMessageJob, reason: string): Promise<void> {
    await this.database.withJobTenant(data, async (tx) => {
      const changed = await tx.message.updateMany({
        where: {
          id: data.messageId,
          tenantId: data.tenantId,
          status: { in: ['QUEUED', 'SENDING'] },
        },
        data: { status: 'FAILED', failedAt: new Date(), failureReason: reason },
      });
      if (changed.count > 0) {
        await tx.auditLog.create({
          data: {
            tenantId: data.tenantId,
            actorType: 'SYSTEM',
            action: 'message.outbound.failed',
            resourceType: 'message',
            resourceId: data.messageId,
            correlationId: data.correlationId ?? null,
            metadata: { reason },
          },
        });
      }
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<SendMessageJob> | undefined, error: Error): void {
    this.logger.error(
      `Notification job failed tenantId=${job?.data?.tenantId ?? 'unknown'} messageId=${job?.data?.messageId ?? 'unknown'} error=${error.name}`,
    );
  }
}

async function failQueuedMessage(
  tx: TenantScopedClient,
  tenantId: string,
  messageId: string,
  reason: string,
): Promise<void> {
  const changed = await tx.message.updateMany({
    where: { id: messageId, tenantId, status: 'QUEUED' },
    data: { status: 'FAILED', failedAt: new Date(), failureReason: reason },
  });
  if (changed.count > 0) {
    await tx.auditLog.create({
      data: {
        tenantId,
        actorType: 'SYSTEM',
        action:
          reason === 'recipient_opted_out'
            ? 'message.outbound.suppressed'
            : 'message.outbound.failed',
        resourceType: 'message',
        resourceId: messageId,
        metadata: { reason },
      },
    });
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function laterStatus(
  current: 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED',
  incoming: 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'FAILED',
): 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' {
  if (current === 'FAILED' || current === 'DELIVERED' || current === 'READ') return current;
  if (incoming === 'FAILED') return 'FAILED';
  const rank = { QUEUED: 0, SENDING: 1, SENT: 2, DELIVERED: 3, READ: 4 } as const;
  return rank[incoming] > rank[current] ? incoming : current;
}

function failureCode(error: unknown): string {
  if (error instanceof MessagingProviderError) return `provider:${error.code}`;
  return 'provider_operation_failed';
}
