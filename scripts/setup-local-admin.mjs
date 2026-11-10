import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Development-only role/bootstrap migrations. Never grants platform access. */
const root = fileURLToPath(new URL('../', import.meta.url));
function main() {
  if (process.env.NODE_ENV !== 'development')
    throw new Error('Local admin setup requires NODE_ENV=development.');
  const password = process.env.POSTGRES_PLATFORM_PASSWORD;
  if (!password)
    throw new Error('Set POSTGRES_PLATFORM_PASSWORD and DATABASE_PLATFORM_URL in .env first.');
  const parseLocalDatabaseUrl = (name, expectedUser) => {
    let url;
    try {
      url = new URL(process.env[name] ?? '');
    } catch {
      throw new Error(`Set a valid ${name} in .env first.`);
    }
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username !== expectedUser
    )
      throw new Error(`${name} must use the expected local PostgreSQL role and host.`);
    return url;
  };
  const runtime = parseLocalDatabaseUrl('DATABASE_URL', 'vautrin_app');
  const migrationUrl = parseLocalDatabaseUrl('DATABASE_MIGRATION_URL', 'vautrin_migrator');
  const platform = parseLocalDatabaseUrl('DATABASE_PLATFORM_URL', 'vautrin_platform_admin');
  if (
    [migrationUrl, platform].some(
      (url) =>
        url.hostname !== runtime.hostname ||
        url.pathname !== runtime.pathname ||
        url.port !== runtime.port,
    ) ||
    decodeURIComponent(platform.password) !== password
  )
    throw new Error('Use matching local database URLs and the restricted platform credentials.');
  const result = spawnSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      '-e',
      'VAUTRIN_PLATFORM_PASSWORD',
      'postgres',
      'sh',
      '-c',
      'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/02-platform-role.sql',
    ],
    { cwd: root, env: { ...process.env, VAUTRIN_PLATFORM_PASSWORD: password }, encoding: 'utf8' },
  );
  if (result.status !== 0)
    throw new Error(
      'Local platform-role setup failed. Verify the PostgreSQL container is running.',
    );
  const migrationResult = spawnSync('pnpm', ['--filter', '@vautrin/database', 'migrate:deploy'], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (migrationResult.status !== 0)
    throw new Error('Migration failed; application containers have not been changed.');
  process.stdout.write(
    'Local platform role and migrations ready. No platform access has been granted. Recreate API/admin containers to load their configuration.\n',
  );
}
try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Local setup failed.'}\n`);
  process.exitCode = 1;
}
