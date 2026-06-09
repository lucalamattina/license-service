import { describe, expect, it } from 'vitest';
import { BackendClient } from '../../src/backend-client.js';
import { handler } from '../../src/tools/issue-license.js';
import { fakeBackend } from '../helpers/fake-backend.js';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const PRODUCT_ID = '22222222-2222-2222-2222-222222222222';
const FUTURE = '2027-12-31T23:59:59Z';

function makeBackend(routes: Parameters<typeof fakeBackend>[0]): BackendClient {
  return new BackendClient({ baseUrl: 'http://test', fetch: fakeBackend(routes) });
}

function readJson(result: { content?: { type: string; text?: string }[] | undefined }): unknown {
  return JSON.parse((result.content?.[0] as { text: string }).text);
}

function readErrorText(result: { content?: { type: string; text?: string }[] | undefined }): string {
  return (result.content?.[0] as { text: string }).text;
}

describe('issue_license handler', () => {
  it('returns the new license record on happy path (POST body serialized correctly)', async () => {
    const newLicense = {
      id: 'l1',
      status: 'active',
      created_at: '2026-06-01T00:00:00Z',
      expires_at: FUTURE,
      user_id: USER_ID,
      product_id: PRODUCT_ID,
    };
    const backend = makeBackend([
      {
        method: 'POST',
        path: '/licenses',
        body: { user_id: USER_ID, product_id: PRODUCT_ID, expires_at: FUTURE },
        response: { status: 201, body: newLicense },
      },
    ]);

    const result = await handler(
      { user_id: USER_ID, product_id: PRODUCT_ID, expires_at: FUTURE },
      { backend },
    );
    expect(result.isError).toBe(false);
    expect(readJson(result)).toEqual(newLicense);
  });

  it('translates expires_at_in_past (400) into the diagnose-then-act rewrite', async () => {
    const backend = makeBackend([
      {
        method: 'POST',
        path: '/licenses',
        response: {
          status: 400,
          body: { error: 'expires_at_in_past', message: 'expires_at must be in the future' },
        },
      },
    ]);

    const result = await handler(
      { user_id: USER_ID, product_id: PRODUCT_ID, expires_at: '2020-01-01T00:00:00Z' },
      { backend },
    );
    expect(result.isError).toBe(true);
    const text = readErrorText(result);
    expect(text).toMatch(/re-read the human's request/i);
    expect(text).toMatch(/ask them to clarify/i);
    expect(text).toMatch(/"error":"expires_at_in_past"/);
  });

  it('translates duplicate_active_license (409, rejection path) with existing_expires_at in details', async () => {
    const backend = makeBackend([
      {
        method: 'POST',
        path: '/licenses',
        response: {
          status: 409,
          body: {
            error: 'duplicate_active_license',
            message: 'already covered',
            details: { existing_expires_at: '2027-12-31T23:59:59Z' },
          },
        },
      },
    ]);

    const result = await handler(
      { user_id: USER_ID, product_id: PRODUCT_ID, expires_at: '2026-06-01T00:00:00Z' },
      { backend },
    );
    expect(result.isError).toBe(true);
    const text = readErrorText(result);
    expect(text).toMatch(/already has an Active license/i);
    expect(text).toMatch(/compute a later expires_at/i);
    expect(text).toMatch(/"error":"duplicate_active_license"/);
    expect(text).toMatch(/2027-12-31T23:59:59Z/);
  });

  it('succeeds when the duplicate-license policy resolves to REPLACEMENT (later expires_at)', async () => {
    // The replacement path: the backend revoked the old license and inserted
    // a new Active one. The tool sees a 201 success — the old license being
    // revoked is the backend's invisible side effect.
    const replacement = {
      id: 'l-new',
      status: 'active',
      created_at: '2026-06-01T00:00:00Z',
      expires_at: FUTURE,
      user_id: USER_ID,
      product_id: PRODUCT_ID,
    };
    const backend = makeBackend([
      {
        method: 'POST',
        path: '/licenses',
        body: { user_id: USER_ID, product_id: PRODUCT_ID, expires_at: FUTURE },
        response: { status: 201, body: replacement },
      },
    ]);

    const result = await handler(
      { user_id: USER_ID, product_id: PRODUCT_ID, expires_at: FUTURE },
      { backend },
    );
    expect(result.isError).toBe(false);
    expect(readJson(result)).toEqual(replacement);
  });

  it('translates not_found (404, FK violation) with the USER-OR-PRODUCT variant wording', async () => {
    const backend = makeBackend([
      {
        method: 'POST',
        path: '/licenses',
        response: {
          status: 404,
          body: {
            error: 'not_found',
            message: 'Referenced user or product does not exist',
          },
        },
      },
    ]);

    const result = await handler(
      { user_id: USER_ID, product_id: PRODUCT_ID, expires_at: FUTURE },
      { backend },
    );
    expect(result.isError).toBe(true);
    const text = readErrorText(result);
    expect(text).toMatch(/either the user_id or product_id/i);
    expect(text).toMatch(/find_user_by_email/);
    expect(text).toMatch(/list_products/);
    expect(text).toMatch(/"error":"not_found"/);
  });
});
