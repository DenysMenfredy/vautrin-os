import { ForbiddenException } from '@nestjs/common';
import type { Environment } from '@vautrin/config';
import type { Request } from 'express';

/**
 * Validates browser origins for cookie-authenticated state changes.
 *
 * Missing Origin is allowed for non-browser clients and same-origin requests
 * that do not carry the header. Configured origins are exact origin strings;
 * wildcards and paths are intentionally not supported.
 */
export function assertTrustedOrigin(request: Request, environment: Environment): void {
  const origin = request.header('origin');
  if (!origin) return;

  const trusted = environment.TRUSTED_ORIGINS.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (trusted.includes(origin)) return;

  throw new ForbiddenException('Untrusted request origin.');
}
