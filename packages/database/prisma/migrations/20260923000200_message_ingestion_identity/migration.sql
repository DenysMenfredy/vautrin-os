-- V0.3 message identity: provider event IDs and local idempotency are distinct
-- from provider message IDs. Nullable unique keys preserve existing rows.
ALTER TABLE public.messages
  ADD COLUMN provider_event_id text,
  ADD COLUMN correlation_id uuid,
  ADD COLUMN idempotency_key text;

CREATE UNIQUE INDEX messages_tenant_id_provider_provider_event_id_key
  ON public.messages (tenant_id, provider, provider_event_id);

CREATE UNIQUE INDEX messages_tenant_id_idempotency_key_key
  ON public.messages (tenant_id, idempotency_key);

CREATE INDEX messages_tenant_id_correlation_id_idx
  ON public.messages (tenant_id, correlation_id);
