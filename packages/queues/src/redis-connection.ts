import { Redis } from 'ioredis';

/** Construct ioredis explicitly so BullMQ also works under native ESM. */
export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  });
}
