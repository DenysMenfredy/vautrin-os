import type {
  AppointmentTypeRule,
  BookingRules,
  BusinessDay,
  BusinessHours,
} from '@vautrin/contracts';
import { timeMinutes } from '@vautrin/contracts';

export type BookingFailureCode =
  | 'BOOKING_RESOURCE_NOT_FOUND'
  | 'BOOKING_DISABLED'
  | 'BOOKING_APPOINTMENT_TYPE_NOT_FOUND'
  | 'BOOKING_APPOINTMENT_TYPE_INACTIVE'
  | 'BOOKING_QUALIFICATION_REQUIRED'
  | 'BOOKING_REQUIRED_FIELDS_MISSING'
  | 'BOOKING_OUTSIDE_BUSINESS_HOURS'
  | 'BOOKING_MINIMUM_NOTICE_NOT_MET'
  | 'BOOKING_MAXIMUM_ADVANCE_EXCEEDED'
  | 'BOOKING_SLOT_UNAVAILABLE'
  | 'BOOKING_CONFLICT'
  | 'BOOKING_CANCELLATION_NOT_ALLOWED'
  | 'BOOKING_CANCELLATION_NOTICE_NOT_MET'
  | 'BOOKING_RESCHEDULING_NOT_ALLOWED'
  | 'BOOKING_RESCHEDULING_NOTICE_NOT_MET'
  | 'BOOKING_INVALID_CONFIGURATION';

export class BookingDomainError extends Error {
  constructor(
    readonly code: BookingFailureCode,
    readonly missingFields: readonly string[] = [],
  ) {
    super(code);
    this.name = 'BookingDomainError';
  }
}

export interface BookingLeadContext {
  readonly status: string;
  readonly service: string | null;
  readonly contact: {
    readonly firstName: string | null;
    readonly lastName: string | null;
    readonly phone: string | null;
    readonly address: unknown;
  };
}

export interface BusyInterval {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface AvailabilityContext {
  readonly rules: BookingRules;
  readonly hours: BusinessHours;
  readonly appointmentTypeId: string;
  readonly lead: BookingLeadContext;
  readonly now: Date;
  readonly busy: readonly BusyInterval[];
}

const QUALIFIED_STATUSES = new Set([
  'QUALIFIED',
  'APPOINTMENT_BOOKED',
  'ESTIMATE_PENDING',
  'ESTIMATE_SENT',
  'FOLLOW_UP',
]);
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export function requireBookableType(rules: BookingRules, id: string): AppointmentTypeRule {
  if (!rules.enabled) throw new BookingDomainError('BOOKING_DISABLED');
  const type = rules.appointmentTypes.find((item) => item.id === id);
  if (!type) throw new BookingDomainError('BOOKING_APPOINTMENT_TYPE_NOT_FOUND');
  if (!type.active) throw new BookingDomainError('BOOKING_APPOINTMENT_TYPE_INACTIVE');
  return type;
}

export function assertQualified(rules: BookingRules, lead: BookingLeadContext): void {
  if (rules.qualification.requireQualifiedLead && !QUALIFIED_STATUSES.has(lead.status)) {
    throw new BookingDomainError('BOOKING_QUALIFICATION_REQUIRED');
  }
  const missingFields = rules.qualification.requiredFields.filter((field) => {
    switch (field) {
      case 'contact.name':
        return !lead.contact.firstName?.trim() && !lead.contact.lastName?.trim();
      case 'contact.phone':
        return !lead.contact.phone?.trim();
      case 'contact.address':
        return !hasValue(lead.contact.address);
      case 'lead.service':
        return !lead.service?.trim();
      default:
        return true;
    }
  });
  if (missingFields.length) {
    throw new BookingDomainError('BOOKING_REQUIRED_FIELDS_MISSING', missingFields);
  }
}

/** Returns only application-approved UTC starts; client/LLM supplied slots are never trusted. */
export function availableSlots(
  context: AvailabilityContext,
  from: Date,
  to: Date,
): readonly Date[] {
  const type = requireBookableType(context.rules, context.appointmentTypeId);
  assertQualified(context.rules, context.lead);
  if (!(from < to) || to.getTime() - from.getTime() > 31 * DAY_MS) {
    throw new BookingDomainError('BOOKING_SLOT_UNAVAILABLE');
  }
  const starts: Date[] = [];
  const minuteStart = Math.ceil(from.getTime() / MINUTE_MS) * MINUTE_MS;
  const formatter = localFormatter(context.hours.timezone);
  for (let timestamp = minuteStart; timestamp < to.getTime(); timestamp += MINUTE_MS) {
    const candidate = new Date(timestamp);
    if (isSlotAvailable({ ...context, type, formatter }, candidate)) {
      starts.push(candidate);
    }
  }
  return starts;
}

export function assertSlotAvailable(context: AvailabilityContext, startsAt: Date): void {
  const type = requireBookableType(context.rules, context.appointmentTypeId);
  assertQualified(context.rules, context.lead);
  const formatter = localFormatter(context.hours.timezone);
  const reason = slotFailure({ ...context, type, formatter }, startsAt);
  if (reason) throw new BookingDomainError(reason);
}

export function assertCancellationAllowed(rules: BookingRules, startsAt: Date, now: Date): void {
  if (!rules.cancellation.allowed) throw new BookingDomainError('BOOKING_CANCELLATION_NOT_ALLOWED');
  if (startsAt.getTime() - now.getTime() < rules.cancellation.minimumNoticeMinutes * MINUTE_MS) {
    throw new BookingDomainError('BOOKING_CANCELLATION_NOTICE_NOT_MET');
  }
}

export function assertReschedulingAllowed(rules: BookingRules, startsAt: Date, now: Date): void {
  if (!rules.rescheduling.allowed) throw new BookingDomainError('BOOKING_RESCHEDULING_NOT_ALLOWED');
  if (startsAt.getTime() - now.getTime() < rules.rescheduling.minimumNoticeMinutes * MINUTE_MS) {
    throw new BookingDomainError('BOOKING_RESCHEDULING_NOTICE_NOT_MET');
  }
}

interface SlotContext extends AvailabilityContext {
  readonly type: AppointmentTypeRule;
  readonly formatter: Intl.DateTimeFormat;
}

function isSlotAvailable(context: SlotContext, startsAt: Date): boolean {
  return slotFailure(context, startsAt) === null;
}

function slotFailure(context: SlotContext, startsAt: Date): BookingFailureCode | null {
  const { scheduling } = context.rules;
  const startMs = startsAt.getTime();
  if (!Number.isFinite(startMs) || startMs % MINUTE_MS !== 0) return 'BOOKING_SLOT_UNAVAILABLE';
  if (startMs < context.now.getTime() + scheduling.minimumNoticeMinutes * MINUTE_MS) {
    return 'BOOKING_MINIMUM_NOTICE_NOT_MET';
  }
  if (startMs > context.now.getTime() + scheduling.maximumAdvanceDays * DAY_MS) {
    return 'BOOKING_MAXIMUM_ADVANCE_EXCEEDED';
  }
  const start = localParts(context.formatter, startsAt);
  if (start.minuteOfDay % scheduling.slotIntervalMinutes !== 0) {
    return 'BOOKING_SLOT_UNAVAILABLE';
  }
  const reservedStart = new Date(startMs - scheduling.bufferBeforeMinutes * MINUTE_MS);
  const endsAt = new Date(startMs + context.type.durationMinutes * MINUTE_MS);
  const reservedEnd = new Date(endsAt.getTime() + scheduling.bufferAfterMinutes * MINUTE_MS);
  const before = localParts(context.formatter, reservedStart);
  const after = localParts(context.formatter, reservedEnd);
  if (before.date !== start.date || after.date !== start.date) {
    return 'BOOKING_OUTSIDE_BUSINESS_HOURS';
  }
  const day = context.hours.weekly[start.day];
  if (
    !day.enabled ||
    !day.periods.some(
      (period) =>
        before.minuteOfDay >= timeMinutes(period.start) &&
        after.minuteOfDay <= timeMinutes(period.end),
    )
  ) {
    return 'BOOKING_OUTSIDE_BUSINESS_HOURS';
  }
  if (
    context.busy.some(
      (existing) =>
        reservedStart.getTime() <
          existing.endsAt.getTime() + scheduling.bufferAfterMinutes * MINUTE_MS &&
        reservedEnd.getTime() >
          existing.startsAt.getTime() - scheduling.bufferBeforeMinutes * MINUTE_MS,
    )
  ) {
    return 'BOOKING_CONFLICT';
  }
  return null;
}

function localFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function localParts(
  formatter: Intl.DateTimeFormat,
  date: Date,
): {
  readonly day: BusinessDay;
  readonly date: string;
  readonly minuteOfDay: number;
} {
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    day: (parts.weekday ?? '').toLowerCase() as BusinessDay,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function hasValue(value: unknown): boolean {
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.some(hasValue);
  if (value !== null && typeof value === 'object') return Object.values(value).some(hasValue);
  return typeof value === 'number' || value === true;
}
