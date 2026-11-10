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
import { DatabaseService } from '../database/database.service.js';
import type { AuthenticatedRequestContext } from './decorators/current-auth.decorator.js';
import { IS_PUBLIC } from './decorators/public.decorator.js';

/**
 * Verifies the tenant access token and current account/membership state on
 * every request (ADR-013 amended by the platform-admin control plane).
 *
 * Registered globally, so routes are authenticated unless they opt out with
 * @Public(). Deny-by-default matters more than the convenience: a
 * per-route guard is one you can forget to add, and forgetting fails open.
 *
 * The token signature proves which identity and tenant were issued; live
 * database checks make administrative disable, membership revocation, and
 * tenant suspension take effect before the short-lived token expires.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly secret: Uint8Array;

  constructor(
    private readonly reflector: Reflector,
    private readonly database: DatabaseService,
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

      // Administrative account and membership changes take effect immediately.
      // This global identity read never supplies a tenant authorization decision.
      // nosemgrep: semgrep.vautrin-unscoped-database-access
      const user = await this.database.unscoped.user.findUnique({
        where: { id: claims.sub },
        select: { status: true, deletedAt: true },
      });
      if (user?.status !== 'ACTIVE' || user.deletedAt)
        throw new UnauthorizedException('The account is no longer active.');
      if (claims.tid) {
        if (
          !claims.role ||
          !['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'READ_ONLY'].includes(claims.role)
        )
          throw new UnauthorizedException('Invalid tenant role.');
        const tenantId = claims.tid;
        const role = claims.role;
        const membership = await this.database.withUser(claims.sub, (tx) =>
          tx.tenantUser.findFirst({
            where: {
              userId: claims.sub,
              tenantId,
              role,
              status: 'ACTIVE',
              tenant: { status: 'ACTIVE', deletedAt: null },
            },
            select: { id: true },
          }),
        );
        if (!membership)
          throw new UnauthorizedException('The membership or tenant is no longer active.');
      }

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
