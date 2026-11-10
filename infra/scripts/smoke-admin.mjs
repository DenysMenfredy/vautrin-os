import assert from 'node:assert/strict';

const origin = new URL(process.argv[2] ?? '');
assert.equal(origin.protocol, 'https:');
for (const path of [
  '/',
  '/login',
  '/dashboard',
  '/users',
  '/tenants',
  '/audit',
  '/users/11111111-1111-4111-8111-111111111111',
  '/tenants/11111111-1111-4111-8111-111111111111',
]) {
  const response = await fetch(new URL(path, origin));
  assert.equal(response.status, 200, path);
  assert.match(await response.text(), /id="__nuxt"/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
}
assert.equal((await fetch(new URL('/missing.js', origin))).status, 404);
assert.equal((await fetch(new URL('/api/admin/dashboard', origin))).status, 401);
assert.equal(
  (
    await fetch(new URL('/api/admin/session', origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://untrusted.example' },
      body: JSON.stringify({ email: 'probe@example.invalid', password: 'synthetic-probe' }),
    })
  ).status,
  403,
);
process.stdout.write(
  'Admin HTTPS/deep links/headers and unauthenticated/cross-origin denials passed.\n',
);
