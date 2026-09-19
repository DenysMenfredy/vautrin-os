/**
 * The single error shape every endpoint returns (AGENTS.md §8).
 *
 * Shared so the frontend can handle failures uniformly instead of
 * special-casing each endpoint.
 */
export interface ErrorResponse {
  readonly statusCode: number;
  readonly error: string;
  readonly message: string | string[];
  readonly path: string;
  /** ISO-8601. */
  readonly timestamp: string;
  /** Present when the caller supplied `x-correlation-id` (SDD-10 §6). */
  readonly correlationId?: string;
}
