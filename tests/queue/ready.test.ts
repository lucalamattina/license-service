import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, closeTestApp, type TestApp } from '../helpers/app.js';

describe('GET /ready', () => {
  describe('both deps healthy', () => {
    let t: TestApp;

    beforeAll(async () => {
      t = await buildTestApp();
    });

    afterAll(() => closeTestApp(t));

    it('returns 200 with both checks ok', async () => {
      const res = await t.app.inject({ method: 'GET', url: '/ready' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        status: 'ok',
        checks: { postgres: 'ok', redis: 'ok' },
      });
    });
  });

  describe('Redis unavailable', () => {
    let t: TestApp;

    beforeAll(async () => {
      t = await buildTestApp();
      // Drop the Redis connection BEFORE running the test.
      await t.redis.quit();
    });

    afterAll(async () => {
      await t.app.close();
      await t.client.end();
    });

    it('returns 503 with redis=down and postgres=ok', async () => {
      const res = await t.app.inject({ method: 'GET', url: '/ready' });
      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.status).toBe('unavailable');
      expect(body.checks.redis).toBe('down');
      expect(body.checks.postgres).toBe('ok');
    });
  });
});
