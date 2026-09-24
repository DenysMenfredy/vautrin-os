-- V0.3 workflow recovery: expose only bounded tenant identifiers and the
-- oldest pending timestamp to the worker's platform-level reconciler.
-- Run rows are still loaded and locked under tenant context + RLS.

DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY workflow_run_discovery_owner ON public.workflow_runs FOR SELECT TO %I USING (status IN (''PENDING'', ''WAITING''))',
    current_user
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.pending_workflow_run_tenants(max_tenants integer)
RETURNS TABLE(tenant_id uuid, oldest_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT run.tenant_id, min(COALESCE(run.scheduled_for, run.created_at)) AS oldest_at
  FROM public.workflow_runs AS run
  WHERE run.status IN ('PENDING', 'WAITING')
  GROUP BY run.tenant_id
  ORDER BY min(COALESCE(run.scheduled_for, run.created_at)), run.tenant_id
  LIMIT LEAST(GREATEST(COALESCE(max_tenants, 1), 1), 100);
$$;

REVOKE ALL ON FUNCTION app.pending_workflow_run_tenants(integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vautrin_app') THEN
    GRANT EXECUTE ON FUNCTION app.pending_workflow_run_tenants(integer) TO vautrin_app;
  END IF;
END;
$$;

COMMENT ON FUNCTION app.pending_workflow_run_tenants(integer) IS
  'Platform workflow reconciliation: tenant IDs and oldest pending timestamps only. Workflow rows remain RLS-scoped.';
