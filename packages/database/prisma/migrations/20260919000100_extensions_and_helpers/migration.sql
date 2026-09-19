-- ---------------------------------------------------------------------------
-- Extensions and helper functions
--
-- Runs before the table migration because the tables depend on both the
-- `vector` type (ADR-004) and the `uuidv7()` default (SDD-04 §5).
-- ---------------------------------------------------------------------------

-- ADR-004 / SDD-04 §2. Idempotent: local dev installs it during initdb, and a
-- managed provider may have it preinstalled or require a DBA to enable it.
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- uuidv7()
--
-- SDD-04 §5 asks for UUIDv7-style identifiers. They are time-ordered, so
-- inserts stay at the right edge of every primary-key btree instead of
-- scattering across it the way UUIDv4 does.
--
-- PostgreSQL 18 ships a native pg_catalog.uuidv7(). This definition lives in
-- `public`, which precedes pg_catalog in the default search_path, so it stays
-- authoritative until the function is deliberately dropped on upgrade.
--
-- Implementation: take a v4 UUID (correct variant bits already), overlay the
-- first 48 bits with a millisecond Unix timestamp, then flip the version
-- nibble from 0100 to 0111.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.uuidv7()
RETURNS uuid
LANGUAGE sql
VOLATILE
PARALLEL SAFE
AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(
            int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint)
            FROM 3
          )
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid;
$$;

COMMENT ON FUNCTION public.uuidv7() IS
  'Time-ordered UUIDv7 (SDD-04 §5). Drop in favour of pg_catalog.uuidv7() on PostgreSQL 18+.';

-- ---------------------------------------------------------------------------
-- Tenant context helper
--
-- SDD-05 §4. RLS policies call this instead of reading current_setting()
-- directly, so the fail-closed semantics are defined in exactly one place:
--
--   unset  -> NULL  -> `tenant_id = NULL` is NULL -> row is NOT visible
--   ''     -> NULL  -> same
--
-- Returning NULL rather than raising keeps a missing context from turning into
-- a 500; the query simply sees no rows, which is the safe direction to fail.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION app.current_tenant_id() IS
  'Active tenant for the current transaction, or NULL when unset (SDD-05 §4).';

-- ---------------------------------------------------------------------------
-- Runtime role access to the helper schema.
--
-- Guarded: the migration must also apply cleanly in environments that
-- provision roles under different names (CI, managed providers).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vautrin_app') THEN
    GRANT USAGE ON SCHEMA app TO vautrin_app;
    GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO vautrin_app;
  ELSE
    RAISE NOTICE 'Role vautrin_app not found; skipping app-schema grants.';
  END IF;
END
$$;
