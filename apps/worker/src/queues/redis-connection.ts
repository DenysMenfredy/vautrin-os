import { Redis } from 'ioredis';

/**
 * Builds the Redis client BullMQ uses.
 *
 * An already-constructed client is passed rather than plain connection
 * options because BullMQ loads ioredis with a lazy `require()`, which fails
 * under native ESM. Constructing it here also makes the dependency explicit
 * instead of leaving it to BullMQ's optional-peer resolution.
 *
 * ioredis parses the URL itself, so `rediss://` enables TLS and a database
 * index in the path is honoured without any manual work.
 */
export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    /**
     * Required by BullMQ. With a retry limit, a blocking command that
     * outlives a reconnect throws instead of resuming, and the worker stops
     * consuming without crashing — the worst failure mode for a queue.
     */
    maxRetriesPerRequest: null,
    /** Surface connection problems instead of queueing commands forever. */
    enableOfflineQueue: false,
  });
}
