import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Capability, roleHasAllCapabilities } from '@vautrin/auth';

import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedRequestContext } from '../auth/decorators/current-auth.decorator.js';
import { REQUIRED_CAPABILITIES, REQUIRES_TENANT } from './capability.decorator.js';

/**
 * Enforces capability requirements (ADR-011, SDD-09 §3).
 *
 * Runs after JwtAuthGuard, so identity is already resolved. Checks are
 * against capabilities rather than roles, which is what lets roles change
 * later without touching every handler.
 *
 * A denial is audited: SDD-09 §10 requires auditing authorization, and a
 * run of denials is how privilege probing looks.
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Capability[]>(REQUIRED_CAPABILITIES, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiresTenant =
      this.reflector.getAllAndOverride<boolean>(REQUIRES_TENANT, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;

    if (!required?.length && !requiresTenant) return true;

    const request = context.switchToHttp().getRequest<{
      auth?: AuthenticatedRequestContext;
      method: string;
      originalUrl: string;
    }>();
    const auth = request.auth;

    if (!auth) return false; // JwtAuthGuard should already have rejected this.

    if (!auth.tenantId || !auth.role) {
      // Authenticated but no tenant selected. 403 rather than 401: the
      // credential is fine, the request just needs a tenant first.
      throw new ForbiddenException(
        'No active tenant. Select one with POST /auth/tenant before calling this endpoint.',
      );
    }

    if (required?.length && !roleHasAllCapabilities(auth.role, required)) {
      await this.audit.recordAccessDenied({
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: `authz.denied:${required.join(',')}`,
        resourceType: `${request.method} ${request.originalUrl}`,
      });

      // Names the capability, not the role. Telling a caller what they need
      // is useful; telling them what they are is not.
      throw new ForbiddenException(`Requires capability: ${required.join(', ')}`);
    }

    return true;
  }
}
