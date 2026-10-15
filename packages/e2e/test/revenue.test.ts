import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getQueueToken } from '@nestjs/bullmq';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  createPlatformClient,
  createPrismaClient,
  type PrismaClient,
  withTenant,
} from '@vautrin/database';
import {
  GoogleCalendarProvider,
  GoogleOAuthTokenProvider,
  type LLMProvider,
  LLMProviderError,
  type LLMRequest,
  type LLMResponse,
  TwilioMessagingProvider,
} from '@vautrin/integrations';
import {
  QUEUE,
  SEND_MESSAGE_JOB,
  type SendMessageJob,
  sendMessageJobId,
  type WorkflowRunJob,
  workflowRunJobId,
} from '@vautrin/queues';
import { RECEPTIONIST_PROMPT_VERSION } from '@vautrin/revenue';
import type { Queue } from 'bullmq';
import twilio from 'twilio';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule as ApiModule } from '../../../apps/api/dist/app.module.js';
import { AllExceptionsFilter } from '../../../apps/api/dist/common/all-exceptions.filter.js';
import { TenantService } from '../../../apps/api/dist/tenant/tenant.service.js';
import { LLM_PROVIDER } from '../../../apps/worker/dist/agents/receptionist-runtime.js';
import { AppModule as WorkerModule } from '../../../apps/worker/dist/app.module.js';
import { OutboundMessageProcessor } from '../../../apps/worker/dist/messaging/outbound-message.processor.js';
import { DomainEventProcessor } from '../../../apps/worker/dist/outbox/domain-event.processor.js';
import { OutboxDispatcher } from '../../../apps/worker/dist/outbox/outbox-dispatcher.service.js';
import { WorkflowActionProcessor } from '../../../apps/worker/dist/workflows/workflow-action.processor.js';
import { WorkflowRunExecutor } from '../../../apps/worker/dist/workflows/workflow-run.executor.js';
import { WorkflowRunScheduler } from '../../../apps/worker/dist/workflows/workflow-run.scheduler.js';

let api: INestApplication;
let worker: TestingModule;
let platform: PrismaClient;
let database: PrismaClient;
let url = '';
let tenantA = '';
let tenantB = '';
let tokenA = '';
let tokenB = '';
let integrationId = '';
const evaluations = JSON.parse(
  readFileSync(new URL('../evals/receptionist-v1.json', import.meta.url), 'utf8'),
) as {
  promptVersion: string;
  cases: { id: string; mode: string; input: string; expected: string }[];
};
const suffix = randomUUID();
const traceId = randomUUID();
const password = 'synthetic e2e owner password';
const sender = '+15125550100';
const authToken = 'synthetic-webhook-auth-token';
const accountSid = `AC${'a'.repeat(32)}`;
const webhookBase = 'https://webhooks.example.test/api/webhooks/twilio/inbound/';
let counter = 0;
let inboundId = '';
let currentBody = '';
let chosenSlot = '';
let behavior:
  | 'normal'
  | 'human'
  | 'injection'
  | 'unavailable'
  | 'ambiguous'
  | 'outside'
  | 'unsupported'
  | 'provider_failure'
  | 'ungrounded' = 'normal';
const calendarEvents = new Map<string, { providerEventId: string; startsAt: Date; endsAt: Date }>();
const calendar = {
  getAvailability: vi.fn(() =>
    Promise.resolve({
      busy:
        behavior === 'unavailable'
          ? [{ startsAt: new Date('2000-01-01'), endsAt: new Date('2100-01-01') }]
          : [],
    }),
  ),
  findAppointment: vi.fn((input: { appointmentId: string }) =>
    Promise.resolve(calendarEvents.get(input.appointmentId) ?? null),
  ),
  createAppointment: vi.fn((input: { appointmentId: string; startsAt: Date; endsAt: Date }) => {
    const result = {
      providerEventId: `provider-${input.appointmentId}`,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    };
    calendarEvents.set(input.appointmentId, result);
    return Promise.resolve(result);
  }),
  rescheduleAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
};
const sendText = vi.fn(() =>
  Promise.resolve({
    provider: 'twilio',
    providerMessageId: `SM${(++counter).toString(16).padStart(32, '0')}`,
    status: 'SENT' as const,
  }),
);
function generateResponse(request: LLMRequest): LLMResponse {
  if (behavior === 'provider_failure') throw new LLMProviderError('llm_unavailable', true);
  const result = (name: string, input: unknown): LLMResponse => ({
    provider: 'openai',
    model: 'synthetic-model',
    content: null,
    finishReason: 'tool_calls',
    usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 2 },
    toolCalls: [{ id: `call-${counter++}`, name, input }],
  });
  if (request.messages[0]?.content.includes('Purpose: recovery'))
    return result('respond', { kind: 'recovery' });
  const outputs = request.messages
    .filter((message) => message.role === 'tool')
    .map((message) => JSON.parse(message.content) as Record<string, unknown>);
  if (behavior === 'injection') return result('delete_customer', { tenantId: tenantB });
  if (behavior === 'human')
    return outputs.length
      ? result('respond', { kind: 'handoff' })
      : result('human_handoff', { reason: 'customer_requested' });
  if (behavior === 'ungrounded') return result('respond', { kind: 'booked' });
  if (outputs.length === 0) {
    const answers = {
      serviceKey: behavior === 'unsupported' ? 'roofing' : 'kitchen-remodeling',
      propertyType: 'single-family',
      postalCode: behavior === 'outside' ? '99999' : '78701',
      budgetRange: '$40k',
      timeline: 'next month',
      description: 'new cabinets',
    };
    const partial = behavior === 'ambiguous' ? { serviceKey: answers.serviceKey } : answers;
    return result('qualify_lead', {
      answers: partial,
      evidence: Object.fromEntries(
        Object.keys(partial).map((field) => [field, { messageId: inboundId, quote: currentBody }]),
      ),
    });
  }
  const decision = outputs[0];
  if (
    decision?.disposition === 'OUTSIDE_SERVICE_AREA' ||
    decision?.disposition === 'UNSUPPORTED_SERVICE'
  )
    return outputs.length === 1
      ? result('human_handoff', {
          reason:
            decision.disposition === 'OUTSIDE_SERVICE_AREA'
              ? 'outside_service_area'
              : 'unsupported_service',
        })
      : result('respond', { kind: 'handoff' });
  if (behavior === 'ambiguous') return result('respond', { kind: 'ask', field: 'propertyType' });
  if (outputs.length === 1)
    return result('check_availability', {
      appointmentTypeId: 'consultation',
      from: chosenSlot,
      to: new Date(new Date(chosenSlot).getTime() + 3_600_000).toISOString(),
    });
  if (behavior === 'unavailable') return result('respond', { kind: 'offer_slots' });
  if (outputs.length === 2)
    return result('create_appointment', {
      appointmentTypeId: 'consultation',
      startsAt: chosenSlot,
      proofId: outputs[1]?.proofId,
      confirmation: { messageId: inboundId, quote: currentBody },
    });
  return result('respond', { kind: 'booked' });
}
const generate = vi.fn((request: LLMRequest): Promise<LLMResponse> => {
  try {
    return Promise.resolve(generateResponse(request));
  } catch (error) {
    return Promise.reject(error);
  }
});
const llm: LLMProvider = {
  generate,
  async *stream(request) {
    yield { type: 'completed', response: await generate(request) };
  },
};
function http(path: string, token: string, method = 'GET', body?: unknown) {
  return fetch(`${url}/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'x-correlation-id': traceId,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function tenantCall(phone: string) {
  const response = await http('/intake/missed-calls', tokenA, 'POST', {
    fromNumber: phone,
    idempotencyKey: randomUUID(),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as {
    callId: string;
    leadId: string;
    contactId: string;
    conversationId: string;
  };
}
async function consumeEvent(name: string, aggregateId: string) {
  const event = await withTenant(database, tenantA, (tx) =>
    tx.event.findFirstOrThrow({ where: { tenantId: tenantA, name, aggregateId } }),
  );
  const result = await worker
    .get(DomainEventProcessor)
    .handle({ tenantId: tenantA, eventId: event.id });
  const run = await withTenant(database, tenantA, (tx) =>
    tx.workflowRun.findFirst({ where: { tenantId: tenantA, triggerEventId: event.id } }),
  );
  return { result, event, run };
}
async function ingest(
  phone: string,
  body: string,
  sid = `SM${(++counter).toString(16).padStart(32, '0')}`,
) {
  const fields = { AccountSid: accountSid, MessageSid: sid, From: phone, To: sender, Body: body };
  const signature = twilio.getExpectedTwilioSignature(
    authToken,
    `${webhookBase}${integrationId}`,
    fields,
  );
  const response = await fetch(`${url}/api/webhooks/twilio/inbound/${integrationId}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signature,
    },
    body: new URLSearchParams(fields),
  });
  expect(response.status).toBe(204);
  const message = await withTenant(database, tenantA, (tx) =>
    tx.message.findFirstOrThrow({ where: { tenantId: tenantA, providerMessageId: sid } }),
  );
  inboundId = message.id;
  currentBody = body;
  return { message, fields, signature };
}
async function reply(phone: string, mode: typeof behavior, body: string) {
  behavior = mode;
  const entities = await tenantCall(phone);
  const { message } = await ingest(phone, body);
  const { run } = await consumeEvent('message.received', message.id);
  if (!run) throw new Error('Missing reply workflow.');
  await worker
    .get(WorkflowRunExecutor)
    .handle({ tenantId: tenantA, runId: run.id, action: 'start' });
  const job: WorkflowRunJob = {
    tenantId: tenantA,
    runId: run.id,
    stepId: 'qualify',
    action: 'execute',
  };
  await worker.get(WorkflowActionProcessor).handle(job);
  return { ...entities, runId: run.id, job };
}

beforeAll(async () => {
  expect(evaluations.promptVersion).toBe(RECEPTIONIST_PROMPT_VERSION);
  expect(evaluations.cases.length).toBeGreaterThanOrEqual(10);
  if (process.env.NODE_ENV !== 'test')
    throw new Error('E2E requires NODE_ENV=test and isolated PostgreSQL/Redis.');
  process.env.VAUTRIN_TWILIO_E2E = JSON.stringify({
    accountSid,
    apiKeySid: `SK${'b'.repeat(32)}`,
    apiKeySecret: 'synthetic-api-key',
    webhookAuthToken: authToken,
    messagingServiceSid: `MG${'c'.repeat(32)}`,
  });
  process.env.VAUTRIN_GOOGLE_CALENDAR_E2E = JSON.stringify({
    clientId: 'synthetic-client',
    clientSecret: 'synthetic-secret',
    refreshToken: 'synthetic-refresh',
  });
  const apiModule = await Test.createTestingModule({ imports: [ApiModule] }).compile();
  api = apiModule.createNestApplication({ logger: false });
  api.setGlobalPrefix('api');
  api.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  api.useGlobalFilters(new AllExceptionsFilter());
  await api.listen(0);
  url = await api.getUrl();
  const first = await api.get(TenantService).provision({
    slug: `e2e-a-${suffix}`,
    name: 'Synthetic Remodeling',
    owner: { email: `a-${suffix}@example.test`, password },
  });
  const second = await api.get(TenantService).provision({
    slug: `e2e-b-${suffix}`,
    name: 'Other Tenant',
    owner: { email: `b-${suffix}@example.test`, password },
  });
  tenantA = first.tenantId;
  tenantB = second.tenantId;
  for (const [letter, assign] of [
    [
      'a',
      (token: string) => {
        tokenA = token;
      },
    ],
    [
      'b',
      (token: string) => {
        tokenB = token;
      },
    ],
  ] as const) {
    const login = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${letter}-${suffix}@example.test`, password }),
    });
    expect(login.status).toBe(200);
    assign(((await login.json()) as { accessToken: string }).accessToken);
  }
  database = createPrismaClient();
  platform = createPlatformClient();
  const install = await http('/templates/remodeling', tokenA, 'POST', {
    postalCodes: ['78701'],
    timezone: 'America/New_York',
    model: 'synthetic-model',
    recoveryDelayMs: 1,
    followUpDelaysMs: [1, 1],
  });
  expect(install.status).toBe(201);
  integrationId = await withTenant(database, tenantA, async (tx) => {
    const id = randomUUID();
    await tx.integration.create({
      data: {
        id,
        tenantId: tenantA,
        provider: 'twilio',
        category: 'MESSAGING',
        status: 'CONNECTED',
        externalAccountId: accountSid,
        credentialsRef: 'env:VAUTRIN_TWILIO_E2E',
        configuration: {
          phoneNumber: sender,
          messagingServiceSid: `MG${'c'.repeat(32)}`,
          webhookUrl: `${webhookBase}${id}`,
        },
      },
    });
    await tx.integration.create({
      data: {
        tenantId: tenantA,
        provider: 'google_calendar',
        category: 'CALENDAR',
        status: 'CONNECTED',
        credentialsRef: 'env:VAUTRIN_GOOGLE_CALENDAR_E2E',
        configuration: { calendarId: 'synthetic-calendar' },
      },
    });
    return id;
  });
  worker = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(LLM_PROVIDER)
    .useValue(llm)
    .overrideProvider(GoogleCalendarProvider)
    .useValue(calendar)
    .overrideProvider(GoogleOAuthTokenProvider)
    .useValue({ accessToken: async () => 'synthetic-access' })
    .overrideProvider(TwilioMessagingProvider)
    .useValue({ sendText })
    .compile();
  // No background loops: drive persisted jobs deterministically while using real PostgreSQL/RLS/BullMQ.
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 2);
  date.setUTCHours(14, 0, 0, 0);
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
  chosenSlot = date.toISOString();
});
afterAll(async () => {
  if (worker)
    for (const name of Object.values(QUEUE)) {
      const queue = worker.get<Queue>(getQueueToken(name));
      const jobs = await queue.getJobs(['wait', 'delayed', 'completed', 'failed']);
      for (const job of jobs)
        if ([tenantA, tenantB].includes(String(job.data.tenantId))) await job.remove();
    }
  await worker?.close();
  await api?.close();
  await platform?.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await platform?.user.deleteMany({
    where: { email: { in: [`a-${suffix}@example.test`, `b-${suffix}@example.test`] } },
  });
  await platform?.$disconnect();
  await database?.$disconnect();
  delete process.env.VAUTRIN_TWILIO_E2E;
  delete process.env.VAUTRIN_GOOGLE_CALENDAR_E2E;
});

describe('v0.3 release gate', () => {
  it('runs missed call -> outbox -> BullMQ -> recovery -> signed reply -> qualification -> booking -> audit/telemetry idempotently', async () => {
    behavior = 'normal';
    const phone = '+15125550101';
    const key = randomUUID();
    const initial = await http('/intake/missed-calls', tokenA, 'POST', {
      fromNumber: phone,
      idempotencyKey: key,
    });
    const entities = (await initial.json()) as {
      callId: string;
      leadId: string;
      conversationId: string;
    };
    expect(initial.status).toBe(201);
    expect(
      await (
        await http('/intake/missed-calls', tokenA, 'POST', {
          fromNumber: phone,
          idempotencyKey: key,
        })
      ).json(),
    ).toEqual(entities);
    expect(
      (
        await http('/intake/missed-calls', tokenA, 'POST', {
          fromNumber: '+15125550102',
          idempotencyKey: key,
        })
      ).status,
    ).toBe(409);
    expect((await worker.get(OutboxDispatcher).dispatchOnce()).enqueued).toBeGreaterThan(0);
    const { run, event } = await consumeEvent('call.missed', entities.callId);
    if (!run) throw new Error('Recovery workflow missing.');
    expect(event.correlationId).toBe(traceId);
    expect(run.correlationId).toBe(traceId);
    expect(
      (await worker.get(DomainEventProcessor).handle({ tenantId: tenantA, eventId: event.id }))
        .replayed,
    ).toBe(1);
    await worker
      .get(WorkflowRunExecutor)
      .handle({ tenantId: tenantA, runId: run.id, action: 'start' });
    await forceWaitDue(run.id);
    await worker
      .get(WorkflowRunExecutor)
      .handle({ tenantId: tenantA, runId: run.id, action: 'wake', stepId: 'short_delay' });
    await worker.get(WorkflowRunScheduler).dispatchOnce();
    const action: WorkflowRunJob = {
      tenantId: tenantA,
      runId: run.id,
      action: 'execute',
      stepId: 'recover',
    };
    expect(
      await worker.get<Queue>(getQueueToken(QUEUE.AI)).getJob(workflowRunJobId(action)),
    ).toBeTruthy();
    await worker.get(WorkflowActionProcessor).handle(action);
    await worker.get(WorkflowActionProcessor).handle(action);
    const recovery = await withTenant(database, tenantA, (tx) =>
      tx.message.findFirstOrThrow({
        where: {
          tenantId: tenantA,
          conversationId: entities.conversationId,
          direction: 'OUTBOUND',
        },
      }),
    );
    expect(recovery.body).toContain('Synthetic Remodeling');
    await deliver(recovery.id);
    await deliver(recovery.id);
    expect(sendText).toHaveBeenCalledTimes(1);
    const { message } = await ingest(
      phone,
      `Kitchen remodeling for a single-family property in 78701. Budget $40k, next month, new cabinets. Yes, book ${chosenSlot}.`,
    );
    const { run: replyRun } = await consumeEvent('message.received', message.id);
    if (!replyRun) throw new Error('Reply workflow missing.');
    await worker
      .get(WorkflowRunExecutor)
      .handle({ tenantId: tenantA, runId: replyRun.id, action: 'start' });
    await worker
      .get(WorkflowActionProcessor)
      .handle({ tenantId: tenantA, runId: replyRun.id, action: 'execute', stepId: 'qualify' });
    await worker
      .get(WorkflowRunExecutor)
      .handle({ tenantId: tenantA, runId: replyRun.id, action: 'start' });
    const lead = await withTenant(database, tenantA, (tx) =>
      tx.lead.findFirstOrThrow({ where: { id: entities.leadId, tenantId: tenantA } }),
    );
    expect(lead.status).toBe('APPOINTMENT_BOOKED');
    expect(calendar.createAppointment).toHaveBeenCalledTimes(1);
    const count = await withTenant(database, tenantA, (tx) =>
      tx.appointment.count({ where: { tenantId: tenantA, leadId: lead.id } }),
    );
    expect(count).toBe(1);
    const metrics = (await (await http('/operations/summary', tokenA)).json()) as {
      agentRuns: number;
      inputTokens: number;
      bookedAppointments: number;
    };
    expect(metrics.agentRuns).toBeGreaterThanOrEqual(2);
    expect(metrics.inputTokens).toBeGreaterThan(0);
    expect(metrics.bookedAppointments).toBe(1);
    const audit = await withTenant(database, tenantA, (tx) =>
      tx.auditLog.findMany({ where: { tenantId: tenantA } }),
    );
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'call.missed.recorded',
        'agent.tool.executed',
        'appointment.created',
        'message.outbound.queued',
      ]),
    );
    await worker
      .get(WorkflowRunExecutor)
      .handle({ tenantId: tenantA, runId: run.id, action: 'start' });
    await forceWaitDue(run.id);
    await worker
      .get(WorkflowRunExecutor)
      .handle({ tenantId: tenantA, runId: run.id, action: 'wake', stepId: 'wait_0' });
    expect(
      await withTenant(database, tenantA, (tx) =>
        tx.message.count({
          where: {
            tenantId: tenantA,
            conversationId: entities.conversationId,
            direction: 'OUTBOUND',
          },
        }),
      ),
    ).toBe(2);
    const detail = await http(`/operations/runs/${replyRun.id}`, tokenB);
    expect(detail.status).toBe(404);
    expect((await http(`/operations/runs/${replyRun.id}/cancel`, tokenB, 'POST')).status).toBe(404);
    await expect(
      worker.get(DomainEventProcessor).handle({ tenantId: tenantB, eventId: event.id }),
    ).rejects.toThrow();
  });
  it('deduplicates signed inbound messages and rejects an invalid signature', async () => {
    const phone = '+15125550103';
    await tenantCall(phone);
    const first = await ingest(phone, 'Hello');
    await ingest(phone, 'Hello', first.fields.MessageSid);
    expect(
      await withTenant(database, tenantA, (tx) =>
        tx.event.count({
          where: { tenantId: tenantA, name: 'message.received', aggregateId: first.message.id },
        }),
      ),
    ).toBe(1);
    const response = await fetch(`${url}/api/webhooks/twilio/inbound/${integrationId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'invalid',
      },
      body: new URLSearchParams(first.fields),
    });
    expect(response.status).toBe(403);
  });
  it('suppresses opt-out before AI generation and cancels delayed work', async () => {
    const entities = await tenantCall('+15125550104');
    const { message } = await ingest('+15125550104', 'STOP');
    const { run } = await consumeEvent('message.received', message.id);
    if (!run) throw new Error('Run missing.');
    await worker
      .get(WorkflowRunExecutor)
      .handle({ tenantId: tenantA, runId: run.id, action: 'start' });
    const before = generate.mock.calls.length;
    await worker
      .get(WorkflowActionProcessor)
      .handle({ tenantId: tenantA, runId: run.id, action: 'execute', stepId: 'qualify' });
    expect(generate.mock.calls.length).toBe(before);
    expect(
      await withTenant(database, tenantA, (tx) =>
        tx.message.count({
          where: {
            tenantId: tenantA,
            conversationId: entities.conversationId,
            direction: 'OUTBOUND',
          },
        }),
      ),
    ).toBe(0);
    const missed = await consumeEvent('call.missed', entities.callId);
    if (!missed.run) throw new Error('Run missing.');
    await worker
      .get(WorkflowRunExecutor)
      .handle({ tenantId: tenantA, runId: missed.run.id, action: 'start' });
    expect((await http(`/operations/runs/${missed.run.id}/cancel`, tokenA, 'POST')).status).toBe(
      201,
    );
    expect(
      await worker
        .get(WorkflowRunExecutor)
        .handle({ tenantId: tenantA, runId: missed.run.id, action: 'wake', stepId: 'short_delay' }),
    ).toMatchObject({ result: 'ignored' });
  });
  it.each(
    evaluations.cases
      .filter((item) =>
        ['human', 'injection', 'ungrounded', 'outside', 'unsupported'].includes(item.id),
      )
      .map((item) => [item.mode as typeof behavior, item.input] as const),
  )('hands off safely for %s', async (mode, body) => {
    const phone = `+1512555${(110 + counter++).toString().padStart(4, '0')}`;
    const result = await reply(phone, mode, body);
    const conversation = await withTenant(database, tenantA, (tx) =>
      tx.conversation.findFirstOrThrow({ where: { tenantId: tenantA, id: result.conversationId } }),
    );
    expect(conversation.status).toBe('PENDING');
    expect(
      await withTenant(database, tenantA, (tx) =>
        tx.appointment.count({ where: { tenantId: tenantA, leadId: result.leadId } }),
      ),
    ).toBe(0);
  });
  it('asks for missing qualification facts and never books an unavailable slot', async () => {
    const ambiguous = await reply('+15125550105', 'ambiguous', 'I need kitchen remodeling.');
    expect(
      await withTenant(database, tenantA, (tx) =>
        tx.lead.findFirstOrThrow({ where: { id: ambiguous.leadId } }),
      ),
    ).toMatchObject({ status: 'NEW' });
    const unavailable = await reply(
      '+15125550106',
      'unavailable',
      'Kitchen remodeling for a single-family property in 78701. Budget $40k, next month, new cabinets.',
    );
    expect(
      await withTenant(database, tenantA, (tx) =>
        tx.message.findFirstOrThrow({
          where: {
            tenantId: tenantA,
            conversationId: unavailable.conversationId,
            direction: 'OUTBOUND',
          },
        }),
      ),
    ).toMatchObject({ body: expect.stringContaining('no available') });
  });
  it.each([
    [
      'no_confirmation',
      'Kitchen remodeling for a single-family property in 78701. Budget $40k, next month, new cabinets.',
    ],
    [
      'negative_confirmation',
      'Kitchen remodeling for a single-family property in 78701. Budget $40k, next month, new cabinets. No, do not book SLOT.',
    ],
  ])('rejects %s even when the model attempts a verified booking', async (_case, body) => {
    const entities = await reply(
      `+1512555${(250 + counter++).toString().padStart(4, '0')}`,
      'normal',
      body.replace('SLOT', chosenSlot),
    );
    expect(
      await withTenant(database, tenantA, (tx) =>
        tx.appointment.count({ where: { tenantId: tenantA, leadId: entities.leadId } }),
      ),
    ).toBe(0);
    expect(
      await withTenant(database, tenantA, (tx) =>
        tx.conversation.findFirstOrThrow({ where: { id: entities.conversationId } }),
      ),
    ).toMatchObject({ status: 'PENDING' });
  });
  it('cancels during generation before tools can mutate or queue a reply', async () => {
    const entities = await tenantCall('+15125550108');
    const { message } = await ingest('+15125550108', 'I need kitchen remodeling.');
    const { run } = await consumeEvent('message.received', message.id);
    if (!run) throw new Error('Run missing');
    await worker
      .get(WorkflowRunExecutor)
      .handle({ tenantId: tenantA, runId: run.id, action: 'start' });
    generate.mockImplementationOnce(async () => {
      expect((await http(`/operations/runs/${run.id}/cancel`, tokenA, 'POST')).status).toBe(201);
      return {
        provider: 'openai',
        model: 'synthetic-model',
        content: null,
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'cancelled-call',
            name: 'capture_contact',
            input: {
              firstName: 'Invented',
              evidence: { messageId: message.id, quote: 'I need kitchen remodeling.' },
            },
          },
        ],
      };
    });
    await worker
      .get(WorkflowActionProcessor)
      .handle({ tenantId: tenantA, runId: run.id, action: 'execute', stepId: 'qualify' });
    expect(
      await withTenant(database, tenantA, (tx) =>
        tx.message.count({
          where: { conversationId: entities.conversationId, direction: 'OUTBOUND' },
        }),
      ),
    ).toBe(0);
    expect(
      await withTenant(database, tenantA, (tx) =>
        tx.workflowRun.findFirstOrThrow({ where: { id: run.id } }),
      ),
    ).toMatchObject({ status: 'CANCELLED' });
  });
  it('suppresses queued recovery SMS when the operator cancels before provider acceptance', async () => {
    behavior = 'normal';
    const entities = await tenantCall('+15125550109');
    const { run } = await consumeEvent('call.missed', entities.callId);
    if (!run) throw new Error('Run missing');
    await worker
      .get(WorkflowRunExecutor)
      .handle({ tenantId: tenantA, runId: run.id, action: 'start' });
    await forceWaitDue(run.id);
    await worker
      .get(WorkflowRunExecutor)
      .handle({ tenantId: tenantA, runId: run.id, action: 'wake', stepId: 'short_delay' });
    await worker
      .get(WorkflowActionProcessor)
      .handle({ tenantId: tenantA, runId: run.id, action: 'execute', stepId: 'recover' });
    const queued = await withTenant(database, tenantA, (tx) =>
      tx.message.findFirstOrThrow({
        where: { conversationId: entities.conversationId, direction: 'OUTBOUND' },
      }),
    );
    expect((await http(`/operations/runs/${run.id}/cancel`, tokenA, 'POST')).status).toBe(201);
    const before = sendText.mock.calls.length;
    await deliver(queued.id);
    expect(sendText.mock.calls.length).toBe(before);
    expect(
      await withTenant(database, tenantA, (tx) =>
        tx.message.findFirstOrThrow({ where: { id: queued.id } }),
      ),
    ).toMatchObject({ status: 'FAILED', failureReason: 'workflow_cancelled' });
  });
  it('bounds provider retries and persists failure/handoff without repeating an external action', async () => {
    behavior = 'provider_failure';
    const entities = await tenantCall('+15125550107');
    const { message } = await ingest('+15125550107', 'Hello');
    const { run } = await consumeEvent('message.received', message.id);
    if (!run) throw new Error('Run missing.');
    await worker
      .get(WorkflowRunExecutor)
      .handle({ tenantId: tenantA, runId: run.id, action: 'start' });
    const job = { tenantId: tenantA, runId: run.id, action: 'execute' as const, stepId: 'qualify' };
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await worker.get(WorkflowActionProcessor).handle(job)).toMatchObject({
        result: 'retry_scheduled',
      });
      expect(
        await withTenant(database, tenantA, (tx) =>
          tx.workflowStepRun.findFirstOrThrow({
            where: { workflowRunId: run.id, stepId: 'qualify' },
          }),
        ),
      ).toMatchObject({ attempt: attempt + 2, status: 'SCHEDULED' });
      await forceWaitDue(run.id);
    }
    expect(await worker.get(WorkflowActionProcessor).handle(job)).toMatchObject({
      result: 'failed',
    });
    expect(
      await withTenant(database, tenantA, (tx) =>
        tx.workflowRun.findFirstOrThrow({ where: { id: run.id } }),
      ),
    ).toMatchObject({ status: 'FAILED', error: 'provider_retries_exhausted' });
    expect(
      await withTenant(database, tenantA, (tx) =>
        tx.conversation.findFirstOrThrow({ where: { id: entities.conversationId } }),
      ),
    ).toMatchObject({ status: 'PENDING' });
    expect(
      await withTenant(database, tenantA, (tx) =>
        tx.agentRun.count({ where: { tenantId: tenantA, workflowRunId: run.id } }),
      ),
    ).toBe(1);
  });
});
async function forceWaitDue(runId: string) {
  await withTenant(database, tenantA, async (tx) => {
    const due = new Date(Date.now() - 1_000);
    const run = await tx.workflowRun.findFirstOrThrow({ where: { tenantId: tenantA, id: runId } });
    await tx.workflowRun.update({ where: { id: runId }, data: { scheduledFor: due } });
    await tx.workflowStepRun.updateMany({
      where: {
        tenantId: tenantA,
        workflowRunId: runId,
        stepId: run.currentStepId ?? '',
        status: 'SCHEDULED',
      },
      data: { scheduledFor: due },
    });
  });
}
async function deliver(messageId: string) {
  await consumeEvent('message.send_requested', messageId);
  const queue = worker.get<Queue<SendMessageJob>>(getQueueToken(QUEUE.NOTIFICATIONS));
  const job = await queue.getJob(sendMessageJobId(messageId));
  if (!job) throw new Error('Outbound job missing.');
  expect(job.name).toBe(SEND_MESSAGE_JOB);
  await worker.get(OutboundMessageProcessor).process(job);
}
