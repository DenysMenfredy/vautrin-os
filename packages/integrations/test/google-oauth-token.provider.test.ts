import { describe, expect, it, vi } from 'vitest';

import { GoogleOAuthTokenProvider } from '../src/google-oauth-token.provider.js';

const credentials = {
  clientId: 'local-client-id',
  clientSecret: 'local-client-secret',
  refreshToken: 'local-refresh-token',
};

describe('Google OAuth token provider', () => {
  it('refreshes at the fixed Google endpoint with a form body', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'short-lived-token', token_type: 'Bearer' }), {
        status: 200,
      }),
    );
    expect(await new GoogleOAuthTokenProvider(request).accessToken(credentials)).toBe(
      'short-lived-token',
    );
    const [url, options] = request.mock.calls[0] ?? [];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(options?.method).toBe('POST');
    expect(options?.headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(String(options?.body)).toContain('grant_type=refresh_token');
    expect(String(options?.body)).toContain('refresh_token=local-refresh-token');
  });

  it('does not expose a revoked token or provider response in errors', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: credentials.refreshToken }), { status: 400 }),
      );
    const error = await new GoogleOAuthTokenProvider(request)
      .accessToken(credentials)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'oauth_authorization_expired', retryable: false });
    expect(String(error)).not.toContain(credentials.refreshToken);
  });

  it('treats rate limits as retryable but rejects malformed success responses', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'wrong-type' })));
    const provider = new GoogleOAuthTokenProvider(request);
    await expect(provider.accessToken(credentials)).rejects.toMatchObject({
      code: 'oauth_http_429',
      retryable: true,
    });
    await expect(provider.accessToken(credentials)).rejects.toMatchObject({
      code: 'invalid_oauth_response',
      retryable: true,
    });
  });
});
