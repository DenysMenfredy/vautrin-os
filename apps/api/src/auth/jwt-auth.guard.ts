import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InvalidAccessTokenError, verifyAccessToken } from '@vautrin/auth';
import type { Environment } from '@vautrin/config';
import type { Request } from 'express';

import { ENVIRONMENT } from '../config/environment.module.js';
import type { AuthenticatedRequestContext } from './decorators/current-auth.decorator.js';
import { IS_PUBLIC } from './decorators/public.decorator.js';

/**
 * Verifies the access token on every request (ADR-013).
 *
 * Registered globally, so routes are authenticated unless they opt out with
 * @Public(). Deny-by-default matters more than the convenience: a
 * per-route guard is one you can forget to add, and forgetting fails open.
 *
 * Only the signature is checked — no database read. That is the trade ADR-013
 * makes: a revoked membership or a downgraded role stays valid for at most
 * the access-token lifetime.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly secret: Uint8Array;

  constructor(
    private readonly reflector: Reflector,
    @Inject(ENVIRONMENT) environment: Environment,
  ) {
    this.secret = new TextEncoder().encode(environment.JWT_SECRET);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { auth?: AuthenticatedRequestContext }>();

    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing access token.');
    }

    try {
      const claims = await verifyAccessToken(token, this.secret);

      request.auth = {
        userId: claims.sub,
        tenantId: claims.tid ?? null,
        role: claims.role ?? null,
        tokenId: claims.jti,
      };
      return true;
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        // One message for expired, forged and malformed alike.
        throw new UnauthorizedException('Invalid or expired access token.');
      }
      throw error;
    }
  }
}

function extractBearerToken(request: Request): string | undefined {
  const header = request.header('authorization');
  if (!header) return undefined;

  const [scheme, value] = header.split(' ');
  // Case-insensitive: RFC 7235 makes the scheme token case-insensitive.
  if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined;
  return value;
}
