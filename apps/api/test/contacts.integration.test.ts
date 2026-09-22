import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPlatformClient, type PrismaClient } from '@vautrin/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';
import { TenantService } from '../src/tenant/tenant.service.js';

let app: INestApplication;
let baseUrl: string;
let platform: PrismaClient;
let tenants: TenantService;
let tenantA = '';
let tenantB = '';
let ownerToken = '';
let otherTenantToken = '';
let staffToken = '';
let readOnlyToken = '';

const suffix = Date.now();
const owner = {
  email: `contacts-owner-${suffix}@example.test`,
  password: 'a long contacts owner password',
};
const otherOwner = {
  email: `contacts-other-${suffix}@example.test`,
  password: 'a different contacts owner password',
};
const staff = {
  email: `contacts-staff-${suffix}@example.test`,
  password: 'a long contacts staff password',
};
const readOnly = {
  email: `contacts-read-only-${suffix}@example.test`,
  password: 'a long contacts read only password',
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
    slug: `contacts-a-${suffix}`,
    name: 'Contacts Tenant A',
    owner: { ...owner, name: 'Contacts Owner' },
  });
  tenantA = first.tenantId;

  const second = await tenants.provision({
    slug: `contacts-b-${suffix}`,
    name: 'Contacts Tenant B',
    owner: otherOwner,
  });
  tenantB = second.tenantId;

  await tenants.addMember({
    tenantId: tenantA,
    email: staff.email,
    password: staff.password,
    role: 'STAFF',
  });
  await tenants.addMember({
    tenantId: tenantA,
    email: readOnly.email,
    password: readOnly.password,
    role: 'READ_ONLY',
  });

  [ownerToken, otherTenantToken, staffToken, readOnlyToken] = await Promise.all([
    login(owner),
    login(otherOwner),
    login(staff),
    login(readOnly),
  ]);
});

afterAll(async () => {
  await platform?.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await platform?.user.deleteMany({
    where: { email: { in: [owner.email, otherOwner.email, staff.email, readOnly.email] } },
  });
  await platform?.$disconnect();
  await app?.close();
});

describe('contacts (VOS-050)', () => {
  it('creates, reads, updates, searches, and cursor-paginates contacts', async () => {
    const firstResponse = await request('POST', '/contacts', ownerToken, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: ' ADA@EXAMPLE.TEST ',
      phone: '+15551234567',
      company: 'Analytical Engines',
      address: { city: 'London', lines: ['St James Square'] },
      tags: ['referral', 'priority'],
      notes: 'Interested in a consultation.',
    });
    expect(firstResponse.status).toBe(201);
    const first = (await firstResponse.json()) as {
      id: string;
      email: string;
      address: unknown;
      tags: string[];
    };
    expect(first).toMatchObject({
      email: 'ada@example.test',
      address: { city: 'London', lines: ['St James Square'] },
      tags: ['referral', 'priority'],
    });
    expect(first).not.toHaveProperty('tenantId');
    expect(first).not.toHaveProperty('createdBy');
    expect((await request('GET', `/contacts/${first.id}`, ownerToken)).status).toBe(200);

    const secondResponse = await request('POST', '/contacts', ownerToken, {
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.test',
      company: 'Navy',
    });
    expect(secondResponse.status).toBe(201);
    const second = (await secondResponse.json()) as { id: string };

    const updatedResponse = await request('PATCH', `/contacts/${first.id}`, ownerToken, {
      company: 'Analytical Engines Ltd',
      address: null,
    });
    expect(updatedResponse.status).toBe(200);
    expect(await updatedResponse.json()).toMatchObject({
      company: 'Analytical Engines Ltd',
      address: null,
    });

    const found = await request('GET', '/contacts?search=analytical', ownerToken);
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({
      items: [
        {
          id: first.id,
          email: 'ada@example.test',
          company: 'Analytical Engines Ltd',
        },
      ],
      nextCursor: null,
    });

    const firstPageResponse = await request('GET', '/contacts?limit=1', ownerToken);
    const firstPage = (await firstPageResponse.json()) as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(firstPageResponse.status).toBe(200);
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();

    const nextPageResponse = await request(
      'GET',
      `/contacts?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor ?? '')}`,
      ownerToken,
    );
    const nextPage = (await nextPageResponse.json()) as { items: Array<{ id: string }> };
    expect(nextPageResponse.status).toBe(200);
    expect(nextPage.items).toHaveLength(1);
    expect(new Set([firstPage.items[0]?.id, nextPage.items[0]?.id])).toEqual(
      new Set([first.id, second.id]),
    );
  });

  it('enforces tenant isolation, capability checks, and soft archive', async () => {
    const created = await request('POST', '/contacts', ownerToken, {
      firstName: 'Tenant A Contact',
      email: 'tenant-a@example.test',
    });
    expect(created.status).toBe(201);
    const contact = (await created.json()) as { id: string };

    expect((await request('GET', `/contacts/${contact.id}`, otherTenantToken)).status).toBe(404);
    expect(
      (
        await request('PATCH', `/contacts/${contact.id}`, otherTenantToken, {
          firstName: 'Cross-tenant modification',
        })
      ).status,
    ).toBe(404);
    expect((await request('DELETE', `/contacts/${contact.id}`, otherTenantToken)).status).toBe(404);

    const otherTenantList = await request('GET', '/contacts', otherTenantToken);
    expect(otherTenantList.status).toBe(200);
    expect(await otherTenantList.json()).toMatchObject({ items: [], nextCursor: null });

    const staffCreated = await request('POST', '/contacts', staffToken, {
      firstName: 'Staff-created contact',
    });
    expect(staffCreated.status).toBe(201);
    expect((await request('GET', '/contacts', staffToken)).status).toBe(200);
    expect((await request('GET', '/contacts', readOnlyToken)).status).toBe(200);
    expect(
      (
        await request('POST', '/contacts', readOnlyToken, {
          firstName: 'Read-only cannot create',
        })
      ).status,
    ).toBe(403);

    const archived = await request('DELETE', `/contacts/${contact.id}`, ownerToken);
    expect(archived.status).toBe(204);
    expect((await request('GET', `/contacts/${contact.id}`, ownerToken)).status).toBe(404);
    expect(
      await request('GET', '/contacts?search=tenant-a%40example.test', ownerToken).then(
        (response) => response.json(),
      ),
    ).toMatchObject({ items: [], nextCursor: null });
    expect(
      await platform.contact.findFirst({
        where: { id: contact.id, tenantId: tenantA },
        select: { deletedAt: true },
      }),
    ).toMatchObject({ deletedAt: expect.any(Date) });
    const auditActions = await platform.auditLog.findMany({
      where: { tenantId: tenantA, resourceType: 'contact', resourceId: contact.id },
      select: { action: true },
    });
    expect(auditActions.map(({ action }) => action)).toEqual(
      expect.arrayContaining(['contact.created', 'contact.archived']),
    );
  });

  it('rejects invalid input, client tenant IDs, empty updates, and bad pagination', async () => {
    expect(
      (
        await request('POST', '/contacts', ownerToken, {
          email: 'not-an-email',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request('POST', '/contacts', ownerToken, {
          phone: '5551234567',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request('POST', '/contacts', ownerToken, {
          firstName: 'Forged tenant',
          tenantId: tenantB,
        })
      ).status,
    ).toBe(400);
    const created = await request('POST', '/contacts', ownerToken, {
      firstName: 'Empty update test',
    });
    const contact = (await created.json()) as { id: string };
    expect((await request('PATCH', `/contacts/${contact.id}`, ownerToken, {})).status).toBe(400);
    expect((await request('GET', '/contacts?limit=101', ownerToken)).status).toBe(400);
    expect((await request('GET', '/contacts?cursor=invalid', ownerToken)).status).toBe(400);
  });
});
