import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createProductBody, productIdParams } from '../schemas/products.js';
import {
  createProduct,
  deleteProduct,
  getProductById,
  listProducts,
} from '../services/products.js';
import {
  listLicensesForProduct,
  listUsersForProduct,
  serializeLicense,
} from '../services/licenses.js';
import type { Database } from '../db/client.js';
import { wrapList } from '../lib/response.js';

export async function registerProductRoutes(app: FastifyInstance, db: Database): Promise<void> {
  const f = app.withTypeProvider<ZodTypeProvider>();

  f.post('/products', { schema: { body: createProductBody } }, async (req, reply) => {
    const product = await createProduct(db, req.body.name);
    return reply.code(201).send(product);
  });

  f.get('/products', async () => {
    const items = await listProducts(db);
    return wrapList(items);
  });

  f.get('/products/:id', { schema: { params: productIdParams } }, async (req) => {
    return getProductById(db, req.params.id);
  });

  f.delete('/products/:id', { schema: { params: productIdParams } }, async (req, reply) => {
    await deleteProduct(db, req.params.id);
    return reply.code(204).send();
  });

  f.get('/products/:id/licenses', { schema: { params: productIdParams } }, async (req) => {
    const items = await listLicensesForProduct(db, req.params.id);
    return wrapList(items.map(serializeLicense));
  });

  f.get('/products/:id/users', { schema: { params: productIdParams } }, async (req) => {
    const items = await listUsersForProduct(db, req.params.id);
    return wrapList(items);
  });
}
