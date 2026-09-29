/** Authentication contracts (ADR-011, ADR-013). */

export type TenantRoleName = 'OWNER' | 'ADMIN' | 'MANAGER' | 'STAFF' | 'READ_ONLY';

export interface LoginRequest {
  readonly email: string;
  readonly password: string;
}

/** One-time invitation issuance. The bearer token is returned only here. */
export interface InvitationResponse {
  readonly invitationId: string;
  readonly token: string;
  readonly expiresAt: string;
}

export interface CreateInvitationRequest {
  readonly email: string;
  readonly role: TenantRoleName;
}

export interface AcceptInvitationRequest {
  readonly token: string;
  /** Sets a password for a new account, or proves an existing account. */
  readonly password: string;
  readonly name?: string;
}

/** A tenant the authenticated user belongs to. */
export interface TenantMembershipSummary {
  readonly tenantId: string;
  readonly name: string;
  readonly slug: string;
  readonly role: TenantRoleName;
}

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
}

/**
 * Issued on login and on refresh.
 *
 * The refresh token is returned in the body rather than only as a cookie so
 * a non-browser client can use the same flow. Browsers receive it as an
 * httpOnly cookie as well and should ignore this field.
 */
export interface AuthTokensResponse {
  readonly accessToken: string;
  /** Seconds until `accessToken` expires. */
  readonly expiresIn: number;
  readonly refreshToken: string;
  readonly user: AuthenticatedUser;
  /** The tenant the access token is scoped to, if any. */
  readonly activeTenantId: string | null;
  readonly memberships: readonly TenantMembershipSummary[];
}

export interface RefreshRequest {
  /** Omitted when the refresh token travels as a cookie. */
  readonly refreshToken?: string;
}

export interface SwitchTenantRequest {
  readonly tenantId: string;
}

/** `GET /auth/me` — who the caller is and what they may do. */
export interface CurrentSessionResponse {
  readonly user: AuthenticatedUser;
  readonly activeTenantId: string | null;
  readonly role: TenantRoleName | null;
  /** Resolved from the role; the frontend uses these to hide what it must not offer. */
  readonly capabilities: readonly string[];
  readonly memberships: readonly TenantMembershipSummary[];
}
