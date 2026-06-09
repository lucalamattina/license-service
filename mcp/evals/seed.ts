/**
 * Direct-backend seeding helpers for eval pre-state / cleanup.
 *
 * These hit the backend's HTTP surface directly rather than through the MCP
 * layer because pre-state typically needs operations the MCP tools deliberately
 * don't expose (e.g. `POST /users`, `DELETE /users/:id` — section 4 cuts).
 * The seed flow is admin-shaped, not agent-shaped, so the admin-side API is the
 * right level.
 */

export interface UserRecord {
  id: string;
  email: string;
}

export interface ProductRecord {
  id: string;
  name: string;
}

export interface LicenseRecord {
  id: string;
  status: 'active' | 'expired' | 'revoked';
  created_at: string;
  expires_at: string;
  user_id: string;
  product_id: string;
}

async function call<T>(
  baseUrl: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const url = baseUrl.replace(/\/$/, '') + path;
  const init: RequestInit = {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  const response = await fetch(url, init);
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(
      `seed: backend ${method} ${path} returned ${response.status} ${response.statusText}: ${text}`,
    );
  }
  return parsed as T;
}

export async function createUser(baseUrl: string, email: string): Promise<UserRecord> {
  return call<UserRecord>(baseUrl, 'POST', '/users', { email });
}

export async function createProduct(baseUrl: string, name: string): Promise<ProductRecord> {
  return call<ProductRecord>(baseUrl, 'POST', '/products', { name });
}

export async function createLicense(
  baseUrl: string,
  args: { user_id: string; product_id: string; expires_at: string },
): Promise<LicenseRecord> {
  return call<LicenseRecord>(baseUrl, 'POST', '/licenses', args);
}

/** Finds a user by email. Returns null if no match. */
export async function findUserByEmail(
  baseUrl: string,
  email: string,
): Promise<UserRecord | null> {
  const result = await call<{ user: UserRecord | null }>(
    baseUrl,
    'GET',
    `/users/by-email?email=${encodeURIComponent(email)}`,
  );
  return result.user;
}

/** Deletes a user (cascades to their licenses). No-op if the user doesn't exist. */
export async function deleteUserIfExists(baseUrl: string, email: string): Promise<void> {
  const user = await findUserByEmail(baseUrl, email);
  if (user) {
    await call(baseUrl, 'DELETE', `/users/${user.id}`);
  }
}

/**
 * Deletes every product whose name appears in `names` (cascades to their
 * licenses). No-op for names not in the catalogue. Lists the full catalogue
 * once and filters in-memory because the backend has no find-by-name endpoint
 * (deliberate — see MCP_DESIGN.md section 4 cuts).
 */
export async function deleteProductsByNames(baseUrl: string, names: string[]): Promise<void> {
  if (names.length === 0) return;
  const wanted = new Set(names);
  // Backend list endpoints all use the `wrapList` envelope, so payload is
  // `{data: [...]}`, not `{products: [...]}`.
  const result = await call<{ data: ProductRecord[] }>(baseUrl, 'GET', '/products');
  for (const p of result.data) {
    if (wanted.has(p.name)) {
      await call(baseUrl, 'DELETE', `/products/${p.id}`);
    }
  }
}

/** Produces an ISO timestamp `daysAhead` days in the future from now. */
export function futureIso(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();
}

/** Produces an ISO timestamp `secondsAhead` seconds in the future from now. */
export function futureIsoSeconds(secondsAhead: number): string {
  return new Date(Date.now() + secondsAhead * 1000).toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Seeds a license that is in the `expired` terminal state.
 *
 * The backend rejects `POST /licenses` with a past `expires_at` server-side,
 * so we can't seed an already-expired record directly. Instead: create with a
 * very-near-future expiration, wait long enough that the clock has passed
 * (with generous slack for client/server skew on a Heroku dyno), then trigger
 * the lazy expire transition via `POST /licenses/:id/validate`.
 *
 * Costs ~4 seconds of wall time per call — used only in the audit workflow case.
 */
export async function createExpiredLicense(
  baseUrl: string,
  args: { user_id: string; product_id: string },
): Promise<LicenseRecord> {
  const NEAR_FUTURE_MS = 1500;
  const SKEW_SLACK_MS = 3000;
  const license = await createLicense(baseUrl, {
    ...args,
    expires_at: new Date(Date.now() + NEAR_FUTURE_MS).toISOString(),
  });
  await sleep(NEAR_FUTURE_MS + SKEW_SLACK_MS);
  await call(baseUrl, 'POST', `/licenses/${license.id}/validate`);
  return call<LicenseRecord>(baseUrl, 'GET', `/licenses/${license.id}`);
}

/** Revokes a license. */
export async function revokeLicenseDirect(
  baseUrl: string,
  licenseId: string,
): Promise<LicenseRecord> {
  return call<LicenseRecord>(baseUrl, 'POST', `/licenses/${licenseId}/revoke`);
}
