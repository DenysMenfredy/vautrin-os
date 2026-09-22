import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { type Capability, roleHasCapability } from '@vautrin/auth';

import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedRequestContext } from '../auth/decorators/current-auth.decorator.js';

const ENTITY_CAPABILITIES = {
  CONTACT: { read: 'contact.read', write: 'contact.write' },
  LEAD: { read: 'lead.read', write: 'lead.write' },
  ESTIMATE: { read: 'estimate.read', write: 'estimate.write' },
} as const satisfies Record<string, { read: Capability; write: Capability }>;

/** Applies the owning CRM entity's existing capability to custom-field values. */
@Injectable()
export class CustomFieldValueCapabilityGuard implements CanActivate {
  constructor(private readonly audit: AuditService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      auth?: AuthenticatedRequestContext;
      method: string;
      originalUrl: string;
      params: { entityType?: string };
    }>();
    const auth = request.auth;
    if (!auth?.tenantId || !auth.role) {
      throw new ForbiddenException('An active tenant is required.');
    }

    const entityType = request.params.entityType;
    if (!entityType || !Object.hasOwn(ENTITY_CAPABILITIES, entityType)) {
      throw new BadRequestException('entityType must be CONTACT, LEAD, or ESTIMATE.');
    }

    const capabilities = ENTITY_CAPABILITIES[entityType as keyof typeof ENTITY_CAPABILITIES];
    const capability = request.method === 'GET' ? capabilities.read : capabilities.write;
    if (roleHasCapability(auth.role, capability)) return true;

    await this.audit.recordAccessDenied({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: `authz.denied:${capability}`,
      resourceType: `${request.method} ${request.originalUrl}`,
    });
    throw new ForbiddenException(`Requires capability: ${capability}`);
  }
}
