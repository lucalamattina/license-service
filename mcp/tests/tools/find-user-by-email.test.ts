import { describe, expect, it } from 'vitest';
import { BackendClient } from '../../src/backend-client.js';
import { handler } from '../../src/tools/find-user-by-email.js';
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

describe('find_user_by_email handler', () => {
  it('returns { user: {...} } on match and reports success (isError: false)', async () => {
    const backend = makeBackend([
      {
        method: 'GET',
        path: '/users/by-email',
        query: { email: 'alice@example.com' },
        response: {
          status: 200,
          body: { user: { id: 'u1', email: 'alice@example.com' } },
        },
      },
    ]);

    const result = await handler({ email: 'alice@example.com' }, { backend });
    expect(result.isError).toBe(false);
    expect(readJson(result)).toEqual({ user: { id: 'u1', email: 'alice@example.com' } });
  });

  it('returns { user: null } on no match — a tool success, NOT a tool error', async () => {
    const backend = makeBackend([
      {
        method: 'GET',
        path: '/users/by-email',
        query: { email: 'ghost@example.com' },
        response: { status: 200, body: { user: null } },
      },
    ]);

    const result = await handler({ email: 'ghost@example.com' }, { backend });
    expect(result.isError).toBe(false);
    expect(readJson(result)).toEqual({ user: null });
  });

  it('translates a backend 5xx into a tool error via the section-7 pipeline', async () => {
    const backend = makeBackend([
      {
        method: 'GET',
        path: '/users/by-email',
        query: { email: 'alice@example.com' },
        response: {
          status: 500,
          body: { error: 'internal_error', message: 'boom' },
        },
      },
    ]);

    const result = await handler({ email: 'alice@example.com' }, { backend });
    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toMatch(/unexpected internal error/i);
    expect(text).toMatch(/"error":"internal_error"/);
  });

  it('URL-encodes the email so + and similar characters do not get reinterpreted', async () => {
    // Plus sign in an email (alias addressing). If the tool didn't encode it,
    // the backend would receive a space instead of a +.
    const backend = makeBackend([
      {
        method: 'GET',
        path: '/users/by-email',
        query: { email: 'alice+tag@example.com' },
        response: {
          status: 200,
          body: { user: { id: 'u1', email: 'alice+tag@example.com' } },
        },
      },
    ]);

    const result = await handler({ email: 'alice+tag@example.com' }, { backend });
    expect(result.isError).toBe(false);
    expect(readJson(result)).toEqual({
      user: { id: 'u1', email: 'alice+tag@example.com' },
    });
  });
});
