import type { BookingRules, BusinessHours, WorkflowDefinition } from '@vautrin/contracts';
import { QUALIFICATION_FIELDS } from '@vautrin/contracts';

export const REMODELING_SERVICES = [
  { key: 'kitchen-remodeling', name: 'Kitchen Remodeling' },
  { key: 'bathroom-remodeling', name: 'Bathroom Remodeling' },
  { key: 'whole-home-remodeling', name: 'Whole Home Remodeling' },
  { key: 'basement-remodeling', name: 'Basement Remodeling' },
  { key: 'home-additions', name: 'Home Additions' },
] as const;
export const REMODELING_QUALIFICATION_RULES = { requiredFields: [...QUALIFICATION_FIELDS] };
export const REMODELING_BOOKING_RULES: BookingRules = {
  enabled: true,
  appointmentTypes: [
    {
      id: 'consultation',
      name: 'Remodeling consultation',
      active: true,
      durationMinutes: 60,
      locationType: 'PHONE',
    },
  ],
  scheduling: {
    minimumNoticeMinutes: 60,
    maximumAdvanceDays: 90,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 15,
    slotIntervalMinutes: 30,
  },
  qualification: { requireQualifiedLead: true, requiredFields: ['contact.phone', 'lead.service'] },
  conflicts: { preventDoubleBooking: true },
  cancellation: { allowed: true, minimumNoticeMinutes: 60 },
  rescheduling: { allowed: true, minimumNoticeMinutes: 60 },
};
export function remodelingHours(timezone: string): BusinessHours {
  const day = { enabled: true, periods: [{ start: '08:00', end: '17:00' }] };
  return {
    timezone,
    weekly: {
      monday: day,
      tuesday: day,
      wednesday: day,
      thursday: day,
      friday: day,
      saturday: { enabled: false, periods: [] },
      sunday: { enabled: false, periods: [] },
    },
  };
}
export function missedCallWorkflow(
  recoveryDelayMs: number,
  followUpDelaysMs: readonly number[],
): WorkflowDefinition {
  const steps: WorkflowDefinition['steps'][number][] = [
    { id: 'short_delay', type: 'wait', config: { durationMs: recoveryDelayMs } },
    {
      id: 'recover',
      type: 'call_agent',
      config: { agentKey: 'receptionist', purpose: 'recovery' },
    },
  ];
  followUpDelaysMs.forEach((durationMs, index) => {
    const next = `followup_${index}`;
    steps.push(
      { id: `wait_${index}`, type: 'wait', config: { durationMs } },
      {
        id: `check_${index}`,
        type: 'condition',
        config: {
          condition: {
            all: [
              { field: 'conversation.hasInboundReply', operator: 'eq', value: false },
              { field: 'conversation.status', operator: 'eq', value: 'OPEN' },
              { field: 'lead.status', operator: 'in', value: ['NEW', 'CONTACTED'] },
            ],
          },
          onTrue: next,
          onFalse: 'finish',
        },
      },
      {
        id: next,
        type: 'send_message',
        config: {
          body: 'Following up on your remodeling inquiry. What project can we help with? Reply STOP to opt out.',
        },
      },
    );
  });
  steps.push({ id: 'finish', type: 'end', config: {} });
  return { steps };
}
