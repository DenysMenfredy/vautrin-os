import { Injectable } from '@nestjs/common';
import type { TenantScopedClient } from '@vautrin/database';

const CONVERSATION_MESSAGE_LIMIT = 20;
const MESSAGE_BODY_LIMIT = 2_000;

export interface AgentContextRequest {
  readonly conversationId?: string;
  readonly leadId?: string;
}

export interface AgentBusinessContext {
  readonly tenantId: string;
  readonly business: {
    readonly displayName: string;
    readonly description: string | null;
    readonly timezone: string;
    readonly locale: string;
    readonly currency: string;
    readonly businessHours: unknown;
    readonly communicationPreferences: unknown;
    readonly qualificationRules: unknown;
    readonly bookingRules: unknown;
  };
  readonly services: readonly {
    readonly id: string;
    readonly key: string;
    readonly name: string;
    readonly description: string | null;
    readonly metadata: unknown;
  }[];
  readonly serviceAreas: readonly {
    readonly type: string;
    readonly value: string;
    readonly configuration: unknown;
  }[];
  readonly locations: readonly {
    readonly id: string;
    readonly name: string;
    readonly city: string | null;
    readonly region: string | null;
    readonly country: string;
    readonly timezone: string | null;
    readonly serviceRadiusMiles: number | null;
  }[];
  readonly lead?: {
    readonly id: string;
    readonly status: string;
    readonly service: string | null;
    readonly title: string | null;
    readonly estimatedValue: number | null;
    readonly version: number;
    readonly qualification: unknown;
  };
  readonly contact?: {
    readonly id: string;
    readonly company: string | null;
    readonly tags: readonly string[];
  };
  readonly conversation?: {
    readonly id: string;
    readonly channel: string;
    readonly status: string;
    readonly messages: readonly {
      readonly id: string;
      readonly direction: string;
      readonly body: string;
      readonly createdAt: string;
    }[];
  };
}

export class AgentContextBuildError extends Error {
  constructor(
    readonly code:
      | 'business_profile_missing'
      | 'business_context_limit'
      | 'conversation_not_found'
      | 'lead_not_found'
      | 'context_relationship_mismatch',
  ) {
    super(code);
    this.name = 'AgentContextBuildError';
  }
}

/**
 * Builds a bounded structured context from one tenant-scoped transaction.
 * It deliberately excludes contact names, phone, email, address and notes,
 * and never returns provider configuration or credential references.
 */
@Injectable()
export class AgentContextBuilder {
  async build(
    tx: TenantScopedClient,
    tenantId: string,
    request: AgentContextRequest,
  ): Promise<AgentBusinessContext> {
    const business = await tx.businessProfile.findFirst({
      where: { tenantId },
      select: {
        displayName: true,
        description: true,
        timezone: true,
        locale: true,
        currency: true,
        businessHours: true,
        communicationPreferences: true,
        qualificationRules: true,
        bookingRules: true,
      },
    });
    if (!business) throw new AgentContextBuildError('business_profile_missing');

    const conversation = request.conversationId
      ? await tx.conversation.findFirst({
          where: { id: request.conversationId, tenantId },
          select: { id: true, leadId: true, contactId: true, channel: true, status: true },
        })
      : null;
    if (request.conversationId && !conversation) {
      throw new AgentContextBuildError('conversation_not_found');
    }

    const leadId = request.leadId ?? conversation?.leadId ?? undefined;
    const lead = leadId
      ? await tx.lead.findFirst({
          where: { id: leadId, tenantId },
          select: {
            id: true,
            contactId: true,
            status: true,
            service: true,
            title: true,
            estimatedValue: true,
            version: true,
            qualification: true,
          },
        })
      : null;
    if (leadId && !lead) throw new AgentContextBuildError('lead_not_found');
    if (conversation?.leadId && lead && conversation.leadId !== lead.id) {
      throw new AgentContextBuildError('context_relationship_mismatch');
    }
    if (conversation && lead && conversation.contactId !== lead.contactId) {
      throw new AgentContextBuildError('context_relationship_mismatch');
    }

    const contactId = lead?.contactId ?? conversation?.contactId;
    const contact = contactId
      ? await tx.contact.findFirst({
          where: { id: contactId, tenantId },
          select: { id: true, company: true, tags: true },
        })
      : null;

    const messages = conversation
      ? await tx.message.findMany({
          where: { tenantId, conversationId: conversation.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: CONVERSATION_MESSAGE_LIMIT,
          select: { id: true, direction: true, body: true, createdAt: true },
        })
      : [];
    const [services, serviceAreas, locations] = await Promise.all([
      tx.service.findMany({
        where: { tenantId, active: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: 101,
        select: { id: true, key: true, name: true, description: true, metadata: true },
      }),
      tx.serviceArea.findMany({
        where: { tenantId, active: true },
        orderBy: [{ type: 'asc' }, { value: 'asc' }],
        take: 1001,
        select: { type: true, value: true, configuration: true },
      }),
      tx.location.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }, { id: 'asc' }],
        take: 21,
        select: {
          id: true,
          name: true,
          city: true,
          region: true,
          country: true,
          timezone: true,
          serviceRadiusMiles: true,
        },
      }),
    ]);

    if (services.length > 100 || serviceAreas.length > 1000 || locations.length > 20)
      throw new AgentContextBuildError('business_context_limit');
    return {
      tenantId,
      business,
      services,
      serviceAreas,
      locations,
      ...(lead
        ? {
            lead: {
              id: lead.id,
              status: lead.status,
              service: lead.service,
              title: lead.title,
              estimatedValue: lead.estimatedValue ? Number(lead.estimatedValue.toString()) : null,
              version: lead.version,
              qualification: lead.qualification,
            },
          }
        : {}),
      ...(contact
        ? { contact: { id: contact.id, company: contact.company, tags: contact.tags } }
        : {}),
      ...(conversation
        ? {
            conversation: {
              id: conversation.id,
              channel: conversation.channel,
              status: conversation.status,
              messages: messages.reverse().map((message) => ({
                id: message.id,
                direction: message.direction,
                body: message.body.slice(0, MESSAGE_BODY_LIMIT),
                createdAt: message.createdAt.toISOString(),
              })),
            },
          }
        : {}),
    };
  }
}
