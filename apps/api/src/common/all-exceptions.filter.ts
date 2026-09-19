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
}

/**
 * Normalizes every error leaving the API.
 *
 * Two jobs, both required by AGENTS.md §8:
 *
 *   1. One response shape, so clients can parse failures without special
 *      cases per endpoint.
 *   2. Nothing internal escapes. An unexpected exception is logged in full
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
    const correlationId = request.header('x-correlation-id') ?? undefined;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      response.status(status).json({
        statusCode: status,
        error: exception.name,
        message:
          typeof payload === 'string'
            ? payload
            : ((payload as { message?: string | string[] }).message ?? exception.message),
        path: request.originalUrl,
        timestamp: new Date().toISOString(),
        ...(correlationId ? { correlationId } : {}),
      } satisfies ErrorResponseBody);
      return;
    }

    this.logger.error(
      `Unhandled exception on ${request.method} ${request.originalUrl}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'InternalServerError',
      message: 'An unexpected error occurred.',
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
      ...(correlationId ? { correlationId } : {}),
    } satisfies ErrorResponseBody);
  }
}
