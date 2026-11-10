import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../.output/public/', import.meta.url);
for (const path of [
  'index.html',
  '200.html',
  '404.html',
  'login/index.html',
  'dashboard/index.html',
  'users/index.html',
  'tenants/index.html',
  'audit/index.html',
]) {
  const html = await readFile(new URL(path, root), 'utf8');
  assert.match(html, /id="__nuxt"/);
  assert.match(html, /data-ssr="false"/);
  assert.match(html, /apiBase:\s*["']\/api\/admin["']/);
  assert.doesNotMatch(
    html,
    /apiInternalBase|DATABASE_PLATFORM_URL|passwordHash|vos_admin_session|tokenHash/,
  );
}
for (const font of ['geist-latin.woff2', 'geist-mono-latin.woff2'])
  await access(new URL(`fonts/${font}`, root));
process.stdout.write(
  'Separate admin SPA, dynamic-route fallback, same-origin admin API and shared fonts verified.\n',
);
