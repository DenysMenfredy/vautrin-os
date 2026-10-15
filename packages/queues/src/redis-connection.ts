import { redisTlsOptions } from '@vautrin/config';
import { Redis } from 'ioredis';

/** Construct ioredis explicitly so BullMQ also works under native ESM. */
export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    ...redisTlsOptions(redisUrl),
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  });
}
