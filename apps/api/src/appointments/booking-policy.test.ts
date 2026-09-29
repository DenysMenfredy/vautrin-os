import { describe, expect, it } from 'vitest';

import { validBookingRules, validBusinessHours } from '../../test/support/booking.js';
import {
  type AvailabilityContext,
  assertCancellationAllowed,
  assertQualified,
  assertReschedulingAllowed,
  assertSlotAvailable,
  availableSlots,
  BookingDomainError,
  requireBookableType,
} from './booking-policy.js';

const now = new Date('2026-09-28T10:00:00.000Z');
const lead = {
  status: 'QUALIFIED',
  service: 'kitchen-remodel',
  contact: { firstName: 'Ada', lastName: null, phone: '+15555550100', address: { city: 'Belem' } },
};
const base: AvailabilityContext = {
  rules: validBookingRules,
  hours: validBusinessHours,
  appointmentTypeId: 'site-visit',
  lead,
  now,
  busy: [],
};
const at = (iso: string) => new Date(iso);
const assertCode = (run: () => unknown, code: string) => {
  try {
    run();
    throw new Error('Expected booking failure.');
  } catch (error) {
    expect(error).toBeInstanceOf(BookingDomainError);
    expect((error as BookingDomainError).code).toBe(code);
  }
};

describe('deterministic Booking Rules V1 policy', () => {
  it('returns only slots inside hours and fitting duration, buffers and interval', () => {
    // Belem is UTC-3: Monday 09:00–17:00 is 12:00–20:00 UTC.
    const slots = availableSlots(base, at('2026-09-28T11:00:00Z'), at('2026-09-28T21:00:00Z'));
    expect(slots[0]?.toISOString()).toBe('2026-09-28T12:00:00.000Z');
    expect(slots.at(-1)?.toISOString()).toBe('2026-09-28T18:30:00.000Z');
    expect(slots.every((slot) => slot.getUTCMinutes() % 30 === 0)).toBe(true);
  });

  it('rejects disabled booking and inactive or unknown types', () => {
    assertCode(
      () => requireBookableType({ ...validBookingRules, enabled: false }, 'site-visit'),
      'BOOKING_DISABLED',
    );
    assertCode(
      () => requireBookableType(validBookingRules, 'foreign-type'),
      'BOOKING_APPOINTMENT_TYPE_NOT_FOUND',
    );
    assertCode(
      () =>
        requireBookableType(
          {
            ...validBookingRules,
            appointmentTypes: validBookingRules.appointmentTypes.map((type) => ({
              ...type,
              active: false,
            })),
          },
          'site-visit',
        ),
      'BOOKING_APPOINTMENT_TYPE_INACTIVE',
    );
  });

  it('enforces qualification and reports missing supported domain paths', () => {
    assertCode(
      () => assertQualified(validBookingRules, { ...lead, status: 'NEW' }),
      'BOOKING_QUALIFICATION_REQUIRED',
    );
    try {
      assertQualified(
        {
          ...validBookingRules,
          qualification: {
            requireQualifiedLead: true,
            requiredFields: ['contact.phone', 'contact.address', 'lead.service'],
          },
        },
        {
          ...lead,
          service: null,
          contact: { ...lead.contact, phone: null, address: null },
        },
      );
      throw new Error('Expected missing fields.');
    } catch (error) {
      expect((error as BookingDomainError).missingFields).toEqual([
        'contact.phone',
        'contact.address',
        'lead.service',
      ]);
    }
    expect(() =>
      assertQualified(
        {
          ...validBookingRules,
          qualification: { requireQualifiedLead: false, requiredFields: [] },
        },
        { ...lead, status: 'NEW' },
      ),
    ).not.toThrow();
  });

  it('enforces notice, horizon, business hours, slot size and local/provider conflicts', () => {
    assertCode(
      () => assertSlotAvailable(base, at('2026-09-28T10:00:00Z')),
      'BOOKING_MINIMUM_NOTICE_NOT_MET',
    );
    assertCode(
      () => assertSlotAvailable(base, at('2026-10-30T12:00:00Z')),
      'BOOKING_MAXIMUM_ADVANCE_EXCEEDED',
    );
    assertCode(
      () => assertSlotAvailable(base, at('2026-09-28T20:00:00Z')),
      'BOOKING_OUTSIDE_BUSINESS_HOURS',
    );
    assertCode(
      () => assertSlotAvailable(base, at('2026-09-28T12:15:00Z')),
      'BOOKING_SLOT_UNAVAILABLE',
    );
    assertCode(
      () =>
        assertSlotAvailable(
          {
            ...base,
            busy: [{ startsAt: at('2026-09-28T14:00:00Z'), endsAt: at('2026-09-28T15:00:00Z') }],
          },
          at('2026-09-28T13:30:00Z'),
        ),
      'BOOKING_CONFLICT',
    );
    expect(() => assertSlotAvailable(base, at('2026-09-28T13:30:00Z'))).not.toThrow();
  });

  it('respects the existing appointment after-buffer at the conflict boundary', () => {
    const occupied = {
      ...base,
      busy: [
        {
          startsAt: at('2026-09-28T13:00:00Z'),
          endsAt: at('2026-09-28T14:00:00Z'),
        },
      ],
    };
    assertCode(() => assertSlotAvailable(occupied, at('2026-09-28T14:00:00Z')), 'BOOKING_CONFLICT');
    expect(() => assertSlotAvailable(occupied, at('2026-09-28T14:30:00Z'))).not.toThrow();
  });

  it('enforces cancellation and rescheduling policy and notice independently', () => {
    const start = at('2026-09-30T12:00:00Z');
    expect(() => assertCancellationAllowed(validBookingRules, start, now)).not.toThrow();
    expect(() => assertReschedulingAllowed(validBookingRules, start, now)).not.toThrow();
    assertCode(
      () =>
        assertCancellationAllowed(
          { ...validBookingRules, cancellation: { allowed: false, minimumNoticeMinutes: 0 } },
          start,
          now,
        ),
      'BOOKING_CANCELLATION_NOT_ALLOWED',
    );
    assertCode(
      () =>
        assertReschedulingAllowed(
          { ...validBookingRules, rescheduling: { allowed: false, minimumNoticeMinutes: 0 } },
          start,
          now,
        ),
      'BOOKING_RESCHEDULING_NOT_ALLOWED',
    );
    assertCode(
      () => assertCancellationAllowed(validBookingRules, start, at('2026-09-29T12:00:01Z')),
      'BOOKING_CANCELLATION_NOTICE_NOT_MET',
    );
    assertCode(
      () => assertReschedulingAllowed(validBookingRules, start, at('2026-09-29T12:00:01Z')),
      'BOOKING_RESCHEDULING_NOTICE_NOT_MET',
    );
  });
});
