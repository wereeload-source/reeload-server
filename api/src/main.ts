import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule, ObserveInstrument } from './app.module.js';
import { configureApp } from './app.setup.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { instrument: ObserveInstrument });
  configureApp(app);
  app.enableShutdownHooks(); // closes the database pool on SIGTERM
  await app.listen(app.get<ConfigService<Env, true>>(ConfigService).get('PORT', { infer: true }));
}
await bootstrap();
