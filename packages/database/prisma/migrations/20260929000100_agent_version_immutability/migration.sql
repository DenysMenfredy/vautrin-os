-- SDD-06 §3/§9: agent instructions and configuration are versioned artifacts.
-- PostgreSQL prevents edits after activation, including writes outside the API.
CREATE FUNCTION app.protect_published_agent_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'ARCHIVED' AND NEW.status <> 'ARCHIVED' THEN
      RAISE EXCEPTION 'Archived agent versions cannot be reactivated'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.status = 'DRAFT' AND NEW.status = 'ARCHIVED' THEN
      RAISE EXCEPTION 'A draft agent must be activated before it can be archived'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.status <> 'DRAFT' OR NEW.status <> 'DRAFT' THEN
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
         OR NEW.key IS DISTINCT FROM OLD.key
         OR NEW.version IS DISTINCT FROM OLD.version
         OR NEW.name IS DISTINCT FROM OLD.name
         OR NEW.instructions IS DISTINCT FROM OLD.instructions
         OR NEW.prompt_version IS DISTINCT FROM OLD.prompt_version
         OR NEW.model_configuration IS DISTINCT FROM OLD.model_configuration
         OR NEW.allowed_tools IS DISTINCT FROM OLD.allowed_tools
         OR NEW.knowledge_strategy IS DISTINCT FROM OLD.knowledge_strategy
         OR NEW.guardrails IS DISTINCT FROM OLD.guardrails
         OR NEW.handoff_policy IS DISTINCT FROM OLD.handoff_policy THEN
        RAISE EXCEPTION 'Published agent versions are immutable; create a new version'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF NEW.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'New agent versions must start as drafts'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER agents_protect_published_version
BEFORE INSERT OR UPDATE ON public.agents
FOR EACH ROW EXECUTE FUNCTION app.protect_published_agent_version();

-- Rollback: DROP TRIGGER agents_protect_published_version ON public.agents;
--           DROP FUNCTION app.protect_published_agent_version();
