import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { messageForDbError, statusForDbError, type DbError } from './db-status.js';

const log = new Logger('Errors');

/** A Postgres error from the `pg` driver has a 5-character SQLSTATE `code` and a `severity`. */
function asPgError(e: unknown): DbError | null {
  if (typeof e !== 'object' || e === null) return null;
  const { code, severity } = e as { code?: unknown; severity?: unknown };
  return typeof code === 'string' && typeof severity === 'string' ? (e as DbError) : null;
}

/**
 * One error shape for the client: { statusCode, message }. HTTP errors pass through; Postgres
 * errors (a workflow function refusing, Row Level Security saying no, a constraint) become a
 * plain-English message with a fitting status; anything else is logged and hidden.
 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      res.status(exception.getStatus()).json(typeof body === 'string' ? { statusCode: exception.getStatus(), message: body } : body);
      return;
    }

    const pgError = asPgError(exception);
    if (pgError) {
      const status = statusForDbError(pgError);
      if (status >= 500) log.error(`${pgError.code ?? ''} ${pgError.message}`);
      res.status(status).json({ statusCode: status, message: messageForDbError(pgError) });
      return;
    }

    log.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    res.status(500).json({ statusCode: 500, message: 'Something went wrong' });
  }
}
