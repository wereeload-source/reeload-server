import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { Prisma } from '../generated/prisma/client.js';

/** camelCase -> snake_case. PascalCase keys (S3's PartNumber and ETag) are protocol names and stay as they are. */
const snake = (key: string): string => (/^[A-Z]/.test(key) ? key : key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));

/**
 * The API speaks snake_case JSON (full_name, starts_at, agreed_amount) while the code uses camelCase.
 * This converts every response on the way out, and turns dates, decimals and big numbers into plain JSON.
 */
export function toWire(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return Number(value);
  if (Prisma.Decimal.isDecimal(value)) return value.toFixed(2);
  if (Array.isArray(value)) return value.map(toWire);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [snake(k), toWire(v)]));
  }
  return value;
}

@Injectable()
export class SnakeCaseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map(toWire));
  }
}
