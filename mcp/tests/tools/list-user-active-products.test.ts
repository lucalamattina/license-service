import { describe, expect, it } from 'vitest';
import { BackendClient } from '../../src/backend-client.js';
import { handler } from '../../src/tools/list-user-active-products.js';
import { fakeBackend } from '../helpers/fake-backend.js';

const USER_ID = '33333333-3333-3333-3333-333333333333';

function makeBackend(routes: Parameters<typeof fakeBackend>[0]): BackendClient {
  return new BackendClient({ baseUrl: 'http://test', fetch: fakeBackend(routes) });
}

function readJson(result: { content?: { type: string; text?: string }[] | undefined }): unknown {
  return JSON.parse((result.content?.[0] as { text: string }).text);
}

describe('list_user_active_products handler', () => {
  it('returns { products: [] } when the user has no Active licenses', async () => {
    const backend = makeBackend([
      {
        method: 'GET',
        path: `/users/${USER_ID}/products`,
        response: { status: 200, body: { data: [] } },
      },
    ]);

    const result = await handler({ user_id: USER_ID }, { backend });
    expect(result.isError).toBe(false);
    expect(readJson(result)).toEqual({ products: [] });
  });

  it('re-keys the backend list envelope (data → products); only the right-now view comes back', async () => {
    // The "right-now" filter (Active only) is enforced by the backend; the
    // tool layer just passes through whatever the backend returned.
    const products = [
      { id: 'p1', name: 'Pro Plan' },
      { id: 'p2', name: 'Enterprise Plan' },
    ];
    const backend = makeBackend([
      {
        method: 'GET',
        path: `/users/${USER_ID}/products`,
        response: { status: 200, body: { data: products } },
      },
    ]);

    const result = await handler({ user_id: USER_ID }, { backend });
    expect(result.isError).toBe(false);
    expect(readJson(result)).toEqual({ products });
  });

  it('translates 404 into a not_found tool error with the USER variant wording', async () => {
    const backend = makeBackend([
      {
        method: 'GET',
        path: `/users/${USER_ID}/products`,
        response: {
          status: 404,
          body: { error: 'not_found', message: `User ${USER_ID} not found` },
        },
      },
    ]);

    const result = await handler({ user_id: USER_ID }, { backend });
    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toMatch(/no user exists/i);
    expect(text).toMatch(/find_user_by_email/);
  });
});
