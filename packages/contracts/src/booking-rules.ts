import { z } from 'zod';

export const REQUIRED_BOOKING_FIELDS = [
  'contact.name',
  'contact.phone',
  'contact.address',
  'lead.service',
] as const;

const appointmentTypeRuleSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  name: z.string().trim().min(1).max(200),
  durationMinutes: z.number().int().positive().max(1_440),
  locationType: z.enum(['BUSINESS', 'CUSTOMER', 'PHONE', 'VIDEO']),
  active: z.boolean(),
});

/** Approved v0.3 BookingRules V1. Business hours and timezone live separately. */
export const bookingRulesSchema = z
  .strictObject({
    enabled: z.boolean(),
    appointmentTypes: z.array(appointmentTypeRuleSchema).max(100),
    scheduling: z.strictObject({
      minimumNoticeMinutes: z.number().int().nonnegative(),
      maximumAdvanceDays: z.number().int().positive(),
      bufferBeforeMinutes: z.number().int().nonnegative().max(1_440),
      bufferAfterMinutes: z.number().int().nonnegative().max(1_440),
      slotIntervalMinutes: z.number().int().positive().max(1_440),
    }),
    qualification: z.strictObject({
      requireQualifiedLead: z.boolean(),
      requiredFields: z.array(z.enum(REQUIRED_BOOKING_FIELDS)).max(REQUIRED_BOOKING_FIELDS.length),
    }),
    conflicts: z.strictObject({ preventDoubleBooking: z.boolean() }),
    cancellation: z.strictObject({
      allowed: z.boolean(),
      minimumNoticeMinutes: z.number().int().nonnegative(),
    }),
    rescheduling: z.strictObject({
      allowed: z.boolean(),
      minimumNoticeMinutes: z.number().int().nonnegative(),
    }),
  })
  .superRefine((rules, context) => {
    const ids = rules.appointmentTypes.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', path: ['appointmentTypes'], message: 'Duplicate IDs.' });
    }
    if (rules.enabled && !rules.appointmentTypes.some((item) => item.active)) {
      context.addIssue({
        code: 'custom',
        path: ['appointmentTypes'],
        message: 'No active appointment type.',
      });
    }
    if (rules.enabled && !rules.conflicts.preventDoubleBooking) {
      context.addIssue({
        code: 'custom',
        path: ['conflicts'],
        message: 'V1 does not support overbooking.',
      });
    }
    const fields = rules.qualification.requiredFields;
    if (new Set(fields).size !== fields.length) {
      context.addIssue({
        code: 'custom',
        path: ['qualification', 'requiredFields'],
        message: 'Duplicate fields.',
      });
    }
    const horizonMinutes = rules.scheduling.maximumAdvanceDays * 1_440;
    if (
      !Number.isSafeInteger(horizonMinutes) ||
      rules.scheduling.minimumNoticeMinutes >= horizonMinutes
    ) {
      context.addIssue({
        code: 'custom',
        path: ['scheduling'],
        message: 'Notice must precede the booking horizon.',
      });
    }
    for (const [index, item] of rules.appointmentTypes.entries()) {
      if (
        item.active &&
        item.durationMinutes +
          rules.scheduling.bufferBeforeMinutes +
          rules.scheduling.bufferAfterMinutes >
          1_440
      ) {
        context.addIssue({
          code: 'custom',
          path: ['appointmentTypes', index],
          message: 'Appointment and buffers cannot fit in one day.',
        });
      }
    }
  });

export type BookingRules = z.infer<typeof bookingRulesSchema>;
export type AppointmentTypeRule = BookingRules['appointmentTypes'][number];

const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const businessHoursPeriodSchema = z.strictObject({ start: localTime, end: localTime });
const businessHoursDaySchema = z.strictObject({
  enabled: z.boolean(),
  periods: z.array(businessHoursPeriodSchema).max(24),
});

export const BUSINESS_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/** Business Hours V1: local non-overnight periods, one entry per weekday. */
export const businessHoursSchema = z
  .strictObject({
    timezone: z.string().min(1).max(100),
    monday: businessHoursDaySchema,
    tuesday: businessHoursDaySchema,
    wednesday: businessHoursDaySchema,
    thursday: businessHoursDaySchema,
    friday: businessHoursDaySchema,
    saturday: businessHoursDaySchema,
    sunday: businessHoursDaySchema,
  })
  .superRefine((hours, context) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: hours.timezone });
    } catch {
      context.addIssue({ code: 'custom', path: ['timezone'], message: 'Unsupported timezone.' });
    }
    for (const day of BUSINESS_DAYS) {
      const value = hours[day];
      const periods = value.periods
        .map((period) => ({ start: timeMinutes(period.start), end: timeMinutes(period.end) }))
        .sort((a, b) => a.start - b.start);
      for (let index = 0; index < periods.length; index += 1) {
        const period = periods[index];
        const previous = periods[index - 1];
        if (period && (period.start >= period.end || (previous && period.start < previous.end))) {
          context.addIssue({
            code: 'custom',
            path: [day, 'periods'],
            message: 'Periods must be non-overlapping and end on the same day.',
          });
          break;
        }
      }
    }
  });

export type BusinessHours = z.infer<typeof businessHoursSchema>;
export type BusinessDay = (typeof BUSINESS_DAYS)[number];

export function timeMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}
