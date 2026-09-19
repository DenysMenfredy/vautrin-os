import { HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { DatabaseService } from '../database/database.service.js';
import type { LivenessDto, ReadinessDto } from './health.dto.js';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly database: DatabaseService) {}

  liveness(): LivenessDto {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  async readiness(): Promise<ReadinessDto> {
    const startedAt = performance.now();

    try {
      // `unscoped` is correct here: this is a connectivity probe, not a read
      // of tenant data. SELECT 1 touches no RLS-protected table.
      await this.database.unscoped.$queryRaw`SELECT 1`;
    } catch (error) {
      // Log the cause for operators, return nothing revealing to the caller
      // (AGENTS.md §8: do not leak internal exceptions).
      this.logger.error('Readiness check failed: database unreachable', error);
      throw new ServiceUnavailableException({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        status: 'degraded',
        database: { status: 'down' },
      });
    }

    return {
      status: 'ok',
      database: { status: 'up', latencyMs: Math.round(performance.now() - startedAt) },
    };
  }
}
