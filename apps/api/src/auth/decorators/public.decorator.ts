import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'vautrin:isPublic';

/**
 * Marks a route as reachable without authentication.
 *
 * The authentication guard is global, so access is denied by default and
 * opening a route is an explicit, greppable act. The reverse — a guard you
 * must remember to add — fails open, which is how unauthenticated endpoints
 * ship.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
