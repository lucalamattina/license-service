import { describe, expect, it } from 'vitest';
import { BackendClient } from '../../src/backend-client.js';
import { handler } from '../../src/tools/revoke-license.js';
import { fakeBackend } from '../helpers/fake-backend.js';

const LICENSE_ID = '33333333-3333-3333-3333-333333333333';

function makeBackend(routes: Parameters<typeof fakeBackend>[0]): BackendClient {
  return new BackendClient({ baseUrl: 'http://test', fetch: fakeBackend(routes) });
}

function readJson(result: { content?: { type: string; text?: string }[] | undefined }): unknown {
  return JSON.parse((result.content?.[0] as { text: string }).text);
}

function readErrorText(result: { content?: { type: string; text?: string }[] | undefined }): string {
  return (result.content?.[0] as { text: string }).text;
}

describe('revoke_license handler', () => {
  it('returns the revoked record on happy path', async () => {
    const revoked = {
      id: LICENSE_ID,
      status: 'revoked',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2027-12-31T23:59:59Z',
      user_id: 'u1',
      product_id: 'p1',
    };
    const backend = makeBackend([
      {
        method: 'POST',
        path: `/licenses/${LICENSE_ID}/revoke`,
        response: { status: 200, body: revoked },
      },
    ]);

    const result = await handler({ license_id: LICENSE_ID }, { backend });
    expect(result.isError).toBe(false);
    expect(readJson(result)).toEqual(revoked);
  });

  it('translates license_not_active (409) into the do-NOT-retry rewrite', async () => {
    const backend = makeBackend([
      {
        method: 'POST',
        path: `/licenses/${LICENSE_ID}/revoke`,
        response: {
          status: 409,
          body: {
            error: 'license_not_active',
            message: `License ${LICENSE_ID} cannot be revoked because it is already revoked`,
          },
        },
      },
    ]);

    const result = await handler({ license_id: LICENSE_ID }, { backend });
    expect(result.isError).toBe(true);
    const text = readErrorText(result);
    expect(text).toMatch(/already Revoked or Expired/i);
    expect(text).toMatch(/do not retry/i);
    expect(text).toMatch(/"error":"license_not_active"/);
  });

  it('translates not_found (404) with the LICENSE variant wording', async () => {
    const backend = makeBackend([
      {
        method: 'POST',
        path: `/licenses/${LICENSE_ID}/revoke`,
        response: {
          status: 404,
          body: { error: 'not_found', message: `License ${LICENSE_ID} not found` },
        },
      },
    ]);

    const result = await handler({ license_id: LICENSE_ID }, { backend });
    expect(result.isError).toBe(true);
    const text = readErrorText(result);
    expect(text).toMatch(/no license exists/i);
    expect(text).toMatch(/list_user_licenses/);
  });
});
