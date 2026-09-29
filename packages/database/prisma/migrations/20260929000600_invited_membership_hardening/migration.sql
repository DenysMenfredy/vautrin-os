-- Previously, internal provisioning could create an ACTIVE membership for a
-- global INVITED identity without a password or accepted invitation. Demote
-- those memberships before the invitation flow can activate an identity, so
-- accepting one tenant's invitation never activates unrelated legacy grants.
-- The schema owner runs migrations. FORCE RLS still applies to it, so grant a
-- temporary policy only to the current migration role within this migration.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY invited_membership_backfill ON public.tenant_users FOR ALL TO %I USING (true) WITH CHECK (true)',
    current_user
  );
END;
$$;

UPDATE public.tenant_users AS membership
SET status = 'INVITED', updated_at = CURRENT_TIMESTAMP
FROM public.users AS identity
WHERE membership.user_id = identity.id
  AND identity.status = 'INVITED'
  AND membership.status = 'ACTIVE';

DROP POLICY invited_membership_backfill ON public.tenant_users;

-- This security correction is intentionally not reversed automatically:
-- pending memberships must be accepted or explicitly re-granted.
