import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator.js';
import { LivenessDto, ReadinessDto } from './health.dto.js';
import { HealthService } from './health.service.js';

/**
 * Health probes (SDD-12 §5, §6).
 *
 * Liveness and readiness are split because they answer different questions
 * and a deployment reacts to them differently:
 *
 *   live   is this process running?      -> restart it if not
 *   ready  can it serve traffic?         -> keep it out of the load balancer
 *
 * Collapsing them would let a brief database blip trigger a pod restart,
 * which is exactly the wrong response.
 */
// Unauthenticated by necessity: the container healthcheck and the load
// balancer have no credentials, and a probe that needs a token is a probe
// that reports unhealthy the moment auth breaks.
@Public()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe — does not touch dependencies' })
  @ApiOkResponse({ type: LivenessDto })
  live(): LivenessDto {
    return this.health.liveness();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — verifies the database is reachable' })
  @ApiOkResponse({ type: ReadinessDto })
  @ApiServiceUnavailableResponse({ description: 'A dependency is unavailable' })
  ready(): Promise<ReadinessDto> {
    return this.health.readiness();
  }
}
