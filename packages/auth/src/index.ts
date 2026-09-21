/**
 * @vautrin/auth — authentication primitives and the capability model.
 *
 * Framework-agnostic on purpose: apps/api wires these into NestJS guards,
 * and the agent tool layer will reuse the same capabilities for authorizing
 * AI actions (ADR-011).
 */

export {
  CAPABILITIES,
  type Capability,
  capabilitiesFor,
  type Role,
  roleHasAllCapabilities,
  roleHasCapability,
} from './capabilities.js';

export {
  DUMMY_PASSWORD_DIGEST,
  hashPassword,
  verifyPassword,
} from './passwords.js';

export {
  ACCESS_TOKEN_TTL_SECONDS,
  type AccessTokenClaims,
  type GeneratedRefreshToken,
  generateRefreshToken,
  hashRefreshToken,
  InvalidAccessTokenError,
  REFRESH_TOKEN_TTL_SECONDS,
  refreshTokenExpiry,
  refreshTokenHashEquals,
  type SignAccessTokenInput,
  signAccessToken,
  verifyAccessToken,
} from './tokens.js';
