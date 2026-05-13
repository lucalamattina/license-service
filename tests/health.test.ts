import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { buildTestApp } from './helpers/app.js';

describe('GET /health', () => {
  let app: FastifyInstance;
  let client: Sql;

  beforeAll(async () => {
    ({ app, client } = await buildTestApp());
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it('returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
