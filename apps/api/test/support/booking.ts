import type { BookingRules, BusinessHours } from '@vautrin/contracts';

const openDay = { enabled: true, periods: [{ start: '09:00', end: '17:00' }] };
const closedDay = { enabled: false, periods: [] };

export const validBusinessHours: BusinessHours = {
  timezone: 'America/Belem',
  monday: openDay,
  tuesday: openDay,
  wednesday: openDay,
  thursday: openDay,
  friday: openDay,
  saturday: closedDay,
  sunday: closedDay,
};

export const validBookingRules: BookingRules = {
  enabled: true,
  appointmentTypes: [
    {
      id: 'site-visit',
      name: 'Project Consultation',
      durationMinutes: 60,
      locationType: 'CUSTOMER',
      active: true,
    },
  ],
  scheduling: {
    minimumNoticeMinutes: 120,
    maximumAdvanceDays: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 30,
    slotIntervalMinutes: 30,
  },
  qualification: {
    requireQualifiedLead: true,
    requiredFields: ['contact.name', 'contact.phone', 'lead.service'],
  },
  conflicts: { preventDoubleBooking: true },
  cancellation: { allowed: true, minimumNoticeMinutes: 1_440 },
  rescheduling: { allowed: true, minimumNoticeMinutes: 1_440 },
};
