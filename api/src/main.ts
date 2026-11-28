import type { NextFunction, Request, Response } from 'express';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule, ObserveInstrument } from './app.module.js';
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

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { instrument: ObserveInstrument });
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const http = app.getHttpAdapter().getInstance() as { disable(name: string): void; set(name: string, value: unknown): void };
  http.disable('x-powered-by');
  // Behind a proxy (Render, Fly, Railway...) the real client address comes from X-Forwarded-For.
  const proxy = config.get('TRUST_PROXY', { infer: true });
  if (proxy) http.set('trust proxy', proxy === 'true' ? true : Number(proxy) || proxy);

  app.use(securityHeaders(config.get('NODE_ENV', { infer: true }) === 'production'));
  app.enableShutdownHooks(); // closes the database pool on SIGTERM
  app.enableCors({ origin: config.get('CLIENT_URL', { infer: true }), credentials: true });
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
