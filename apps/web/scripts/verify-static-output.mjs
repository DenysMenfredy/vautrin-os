import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const publicUrl = new URL('../.output/public/', import.meta.url);
const html = (path) => readFile(new URL(path, publicUrl), 'utf8');

const shell = await html('index.html');
for (const path of ['200.html', '404.html']) {
  assert.equal(await html(path), shell, `${path} must be the SPA fallback shell`);
}

assert.match(shell, /id="__nuxt"/, 'static output must contain the Nuxt app mount');
assert.match(shell, /data-ssr="false"/, 'static output must not contain prerendered tenant data');
assert.match(shell, /apiBase:\s*["']\/api["']/, 'browser API requests must use same-origin /api');
assert.doesNotMatch(shell, /apiInternalBase|http:\/\/localhost:3000|http:\/\/api:3000/);

for (const route of [
  'agents',
  'appointments',
  'conversations',
  'invitation',
  'leads',
  'login',
  'settings',
  'workflows',
]) {
  await access(new URL(`${route}/index.html`, publicUrl));
}

process.stdout.write(
  'Static Nuxt output contains the SPA shell, deep routes, and same-origin API config.\n',
);
