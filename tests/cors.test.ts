import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, closeTestApp, type TestApp } from './helpers/app.js';

/**
 * The CORS allowlist is parsed from process.env.CORS_ALLOWED_ORIGINS at plugin
 * register time, so each scenario sets the env, builds its own app, and tears
 * it down — there's no way to reconfigure CORS on a live Fastify instance.
 */

async function buildWithAllowlist(value: string | undefined): Promise<TestApp> {
  if (value === undefined) {
    delete process.env.CORS_ALLOWED_ORIGINS;
  } else {
    process.env.CORS_ALLOWED_ORIGINS = value;
  }
  return buildTestApp();
}

describe('CORS', () => {
  let t: TestApp | null = null;

  afterEach(async () => {
    if (t) {
      await closeTestApp(t);
      t = null;
    }
    delete process.env.CORS_ALLOWED_ORIGINS;
  });

  it('allows the dev default (http://localhost:5173) when CORS_ALLOWED_ORIGINS is unset', async () => {
    t = await buildWithAllowlist(undefined);
    const res = await t.app.inject({
      method: 'OPTIONS',
      url: '/licenses',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('allows a literal origin from the configured allowlist', async () => {
    t = await buildWithAllowlist('https://license-service-dashboard.vercel.app');
    const res = await t.app.inject({
      method: 'OPTIONS',
      url: '/users',
      headers: {
        origin: 'https://license-service-dashboard.vercel.app',
        'access-control-request-method': 'POST',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://license-service-dashboard.vercel.app',
    );
  });

  it('allows a wildcard subdomain match', async () => {
    t = await buildWithAllowlist('https://license-service-dashboard-*.vercel.app');
    const res = await t.app.inject({
      method: 'OPTIONS',
      url: '/products',
      headers: {
        origin: 'https://license-service-dashboard-abc123.vercel.app',
        'access-control-request-method': 'GET',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://license-service-dashboard-abc123.vercel.app',
    );
  });

  it('rejects an origin not in the allowlist (no Access-Control-Allow-Origin header)', async () => {
    t = await buildWithAllowlist('http://localhost:5173');
    const res = await t.app.inject({
      method: 'OPTIONS',
      url: '/licenses',
      headers: {
        origin: 'http://evil.example.com',
        'access-control-request-method': 'GET',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects a wildcard near-miss that crosses a dot boundary', async () => {
    t = await buildWithAllowlist('https://*.vercel.app');
    const res = await t.app.inject({
      method: 'OPTIONS',
      url: '/licenses',
      headers: {
        origin: 'https://foo.bar.vercel.app',
        'access-control-request-method': 'GET',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('echoes the allowed origin on actual (non-preflight) requests too', async () => {
    t = await buildWithAllowlist('http://localhost:5173');
    const res = await t.app.inject({
      method: 'GET',
      url: '/licenses',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('does not block requests without an Origin header (curl, server-to-server)', async () => {
    t = await buildWithAllowlist('http://localhost:5173');
    const res = await t.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    // No Origin header on the request → no Access-Control-Allow-Origin on the response.
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
