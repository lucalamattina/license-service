/**
 * A small route-matching stub of `fetch` for testing tools in Phases 2-6.
 *
 * Tests construct a `BackendClient` with the fetch returned by `fakeBackend([...])`
 * and the canned routes the tool under test is expected to hit. Anything else
 * the client tries to fetch throws (with a clear message) so missing route
 * setups fail loudly.
 */

export interface FakeRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Pathname only, no query string. e.g. `/users/by-email`. */
  path: string;
  /** Optional query-string match. All entries must match exactly. */
  query?: Record<string, string>;
  /** Optional request-body match. The stub serializes the actual body to JSON for comparison. */
  body?: unknown;
  response: { status: number; body: unknown };
}

export function fakeBackend(routes: FakeRoute[]): typeof fetch {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const requestUrl = new URL(typeof url === 'string' ? url : url.toString());
    const method = (init?.method ?? 'GET').toUpperCase();

    const match = routes.find((route) => {
      if (route.method !== method) return false;
      if (route.path !== requestUrl.pathname) return false;
      if (route.query) {
        for (const [key, value] of Object.entries(route.query)) {
          if (requestUrl.searchParams.get(key) !== value) return false;
        }
      }
      if (route.body !== undefined) {
        const actualBody = init?.body as string | undefined;
        if (JSON.stringify(route.body) !== actualBody) return false;
      }
      return true;
    });

    if (!match) {
      throw new Error(
        `fakeBackend: no route matches ${method} ${requestUrl.pathname}${requestUrl.search}`,
      );
    }

    return new Response(JSON.stringify(match.response.body), {
      status: match.response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
