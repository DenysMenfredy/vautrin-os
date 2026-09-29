-- Operator-controlled onboarding: one-time bearer invitations are tenant data.
CREATE TABLE public.tenant_invitations (
  id uuid NOT NULL DEFAULT uuidv7(),
  tenant_id uuid NOT NULL,
  email text NOT NULL,
  role public.tenant_role NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz(6) NOT NULL,
  accepted_at timestamptz(6),
  revoked_at timestamptz(6),
  invited_by uuid,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL,
  CONSTRAINT tenant_invitations_pkey PRIMARY KEY (id),
  CONSTRAINT tenant_invitations_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX tenant_invitations_token_hash_key
  ON public.tenant_invitations (token_hash);
CREATE INDEX tenant_invitations_tenant_id_email_accepted_at_revoked_at_idx
  ON public.tenant_invitations (tenant_id, email, accepted_at, revoked_at);
CREATE INDEX tenant_invitations_tenant_id_expires_at_idx
  ON public.tenant_invitations (tenant_id, expires_at);

ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.tenant_invitations
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

-- The runtime role must not gain cross-tenant SELECT. The function owner can
-- read only to resolve a presented digest, and returns only the tenant id.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY invitation_discovery_owner ON public.tenant_invitations FOR SELECT TO %I USING (true)',
    current_user
  );
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vautrin_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_invitations TO vautrin_app;
  END IF;
END;
$$;

CREATE FUNCTION app.invitation_tenant(p_token_hash text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT i.tenant_id
  FROM public.tenant_invitations AS i
  WHERE i.token_hash = p_token_hash
    AND i.accepted_at IS NULL
    AND i.revoked_at IS NULL
    AND i.expires_at > CURRENT_TIMESTAMP
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app.invitation_tenant(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vautrin_app') THEN
    GRANT EXECUTE ON FUNCTION app.invitation_tenant(text) TO vautrin_app;
  END IF;
END;
$$;

COMMENT ON FUNCTION app.invitation_tenant(text) IS
  'Resolve a valid invitation digest to a tenant id only; acceptance must then run under tenant RLS.';

-- Rollback: DROP FUNCTION app.invitation_tenant(text); DROP TABLE public.tenant_invitations.
