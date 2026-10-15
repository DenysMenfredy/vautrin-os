import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedRequestContext } from '../auth/decorators/current-auth.decorator.js';

const logger = new Logger('HTTP');
export function requestLogging(
  request: Request & { auth?: AuthenticatedRequestContext },
  response: Response,
  next: NextFunction,
): void {
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
      actorId: request.auth?.userId ?? null,
    }),
  );
  next();
}
