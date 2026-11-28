import { createHash, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 10;

/** Hashes from before the switch to bcrypt: `$scrypt$ln=17,r=8,p=1$<salt>$<key>` (base64, no padding). */
const LEGACY = /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,3}),p=(\d{1,3})\$([A-Za-z0-9+/]{16,})\$([A-Za-z0-9+/]{16,})$/;

function legacyScrypt(password: string, encoded: string): Promise<boolean> {
  const m = LEGACY.exec(encoded);
  if (!m) return Promise.resolve(false);
  const [logN, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const salt = Buffer.from(m[4], 'base64');
  const key = Buffer.from(m[5], 'base64');
  const N = 2 ** logN;
  return new Promise((resolve) =>
    scryptCb(Buffer.from(password.normalize('NFKC'), 'utf8'), salt, key.length, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 }, (err, out) =>
      resolve(!err && out.length === key.length && timingSafeEqual(out, key)),
    ),
  );
}

/** sha256 hex, for reset links and one-time codes (short-lived, single use: bcrypt is unnecessary there). */
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Compares two sha256 hex digests with a length check and a timing-safe comparison. */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** bcrypt (cost 10) for passwords and for the refresh token kept on a session. */
@Injectable()
export class Passwords {
  /** Compared against when there is no account, so a missing account takes as long as a wrong password. */
  private readonly dummy = bcrypt.hashSync('timing-equaliser-not-a-password', BCRYPT_ROUNDS);

  hash(value: string): Promise<string> {
    return bcrypt.hash(value, BCRYPT_ROUNDS);
  }

  /** True when `value` matches `hash`. Accepts the old scrypt hashes too (see needsUpgrade). */
  async verify(value: string, hash: string | null | undefined): Promise<boolean> {
    if (!hash) {
      await bcrypt.compare(value, this.dummy);
      return false;
    }
    if (hash.startsWith('$scrypt$')) return legacyScrypt(value, hash);
    return bcrypt.compare(value, hash);
  }

  /** A password still stored in the old scrypt format: re-hash it with bcrypt after a successful sign-in. */
  needsUpgrade(hash: string): boolean {
    return !hash.startsWith('$2');
  }
}
