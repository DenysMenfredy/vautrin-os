#!/usr/bin/env node
/**
 * Fails if a tenant-scoped Prisma model has no RLS policy (ADR-005).
 *
 * The migration itself ends with an equivalent check against the live
 * database, so this cannot ship unnoticed either way. The difference is
 * when you find out: this runs on the pull request, against the source,
 * with no database — so a reviewer sees the gap before it reaches an
 * environment.
 *
 * It compares two lists:
 *   1. models in schema.prisma that declare a `tenantId` field;
 *   2. tables named in the RLS migrations.
 *
 * Deliberately simple text matching rather than a Prisma AST parse: a
 * dependency-free script in CI is worth more than exactness here, and the
 * failure mode is a false positive that a human reads, not a silent pass.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA = 'packages/database/prisma/schema.prisma';
const MIGRATIONS = 'packages/database/prisma/migrations';

/**
 * Tables intentionally exempt, with the reason.
 *
 * `users` is a global identity (SDD-03 §1) and one person may belong to
 * several tenants (FR-002); authentication has to find a user by email
 * before any tenant is known, so a tenant policy there would break login.
 * Tenant-scoped access to people goes through tenant_users, which is
 * protected.
 */
const EXEMPT = new Set(['users']);

function fail(message) {
  console.error(`\u001b[31m✖\u001b[0m ${message}`);
  process.exitCode = 1;
}

// --- 1. tenant-scoped models in the schema --------------------------------
const schema = readFileSync(SCHEMA, 'utf8');
const tenantScoped = new Map(); // table name -> model name

for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  const [, model, body] = match;

  const hasTenantId = /^\s*tenantId\s/m.test(body);
  if (!hasTenantId) continue;

  const mapped = body.match(/@@map\("([^"]+)"\)/);
  const table = mapped ? mapped[1] : model;
  tenantScoped.set(table, model);
}

if (tenantScoped.size === 0) {
  fail(`No tenant-scoped models found in ${SCHEMA}. The check is misconfigured.`);
  process.exit(1);
}

// --- 2. tables covered by an RLS policy -----------------------------------
const covered = new Set();

for (const dir of readdirSync(MIGRATIONS).sort()) {
  const path = join(MIGRATIONS, dir, 'migration.sql');
  let sql;
  try {
    sql = readFileSync(path, 'utf8');
  } catch {
    continue; // not a migration directory
  }

  // Tables listed in the tenant_scoped_tables array.
  const listed = sql.match(/tenant_scoped_tables\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/);
  if (listed) {
    for (const entry of listed[1].matchAll(/'([a-z_]+)'/g)) covered.add(entry[1]);
  }

  // Tables given a policy directly.
  for (const entry of sql.matchAll(/CREATE\s+POLICY\s+\w+\s+ON\s+(?:public\.)?(\w+)/gi)) {
    covered.add(entry[1]);
  }
}

// --- 3. compare -----------------------------------------------------------
const missing = [...tenantScoped.keys()]
  .filter((table) => !covered.has(table) && !EXEMPT.has(table))
  .sort();

if (missing.length > 0) {
  for (const table of missing) {
    fail(
      `Model ${tenantScoped.get(table)} (table "${table}") has tenant_id but no RLS policy. ` +
        'Add it to tenant_scoped_tables in a migration (ADR-005).',
    );
  }
  process.exit(1);
}

console.log(
  `\u001b[32m✔\u001b[0m ${tenantScoped.size} tenant-scoped tables, all covered by an RLS policy.`,
);
