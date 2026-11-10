import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformPermission, PlatformPrincipal } from '@vautrin/contracts';
import type { Request } from 'express';
import { ADMIN_COOKIE, PlatformAuthService } from './platform-auth.service.js';
import { platformError, requirePlatformPermission } from './platform-policy.js';

const ANONYMOUS = 'platform.anonymous';
const PERMISSION = 'platform.permission';
export const PlatformAnonymous = () => SetMetadata(ANONYMOUS, true);
export const RequiresPlatform = (permission: PlatformPermission) =>
  SetMetadata(PERMISSION, permission);
export type PlatformRequest = Request & { platform?: PlatformPrincipal };
export const CurrentPlatform = createParamDecorator(
  (_value: unknown, context: ExecutionContext): PlatformPrincipal => {
    const principal = context.switchToHttp().getRequest<PlatformRequest>().platform;
    if (!principal)
      platformError('PLATFORM_ACCESS_REQUIRED', 'A platform-admin session is required.', 401);
    return principal;
  },
);
export function adminCookie(request: Request): string | undefined {
  return request
    .header('cookie')
    ?.split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${ADMIN_COOKIE}=`))
    ?.slice(ADMIN_COOKIE.length + 1);
}
@Injectable()
export class PlatformGuard implements CanActivate {
  private readonly logger = new Logger(PlatformGuard.name);
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: PlatformAuthService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PlatformRequest>();
    try {
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        request.header('origin') !== this.auth.environment.ADMIN_BASE_URL
      ) {
        platformError('PLATFORM_PERMISSION_DENIED', 'Untrusted admin request origin.', 403);
      }
      if (
        this.reflector.getAllAndOverride<boolean>(ANONYMOUS, [
          context.getHandler(),
          context.getClass(),
        ])
      )
        return true;
      const principal = await this.auth.authenticate(adminCookie(request));
      request.platform = principal;
      requirePlatformPermission(
        principal.platformRole,
        this.reflector.getAllAndOverride<PlatformPermission>(PERMISSION, [
          context.getHandler(),
          context.getClass(),
        ]) ?? 'read',
      );
      return true;
    } catch (error) {
      this.logger.warn({
        operation: 'platform.authorization',
        requestId: request.header('x-correlation-id'),
        platformActorUserId: request.platform?.userId,
        platformRole: request.platform?.platformRole,
        outcome: 'DENIED',
      });
      throw error;
    }
  }
}
