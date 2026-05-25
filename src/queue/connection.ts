import { Redis, type RedisOptions } from 'ioredis';
import type { ConnectionOptions } from 'bullmq';

/**
 * When the URL uses the `rediss://` scheme, ioredis enables TLS automatically
 * but defaults to `rejectUnauthorized: true`. Managed providers (Heroku Redis,
 * Upstash, etc.) terminate TLS with self-signed certs, so we have to opt out of
 * verification — equivalent to what `DATABASE_SSL=true` does for Postgres.
 *
 * Local Redis runs `redis://` (no TLS), so this returns `{}` and nothing changes.
 */
function tlsOptionsFor(url: string): Pick<RedisOptions, 'tls'> {
  if (url.startsWith('rediss://')) {
    return { tls: { rejectUnauthorized: false } };
  }
  return {};
}

/**
 * Standalone Redis client used by code paths outside BullMQ (e.g. the /ready
 * health check). BullMQ creates its own internal connections from a config
 * object — see {@link bullmqConnection}.
 */
export function createRedisClient(url: string): Redis {
  return new Redis(url, tlsOptionsFor(url));
}

/**
 * Connection config for BullMQ. `maxRetriesPerRequest: null` is required by
 * BullMQ workers (they use the connection in blocking mode); the same setting
 * is harmless for queues. TLS options are forwarded for `rediss://` URLs.
 */
export function bullmqConnection(url: string): ConnectionOptions {
  return {
    url,
    maxRetriesPerRequest: null,
    ...tlsOptionsFor(url),
  } as ConnectionOptions;
}
