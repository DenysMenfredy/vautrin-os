-- Resolve a provisioned integration identity before a webhook has tenant
-- context. The function returns only routing/credential-reference metadata;
-- all business writes still occur under tenant RLS after signature validation.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY twilio_discovery_owner ON public.integrations FOR SELECT TO %I USING (true)',
    current_user
  );
END;
$$;

CREATE FUNCTION app.twilio_webhook_target(target_id uuid)
RETURNS TABLE(
  tenant_id uuid,
  integration_id uuid,
  credentials_ref text,
  account_sid text,
  phone_number text,
  webhook_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT i.tenant_id,
         i.id,
         i.credentials_ref,
         i.external_account_id,
         i.configuration->>'phoneNumber',
         i.configuration->>'webhookUrl'
  FROM public.integrations AS i
  WHERE i.id = target_id
    AND i.provider = 'twilio'
    AND i.category = 'MESSAGING'
    AND i.status IN ('CONNECTED', 'HEALTHY', 'DEGRADED')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app.twilio_webhook_target(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vautrin_app') THEN
    GRANT EXECUTE ON FUNCTION app.twilio_webhook_target(uuid) TO vautrin_app;
  END IF;
END;
$$;

COMMENT ON FUNCTION app.twilio_webhook_target(uuid) IS
  'Resolve only a provisioned Twilio webhook route; signed payload verification and tenant RLS must follow.';

-- Manual rollback: REVOKE EXECUTE, DROP FUNCTION app.twilio_webhook_target(uuid),
-- then DROP POLICY twilio_discovery_owner ON public.integrations.
