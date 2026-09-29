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
  email: `workflow-owner-${suffix}@example.test`,
  password: 'long workflow owner password',
};
const otherOwner = {
  email: `workflow-other-${suffix}@example.test`,
  password: 'long workflow other password',
};
const staff = {
  email: `workflow-staff-${suffix}@example.test`,
  password: 'long workflow staff password',
};

let app: INestApplication;
let baseUrl = '';
let platform: PrismaClient;
let tenantA = '';
let tenantB = '';
let ownerToken = '';
let otherToken = '';
let staffToken = '';

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

const definition = {
  steps: [{ id: 'wait-before-response', type: 'wait', config: { duration: '30s' } }],
};

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
      slug: `workflow-a-${suffix}`,
      name: 'Workflow Tenant A',
      owner: { ...owner, name: 'Workflow Owner A' },
    })
  ).tenantId;
  tenantB = (
    await tenants.provision({
      slug: `workflow-b-${suffix}`,
      name: 'Workflow Tenant B',
      owner: { ...otherOwner, name: 'Workflow Owner B' },
    })
  ).tenantId;
  await tenants.addMember({ tenantId: tenantA, ...staff, role: 'STAFF' });
  [ownerToken, otherToken, staffToken] = await Promise.all([
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

describe('workflow definition management (VOS-081)', () => {
  it('validates tenant-scoped drafts, publishes immutably, and clones a new version', async () => {
    expect(
      (
        await request('POST', '/workflows', ownerToken, {
          key: `bad_workflow_${suffix}`,
          name: 'Invalid workflow',
          trigger: 'call.missed',
          definition: { steps: [{ id: 'bad', type: 'run_shell', config: {} }] },
        })
      ).status,
    ).toBe(400);

    const invalidCondition = await request('POST', '/workflows', ownerToken, {
      key: `invalid_condition_${suffix}`,
      name: 'Invalid condition DSL',
      trigger: 'lead.status_changed',
      definition: {
        steps: [
          { id: 'check', type: 'condition', config: { expression: 'lead.status == NEW' } },
          { id: 'finish', type: 'end', config: {} },
        ],
      },
    });
    expect(invalidCondition.status).toBe(201);
    const invalidConditionDraft = (await invalidCondition.json()) as { id: string };
    expect(
      (
        await request('PATCH', `/workflows/${invalidConditionDraft.id}/status`, ownerToken, {
          status: 'ACTIVE',
        })
      ).status,
    ).toBe(400);

    const structuredCondition = await request('POST', '/workflows', ownerToken, {
      key: `structured_condition_${suffix}`,
      name: 'Structured condition',
      trigger: 'lead.status_changed',
      definition: {
        steps: [
          {
            id: 'check',
            type: 'condition',
            config: {
              condition: { field: 'lead.status', operator: 'eq', value: 'QUALIFIED' },
              onTrue: 'finish',
            },
          },
          { id: 'finish', type: 'end', config: {} },
        ],
      },
    });
    expect(structuredCondition.status).toBe(201);
    const structuredConditionDraft = (await structuredCondition.json()) as { id: string };
    expect(
      (
        await request('PATCH', `/workflows/${structuredConditionDraft.id}/status`, ownerToken, {
          status: 'ACTIVE',
        })
      ).status,
    ).toBe(200);

    const created = await request('POST', '/workflows', ownerToken, {
      key: `workflow_${suffix}`,
      name: 'Missed call recovery',
      trigger: 'call.missed',
      definition,
    });
    expect(created.status).toBe(201);
    const draft = (await created.json()) as { id: string; version: number; status: string };
    expect(draft).toMatchObject({ version: 1, status: 'DRAFT' });

    expect(
      (await request('PATCH', `/workflows/${draft.id}`, ownerToken, { name: 'Edited draft' }))
        .status,
    ).toBe(200);
    const activated = await request('PATCH', `/workflows/${draft.id}/status`, ownerToken, {
      status: 'ACTIVE',
    });
    expect(activated.status).toBe(200);
    expect(
      (await activated.json()) as { status: string; publishedAt: string | null },
    ).toMatchObject({
      status: 'ACTIVE',
      publishedAt: expect.any(String),
    });
    expect(
      await platform.auditLog.count({
        where: { tenantId: tenantA, resourceId: draft.id, action: 'workflow.activated' },
      }),
    ).toBe(1);
    expect(
      (await request('PATCH', `/workflows/${draft.id}`, ownerToken, { name: 'Mutate published' }))
        .status,
    ).toBe(409);

    const cloned = await request('POST', `/workflows/${draft.id}/versions`, ownerToken);
    expect(cloned.status).toBe(201);
    const versionTwo = (await cloned.json()) as { id: string; version: number; status: string };
    expect(versionTwo).toMatchObject({ version: 2, status: 'DRAFT' });
    expect(
      await platform.auditLog.count({
        where: { tenantId: tenantA, resourceId: versionTwo.id, action: 'workflow.version.created' },
      }),
    ).toBe(1);

    expect(
      (await request('PATCH', `/workflows/${draft.id}/status`, ownerToken, { status: 'PAUSED' }))
        .status,
    ).toBe(200);
    expect(
      (await request('PATCH', `/workflows/${draft.id}/status`, ownerToken, { status: 'ARCHIVED' }))
        .status,
    ).toBe(200);
    expect(
      (await request('PATCH', `/workflows/${draft.id}/status`, ownerToken, { status: 'ACTIVE' }))
        .status,
    ).toBe(409);

    const page = await request('GET', `/workflows?trigger=call.missed`, ownerToken);
    expect(page.status).toBe(200);
    expect(
      ((await page.json()) as { items: Array<{ id: string }> }).items.map((item) => item.id),
    ).toEqual(expect.arrayContaining([draft.id, versionTwo.id]));
  });

  it('enforces tenant isolation and workflow capabilities', async () => {
    const created = await request('POST', '/workflows', ownerToken, {
      key: `isolated_${suffix}`,
      name: 'Tenant A workflow',
      trigger: 'lead.created',
      definition,
    });
    const workflow = (await created.json()) as { id: string };
    expect((await request('GET', `/workflows/${workflow.id}`, otherToken)).status).toBe(404);
    expect(
      (
        await request('POST', '/workflows', staffToken, {
          key: `staff_${suffix}`,
          name: 'Forbidden workflow',
          trigger: 'lead.created',
          definition,
        })
      ).status,
    ).toBe(403);
    const otherList = await request('GET', '/workflows', otherToken);
    expect(((await otherList.json()) as { items: unknown[] }).items).toHaveLength(0);
  });
});
