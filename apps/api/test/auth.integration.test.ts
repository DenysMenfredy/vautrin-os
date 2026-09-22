import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hashRefreshToken } from '@vautrin/auth';
import { createPlatformClient, type PrismaClient } from '@vautrin/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';
import { TenantService } from '../src/tenant/tenant.service.js';

/**
 * End-to-end authentication, tenant context and RBAC (VOS-030/031/032/033/034).
 *
 * Exercised over real HTTP against a real database. The guards, the global
 * prefix and the exception filter only exist once a request goes through
 * the whole stack.
 */

let app: INestApplication;
let base: string;
let platform: PrismaClient;
let tenants: TenantService;

const suffix = Date.now();
const OWNER = { email: `owner-${suffix}@example.test`, password: 'correct horse battery staple' };
const STAFF = { email: `staff-${suffix}@example.test`, password: 'another long passphrase!!' };
const OUTSIDER = { email: `outsider-${suffix}@example.test`, password: 'third long passphrase!!' };

let tenantA = '';
let tenantB = '';
let staffUserId = '';

function post(path: string, body: unknown, token?: string) {
  return fetch(`${base}/api${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function get(path: string, token?: string) {
  return fetch(`${base}/api${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

async function login(creds: { email: string; password: string }) {
  const response = await post('/auth/login', creds);
  expect(response.status).toBe(200);
  return (await response.json()) as {
    accessToken: string;
    refreshToken: string;
    activeTenantId: string | null;
    memberships: Array<{ tenantId: string; role: string }>;
  };
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
  base = await app.getUrl();

  platform = createPlatformClient();
  tenants = app.get(TenantService);

  const a = await tenants.provision({
    slug: `auth-a-${suffix}`,
    name: 'Tenant A Remodeling',
    owner: { email: OWNER.email, password: OWNER.password, name: 'Owner A' },
  });
  tenantA = a.tenantId;

  const b = await tenants.provision({
    slug: `auth-b-${suffix}`,
    name: 'Tenant B Roofing',
    owner: { email: OUTSIDER.email, password: OUTSIDER.password },
  });
  tenantB = b.tenantId;

  const staffMembership = await tenants.addMember({
    tenantId: tenantA,
    email: STAFF.email,
    password: STAFF.password,
    role: 'STAFF',
  });
  staffUserId = staffMembership.userId;

  // The same user belongs to two tenants so refresh can prove that the
  // server-side active-tenant preference survives rotation.
  await tenants.addMember({
    tenantId: tenantB,
    email: STAFF.email,
    role: 'STAFF',
  });
});

afterAll(async () => {
  await platform?.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await platform?.user.deleteMany({
    where: { email: { in: [OWNER.email, STAFF.email, OUTSIDER.email] } },
  });
  await platform?.$disconnect();
  await app?.close();
});

describe('login', () => {
  it('issues tokens and places a single-tenant user in that tenant', async () => {
    const tokens = await login(OWNER);

    expect(tokens.accessToken.split('.')).toHaveLength(3);
    expect(tokens.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokens.activeTenantId).toBe(tenantA);
    expect(tokens.memberships).toHaveLength(1);
    expect(tokens.memberships[0]?.role).toBe('OWNER');
  });

  it.each([
    ['wrong password', { email: OWNER.email, password: 'wrong but long enough' }],
    ['unknown user', { email: `nobody-${suffix}@example.test`, password: 'long enough password' }],
  ])('rejects %s with an identical response', async (_label, creds) => {
    const response = await post('/auth/login', creds);
    expect(response.status).toBe(401);

    const body = (await response.json()) as { message: string };
    // Identical wording for both: anything else enumerates accounts.
    expect(body.message).toBe('Invalid email or password.');
  });

  it('rejects malformed input at the boundary', async () => {
    const notAnEmail = await post('/auth/login', { email: 'nope', password: 'long enough here' });
    expect(notAnEmail.status).toBe(400);

    const shortPassword = await post('/auth/login', { email: OWNER.email, password: 'short' });
    expect(shortPassword.status).toBe(400);

    // whitelist + forbidNonWhitelisted: unknown fields are rejected, not ignored.
    const extra = await post('/auth/login', { ...OWNER, isAdmin: true });
    expect(extra.status).toBe(400);
  });

  it('never returns the password hash', async () => {
    const response = await post('/auth/login', OWNER);
    expect(await response.text()).not.toMatch(/argon2|passwordHash|password_hash/);
  });
});

describe('protected routes', () => {
  it('denies by default without a token', async () => {
    expect((await get('/auth/me')).status).toBe(401);
  });

  it.each([
    ['garbage', 'not-a-token'],
    [
      'alg=none forgery',
      `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"attacker"}').toString('base64url')}.`,
    ],
  ])('rejects %s', async (_label, token) => {
    expect((await get('/auth/me', token)).status).toBe(401);
  });

  it('leaves health probes public', async () => {
    // The container healthcheck has no credentials.
    expect((await get('/health/live')).status).toBe(200);
    expect((await get('/health/ready')).status).toBe(200);
  });
});

describe('capabilities (ADR-011, SDD-09 §3)', () => {
  it('reports the capabilities of the active role', async () => {
    const owner = await login(OWNER);
    const response = await get('/auth/me', owner.accessToken);
    const body = (await response.json()) as { role: string; capabilities: string[] };

    expect(body.role).toBe('OWNER');
    expect(body.capabilities).toContain('tenant.delete');
    expect(body.capabilities).toContain('estimate.approve');
  });

  it('gives staff a strictly smaller set', async () => {
    const staff = await login(STAFF);
    const switched = await post('/auth/tenant', { tenantId: tenantA }, staff.accessToken);
    expect(switched.status).toBe(200);
    const switchedBody = (await switched.json()) as { accessToken: string };
    const body = (await (await get('/auth/me', switchedBody.accessToken)).json()) as {
      role: string;
      capabilities: string[];
    };

    expect(body.role).toBe('STAFF');
    expect(body.capabilities).toContain('lead.write');
    // SDD-09 §4 — writing an estimate does not imply approving one.
    expect(body.capabilities).not.toContain('estimate.approve');
    expect(body.capabilities).not.toContain('tenant.delete');
    expect(body.capabilities).not.toContain('audit.read');
  });
});

describe('tenant switching (SDD-05 §2)', () => {
  it('refuses a tenant the user does not belong to', async () => {
    const owner = await login(OWNER);
    // Tenant B exists, but this user is not a member. A client-supplied
    // tenant id is never sufficient authorization.
    const response = await post('/auth/tenant', { tenantId: tenantB }, owner.accessToken);

    expect(response.status).toBe(401);
  });

  it('refuses a tenant that does not exist, identically', async () => {
    const owner = await login(OWNER);
    const response = await post(
      '/auth/tenant',
      { tenantId: '0192f1a0-1b2c-7d3e-8f40-51627384950f' },
      owner.accessToken,
    );

    // Same status as "not a member", so this cannot probe for tenants.
    expect(response.status).toBe(401);
  });

  it('issues a token scoped to a tenant the user does belong to', async () => {
    const owner = await login(OWNER);
    const response = await post('/auth/tenant', { tenantId: tenantA }, owner.accessToken);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { accessToken: string; activeTenantId: string };
    expect(body.activeTenantId).toBe(tenantA);

    const me = (await (await get('/auth/me', body.accessToken)).json()) as {
      activeTenantId: string;
    };
    expect(me.activeTenantId).toBe(tenantA);
  });

  it('persists the selected tenant in the refresh session', async () => {
    const staff = await login(STAFF);
    expect(staff.activeTenantId).toBeNull();

    const switched = await post('/auth/tenant', { tenantId: tenantA }, staff.accessToken);
    expect(switched.status).toBe(200);

    const refreshed = await post('/auth/refresh', { refreshToken: staff.refreshToken });
    expect(refreshed.status).toBe(200);
    const body = (await refreshed.json()) as { activeTenantId: string };
    expect(body.activeTenantId).toBe(tenantA);
  });
});

describe('refresh token rotation (ADR-013)', () => {
  it('rotates on every use', async () => {
    const first = await login(OWNER);
    const response = await post('/auth/refresh', { refreshToken: first.refreshToken });
    expect(response.status).toBe(200);

    const second = (await response.json()) as { refreshToken: string; accessToken: string };
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.accessToken).toBeTruthy();
  });

  it('allows only one concurrent redemption of the same predecessor', async () => {
    const first = await login(OWNER);
    const responses = await Promise.all([
      post('/auth/refresh', { refreshToken: first.refreshToken }),
      post('/auth/refresh', { refreshToken: first.refreshToken }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);

    const stored = await platform.refreshToken.findMany({
      where: { tokenHash: hashRefreshToken(first.refreshToken) },
      select: { id: true },
    });
    expect(stored).toHaveLength(1);
  });

  it('revokes the whole family when a rotated token is replayed', async () => {
    const first = await login(OWNER);

    const rotated = (await (
      await post('/auth/refresh', { refreshToken: first.refreshToken })
    ).json()) as { refreshToken: string };

    // Replaying the old token is the signature of a stolen credential.
    const replay = await post('/auth/refresh', { refreshToken: first.refreshToken });
    expect(replay.status).toBe(401);

    // And the legitimate successor is killed too: once the family is known
    // to have leaked, there is no way to tell attacker from user.
    const afterBreach = await post('/auth/refresh', { refreshToken: rotated.refreshToken });
    expect(afterBreach.status).toBe(401);
  });

  it('rejects an unknown refresh token', async () => {
    const response = await post('/auth/refresh', { refreshToken: 'a'.repeat(43) });
    expect(response.status).toBe(401);
  });

  it('stops working after logout', async () => {
    const session = await login(STAFF);

    const logout = await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: `vos_refresh=${encodeURIComponent(session.refreshToken)}` },
    });
    expect(logout.status).toBe(204);

    const reuse = await post('/auth/refresh', { refreshToken: session.refreshToken });
    expect(reuse.status).toBe(401);
  });
});

describe('refresh token storage', () => {
  it('never stores the token itself', async () => {
    const session = await login(OWNER);

    const stored = await platform.$queryRaw<Array<{ token_hash: string }>>`
      SELECT token_hash FROM refresh_tokens ORDER BY created_at DESC LIMIT 5
    `;

    for (const row of stored) {
      expect(row.token_hash).not.toBe(session.refreshToken);
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('membership revocation security use case (ADR-013)', () => {
  it('revokes the active tenant session and writes an audit record atomically', async () => {
    const staff = await login(STAFF);
    const switched = await post('/auth/tenant', { tenantId: tenantA }, staff.accessToken);
    expect(switched.status).toBe(200);

    await tenants.revokeMembership(tenantA, staffUserId);

    const refresh = await post('/auth/refresh', { refreshToken: staff.refreshToken });
    expect(refresh.status).toBe(401);

    const membership = await platform.tenantUser.findUnique({
      where: { tenantId_userId: { tenantId: tenantA, userId: staffUserId } },
      select: { status: true },
    });
    expect(membership?.status).toBe('REVOKED');

    const audit = await platform.auditLog.findFirst({
      where: { tenantId: tenantA, action: 'tenant.membership.revoked' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.resourceType).toBe('tenant_membership');
  });
});
