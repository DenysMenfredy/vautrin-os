-- Run as schema owner/DBA after creating the NOSUPERUSER NOBYPASSRLS role.
DO $$
DECLARE table_name text;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vautrin_platform_admin') THEN
    RETURN;
  END IF;
  GRANT USAGE ON SCHEMA public, app TO vautrin_platform_admin;
REVOKE SELECT ON public.users FROM vautrin_platform_admin;
REVOKE SELECT (password_hash) ON public.users FROM vautrin_platform_admin;
GRANT SELECT (id, email, name, status, created_at, updated_at, last_login_at, disabled_at, deleted_at)
  ON public.users TO vautrin_platform_admin;
GRANT SELECT ON public.tenants, public.tenant_users,
    public.platform_access,
    public.platform_sessions, public.platform_audit_logs TO vautrin_platform_admin;
REVOKE SELECT ON public.tenant_invitations, public.services FROM vautrin_platform_admin;
REVOKE SELECT (token_hash) ON public.tenant_invitations FROM vautrin_platform_admin;
GRANT SELECT (id, tenant_id, email, role, expires_at, accepted_at, revoked_at, invited_by, created_at, updated_at)
  ON public.tenant_invitations TO vautrin_platform_admin;
GRANT SELECT (id) ON public.services TO vautrin_platform_admin;
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
