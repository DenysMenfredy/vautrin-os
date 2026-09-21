import { describe, expect, it } from 'vitest';

import {
  CAPABILITIES,
  capabilitiesFor,
  type Role,
  roleHasAllCapabilities,
  roleHasCapability,
} from '../src/capabilities.js';

const ROLES: Role[] = ['READ_ONLY', 'STAFF', 'MANAGER', 'ADMIN', 'OWNER'];

describe('capability model', () => {
  it('grants no role a capability outside the declared set', () => {
    const declared = new Set<string>(CAPABILITIES);
    for (const role of ROLES) {
      for (const capability of capabilitiesFor(role)) {
        expect(declared.has(capability)).toBe(true);
      }
    }
  });

  it('is cumulative: each role is a superset of the one below', () => {
    for (let i = 1; i < ROLES.length; i += 1) {
      const lower = capabilitiesFor(ROLES[i - 1] as Role);
      const higher = capabilitiesFor(ROLES[i] as Role);
      for (const capability of lower) {
        expect(higher.has(capability)).toBe(true);
      }
    }
  });

  it('gives READ_ONLY no write capability at all', () => {
    for (const capability of capabilitiesFor('READ_ONLY')) {
      expect(capability.endsWith('.read')).toBe(true);
    }
  });

  it('reserves tenant deletion for the owner', () => {
    // SDD-05 §8 — deletion is irreversible and destroys customer data.
    expect(roleHasCapability('OWNER', 'tenant.delete')).toBe(true);
    for (const role of ROLES.filter((r) => r !== 'OWNER')) {
      expect(roleHasCapability(role, 'tenant.delete')).toBe(false);
    }
  });

  it('separates writing an estimate from approving one', () => {
    // SDD-09 §4 uses exactly this pair: a holder of estimate.write must not
    // automatically hold estimate.approve.
    expect(roleHasCapability('STAFF', 'estimate.write')).toBe(true);
    expect(roleHasCapability('STAFF', 'estimate.approve')).toBe(false);
    expect(roleHasCapability('MANAGER', 'estimate.approve')).toBe(true);
  });

  it('keeps configuration away from staff', () => {
    for (const capability of [
      'business.manage',
      'workflow.manage',
      'integration.manage',
      'audit.read',
    ] as const) {
      expect(roleHasCapability('STAFF', capability)).toBe(false);
      expect(roleHasCapability('ADMIN', capability)).toBe(true);
    }
  });

  it('requires ALL listed capabilities, not any', () => {
    // "any" semantics would quietly widen access on a handler that declares
    // two capabilities.
    expect(roleHasAllCapabilities('STAFF', ['lead.read', 'lead.write'])).toBe(true);
    expect(roleHasAllCapabilities('STAFF', ['lead.read', 'audit.read'])).toBe(false);
  });
});
