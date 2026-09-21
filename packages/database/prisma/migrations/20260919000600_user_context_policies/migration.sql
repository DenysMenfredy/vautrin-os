-- ---------------------------------------------------------------------------
-- Reading your own memberships before a tenant is known
--
-- Authentication has a chicken-and-egg problem with RLS. SDD-05 §2 derives
-- the active tenant from "authenticated identity" plus "tenant membership",
-- so login must read `tenant_users` — but `tenant_users` is tenant-scoped,
-- and there is no tenant yet.
--
-- The tempting fix is to read it with a role that bypasses RLS. That would
-- put an RLS-bypassing connection inside the request-handling process,
-- which is a far bigger thing to get wrong than this is to solve properly.
--
-- Instead: a second transaction-local setting, `app.user_id`, and two
-- narrow SELECT policies that expose only what the authenticated person is
-- already entitled to —
--
--   tenant_users : rows describing THEMSELVES
--   tenants      : tenants they are an active member of
--
-- PostgreSQL ORs permissive policies together, so the existing
-- tenant_isolation policies are unchanged. With `app.user_id` unset — which
-- is every path except authentication — current_user_id() is NULL, the
-- comparison is NULL, and these policies grant nothing. The isolation tests
-- continue to pass untouched, which is the check that matters.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION app.current_user_id() IS
  'Authenticated user for the current transaction, or NULL when unset (SDD-05 §2).';

-- ---------------------------------------------------------------------------
-- Membership test.
--
-- SECURITY DEFINER on purpose. A policy on `tenants` that queried
-- `tenant_users` inline would trigger that table's own policies, and the
-- two would reference each other — PostgreSQL reports infinite recursion.
-- Running the lookup as the function owner reads the table directly and
-- breaks the cycle.
--
-- search_path is pinned: a SECURITY DEFINER function without it can be
-- hijacked by a caller-controlled search_path resolving `tenant_users` to
-- a table they created.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.user_is_member_of(target_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tenant_users tu
    WHERE tu.tenant_id = target_tenant
      AND tu.user_id = app.current_user_id()
      AND tu.status = 'ACTIVE'
  );
$$;

COMMENT ON FUNCTION app.user_is_member_of(uuid) IS
  'Active membership check for app.current_user_id(). SECURITY DEFINER to avoid policy recursion.';

-- SELECT only. Writing a membership still requires tenant context, so this
-- cannot be used to grant yourself access to anything.
CREATE POLICY own_memberships ON public.tenant_users
  FOR SELECT
  USING (user_id = app.current_user_id());

CREATE POLICY member_visible_tenants ON public.tenants
  FOR SELECT
  USING (app.user_is_member_of(id));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vautrin_app') THEN
    GRANT EXECUTE ON FUNCTION app.current_user_id() TO vautrin_app;
    GRANT EXECUTE ON FUNCTION app.user_is_member_of(uuid) TO vautrin_app;
  ELSE
    RAISE NOTICE 'Role vautrin_app not found; skipping function grants.';
  END IF;
END
$$;
