import { createHash } from 'node:crypto';

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AvailabilityResponse,
  appointmentCreatedEvent,
  type BookingRules,
  type BusinessHours,
  bookingRulesSchema,
  businessHoursSchema,
  type CancelAppointmentRequest,
  type CheckAvailabilityRequest,
  type CreateAppointmentRequest,
  leadStatusChangedEvent,
  type RescheduleAppointmentRequest,
} from '@vautrin/contracts';
import { type Appointment, Prisma, type TenantScopedClient } from '@vautrin/database';
import { type CalendarContext, GoogleCalendarProvider } from '@vautrin/integrations';

import { DatabaseService } from '../database/database.service.js';
import { GoogleCalendarIntegrationService } from '../integrations/google-calendar-integration.service.js';
import {
  assertCancellationAllowed,
  assertQualified,
  assertReschedulingAllowed,
  assertSlotAvailable,
  availableSlots,
  BookingDomainError,
  type BookingLeadContext,
  type BusyInterval,
  requireBookableType,
} from './booking-policy.js';

const MINUTE_MS = 60_000;
const ACTIVE_STATUSES = ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'] as const;
const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

interface BookingState {
  rules: BookingRules;
  hours: BusinessHours;
  lead: BookingLeadContext & { id: string; contactId: string; version: number };
}

@Injectable()
export class BookingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly integrations: GoogleCalendarIntegrationService,
    private readonly calendar: GoogleCalendarProvider,
  ) {}

  async availability(
    tenantId: string,
    input: CheckAvailabilityRequest,
  ): Promise<AvailabilityResponse> {
    const from = new Date(input.from);
    const to = new Date(input.to);
    if (!(from < to) || to.getTime() - from.getTime() > 31 * 86_400_000) {
      throw new BookingDomainError('BOOKING_SLOT_UNAVAILABLE');
    }
    const snapshot = await this.database.withTenant(tenantId, async (tx) => {
      const state = await loadState(tx, tenantId, input.leadId);
      const type = requireBookableType(state.rules, input.appointmentTypeId);
      assertQualified(state.rules, state.lead);
      const integration = await activeIntegration(tx, tenantId);
      const busy = await localBusy(
        tx,
        tenantId,
        from,
        new Date(to.getTime() + type.durationMinutes * MINUTE_MS),
      );
      return { state, integration, busy };
    });
    const context = await this.resolveCalendar(tenantId, snapshot.integration.id);
    const provider = await this.calendar.getAvailability({
      ...context,
      startsAt: new Date(from.getTime() - 86_400_000),
      endsAt: new Date(to.getTime() + 86_400_000),
    });
    const type = requireBookableType(snapshot.state.rules, input.appointmentTypeId);
    const starts = availableSlots(
      {
        rules: snapshot.state.rules,
        hours: snapshot.state.hours,
        appointmentTypeId: input.appointmentTypeId,
        lead: snapshot.state.lead,
        now: new Date(),
        busy: [...snapshot.busy, ...provider.busy],
      },
      from,
      to,
    );
    return {
      slots: starts.map((start) => ({
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + type.durationMinutes * MINUTE_MS).toISOString(),
        appointmentTypeId: type.id,
      })),
    };
  }

  async create(
    tenantId: string,
    actorId: string,
    input: CreateAppointmentRequest,
  ): Promise<Appointment> {
    const integrationId = await this.database.withTenant(
      tenantId,
      async (tx) => (await activeIntegration(tx, tenantId)).id,
    );
    const calendar = await this.resolveCalendar(tenantId, integrationId);
    const appointmentId = stableAppointmentId(tenantId, input.idempotencyKey);
    const startsAt = new Date(input.startsAt);
    return this.database.withTenant(
      tenantId,
      async (tx) => {
        await lockBookings(tx, tenantId);
        const prior = await tx.appointment.findFirst({
          where: { tenantId, idempotencyKey: input.idempotencyKey },
        });
        if (prior) {
          if (
            prior.leadId !== input.leadId ||
            prior.appointmentTypeId !== input.appointmentTypeId ||
            prior.startsAt.getTime() !== startsAt.getTime()
          ) {
            throw new BookingDomainError('BOOKING_CONFLICT');
          }
          return prior;
        }
        const state = await loadState(tx, tenantId, input.leadId);
        const type = requireBookableType(state.rules, input.appointmentTypeId);
        assertQualified(state.rules, state.lead);
        const endsAt = new Date(startsAt.getTime() + type.durationMinutes * MINUTE_MS);
        const local = await localBusy(tx, tenantId, startsAt, endsAt);
        const existingEvent = await this.calendar.findAppointment({ ...calendar, appointmentId });
        if (
          existingEvent &&
          (existingEvent.startsAt.getTime() !== startsAt.getTime() ||
            existingEvent.endsAt.getTime() !== endsAt.getTime())
        ) {
          throw new BookingDomainError('BOOKING_CONFLICT');
        }
        const providerBusy = existingEvent
          ? []
          : (
              await this.calendar.getAvailability({
                ...calendar,
                startsAt: new Date(startsAt.getTime() - 86_400_000),
                endsAt: new Date(endsAt.getTime() + 86_400_000),
              })
            ).busy;
        assertSlotAvailable(
          {
            rules: state.rules,
            hours: state.hours,
            appointmentTypeId: input.appointmentTypeId,
            lead: state.lead,
            now: new Date(),
            busy: [...local, ...providerBusy],
          },
          startsAt,
        );
        const event =
          existingEvent ??
          (await this.calendar.createAppointment({
            ...calendar,
            appointmentId,
            startsAt,
            endsAt,
            title: type.name,
            timeZone: state.hours.timezone,
          }));
        const appointment = await tx.appointment.create({
          data: {
            id: appointmentId,
            tenantId,
            contactId: state.lead.contactId,
            leadId: state.lead.id,
            integrationId,
            appointmentTypeId: type.id,
            idempotencyKey: input.idempotencyKey,
            status: 'SCHEDULED',
            title: type.name,
            startsAt,
            endsAt,
            timezone: state.hours.timezone,
            provider: 'google_calendar',
            providerEventId: event.providerEventId,
            metadata: { locationType: type.locationType },
            createdBy: actorId,
          },
        });
        const created = appointmentCreatedEvent(
          appointment.id,
          state.lead.id,
          state.lead.contactId,
        );
        await tx.event.create({
          data: {
            tenantId,
            name: created.name,
            version: created.version,
            aggregateType: 'appointment',
            aggregateId: appointment.id,
            payload: created.payload,
            idempotencyKey: `appointment.created:${appointment.id}`,
          },
        });
        if (state.lead.status === 'QUALIFIED') {
          await tx.lead.update({
            where: { id: state.lead.id },
            data: {
              status: 'APPOINTMENT_BOOKED',
              version: { increment: 1 },
              updatedBy: actorId,
            },
          });
          const changed = leadStatusChangedEvent(state.lead.id, 'QUALIFIED', 'APPOINTMENT_BOOKED');
          await tx.event.create({
            data: {
              tenantId,
              name: changed.name,
              version: changed.version,
              aggregateType: 'lead',
              aggregateId: state.lead.id,
              payload: changed.payload,
              idempotencyKey: `lead.status_changed:${state.lead.id}:${state.lead.version + 1}`,
            },
          });
        }
        await audit(tx, tenantId, actorId, 'appointment.created', appointment.id);
        return appointment;
      },
      TX_OPTIONS,
    );
  }

  async cancel(
    tenantId: string,
    actorId: string,
    appointmentId: string,
    input: CancelAppointmentRequest,
  ): Promise<Appointment> {
    const selected = await this.database.withTenant(tenantId, (tx) =>
      findAppointment(tx, tenantId, appointmentId),
    );
    if (selected.status === 'CANCELLED') return selected;
    const calendar = await this.resolveAppointmentCalendar(tenantId, selected);
    return this.database.withTenant(
      tenantId,
      async (tx) => {
        await lockBookings(tx, tenantId);
        const appointment = await findAppointment(tx, tenantId, appointmentId);
        if (appointment.status === 'CANCELLED') return appointment;
        if (!ACTIVE_STATUSES.includes(appointment.status as (typeof ACTIVE_STATUSES)[number]))
          throw new BookingDomainError('BOOKING_CONFLICT');
        if (!appointment.providerEventId)
          throw new BookingDomainError('BOOKING_INVALID_CONFIGURATION');
        const rules = await loadRules(tx, tenantId);
        assertCancellationAllowed(rules, appointment.startsAt, new Date());
        await this.calendar.cancelAppointment({
          ...calendar,
          providerEventId: appointment.providerEventId,
        });
        const updated = await tx.appointment.update({
          where: { id: appointment.id },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancellationReason: input.reason?.trim() || null,
          },
        });
        await audit(tx, tenantId, actorId, 'appointment.cancelled', appointment.id);
        return updated;
      },
      TX_OPTIONS,
    );
  }

  async reschedule(
    tenantId: string,
    actorId: string,
    appointmentId: string,
    input: RescheduleAppointmentRequest,
  ): Promise<Appointment> {
    const selected = await this.database.withTenant(tenantId, (tx) =>
      findAppointment(tx, tenantId, appointmentId),
    );
    const calendar = await this.resolveAppointmentCalendar(tenantId, selected);
    return this.database.withTenant(
      tenantId,
      async (tx) => {
        await lockBookings(tx, tenantId);
        const appointment = await findAppointment(tx, tenantId, appointmentId);
        const metadata = isRecord(appointment.metadata) ? appointment.metadata : {};
        const startsAt = new Date(input.startsAt);
        if (metadata.lastRescheduleKey === input.idempotencyKey) {
          if (appointment.startsAt.getTime() !== startsAt.getTime())
            throw new BookingDomainError('BOOKING_CONFLICT');
          return appointment;
        }
        if (
          !ACTIVE_STATUSES.includes(appointment.status as (typeof ACTIVE_STATUSES)[number]) ||
          !appointment.leadId ||
          !appointment.appointmentTypeId ||
          !appointment.providerEventId
        ) {
          throw new BookingDomainError('BOOKING_CONFLICT');
        }
        const state = await loadState(tx, tenantId, appointment.leadId);
        assertReschedulingAllowed(state.rules, appointment.startsAt, new Date());
        const type = requireBookableType(state.rules, appointment.appointmentTypeId);
        const endsAt = new Date(startsAt.getTime() + type.durationMinutes * MINUTE_MS);
        const busy = await localBusy(tx, tenantId, startsAt, endsAt, appointment.id);
        const providerEvent = await this.calendar.findAppointment({
          ...calendar,
          appointmentId: appointment.id,
        });
        const providerAlreadyMoved =
          providerEvent?.startsAt.getTime() === startsAt.getTime() &&
          providerEvent.endsAt.getTime() === endsAt.getTime();
        const providerBusy = providerAlreadyMoved
          ? []
          : (
              await this.calendar.getAvailability({
                ...calendar,
                startsAt: new Date(startsAt.getTime() - 86_400_000),
                endsAt: new Date(endsAt.getTime() + 86_400_000),
              })
            ).busy;
        assertSlotAvailable(
          {
            rules: state.rules,
            hours: state.hours,
            appointmentTypeId: type.id,
            lead: state.lead,
            now: new Date(),
            busy: [...busy, ...providerBusy],
          },
          startsAt,
        );
        await this.calendar.rescheduleAppointment({
          ...calendar,
          appointmentId: appointment.id,
          providerEventId: appointment.providerEventId,
          startsAt,
          endsAt,
          timeZone: state.hours.timezone,
        });
        const updated = await tx.appointment.update({
          where: { id: appointment.id },
          data: {
            status: 'RESCHEDULED',
            startsAt,
            endsAt,
            timezone: state.hours.timezone,
            metadata: { ...metadata, lastRescheduleKey: input.idempotencyKey },
          },
        });
        await audit(tx, tenantId, actorId, 'appointment.rescheduled', appointment.id);
        return updated;
      },
      TX_OPTIONS,
    );
  }

  private async resolveAppointmentCalendar(
    tenantId: string,
    appointment: Appointment,
  ): Promise<CalendarContext> {
    if (
      !appointment.integrationId ||
      !appointment.providerEventId ||
      appointment.provider !== 'google_calendar'
    ) {
      throw new BookingDomainError('BOOKING_INVALID_CONFIGURATION');
    }
    return await this.resolveCalendar(tenantId, appointment.integrationId);
  }

  private async resolveCalendar(tenantId: string, integrationId: string): Promise<CalendarContext> {
    try {
      return await this.integrations.resolve(tenantId, integrationId);
    } catch (error) {
      if (error instanceof ForbiddenException)
        throw new BookingDomainError('BOOKING_INVALID_CONFIGURATION');
      throw error;
    }
  }
}

async function loadState(
  tx: TenantScopedClient,
  tenantId: string,
  leadId: string,
): Promise<BookingState> {
  const profile = await tx.businessProfile.findFirst({ where: { tenantId } });
  if (!profile) throw new BookingDomainError('BOOKING_INVALID_CONFIGURATION');
  const rules = bookingRulesSchema.safeParse(profile.bookingRules);
  const hours = businessHoursSchema.safeParse(profile.businessHours);
  if (!rules.success || !hours.success)
    throw new BookingDomainError('BOOKING_INVALID_CONFIGURATION');
  const lead = await tx.lead.findFirst({
    where: { id: leadId, tenantId, deletedAt: null },
    include: { contact: true },
  });
  if (!lead || lead.contact.deletedAt) throw new NotFoundException('Lead not found.');
  return {
    rules: rules.data,
    hours: hours.data,
    lead: {
      id: lead.id,
      contactId: lead.contactId,
      version: lead.version,
      status: lead.status,
      service: lead.service,
      contact: {
        firstName: lead.contact.firstName,
        lastName: lead.contact.lastName,
        phone: lead.contact.phone,
        address: lead.contact.address,
      },
    },
  };
}

async function loadRules(tx: TenantScopedClient, tenantId: string): Promise<BookingRules> {
  const profile = await tx.businessProfile.findFirst({ where: { tenantId } });
  const parsed = bookingRulesSchema.safeParse(profile?.bookingRules);
  if (!parsed.success) throw new BookingDomainError('BOOKING_INVALID_CONFIGURATION');
  return parsed.data;
}

async function activeIntegration(
  tx: TenantScopedClient,
  tenantId: string,
): Promise<{ id: string }> {
  const integrations = await tx.integration.findMany({
    where: {
      tenantId,
      provider: 'google_calendar',
      category: 'CALENDAR',
      status: { in: ['CONNECTED', 'HEALTHY', 'DEGRADED'] },
    },
    select: { id: true },
    take: 2,
  });
  if (integrations.length !== 1 || !integrations[0])
    throw new BookingDomainError('BOOKING_INVALID_CONFIGURATION');
  return integrations[0];
}

async function localBusy(
  tx: TenantScopedClient,
  tenantId: string,
  from: Date,
  to: Date,
  excludeId?: string,
): Promise<BusyInterval[]> {
  return await tx.appointment.findMany({
    where: {
      tenantId,
      status: { in: [...ACTIVE_STATUSES] },
      startsAt: { lt: new Date(to.getTime() + 86_400_000) },
      endsAt: { gt: new Date(from.getTime() - 86_400_000) },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { startsAt: true, endsAt: true },
  });
}

async function findAppointment(
  tx: TenantScopedClient,
  tenantId: string,
  id: string,
): Promise<Appointment> {
  const appointment = await tx.appointment.findFirst({ where: { tenantId, id } });
  if (!appointment) throw new NotFoundException('Appointment not found.');
  return appointment;
}

async function lockBookings(tx: TenantScopedClient, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}::text, 98421))::text`;
}

async function audit(
  tx: TenantScopedClient,
  tenantId: string,
  actorId: string,
  action: string,
  appointmentId: string,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId,
      actorType: 'USER',
      actorId,
      action,
      resourceType: 'appointment',
      resourceId: appointmentId,
    },
  });
}

function stableAppointmentId(tenantId: string, key: string): string {
  const hex = createHash('sha256').update(`appointment:${tenantId}:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function isRecord(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
