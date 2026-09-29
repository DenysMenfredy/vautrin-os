import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createPlatformClient,
  createPrismaClient,
  type PrismaClient,
  withTenant,
} from '@vautrin/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';
import { TenantService } from '../src/tenant/tenant.service.js';

let app: INestApplication;
let baseUrl = '';
let platform: PrismaClient;
let runtime: PrismaClient;
let tenantA = '';
let tenantB = '';
let ownerToken = '';
let otherToken = '';
let readOnlyToken = '';
let contactA = '';
let appointmentId = '';

const suffix = Date.now();
const owner = {
  email: `appointment-a-${suffix}@example.test`,
  password: 'appointment owner password',
};
const other = {
  email: `appointment-b-${suffix}@example.test`,
  password: 'appointment other password',
};
const reader = {
  email: `appointment-reader-${suffix}@example.test`,
  password: 'appointment read only password',
};

function request(method: 'GET' | 'POST', path: string, token: string, body?: unknown) {
  return fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function login(credentials: { email: string; password: string }): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { accessToken: string }).accessToken;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
  const first = await tenants.provision({
    slug: `appointment-a-${suffix}`,
    name: 'Appointment Tenant A',
    owner: { ...owner, name: 'Appointment Owner A' },
  });
  tenantA = first.tenantId;
  const second = await tenants.provision({
    slug: `appointment-b-${suffix}`,
    name: 'Appointment Tenant B',
    owner: { ...other, name: 'Appointment Owner B' },
  });
  tenantB = second.tenantId;
  await tenants.addMember({ tenantId: tenantA, ...reader, role: 'READ_ONLY' });
  [ownerToken, otherToken, readOnlyToken] = await Promise.all([
    login(owner),
    login(other),
    login(reader),
  ]);
  const contactResponse = await request('POST', '/contacts', ownerToken, {
    firstName: 'Appointment Customer',
  });
  expect(contactResponse.status).toBe(201);
  contactA = ((await contactResponse.json()) as { id: string }).id;
  const startsAt = new Date(Date.now() + 86_400_000);
  const appointment = await withTenant(runtime, tenantA, (tx) =>
    tx.appointment.create({
      data: {
        tenantId: tenantA,
        contactId: contactA,
        title: 'Initial consultation',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        timezone: 'America/Belem',
      },
    }),
  );
  appointmentId = appointment.id;
});

afterAll(async () => {
  await runtime?.$disconnect();
  await platform?.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await platform?.user.deleteMany({
    where: { email: { in: [owner.email, other.email, reader.email] } },
  });
  await platform?.$disconnect();
  await app?.close();
});

describe('appointment read domain (VOS-092)', () => {
  it('lists, filters, paginates, and reads appointments for the active tenant', async () => {
    const startsAt = new Date(Date.now() + 86_400_000);
    await withTenant(runtime, tenantA, (tx) =>
      tx.appointment.create({
        data: {
          tenantId: tenantA,
          contactId: contactA,
          title: 'Follow-up consultation',
          startsAt: new Date(startsAt.getTime() + 86_400_000),
          endsAt: new Date(startsAt.getTime() + 90_000_000),
          timezone: 'America/Belem',
          status: 'CONFIRMED',
        },
      }),
    );

    const firstPageResponse = await request('GET', '/appointments?limit=1', ownerToken);
    expect(firstPageResponse.status).toBe(200);
    const firstPage = (await firstPageResponse.json()) as {
      items: Array<{ id: string; status: string; startsAt: string }>;
      nextCursor: string | null;
    };
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toBeTruthy();

    const nextPageResponse = await request(
      'GET',
      `/appointments?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor ?? '')}`,
      ownerToken,
    );
    expect(nextPageResponse.status).toBe(200);
    const nextPage = (await nextPageResponse.json()) as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(nextPage.items).toHaveLength(1);
    expect(nextPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);

    const filtered = await request(
      'GET',
      `/appointments?status=CONFIRMED&contactId=${contactA}`,
      readOnlyToken,
    );
    expect(filtered.status).toBe(200);
    expect(((await filtered.json()) as { items: unknown[] }).items).toHaveLength(1);

    const appointmentResponse = await request(
      'GET',
      `/appointments/${appointmentId}`,
      readOnlyToken,
    );
    expect(appointmentResponse.status).toBe(200);
    expect(await appointmentResponse.json()).toMatchObject({
      id: appointmentId,
      contactId: contactA,
      status: 'SCHEDULED',
      timezone: 'America/Belem',
    });
  });

  it('does not expose another tenant appointment or accept client tenant filters', async () => {
    expect((await request('GET', `/appointments/${appointmentId}`, otherToken)).status).toBe(404);
    const list = await request('GET', '/appointments', otherToken);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(0);
    expect((await request('GET', `/appointments?tenantId=${tenantA}`, ownerToken)).status).toBe(
      400,
    );
    expect((await request('GET', '/appointments?startsAfter=invalid', ownerToken)).status).toBe(
      400,
    );
    expect(
      (
        await request(
          'GET',
          '/appointments?startsAfter=2026-10-02T00%3A00%3A00.000Z&startsBefore=2026-10-01T00%3A00%3A00.000Z',
          ownerToken,
        )
      ).status,
    ).toBe(400);
  });
});
