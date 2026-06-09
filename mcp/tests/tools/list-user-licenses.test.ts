import { describe, expect, it } from 'vitest';
import { BackendClient } from '../../src/backend-client.js';
import { handler } from '../../src/tools/list-user-licenses.js';
import { fakeBackend } from '../helpers/fake-backend.js';

const USER_ID = '22222222-2222-2222-2222-222222222222';

function makeBackend(routes: Parameters<typeof fakeBackend>[0]): BackendClient {
  return new BackendClient({ baseUrl: 'http://test', fetch: fakeBackend(routes) });
}

function readJson(result: { content?: { type: string; text?: string }[] | undefined }): unknown {
  return JSON.parse((result.content?.[0] as { text: string }).text);
}

describe('list_user_licenses handler', () => {
  it('returns { licenses: [] } when the user has no licenses', async () => {
    const backend = makeBackend([
      {
        method: 'GET',
        path: `/users/${USER_ID}/licenses`,
        response: { status: 200, body: { data: [] } },
      },
    ]);

    const result = await handler({ user_id: USER_ID }, { backend });
    expect(result.isError).toBe(false);
    expect(readJson(result)).toEqual({ licenses: [] });
  });

  it('re-keys the backend list envelope (data → licenses) and returns all statuses', async () => {
    const licenses = [
      { id: 'l1', status: 'active',  created_at: '2026-01-01T00:00:00Z', expires_at: '2027-01-01T00:00:00Z', user_id: USER_ID, product_id: 'p1' },
      { id: 'l2', status: 'revoked', created_at: '2026-01-02T00:00:00Z', expires_at: '2026-12-01T00:00:00Z', user_id: USER_ID, product_id: 'p2' },
      { id: 'l3', status: 'expired', created_at: '2025-01-01T00:00:00Z', expires_at: '2026-01-01T00:00:00Z', user_id: USER_ID, product_id: 'p3' },
    ];
    const backend = makeBackend([
      {
        method: 'GET',
        path: `/users/${USER_ID}/licenses`,
        response: { status: 200, body: { data: licenses } },
      },
    ]);

    const result = await handler({ user_id: USER_ID }, { backend });
    expect(result.isError).toBe(false);
    expect(readJson(result)).toEqual({ licenses });
  });

  it('translates 404 into a not_found tool error with the USER variant wording', async () => {
    const backend = makeBackend([
      {
        method: 'GET',
        path: `/users/${USER_ID}/licenses`,
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
