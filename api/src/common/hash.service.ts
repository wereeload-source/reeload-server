import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.js';

/** One-way hashes for check-in codes and download-link tokens (only the hash is ever stored). */
@Injectable()
export class HashService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /** SHA-256 of value + pepper, hex. */
  sha256(value: string): string {
    return createHash('sha256').update(value + this.config.get('HASH_PEPPER', { infer: true })).digest('hex');
  }

  /** Six digits, uniformly random. */
  otp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  /** URL-safe random token. */
  token(bytes = 24): string {
    return randomBytes(bytes).toString('base64url');
  }

  /** Constant-time string comparison. */
  equal(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }
}
