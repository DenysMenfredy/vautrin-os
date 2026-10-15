import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type ChangeConversationStatusRequest,
  type ConversationPageResponse,
  type ConversationResponse,
  type CreateConversationRequest,
  type ListConversationsRequest,
  type MessagePageResponse,
  type MessageResponse,
  messageReceivedEvent,
  messageSendRequestedEvent,
  type SendMessageRequest,
} from '@vautrin/contracts';
import {
  type Conversation,
  type Message,
  Prisma,
  type TenantScopedClient,
} from '@vautrin/database';

import { buildPage, cursorFilter, DEFAULT_PAGE_SIZE, decodeCursor } from '../common/cursor-page.js';
import { DatabaseService } from '../database/database.service.js';
import { isStopCommand } from './communication-policy.js';
import type { InboundMessageInput } from './inbound-message.js';

@Injectable()
export class ConversationsService {
  constructor(private readonly database: DatabaseService) {}

  async recordDeliveryStatusFromWebhook(
    tenantId: string,
    messageId: string,
    integrationId: string,
    input: {
      readonly providerMessageId: string;
      readonly status: Message['status'];
      readonly fromAddress: string;
      readonly toAddress: string;
      readonly failureReason: string | null;
    },
  ): Promise<void> {
    await this.database.withTenant(tenantId, async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM public.messages
        WHERE tenant_id = ${tenantId}::uuid AND id = ${messageId}::uuid
        FOR UPDATE
      `;
      const message = await tx.message.findFirst({ where: { tenantId, id: messageId } });
      if (!message) throw new NotFoundException('Outbound message not found.');
      if (
        message.direction !== 'OUTBOUND' ||
        message.provider !== 'twilio' ||
        (message.providerMessageId !== null &&
          message.providerMessageId !== input.providerMessageId) ||
        message.fromAddress !== input.fromAddress ||
        message.toAddress !== input.toAddress ||
        jsonRecord(message.metadata).integrationId !== integrationId
      ) {
        throw new NotFoundException('Outbound message not found.');
      }

      const nextStatus = deliveryStatusAfter(message.status, input.status);
      const providerMessageId = message.providerMessageId ?? input.providerMessageId;
      const statusChanged = nextStatus !== message.status;
      const identityChanged = message.providerMessageId === null;
      if (!statusChanged && !identityChanged) return;

      const now = new Date();
      await tx.message.updateMany({
        where: { id: message.id, tenantId },
        data: {
          providerMessageId,
          status: nextStatus,
          ...(['SENT', 'DELIVERED', 'READ'].includes(nextStatus) && message.sentAt === null
            ? { sentAt: now }
            : {}),
          ...(nextStatus === 'DELIVERED' || nextStatus === 'READ' ? { deliveredAt: now } : {}),
          ...(nextStatus === 'FAILED'
            ? { failedAt: now, failureReason: input.failureReason ?? 'provider_delivery_failed' }
            : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: 'INTEGRATION',
          actorLabel: 'twilio',
          action: 'message.delivery_status_updated',
          resourceType: 'message',
          resourceId: message.id,
          metadata: {
            fromStatus: message.status,
            toStatus: nextStatus,
            providerMessageId,
          },
        },
      });
    });
  }

  async sendMessage(
    tenantId: string,
    actorId: string,
    conversationId: string,
    input: SendMessageRequest,
  ): Promise<MessageResponse> {
    const body = input.body.trim();
    if (!body) throw new BadRequestException('Message body is required.');
    if (body.length > 1600) throw new BadRequestException('Message body is too long.');

    try {
      const message = await this.database.withTenant(tenantId, async (tx) => {
        const existing = await tx.message.findFirst({
          where: { tenantId, idempotencyKey: input.idempotencyKey },
        });
        if (existing) {
          if (
            existing.conversationId !== conversationId ||
            existing.direction !== 'OUTBOUND' ||
            existing.body !== body
          ) {
            throw new ConflictException('Idempotency key was already used for another request.');
          }
          return existing;
        }

        const conversation = await tx.conversation.findFirst({
          where: { tenantId, id: conversationId },
          select: { id: true, contactId: true, channel: true, status: true, externalId: true },
        });
        if (!conversation) throw new NotFoundException('Conversation not found.');
        if (conversation.channel !== 'SMS') {
          throw new BadRequestException('Outbound messaging currently supports SMS only.');
        }
        if (conversation.status === 'CLOSED') {
          throw new ConflictException('Cannot send a message to a closed conversation.');
        }

        const contact = await tx.contact.findFirst({
          where: { tenantId, id: conversation.contactId, deletedAt: null },
          select: { id: true, phone: true },
        });
        if (!contact) throw new NotFoundException('Conversation contact not found.');
        const recipient = normalizeAddress('SMS', contact.phone ?? '');
        const preference = await tx.contactChannelPreference.findFirst({
          where: {
            tenantId,
            contactId: contact.id,
            channel: 'SMS',
            optedOutAt: { not: null },
          },
          select: { id: true },
        });
        if (preference) throw new ConflictException('Contact has opted out of SMS messages.');

        const configuredSender = conversation.externalId?.split(':')[0];
        const integrations = await tx.integration.findMany({
          where: {
            tenantId,
            provider: 'twilio',
            category: 'MESSAGING',
            status: { in: ['CONNECTED', 'HEALTHY', 'DEGRADED'] },
          },
          select: { id: true, configuration: true },
        });
        const matching = integrations.filter((integration) => {
          const configuration = jsonRecord(integration.configuration);
          const phoneNumber =
            typeof configuration.phoneNumber === 'string' ? configuration.phoneNumber : '';
          return configuredSender
            ? phoneNumber === configuredSender
            : integrations.length === 1 && phoneNumber.length > 0;
        });
        if (matching.length !== 1) {
          throw new ConflictException('A single active Twilio SMS sender must be configured.');
        }
        const integration = matching[0];
        if (!integration) throw new ConflictException('Twilio SMS sender is unavailable.');
        const configuration = jsonRecord(integration.configuration);
        const sender = normalizeAddress(
          'SMS',
          typeof configuration.phoneNumber === 'string' ? configuration.phoneNumber : '',
        );

        const created = await tx.message.create({
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
            idempotencyKey: input.idempotencyKey,
            metadata: { integrationId: integration.id },
          },
        });
        const event = messageSendRequestedEvent(created.id, conversationId, contact.id);
        await tx.event.create({
          data: {
            tenantId,
            name: event.name,
            version: event.version,
            aggregateType: 'message',
            aggregateId: created.id,
            payload: event.payload,
            idempotencyKey: `message.send_requested:${created.id}`,
          },
        });
        await tx.conversation.updateMany({
          where: {
            id: conversationId,
            tenantId,
            OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: created.createdAt } }],
          },
          data: { lastMessageAt: created.createdAt },
        });
        await tx.auditLog.create({
          data: {
            tenantId,
            actorType: 'USER',
            actorId,
            action: 'message.outbound.queued',
            resourceType: 'message',
            resourceId: created.id,
          },
        });
        return created;
      });
      return mapMessage(message);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.database.withTenant(tenantId, (tx) =>
          tx.message.findFirst({ where: { tenantId, idempotencyKey: input.idempotencyKey } }),
        );
        if (
          existing?.conversationId === conversationId &&
          existing.direction === 'OUTBOUND' &&
          existing.body === body
        ) {
          return mapMessage(existing);
        }
        throw new ConflictException('Idempotency key was already used for another request.');
      }
      throw error;
    }
  }

  /** Technical suppression only; this is not a legal consent decision. */
  isSuppressed(tenantId: string, contactId: string, channel: Message['channel']): Promise<boolean> {
    return this.database.withTenant(tenantId, async (tx) => {
      const contact = await tx.contact.findFirst({
        where: { id: contactId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!contact) return true; // fail closed for absent/foreign contacts
      const preference = await tx.contactChannelPreference.findFirst({
        where: { tenantId, contactId, channel, optedOutAt: { not: null } },
        select: { id: true },
      });
      return preference !== null;
    });
  }

  /** Called only after a provider adapter authenticates and resolves the tenant. */
  async recordInbound(tenantId: string, input: InboundMessageInput): Promise<MessageResponse> {
    if (!input.provider.trim() || !input.providerEventId.trim() || !input.body.trim()) {
      throw new BadRequestException('Provider, event ID and message body are required.');
    }
    const message = await this.database.withTenant(tenantId, (tx) =>
      this.persistInbound(tx, tenantId, input),
    );
    return mapMessage(message);
  }

  /**
   * Called only by a verified provider webhook. Contact/conversation resolution,
   * message deduplication, opt-out, audit, and the event outbox share one commit.
   */
  async recordInboundFromWebhook(
    tenantId: string,
    input: Omit<InboundMessageInput, 'conversationId'>,
  ): Promise<MessageResponse> {
    const providerMessageId = input.providerMessageId;
    if (
      !input.provider.trim() ||
      !input.providerEventId.trim() ||
      !providerMessageId?.trim() ||
      !input.body.trim()
    ) {
      throw new BadRequestException('Provider, event ID and message body are required.');
    }
    const message = await this.database.withTenant(tenantId, async (tx) => {
      const fromAddress = normalizeAddress('SMS', input.fromAddress);
      const toAddress = normalizeAddress('SMS', input.toAddress);
      const existing = await tx.message.findFirst({
        where: { tenantId, provider: input.provider, providerMessageId },
      });
      if (existing) {
        if (existing.fromAddress !== fromAddress || existing.toAddress !== toAddress) {
          throw new ConflictException('Provider message identity conflict.');
        }
        return existing;
      }

      // Serialize contact/conversation creation for one inbound sender. The
      // contact phone index alone is not unique because CRM can contain
      // historical duplicates. This is transaction-local and tenant-specific.
      await tx.$queryRaw`
        SELECT 1 AS acquired
        FROM pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${fromAddress}`}, 0))
      `;
      let contact = await tx.contact.findFirst({
        where: { tenantId, phone: fromAddress, deletedAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (!contact) {
        contact = await tx.contact.create({ data: { tenantId, phone: fromAddress } });
        await tx.auditLog.create({
          data: {
            tenantId,
            actorType: 'INTEGRATION',
            actorLabel: input.provider,
            action: 'contact.created.from_message',
            resourceType: 'contact',
            resourceId: contact.id,
          },
        });
      }
      const externalId = `${toAddress}:${fromAddress}`;
      let conversation = await tx.conversation.findFirst({
        where: { tenantId, channel: 'SMS', externalId },
      });
      if (conversation?.status === 'CLOSED') {
        conversation = await tx.conversation.update({
          where: { id: conversation.id },
          data: { status: 'OPEN' },
        });
      }
      if (!conversation) {
        const reusable = await tx.conversation.findFirst({
          where: {
            tenantId,
            contactId: contact.id,
            channel: 'SMS',
            externalId: null,
            status: { in: ['OPEN', 'PENDING'] },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        conversation = reusable
          ? await tx.conversation.update({
              where: { id: reusable.id },
              data: { externalId },
            })
          : await tx.conversation.create({
              data: { tenantId, contactId: contact.id, channel: 'SMS', externalId },
            });
        await tx.auditLog.create({
          data: {
            tenantId,
            actorType: 'INTEGRATION',
            actorLabel: input.provider,
            action: 'conversation.opened.from_message',
            resourceType: 'conversation',
            resourceId: conversation.id,
          },
        });
      }
      return this.persistInbound(tx, tenantId, { ...input, conversationId: conversation.id });
    });
    return mapMessage(message);
  }

  private async persistInbound(
    tx: TenantScopedClient,
    tenantId: string,
    input: InboundMessageInput,
  ): Promise<Message> {
    const conversation = await tx.conversation.findFirst({
      where: { id: input.conversationId, tenantId },
      select: { id: true, contactId: true, channel: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');
    const fromAddress = normalizeAddress(conversation.channel, input.fromAddress);
    const toAddress = normalizeAddress(conversation.channel, input.toAddress);
    const provider = input.provider.trim();
    const providerEventId = input.providerEventId.trim();
    const providerMessageId = input.providerMessageId?.trim() || null;
    const inserted = await tx.message.createMany({
      data: [
        {
          tenantId,
          conversationId: conversation.id,
          direction: 'INBOUND',
          channel: conversation.channel,
          status: 'DELIVERED',
          body: input.body,
          fromAddress,
          toAddress,
          provider,
          providerEventId,
          providerMessageId,
          correlationId: input.correlationId ?? null,
          deliveredAt: new Date(),
        },
      ],
      skipDuplicates: true,
    });
    const existing = await tx.message.findFirst({
      where: {
        tenantId,
        provider,
        OR: [{ providerEventId }, ...(providerMessageId ? [{ providerMessageId }] : [])],
      },
    });
    if (!existing) throw new ConflictException('Provider event could not be resolved.');
    if (inserted.count === 0) {
      if (existing.conversationId !== conversation.id) {
        throw new ConflictException('Provider message belongs to another conversation.');
      }
      return existing;
    }

    if (isStopCommand(conversation.channel, input.body)) {
      const preference = await tx.contactChannelPreference.createMany({
        data: [
          {
            tenantId,
            contactId: conversation.contactId,
            channel: conversation.channel,
            optedOutAt: existing.createdAt,
            source: 'provider_stop',
            sourceEventId: providerEventId,
          },
        ],
        skipDuplicates: true,
      });
      const reactivated =
        preference.count === 0
          ? await tx.contactChannelPreference.updateMany({
              where: {
                tenantId,
                contactId: conversation.contactId,
                channel: conversation.channel,
                optedOutAt: null,
              },
              data: {
                optedOutAt: existing.createdAt,
                source: 'provider_stop',
                sourceEventId: providerEventId,
              },
            })
          : { count: 0 };
      if (preference.count + reactivated.count > 0) {
        await tx.auditLog.create({
          data: {
            tenantId,
            actorType: 'INTEGRATION',
            actorLabel: provider,
            action: 'contact.communication.opted_out',
            resourceType: 'contact',
            resourceId: conversation.contactId,
            correlationId: input.correlationId ?? null,
          },
        });
      }
    }

    await tx.conversation.updateMany({
      where: {
        id: conversation.id,
        tenantId,
        OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: existing.createdAt } }],
      },
      data: { lastMessageAt: existing.createdAt },
    });
    const event = messageReceivedEvent(existing.id, conversation.id, conversation.contactId);
    await tx.event.create({
      data: {
        tenantId,
        name: event.name,
        version: event.version,
        aggregateType: 'message',
        aggregateId: existing.id,
        payload: event.payload,
        correlationId: input.correlationId ?? null,
        idempotencyKey: `message.received:${existing.id}`,
      },
    });
    await tx.auditLog.create({
      data: {
        tenantId,
        actorType: 'INTEGRATION',
        actorLabel: provider,
        action: 'message.inbound.recorded',
        resourceType: 'message',
        resourceId: existing.id,
        correlationId: input.correlationId ?? null,
      },
    });
    return existing;
  }

  async list(
    tenantId: string,
    options: ListConversationsRequest,
  ): Promise<ConversationPageResponse> {
    const limit = options.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = decodeCursor(options.cursor);
    const where: Prisma.ConversationWhereInput = { tenantId };
    if (options.contactId) where.contactId = options.contactId;
    if (options.leadId) where.leadId = options.leadId;
    if (options.channel) where.channel = options.channel;
    if (options.status) where.status = options.status;
    if (cursor) where.AND = [cursorFilter(cursor)];
    const rows = await this.database.withTenant(tenantId, (tx) =>
      tx.conversation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    );
    return buildPage(rows, limit, mapConversation);
  }

  async get(tenantId: string, conversationId: string): Promise<ConversationResponse> {
    const conversation = await this.database.withTenant(tenantId, (tx) =>
      tx.conversation.findFirst({ where: { id: conversationId, tenantId } }),
    );
    if (!conversation) throw new NotFoundException('Conversation not found.');
    return mapConversation(conversation);
  }

  async create(
    tenantId: string,
    actorId: string,
    input: CreateConversationRequest,
  ): Promise<ConversationResponse> {
    const conversation = await this.database.withTenant(tenantId, async (tx) => {
      const contact = await tx.contact.findFirst({
        where: { id: input.contactId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!contact) throw new NotFoundException('Contact not found.');
      if (input.leadId) {
        const lead = await tx.lead.findFirst({
          where: { id: input.leadId, tenantId, contactId: input.contactId, deletedAt: null },
          select: { id: true },
        });
        if (!lead) throw new NotFoundException('Lead not found for this contact.');
      }
      const created = await tx.conversation.create({
        data: {
          tenantId,
          contactId: input.contactId,
          leadId: input.leadId ?? null,
          channel: input.channel,
          subject: input.subject ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: 'USER',
          actorId,
          action: 'conversation.created',
          resourceType: 'conversation',
          resourceId: created.id,
        },
      });
      return created;
    });
    return mapConversation(conversation);
  }

  async changeStatus(
    tenantId: string,
    actorId: string,
    conversationId: string,
    input: ChangeConversationStatusRequest,
  ): Promise<ConversationResponse> {
    const conversation = await this.database.withTenant(tenantId, async (tx) => {
      const changed = await tx.conversation.updateMany({
        where: { id: conversationId, tenantId },
        data: { status: input.status, updatedAt: new Date() },
      });
      if (changed.count === 0) throw new NotFoundException('Conversation not found.');
      const result = await tx.conversation.findFirst({ where: { id: conversationId, tenantId } });
      if (!result) throw new NotFoundException('Conversation not found.');
      if (input.status === 'OPEN') {
        const metadata =
          result.metadata && typeof result.metadata === 'object' && !Array.isArray(result.metadata)
            ? result.metadata
            : {};
        result.metadata = { ...metadata, handoff: false, handoffReason: null };
        await tx.conversation.update({
          where: { id: result.id, tenantId },
          data: { metadata: result.metadata },
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: 'USER',
          actorId,
          action: 'conversation.status_changed',
          resourceType: 'conversation',
          resourceId: conversationId,
        },
      });
      return result;
    });
    return mapConversation(conversation);
  }

  async listMessages(
    tenantId: string,
    conversationId: string,
    options: { readonly limit?: number; readonly cursor?: string },
  ): Promise<MessagePageResponse> {
    const limit = options.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = decodeCursor(options.cursor);
    const rows = await this.database.withTenant(tenantId, async (tx) => {
      const exists = await tx.conversation.findFirst({
        where: { id: conversationId, tenantId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Conversation not found.');
      const where: Prisma.MessageWhereInput = { tenantId, conversationId };
      if (cursor) where.AND = [cursorFilter(cursor)];
      return tx.message.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
    });
    return buildPage(rows, limit, mapMessage);
  }
}

function mapConversation(row: Conversation): ConversationResponse {
  const metadata =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? row.metadata
      : {};
  return {
    id: row.id,
    contactId: row.contactId,
    leadId: row.leadId,
    channel: row.channel,
    status: row.status,
    handoff:
      metadata.handoff === true &&
      typeof metadata.handoffReason === 'string' &&
      /^[a-z][a-z0-9_]{0,127}$/.test(metadata.handoffReason)
        ? { reason: metadata.handoffReason }
        : null,
    subject: row.subject,
    assignedUserId: row.assignedUserId,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapMessage(row: Message): MessageResponse {
  return {
    id: row.id,
    conversationId: row.conversationId,
    direction: row.direction,
    channel: row.channel,
    status: row.status,
    body: row.body,
    fromAddress: row.fromAddress,
    toAddress: row.toAddress,
    provider: row.provider,
    providerMessageId: row.providerMessageId,
    sentAt: row.sentAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    failedAt: row.failedAt?.toISOString() ?? null,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizeAddress(channel: Conversation['channel'], value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new BadRequestException('Message addresses are required.');
  if (channel === 'EMAIL') {
    const email = normalized.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Email address is invalid.');
    }
    return email;
  }
  if (['SMS', 'WHATSAPP', 'VOICE'].includes(channel) && !/^\+[1-9]\d{1,14}$/.test(normalized)) {
    throw new BadRequestException('Phone address must use E.164 format.');
  }
  return normalized;
}

function jsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function deliveryStatusAfter(
  current: Message['status'],
  incoming: Message['status'],
): Message['status'] {
  if (current === 'FAILED' || current === 'DELIVERED' || current === 'READ') return current;
  if (incoming === 'FAILED') return 'FAILED';
  const rank: Record<Exclude<Message['status'], 'FAILED'>, number> = {
    QUEUED: 0,
    SENDING: 1,
    SENT: 2,
    DELIVERED: 3,
    READ: 4,
  };
  return rank[incoming as Exclude<Message['status'], 'FAILED'>] >
    rank[current as Exclude<Message['status'], 'FAILED'>]
    ? incoming
    : current;
}
