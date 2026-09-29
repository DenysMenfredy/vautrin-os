import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPlatformClient, type PrismaClient } from '@vautrin/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';
import { TenantService } from '../src/tenant/tenant.service.js';

const suffix = Date.now();
const owner = {
  email: `agent-owner-${suffix}@example.test`,
  password: 'long agent owner password',
};
const otherOwner = {
  email: `agent-other-${suffix}@example.test`,
  password: 'long agent other password',
};

let app: INestApplication;
let baseUrl = '';
let platform: PrismaClient;
let tenantA = '';
let tenantB = '';
let ownerToken = '';
let otherToken = '';

function request(method: 'GET' | 'POST' | 'PATCH', path: string, token: string, body?: unknown) {
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
  const tenants = app.get(TenantService);
  tenantA = (
    await tenants.provision({
      slug: `agent-a-${suffix}`,
      name: 'Agent Tenant A',
      owner: { ...owner, name: 'Agent Owner A' },
    })
  ).tenantId;
  tenantB = (
    await tenants.provision({
      slug: `agent-b-${suffix}`,
      name: 'Agent Tenant B',
      owner: { ...otherOwner, name: 'Agent Owner B' },
    })
  ).tenantId;
  [ownerToken, otherToken] = await Promise.all([login(owner), login(otherOwner)]);
});

afterAll(async () => {
  await platform?.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await platform?.user.deleteMany({ where: { email: { in: [owner.email, otherOwner.email] } } });
  await platform?.$disconnect();
  await app?.close();
});

describe('versioned agent configuration', () => {
  it('creates and activates immutable, tenant-scoped versions without storing secrets', async () => {
    const response = await request('POST', '/agents', ownerToken, {
      key: `receptionist_${suffix}`,
      name: 'Receptionist',
      instructions: 'Answer using approved business facts.',
      promptVersion: 'receptionist-v1',
      modelConfiguration: { model: 'provider-pending', secretRef: 'secret://llm/key' },
      allowedTools: ['lead.read'],
    });
    expect(response.status).toBe(201);
    const draft = (await response.json()) as { id: string; status: string; version: number };
    expect(draft).toMatchObject({ status: 'DRAFT', version: 1 });

    const embeddedSecret = await request('PATCH', `/agents/${draft.id}`, ownerToken, {
      modelConfiguration: { apiKey: 'must-not-be-stored' },
    });
    expect(embeddedSecret.status).toBe(400);

    expect(
      (await request('PATCH', `/agents/${draft.id}/status`, ownerToken, { status: 'ACTIVE' }))
        .status,
    ).toBe(200);
    const activeEdit = await request('PATCH', `/agents/${draft.id}`, ownerToken, {
      name: 'Changed',
    });
    expect(activeEdit.status).toBe(409);
    await expect(
      platform.agent.update({
        where: { id: draft.id },
        data: { instructions: 'Attempt a direct database mutation.' },
      }),
    ).rejects.toThrow('Published agent versions are immutable');

    const clone = await request('POST', `/agents/${draft.id}/versions`, ownerToken);
    expect(clone.status).toBe(201);
    const nextDraft = (await clone.json()) as { id: string; version: number; status: string };
    expect(nextDraft).toMatchObject({ version: 2, status: 'DRAFT' });
    expect(
      (
        await request('PATCH', `/agents/${nextDraft.id}`, ownerToken, {
          promptVersion: 'receptionist-v2',
        })
      ).status,
    ).toBe(200);

    const crossTenant = await request('GET', `/agents/${draft.id}`, otherToken);
    expect(crossTenant.status).toBe(404);
  });
});
