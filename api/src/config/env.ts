import { z } from 'zod';

/** Everything the API reads from `.env`, checked once at start-up so a typo fails fast and loudly. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_URL: z.string().url().default('http://localhost:3000'),
  /** Set to the number of proxies in front of the API (e.g. 1), or `true`. Leave empty when there is none. */
  TRUST_PROXY: z.string().optional(),

  /** Postgres. On Supabase: the transaction pooler string (port 6543). */
  DATABASE_URL: z.string().min(1),
  /** Supabase: the direct/session string (port 5432), used only by `prisma migrate`. */
  DIRECT_URL: z.string().optional(),
  /** Supabase's SSL certificate (PEM; newlines may be written as \n). When set, the database certificate is verified. */
  DATABASE_CA_CERT: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  /** At least 32 random characters. Signs access tokens. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  /** Access tokens are short; the refresh token keeps a reelmaker signed in through a shoot day. */
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('14d'),
  /** Mixed into OTP and download-link hashes. Set once in production and never change it. */
  HASH_PEPPER: z.string().default(''),

  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_OTP_TEMPLATE: z.string().default('reeload_checkin_otp'),
  WHATSAPP_TEMPLATE_LANG: z.string().default('en'),

  /** Cloudflare R2 (private bucket). Needed by uploads and download links. */
  R2_ACCOUNT_ID: z.string().optional(),
  /** Development only: an S3-compatible stand-in such as `pnpm storage:local` (http://127.0.0.1:9100). Never set in production. */
  R2_ENDPOINT: z.string().url().optional(),
  R2_BUCKET: z.string().default('reeload-files'),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Used by ConfigModule.forRoot({ validate }). */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment (see api/.env.example): ${problems}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.R2_ENDPOINT) {
    throw new Error('Invalid environment: R2_ENDPOINT is for local development only. Remove it in production.');
  }
  return parsed.data;
}
