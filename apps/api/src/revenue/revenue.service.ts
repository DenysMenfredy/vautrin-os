import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  businessHoursSchema,
  leadCreatedEvent,
  type MissedCallRequest,
  type MissedCallResponse,
  type RemodelingTemplateRequest,
  type RemodelingTemplateResponse,
  validateWorkflowDefinitionForActivation,
} from '@vautrin/contracts';
import { Prisma } from '@vautrin/database';
import {
  missedCallWorkflow,
  RECEPTIONIST_POLICY,
  RECEPTIONIST_PROMPT_VERSION,
  REMODELING_BOOKING_RULES,
  REMODELING_QUALIFICATION_RULES,
  REMODELING_SERVICES,
  remodelingHours,
} from '@vautrin/revenue';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class RevenueService {
  constructor(private readonly database: DatabaseService) {}
  missedCall(
    tenantId: string,
    actorId: string,
    input: MissedCallRequest,
    requestCorrelationId?: string,
  ): Promise<MissedCallResponse> {
    const correlationId =
      requestCorrelationId &&
      /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestCorrelationId)
        ? requestCorrelationId
        : randomUUID();
    return this.database.withTenant(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${input.fromNumber}`}::text, 0))::text`;
      const prior = await tx.call.findFirst({
        where: { tenantId, provider: 'controlled', providerCallId: input.idempotencyKey },
      });
      if (prior) {
        if (
          prior.fromNumber !== input.fromNumber ||
          !prior.contactId ||
          !prior.leadId ||
          !prior.conversationId
        )
          throw new ConflictException('Missed-call identity conflict.');
        return {
          callId: prior.id,
          contactId: prior.contactId,
          leadId: prior.leadId,
          conversationId: prior.conversationId,
        };
      }
      const senders = await tx.integration.findMany({
        where: {
          tenantId,
          provider: 'twilio',
          category: 'MESSAGING',
          status: { in: ['CONNECTED', 'HEALTHY', 'DEGRADED'] },
        },
        take: 2,
      });
      const sender = senders[0];
      const config =
        sender?.configuration &&
        typeof sender.configuration === 'object' &&
        !Array.isArray(sender.configuration)
          ? sender.configuration
          : {};
      if (
        senders.length !== 1 ||
        typeof config.phoneNumber !== 'string' ||
        !/^\+[1-9]\d{7,14}$/.test(config.phoneNumber)
      )
        throw new BadRequestException(
          'Configure one active SMS sender before recording a missed call.',
        );
      let contact = await tx.contact.findFirst({
        where: { tenantId, phone: input.fromNumber, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      if (!contact)
        contact = await tx.contact.create({
          data: { tenantId, phone: input.fromNumber, createdBy: actorId },
        });
      let lead = await tx.lead.findFirst({
        where: {
          tenantId,
          contactId: contact.id,
          deletedAt: null,
          status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!lead) {
        lead = await tx.lead.create({
          data: {
            tenantId,
            contactId: contact.id,
            title: 'Missed call inquiry',
            createdBy: actorId,
          },
        });
        const event = leadCreatedEvent(lead.id, contact.id);
        await tx.event.create({
          data: {
            tenantId,
            ...event,
            payload: event.payload as Prisma.InputJsonValue,
            aggregateType: 'lead',
            aggregateId: lead.id,
            correlationId,
            idempotencyKey: `lead.created:${lead.id}`,
          },
        });
      }
      const externalId = `${config.phoneNumber}:${input.fromNumber}`;
      let conversation = await tx.conversation.findFirst({
        where: { tenantId, channel: 'SMS', externalId },
      });
      if (!conversation)
        conversation = await tx.conversation.create({
          data: { tenantId, contactId: contact.id, leadId: lead.id, channel: 'SMS', externalId },
        });
      if (conversation.contactId !== contact.id)
        throw new ConflictException('SMS conversation identity conflict.');
      if (conversation.status === 'CLOSED')
        conversation = await tx.conversation.update({
          where: { id: conversation.id, tenantId },
          data: { status: 'OPEN', leadId: lead.id },
        });
      else if (conversation.leadId !== lead.id)
        throw new ConflictException('The SMS conversation already belongs to another lead.');
      const call = await tx.call.create({
        data: {
          tenantId,
          contactId: contact.id,
          leadId: lead.id,
          conversationId: conversation.id,
          direction: 'INBOUND',
          status: 'MISSED',
          provider: 'controlled',
          providerCallId: input.idempotencyKey,
          fromNumber: input.fromNumber,
          toNumber: config.phoneNumber,
          startedAt: new Date(),
          endedAt: new Date(),
        },
      });
      const result = {
        callId: call.id,
        contactId: contact.id,
        leadId: lead.id,
        conversationId: conversation.id,
      };
      await tx.event.create({
        data: {
          tenantId,
          name: 'call.missed',
          version: 1,
          aggregateType: 'call',
          aggregateId: call.id,
          payload: result,
          idempotencyKey: `call.missed:${call.id}`,
          correlationId,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: 'USER',
          actorId,
          action: 'call.missed.recorded',
          correlationId,
          resourceType: 'call',
          resourceId: call.id,
        },
      });
      return result;
    });
  }

  installTemplate(
    tenantId: string,
    actorId: string,
    input: RemodelingTemplateRequest,
  ): Promise<RemodelingTemplateResponse> {
    const hours = businessHoursSchema.safeParse(remodelingHours(input.timezone));
    if (!hours.success) throw new BadRequestException('Invalid business timezone.');
    const recovery = validateWorkflowDefinitionForActivation(
      missedCallWorkflow(
        input.recoveryDelayMs ?? 30_000,
        input.followUpDelaysMs ?? [7_200_000, 86_400_000],
      ),
    );
    return this.database.withTenant(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}::text, 55432))::text`;
      const previous = await tx.agent.findFirst({
        where: { tenantId, key: 'receptionist', promptVersion: RECEPTIONIST_PROMPT_VERSION },
        orderBy: { version: 'desc' },
      });
      if (previous) {
        const workflows = await tx.workflow.findMany({
          where: { tenantId, key: { in: ['missed_call_recovery_v1', 'receptionist_reply_v1'] } },
        });
        return {
          templateVersion: 'remodeling-v1',
          agentId: previous.id,
          workflowIds: workflows.map((row) => row.id),
        };
      }
      if (await tx.agent.findFirst({ where: { tenantId, key: 'receptionist' } }))
        throw new ConflictException(
          'A receptionist already exists. Configure its version before installing this template.',
        );
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new BadRequestException('Tenant unavailable.');
      const profile = await tx.businessProfile.findFirst({ where: { tenantId } });
      const empty = (value: unknown) =>
        Boolean(
          value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            Object.keys(value).length === 0,
        );
      const configuration = {
        timezone: input.timezone,
        businessHours: hours.data as Prisma.InputJsonValue,
        qualificationRules: REMODELING_QUALIFICATION_RULES,
        bookingRules: REMODELING_BOOKING_RULES as unknown as Prisma.InputJsonValue,
      };
      if (!profile)
        await tx.businessProfile.create({
          data: { tenantId, displayName: tenant.name, ...configuration },
        });
      else
        await tx.businessProfile.update({
          where: { id: profile.id, tenantId },
          data: {
            ...(empty(profile.businessHours)
              ? { businessHours: configuration.businessHours, timezone: input.timezone }
              : {}),
            ...(empty(profile.qualificationRules)
              ? { qualificationRules: configuration.qualificationRules }
              : {}),
            ...(empty(profile.bookingRules) ? { bookingRules: configuration.bookingRules } : {}),
          },
        });
      for (const service of REMODELING_SERVICES)
        await tx.service.upsert({
          where: { tenantId_key: { tenantId, key: service.key } },
          create: { tenantId, ...service },
          update: {},
        });
      for (const value of new Set(input.postalCodes))
        if (!(await tx.serviceArea.findFirst({ where: { tenantId, type: 'POSTAL_CODE', value } })))
          await tx.serviceArea.create({ data: { tenantId, type: 'POSTAL_CODE', value } });
      for (const key of [
        'project_type',
        'property_type',
        'service_location',
        'budget_range',
        'desired_timeline',
        'project_description',
      ])
        await tx.customFieldDefinition.upsert({
          where: { tenantId_entityType_key: { tenantId, entityType: 'LEAD', key } },
          create: {
            tenantId,
            entityType: 'LEAD',
            key,
            label: key.replaceAll('_', ' '),
            fieldType: 'TEXT',
          },
          update: {},
        });
      const agent = await tx.agent.create({
        data: {
          tenantId,
          key: 'receptionist',
          name: 'Remodeling Receptionist',
          instructions: RECEPTIONIST_POLICY,
          promptVersion: RECEPTIONIST_PROMPT_VERSION,
          modelConfiguration: { provider: 'openai', model: input.model },
          allowedTools: [
            'capture_contact',
            'qualify_lead',
            'check_availability',
            'create_appointment',
            'human_handoff',
          ],
          guardrails: {
            capabilities: [
              'contact.write',
              'lead.write',
              'appointment.read',
              'appointment.write',
              'conversation.write',
            ],
          },
          status: 'DRAFT',
        },
      });
      await tx.agent.update({ where: { id: agent.id, tenantId }, data: { status: 'ACTIVE' } });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: 'USER',
          actorId,
          action: 'agent.activated',
          resourceType: 'agent',
          resourceId: agent.id,
        },
      });
      const definitions = [
        {
          key: 'missed_call_recovery_v1',
          name: 'Missed call recovery',
          trigger: 'call.missed',
          definition: recovery,
        },
        {
          key: 'receptionist_reply_v1',
          name: 'Receptionist replies',
          trigger: 'message.received',
          definition: {
            steps: [
              {
                id: 'qualify',
                type: 'call_agent',
                config: { agentKey: 'receptionist', purpose: 'qualification' },
              },
              { id: 'finish', type: 'end', config: {} },
            ],
          },
        },
      ];
      const workflowIds: string[] = [];
      for (const item of definitions) {
        if (await tx.workflow.findFirst({ where: { tenantId, key: item.key } }))
          throw new ConflictException('A template workflow already exists.');
        const workflow = await tx.workflow.create({
          data: {
            tenantId,
            ...item,
            definition: item.definition as unknown as Prisma.InputJsonValue,
            status: 'ACTIVE',
            failurePolicy: { action: 'human_handoff' },
            retryPolicy: {
              maxAttempts: 3,
              initialDelayMs: 5000,
              maxDelayMs: 300000,
              retryableErrors: [
                'llm_network_error',
                'llm_rate_limited',
                'llm_unavailable',
                'provider_retryable',
              ],
              terminalErrors: [],
            },
          },
        });
        workflowIds.push(workflow.id);
        await tx.auditLog.create({
          data: {
            tenantId,
            actorType: 'USER',
            actorId,
            action: 'workflow.activated',
            resourceType: 'workflow',
            resourceId: workflow.id,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: 'USER',
          actorId,
          action: 'template.remodeling.installed',
          resourceType: 'agent',
          resourceId: agent.id,
          metadata: { templateVersion: 'remodeling-v1', workflowIds },
        },
      });
      return { templateVersion: 'remodeling-v1', agentId: agent.id, workflowIds };
    });
  }
}
