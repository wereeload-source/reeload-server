import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { AuthorizationModule } from '@nestjs/authorization';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccessPolicy } from './access/access.policy.js';
import { AssignModule } from './assign/assign.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CheckinModule } from './checkin/checkin.module.js';
import { ApiErrorFilter } from './common/api-error.filter.js';
import { CommonModule } from './common/common.module.js';
import { SnakeCaseInterceptor } from './common/snake-case.interceptor.js';
import { EnvelopeInterceptor } from './common/envelope.interceptor.js';
import { throttlers } from './common/throttle.js';
import { type Env, validateEnv } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { InsightsModule } from './insights/insights.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { MoneyModule } from './money/money.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ReviewModule } from './review/review.module.js';
import { SalesModule } from './sales/sales.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { ShareModule } from './share/share.module.js';
import { ShootsModule } from './shoots/shoots.module.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { UsersModule } from './users/users.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Distributed tracing, logs, metrics and alarms: sign up at https://observe.nestjs.com,
    // then run `pnpm dlx @nestjs/observe link` to write your key pair into .env.
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY ?? 'YOUR_APP_KEY',
      appSecret: process.env.OBSERVE_APP_SECRET ?? 'YOUR_APP_SECRET',
      serviceId: 'reeload-server',
    }),
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    // Password tries and reset codes have their own, tighter limits (common/throttle.ts).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => throttlers(config.get('PASSWORD_RESET_RATE_LIMIT_PER_HOUR', { infer: true })),
    }),
    // Cookie JWT sign-in (auth/): it must come before authorization, whose guard reads request.user.
    AuthModule,
    // Who may do what lives in one class: access/access.policy.ts. Routes without a rule are refused.
    AuthorizationModule.forRoot({ policies: [AccessPolicy] }),
    PrismaModule,
    CommonModule,
    MoneyModule,
    SettingsModule,
    UsersModule,
    JobsModule,
    SalesModule,
    AssignModule,
    NotificationsModule,
    ShootsModule,
    CheckinModule,
    UploadsModule,
    ReviewModule,
    LedgerModule,
    ShareModule,
    InsightsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: StandardSchemaValidationPipe },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: SnakeCaseInterceptor },
    // Every JSON answer is { data } (files and CSV are sent as they are).
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: ApiErrorFilter },
  ],
})
export class AppModule {}
