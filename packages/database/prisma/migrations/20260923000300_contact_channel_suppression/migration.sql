-- V0.3 technical opt-out state. This is suppression infrastructure, not a
-- complete legal consent policy. STOP is recorded before any AI interpretation.
CREATE TABLE public.contact_channel_preferences (
  id uuid NOT NULL DEFAULT uuidv7(),
  tenant_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  channel public.channel NOT NULL,
  opted_out_at timestamptz(6),
  source text,
  source_event_id text,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL,
  CONSTRAINT contact_channel_preferences_pkey PRIMARY KEY (id),
  CONSTRAINT contact_channel_preferences_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT contact_channel_preferences_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX contact_channel_preferences_tenant_id_contact_id_channel_key
  ON public.contact_channel_preferences (tenant_id, contact_id, channel);
CREATE INDEX contact_channel_preferences_tenant_id_channel_opted_out_at_idx
  ON public.contact_channel_preferences (tenant_id, channel, opted_out_at);

ALTER TABLE public.contact_channel_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_channel_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY contact_channel_preferences_tenant_isolation
  ON public.contact_channel_preferences
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vautrin_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_channel_preferences TO vautrin_app;
  END IF;
END;
$$;
