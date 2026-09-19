import { ApiProperty } from '@nestjs/swagger';
import type { DependencyStatus, LivenessResponse, ReadinessResponse } from '@vautrin/contracts';

/**
 * OpenAPI DTOs for the health endpoints.
 *
 * Each class `implements` its shared contract, so changing a response shape
 * here without updating @vautrin/contracts is a compile error rather than a
 * silent break in the frontend (SDD-02 §6). The decorators stay on this side
 * because they are Nest-specific and must not leak into a browser bundle.
 */

export class LivenessDto implements LivenessResponse {
  @ApiProperty({ example: 'ok' })
  declare status: 'ok';

  @ApiProperty({ example: 1337, description: 'Process uptime in seconds' })
  declare uptimeSeconds: number;
}

export class DependencyStatusDto implements DependencyStatus {
  @ApiProperty({ example: 'up', enum: ['up', 'down'] })
  declare status: 'up' | 'down';

  @ApiProperty({ required: false, example: 3 })
  declare latencyMs?: number;
}

export class ReadinessDto implements ReadinessResponse {
  @ApiProperty({ example: 'ok', enum: ['ok', 'degraded'] })
  declare status: 'ok' | 'degraded';

  @ApiProperty({ type: DependencyStatusDto })
  declare database: DependencyStatusDto;
}
