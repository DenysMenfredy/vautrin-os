import { CalendarProviderError } from './calendar-provider.js';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REQUEST_TIMEOUT_MS = 10_000;

/** A single tenant's Google OAuth credential set, loaded from a secret store. */
export interface GoogleOAuthCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

/** Refreshes a short-lived access token; callers must never persist it as business state. */
export class GoogleOAuthTokenProvider {
  constructor(private readonly requestFetch: typeof fetch = fetch) {}

  async accessToken(credentials: GoogleOAuthCredentials): Promise<string> {
    if (
      !credentials.clientId.trim() ||
      !credentials.clientSecret.trim() ||
      !credentials.refreshToken.trim()
    ) {
      throw new CalendarProviderError('invalid_credentials', false);
    }
    let response: Response;
    try {
      response = await this.requestFetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          refresh_token: credentials.refreshToken,
          grant_type: 'refresh_token',
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new CalendarProviderError('oauth_network_unavailable', true);
    }
    if (!response.ok) {
      throw new CalendarProviderError(
        response.status === 400 || response.status === 401
          ? 'oauth_authorization_expired'
          : `oauth_http_${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new CalendarProviderError('invalid_oauth_response', true);
    }
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('access_token' in payload) ||
      typeof payload.access_token !== 'string' ||
      !payload.access_token.trim() ||
      !('token_type' in payload) ||
      payload.token_type !== 'Bearer'
    ) {
      throw new CalendarProviderError('invalid_oauth_response', true);
    }
    return payload.access_token;
  }
}
