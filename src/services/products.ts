import { eq } from 'drizzle-orm';
import { products } from '../db/schema.js';
import type { Database } from '../db/client.js';
import { ApiError } from '../lib/errors.js';

export type Product = typeof products.$inferSelect;

export async function createProduct(db: Database, name: string): Promise<Product> {
  const [product] = await db.insert(products).values({ name }).returning();
  return product!;
}

export async function getProductById(db: Database, id: string): Promise<Product> {
  const [product] = await db.select().from(products).where(eq(products.id, id));
  if (!product) {
    throw ApiError.notFound(`Product ${id} not found`);
  }
  return product;
}

export async function listProducts(db: Database): Promise<Product[]> {
  return db.select().from(products);
}

export async function deleteProduct(db: Database, id: string): Promise<void> {
  const deleted = await db
    .delete(products)
    .where(eq(products.id, id))
    .returning({ id: products.id });
  if (deleted.length === 0) {
    throw ApiError.notFound(`Product ${id} not found`);
  }
}
