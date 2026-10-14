import { randomUUID } from 'node:crypto';
import { LogController, type FastifyBaseLogger } from 'fastify';
import type { IncomingMessage } from 'node:http';
import type { AppWithLogger } from './health.ts';

export const REQUEST_ID_HEADER = 'x-request-id';

// Accept an upstream ID only if it is short and uses a safe character set (no log injection).
const ACCEPTABLE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Reuses a well-formed incoming X-Request-ID, otherwise generates a new UUID. */
export function resolveRequestId(incoming: string | string[] | undefined): string {
  return typeof incoming === 'string' && ACCEPTABLE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

/** Fastify options that make every request log line carry `request_id`. */
export function observabilityServerOptions<L extends FastifyBaseLogger>(
  logger: L,
): { loggerInstance: L; logController: LogController; genReqId: (req: IncomingMessage) => string } {
  return {
    loggerInstance: logger,
    logController: new LogController({ requestIdLogLabel: 'request_id' }),
    genReqId: (req: IncomingMessage) => resolveRequestId(req.headers[REQUEST_ID_HEADER]),
  };
}

/** Echoes the request ID back to the client so support can correlate a response with logs. */
export function registerRequestIdHeader<L extends FastifyBaseLogger>(app: AppWithLogger<L>): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });
}
