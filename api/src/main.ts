import type { NextFunction, Request, Response } from 'express';
import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';

/** Basic hardening headers for an API that only ever returns JSON or CSV. */
function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  const http = app.getHttpAdapter().getInstance() as { disable(name: string): void; set(name: string, value: unknown): void };
  http.disable('x-powered-by');
  // Behind a proxy (Render, Fly, Railway...) the real client address comes from X-Forwarded-For.
  if (process.env.TRUST_PROXY) http.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  app.use(securityHeaders);
  app.enableShutdownHooks(); // closes the database pool on SIGTERM
  app.enableCors({
    origin: process.env.CLIENT_URL ?? 'http://localhost:3000',
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 4000);
}
await bootstrap();
