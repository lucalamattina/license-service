import { describe, expect, it } from 'vitest';
import { BackendClient } from '../../src/backend-client.js';
import { handler } from '../../src/tools/validate-license.js';
import { fakeBackend } from '../helpers/fake-backend.js';

const LICENSE_ID = '44444444-4444-4444-4444-444444444444';

function makeBackend(routes: Parameters<typeof fakeBackend>[0]): BackendClient {
  return new BackendClient({ baseUrl: 'http://test', fetch: fakeBackend(routes) });
}

function readJson(result: { content?: { type: string; text?: string }[] | undefined }): unknown {
  return JSON.parse((result.content?.[0] as { text: string }).text);
}

describe('validate_license handler', () => {
  it('returns { valid: true } when the backend reports an active, not-yet-expired license', async () => {
    const license = {
      id: LICENSE_ID,
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2027-01-01T00:00:00Z',
      user_id: 'u1',
      product_id: 'p1',
    };
    const backend = makeBackend([
      {
        method: 'POST',
        path: `/licenses/${LICENSE_ID}/validate`,
        response: { status: 200, body: { valid: true, license } },
      },
    ]);

    const result = await handler({ license_id: LICENSE_ID }, { backend });
    expect(result.isError).toBe(false);
    expect(readJson(result)).toEqual({ valid: true, license });
  });

  it('returns { valid: false } when the backend reports an already-expired license', async () => {
    // The backend may have just transitioned the license inside its
    // expire-on-validate transaction; the tool layer sees the result, not the
    // transition. The transition behaviour itself is exercised by Phase 8 evals.
    const license = {
      id: LICENSE_ID,
      status: 'expired',
      created_at: '2025-01-01T00:00:00Z',
      expires_at: '2026-01-01T00:00:00Z',
      user_id: 'u1',
      product_id: 'p1',
    };
    const backend = makeBackend([
      {
        method: 'POST',
        path: `/licenses/${LICENSE_ID}/validate`,
        response: { status: 200, body: { valid: false, license } },
      },
    ]);

    const result = await handler({ license_id: LICENSE_ID }, { backend });
    expect(result.isError).toBe(false);
    expect(readJson(result)).toEqual({ valid: false, license });
  });

  it('returns { valid: false } when the backend reports a revoked license', async () => {
    const license = {
      id: LICENSE_ID,
      status: 'revoked',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2027-01-01T00:00:00Z',
      user_id: 'u1',
      product_id: 'p1',
    };
    const backend = makeBackend([
      {
        method: 'POST',
        path: `/licenses/${LICENSE_ID}/validate`,
        response: { status: 200, body: { valid: false, license } },
      },
    ]);

    const result = await handler({ license_id: LICENSE_ID }, { backend });
    expect(result.isError).toBe(false);
    expect(readJson(result)).toEqual({ valid: false, license });
  });

  it('translates 404 into a not_found tool error with the LICENSE variant wording', async () => {
    const backend = makeBackend([
      {
        method: 'POST',
        path: `/licenses/${LICENSE_ID}/validate`,
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
  });
});
