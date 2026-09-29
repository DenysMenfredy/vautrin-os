import { describe, expect, it, vi } from 'vitest';

import { CalendarProviderError } from '../src/calendar-provider.js';
import { GoogleCalendarProvider } from '../src/google-calendar.provider.js';

const tenantId = '26a13bb1-f505-46f5-9e46-c74438763cfb';
const appointmentId = '986bbd13-bcab-494b-b502-43c1238219af';
const startsAt = new Date('2026-10-01T13:00:00.000Z');
const endsAt = new Date('2026-10-01T14:00:00.000Z');
const calendarId = 'business@example.test';
const accessToken = 'secret-access-token';
const context = { tenantId, calendarId, accessToken };
const booking = {
  ...context,
  appointmentId,
  title: 'Project consultation',
  timeZone: 'America/New_York',
  startsAt,
  endsAt,
};
const eventId = appointmentId.replaceAll('-', '');

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function event(start = startsAt.toISOString()) {
  return {
    id: eventId,
    start: { dateTime: start },
    end: { dateTime: endsAt.toISOString() },
    extendedProperties: { private: { vautrinAppointmentId: appointmentId } },
  };
}

describe('Google Calendar provider', () => {
  it('queries free/busy only for the selected calendar and fails closed on per-calendar errors', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(
      json({
        calendars: {
          [calendarId]: { busy: [{ start: startsAt.toISOString(), end: endsAt.toISOString() }] },
        },
      }),
    );
    const provider = new GoogleCalendarProvider(request);
    expect(await provider.getAvailability({ ...context, startsAt, endsAt })).toEqual({
      busy: [{ startsAt, endsAt }],
    });
    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe('https://www.googleapis.com/calendar/v3/freeBusy');
    expect(JSON.parse(String(init?.body))).toMatchObject({ items: [{ id: calendarId }] });
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${accessToken}` });

    request.mockResolvedValueOnce(
      json({ calendars: { [calendarId]: { errors: [{ reason: 'notFound' }], busy: [] } } }),
    );
    await expect(provider.getAvailability({ ...context, startsAt, endsAt })).rejects.toMatchObject({
      code: 'availability_unavailable',
      retryable: true,
    });
  });

  it('creates an event with a deterministic ID and safely reconciles a 409 replay', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(event()))
      .mockResolvedValueOnce(json({ error: 'duplicate' }, 409))
      .mockResolvedValueOnce(json(event()));
    const provider = new GoogleCalendarProvider(request);
    const first = await provider.createAppointment(booking);
    const replay = await provider.createAppointment(booking);
    expect(first).toEqual(replay);
    expect(first.providerEventId).toBe(eventId);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({
      id: eventId,
      extendedProperties: { private: { vautrinAppointmentId: appointmentId } },
    });
    expect(String(request.mock.calls[2]?.[0])).toContain(`/events/${eventId}`);
  });

  it('rejects a 409 whose event identity or time differs', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 409))
      .mockResolvedValueOnce(json(event('2026-10-02T13:00:00.000Z')));
    await expect(
      new GoogleCalendarProvider(request).createAppointment(booking),
    ).rejects.toMatchObject({
      code: 'booking_identity_conflict',
      retryable: false,
    });
  });

  it('reconciles a previously inserted event by stable ID and detects absence', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(event()))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const provider = new GoogleCalendarProvider(request);
    expect(await provider.findAppointment({ ...context, appointmentId })).toEqual({
      providerEventId: eventId,
      startsAt,
      endsAt,
    });
    expect(await provider.findAppointment({ ...context, appointmentId })).toBeNull();
    expect(request.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('patches only the existing matching event and checks the returned identity', async () => {
    const next = new Date('2026-10-02T13:00:00.000Z');
    const nextEnd = new Date('2026-10-02T14:00:00.000Z');
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(
      json({
        ...event(next.toISOString()),
        end: { dateTime: nextEnd.toISOString() },
      }),
    );
    const provider = new GoogleCalendarProvider(request);
    expect(
      await provider.rescheduleAppointment({
        ...context,
        appointmentId,
        providerEventId: eventId,
        startsAt: next,
        endsAt: nextEnd,
        timeZone: 'America/New_York',
      }),
    ).toEqual({ providerEventId: eventId, startsAt: next, endsAt: nextEnd });
    expect(request.mock.calls[0]?.[1]?.method).toBe('PATCH');
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({
      start: { dateTime: next.toISOString() },
      end: { dateTime: nextEnd.toISOString() },
    });
  });

  it('cancels only the configured event; provider errors do not reveal credentials', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const provider = new GoogleCalendarProvider(request);
    await provider.cancelAppointment({ ...context, providerEventId: eventId });
    expect(request.mock.calls[0]?.[0]).toBe(
      `https://www.googleapis.com/calendar/v3/calendars/business%40example.test/events/${eventId}`,
    );
    request.mockResolvedValueOnce(json({ error: { message: accessToken } }, 401));
    const failure = await provider
      .getAvailability({ ...context, startsAt, endsAt })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CalendarProviderError);
    expect(String(failure)).not.toContain(accessToken);
  });
});
