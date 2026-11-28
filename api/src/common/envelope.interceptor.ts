import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';

/**
 * Wraps every JSON response as `{ data }`. Files and other non-JSON answers (the ledger CSV) are
 * sent as they are. Errors are not wrapped: they stay `{ statusCode, message }`.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = ctx.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((body: unknown) => {
        if (body instanceof StreamableFile || Buffer.isBuffer(body)) return body;
        const type = String(res.getHeader('content-type') ?? '');
        if (type && !type.includes('json')) return body;
        return { data: body ?? null };
      }),
    );
  }
}
