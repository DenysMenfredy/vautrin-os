/** Health probe contracts, served by `GET /api/health/*`. */

export interface LivenessResponse {
  readonly status: 'ok';
  /** Process uptime in seconds. */
  readonly uptimeSeconds: number;
}

export interface DependencyStatus {
  readonly status: 'up' | 'down';
  readonly latencyMs?: number;
}

export interface ReadinessResponse {
  readonly status: 'ok' | 'degraded';
  readonly database: DependencyStatus;
}
