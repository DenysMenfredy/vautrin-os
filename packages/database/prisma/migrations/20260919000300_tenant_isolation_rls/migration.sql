-- ---------------------------------------------------------------------------
-- Tenant isolation via Row Level Security
--
-- ADR-005: "Application-only tenant filtering is vulnerable to accidental
-- omissions." RLS is the second line of defence behind application-level
-- tenant scoping, not a replacement for it.
--
-- Three things have to be true for this to actually protect anything:
--
--   1. ENABLE ROW LEVEL SECURITY   — policies are evaluated at all.
--   2. FORCE ROW LEVEL SECURITY    — the table OWNER is subject to them too.
--                                    Without FORCE, whoever owns the table
--                                    silently bypasses every policy.
--   3. The runtime role is neither the owner nor BYPASSRLS.
--      That is vautrin_app; see infra/postgres/initdb/01-roles.sql.
--
-- The active tenant comes from app.current_tenant_id(), which reads the
-- transaction-local `app.tenant_id` setting and returns NULL when unset.
-- A NULL comparison yields NULL, not true, so a query with no tenant context
-- sees zero rows rather than every row.
--
-- Note on `users`: it is deliberately global (SDD-03 §1 — "a human identity",
-- FR-002 — one user may belong to several tenants). Authentication has to
-- find a user by email before any tenant is known, so a tenant policy there
-- would break login. Tenant-scoped access to people goes through
-- tenant_users, which IS protected below.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Table privileges for the runtime role.
--
-- DML only: vautrin_app can read and write rows but cannot alter the schema.
-- Sequence grants are included for completeness; the schema currently uses
-- uuidv7() defaults rather than sequences.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vautrin_app') THEN
    RAISE NOTICE 'Role vautrin_app not found; skipping runtime grants.';
    RETURN;
  END IF;

  GRANT USAGE ON SCHEMA public TO vautrin_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vautrin_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vautrin_app;

  -- Tables added by later migrations inherit the same grants automatically,
  -- so a new table cannot silently become unreadable by the application.
  -- (It still needs its own RLS policy — see the guard in section 3.)
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vautrin_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO vautrin_app;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Policies on every tenant-scoped table.
--
-- Applied in a loop so the list is explicit and auditable in one place, and
-- so a typo cannot leave one table quietly unprotected.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tenant_scoped_table text;
  tenant_scoped_tables text[] := ARRAY[
    'tenant_users',
    'business_profiles',
    'locations',
    'contacts',
    'leads',
    'lead_sources',
    'conversations',
    'messages',
    'calls',
    'appointments',
    'estimates',
    'workflows',
    'workflow_runs',
    'workflow_step_runs',
    'agents',
    'agent_runs',
    'tool_executions',
    'knowledge_documents',
    'knowledge_chunks',
    'integrations',
    'events',
    'audit_logs',
    'custom_field_definitions',
    'custom_field_values'
  ];
BEGIN
  FOREACH tenant_scoped_table IN ARRAY tenant_scoped_tables LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tenant_scoped_table
    );
    EXECUTE format(
      'ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tenant_scoped_table
    );

    -- USING governs which existing rows are visible to SELECT/UPDATE/DELETE.
    -- WITH CHECK governs which rows INSERT/UPDATE may produce. Both are
    -- required: without WITH CHECK a tenant could write a row stamped with
    -- somebody else's tenant_id.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I
         USING (tenant_id = app.current_tenant_id())
         WITH CHECK (tenant_id = app.current_tenant_id())',
      tenant_scoped_table
    );
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. The tenants table itself.
--
-- Not tenant_id-scoped — it IS the tenant — so the policy matches on the
-- primary key instead. Tenant provisioning and the tenant-deletion lifecycle
-- (SDD-05 §8) run through the privileged migration/admin role, outside this
-- policy.
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.tenants
  USING (id = app.current_tenant_id())
  WITH CHECK (id = app.current_tenant_id());

-- ---------------------------------------------------------------------------
-- 4. Guard against future drift.
--
-- A new tenant-scoped table added later is the single most likely way this
-- protection regresses. This check fails the migration if any table carrying
-- a tenant_id column is missing RLS, so the mistake surfaces at deploy time
-- rather than as a cross-tenant read in production.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  unprotected text[];
BEGIN
  SELECT array_agg(c.relname ORDER BY c.relname)
    INTO unprotected
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND a.attname = 'tenant_id'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity);

  IF unprotected IS NOT NULL THEN
    RAISE EXCEPTION
      'Tables with tenant_id lack ENABLE+FORCE row level security: %', unprotected
      USING HINT = 'Add the table to the tenant_scoped_tables list in a migration (ADR-005).';
  END IF;
END
$$;
