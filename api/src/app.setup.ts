import type { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './config/env.js';

/** Basic hardening headers for an API that only ever returns JSON or CSV. */
function securityHeaders(production: boolean) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

/** Everything main.ts adds to the app besides listening. The e2e tests call it too, so they run the real setup. */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const http = app.getHttpAdapter().getInstance() as { disable(name: string): void; set(name: string, value: unknown): void };
  http.disable('x-powered-by');
  // Behind a proxy (Render, Fly, Railway...) the real client address comes from X-Forwarded-For.
  const proxy = config.get('TRUST_PROXY', { infer: true });
  if (proxy) http.set('trust proxy', proxy === 'true' ? true : Number(proxy) || proxy);

  app.use(securityHeaders(config.get('NODE_ENV', { infer: true }) === 'production'));
  // Sign-in travels in httpOnly cookies: parse them before any route runs.
  app.use(cookieParser());
  // The web app calls the API from the browser with credentials (its cookies), from these origins only.
  app.enableCors({
    origin: config.get('FRONTEND_URL', { infer: true }),
    credentials: true,
    allowedHeaders: ['Content-Type'],
    exposedHeaders: ['Content-Disposition'],
  });
}
