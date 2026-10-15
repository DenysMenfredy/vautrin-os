-- Additive; rollback drops the index and these nullable fields after stopping new workers.
ALTER TABLE public.agent_runs ADD COLUMN idempotency_key text,
  ADD COLUMN execution_lease uuid, ADD COLUMN lease_expires_at timestamptz(6);
CREATE UNIQUE INDEX agent_runs_tenant_id_idempotency_key_key ON public.agent_runs(tenant_id, idempotency_key);
