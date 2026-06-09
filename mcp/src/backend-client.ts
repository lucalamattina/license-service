/**
 * HTTP client for the license-service backend.
 *
 * Tests inject a stub `fetch` via the constructor. Production callers omit it
 * and get the global `fetch`. This sidesteps every network-layer mocking
 * library (MockAgent / msw / global-fetch interception) and keeps the test
 * suite a set of pure unit tests driven by a constructor-injected stub.
 *
 * Retry policy (per MCP_DESIGN.md section 7):
 *   - One retry on network errors (fetch rejects: DNS, connect refused, timeout).
 *   - Zero retries on backend 4xx/5xx (the backend handled the request and chose
 *     to fail; retrying could double-write or just mask the real failure).
 *
 * Timeout: 30 seconds per request via `AbortSignal.timeout` (loose enough to
 * ride out a Heroku Eco dyno cold start, tight enough that the agent doesn't
 * hang indefinitely).
 */

type FetchLike = typeof fetch;

export interface BackendClientOptions {
  baseUrl: string;
  /** Defaults to the Node global `fetch`. Tests pass a stub. */
  fetch?: FetchLike;
  /** Per-request timeout. Defaults to 30_000ms. */
  timeoutMs?: number;
  /** Delay between the first attempt and the one retry, for network errors only. Defaults to 500ms. */
  retryDelayMs?: number;
}

/** The backend's structured error envelope (matches DESIGN.md section "Error response shape"). */
export interface BackendErrorBody {
  error: string;
  message: string;
  details?: unknown;
}

/** The two kinds of failure the client surfaces to its callers. */
export type BackendError =
  | { kind: 'backend_error'; status: number; body: BackendErrorBody }
  | { kind: 'network_error'; reason: string };

/**
 * Thrown by `BackendClient.get` and `.post` on any non-2xx response or after
 * the network retry is exhausted. Tool handlers catch this and translate it
 * via `error-translation.ts`.
 */
export class BackendCallError extends Error {
  readonly detail: BackendError;

  constructor(detail: BackendError) {
    super(
      detail.kind === 'backend_error'
        ? `backend ${detail.status}: ${detail.body.error}`
        : `network error: ${detail.reason}`,
    );
    this.name = 'BackendCallError';
    this.detail = detail;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BackendClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;

  constructor(opts: BackendClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private buildUrl(path: string): string {
    return this.baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = this.buildUrl(path);
    const init: RequestInit = {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    };

    // Up to two attempts total: the initial call plus one retry on network errors.
    let lastNetworkReason = 'unknown';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await sleep(this.retryDelayMs);
      }
      try {
        const response = await this.fetchImpl(url, {
          ...init,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.ok) {
          return (await response.json()) as T;
        }

        // Backend 4xx/5xx: parse the structured body, throw, do NOT retry.
        const errorBody = await this.parseErrorBody(response);
        throw new BackendCallError({
          kind: 'backend_error',
          status: response.status,
          body: errorBody,
        });
      } catch (err) {
        if (err instanceof BackendCallError) {
          // Backend errors bypass the retry loop.
          throw err;
        }
        // Network errors fall through and either retry or surface as backend_unreachable.
        lastNetworkReason = err instanceof Error ? err.message : String(err);
      }
    }

    throw new BackendCallError({
      kind: 'network_error',
      reason: lastNetworkReason,
    });
  }

  private async parseErrorBody(response: Response): Promise<BackendErrorBody> {
    try {
      const body = (await response.json()) as Partial<BackendErrorBody>;
      // Be defensive: the backend's contract says these fields are present, but
      // an upstream proxy / reverse proxy / Heroku error page could break that.
      if (typeof body.error === 'string' && typeof body.message === 'string') {
        return body as BackendErrorBody;
      }
      return {
        error: 'internal_error',
        message: `Backend returned ${response.status} with an unexpected body shape`,
      };
    } catch {
      return {
        error: 'internal_error',
        message: `Backend returned ${response.status} with non-JSON body`,
      };
    }
  }
}
