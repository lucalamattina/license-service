import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Database } from '../db/client.js';
import { createLicenseBody, licenseIdParams } from '../schemas/licenses.js';
import {
  getLicenseById,
  getLicenseProduct,
  getLicenseUser,
  issueLicense,
  listLicenses,
  serializeLicense,
} from '../services/licenses.js';
import { wrapList } from '../lib/response.js';

export async function registerLicenseRoutes(app: FastifyInstance, db: Database): Promise<void> {
  const f = app.withTypeProvider<ZodTypeProvider>();

  f.post('/licenses', { schema: { body: createLicenseBody } }, async (req, reply) => {
    const license = await issueLicense(db, {
      userId: req.body.user_id,
      productId: req.body.product_id,
      expiresAt: new Date(req.body.expires_at),
    });
    return reply.code(201).send(serializeLicense(license));
  });

  f.get('/licenses', async () => {
    const items = await listLicenses(db);
    return wrapList(items.map(serializeLicense));
  });

  f.get('/licenses/:id', { schema: { params: licenseIdParams } }, async (req) => {
    const license = await getLicenseById(db, req.params.id);
    return serializeLicense(license);
  });

  f.get('/licenses/:id/product', { schema: { params: licenseIdParams } }, async (req) => {
    return getLicenseProduct(db, req.params.id);
  });

  f.get('/licenses/:id/user', { schema: { params: licenseIdParams } }, async (req) => {
    return getLicenseUser(db, req.params.id);
  });
}
