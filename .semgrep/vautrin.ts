// Static-analysis fixtures only; never imported by an application.
// Semgrep's native rule tests consume the ruleid/ok annotations below.

export function unsafeTenantRead(database: Database) {
  // ruleid: vautrin-unscoped-database-access
  return database.unscoped.contact.findMany();
}

export function unsafeMembershipRead(database: Database) {
  // ruleid: vautrin-unscoped-database-access
  return database.unscoped.tenantUser.findMany();
}

export function globalReadNeedsReview(database: Database) {
  // Even global reads need explicit review, not a model-wide exemption.
  // ruleid: vautrin-unscoped-database-access
  return database.unscoped.user.findMany();
}

export function scopedTenantRead(database: Database, tenantId: string) {
  // ok: vautrin-unscoped-database-access
  return database.withTenant(tenantId, (tx) => tx.contact.findMany());
}

export function vulnerableProxy() {
  const path = getRouterParam('path');
  // ruleid: vautrin-nitro-proxy-tainted-path
  return proxyRequest(`http://api:3000/api/${path}`);
}

export function confinedProxy() {
  const base = new URL('http://api:3000/api/');
  const target = new URL(getRouterParam('path'), base);
  if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) {
    throw new Error('Invalid proxy target');
  }
  // ok: vautrin-nitro-proxy-tainted-path
  return proxyRequest(target.href);
}

interface Database {
  unscoped: {
    contact: { findMany(): Promise<unknown[]> };
    tenantUser: { findMany(): Promise<unknown[]> };
    user: { findMany(): Promise<unknown[]> };
  };
  withTenant<T>(tenantId: string, fn: (tx: Database['unscoped']) => Promise<T>): Promise<T>;
}

declare function getRouterParam(name: string): string;
declare function proxyRequest(target: string): Promise<void>;
