import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';

/**
 * Exercises the API over real HTTP against a real database (SDD-12 §5, §6).
 *
 * Deliberately not a mocked controller test: the things most likely to break
 * here — the global prefix, the exception filter, JSON serialisation — only
 * exist once the request goes through the actual HTTP stack.
 */
describe('health endpoints', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AllExceptionsFilter());

    // Port 0: let the OS pick a free port so the suite never collides with a
    // developer's running dev server.
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reports liveness without touching dependencies', async () => {
    const response = await fetch(`${baseUrl}/api/health/live`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { status: string; uptimeSeconds: number };
    expect(body.status).toBe('ok');
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('reports readiness with database latency', async () => {
    const response = await fetch(`${baseUrl}/api/health/ready`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      database: { status: string; latencyMs: number };
    };
    expect(body.status).toBe('ok');
    expect(body.database.status).toBe('up');
    expect(body.database.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns the shared error shape for an unknown route', async () => {
    const response = await fetch(`${baseUrl}/api/does-not-exist`);
    expect(response.status).toBe(404);

    const body = (await response.json()) as Record<string, unknown>;
    // AGENTS.md §8 — one consistent error contract.
    expect(body).toMatchObject({ statusCode: 404, path: '/api/does-not-exist' });
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('error');
  });

  it('echoes a correlation id so a client failure can be traced (SDD-10 §6)', async () => {
    const correlationId = crypto.randomUUID();
    const response = await fetch(`${baseUrl}/api/does-not-exist`, {
      headers: { 'x-correlation-id': correlationId },
    });

    const body = (await response.json()) as { correlationId?: string };
    expect(body.correlationId).toBe(correlationId);
  });
});
