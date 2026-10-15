-- Run once through a private Cloud SQL administrative connection with psql.
-- Set VAUTRIN_MIGRATION_PASSWORD and VAUTRIN_RUNTIME_PASSWORD in the operator's
-- environment. Never paste passwords into this file or command-line arguments.
\set ON_ERROR_STOP on
\getenv migration_password VAUTRIN_MIGRATION_PASSWORD
\getenv runtime_password VAUTRIN_RUNTIME_PASSWORD
CREATE EXTENSION IF NOT EXISTS vector;
CREATE ROLE vautrin_migrator LOGIN CREATEDB NOSUPERUSER NOBYPASSRLS PASSWORD :'migration_password';
CREATE ROLE vautrin_app LOGIN NOCREATEDB NOSUPERUSER NOBYPASSRLS PASSWORD :'runtime_password';
ALTER SCHEMA public OWNER TO vautrin_migrator;
GRANT CONNECT ON DATABASE vautrin TO vautrin_app;
GRANT USAGE ON SCHEMA public TO vautrin_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- Migrations grant runtime table/function privileges. Cloud SQL does not grant
-- PostgreSQL superuser. Verify all migrations with this restricted migrator in
-- staging, including extensions and narrow SECURITY DEFINER discovery functions.
