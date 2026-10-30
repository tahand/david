import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiError } from '@clinic/shared';
import { AppError } from '../lib/errors.js';

const body = (code: ApiError['error']['code'], message: string, details?: unknown[]): ApiError => ({
  error: details ? { code, message, details } : { code, message },
});

/** 404 for unmatched /api routes. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(body('NOT_FOUND', 'Not found'));
};

/** body-parser errors carry a `type` and `status`. */
interface HttpParserError extends Error {
  type?: string;
  status?: number;
}

/**
 * Maps errors to the consistent shape from SPEC §9. Only AppError messages and
 * Zod issue summaries reach the client; everything else is logged and reported
 * as a generic 500 without stack traces.
 */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json(body(err.code, err.message, err.details));
    return;
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    res.status(400).json(body('VALIDATION_ERROR', 'Invalid request', details));
    return;
  }
  const parserErr = err as HttpParserError;
  if (parserErr?.type === 'entity.too.large') {
    res.status(413).json(body('PAYLOAD_TOO_LARGE', 'Request body too large'));
    return;
  }
  if (parserErr?.type === 'entity.parse.failed') {
    res.status(400).json(body('VALIDATION_ERROR', 'Malformed JSON body'));
    return;
  }

  req.log?.error({ err }, 'unhandled error');
  res.status(500).json(body('INTERNAL_ERROR', 'Something went wrong'));
};
