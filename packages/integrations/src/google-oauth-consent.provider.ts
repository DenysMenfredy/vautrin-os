import { CalendarProviderError } from './calendar-provider.js';
export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
] as const;
export interface GoogleConsentConfiguration {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}
export class GoogleOAuthConsentProvider {
  constructor(private readonly http: typeof fetch = fetch) {}
  authorizationUrl(config: GoogleConsentConfiguration, state: string, challenge: string): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_CALENDAR_SCOPES.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }
  async exchange(
    config: GoogleConsentConfiguration,
    code: string,
    verifier: string,
    calendarId: string,
  ): Promise<{ refreshToken: string }> {
    const response = await this.http('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new CalendarProviderError('oauth_consent_rejected', false);
    const data = object(await response.json());
    const scopes = typeof data.scope === 'string' ? data.scope.split(' ') : [];
    if (
      typeof data.refresh_token !== 'string' ||
      typeof data.access_token !== 'string' ||
      !GOOGLE_CALENDAR_SCOPES.every((scope) => scopes.includes(scope))
    )
      throw new CalendarProviderError('oauth_scopes_missing', false);
    const calendar = await this.http(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
      {
        headers: { authorization: `Bearer ${data.access_token}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!calendar.ok) throw new CalendarProviderError('oauth_calendar_unavailable', false);
    return { refreshToken: data.refresh_token };
  }
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
