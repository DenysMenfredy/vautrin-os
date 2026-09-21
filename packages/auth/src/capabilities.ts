/**
 * The capability model (ADR-011, SDD-09 §3).
 *
 * Roles are a convenience for assigning capabilities; **authorization checks
 * are always against a capability**, never a role. ADR-011 chose this so
 * roles can be customised later without rewriting every check, and so AI
 * agents can reuse the same vocabulary — SDD-09 §4 relies on a user holding
 * `estimate.write` while an agent does not hold `estimate.approve`.
 */

/** Every capability the platform recognises. */
export const CAPABILITIES = [
  // CRM
  'contact.read',
  'contact.write',
  'lead.read',
  'lead.write',
  'lead.assign',

  // Scheduling and sales
  'appointment.read',
  'appointment.write',
  'estimate.read',
  'estimate.write',
  /**
   * Deliberately separate from estimate.write. SDD-09 §6 treats changing a
   * total as high-impact, and SDD-09 §4 uses exactly this pair to show an
   * agent holding one capability without the other.
   */
  'estimate.approve',

  // Conversations
  'conversation.read',
  'conversation.write',

  // Configuration
  'business.read',
  'business.manage',
  'workflow.read',
  'workflow.manage',
  'integration.manage',
  'knowledge.read',
  'knowledge.manage',

  // Administration
  'member.read',
  'member.manage',
  'audit.read',
  /** Destructive and irreversible; owner only (SDD-05 §8). */
  'tenant.delete',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Roles from ADR-011. Mirrors the TenantRole enum in the database. */
export type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'STAFF' | 'READ_ONLY';

const READ_ONLY: readonly Capability[] = [
  'contact.read',
  'lead.read',
  'appointment.read',
  'estimate.read',
  'conversation.read',
  'business.read',
  'workflow.read',
  'knowledge.read',
];

/** Day-to-day operator: works leads and customers, changes no configuration. */
const STAFF: readonly Capability[] = [
  ...READ_ONLY,
  'contact.write',
  'lead.write',
  'appointment.write',
  'estimate.write',
  'conversation.write',
];

/** Runs the sales floor: can reassign work and approve an estimate. */
const MANAGER: readonly Capability[] = [...STAFF, 'lead.assign', 'estimate.approve', 'member.read'];

/** Configures the business, but cannot delete the tenant. */
const ADMIN: readonly Capability[] = [
  ...MANAGER,
  'business.manage',
  'workflow.manage',
  'integration.manage',
  'knowledge.manage',
  'member.manage',
  'audit.read',
];

const OWNER: readonly Capability[] = [...ADMIN, 'tenant.delete'];

/**
 * Role to capability mapping.
 *
 * Cumulative by design — each role is the previous one plus more — which
 * keeps the model easy to reason about. If a future vertical needs a role
 * that is not a superset of a lesser one, this becomes an explicit list
 * rather than a chain, and that is a deliberate change, not a refactor.
 */
const ROLE_CAPABILITIES: Readonly<Record<Role, readonly Capability[]>> = {
  READ_ONLY,
  STAFF,
  MANAGER,
  ADMIN,
  OWNER,
};

/** Capabilities granted by a role. */
export function capabilitiesFor(role: Role): ReadonlySet<Capability> {
  return new Set(ROLE_CAPABILITIES[role]);
}

/** Whether a role grants a capability. */
export function roleHasCapability(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

/**
 * Whether a role grants every listed capability.
 *
 * `every`, not `some`: a handler declaring two capabilities needs both, and
 * defaulting to "any" would quietly widen access.
 */
export function roleHasAllCapabilities(role: Role, capabilities: readonly Capability[]): boolean {
  return capabilities.every((capability) => roleHasCapability(role, capability));
}
