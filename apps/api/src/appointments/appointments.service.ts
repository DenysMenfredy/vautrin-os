import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AppointmentPageResponse,
  AppointmentResponse,
  AvailabilityResponse,
  CancelAppointmentRequest,
  CheckAvailabilityRequest,
  CreateAppointmentRequest,
  ListAppointmentsRequest,
  RescheduleAppointmentRequest,
} from '@vautrin/contracts';
import { type Appointment as AppointmentRow, Prisma } from '@vautrin/database';
import { CalendarProviderError } from '@vautrin/integrations';

import { buildPage, cursorFilter, DEFAULT_PAGE_SIZE, decodeCursor } from '../common/cursor-page.js';
import { DatabaseService } from '../database/database.service.js';
import { BookingService } from './booking.service.js';
import { BookingDomainError } from './booking-policy.js';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly booking: BookingService,
  ) {}

  async availability(
    tenantId: string,
    input: CheckAvailabilityRequest,
  ): Promise<AvailabilityResponse> {
    try {
      return await this.booking.availability(tenantId, input);
    } catch (error) {
      throw bookingHttpError(error);
    }
  }

  async create(
    tenantId: string,
    actorId: string,
    input: CreateAppointmentRequest,
  ): Promise<AppointmentResponse> {
    try {
      return mapAppointment(await this.booking.create(tenantId, actorId, input));
    } catch (error) {
      throw bookingHttpError(error);
    }
  }

  async cancel(
    tenantId: string,
    actorId: string,
    appointmentId: string,
    input: CancelAppointmentRequest,
  ): Promise<AppointmentResponse> {
    try {
      return mapAppointment(await this.booking.cancel(tenantId, actorId, appointmentId, input));
    } catch (error) {
      throw bookingHttpError(error);
    }
  }

  async reschedule(
    tenantId: string,
    actorId: string,
    appointmentId: string,
    input: RescheduleAppointmentRequest,
  ): Promise<AppointmentResponse> {
    try {
      return mapAppointment(await this.booking.reschedule(tenantId, actorId, appointmentId, input));
    } catch (error) {
      throw bookingHttpError(error);
    }
  }

  async list(tenantId: string, options: ListAppointmentsRequest): Promise<AppointmentPageResponse> {
    const limit = options.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = decodeCursor(options.cursor);
    const startsAfter = options.startsAfter ? new Date(options.startsAfter) : undefined;
    const startsBefore = options.startsBefore ? new Date(options.startsBefore) : undefined;
    if (startsAfter && startsBefore && startsAfter > startsBefore) {
      throw new BadRequestException('startsAfter must not be later than startsBefore.');
    }

    const where: Prisma.AppointmentWhereInput = {
      tenantId,
      ...(options.status ? { status: options.status } : {}),
      ...(options.contactId ? { contactId: options.contactId } : {}),
      ...(options.leadId ? { leadId: options.leadId } : {}),
      ...(options.locationId ? { locationId: options.locationId } : {}),
      ...(startsAfter || startsBefore
        ? {
            startsAt: {
              ...(startsAfter ? { gte: startsAfter } : {}),
              ...(startsBefore ? { lte: startsBefore } : {}),
            },
          }
        : {}),
      ...(cursor ? { AND: [cursorFilter(cursor)] } : {}),
    };
    const rows = await this.database.withTenant(tenantId, (tx) =>
      tx.appointment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    );
    return buildPage(rows, limit, mapAppointment);
  }

  async get(tenantId: string, appointmentId: string): Promise<AppointmentResponse> {
    const appointment = await this.database.withTenant(tenantId, (tx) =>
      tx.appointment.findFirst({ where: { id: appointmentId, tenantId } }),
    );
    if (!appointment) throw new NotFoundException('Appointment not found.');
    return mapAppointment(appointment);
  }
}

function mapAppointment(row: AppointmentRow): AppointmentResponse {
  return {
    id: row.id,
    contactId: row.contactId,
    leadId: row.leadId,
    locationId: row.locationId,
    appointmentTypeId: row.appointmentTypeId,
    assignedUserId: row.assignedUserId,
    status: row.status,
    title: row.title,
    description: row.description,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    timezone: row.timezone,
    provider: row.provider,
    providerEventId: row.providerEventId,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function bookingHttpError(error: unknown): unknown {
  if (error instanceof BookingDomainError) {
    if (error.code === 'BOOKING_RESOURCE_NOT_FOUND')
      return new NotFoundException('Booking resource not found.');
    const status =
      error.code === 'BOOKING_CONFLICT' || error.code === 'BOOKING_SLOT_UNAVAILABLE'
        ? HttpStatus.CONFLICT
        : HttpStatus.UNPROCESSABLE_ENTITY;
    return new HttpException(
      { message: error.code, code: error.code, missingFields: error.missingFields },
      status,
    );
  }
  if (error instanceof CalendarProviderError) {
    const conflict = error.code === 'booking_identity_conflict';
    const code = conflict
      ? 'BOOKING_CONFLICT'
      : error.retryable
        ? 'BOOKING_SLOT_UNAVAILABLE'
        : 'BOOKING_INVALID_CONFIGURATION';
    return new HttpException(
      { message: code, code },
      conflict ? HttpStatus.CONFLICT : HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  return error;
}
