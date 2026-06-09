import { describe, expect, it } from 'vitest';
import { BackendClient } from '../../src/backend-client.js';
import { handler } from '../../src/tools/get-license.js';
import { fakeBackend } from '../helpers/fake-backend.js';

const LICENSE_ID = '11111111-1111-1111-1111-111111111111';

function makeBackend(routes: Parameters<typeof fakeBackend>[0]): BackendClient {
  return new BackendClient({ baseUrl: 'http://test', fetch: fakeBackend(routes) });
}

function readJson(result: { content?: { type: string; text?: string }[] | undefined }): unknown {
  return JSON.parse((result.content?.[0] as { text: string }).text);
}

describe('get_license handler', () => {
  it('returns the full license record on happy path', async () => {
    const license = {
      id: LICENSE_ID,
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2027-01-01T00:00:00Z',
      user_id: 'u1',
      product_id: 'p1',
    };
    const backend = makeBackend([
      { method: 'GET', path: `/licenses/${LICENSE_ID}`, response: { status: 200, body: license } },
    ]);

    const result = await handler({ license_id: LICENSE_ID }, { backend });
    expect(result.isError).toBe(false);
    expect(readJson(result)).toEqual(license);
  });

  it('translates 404 into a not_found tool error with the LICENSE variant wording', async () => {
    const backend = makeBackend([
      {
        method: 'GET',
        path: `/licenses/${LICENSE_ID}`,
        response: {
          status: 404,
          body: { error: 'not_found', message: `License ${LICENSE_ID} not found` },
        },
      },
    ]);

    const result = await handler({ license_id: LICENSE_ID }, { backend });
    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toMatch(/no license exists/i);
    expect(text).toMatch(/list_user_licenses/);
    expect(text).toMatch(/"error":"not_found"/);
  });
});
