-- ---------------------------------------------------------------------------
-- Vautrin OS — database roles (ADR-005, SDD-05 §4)
--
-- Row Level Security is only meaningful if the runtime role is NOT the table
-- owner and does NOT hold BYPASSRLS. We therefore separate two roles:
--
--   vautrin_migrator  owns the schema, runs `prisma migrate`, never serves
--                     application traffic. Needs CREATEDB for Prisma's
--                     shadow database during `migrate dev`.
--
--   vautrin_app       the runtime role used by apps/api and apps/worker.
--                     Holds DML only and is fully subject to RLS.
--
-- This file runs once, on an empty data directory, as the superuser.
-- Production provisions the equivalent roles through infrastructure, not here.
-- ---------------------------------------------------------------------------

\set role_password `echo "$VAUTRIN_ROLE_PASSWORD"`

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vautrin_migrator') THEN
    -- SUPERUSER is required locally for two reasons:
    --   * `vector` is not a trusted extension, so only a superuser may run
    --     CREATE EXTENSION (the first migration does);
    --   * Prisma's `migrate dev` builds a throwaway shadow database and
    --     replays every migration into it, so the privilege is needed there
    --     too, not just against the real database.
    --
    -- This is a local/CI convenience. In production the extension is
    -- installed once by the platform (managed providers preinstall it or
    -- expose it to a privileged role), the CREATE EXTENSION statement
    -- no-ops via IF NOT EXISTS, and the migration role needs only CREATEDB
    -- plus ownership of the schema.
    --
    -- It does not weaken tenant isolation: RLS protects vautrin_app, which
    -- is a separate role and never a superuser. See test/tenant-isolation.
    CREATE ROLE vautrin_migrator LOGIN CREATEDB SUPERUSER;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vautrin_app') THEN
    -- Explicitly NOBYPASSRLS: this is the property the isolation tests rely on.
    CREATE ROLE vautrin_app LOGIN NOBYPASSRLS NOCREATEDB NOSUPERUSER;
  END IF;
END
$$;

ALTER ROLE vautrin_migrator PASSWORD :'role_password';
ALTER ROLE vautrin_app      PASSWORD :'role_password';

-- The migrator owns the schema it will manage.
ALTER SCHEMA public OWNER TO vautrin_migrator;
GRANT ALL ON SCHEMA public TO vautrin_migrator;
GRANT CREATE, CONNECT, TEMPORARY ON DATABASE :"DBNAME" TO vautrin_migrator;

-- The app role may connect and use the schema, but may not create objects in it.
GRANT CONNECT ON DATABASE :"DBNAME" TO vautrin_app;
GRANT USAGE ON SCHEMA public TO vautrin_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- `vector` is not a trusted extension on every build, so install it here as
-- superuser. The migration re-declares it with IF NOT EXISTS, which keeps the
-- migration self-contained for environments where the DBA installs it instead.
CREATE EXTENSION IF NOT EXISTS vector;
