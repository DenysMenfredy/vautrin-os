import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPlatformClient, type PrismaClient } from '@vautrin/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';
import { TenantService } from '../src/tenant/tenant.service.js';
import { validBookingRules, validBusinessHours } from './support/booking.js';

let app: INestApplication;
let baseUrl: string;
let platform: PrismaClient;
let tenants: TenantService;
let tenantA = '';
let tenantB = '';
let ownerToken = '';
let otherTenantToken = '';
let staffToken = '';

const suffix = Date.now();
const owner = {
  email: `business-owner-${suffix}@example.test`,
  password: 'a long business owner password',
};
const otherOwner = {
  email: `business-other-${suffix}@example.test`,
  password: 'a different long owner password',
};
const staff = {
  email: `business-staff-${suffix}@example.test`,
  password: 'a long business staff password',
};

function request(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  token: string,
  body?: unknown,
) {
  return fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function login(credentials: { email: string; password: string }): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { accessToken: string };
  return body.accessToken;
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
  tenants = app.get(TenantService);

  const first = await tenants.provision({
    slug: `business-a-${suffix}`,
    name: 'Business Configuration Tenant A',
    owner: { ...owner, name: 'Configuration Owner' },
  });
  tenantA = first.tenantId;

  const second = await tenants.provision({
    slug: `business-b-${suffix}`,
    name: 'Business Configuration Tenant B',
    owner: otherOwner,
  });
  tenantB = second.tenantId;

  await tenants.addMember({
    tenantId: tenantA,
    email: staff.email,
    password: staff.password,
    role: 'STAFF',
  });

  [ownerToken, otherTenantToken, staffToken] = await Promise.all([
    login(owner),
    login(otherOwner),
    login(staff),
  ]);
});

afterAll(async () => {
  await platform?.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await platform?.user.deleteMany({
    where: { email: { in: [owner.email, otherOwner.email, staff.email] } },
  });
  await platform?.$disconnect();
  await app?.close();
});

describe('business profile (VOS-040)', () => {
  it('creates and updates the active tenant profile without exposing unrelated configuration', async () => {
    const initial = await request('GET', '/business/profile', ownerToken);
    expect(initial.status).toBe(404);

    const created = await request('PATCH', '/business/profile', ownerToken, {
      displayName: 'North Star Remodeling',
      legalName: 'North Star Home LLC',
      email: 'CONTACT@EXAMPLE.TEST',
      timezone: 'America/Belem',
      locale: 'en-US',
      currency: 'usd',
    });
    expect(created.status).toBe(200);
    const profile = (await created.json()) as Record<string, unknown>;
    expect(profile).toMatchObject({
      displayName: 'North Star Remodeling',
      legalName: 'North Star Home LLC',
      email: 'contact@example.test',
      timezone: 'America/Belem',
      locale: 'en-US',
      currency: 'USD',
    });
    expect(profile).not.toHaveProperty('aiConfiguration');
    expect(profile).not.toHaveProperty('tenantId');

    const updated = await request('PATCH', '/business/profile', ownerToken, {
      displayName: 'North Star Design & Remodel',
      phone: '+15551234567',
      businessHours: validBusinessHours,
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      displayName: 'North Star Design & Remodel',
      phone: '+15551234567',
      legalName: 'North Star Home LLC',
      businessHours: validBusinessHours,
    });
  });

  it('manages operational settings only for authorized tenant admins', async () => {
    const initial = await request('GET', '/business/settings', ownerToken);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      communicationPreferences: {},
      qualificationRules: {},
      bookingRules: {},
      aiConfiguration: {},
    });

    expect((await request('GET', '/business/settings', staffToken)).status).toBe(403);
    expect((await request('GET', '/business/settings', otherTenantToken)).status).toBe(404);
    expect(
      (await request('PATCH', '/business/settings', staffToken, { bookingRules: {} })).status,
    ).toBe(403);

    const settings = {
      communicationPreferences: { preferredChannel: 'email' },
      qualificationRules: { minimumBudget: 5000 },
      bookingRules: validBookingRules,
      aiConfiguration: { enabled: false },
    };
    const updated = await request('PATCH', '/business/settings', ownerToken, settings);
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject(settings);
    const readBack = await request('GET', '/business/settings', ownerToken);
    expect(await readBack.json()).toMatchObject(settings);

    expect(
      (
        await request('PATCH', '/business/settings', ownerToken, {
          bookingRules: {
            ...validBookingRules,
            scheduling: { ...validBookingRules.scheduling, timezone: 'UTC' },
          },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request('PATCH', '/business/profile', ownerToken, {
          businessHours: { ...validBusinessHours, timezone: 'not-a-timezone' },
        })
      ).status,
    ).toBe(400);

    const publicProfile = await request('GET', '/business/profile', staffToken);
    expect(await publicProfile.json()).not.toHaveProperty('aiConfiguration');
    expect((await request('PATCH', '/business/settings', ownerToken, {})).status).toBe(400);
    expect(
      (await request('PATCH', '/business/settings', ownerToken, { aiConfiguration: null })).status,
    ).toBe(400);
    expect(
      (await request('PATCH', '/business/settings', ownerToken, { tenantId: tenantB })).status,
    ).toBe(400);

    const audit = await platform.auditLog.findFirst({
      where: { tenantId: tenantA, action: 'business.settings.updated' },
    });
    expect(audit).not.toBeNull();
  });

  it('validates timezone and requires a name when no profile exists', async () => {
    const invalid = await request('PATCH', '/business/profile', otherTenantToken, {
      phone: '+15550001111',
    });
    expect(invalid.status).toBe(400);
    const invalidBody = (await invalid.json()) as { message: string | string[] };
    expect(invalidBody.message).toContain('displayName is required');

    const invalidTimezone = await request('PATCH', '/business/profile', otherTenantToken, {
      displayName: 'Other business',
      timezone: 'Not/A_Timezone',
    });
    expect(invalidTimezone.status).toBe(400);
  });
});

describe('locations (VOS-041)', () => {
  it('enforces a single primary location, paginates, and archives instead of hard deleting', async () => {
    const first = await request('POST', '/business/locations', ownerToken, {
      name: 'Downtown Office',
      city: 'Belém',
      country: 'br',
      latitude: -1.4558,
      longitude: -48.4902,
      isPrimary: true,
    });
    expect(first.status).toBe(201);
    const firstLocation = (await first.json()) as {
      id: string;
      isPrimary: boolean;
      country: string;
    };
    expect(firstLocation).toMatchObject({ isPrimary: true, country: 'BR' });

    const second = await request('POST', '/business/locations', ownerToken, {
      name: 'North Branch',
      city: 'Ananindeua',
      isPrimary: true,
    });
    expect(second.status).toBe(201);
    const secondLocation = (await second.json()) as { id: string; isPrimary: boolean };
    expect(secondLocation.isPrimary).toBe(true);

    const formerPrimary = await request(
      'GET',
      `/business/locations/${firstLocation.id}`,
      ownerToken,
    );
    const formerPrimaryBody = (await formerPrimary.json()) as { isPrimary: boolean };
    expect(formerPrimaryBody.isPrimary).toBe(false);

    const third = await request('POST', '/business/locations', ownerToken, {
      name: 'East Branch',
    });
    expect(third.status).toBe(201);

    const promotedConcurrently = await Promise.all([
      request('POST', '/business/locations', ownerToken, {
        name: 'Concurrent Branch One',
        isPrimary: true,
      }),
      request('POST', '/business/locations', ownerToken, {
        name: 'Concurrent Branch Two',
        isPrimary: true,
      }),
    ]);
    expect(promotedConcurrently.map((response) => response.status)).toEqual([201, 201]);

    const primaryLocations = await platform.location.findMany({
      where: { tenantId: tenantA, isPrimary: true, deletedAt: null },
      select: { id: true },
    });
    expect(primaryLocations).toHaveLength(1);

    const firstPage = await request('GET', '/business/locations?limit=3', ownerToken);
    const page = (await firstPage.json()) as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).not.toBeNull();

    const nextPage = await request(
      'GET',
      `/business/locations?limit=3&cursor=${encodeURIComponent(page.nextCursor ?? '')}`,
      ownerToken,
    );
    const next = (await nextPage.json()) as { items: Array<{ id: string }> };
    expect(next.items).toHaveLength(2);
    expect(new Set([...page.items, ...next.items].map(({ id }) => id)).size).toBe(5);

    const deleted = await request('DELETE', `/business/locations/${firstLocation.id}`, ownerToken);
    expect(deleted.status).toBe(204);
    expect(
      (await request('GET', `/business/locations/${firstLocation.id}`, ownerToken)).status,
    ).toBe(404);
  });

  it('keeps location access tenant-scoped and blocks writes from staff', async () => {
    const created = await request('POST', '/business/locations', ownerToken, {
      name: 'Tenant A Location',
    });
    const location = (await created.json()) as { id: string };

    expect(
      (await request('GET', `/business/locations/${location.id}`, otherTenantToken)).status,
    ).toBe(404);
    expect((await request('GET', '/business/locations', staffToken)).status).toBe(200);
    expect(
      (await request('POST', '/business/locations', staffToken, { name: 'Forbidden' })).status,
    ).toBe(403);
  });

  it('requires both coordinates and rejects client-supplied tenant IDs', async () => {
    const invalidCoordinates = await request('POST', '/business/locations', ownerToken, {
      name: 'Incomplete coordinates',
      latitude: 10,
    });
    expect(invalidCoordinates.status).toBe(400);

    const massAssignment = await request('POST', '/business/locations', ownerToken, {
      name: 'Forged tenant location',
      tenantId: tenantB,
    });
    expect(massAssignment.status).toBe(400);

    expect((await request('GET', '/business/locations?active=false', ownerToken)).status).toBe(400);
  });
});

describe('services (VOS-042)', () => {
  it('supports tenant catalog CRUD, search, and deactivation', async () => {
    const created = await request('POST', '/business/services', ownerToken, {
      key: 'kitchen-remodeling',
      name: 'Kitchen Remodeling',
      metadata: { category: 'remodeling' },
    });
    expect(created.status).toBe(201);
    const service = (await created.json()) as { id: string; active: boolean };
    expect(service.active).toBe(true);

    const duplicate = await request('POST', '/business/services', ownerToken, {
      key: 'kitchen-remodeling',
      name: 'Duplicate Service',
    });
    expect(duplicate.status).toBe(409);

    const search = await request('GET', '/business/services?search=kitchen', ownerToken);
    expect(((await search.json()) as { items: unknown[] }).items).toHaveLength(1);

    const updated = await request('PATCH', `/business/services/${service.id}`, ownerToken, {
      name: 'Kitchen and Bath Remodeling',
    });
    expect(await updated.json()).toMatchObject({ name: 'Kitchen and Bath Remodeling' });

    expect(
      (await request('GET', `/business/services/${service.id}`, otherTenantToken)).status,
    ).toBe(404);

    const deleted = await request('DELETE', `/business/services/${service.id}`, ownerToken);
    expect(deleted.status).toBe(204);
    expect((await request('GET', `/business/services/${service.id}`, ownerToken)).status).toBe(200);
    const activeOnly = await request('GET', '/business/services?active=true', ownerToken);
    expect(((await activeOnly.json()) as { items: unknown[] }).items).toHaveLength(0);
  });
});

describe('service areas (VOS-043)', () => {
  it('supports service-area CRUD and configuration filters', async () => {
    const created = await request('POST', '/business/service-areas', ownerToken, {
      type: 'POSTAL_CODE',
      value: '66000-000',
      configuration: { country: 'BR' },
    });
    expect(created.status).toBe(201);
    const area = (await created.json()) as { id: string; active: boolean };
    expect(area.active).toBe(true);

    const forbiddenType = await request('POST', '/business/service-areas', ownerToken, {
      type: 'POSTCODE',
      value: '66000-000',
    });
    expect(forbiddenType.status).toBe(400);

    const updated = await request('PATCH', `/business/service-areas/${area.id}`, ownerToken, {
      value: '66010-000',
      active: false,
    });
    expect(await updated.json()).toMatchObject({ value: '66010-000', active: false });

    expect(
      (await request('GET', `/business/service-areas/${area.id}`, otherTenantToken)).status,
    ).toBe(404);

    const deleted = await request('DELETE', `/business/service-areas/${area.id}`, ownerToken);
    expect(deleted.status).toBe(204);
    const activeOnly = await request('GET', '/business/service-areas?active=true', ownerToken);
    expect(((await activeOnly.json()) as { items: unknown[] }).items).toHaveLength(0);
  });
});

describe('business configuration authorization and audit', () => {
  it('requires authentication and records configuration mutations', async () => {
    expect((await fetch(`${baseUrl}/api/business/services`)).status).toBe(401);

    const logs = await platform.auditLog.findMany({
      where: {
        tenantId: tenantA,
        action: { startsWith: 'business.' },
      },
      select: { action: true },
    });
    expect(logs.map((entry) => entry.action)).toContain('business.profile.updated');
    expect(logs.map((entry) => entry.action)).toContain('business.location.created');
    expect(logs.map((entry) => entry.action)).toContain('business.service.created');
    expect(logs.map((entry) => entry.action)).toContain('business.service_area.created');
  });
});
