import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@vautrin/auth';

/** Identity attached to a request by the authentication guard. */
export interface AuthenticatedRequestContext {
  readonly userId: string;
  /** Null when the user has not selected a tenant. */
  readonly tenantId: string | null;
  readonly role: Role | null;
  /** Access-token id, for correlating a request with the credential used. */
  readonly tokenId: string;
}

/** Injects the authenticated caller. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedRequestContext => {
    const request = context.switchToHttp().getRequest<{
      auth?: AuthenticatedRequestContext;
    }>();

    if (!request.auth) {
      // Only reachable if a handler asks for identity on a @Public route,
      // which is a wiring mistake rather than a client error.
      throw new Error(
        'CurrentAuth used on a route with no authenticated context. ' +
          'Remove @Public() or stop injecting CurrentAuth.',
      );
    }
    return request.auth;
  },
);

/**
 * Injects the active tenant id, guaranteed non-null.
 *
 * Use this in handlers that touch tenant data. The guard rejects the
 * request when no tenant is selected, so the handler never has to consider
 * the null case and cannot forget to.
 */
export const ActiveTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<{
      auth?: AuthenticatedRequestContext;
    }>();

    const tenantId = request.auth?.tenantId;
    if (!tenantId) {
      throw new Error(
        'ActiveTenant used on a route that does not require a tenant. ' +
          'Add @RequireTenant() or use CurrentAuth.',
      );
    }
    return tenantId;
  },
);
