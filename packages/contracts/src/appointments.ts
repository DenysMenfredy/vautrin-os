import type { PageRequest, PageResponse } from './business.js';

export const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'RESCHEDULED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export interface AppointmentResponse {
  readonly id: string;
  readonly contactId: string;
  readonly leadId: string | null;
  readonly locationId: string | null;
  readonly appointmentTypeId: string | null;
  readonly assignedUserId: string | null;
  readonly status: AppointmentStatus;
  readonly title: string;
  readonly description: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timezone: string;
  readonly provider: string | null;
  readonly providerEventId: string | null;
  readonly cancelledAt: string | null;
  readonly cancellationReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListAppointmentsRequest extends PageRequest {
  readonly status?: AppointmentStatus;
  readonly contactId?: string;
  readonly leadId?: string;
  readonly locationId?: string;
  readonly startsAfter?: string;
  readonly startsBefore?: string;
}

export type AppointmentPageResponse = PageResponse<AppointmentResponse>;

export interface CheckAvailabilityRequest {
  readonly leadId: string;
  readonly appointmentTypeId: string;
  readonly from: string;
  readonly to: string;
}

export interface AvailableAppointmentSlot {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly appointmentTypeId: string;
}

export interface AvailabilityResponse {
  readonly slots: readonly AvailableAppointmentSlot[];
}

export interface CreateAppointmentRequest {
  readonly leadId: string;
  readonly appointmentTypeId: string;
  readonly startsAt: string;
  readonly idempotencyKey: string;
}

export interface CancelAppointmentRequest {
  readonly reason?: string;
}

export interface RescheduleAppointmentRequest {
  readonly startsAt: string;
  readonly idempotencyKey: string;
}
