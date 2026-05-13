import { Redis } from 'ioredis';
import type { ConnectionOptions } from 'bullmq';

/**
 * Standalone Redis client used by code paths outside BullMQ (e.g. the /ready
 * health check). BullMQ creates its own internal connections from a config
 * object — see {@link bullmqConnection}.
 */
export function createRedisClient(url: string): Redis {
  return new Redis(url);
}

/**
 * Connection config for BullMQ. `maxRetriesPerRequest: null` is required by
 * BullMQ workers (they use the connection in blocking mode); the same setting
 * is harmless for queues.
 */
export function bullmqConnection(url: string): ConnectionOptions {
  return { url, maxRetriesPerRequest: null } as ConnectionOptions;
}
