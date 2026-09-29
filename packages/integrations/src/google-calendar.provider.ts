import type {
  AvailabilityInput,
  AvailabilityResult,
  CalendarAppointmentResult,
  CalendarProvider,
  CancelCalendarAppointmentInput,
  CreateCalendarAppointmentInput,
  FindCalendarAppointmentInput,
  RescheduleCalendarAppointmentInput,
} from './calendar-provider.js';
import { CalendarProviderError } from './calendar-provider.js';

const API_ORIGIN = 'https://www.googleapis.com';
const REQUEST_TIMEOUT_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Google Calendar v3 REST adapter. OAuth token acquisition and tenant
 * integration lookup are separate infrastructure concerns; callers must
 * supply a token for the selected tenant's configured calendar.
 */
export class GoogleCalendarProvider implements CalendarProvider {
  constructor(private readonly requestFetch: typeof fetch = fetch) {}

  async getAvailability(input: AvailabilityInput): Promise<AvailabilityResult> {
    assertContext(input);
    assertInterval(input.startsAt, input.endsAt);
    const response = await this.request('/calendar/v3/freeBusy', input.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        timeMin: input.startsAt.toISOString(),
        timeMax: input.endsAt.toISOString(),
        timeZone: 'UTC',
        items: [{ id: input.calendarId }],
      }),
    });
    const payload = await safeJson(response);
    const calendar = record(payload?.calendars)?.[input.calendarId];
    const details = record(calendar);
    if (
      !details ||
      !Array.isArray(details.busy) ||
      (Array.isArray(details.errors) && details.errors.length)
    ) {
      throw new CalendarProviderError('availability_unavailable', true);
    }
    const busy = details.busy.map((value) => {
      const interval = record(value);
      const startsAt = dateValue(interval?.start);
      const endsAt = dateValue(interval?.end);
      if (!startsAt || !endsAt || startsAt >= endsAt) {
        throw new CalendarProviderError('invalid_availability_response', true);
      }
      return { startsAt, endsAt };
    });
    return { busy };
  }

  async createAppointment(
    input: CreateCalendarAppointmentInput,
  ): Promise<CalendarAppointmentResult> {
    assertContext(input);
    assertInterval(input.startsAt, input.endsAt);
    if (!UUID.test(input.appointmentId) || !input.title.trim() || !input.timeZone.trim()) {
      throw new CalendarProviderError('invalid_booking_input', false);
    }
    // Google permits lowercase base32hex IDs. UUID hex without hyphens is a
    // stable 32-character ID, so retrying a timed-out insert cannot create a
    // second customer-facing event.
    const eventId = input.appointmentId.replaceAll('-', '').toLowerCase();
    const path = `/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`;
    const response = await this.request(
      path,
      input.accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          id: eventId,
          summary: input.title,
          ...(input.description ? { description: input.description } : {}),
          start: { dateTime: input.startsAt.toISOString(), timeZone: input.timeZone },
          end: { dateTime: input.endsAt.toISOString(), timeZone: input.timeZone },
          extendedProperties: { private: { vautrinAppointmentId: input.appointmentId } },
        }),
      },
      [409],
    );
    const result =
      response.status === 409
        ? await this.request(`${path}/${eventId}`, input.accessToken, { method: 'GET' })
        : response;
    const event = await safeJson(result);
    if (
      event?.id !== eventId ||
      record(record(event?.extendedProperties)?.private)?.vautrinAppointmentId !==
        input.appointmentId ||
      dateValue(record(event?.start)?.dateTime)?.getTime() !== input.startsAt.getTime() ||
      dateValue(record(event?.end)?.dateTime)?.getTime() !== input.endsAt.getTime()
    ) {
      throw new CalendarProviderError('booking_identity_conflict', false);
    }
    return { providerEventId: eventId, startsAt: input.startsAt, endsAt: input.endsAt };
  }

  async findAppointment(
    input: FindCalendarAppointmentInput,
  ): Promise<CalendarAppointmentResult | null> {
    assertContext(input);
    if (!UUID.test(input.appointmentId)) {
      throw new CalendarProviderError('invalid_booking_input', false);
    }
    const eventId = input.appointmentId.replaceAll('-', '').toLowerCase();
    const response = await this.request(
      `/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${eventId}`,
      input.accessToken,
      { method: 'GET' },
      [404, 410],
    );
    if (response.status === 404 || response.status === 410) return null;
    const event = await safeJson(response);
    if (
      event?.id !== eventId ||
      record(record(event?.extendedProperties)?.private)?.vautrinAppointmentId !==
        input.appointmentId
    ) {
      throw new CalendarProviderError('booking_identity_conflict', false);
    }
    const startsAt = dateValue(record(event.start)?.dateTime);
    const endsAt = dateValue(record(event.end)?.dateTime);
    if (!startsAt || !endsAt || startsAt >= endsAt) {
      throw new CalendarProviderError('invalid_provider_response', true);
    }
    return { providerEventId: eventId, startsAt, endsAt };
  }

  async rescheduleAppointment(
    input: RescheduleCalendarAppointmentInput,
  ): Promise<CalendarAppointmentResult> {
    assertContext(input);
    assertInterval(input.startsAt, input.endsAt);
    if (
      !UUID.test(input.appointmentId) ||
      input.providerEventId !== input.appointmentId.replaceAll('-', '').toLowerCase() ||
      !input.timeZone.trim()
    ) {
      throw new CalendarProviderError('invalid_booking_input', false);
    }
    const response = await this.request(
      `/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${input.providerEventId}`,
      input.accessToken,
      {
        method: 'PATCH',
        body: JSON.stringify({
          start: { dateTime: input.startsAt.toISOString(), timeZone: input.timeZone },
          end: { dateTime: input.endsAt.toISOString(), timeZone: input.timeZone },
        }),
      },
    );
    const event = await safeJson(response);
    if (
      event?.id !== input.providerEventId ||
      record(record(event?.extendedProperties)?.private)?.vautrinAppointmentId !==
        input.appointmentId ||
      dateValue(record(event?.start)?.dateTime)?.getTime() !== input.startsAt.getTime() ||
      dateValue(record(event?.end)?.dateTime)?.getTime() !== input.endsAt.getTime()
    ) {
      throw new CalendarProviderError('booking_identity_conflict', false);
    }
    return {
      providerEventId: input.providerEventId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    };
  }

  async cancelAppointment(input: CancelCalendarAppointmentInput): Promise<void> {
    assertContext(input);
    if (!/^[a-v0-9]{5,1024}$/.test(input.providerEventId)) {
      throw new CalendarProviderError('invalid_event_id', false);
    }
    await this.request(
      `/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${input.providerEventId}`,
      input.accessToken,
      { method: 'DELETE' },
      [404, 410],
    );
  }

  private async request(
    path: string,
    accessToken: string,
    init: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: string },
    acceptedErrors: readonly number[] = [],
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.requestFetch(`${API_ORIGIN}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new CalendarProviderError('network_unavailable', true);
    }
    if (!response.ok && !acceptedErrors.includes(response.status)) {
      throw new CalendarProviderError(
        response.status === 401 ? 'authorization_expired' : `http_${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }
    return response;
  }
}

function assertContext(input: { tenantId: string; calendarId: string; accessToken: string }): void {
  if (!UUID.test(input.tenantId) || !input.calendarId.trim() || !input.accessToken.trim()) {
    throw new CalendarProviderError('invalid_integration_context', false);
  }
}

function assertInterval(startsAt: Date, endsAt: Date): void {
  if (
    !(startsAt instanceof Date) ||
    !(endsAt instanceof Date) ||
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(endsAt.getTime()) ||
    startsAt >= endsAt
  ) {
    throw new CalendarProviderError('invalid_interval', false);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function dateValue(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return record(await response.json());
  } catch {
    throw new CalendarProviderError('invalid_provider_response', true);
  }
}
