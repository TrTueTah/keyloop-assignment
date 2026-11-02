import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { RequestContextStore } from '../../../application/ports/request-context';

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Starts the per-request context (request id) for everything downstream, including logs. */
export function requestIdMiddleware(store: RequestContextStore) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header('x-request-id');
    const requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-ID', requestId);
    store.run({ requestId }, () => next());
  };
}
