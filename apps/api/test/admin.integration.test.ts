import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  AuthTokensResponse,
  InvitationResponse,
  PlatformAuditPage,
  PlatformDashboard,
  PlatformMonthlyAnalytics,
  PlatformUserDetail,
  PlatformUserPage,
} from '@vautrin/contracts';
import {
  createPlatformClient,
  createPrismaClient,
  type PrismaClient,
  withTenant,
} from '@vautrin/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';
import { requestLogging } from '../src/common/request-logging.js';
import { InvitationService } from '../src/tenant/invitation.service.js';

let app: INestApplication;
let url: string;
let db: PrismaClient;
let restricted: PrismaClient;
let runtime: PrismaClient;
const suffix = `admin-v04-${Date.now()}`;
const password = 'invitation-accepted synthetic passphrase!';
const adminOrigin = 'http://localhost:8081';
const customerOrigin = 'http://localhost:8080';
const emails = ['super', 'operator', 'support', 'customer', 'second-super'].map(
  (prefix) => `${prefix}-${suffix}@example.test`,
);
const identities: Record<string, string> = {};
const tenantIds: string[] = [];
const cookies: Record<string, string> = {};
let tenantToken: string;

async function request(
  path: string,
  options: {
    method?: string;
    body?: object;
    cookie?: string;
    bearer?: string;
    origin?: string;
    idempotencyKey?: string;
  } = {},
) {
  const response = await fetch(`${url}/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.bearer ? { authorization: `Bearer ${options.bearer}` } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  return response;
}
function as(role: string, path: string, method = 'GET', body?: object, key?: string) {
  return request(`/admin${path}`, {
    method,
    ...(body ? { body } : {}),
    cookie: cookies[role] ?? '',
    origin: adminOrigin,
    ...(key ? { idempotencyKey: key } : {}),
  });
}
async function platformLogin(role: string, email: string) {
  const response = await request('/admin/session', {
    method: 'POST',
    origin: adminOrigin,
    body: { email, password },
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie');
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Strict');
  expect(cookie).toContain('Path=/');
  expect(cookie).not.toMatch(/Domain=/i);
  expect(await response.json()).not.toHaveProperty('token');
  cookies[role] = cookie?.split(';')[0] ?? '';
}
async function customerLogin(email: string): Promise<AuthTokensResponse> {
  const response = await request('/auth/login', {
    method: 'POST',
    origin: customerOrigin,
    body: { email, password },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as AuthTokensResponse;
}

beforeAll(async () => {
  if (!process.env.DATABASE_PLATFORM_URL)
    throw new Error('Admin integration tests require the restricted DATABASE_PLATFORM_URL.');
  db = createPlatformClient();
  restricted = createPrismaClient({ url: process.env.DATABASE_PLATFORM_URL });
  runtime = createPrismaClient();
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.use(requestLogging);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(0);
  url = await app.getUrl();
  const invitations = app.get(InvitationService);
  const first = await invitations.bootstrapTenant({
    slug: `${suffix}-operators`,
    name: `${suffix} Operators`,
    ownerEmail: emails[0] ?? '',
  });
  tenantIds.push(first.tenantId);
  await invitations.accept({ token: first.token, password, name: 'Initial operator' });
  const superUser = await db.user.findUniqueOrThrow({ where: { email: emails[0] ?? '' } });
  identities.super = superUser.id;
  await db.platformAccess.create({ data: { userId: superUser.id, role: 'SUPER_ADMIN' } });
  for (const [index, role] of [
    [1, 'OPERATOR'],
    [2, 'SUPPORT_READ_ONLY'],
  ] as const) {
    const issued = await invitations.invite({
      tenantId: first.tenantId,
      actorUserId: superUser.id,
      actorRole: 'OWNER',
      role: 'STAFF',
      email: emails[index] ?? '',
    });
    await invitations.accept({ token: issued.token, password });
    const user = await db.user.findUniqueOrThrow({ where: { email: emails[index] ?? '' } });
    identities[index === 1 ? 'operator' : 'support'] = user.id;
    await db.platformAccess.create({ data: { userId: user.id, role } });
  }
  const session = await customerLogin(emails[0] ?? '');
  tenantToken = session.accessToken;
  await platformLogin('super', emails[0] ?? '');
  await platformLogin('operator', emails[1] ?? '');
  await platformLogin('support', emails[2] ?? '');
});
afterAll(async () => {
  await app?.close();
  await restricted?.$disconnect();
  await runtime?.$disconnect();
  if (db) {
    const rows = await db.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const ids = rows.map((row) => row.id);
    await db.platformAuditLog.deleteMany({ where: { actorUserId: { in: ids } } });
    await db.platformSession.deleteMany({ where: { userId: { in: ids } } });
    await db.platformAccess.deleteMany({ where: { userId: { in: ids } } });
    await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});

describe('independent platform authorization', () => {
  it('rejects tenant OWNER bearer tokens and tenant cookies at admin endpoints', async () => {
    expect((await request('/admin/dashboard', { bearer: tenantToken })).status).toBe(401);
    expect(
      (await request('/admin/dashboard', { cookie: 'vos_refresh=synthetic-tenant-token' })).status,
    ).toBe(401);
    expect((await request('/auth/me', { cookie: cookies.super ?? '' })).status).toBe(401);
  });
  it('rejects mutations from other origins and missing browser origins', async () => {
    for (const origin of ['https://evil.example', 'http://localhost:8080', undefined]) {
      const response = await request('/admin/session', {
        method: 'POST',
        body: { email: emails[0] ?? '', password },
        ...(origin ? { origin } : {}),
      });
      expect(response.status).toBe(403);
    }
  });
  it('lets read-only support inspect safe data but never mutate', async () => {
    const response = await as('support', '/users');
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toMatch(/passwordHash|tokenHash|credentialsRef|password_hash|token_hash/);
    expect(body).not.toContain('platformAccess');
    for (const [path, method, payload] of [
      ['/tenants', 'POST', { name: 'Blocked tenant' }],
      [`/users/${identities.super}/disable`, 'POST', { reason: 'Forbidden attempt' }],
      [
        `/users/${identities.super}/platform-access`,
        'PATCH',
        { role: 'SUPER_ADMIN', reason: 'Forbidden attempt' },
      ],
    ] as const) {
      expect((await as('support', path, method, payload)).status).toBe(403);
    }
    expect(
      (
        await as('operator', `/users/${identities.super}/disable`, 'POST', {
          reason: 'Forbidden platform identity change',
        })
      ).status,
    ).toBe(403);
  });
  it('protects self deletion and the last active super administrator', async () => {
    const deleted = await as('super', `/users/${identities.super}`, 'DELETE', {
      reason: 'Self removal test',
      confirmation: 'DELETE',
    });
    expect(deleted.status).toBe(409);
    expect(((await deleted.json()) as { code: string }).code).toBe('USER_DELETE_SELF_FORBIDDEN');
    const disabled = await as('super', `/users/${identities.super}/disable`, 'POST', {
      reason: 'Last administrator test',
    });
    expect(disabled.status).toBe(409);
    expect(((await disabled.json()) as { code: string }).code).toBe('LAST_SUPER_ADMIN_PROTECTED');
    const changed = await as('super', `/users/${identities.super}/platform-access`, 'PATCH', {
      role: 'OPERATOR',
      reason: 'Last administrator downgrade',
    });
    expect(changed.status).toBe(409);
    expect(((await changed.json()) as { code: string }).code).toBe('LAST_SUPER_ADMIN_PROTECTED');
  });
  it('paginates case-insensitive searches without losing cursor confinement', async () => {
    const firstResponse = await as('super', `/users?q=${suffix.toUpperCase()}&limit=1`);
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()) as PlatformUserPage;
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = (await (
      await as('super', `/users?q=${suffix}&limit=1&cursor=${first.nextCursor}`)
    ).json()) as PlatformUserPage;
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    expect((await as('super', `/users?limit=101`)).status).toBe(400);
    expect((await as('super', `/users?cursor=invalid`)).status).toBe(400);
  });
});

describe('operator to invitation acceptance to lifecycle release path', () => {
  it('provisions, invites, accepts, manages, revokes, re-enables and logically deletes with immutable audit', async () => {
    const initial = (await (await as('super', '/dashboard')).json()) as PlatformDashboard;
    const key = randomUUID();
    const createdResponse = await as(
      'operator',
      '/tenants',
      'POST',
      {
        name: `${suffix} Customer`,
        slug: `${suffix}-customer`,
        timezone: 'America/Phoenix',
        template: 'remodeling',
        owner: { email: emails[3] ?? '' },
      },
      key,
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      tenantId: string;
      invitation: InvitationResponse;
    };
    tenantIds.push(created.tenantId);
    expect(created.invitation.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await db.user.findUnique({ where: { email: emails[3] ?? '' } })).toBeNull();
    const persisted = await db.tenantInvitation.findUniqueOrThrow({
      where: { id: created.invitation.invitationId },
    });
    expect(persisted.tokenHash).not.toBe(created.invitation.token);
    expect(
      (
        await as(
          'operator',
          '/tenants',
          'POST',
          { name: `${suffix} Customer`, slug: `${suffix}-customer` },
          key,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await as('operator', '/invitations', 'POST', {
          tenantId: created.tenantId,
          email: emails[3] ?? '',
          role: 'OWNER',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await as('operator', '/invitations', 'POST', {
          tenantId: created.tenantId,
          email: 'cannot-set@example.test',
          role: 'STAFF',
          password,
        })
      ).status,
    ).toBe(400);
    const acceptance = await request('/auth/invitations/accept', {
      method: 'POST',
      origin: customerOrigin,
      body: { token: created.invitation.token, password, name: 'Invitation customer' },
    });
    expect(acceptance.status).toBe(204);
    expect(
      (
        await request('/auth/invitations/accept', {
          method: 'POST',
          origin: customerOrigin,
          body: { token: created.invitation.token, password },
        })
      ).status,
    ).toBe(401);
    const customer = await customerLogin(emails[3] ?? '');
    identities.customer = customer.user.id;
    expect(customer.activeTenantId).toBe(created.tenantId);
    expect(
      (
        await request('/admin/session', {
          method: 'POST',
          origin: adminOrigin,
          body: { email: emails[3] ?? '', password },
        })
      ).status,
    ).toBe(401);
    expect((await request('/business/profile', { bearer: customer.accessToken })).status).toBe(200);
    const updated = (await (await as('super', '/dashboard')).json()) as PlatformDashboard;
    expect(updated.summary.usersTotal).toBe(initial.summary.usersTotal + 1);
    expect(updated.summary.tenantsTotal).toBe(initial.summary.tenantsTotal + 1);
    const analytics = (await (
      await as('support', '/analytics/users-per-month?months=12')
    ).json()) as PlatformMonthlyAnalytics;
    expect(analytics.series).toHaveLength(12);
    expect(analytics.timezone).toBe('UTC');
    const detail = (await (
      await as('operator', `/users/${customer.user.id}`)
    ).json()) as PlatformUserDetail;
    expect(detail.sessions.tenantSessions).toBeGreaterThan(0);
    expect(JSON.stringify(detail)).not.toMatch(/password|tokenHash|credentialsRef/);
    const membership = detail.memberships[0];
    expect(membership).toBeTruthy();
    expect(
      (
        await as('operator', `/users/${customer.user.id}/memberships/${membership?.id}`, 'PATCH', {
          role: 'MANAGER',
        })
      ).status,
    ).toBe(200);
    expect((await request('/business/profile', { bearer: customer.accessToken })).status).toBe(401);
    expect(
      (
        await request('/auth/refresh', {
          method: 'POST',
          body: { refreshToken: customer.refreshToken },
        })
      ).status,
    ).toBe(401);
    const secondResponse = await as('operator', '/tenants', 'POST', {
      name: `${suffix} Second`,
      slug: `${suffix}-second`,
    });
    expect(secondResponse.status).toBe(201);
    const second = (await secondResponse.json()) as { tenantId: string };
    tenantIds.push(second.tenantId);
    const added = await as('operator', `/users/${customer.user.id}/memberships`, 'POST', {
      tenantId: second.tenantId,
      role: 'STAFF',
    });
    expect(added.status).toBe(201);
    const addedId = ((await added.json()) as { id: string }).id;
    expect(
      (
        await as('operator', `/users/${customer.user.id}/memberships`, 'POST', {
          tenantId: second.tenantId,
          role: 'STAFF',
        })
      ).status,
    ).toBe(409);
    expect(
      (await as('operator', `/users/${customer.user.id}/memberships/${addedId}`, 'DELETE')).status,
    ).toBe(200);
    expect(
      (await as('operator', `/users/${identities.operator}/memberships/${addedId}`, 'DELETE'))
        .status,
    ).toBe(403);
    const customerSession = await customerLogin(emails[3] ?? '');
    expect(
      (
        await as('operator', `/users/${customer.user.id}/disable`, 'POST', {
          reason: 'Security support case',
        })
      ).status,
    ).toBe(201);
    expect(
      (await request('/business/profile', { bearer: customerSession.accessToken })).status,
    ).toBe(401);
    expect(
      (
        await request('/auth/login', {
          method: 'POST',
          origin: customerOrigin,
          body: { email: emails[3] ?? '', password },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await as('operator', `/users/${customer.user.id}/enable`, 'POST', {
          reason: 'Case resolved',
        })
      ).status,
    ).toBe(201);
    const enabled = await customerLogin(emails[3] ?? '');
    expect(enabled.user.id).toBe(customer.user.id);
    expect(
      (
        await as('operator', `/users/${customer.user.id}`, 'DELETE', {
          reason: 'Forbidden purge',
          confirmation: 'DELETE',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await as('super', `/users/${customer.user.id}`, 'DELETE', {
          reason: 'Customer requested closure',
          confirmation: 'DELETE',
        })
      ).status,
    ).toBe(200);
    expect((await request('/business/profile', { bearer: enabled.accessToken })).status).toBe(401);
    expect(
      (
        await request('/auth/login', {
          method: 'POST',
          origin: customerOrigin,
          body: { email: emails[3] ?? '', password },
        })
      ).status,
    ).toBe(401);
    expect(
      await db.tenantUser.count({ where: { userId: customer.user.id, status: 'ACTIVE' } }),
    ).toBe(0);
    expect(await db.user.findUnique({ where: { id: customer.user.id } })).not.toBeNull();
    const activeUsers = (await (
      await as('super', `/users?q=${encodeURIComponent(emails[3] ?? '')}`)
    ).json()) as PlatformUserPage;
    expect(activeUsers.items).toHaveLength(0);
    const deletedUsers = (await (
      await as('super', `/users?q=${suffix}&status=DELETED`)
    ).json()) as PlatformUserPage;
    expect(deletedUsers.items.map((row) => row.id)).toContain(customer.user.id);
    expect(
      (
        await as('operator', `/tenants/${created.tenantId}/suspend`, 'POST', {
          reason: 'Operational hold',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await as('operator', `/tenants/${created.tenantId}/reactivate`, 'POST', {
          reason: 'Hold resolved',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await as('operator', `/tenants/${second.tenantId}/archive`, 'POST', {
          reason: 'Business retired',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await as('operator', `/tenants/${second.tenantId}/reactivate`, 'POST', {
          reason: 'Cannot restore archived',
        })
      ).status,
    ).toBe(409);
    const audit = (await (
      await as('super', `/audit?targetType=user&targetId=${customer.user.id}`)
    ).json()) as PlatformAuditPage;
    expect(audit.items.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'platform.user.disabled',
        'platform.user.enabled',
        'platform.user.deleted',
      ]),
    );
    const persistedAudit = await db.platformAuditLog.findMany({
      where: { tenantId: created.tenantId },
    });
    expect(JSON.stringify(persistedAudit)).not.toContain(created.invitation.token);
  });
});

describe('restricted DB access and platform record integrity', () => {
  it('denies tenant access to platform tables, provider tables to platform, and audit updates', async () => {
    expect(await runtime.tenant.findMany()).toEqual([]);
    await expect(runtime.platformAccess.findMany()).rejects.toThrow();
    await expect(runtime.platformAuditLog.findMany()).rejects.toThrow();
    const [columnPrivileges] = await restricted.$queryRaw<
      Array<{
        canReadPasswordHash: boolean;
        canReadInvitationTokenHash: boolean;
        canReadInvitationEmail: boolean;
      }>
    >`
      SELECT
        has_column_privilege(current_user, 'public.users', 'password_hash', 'SELECT') AS "canReadPasswordHash",
        has_column_privilege(current_user, 'public.tenant_invitations', 'token_hash', 'SELECT') AS "canReadInvitationTokenHash",
        has_column_privilege(current_user, 'public.tenant_invitations', 'email', 'SELECT') AS "canReadInvitationEmail"
    `;
    expect(columnPrivileges?.canReadPasswordHash).toBe(false);
    expect(columnPrivileges?.canReadInvitationTokenHash).toBe(false);
    expect(columnPrivileges?.canReadInvitationEmail).toBe(true);
    await expect(restricted.integration.findMany()).rejects.toThrow();
    await expect(restricted.contact.findMany()).rejects.toThrow();
    await expect(
      restricted.user.update({
        where: { id: identities.super ?? '' },
        data: { passwordHash: 'forbidden' },
      }),
    ).rejects.toThrow();
    await expect(
      restricted.platformAuditLog.updateMany({ data: { reason: 'forbidden' } }),
    ).rejects.toThrow();
    await expect(restricted.platformAuditLog.deleteMany()).rejects.toThrow();
    const [flags] = await restricted.$queryRaw<
      Array<{ rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean }>
    >`SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user`;
    expect(flags).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false });
  });
  it('hides business data from automation while a tenant is suspended without weakening other tenant isolation', async () => {
    const tenantId = tenantIds[0] ?? '';
    expect(await withTenant(runtime, tenantId, (tx) => tx.service.count())).toBeGreaterThan(0);
    expect(
      (
        await as('operator', `/tenants/${tenantId}/suspend`, 'POST', {
          reason: 'Automation pause test',
        })
      ).status,
    ).toBe(201);
    expect(await withTenant(runtime, tenantId, (tx) => tx.service.count())).toBe(0);
    expect(
      (
        await as('operator', `/tenants/${tenantId}/reactivate`, 'POST', {
          reason: 'Automation pause resolved',
        })
      ).status,
    ).toBe(201);
    expect(await withTenant(runtime, tenantId, (tx) => tx.service.count())).toBeGreaterThan(0);
  });
});

describe('invitation reuse and concurrent platform safeguards', () => {
  it('reuses an existing identity without replacing its password or granting platform access', async () => {
    const created = (await (
      await as('operator', '/tenants', 'POST', {
        name: `${suffix} Existing identity`,
        slug: `${suffix}-existing`,
      })
    ).json()) as { tenantId: string };
    tenantIds.push(created.tenantId);
    const invitation = (await (
      await as('operator', '/invitations', 'POST', {
        tenantId: created.tenantId,
        email: emails[1] ?? '',
        role: 'OWNER',
      })
    ).json()) as InvitationResponse;
    const before = await db.user.findUniqueOrThrow({ where: { id: identities.operator ?? '' } });
    expect(
      (
        await request('/auth/invitations/accept', {
          method: 'POST',
          origin: customerOrigin,
          body: { token: invitation.token, password: 'a different synthetic password' },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request('/auth/invitations/accept', {
          method: 'POST',
          origin: customerOrigin,
          body: { token: invitation.token, password },
        })
      ).status,
    ).toBe(204);
    const after = await db.user.findUniqueOrThrow({ where: { email: emails[1] ?? '' } });
    expect(after.id).toBe(before.id);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect((await db.platformAccess.findUniqueOrThrow({ where: { userId: after.id } })).role).toBe(
      'OPERATOR',
    );
    expect(
      (
        await as('operator', `/users/${after.id}/platform-access`, 'PATCH', {
          role: 'SUPER_ADMIN',
          reason: 'Forbidden escalation',
        })
      ).status,
    ).toBe(403);
  });
  it('explicitly reissues invitations and serializes opposing super-admin disable requests', async () => {
    const tenantId = tenantIds[0] ?? '';
    const first = (await (
      await as('operator', '/invitations', 'POST', {
        tenantId,
        email: emails[4] ?? '',
        role: 'STAFF',
      })
    ).json()) as InvitationResponse;
    const replacement = (await (
      await as('operator', '/invitations', 'POST', {
        tenantId,
        email: emails[4] ?? '',
        role: 'STAFF',
        reissue: true,
      })
    ).json()) as InvitationResponse;
    expect(replacement.token).not.toBe(first.token);
    expect(
      (
        await request('/auth/invitations/accept', {
          method: 'POST',
          origin: customerOrigin,
          body: { token: first.token, password },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request('/auth/invitations/accept', {
          method: 'POST',
          origin: customerOrigin,
          body: { token: replacement.token, password },
        })
      ).status,
    ).toBe(204);
    const user = await db.user.findUniqueOrThrow({ where: { email: emails[4] ?? '' } });
    identities.second = user.id;
    expect(
      (
        await as('super', `/users/${user.id}/platform-access`, 'PATCH', {
          role: 'SUPER_ADMIN',
          reason: 'Recovery administrator',
        })
      ).status,
    ).toBe(200);
    await platformLogin('second', emails[4] ?? '');
    const responses = await Promise.all([
      as('super', `/users/${user.id}/disable`, 'POST', { reason: 'Concurrent disable A' }),
      as('second', `/users/${identities.super}/disable`, 'POST', {
        reason: 'Concurrent disable B',
      }),
    ]);
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(
      await db.platformAccess.count({
        where: {
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
          user: { status: 'ACTIVE', deletedAt: null },
        },
      }),
    ).toBe(1);
  });
});
