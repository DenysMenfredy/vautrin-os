import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createPlatformClient,
  createPrismaClient,
  type PrismaClient,
  withTenant,
} from '@vautrin/database';
import { GoogleCalendarProvider } from '@vautrin/integrations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';
import { GoogleCalendarIntegrationService } from '../src/integrations/google-calendar-integration.service.js';
import { TenantService } from '../src/tenant/tenant.service.js';
import { validBookingRules, validBusinessHours } from './support/booking.js';

const events = new Map<string, { startsAt: Date; endsAt: Date }>();
let inserts = 0;
const fakeCalendar = {
  getAvailability(input: { tenantId: string; startsAt: Date; endsAt: Date }) {
    return Promise.resolve({
      busy: [...events.entries()]
        .filter(
          ([key, event]) =>
            key.startsWith(`${input.tenantId}:`) &&
            event.startsAt < input.endsAt &&
            event.endsAt > input.startsAt,
        )
        .map(([, event]) => event),
    });
  },
  findAppointment(input: { tenantId: string; appointmentId: string }) {
    const event = events.get(`${input.tenantId}:${input.appointmentId}`);
    return Promise.resolve(
      event ? { ...event, providerEventId: input.appointmentId.replaceAll('-', '') } : null,
    );
  },
  createAppointment(input: {
    tenantId: string;
    appointmentId: string;
    startsAt: Date;
    endsAt: Date;
  }) {
    inserts += 1;
    events.set(`${input.tenantId}:${input.appointmentId}`, {
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
    return Promise.resolve({
      providerEventId: input.appointmentId.replaceAll('-', ''),
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
  },
  rescheduleAppointment(input: {
    tenantId: string;
    appointmentId: string;
    providerEventId: string;
    startsAt: Date;
    endsAt: Date;
  }) {
    events.set(`${input.tenantId}:${input.appointmentId}`, {
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
    return Promise.resolve({
      providerEventId: input.providerEventId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
  },
  cancelAppointment(input: { tenantId: string; providerEventId: string }) {
    events.delete(
      `${input.tenantId}:${input.providerEventId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')}`,
    );
    return Promise.resolve();
  },
};

let app: INestApplication;
let baseUrl = '';
let platform: PrismaClient;
let runtime: PrismaClient;
let tenantA = '';
let tenantB = '';
let leadA = '';
let tokenA = '';
let tokenB = '';
const suffix = Date.now();
const ownerA = { email: `booking-a-${suffix}@example.test`, password: 'booking owner password A' };
const ownerB = { email: `booking-b-${suffix}@example.test`, password: 'booking owner password B' };

function nextWeekday(offset: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  date.setUTCHours(15, 0, 0, 0);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function request(path: string, token: string, body: unknown) {
  return fetch(`${baseUrl}/api${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function login(credentials: typeof ownerA): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { accessToken: string }).accessToken;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GoogleCalendarProvider)
    .useValue(fakeCalendar)
    .overrideProvider(GoogleCalendarIntegrationService)
    .useValue({
      resolve: async (tenantId: string) => ({
        tenantId,
        calendarId: 'test-calendar',
        accessToken: 'fake',
      }),
    })
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());
  const { ValidationPipe } = await import('@nestjs/common');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(0);
  baseUrl = await app.getUrl();
  platform = createPlatformClient();
  runtime = createPrismaClient();
  const tenants = app.get(TenantService);
  tenantA = (
    await tenants.provision({
      slug: `booking-a-${suffix}`,
      name: 'Booking A',
      owner: { ...ownerA, name: 'Owner A' },
    })
  ).tenantId;
  tenantB = (
    await tenants.provision({
      slug: `booking-b-${suffix}`,
      name: 'Booking B',
      owner: { ...ownerB, name: 'Owner B' },
    })
  ).tenantId;
  [tokenA, tokenB] = await Promise.all([login(ownerA), login(ownerB)]);
  await withTenant(runtime, tenantA, async (tx) => {
    await tx.businessProfile.upsert({
      where: { tenantId: tenantA },
      create: {
        tenantId: tenantA,
        displayName: 'Booking A',
        businessHours: validBusinessHours,
        bookingRules: validBookingRules,
      },
      update: { businessHours: validBusinessHours, bookingRules: validBookingRules },
    });
    const contact = await tx.contact.create({
      data: {
        tenantId: tenantA,
        firstName: 'Customer',
        phone: '+15555550101',
        address: { city: 'Belem' },
      },
    });
    leadA = (
      await tx.lead.create({
        data: {
          tenantId: tenantA,
          contactId: contact.id,
          status: 'QUALIFIED',
          service: 'kitchen-remodel',
        },
      })
    ).id;
    await tx.integration.create({
      data: {
        tenantId: tenantA,
        provider: 'google_calendar',
        category: 'CALENDAR',
        status: 'CONNECTED',
      },
    });
  });
  await withTenant(runtime, tenantB, async (tx) => {
    await tx.businessProfile.upsert({
      where: { tenantId: tenantB },
      create: {
        tenantId: tenantB,
        displayName: 'Booking B',
        businessHours: validBusinessHours,
        bookingRules: validBookingRules,
      },
      update: { businessHours: validBusinessHours, bookingRules: validBookingRules },
    });
    await tx.integration.create({
      data: {
        tenantId: tenantB,
        provider: 'google_calendar',
        category: 'CALENDAR',
        status: 'CONNECTED',
      },
    });
  });
});

afterAll(async () => {
  await runtime?.$disconnect();
  await platform?.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await platform?.user.deleteMany({ where: { email: { in: [ownerA.email, ownerB.email] } } });
  await platform?.$disconnect();
  await app?.close();
});

describe('Booking Rules V1 API', () => {
  it('offers only policy-approved slots and rejects a cross-tenant lead', async () => {
    const start = nextWeekday(3);
    const available = await request('/appointments/availability', tokenA, {
      leadId: leadA,
      appointmentTypeId: 'site-visit',
      from: start.toISOString(),
      to: new Date(start.getTime() + 3_600_000).toISOString(),
    });
    expect(available.status).toBe(201);
    expect(
      ((await available.json()) as { slots: Array<{ startsAt: string }> }).slots[0]?.startsAt,
    ).toBe(start.toISOString());
    const foreign = await request('/appointments/availability', tokenB, {
      leadId: leadA,
      appointmentTypeId: 'site-visit',
      from: start.toISOString(),
      to: new Date(start.getTime() + 3_600_000).toISOString(),
    });
    expect(foreign.status).toBe(404);
  });

  it('revalidates at creation, prevents conflicts, and deduplicates command replay', async () => {
    const start = nextWeekday(4);
    const input = {
      leadId: leadA,
      appointmentTypeId: 'site-visit',
      startsAt: start.toISOString(),
      idempotencyKey: crypto.randomUUID(),
    };
    const first = await request('/appointments', tokenA, input);
    expect(first.status).toBe(201);
    const appointment = (await first.json()) as { id: string; status: string };
    expect(appointment.status).toBe('SCHEDULED');
    const replay = await request('/appointments', tokenA, input);
    expect(replay.status).toBe(201);
    expect(((await replay.json()) as { id: string }).id).toBe(appointment.id);
    expect(inserts).toBe(1);
    const conflict = await request('/appointments', tokenA, {
      ...input,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()) as { code: string }).toMatchObject({ code: 'BOOKING_CONFLICT' });
    const persisted = await withTenant(runtime, tenantA, async (tx) => ({
      appointments: await tx.appointment.count({ where: { tenantId: tenantA } }),
      events: await tx.event.count({ where: { tenantId: tenantA, name: 'appointment.created' } }),
      audits: await tx.auditLog.count({
        where: { tenantId: tenantA, action: 'appointment.created' },
      }),
    }));
    expect(persisted).toMatchObject({ appointments: 1, events: 1, audits: 1 });
  });

  it('reschedules and cancels according to policy', async () => {
    const first = nextWeekday(7);
    const created = await request('/appointments', tokenA, {
      leadId: leadA,
      appointmentTypeId: 'site-visit',
      startsAt: first.toISOString(),
      idempotencyKey: crypto.randomUUID(),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const next = nextWeekday(8);
    const changed = await request(`/appointments/${id}/reschedule`, tokenA, {
      startsAt: next.toISOString(),
      idempotencyKey: crypto.randomUUID(),
    });
    expect(changed.status).toBe(201);
    expect((await changed.json()) as { status: string }).toMatchObject({ status: 'RESCHEDULED' });
    const cancelled = await request(`/appointments/${id}/cancel`, tokenA, {
      reason: 'Customer requested',
    });
    expect(cancelled.status).toBe(201);
    expect((await cancelled.json()) as { status: string }).toMatchObject({ status: 'CANCELLED' });
  });

  it('serializes competing booking commands for the same tenant slot', async () => {
    const startsAt = nextWeekday(11).toISOString();
    const command = { leadId: leadA, appointmentTypeId: 'site-visit', startsAt };
    const responses = await Promise.all([
      request('/appointments', tokenA, { ...command, idempotencyKey: crypto.randomUUID() }),
      request('/appointments', tokenA, { ...command, idempotencyKey: crypto.randomUUID() }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(
      await withTenant(runtime, tenantA, (tx) =>
        tx.appointment.count({
          where: {
            tenantId: tenantA,
            startsAt: new Date(startsAt),
            status: 'SCHEDULED',
          },
        }),
      ),
    ).toBe(1);
  });

  it('returns recoverable missing-field reasons and rejects client tenant context', async () => {
    await withTenant(runtime, tenantA, (tx) =>
      tx.lead.update({
        where: { id: leadA },
        data: { service: null },
      }),
    );
    const command = {
      leadId: leadA,
      appointmentTypeId: 'site-visit',
      from: nextWeekday(12).toISOString(),
      to: new Date(nextWeekday(12).getTime() + 3_600_000).toISOString(),
    };
    const missing = await request('/appointments/availability', tokenA, command);
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({
      code: 'BOOKING_REQUIRED_FIELDS_MISSING',
      missingFields: ['lead.service'],
    });
    const tampered = await request('/appointments/availability', tokenA, {
      ...command,
      tenantId: tenantB,
    });
    expect(tampered.status).toBe(400);
  });
});
