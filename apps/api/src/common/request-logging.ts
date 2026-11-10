import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { PlatformPrincipal } from '@vautrin/contracts';
import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedRequestContext } from '../auth/decorators/current-auth.decorator.js';

const logger = new Logger('HTTP');
export function requestLogging(
  request: Request & { auth?: AuthenticatedRequestContext; platform?: PlatformPrincipal },
  response: Response,
  next: NextFunction,
): void {
  if (request.path === '/api/admin' || request.path.startsWith('/api/admin/'))
    response.setHeader('Cache-Control', 'no-store');
  const input = request.header('x-correlation-id');
  const correlationId =
    input && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input) ? input : randomUUID();
  request.headers['x-correlation-id'] = correlationId;
  response.setHeader('x-correlation-id', correlationId);
  const startedAt = performance.now();
  response.once('finish', () =>
    logger.log({
      operation: 'http.request',
      requestId: correlationId,
      correlationId,
      method: request.method,
      route: request.route?.path ?? request.path,
      status: response.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
      tenantId: request.auth?.tenantId ?? null,
      actorId: request.auth?.userId ?? request.platform?.userId ?? null,
      platformRole: request.platform?.platformRole ?? null,
    }),
  );
  next();
}
