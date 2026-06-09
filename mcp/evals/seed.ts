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

/** Produces an ISO timestamp `daysAhead` days in the future from now. */
export function futureIso(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();
}
