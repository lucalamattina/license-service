import { eq } from 'drizzle-orm';
import { users } from '../db/schema.js';
import type { Database } from '../db/client.js';
import { ApiError } from '../lib/errors.js';

export type User = typeof users.$inferSelect;

const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  if (err && typeof err === 'object' && 'cause' in err) {
    const cause = (err as { cause: unknown }).cause;
    if (cause && typeof cause === 'object' && 'code' in cause) {
      return (cause as { code: string }).code === PG_UNIQUE_VIOLATION;
    }
  }
  return false;
}

export async function createUser(db: Database, email: string): Promise<User> {
  try {
    const [user] = await db.insert(users).values({ email }).returning();
    return user!;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw ApiError.duplicateEmail(`A user with email "${email}" already exists`);
    }
    throw err;
  }
}

export async function getUserById(db: Database, id: string): Promise<User> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) {
    throw ApiError.notFound(`User ${id} not found`);
  }
  return user;
}

export async function listUsers(db: Database): Promise<User[]> {
  return db.select().from(users);
}

/**
 * Find semantics: returns the user if the (already-normalised) email matches,
 * or null if no user exists with that email. Not finding the user is NOT an
 * error here — it's a normal answer to a lookup question. Callers (notably the
 * MCP layer) rely on this being a 200 with a nullable body rather than a 404.
 */
export async function findUserByEmail(db: Database, email: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user ?? null;
}

export async function deleteUser(db: Database, id: string): Promise<void> {
  const deleted = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
  if (deleted.length === 0) {
    throw ApiError.notFound(`User ${id} not found`);
  }
}
