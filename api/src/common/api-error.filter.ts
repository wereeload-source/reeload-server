import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';

const log = new Logger('Errors');

/**
 * One error shape for the client: { statusCode, message }. HTTP errors pass through; database errors
 * that mean "that already exists" or "not found" become plain messages; anything else is logged and hidden.
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      res.status(exception.getStatus()).json(typeof body === 'string' ? { statusCode: exception.getStatus(), message: body } : body);
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const known: Record<string, [number, string]> = {
        P2002: [409, 'That already exists'],
        P2025: [404, 'Not found'],
        P2003: [400, 'That refers to something that does not exist'],
        P2034: [409, 'That changed at the same moment. Try again.'],
      };
      const hit = known[exception.code];
      if (hit) {
        res.status(hit[0]).json({ statusCode: hit[0], message: hit[1] });
        return;
      }
    }

    log.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    res.status(500).json({ statusCode: 500, message: 'Something went wrong on our side. Try again.' });
  }
}
