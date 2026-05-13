import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { ApiError } from '../lib/errors.js';
import { mapErrorToResponse } from '../lib/error-mapper.js';

function instancePathToSegments(instancePath: string): string[] {
  return instancePath.split('/').filter((s) => s.length > 0);
}

export async function registerErrorHandler(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    // fastify-type-provider-zod wraps validation failures in a FastifyError whose
    // .validation array carries Zod issues in Fastify's flattened format. Unwrap into
    // an ApiError so the response shape stays consistent with the rest of the API.
    const normalized = hasZodFastifySchemaValidationErrors(err)
      ? ApiError.validationError(
          'Request validation failed',
          err.validation.map((v) => ({
            path: instancePathToSegments(v.instancePath),
            message: v.message ?? 'invalid value',
            code: v.keyword,
          })),
        )
      : err;

    const { status, body } = mapErrorToResponse(normalized);

    if (status >= 500) {
      req.log.error({ err }, 'unhandled error');
    } else {
      req.log.debug({ code: body.error, msg: body.message }, 'request error');
    }

    return reply.status(status).send(body);
  });
}
