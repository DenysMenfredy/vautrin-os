import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/** The single error shape the API returns (AGENTS.md §8). */
export interface ErrorResponseBody {
  readonly statusCode: number;
  readonly error: string;
  readonly message: string | string[];
  readonly path: string;
  readonly timestamp: string;
  /** Ties a client-reported failure to server logs (SDD-10 §6). */
  readonly correlationId?: string;
  readonly code?: string;
  readonly missingFields?: readonly string[];
}

/**
 * Normalizes every error leaving the API.
 *
 * Two jobs, both required by AGENTS.md §8:
 *
 *   1. One response shape, so clients can parse failures without special
 *      cases per endpoint.
 *   2. Nothing internal escapes. An unexpected exception is logged with safe metadata
 *      and reported as a bare 500 — stack traces, driver errors and SQL
 *      fragments are exactly the details an attacker would like, and they are
 *      useless to a legitimate caller anyway.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const correlationId = readCorrelationId(request);

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const details =
        typeof payload === 'object' && payload !== null
          ? (payload as Record<string, unknown>)
          : null;
      const code = details?.code;
      const missingFields = details?.missingFields;

      response.status(status).json({
        statusCode: status,
        error: exception.name,
        message:
          typeof payload === 'string'
            ? payload
            : ((payload as { message?: string | string[] }).message ?? exception.message),
        path: request.originalUrl.split('?')[0] ?? request.path,
        timestamp: new Date().toISOString(),
        ...(typeof code === 'string' && /^BOOKING_[A-Z_]+$/.test(code) ? { code } : {}),
        ...(Array.isArray(missingFields) &&
        missingFields.every(
          (field) => typeof field === 'string' && /^(?:contact|lead)\.[a-zA-Z]+$/.test(field),
        )
          ? { missingFields }
          : {}),
        ...(correlationId ? { correlationId } : {}),
      } satisfies ErrorResponseBody);
      return;
    }

    this.logger.error({
      operation: 'http.exception',
      method: request.method,
      path: request.originalUrl.split('?')[0] ?? request.path,
      correlationId,
      error: exception instanceof Error ? exception.name : 'UnknownError',
    });

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'InternalServerError',
      message: 'An unexpected error occurred.',
      path: request.originalUrl.split('?')[0] ?? request.path,
      timestamp: new Date().toISOString(),
      ...(correlationId ? { correlationId } : {}),
    } satisfies ErrorResponseBody);
  }
}

/**
 * Reads a client-supplied correlation id, if it is one.
 *
 * The header is attacker-controlled and gets reflected into the response —
 * and, once structured logging lands (VOS-120), into log records. Echoing it
 * verbatim accepted 5 KB of arbitrary text, which is a log-injection and
 * response-amplification vector rather than a tracing aid.
 *
 * Only a UUID is accepted. Anything else is dropped rather than rejected:
 * a malformed trace header should not turn a working request into an error.
 */
function readCorrelationId(request: Request): string | undefined {
  const value = request.header('x-correlation-id');
  if (value === undefined) return undefined;

  return CORRELATION_ID_PATTERN.test(value) ? value : undefined;
}

const CORRELATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
