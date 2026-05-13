import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createUserBody, userIdParams } from '../schemas/users.js';
import {
  createUser,
  deleteUser,
  getUserById,
  listUsers,
} from '../services/users.js';
import {
  listLicensesForUser,
  listProductsForUser,
  serializeLicense,
} from '../services/licenses.js';
import type { Database } from '../db/client.js';
import { wrapList } from '../lib/response.js';

export async function registerUserRoutes(app: FastifyInstance, db: Database): Promise<void> {
  const f = app.withTypeProvider<ZodTypeProvider>();

  f.post('/users', { schema: { body: createUserBody } }, async (req, reply) => {
    const user = await createUser(db, req.body.email);
    return reply.code(201).send(user);
  });

  f.get('/users', async () => {
    const items = await listUsers(db);
    return wrapList(items);
  });

  f.get('/users/:id', { schema: { params: userIdParams } }, async (req) => {
    return getUserById(db, req.params.id);
  });

  f.delete('/users/:id', { schema: { params: userIdParams } }, async (req, reply) => {
    await deleteUser(db, req.params.id);
    return reply.code(204).send();
  });

  f.get('/users/:id/licenses', { schema: { params: userIdParams } }, async (req) => {
    const items = await listLicensesForUser(db, req.params.id);
    return wrapList(items.map(serializeLicense));
  });

  f.get('/users/:id/products', { schema: { params: userIdParams } }, async (req) => {
    const items = await listProductsForUser(db, req.params.id);
    return wrapList(items);
  });
}
