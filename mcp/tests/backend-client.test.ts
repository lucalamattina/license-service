import { describe, expect, it } from 'vitest';
import { BackendCallError, BackendClient } from '../src/backend-client.js';

const BASE_URL = 'https://backend.test';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('BackendClient', () => {
  describe('happy paths', () => {
    it('returns parsed JSON on a 200 GET', async () => {
      const fetchStub = async () => jsonResponse(200, { user: { id: 'u1', email: 'a@x.com' } });
      const client = new BackendClient({ baseUrl: BASE_URL, fetch: fetchStub });

      const result = await client.get<{ user: { id: string; email: string } }>(
        '/users/by-email?email=a@x.com',
      );
      expect(result.user.id).toBe('u1');
    });

    it('returns parsed JSON on a 201 POST and serializes the body as JSON', async () => {
      let capturedBody: string | undefined;
      const fetchStub = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        capturedBody = init?.body as string;
        return jsonResponse(201, { id: 'u1', email: 'a@x.com' });
      };
      const client = new BackendClient({ baseUrl: BASE_URL, fetch: fetchStub });

      const result = await client.post<{ id: string }>('/users', { email: 'a@x.com' });
      expect(result.id).toBe('u1');
      expect(capturedBody).toBe('{"email":"a@x.com"}');
    });

    it('builds URLs correctly when baseUrl has a trailing slash and path does not (and vice versa)', async () => {
      const captured: string[] = [];
      const fetchStub = async (url: string | URL | Request): Promise<Response> => {
        captured.push(url.toString());
        return jsonResponse(200, {});
      };

      await new BackendClient({ baseUrl: 'https://x.test/', fetch: fetchStub }).get('/users');
      await new BackendClient({ baseUrl: 'https://x.test', fetch: fetchStub }).get('users');

      expect(captured).toEqual(['https://x.test/users', 'https://x.test/users']);
    });
  });

  describe('backend errors (4xx, 5xx) — no retry, surfaced immediately', () => {
    it('throws BackendCallError with the backend body on 400', async () => {
      let callCount = 0;
      const fetchStub = async (): Promise<Response> => {
        callCount++;
        return jsonResponse(400, {
          error: 'validation_error',
          message: 'bad input',
          details: [{ path: ['email'], message: 'invalid' }],
        });
      };
      const client = new BackendClient({ baseUrl: BASE_URL, fetch: fetchStub });

      await expect(client.get('/users/by-email?email=x')).rejects.toMatchObject({
        name: 'BackendCallError',
        detail: {
          kind: 'backend_error',
          status: 400,
          body: { error: 'validation_error', message: 'bad input' },
        },
      });
      expect(callCount).toBe(1);
    });

    it('throws BackendCallError on 409 with no retry', async () => {
      let callCount = 0;
      const fetchStub = async (): Promise<Response> => {
        callCount++;
        return jsonResponse(409, {
          error: 'duplicate_active_license',
          message: 'covered',
          details: { existing_expires_at: '2026-12-31T23:59:59Z' },
        });
      };
      const client = new BackendClient({ baseUrl: BASE_URL, fetch: fetchStub });

      await expect(client.post('/licenses', {})).rejects.toMatchObject({
        detail: { kind: 'backend_error', status: 409 },
      });
      expect(callCount).toBe(1);
    });

    it('synthesises a structured error when the backend returns 500 with non-JSON body', async () => {
      const fetchStub = async (): Promise<Response> =>
        new Response('<html>Heroku error page</html>', {
          status: 500,
          headers: { 'Content-Type': 'text/html' },
        });
      const client = new BackendClient({ baseUrl: BASE_URL, fetch: fetchStub });

      await expect(client.get('/users')).rejects.toMatchObject({
        detail: {
          kind: 'backend_error',
          status: 500,
          body: { error: 'internal_error' },
        },
      });
    });

    it('synthesises an error when 4xx body is JSON but missing the expected fields', async () => {
      const fetchStub = async (): Promise<Response> => jsonResponse(503, { unexpected: 'shape' });
      const client = new BackendClient({ baseUrl: BASE_URL, fetch: fetchStub });

      await expect(client.get('/users')).rejects.toMatchObject({
        detail: {
          kind: 'backend_error',
          status: 503,
          body: { error: 'internal_error' },
        },
      });
    });
  });

  describe('network errors — one retry', () => {
    it('retries exactly once on a network error and succeeds on the retry', async () => {
      let callCount = 0;
      const fetchStub = async (): Promise<Response> => {
        callCount++;
        if (callCount === 1) {
          throw new TypeError('fetch failed');
        }
        return jsonResponse(200, { ok: true });
      };
      const client = new BackendClient({
        baseUrl: BASE_URL,
        fetch: fetchStub,
        retryDelayMs: 0,
      });

      const result = await client.get<{ ok: boolean }>('/health');
      expect(result.ok).toBe(true);
      expect(callCount).toBe(2);
    });

    it('throws backend_unreachable after the one retry is exhausted', async () => {
      let callCount = 0;
      const fetchStub = async (): Promise<Response> => {
        callCount++;
        throw new TypeError('fetch failed');
      };
      const client = new BackendClient({
        baseUrl: BASE_URL,
        fetch: fetchStub,
        retryDelayMs: 0,
      });

      await expect(client.get('/health')).rejects.toMatchObject({
        detail: { kind: 'network_error', reason: 'fetch failed' },
      });
      expect(callCount).toBe(2);
    });

    it('does NOT retry on a 5xx response (only on network errors)', async () => {
      let callCount = 0;
      const fetchStub = async (): Promise<Response> => {
        callCount++;
        return jsonResponse(500, { error: 'internal_error', message: 'boom' });
      };
      const client = new BackendClient({
        baseUrl: BASE_URL,
        fetch: fetchStub,
        retryDelayMs: 0,
      });

      await expect(client.get('/health')).rejects.toMatchObject({
        detail: { kind: 'backend_error', status: 500 },
      });
      expect(callCount).toBe(1);
    });

    it('treats a timeout-induced AbortError as a network error and retries', async () => {
      let callCount = 0;
      const fetchStub = async (
        _url: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        callCount++;
        // Hang until the signal fires, then reject as AbortError.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      };
      const client = new BackendClient({
        baseUrl: BASE_URL,
        fetch: fetchStub,
        timeoutMs: 20,
        retryDelayMs: 0,
      });

      await expect(client.get('/health')).rejects.toBeInstanceOf(BackendCallError);
      expect(callCount).toBe(2);
    });
  });
});
