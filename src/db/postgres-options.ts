import type { Options, PostgresType } from 'postgres';

/**
 * Builds postgres-js connection options that honour the DATABASE_SSL env var.
 *
 * When DATABASE_SSL=true, SSL is enabled with `rejectUnauthorized: false` —
 * required by Heroku Postgres (and many other managed Postgres providers)
 * which terminate TLS with self-signed certs.
 *
 * Local dev and CI leave DATABASE_SSL unset, so plain TCP is used against
 * the Docker / GHA-service-container Postgres.
 */
export function buildPostgresOptions(
  overrides: Options<Record<string, PostgresType>> = {},
): Options<Record<string, PostgresType>> {
  const opts: Options<Record<string, PostgresType>> = { ...overrides };
  if (process.env.DATABASE_SSL === 'true') {
    opts.ssl = { rejectUnauthorized: false };
  }
  return opts;
}
