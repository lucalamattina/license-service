import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { mapErrorToResponse } from '../lib/error-mapper.js';

export async function registerErrorHandler(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    const { status, body } = mapErrorToResponse(err);

    if (status >= 500) {
      req.log.error({ err }, 'unhandled error');
    } else {
      req.log.debug({ code: body.error, msg: body.message }, 'request error');
    }

    return reply.status(status).send(body);
  });
}
