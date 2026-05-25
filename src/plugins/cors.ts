import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { buildOriginMatcher, parseAllowlist } from '../lib/cors-allowlist.js';

export async function registerCors(app: FastifyInstance): Promise<void> {
  const allowlist = parseAllowlist(process.env.CORS_ALLOWED_ORIGINS);
  const isAllowed = buildOriginMatcher(allowlist);

  await app.register(cors, {
    origin: (origin, cb) => {
      // No Origin header → non-browser client (curl, server-to-server health
      // probes, BullMQ internals). CORS doesn't apply; allow.
      if (!origin) {
        cb(null, true);
        return;
      }
      // For browser requests, echo the origin only if it's in the allowlist.
      // Passing `false` to the callback omits the Access-Control-Allow-Origin
      // header, which causes the browser to block.
      cb(null, isAllowed(origin));
    },
    // Deliberately not enabling credentials — the dashboard is unauthenticated.
  });
}
