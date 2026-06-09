import { describe, expect, it } from 'vitest';
import { BackendClient } from '../../src/backend-client.js';
import { handler } from '../../src/tools/list-products.js';
import { fakeBackend } from '../helpers/fake-backend.js';

function makeBackend(routes: Parameters<typeof fakeBackend>[0]): BackendClient {
  return new BackendClient({
    baseUrl: 'http://test',
    fetch: fakeBackend(routes),
  });
}

function readJson(result: { content?: { type: string; text?: string }[] | undefined }): unknown {
  const text = (result.content?.[0] as { text: string }).text;
  return JSON.parse(text);
}

describe('list_products handler', () => {
  it('returns { products: [] } when the catalogue is empty', async () => {
    const backend = makeBackend([
      {
        method: 'GET',
        path: '/products',
        response: { status: 200, body: { data: [] } },
      },
    ]);

    const result = await handler({}, { backend });
    expect(result.isError).toBe(false);
    expect(readJson(result)).toEqual({ products: [] });
  });

  it('unwraps the backend list envelope and re-keys data → products', async () => {
    const backend = makeBackend([
      {
        method: 'GET',
        path: '/products',
        response: {
          status: 200,
          body: {
            data: [
              { id: 'p1', name: 'Starter Plan' },
              { id: 'p2', name: 'Pro Plan' },
              { id: 'p3', name: 'Enterprise Plan' },
            ],
          },
        },
      },
    ]);

    const result = await handler({}, { backend });
    expect(result.isError).toBe(false);
    expect(readJson(result)).toEqual({
      products: [
        { id: 'p1', name: 'Starter Plan' },
        { id: 'p2', name: 'Pro Plan' },
        { id: 'p3', name: 'Enterprise Plan' },
      ],
    });
  });

  it('translates a network error into a backend_unreachable tool error', async () => {
    const backend = new BackendClient({
      baseUrl: 'http://test',
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
      retryDelayMs: 0,
    });

    const result = await handler({}, { backend });
    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toMatch(/could not reach the license-service backend/i);
    expect(text).toMatch(/"error":"backend_unreachable"/);
  });
});
