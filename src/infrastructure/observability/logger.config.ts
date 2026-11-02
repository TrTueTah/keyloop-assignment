import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Params } from 'nestjs-pino';
import { AlsRequestContextStore } from './als-request-context';

/** Paths redacted as a second safety net; PII must never be logged in the first place (VII). */
export const REDACT_PATHS = [
  '*.email',
  '*.phone',
  '*.name',
  '*.*.email',
  '*.*.phone',
  '*.*.name',
  'req.headers.authorization',
  'req.headers.cookie',
];

export function loggerParams(
  level: string,
  store: AlsRequestContextStore,
  destination?: NodeJS.WritableStream,
): Params {
  return {
    pinoHttp: [
      {
        level,
        redact: REDACT_PATHS,
        genReqId: (req: IncomingMessage) =>
          store.current()?.requestId ??
          (req.headers['x-request-id'] as string | undefined) ??
          randomUUID(),
        // pino-http calls customProps twice: at request start (bindings of the request's child
        // logger, which the completion line inherits) and again for the completion line. Emitting
        // each key in only one phase avoids duplicate JSON keys. trace_id/span_id are injected by
        // the OTel pino instrumentation, so they are not added here.
        customProps: (_req: IncomingMessage, res: ServerResponse) => {
          const ctx = store.current();
          if (!res.headersSent) return { request_id: ctx?.requestId };
          return { tenant_id: ctx?.tenant?.tenantId, dealership_id: ctx?.tenant?.dealershipId };
        },
        serializers: {
          req: (req: IncomingMessage & { id?: string }) => ({
            id: req.id,
            method: req.method,
            url: req.url,
          }),
          res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
        },
      },
      ...(destination ? [destination] : []),
    ] as Params['pinoHttp'],
  };
}
