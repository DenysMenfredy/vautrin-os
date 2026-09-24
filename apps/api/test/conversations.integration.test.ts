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
import { ConversationsService } from '../src/conversations/conversations.service.js';
import { TenantService } from '../src/tenant/tenant.service.js';

let app: INestApplication;
let baseUrl = '';
let platform: PrismaClient;
let runtime: PrismaClient;
let tenantA = '';
let tenantB = '';
let ownerToken = '';
let otherToken = '';
let staffToken = '';
let readOnlyToken = '';
let contactA = '';
let contactB = '';
let leadA = '';
let conversationId = '';

const suffix = Date.now();
const owner = {
  email: `conversation-a-${suffix}@example.test`,
  password: 'long conversation password a',
};
const other = {
  email: `conversation-b-${suffix}@example.test`,
  password: 'long conversation password b',
};
const staff = {
  email: `conversation-staff-${suffix}@example.test`,
  password: 'long conversation staff password',
};
const reader = {
  email: `conversation-reader-${suffix}@example.test`,
  password: 'long conversation reader password',
};

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

async function createdId(response: Response): Promise<string> {
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
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
    slug: `conversation-a-${suffix}`,
    name: 'Conversation Tenant A',
    owner: { ...owner, name: 'Conversation Owner A' },
  });
  tenantA = first.tenantId;
  const second = await tenants.provision({
    slug: `conversation-b-${suffix}`,
    name: 'Conversation Tenant B',
    owner: { ...other, name: 'Conversation Owner B' },
  });
  tenantB = second.tenantId;
  await tenants.addMember({ tenantId: tenantA, ...staff, role: 'STAFF' });
  await tenants.addMember({ tenantId: tenantA, ...reader, role: 'READ_ONLY' });
  [ownerToken, otherToken, staffToken, readOnlyToken] = await Promise.all([
    login(owner),
    login(other),
    login(staff),
    login(reader),
  ]);
  contactA = await createdId(
    await request('POST', '/contacts', ownerToken, { firstName: 'Conversation Customer A' }),
  );
  contactB = await createdId(
    await request('POST', '/contacts', otherToken, { firstName: 'Conversation Customer B' }),
  );
  leadA = await createdId(await request('POST', '/leads', ownerToken, { contactId: contactA }));
});

afterAll(async () => {
  await runtime?.$disconnect();
  await platform?.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await platform?.user.deleteMany({
    where: { email: { in: [owner.email, other.email, staff.email, reader.email] } },
  });
  await platform?.$disconnect();
  await app?.close();
});

describe('conversation and message domain (VOS-060/061)', () => {
  it('opens a channel-independent tenant conversation and paginates the inbox', async () => {
    conversationId = await createdId(
      await request('POST', '/conversations', ownerToken, {
        contactId: contactA,
        leadId: leadA,
        channel: 'SMS',
        subject: 'Kitchen inquiry',
      }),
    );
    await createdId(
      await request('POST', '/conversations', ownerToken, {
        contactId: contactA,
        channel: 'EMAIL',
      }),
    );
    const firstPage = await request('GET', '/conversations?limit=1', ownerToken);
    expect(firstPage.status).toBe(200);
    const page = (await firstPage.json()) as { items: Array<{ id: string }>; nextCursor: string };
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    const secondPage = await request(
      'GET',
      `/conversations?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`,
      ownerToken,
    );
    expect(secondPage.status).toBe(200);
    const next = (await secondPage.json()) as { items: Array<{ id: string }> };
    expect(next.items).toHaveLength(1);
    expect(next.items[0]?.id).not.toBe(page.items[0]?.id);
    const read = await request('GET', `/conversations/${conversationId}`, ownerToken);
    expect(await read.json()).toMatchObject({
      id: conversationId,
      contactId: contactA,
      leadId: leadA,
      channel: 'SMS',
      status: 'OPEN',
    });
  });

  it('rejects foreign references and cross-tenant access, and enforces capabilities', async () => {
    expect(
      (await request('POST', '/conversations', ownerToken, { contactId: contactB, channel: 'SMS' }))
        .status,
    ).toBe(404);
    expect(
      (
        await request('POST', '/conversations', ownerToken, {
          contactId: contactA,
          leadId: crypto.randomUUID(),
          channel: 'SMS',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request('POST', '/conversations', ownerToken, {
          contactId: contactA,
          channel: 'SMS',
          tenantId: tenantB,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request('POST', '/conversations', readOnlyToken, {
          contactId: contactA,
          channel: 'SMS',
        })
      ).status,
    ).toBe(403);
    expect((await request('GET', `/conversations/${conversationId}`, otherToken)).status).toBe(404);
    expect(
      (await request('GET', `/conversations/${conversationId}/messages`, otherToken)).status,
    ).toBe(404);
    const otherList = await request('GET', '/conversations', otherToken);
    expect(((await otherList.json()) as { items: unknown[] }).items).toHaveLength(0);
  });

  it('changes status with audit and reads messages only in the active tenant', async () => {
    const changed = await request('PATCH', `/conversations/${conversationId}/status`, staffToken, {
      status: 'PENDING',
    });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ status: 'PENDING' });
    expect(
      (
        await request('PATCH', `/conversations/${conversationId}/status`, readOnlyToken, {
          status: 'CLOSED',
        })
      ).status,
    ).toBe(403);

    const service = app.get(ConversationsService);
    const inbound = {
      conversationId,
      provider: 'test-adapter',
      providerEventId: `event-${suffix}`,
      providerMessageId: `message-${suffix}`,
      body: 'Interested in a kitchen remodel',
      fromAddress: ' +15551234567 ',
      toAddress: '+15557654321',
    };
    const message = await service.recordInbound(tenantA, inbound);
    const duplicate = await service.recordInbound(tenantA, inbound);
    expect(duplicate.id).toBe(message.id);
    expect(message.fromAddress).toBe('+15551234567');
    const list = await request(
      'GET',
      `/conversations/${conversationId}/messages?limit=1`,
      ownerToken,
    );
    expect(list.status).toBe(200);
    const page = (await list.json()) as { items: Array<Record<string, unknown>> };
    expect(page.items[0]).toMatchObject({
      id: message.id,
      direction: 'INBOUND',
      status: 'DELIVERED',
    });
    expect(page.items[0]).not.toHaveProperty('tenantId');
    expect(page.items[0]).not.toHaveProperty('providerEventId');
    expect(
      (await request('GET', `/conversations/${conversationId}/messages?limit=0`, ownerToken))
        .status,
    ).toBe(400);
    const otherMessages = await withTenant(runtime, tenantB, (tx) =>
      tx.message.findMany({ where: { id: message.id } }),
    );
    expect(otherMessages).toHaveLength(0);
    expect(
      await withTenant(runtime, tenantA, (tx) => tx.message.count({ where: { conversationId } })),
    ).toBe(1);
    expect(
      await withTenant(runtime, tenantA, (tx) =>
        tx.event.count({ where: { name: 'message.received' } }),
      ),
    ).toBe(1);
    expect((await service.get(tenantA, conversationId)).lastMessageAt).not.toBeNull();
    await expect(service.recordInbound(tenantB, inbound)).rejects.toThrow('Conversation not found');
    await expect(
      service.recordInbound(tenantA, {
        ...inbound,
        fromAddress: 'not-e164',
        providerEventId: 'new-event',
      }),
    ).rejects.toThrow('E.164');
    expect(
      await platform.auditLog.count({
        where: { tenantId: tenantA, action: 'conversation.status_changed' },
      }),
    ).toBe(1);
    expect(
      await platform.auditLog.count({
        where: { tenantId: tenantA, action: 'message.inbound.recorded' },
      }),
    ).toBe(1);
  });

  it('suppresses SMS before AI interpretation when a provider delivers STOP', async () => {
    const service = app.get(ConversationsService);
    expect(await service.isSuppressed(tenantA, contactA, 'SMS')).toBe(false);
    const input = {
      conversationId,
      provider: 'test-adapter',
      providerEventId: `stop-${suffix}`,
      providerMessageId: `stop-message-${suffix}`,
      body: '  stop  ',
      fromAddress: '+15551234567',
      toAddress: '+15557654321',
    };
    const message = await service.recordInbound(tenantA, input);
    expect(message.status).toBe('DELIVERED');
    expect((await service.recordInbound(tenantA, input)).id).toBe(message.id);
    expect(await service.isSuppressed(tenantA, contactA, 'SMS')).toBe(true);
    expect(await service.isSuppressed(tenantA, contactA, 'EMAIL')).toBe(false);
    expect(await service.isSuppressed(tenantB, contactA, 'SMS')).toBe(true);
    expect(await runtime.contactChannelPreference.findMany()).toHaveLength(0);
    expect(
      await withTenant(runtime, tenantB, (tx) => tx.contactChannelPreference.findMany()),
    ).toHaveLength(0);
    expect(await withTenant(runtime, tenantA, (tx) => tx.contactChannelPreference.count())).toBe(1);
    expect(
      await platform.auditLog.count({
        where: { tenantId: tenantA, action: 'contact.communication.opted_out' },
      }),
    ).toBe(1);
  });
});
