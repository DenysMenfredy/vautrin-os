-- SDD-07 §10 / ADR-007: a run is pinned to its published workflow version.
-- A published row may be paused/archived, but its execution contract cannot
-- change. Edits require a new versioned row.
CREATE FUNCTION app.protect_published_workflow()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.published_at IS NOT NULL OR OLD.status <> 'DRAFT' THEN
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
         OR NEW.key IS DISTINCT FROM OLD.key
         OR NEW.version IS DISTINCT FROM OLD.version
         OR NEW.name IS DISTINCT FROM OLD.name
         OR NEW.description IS DISTINCT FROM OLD.description
         OR NEW.trigger IS DISTINCT FROM OLD.trigger
         OR NEW.definition IS DISTINCT FROM OLD.definition
         OR NEW.conditions IS DISTINCT FROM OLD.conditions
         OR NEW.retry_policy IS DISTINCT FROM OLD.retry_policy
         OR NEW.failure_policy IS DISTINCT FROM OLD.failure_policy
         OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
        RAISE EXCEPTION 'Published workflow versions are immutable; create a new version'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.status = 'DRAFT' THEN
        RAISE EXCEPTION 'A published workflow cannot return to draft'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF NEW.status <> 'DRAFT' AND NEW.published_at IS NULL THEN
    NEW.published_at := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workflows_protect_published_version
BEFORE INSERT OR UPDATE ON public.workflows
FOR EACH ROW EXECUTE FUNCTION app.protect_published_workflow();

-- Manual rollback, if required: DROP TRIGGER workflows_protect_published_version
-- ON public.workflows; DROP FUNCTION app.protect_published_workflow();
