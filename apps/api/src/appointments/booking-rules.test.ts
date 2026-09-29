import { bookingRulesSchema, businessHoursSchema } from '@vautrin/contracts';
import { describe, expect, it } from 'vitest';

import { validBookingRules, validBusinessHours } from '../../test/support/booking.js';

describe('BookingRules V1 contract', () => {
  it('accepts the approved rules and timezone-aware weekly hours', () => {
    expect(bookingRulesSchema.safeParse(validBookingRules).success).toBe(true);
    expect(businessHoursSchema.safeParse(validBusinessHours).success).toBe(true);
  });

  it('rejects duplicate types, unsupported fields, timezone overrides and unusable durations', () => {
    const base = validBookingRules;
    expect(
      bookingRulesSchema.safeParse({
        ...base,
        appointmentTypes: [...base.appointmentTypes, ...base.appointmentTypes],
      }).success,
    ).toBe(false);
    expect(
      bookingRulesSchema.safeParse({
        ...base,
        qualification: { requireQualifiedLead: true, requiredFields: ['lead.serviceId'] },
      }).success,
    ).toBe(false);
    expect(
      bookingRulesSchema.safeParse({ ...base, scheduling: { ...base.scheduling, timezone: 'UTC' } })
        .success,
    ).toBe(false);
    expect(
      bookingRulesSchema.safeParse({
        ...base,
        appointmentTypes: [{ ...base.appointmentTypes[0], durationMinutes: 0 }],
      }).success,
    ).toBe(false);
    expect(
      bookingRulesSchema.safeParse({
        ...base,
        scheduling: { ...base.scheduling, slotIntervalMinutes: 0 },
      }).success,
    ).toBe(false);
  });

  it('rejects invalid zones, overnight or overlapping periods', () => {
    const monday = validBusinessHours.monday;
    expect(
      businessHoursSchema.safeParse({ ...validBusinessHours, timezone: 'invalid-zone' }).success,
    ).toBe(false);
    expect(
      businessHoursSchema.safeParse({
        ...validBusinessHours,
        monday: { enabled: true, periods: [{ start: '22:00', end: '03:00' }] },
      }).success,
    ).toBe(false);
    expect(
      businessHoursSchema.safeParse({
        ...validBusinessHours,
        monday: { enabled: true, periods: [...monday.periods, { start: '16:00', end: '18:00' }] },
      }).success,
    ).toBe(false);
  });
});
