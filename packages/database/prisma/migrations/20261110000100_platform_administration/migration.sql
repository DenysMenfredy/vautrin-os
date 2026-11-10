-- ADR-017/018: explicit control-plane authorization, never tenant-role escalation.
ALTER TYPE public.tenant_status ADD VALUE IF NOT EXISTS 'ARCHIVED';
CREATE TYPE public.platform_role AS ENUM ('SUPER_ADMIN', 'OPERATOR', 'SUPPORT_READ_ONLY');
CREATE TYPE public.platform_access_status AS ENUM ('ACTIVE', 'SUSPENDED');
ALTER TABLE public.users ADD COLUMN disabled_at timestamptz(6);
CREATE INDEX users_created_at_id_idx ON public.users(created_at, id);
CREATE INDEX users_status_created_at_idx ON public.users(status, created_at);
CREATE INDEX tenants_created_at_id_idx ON public.tenants(created_at, id);
CREATE INDEX tenants_status_created_at_idx ON public.tenants(status, created_at);

CREATE TABLE public.platform_access (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE RESTRICT,
  role public.platform_role NOT NULL,
  status public.platform_access_status NOT NULL DEFAULT 'ACTIVE',
  created_by_user_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL
);
CREATE INDEX platform_access_role_status_idx ON public.platform_access(role, status);
CREATE TABLE public.platform_sessions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  audience text NOT NULL DEFAULT 'platform-admin' CHECK (audience = 'platform-admin'),
  expires_at timestamptz(6) NOT NULL,
  revoked_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX platform_sessions_user_id_revoked_at_idx ON public.platform_sessions(user_id, revoked_at);
CREATE INDEX platform_sessions_expires_at_idx ON public.platform_sessions(expires_at);
CREATE TABLE public.platform_audit_logs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  actor_user_id uuid NOT NULL,
  actor_role public.platform_role NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  tenant_id uuid,
  reason text,
  request_id uuid,
  correlation_id uuid,
  idempotency_key uuid,
  outcome text NOT NULL DEFAULT 'SUCCESS',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(actor_user_id, idempotency_key)
);
CREATE INDEX platform_audit_logs_actor_user_id_created_at_idx ON public.platform_audit_logs(actor_user_id, created_at);
CREATE INDEX platform_audit_logs_target_type_target_id_created_at_idx ON public.platform_audit_logs(target_type, target_id, created_at);
CREATE INDEX platform_audit_logs_tenant_id_created_at_idx ON public.platform_audit_logs(tenant_id, created_at);
CREATE INDEX platform_audit_logs_created_at_id_idx ON public.platform_audit_logs(created_at, id);

ALTER TABLE public.platform_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_access FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_audit_logs FORCE ROW LEVEL SECURITY;
-- No policy/grant to vautrin_app, including the inherited default privileges.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['platform_access','platform_sessions','platform_audit_logs'] LOOP
    EXECUTE format('CREATE POLICY schema_maintenance ON public.%I TO %I USING (true) WITH CHECK (true)', table_name, current_user);
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'vautrin_app') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM vautrin_app', table_name);
    END IF;
  END LOOP;
END $$;

-- Provision the LOGIN role separately through DBA/bootstrap, not migration credentials.
-- Re-running infra/scripts/platform-db-grants.sql supports existing installations.
-- Run as schema owner/DBA after creating the NOSUPERUSER NOBYPASSRLS role.
DO $$
DECLARE table_name text;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vautrin_platform_admin') THEN
    RETURN;
  END IF;
  GRANT USAGE ON SCHEMA public, app TO vautrin_platform_admin;
  GRANT SELECT ON public.users, public.tenants, public.tenant_users,
    public.tenant_invitations, public.services, public.platform_access,
    public.platform_sessions, public.platform_audit_logs TO vautrin_platform_admin;
  GRANT SELECT (id, tenant_id, display_name, timezone, locale, currency)
    ON public.business_profiles TO vautrin_platform_admin;
  GRANT SELECT (id, user_id, expires_at, revoked_at, active_tenant_id)
    ON public.refresh_tokens TO vautrin_platform_admin;
  GRANT UPDATE (name, status, disabled_at, deleted_at, updated_at, last_login_at)
    ON public.users TO vautrin_platform_admin;
  GRANT INSERT ON public.tenants, public.tenant_users, public.tenant_invitations,
    public.business_profiles, public.services, public.audit_logs,
    public.platform_access, public.platform_sessions, public.platform_audit_logs TO vautrin_platform_admin;
  GRANT UPDATE (name, slug, vertical, status, deleted_at, updated_at)
    ON public.tenants TO vautrin_platform_admin;
  GRANT UPDATE (role, status, updated_at) ON public.tenant_users TO vautrin_platform_admin;
  GRANT UPDATE (revoked_at, updated_at) ON public.tenant_invitations TO vautrin_platform_admin;
  GRANT UPDATE (display_name, timezone, updated_at) ON public.business_profiles TO vautrin_platform_admin;
  GRANT UPDATE (revoked_at, revoked_reason) ON public.refresh_tokens TO vautrin_platform_admin;
  GRANT UPDATE ON public.platform_access, public.platform_sessions TO vautrin_platform_admin;
  -- Audit is append-only. No DELETE, ownership, DDL, provider tables or secret access.
  REVOKE UPDATE, DELETE, TRUNCATE ON public.platform_audit_logs FROM vautrin_platform_admin;
  FOREACH table_name IN ARRAY ARRAY['tenants','tenant_users','tenant_invitations','business_profiles','services','platform_access','platform_sessions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS platform_control_plane ON public.%I', table_name);
    EXECUTE format('CREATE POLICY platform_control_plane ON public.%I TO vautrin_platform_admin USING (true) WITH CHECK (true)', table_name);
  END LOOP;
  DROP POLICY IF EXISTS platform_audit_read ON public.platform_audit_logs;
  CREATE POLICY platform_audit_read ON public.platform_audit_logs FOR SELECT TO vautrin_platform_admin USING (true);
  DROP POLICY IF EXISTS platform_audit_append ON public.platform_audit_logs;
  CREATE POLICY platform_audit_append ON public.platform_audit_logs FOR INSERT TO vautrin_platform_admin WITH CHECK (true);
  DROP POLICY IF EXISTS platform_tenant_audit_append ON public.audit_logs;
  CREATE POLICY platform_tenant_audit_append ON public.audit_logs FOR INSERT TO vautrin_platform_admin WITH CHECK (true);
END $$;

-- Inactive tenant automation cannot read/write business data as the tenant role.
-- This is SECURITY INVOKER; it cannot reveal other tenants through RLS.
CREATE FUNCTION app.tenant_is_active(target_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM public.tenants WHERE id = target_tenant AND status = 'ACTIVE' AND deleted_at IS NULL);
$$;
REVOKE ALL ON FUNCTION app.tenant_is_active(uuid) FROM PUBLIC;
DO $$
DECLARE table_name text;
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'vautrin_app') THEN
    GRANT EXECUTE ON FUNCTION app.tenant_is_active(uuid) TO vautrin_app;
    FOR table_name IN
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE n.nspname='public' AND c.relkind='r' AND a.attname='tenant_id'
      AND NOT a.attisdropped AND c.relname NOT IN ('tenant_users','tenant_invitations','audit_logs','platform_audit_logs')
    LOOP
      EXECUTE format('CREATE POLICY active_tenant_lifecycle ON public.%I AS RESTRICTIVE TO vautrin_app USING (app.tenant_is_active(tenant_id)) WITH CHECK (app.tenant_is_active(tenant_id))', table_name);
    END LOOP;
  END IF;
END $$;
-- Rollback: restore any archived tenants to the desired pre-upgrade status;
-- drop active_tenant_lifecycle policies/function, then platform tables/types/indexes
-- and users.disabled_at. PostgreSQL enum labels require a replacement type to remove.
