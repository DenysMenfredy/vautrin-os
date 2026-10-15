import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  availabilityToolSchema,
  bookAppointmentToolSchema,
  captureContactToolSchema,
  handoffToolSchema,
  leadStatusChangedEvent,
  qualificationAnswersSchema,
  qualificationRulesSchema,
  qualifyLeadToolSchema,
  RECEPTIONIST_TOOL_SCHEMAS,
} from '@vautrin/contracts';
import { Prisma, type TenantScopedClient } from '@vautrin/database';
import {
  GoogleCalendarProvider,
  GoogleOAuthTokenProvider,
  IntegrationCredentialStore,
} from '@vautrin/integrations';
import {
  assessQualification,
  BookingApplication,
  CalendarConnection,
  type RevenueDatabase,
} from '@vautrin/revenue';
import { DatabaseService } from '../database/database.service.js';
import { type AgentToolContext, AgentToolRegistry, ToolInputError } from './tool-registry.js';

export class ReceptionistToolError extends ToolInputError {}

@Injectable()
export class ReceptionistTools {
  readonly registry = new AgentToolRegistry();
  private readonly booking: BookingApplication;
  constructor(
    private readonly database: DatabaseService,
    calendar: GoogleCalendarProvider,
    tokens: GoogleOAuthTokenProvider,
  ) {
    const port: RevenueDatabase = {
      withTenant: (tenantId, work, options) => database.withJobTenant({ tenantId }, work, options),
    };
    this.booking = new BookingApplication(
      port,
      new CalendarConnection(port, tokens, new IntegrationCredentialStore()),
      calendar,
      'AGENT',
    );
    this.registry.register({
      name: 'qualify_lead',
      description:
        'Collect customer-stated answers with exact inbound-message evidence; the application decides qualification.',
      permission: 'lead.write',
      sideEffect: 'internal',
      requiresApproval: false,
      inputSchema: RECEPTIONIST_TOOL_SCHEMAS.qualify_lead,
      outputSchema: { type: 'object', required: ['disposition', 'missingFields'] },
      parseInput: (value) => qualifyLeadToolSchema.parse(value),
      parseOutput: parseDecision,
      execute: (context, input) =>
        this.withEntities(context, async (tx, lead) => {
          const profile = await tx.businessProfile.findFirst({
            where: { tenantId: context.tenantId },
          });
          const rules = qualificationRulesSchema.parse(profile?.qualificationRules);
          const services = await tx.service.findMany({
            where: { tenantId: context.tenantId, active: true },
            select: { key: true, name: true },
          });
          for (const [field, value] of Object.entries(input.answers)) {
            if (value === undefined) continue;
            const proof = input.evidence[field as keyof typeof input.evidence];
            if (!proof) throw new ReceptionistToolError('evidence_required');
            const quote = await assertEvidence(tx, context, proof);
            if (field === 'serviceKey') {
              const service = services.find((item) => item.key === value);
              const term = service?.name.toLowerCase().split(' ')[0] ?? value.toLowerCase();
              if (!term || !quote.toLowerCase().includes(term))
                throw new ReceptionistToolError('ungrounded_service');
            } else if (!quote.toLowerCase().includes(value.toLowerCase()))
              throw new ReceptionistToolError('ungrounded_answer');
          }
          const prior = record(lead.qualification);
          const answers = qualificationAnswersSchema.parse({
            ...record(prior.answers),
            ...input.answers,
          });
          const areas = await tx.serviceArea.findMany({
            where: { tenantId: context.tenantId, active: true },
            select: { type: true, value: true },
          });
          const decision = assessQualification(rules, answers, { services, serviceAreas: areas });
          const status =
            decision.disposition === 'QUALIFIED' && ['NEW', 'CONTACTED'].includes(lead.status)
              ? 'QUALIFIED'
              : lead.status;
          const updated = await tx.lead.updateMany({
            where: { id: lead.id, tenantId: context.tenantId, version: lead.version },
            data: {
              qualification: {
                answers,
                disposition: decision.disposition,
                missingFields: [...decision.missingFields],
              },
              ...(answers.serviceKey && services.some((item) => item.key === answers.serviceKey)
                ? { service: answers.serviceKey }
                : {}),
              status,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) throw new ReceptionistToolError('lead_concurrent_update');
          const fieldKeys: Record<string, string> = {
            serviceKey: 'project_type',
            propertyType: 'property_type',
            postalCode: 'service_location',
            budgetRange: 'budget_range',
            timeline: 'desired_timeline',
            description: 'project_description',
          };
          for (const [field, value] of Object.entries(answers)) {
            if (!value) continue;
            const definition = await tx.customFieldDefinition.findFirst({
              where: {
                tenantId: context.tenantId,
                entityType: 'LEAD',
                key: fieldKeys[field] ?? '',
                isActive: true,
              },
            });
            if (!definition) continue;
            await tx.customFieldValue.upsert({
              where: {
                tenantId_definitionId_entityId: {
                  tenantId: context.tenantId,
                  definitionId: definition.id,
                  entityId: lead.id,
                },
              },
              create: {
                tenantId: context.tenantId,
                definitionId: definition.id,
                entityType: 'LEAD',
                entityId: lead.id,
                value,
              },
              update: { value },
            });
          }
          if (status !== lead.status) {
            const event = leadStatusChangedEvent(lead.id, lead.status, status);
            await tx.event.create({
              data: {
                tenantId: context.tenantId,
                ...event,
                payload: event.payload as Prisma.InputJsonValue,
                aggregateType: 'lead',
                aggregateId: lead.id,
                idempotencyKey: `lead.status_changed:${lead.id}:${lead.version + 1}`,
                correlationId: context.correlationId ?? null,
              },
            });
          }
          return { ...decision, missingFields: [...decision.missingFields] };
        }),
    });
    this.registry.register({
      name: 'capture_contact',
      description: 'Capture only customer-stated name or postal code from an exact inbound quote.',
      permission: 'contact.write',
      sideEffect: 'internal',
      requiresApproval: false,
      inputSchema: RECEPTIONIST_TOOL_SCHEMAS.capture_contact,
      outputSchema: { type: 'object', required: ['captured'] },
      parseInput: (value) => captureContactToolSchema.parse(value),
      parseOutput: parseCaptured,
      execute: (context, input) =>
        this.withEntities(context, async (tx, lead) => {
          const quote = await assertEvidence(tx, context, input.evidence);
          for (const value of [input.firstName, input.lastName, input.postalCode])
            if (value && !quote.toLowerCase().includes(value.toLowerCase()))
              throw new ReceptionistToolError('ungrounded_contact');
          const contact = await tx.contact.findFirst({
            where: { id: lead.contactId, tenantId: context.tenantId, deletedAt: null },
          });
          if (!contact) throw new ReceptionistToolError('contact_unavailable');
          await tx.contact.update({
            where: { id: contact.id, tenantId: context.tenantId },
            data: {
              ...(input.firstName ? { firstName: input.firstName } : {}),
              ...(input.lastName ? { lastName: input.lastName } : {}),
              ...(input.postalCode
                ? { address: { ...record(contact.address), postalCode: input.postalCode } }
                : {}),
            },
          });
          return { captured: true };
        }),
    });
    this.registry.register({
      name: 'check_availability',
      description:
        'Check allowed appointment slots for the current qualified lead. Save the returned proofId for booking.',
      permission: 'appointment.read',
      sideEffect: 'none',
      requiresApproval: false,
      inputSchema: RECEPTIONIST_TOOL_SCHEMAS.check_availability,
      outputSchema: { type: 'object', required: ['slots', 'proofId'] },
      parseInput: (value) => availabilityToolSchema.parse(value),
      parseOutput: parseAvailability,
      execute: async (context, input) => {
        await this.withEntities(context, async () => undefined);
        if (!context.leadId || !context.idempotencyKey)
          throw new ReceptionistToolError('lead_context_missing');
        const availability = await this.booking.availability(context.tenantId, {
          ...input,
          leadId: context.leadId,
        });
        return { ...availability, proofId: context.idempotencyKey };
      },
    });
    this.registry.register({
      name: 'create_appointment',
      description:
        'Book a checked slot with explicit customer selection/confirmation. Never invent a slot or claim success before this tool succeeds.',
      permission: 'appointment.write',
      sideEffect: 'external',
      requiresApproval: false,
      inputSchema: RECEPTIONIST_TOOL_SCHEMAS.create_appointment,
      outputSchema: { type: 'object', required: ['appointmentId', 'startsAt'] },
      parseInput: (value) => bookAppointmentToolSchema.parse(value),
      parseOutput: parseBooking,
      execute: async (context, input) => {
        const key = await this.withEntities(context, async (tx, lead) => {
          const quote = await assertEvidence(tx, context, input.confirmation);
          const source = await tx.message.findFirstOrThrow({
            where: {
              id: input.confirmation.messageId,
              tenantId: context.tenantId,
              conversationId: context.conversationId ?? '',
              direction: 'INBOUND',
            },
          });
          const offer = await tx.message.findFirst({
            where: {
              tenantId: context.tenantId,
              conversationId: context.conversationId ?? '',
              direction: 'OUTBOUND',
              createdAt: { lt: source.createdAt },
              status: { not: 'FAILED' },
            },
            orderBy: { createdAt: 'desc' },
          });
          const offered = record(offer?.metadata).offeredSlots;
          const offeredSlots = Array.isArray(offered) ? offered : [];
          const selectedIndex = offeredSlots.findIndex(
            (slot) =>
              record(slot).startsAt === input.startsAt &&
              record(slot).appointmentTypeId === input.appointmentTypeId,
          );
          const ordinal = ['first', 'second', 'third'][selectedIndex];
          const affirmative =
            (/\b(yes|book|confirm|schedule|works|okay|ok|please)\b/i.test(source.body) ||
              /^(?:the )?(?:first|second|third)(?: (?:one|slot|time))?[.!]?$/i.test(
                source.body.trim(),
              )) &&
            !/\b(no|not|never|cancel|don.t|cannot|can.t)\b/i.test(source.body);
          const latest = await tx.message.findFirst({
            where: {
              tenantId: context.tenantId,
              conversationId: context.conversationId ?? '',
              direction: 'INBOUND',
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          });
          const explicitTime =
            quote.includes(input.startsAt) || quote.includes(input.startsAt.slice(0, 16));
          const selectedOffer =
            selectedIndex >= 0 &&
            (offeredSlots.length === 1
              ? /\b(yes|book|confirm|schedule|works|okay|ok)\b/i.test(quote)
              : Boolean(ordinal && new RegExp(`\\b${ordinal}\\b`, 'i').test(quote)));
          if (!affirmative || latest?.id !== source.id || (!explicitTime && !selectedOffer))
            throw new ReceptionistToolError('booking_confirmation_required');
          const proof = await tx.toolExecution.findFirst({
            where: {
              tenantId: context.tenantId,
              idempotencyKey: input.proofId,
              toolName: 'check_availability',
              status: 'SUCCEEDED',
              agentRun: { conversationId: context.conversationId ?? '', leadId: lead.id },
            },
          });
          const slots = record(proof?.output).slots;
          if (
            !Array.isArray(slots) ||
            !slots.some(
              (slot) =>
                record(slot).startsAt === input.startsAt &&
                record(slot).appointmentTypeId === input.appointmentTypeId,
            )
          )
            throw new ReceptionistToolError('booking_slot_not_verified');
          const prior = await tx.appointment.findFirst({
            where: {
              tenantId: context.tenantId,
              leadId: lead.id,
              status: { in: ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'] },
            },
          });
          if (prior) {
            if (prior.startsAt.toISOString() !== input.startsAt)
              throw new ReceptionistToolError('appointment_already_booked');
            return prior.idempotencyKey ?? '';
          }
          // Tool claim persists this UUID before external execution and lets retries reconcile the same provider event.
          const ledger = await tx.toolExecution.findFirst({
            where: { tenantId: context.tenantId, idempotencyKey: context.idempotencyKey ?? '' },
          });
          const saved = record(ledger?.output).bookingKey;
          if (typeof saved === 'string') return saved;
          const bookingKey = randomUUID();
          await tx.toolExecution.updateMany({
            where: { tenantId: context.tenantId, idempotencyKey: context.idempotencyKey ?? '' },
            data: { output: { bookingKey } },
          });
          return bookingKey;
        });
        if (!context.leadId || !key) throw new ReceptionistToolError('booking_identity_missing');
        const appointment = await this.booking.create(context.tenantId, context.agentRunId, {
          leadId: context.leadId,
          appointmentTypeId: input.appointmentTypeId,
          startsAt: input.startsAt,
          idempotencyKey: key,
        });
        return { appointmentId: appointment.id, startsAt: appointment.startsAt.toISOString() };
      },
    });
    this.registry.register({
      name: 'human_handoff',
      description:
        'Pause automation and put this conversation in the human inbox with a safe reason code.',
      permission: 'conversation.write',
      sideEffect: 'internal',
      requiresApproval: false,
      inputSchema: RECEPTIONIST_TOOL_SCHEMAS.human_handoff,
      outputSchema: { type: 'object', required: ['handedOff'] },
      parseInput: (value) => handoffToolSchema.parse(value),
      parseOutput: parseHandoff,
      execute: async (context, input) => {
        await this.handoff(context, input.reason);
        return { handedOff: true };
      },
    });
  }

  async handoff(context: AgentToolContext, reason: string): Promise<void> {
    await this.database.withJobTenant(context, async (tx) => {
      const conversation = await tx.conversation.findFirst({
        where: { id: context.conversationId ?? '', tenantId: context.tenantId },
      });
      const agentRun = await tx.agentRun.findFirst({
        where: { id: context.agentRunId, tenantId: context.tenantId },
      });
      if (!agentRun) throw new ReceptionistToolError('agent_run_unavailable');
      if (agentRun.workflowRunId) {
        const actionable = await lockActionableWorkflow(
          tx,
          context.tenantId,
          agentRun.workflowRunId,
        );
        if (!actionable) return;
      }
      if (!conversation) return;
      await tx.conversation.update({
        where: { id: conversation.id, tenantId: context.tenantId },
        data: {
          status: 'PENDING',
          metadata: {
            ...record(conversation.metadata),
            handoff: true,
            handoffReason: reason,
            agentRunId: context.agentRunId,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorType: 'AGENT',
          actorId: context.agentRunId,
          action: 'conversation.handoff',
          resourceType: 'conversation',
          resourceId: conversation.id,
          correlationId: context.correlationId ?? null,
          metadata: { reason },
        },
      });
    });
  }

  private withEntities<T>(
    context: AgentToolContext,
    work: (
      tx: TenantScopedClient,
      lead: {
        id: string;
        contactId: string;
        status:
          | 'NEW'
          | 'CONTACTED'
          | 'QUALIFIED'
          | 'APPOINTMENT_BOOKED'
          | 'ESTIMATE_PENDING'
          | 'ESTIMATE_SENT'
          | 'FOLLOW_UP'
          | 'WON'
          | 'LOST';
        version: number;
        qualification: unknown;
      },
    ) => Promise<T>,
  ): Promise<T> {
    return this.database.withJobTenant(context, async (tx) => {
      const run = await tx.agentRun.findFirst({
        where: { id: context.agentRunId, tenantId: context.tenantId },
      });
      if (
        !run ||
        (run.workflowRunId &&
          !(await lockActionableWorkflow(tx, context.tenantId, run.workflowRunId)))
      )
        throw new ReceptionistToolError('workflow_not_actionable');
      const conversation = await tx.conversation.findFirst({
        where: { id: context.conversationId ?? '', tenantId: context.tenantId, status: 'OPEN' },
      });
      const lead = await tx.lead.findFirst({
        where: { id: context.leadId ?? '', tenantId: context.tenantId, deletedAt: null },
      });
      if (
        !conversation ||
        !lead ||
        conversation.leadId !== lead.id ||
        conversation.contactId !== lead.contactId
      )
        throw new ReceptionistToolError('tool_context_unavailable');
      const optedOut = await tx.contactChannelPreference.findFirst({
        where: {
          tenantId: context.tenantId,
          contactId: lead.contactId,
          channel: 'SMS',
          optedOutAt: { not: null },
        },
      });
      if (optedOut) throw new ReceptionistToolError('contact_opted_out');
      return work(tx, lead);
    });
  }
}

async function assertEvidence(
  tx: TenantScopedClient,
  context: AgentToolContext,
  proof: { messageId: string; quote: string },
): Promise<string> {
  const message = await tx.message.findFirst({
    where: {
      id: proof.messageId,
      tenantId: context.tenantId,
      conversationId: context.conversationId ?? '',
      direction: 'INBOUND',
    },
  });
  if (!message?.body.includes(proof.quote)) throw new ReceptionistToolError('evidence_unavailable');
  return proof.quote;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function parseDecision(value: unknown) {
  const row = record(value);
  if (
    ![
      'QUALIFIED',
      'NEEDS_INFORMATION',
      'UNSUPPORTED_SERVICE',
      'OUTSIDE_SERVICE_AREA',
      'HUMAN_REVIEW',
    ].includes(String(row.disposition)) ||
    !Array.isArray(row.missingFields)
  )
    throw new Error('invalid_qualification_output');
  return { disposition: String(row.disposition), missingFields: row.missingFields.map(String) };
}
function parseCaptured(value: unknown) {
  if (record(value).captured !== true) throw new Error('invalid_capture_output');
  return { captured: true };
}
function parseHandoff(value: unknown) {
  if (record(value).handedOff !== true) throw new Error('invalid_handoff_output');
  return { handedOff: true };
}
function parseAvailability(value: unknown) {
  const row = record(value);
  if (!Array.isArray(row.slots) || typeof row.proofId !== 'string')
    throw new Error('invalid_availability_output');
  return {
    slots: row.slots.map((slot) => {
      const item = record(slot);
      if (
        typeof item.startsAt !== 'string' ||
        typeof item.endsAt !== 'string' ||
        typeof item.appointmentTypeId !== 'string'
      )
        throw new Error('invalid_slot');
      return {
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        appointmentTypeId: item.appointmentTypeId,
      };
    }),
    proofId: row.proofId,
  };
}
function parseBooking(value: unknown) {
  const row = record(value);
  if (typeof row.appointmentId !== 'string' || typeof row.startsAt !== 'string')
    throw new Error('invalid_booking_output');
  return { appointmentId: row.appointmentId, startsAt: row.startsAt };
}

async function lockActionableWorkflow(
  tx: TenantScopedClient,
  tenantId: string,
  runId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<
    { status: string }[]
  >`SELECT status FROM public.workflow_runs WHERE tenant_id = ${tenantId}::uuid AND id = ${runId}::uuid FOR UPDATE`;
  return rows[0]?.status === 'WAITING';
}
