-- Keep the platform login separated from credential and invitation digests.
-- The first control-plane migration granted table reads for the initial API
-- implementation; the application now verifies passwords through the normal
-- identity store and issues invitations without selecting token hashes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vautrin_platform_admin') THEN
    RETURN;
  END IF;

  REVOKE SELECT ON public.users FROM vautrin_platform_admin;
  REVOKE SELECT (password_hash) ON public.users FROM vautrin_platform_admin;
  GRANT SELECT (id, email, name, status, created_at, updated_at, last_login_at, disabled_at, deleted_at)
    ON public.users TO vautrin_platform_admin;

  REVOKE SELECT ON public.tenant_invitations, public.services FROM vautrin_platform_admin;
  REVOKE SELECT (token_hash) ON public.tenant_invitations FROM vautrin_platform_admin;
  GRANT SELECT (id, tenant_id, email, role, expires_at, accepted_at, revoked_at, invited_by, created_at, updated_at)
    ON public.tenant_invitations TO vautrin_platform_admin;
  GRANT SELECT (id) ON public.services TO vautrin_platform_admin;
END $$;

-- Rollback: GRANT SELECT ON public.users, public.tenant_invitations,
-- public.services TO vautrin_platform_admin. This restores the previous reads.
