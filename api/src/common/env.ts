/** Settings from api/.env. Read lazily, so a missing value only fails the routes that need it. */
function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}. Copy api/.env.example to api/.env and fill it in.`);
  return v;
}

const int = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const env = {
  /** Neon (or any Postgres) connection string. Use the pooled one on Neon. */
  get databaseUrl(): string {
    return need('DATABASE_URL');
  },
  /** At least 32 random characters. Signs the login tokens. */
  get jwtSecret(): string {
    const s = need('JWT_SECRET');
    if (s.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
    return s;
  },
  /** How long a login lasts. Reelmakers stay signed in through a shoot day. */
  get jwtTtlHours(): number {
    return int('JWT_TTL_HOURS', 24);
  },
  get poolMax(): number {
    return int('DB_POOL_MAX', 10);
  },
  /** Mixed into OTP and link-token hashes. Set a long random value in production and never change it. */
  get hashPepper(): string {
    return process.env.HASH_PEPPER ?? '';
  },
  get production(): boolean {
    return process.env.NODE_ENV === 'production';
  },
  /** WhatsApp Business Cloud API. Optional in development: the code is printed to the API log instead. */
  get whatsapp(): { token?: string; phoneId?: string; otpTemplate: string; lang: string } {
    return {
      token: process.env.WHATSAPP_TOKEN || undefined,
      phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID || undefined,
      otpTemplate: process.env.WHATSAPP_OTP_TEMPLATE || 'reelops_checkin_otp',
      lang: process.env.WHATSAPP_TEMPLATE_LANG || 'en',
    };
  },
};
