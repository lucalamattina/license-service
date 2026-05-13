import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, closeTestApp, type TestApp } from './helpers/app.js';

describe('GET /health', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await buildTestApp();
  });

  afterAll(() => closeTestApp(t));

  it('returns 200 with status ok', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
