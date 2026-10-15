import assert from 'node:assert/strict';

const origin = new URL(process.argv[2] ?? '');
assert.equal(origin.protocol, 'https:');
for (const path of [
  '/',
  '/login',
  '/invitation',
  '/leads',
  '/conversations',
  '/appointments',
  '/workflows',
  '/agents',
  '/settings',
]) {
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200, `${path} failed`);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
}
assert.equal((await fetch(new URL('/__missing_asset__.js', origin))).status, 404);
assert.equal((await fetch(new URL('/api/health/ready', origin))).status, 200);
assert.equal((await fetch(new URL('/api/auth/me', origin))).status, 401);
if (process.env.SMOKE_OWNER_EMAIL && process.env.SMOKE_OWNER_PASSWORD) {
  const login = await fetch(new URL('/api/auth/login', origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: origin.origin },
    body: JSON.stringify({
      email: process.env.SMOKE_OWNER_EMAIL,
      password: process.env.SMOKE_OWNER_PASSWORD,
    }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().find((value) => value.includes('refresh'));
  assert.ok(cookie?.includes('HttpOnly') && cookie.includes('Secure'));
  const refresh = await fetch(new URL('/api/auth/refresh', origin), {
    method: 'POST',
    headers: { cookie: cookie.split(';')[0], origin: origin.origin },
  });
  assert.equal(refresh.status, 200);
  const next = refresh.headers.getSetCookie().find((value) => value.includes('refresh'));
  assert.ok(next);
  const logout = await fetch(new URL('/api/auth/logout', origin), {
    method: 'POST',
    headers: { cookie: next.split(';')[0], origin: origin.origin },
  });
  assert.equal(logout.status, 204);
}
process.stdout.write(
  'Static routes, same-origin API, security headers and configured session smoke checks passed.\n',
);
