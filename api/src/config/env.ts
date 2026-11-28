import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/** Comma-separated http(s) origins, e.g. "https://app.example.com,http://localhost:3000". */
const origins = z
  .string()
  .transform((v) => v.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean))
  .pipe(z.array(z.string().regex(/^https?:\/\/[^/\s]+$/, 'FRONTEND_URL must list http(s) origins without a path')).min(1));

/** Everything the API reads from `.env`, checked once at start-up so a typo fails fast and loudly. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  /** The web app's origin(s). CORS allows exactly these; links sent to people use the first one. */
  FRONTEND_URL: origins.default('http://localhost:3000'),
  /** Set to the number of proxies in front of the API (e.g. 1), or `true`. Leave empty when there is none. */
  TRUST_PROXY: z.string().optional(),

  /** Postgres. On Supabase: the transaction pooler string (port 6543). */
  DATABASE_URL: z.string().min(1),
  /** Supabase: the direct/session string (port 5432), used only by `prisma migrate`. */
  DIRECT_URL: z.string().optional(),
  /** Supabase's SSL certificate (PEM; newlines may be written as \n). When set, the database certificate is verified. */
  DATABASE_CA_CERT: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  /** Signs access tokens and 5-minute password-reset tickets. At least 48 random characters. */
  JWT_SECRET: z.string().min(48, 'JWT_SECRET must be at least 48 characters'),
  /** Signs refresh tokens only. A different value from JWT_SECRET, at least 48 random characters. */
  JWT_REFRESH_SECRET: z.string().min(48, 'JWT_REFRESH_SECRET must be at least 48 characters'),
  ACCESS_TOKEN_TTL: z.string().regex(/^\d+[smhd]$/, 'Use a lifetime like 15m or 7d').default('15m'),
  REFRESH_TOKEN_TTL: z.string().regex(/^\d+[smhd]$/, 'Use a lifetime like 15m or 7d').default('7d'),

  /** Sign-in cookies (access_token, refresh_token). COOKIE_SECURE must be true when COOKIE_SAME_SITE is none. */
  COOKIE_SECURE: bool.default('false'),
  COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().trim().min(1).optional(),
  COOKIE_PATH: z.string().startsWith('/').default('/'),

  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  PASSWORD_RESET_MAX_OTP_ATTEMPTS: z.coerce.number().int().positive().default(5),
  PASSWORD_RESET_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(3),

  /** Mixed into check-in code and download-link hashes. Set once in production and never change it. */
  HASH_PEPPER: z.string().default(''),

  /** Development only: a fixed six-digit check-in code that always works, so the flow can be tried without WhatsApp. */
  CHECKIN_TEST_CODE: z.string().regex(/^[0-9]{6}$/, 'CHECKIN_TEST_CODE must be six digits').optional(),
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
  // Empty values in .env mean "not set", so defaults and optional fields apply.
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment (see api/.env.example): ${problems}`);
  }
  const env = parsed.data;
  if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
    throw new Error('Invalid environment: JWT_REFRESH_SECRET must be different from JWT_SECRET.');
  }
  if (env.COOKIE_SAME_SITE === 'none' && !env.COOKIE_SECURE) {
    throw new Error('Invalid environment: COOKIE_SECURE must be true when COOKIE_SAME_SITE is none.');
  }
  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
    throw new Error('Invalid environment: set COOKIE_SECURE=true in production (cookies over HTTPS only).');
  }
  if (env.NODE_ENV === 'production' && env.CHECKIN_TEST_CODE) {
    throw new Error('Invalid environment: CHECKIN_TEST_CODE is for development only. Remove it in production.');
  }
  if (env.NODE_ENV === 'production' && env.R2_ENDPOINT) {
    throw new Error('Invalid environment: R2_ENDPOINT is for local development only. Remove it in production.');
  }
  return env;
}
