-- V0.3 outbox discovery without giving the runtime role cross-tenant row access.
-- The SECURITY DEFINER function returns only tenant IDs and the oldest pending
-- timestamp. Event rows are claimed later under app.tenant_id and FORCE RLS.

-- FORCE RLS also applies to the function owner unless that role bypasses RLS.
-- Grant only the migration role SELECT visibility for this one table, and only
-- inside a function that exposes no event payload or customer data.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY outbox_discovery_owner ON public.events FOR SELECT TO %I USING (true)',
    current_user
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.pending_event_tenants(max_tenants integer)
RETURNS TABLE(tenant_id uuid, oldest_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT e.tenant_id, min(e.occurred_at) AS oldest_at
  FROM public.events AS e
  WHERE e.published_at IS NULL
  GROUP BY e.tenant_id
  ORDER BY min(e.occurred_at), e.tenant_id
  LIMIT LEAST(GREATEST(COALESCE(max_tenants, 1), 1), 100);
$$;

REVOKE ALL ON FUNCTION app.pending_event_tenants(integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vautrin_app') THEN
    GRANT EXECUTE ON FUNCTION app.pending_event_tenants(integer) TO vautrin_app;
  END IF;
END;
$$;

COMMENT ON FUNCTION app.pending_event_tenants(integer) IS
  'Platform outbox discovery: tenant IDs and oldest pending timestamps only. Event rows remain RLS-scoped.';
