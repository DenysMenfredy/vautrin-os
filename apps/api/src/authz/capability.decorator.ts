import { SetMetadata } from '@nestjs/common';
import type { Capability } from '@vautrin/auth';

export const REQUIRED_CAPABILITIES = 'vautrin:capabilities';
export const REQUIRES_TENANT = 'vautrin:requiresTenant';

/**
 * Declares the capabilities a handler needs (ADR-011, SDD-09 §3).
 *
 * ALL listed capabilities are required, not any of them. Requiring a
 * capability implies an active tenant, since capabilities come from a
 * membership role — so this also marks the route as tenant-scoped.
 */
export const RequireCapability = (...capabilities: Capability[]) =>
  SetMetadata(REQUIRED_CAPABILITIES, capabilities);

/**
 * Requires an active tenant without requiring a specific capability.
 *
 * For routes any member may call, such as listing one's own tenant.
 */
export const RequireTenant = () => SetMetadata(REQUIRES_TENANT, true);
