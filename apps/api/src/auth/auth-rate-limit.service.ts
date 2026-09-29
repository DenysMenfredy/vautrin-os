import { createHash } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Environment } from '@vautrin/config';
import { Redis } from 'ioredis';

import { ENVIRONMENT } from '../config/environment.module.js';

export interface AuthRateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
  readonly scope: 'ip' | 'account' | 'token';
}

/**
 * Bounded abuse controls for credential endpoints.
 *
 * Redis is only used for expiring counters. It does not hold sessions or any
 * other durable business state, so losing it cannot invalidate PostgreSQL
 * authentication records (AGENTS.md §2 and ADR-009).
 */
@Injectable()
export class AuthRateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(AuthRateLimitService.name);
  private readonly redis: Redis;
  private readonly redisReady: Promise<void>;

  constructor(@Inject(ENVIRONMENT) environment: Environment) {
    this.redis = new Redis(environment.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    this.redisReady = this.redis.connect();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redisReady;
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  async checkLogin(ipAddress: string, email: string): Promise<AuthRateLimitDecision> {
    const [ip, account] = await Promise.all([
      this.hit('login-ip', ipAddress, 60, 60, 'ip'),
      this.hit('login-account', email.trim().toLowerCase(), 30, 60, 'account'),
    ]);
    return this.report('login', firstExceeded(ip, account));
  }

  async checkRefresh(ipAddress: string, token: string): Promise<AuthRateLimitDecision> {
    const [ip, tokenCounter] = await Promise.all([
      this.hit('refresh-ip', ipAddress, 30, 60, 'ip'),
      this.hit('refresh-token', token, 10, 60, 'token'),
    ]);
    return this.report('refresh', firstExceeded(ip, tokenCounter));
  }

  async checkInvitation(ipAddress: string, token: string): Promise<AuthRateLimitDecision> {
    const [ip, tokenCounter] = await Promise.all([
      this.hit('invitation-ip', ipAddress, 30, 60, 'ip'),
      this.hit('invitation-token', token, 10, 60, 'token'),
    ]);
    return this.report('invitation', firstExceeded(ip, tokenCounter));
  }

  private report(
    endpoint: 'login' | 'refresh' | 'invitation',
    decision: AuthRateLimitDecision,
  ): AuthRateLimitDecision {
    if (!decision.allowed) {
      this.logger.warn(`auth.rate_limited endpoint=${endpoint} scope=${decision.scope}`);
    }
    return decision;
  }

  private async hit(
    bucket: string,
    identity: string,
    limit: number,
    windowSeconds: number,
    scope: AuthRateLimitDecision['scope'],
  ): Promise<AuthRateLimitDecision> {
    const key = `vautrin:auth:rate:${bucket}:${digest(identity)}`;

    try {
      await this.redisReady;
      const result = await this.redis.multi().incr(key).expire(key, windowSeconds, 'NX').exec();
      const count = Number(result?.[0]?.[1] ?? 0);

      return {
        allowed: count <= limit,
        retryAfterSeconds: count > limit ? windowSeconds : 0,
        scope,
      };
    } catch (error) {
      // Fail closed for credential operations: accepting unlimited guesses is
      // the unsafe fallback when the abuse-control dependency is unavailable.
      this.logger.error(
        'Authentication rate limiter unavailable',
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException('Authentication service temporarily unavailable.');
    }
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function firstExceeded(...decisions: AuthRateLimitDecision[]): AuthRateLimitDecision {
  return (
    decisions.find((decision) => !decision.allowed) ?? {
      allowed: true,
      retryAfterSeconds: 0,
      scope: 'ip',
    }
  );
}
