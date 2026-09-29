import 'reflect-metadata';

import { createHash } from 'node:crypto';

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPlatformClient, type PrismaClient } from '@vautrin/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';
import { DatabaseService } from '../src/database/database.service.js';
import { InvitationService } from '../src/tenant/invitation.service.js';
import { TenantService } from '../src/tenant/tenant.service.js';

let app: INestApplication;
let base: string;
let platform: PrismaClient;
let invitations: InvitationService;
let tenants: TenantService;
let database: DatabaseService;

const suffix = Date.now();
const ownerA = {
  email: `invite-owner-a-${suffix}@example.test`,
  password: 'a long owner password A!',
};
const ownerB = {
  email: `invite-owner-b-${suffix}@example.test`,
  password: 'a long owner password B!',
};
const admin = { email: `invite-admin-${suffix}@example.test`, password: 'a long admin password!!' };
const pendingEmail = `invite-pending-${suffix}@example.test`;
const expiredEmail = `invite-expired-${suffix}@example.test`;
const racingEmail = `invite-racing-${suffix}@example.test`;
const legacyPendingEmail = `invite-legacy-${suffix}@example.test`;
let tenantA = '';
let tenantB = '';
let ownerAToken = '';

function post(path: string, body: unknown, bearer?: string): Promise<Response> {
  return fetch(`${base}/api${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function login(
  email: string,
  password: string,
): Promise<{ accessToken: string; memberships: unknown[] }> {
  const response = await post('/auth/login', { email, password });
  expect(response.status).toBe(200);
  return (await response.json()) as { accessToken: string; memberships: unknown[] };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(0);
  base = await app.getUrl();
  platform = createPlatformClient();
  invitations = app.get(InvitationService);
  tenants = app.get(TenantService);
  database = app.get(DatabaseService);
});

afterAll(async () => {
  if (platform) {
    await platform.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB].filter(Boolean) } } });
    await platform.user.deleteMany({
      where: {
        email: {
          in: [
            ownerA.email,
            ownerB.email,
            admin.email,
            pendingEmail,
            expiredEmail,
            racingEmail,
            legacyPendingEmail,
          ],
        },
      },
    });
    await platform.$disconnect();
  }
  await app?.close();
});

describe('operator-controlled registration', () => {
  it('bootstraps a tenant with no login-capable owner until one-time acceptance', async () => {
    const issued = await invitations.bootstrapTenant({
      slug: `inv-a-${suffix}`,
      name: 'Invitation Tenant A',
      ownerEmail: ownerA.email,
    });
    tenantA = issued.tenantId;
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await platform.tenantInvitation.findUnique({
      where: { id: issued.invitationId },
    });
    expect(stored?.tokenHash).toBe(createHash('sha256').update(issued.token).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(issued.token);
    expect(await platform.user.findUnique({ where: { email: ownerA.email } })).toBeNull();
    expect((await post('/auth/login', ownerA)).status).toBe(401);

    const replacement = await invitations.reissueBootstrapOwner({
      tenantId: tenantA,
      ownerEmail: ownerA.email,
    });
    expect(
      (await post('/auth/invitations/accept', { token: issued.token, password: ownerA.password }))
        .status,
    ).toBe(401);

    expect(
      (
        await post('/auth/invitations/accept', {
          token: replacement.token,
          password: ownerA.password,
          name: 'Owner A',
        })
      ).status,
    ).toBe(204);
    ownerAToken = (await login(ownerA.email, ownerA.password)).accessToken;
    expect(
      (
        await post('/auth/invitations/accept', {
          token: replacement.token,
          password: ownerA.password,
        })
      ).status,
    ).toBe(401);

    const membership = await platform.tenantUser.findFirst({ where: { tenantId: tenantA } });
    expect(membership).toMatchObject({ role: 'OWNER', status: 'ACTIVE' });
    const accepted = await platform.tenantInvitation.findUnique({
      where: { id: replacement.invitationId },
    });
    expect(accepted?.acceptedAt).not.toBeNull();
    await expect(
      invitations.reissueBootstrapOwner({ tenantId: tenantA, ownerEmail: ownerA.email }),
    ).rejects.toThrow('Tenant already has an active owner.');
  });

  it('isolates invitations and requires member.manage for issuing one', async () => {
    expect((await post('/tenant/invitations', { email: pendingEmail, role: 'STAFF' })).status).toBe(
      401,
    );
    const issuedResponse = await post(
      '/tenant/invitations',
      { email: pendingEmail, role: 'STAFF' },
      ownerAToken,
    );
    expect(issuedResponse.status).toBe(201);
    expect(issuedResponse.headers.get('cache-control')).toBe('no-store');
    const issued = (await issuedResponse.json()) as { invitationId: string; token: string };
    expect(
      await database.unscoped.tenantInvitation.findMany({ where: { id: issued.invitationId } }),
    ).toEqual([]);
    expect(
      await database.withTenant(tenantA, (tx) =>
        tx.tenantInvitation.findMany({ where: { id: issued.invitationId } }),
      ),
    ).toHaveLength(1);

    // Reissue invalidates the previous bearer secret.
    const replacementResponse = await post(
      '/tenant/invitations',
      { email: pendingEmail, role: 'STAFF' },
      ownerAToken,
    );
    expect(replacementResponse.status).toBe(201);
    const replacement = (await replacementResponse.json()) as { token: string };
    expect(
      (
        await post('/auth/invitations/accept', {
          token: issued.token,
          password: 'a long member password',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await post('/auth/invitations/accept', {
          token: replacement.token,
          password: 'a long member password',
        })
      ).status,
    ).toBe(204);
    const memberToken = (await login(pendingEmail, 'a long member password')).accessToken;
    expect(
      (await post('/tenant/invitations', { email: expiredEmail, role: 'STAFF' }, memberToken))
        .status,
    ).toBe(403);
  });

  it('validates invitation input before any state change', async () => {
    expect(
      (await post('/tenant/invitations', { email: 'not-an-email', role: 'STAFF' }, ownerAToken))
        .status,
    ).toBe(400);
    expect(
      (await post('/tenant/invitations', { email: expiredEmail, role: 'SUPER_ADMIN' }, ownerAToken))
        .status,
    ).toBe(400);
    expect(
      (await post('/auth/invitations/accept', { token: 'short', password: 'a long password' }))
        .status,
    ).toBe(400);
  });

  it('requires the current password when an existing user joins another tenant', async () => {
    const issued = await invitations.bootstrapTenant({
      slug: `inv-b-${suffix}`,
      name: 'Invitation Tenant B',
      ownerEmail: ownerB.email,
    });
    tenantB = issued.tenantId;
    expect(
      (await post('/auth/invitations/accept', { token: issued.token, password: ownerB.password }))
        .status,
    ).toBe(204);
    const passwordHashBefore = (
      await platform.user.findUniqueOrThrow({ where: { email: ownerB.email } })
    ).passwordHash;

    const invitedResponse = await post(
      '/tenant/invitations',
      { email: ownerB.email, role: 'STAFF' },
      ownerAToken,
    );
    expect(invitedResponse.status).toBe(201);
    const invited = (await invitedResponse.json()) as { token: string };
    expect(
      await database.withTenant(tenantB, (tx) =>
        tx.tenantInvitation.findMany({ where: { tenantId: tenantA } }),
      ),
    ).toEqual([]);
    expect(
      (
        await post('/auth/invitations/accept', {
          token: invited.token,
          password: 'incorrect existing password',
        })
      ).status,
    ).toBe(401);
    expect(
      (await post('/auth/invitations/accept', { token: invited.token, password: ownerB.password }))
        .status,
    ).toBe(204);
    const session = await login(ownerB.email, ownerB.password);
    expect(session.memberships).toHaveLength(2);
    const membership = await platform.tenantUser.findFirst({
      where: { tenantId: tenantA, user: { email: ownerB.email } },
    });
    expect(membership?.role).toBe('STAFF');
    expect(
      (await platform.user.findUniqueOrThrow({ where: { email: ownerB.email } })).passwordHash,
    ).toBe(passwordHashBefore);
  });

  it('rejects expired invitations and prevents an admin from inviting an owner', async () => {
    const response = await post(
      '/tenant/invitations',
      { email: expiredEmail, role: 'STAFF' },
      ownerAToken,
    );
    expect(response.status).toBe(201);
    const issued = (await response.json()) as { invitationId: string; token: string };
    await platform.tenantInvitation.update({
      where: { id: issued.invitationId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect(
      (
        await post('/auth/invitations/accept', {
          token: issued.token,
          password: 'a long member password',
        })
      ).status,
    ).toBe(401);

    await tenants.addMember({
      tenantId: tenantA,
      email: admin.email,
      password: admin.password,
      role: 'ADMIN',
    });
    const adminToken = (await login(admin.email, admin.password)).accessToken;
    expect(
      (await post('/tenant/invitations', { email: expiredEmail, role: 'OWNER' }, adminToken))
        .status,
    ).toBe(403);
  });

  it('consumes a token only once under concurrent acceptance', async () => {
    const response = await post(
      '/tenant/invitations',
      { email: racingEmail, role: 'STAFF' },
      ownerAToken,
    );
    expect(response.status).toBe(201);
    const issued = (await response.json()) as { token: string };
    const body = { token: issued.token, password: 'a long race password!' };
    const [first, second] = await Promise.all([
      post('/auth/invitations/accept', body),
      post('/auth/invitations/accept', body),
    ]);
    expect([first.status, second.status].sort()).toEqual([204, 401]);
    expect(
      await platform.tenantUser.count({
        where: { tenantId: tenantA, user: { email: racingEmail } },
      }),
    ).toBe(1);
  });

  it('activates only the invited tenant when a pending identity has multiple pending memberships', async () => {
    await tenants.addMember({ tenantId: tenantA, email: legacyPendingEmail, role: 'STAFF' });
    await tenants.addMember({ tenantId: tenantB, email: legacyPendingEmail, role: 'STAFF' });
    const before = await platform.tenantUser.findMany({
      where: { user: { email: legacyPendingEmail } },
    });
    expect(before.map((membership) => membership.status)).toEqual(['INVITED', 'INVITED']);

    const response = await post(
      '/tenant/invitations',
      { email: legacyPendingEmail, role: 'STAFF' },
      ownerAToken,
    );
    expect(response.status).toBe(201);
    const invitation = (await response.json()) as { token: string };
    expect(
      (
        await post('/auth/invitations/accept', {
          token: invitation.token,
          password: 'a long pending password',
        })
      ).status,
    ).toBe(204);
    const memberships = await platform.tenantUser.findMany({
      where: { user: { email: legacyPendingEmail } },
      select: { tenantId: true, status: true },
    });
    expect(memberships.find((membership) => membership.tenantId === tenantA)?.status).toBe(
      'ACTIVE',
    );
    expect(memberships.find((membership) => membership.tenantId === tenantB)?.status).toBe(
      'INVITED',
    );
    expect((await login(legacyPendingEmail, 'a long pending password')).memberships).toHaveLength(
      1,
    );
  });
});
