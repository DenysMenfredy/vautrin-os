-- Local/CI only. Production sets a distinct password through DBA bootstrap.
\getenv platform_password VAUTRIN_PLATFORM_PASSWORD
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='vautrin_platform_admin') THEN
    CREATE ROLE vautrin_platform_admin LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;
ALTER ROLE vautrin_platform_admin PASSWORD :'platform_password';
GRANT CONNECT ON DATABASE :"DBNAME" TO vautrin_platform_admin;
GRANT USAGE ON SCHEMA public TO vautrin_platform_admin;
