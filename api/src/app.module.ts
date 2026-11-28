import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AssignModule } from './assign/assign.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CheckinModule } from './checkin/checkin.module.js';
import { CommonModule } from './common/common.module.js';
import { HealthModule } from './health/health.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ReviewModule } from './review/review.module.js';
import { SalesModule } from './sales/sales.module.js';
import { ShootsModule } from './shoots/shoots.module.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { UsersModule } from './users/users.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com,
    // then run `npx @nestjs/observe link` to write your key pair into .env.
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY ?? 'YOUR_APP_KEY',
      appSecret: process.env.OBSERVE_APP_SECRET ?? 'YOUR_APP_SECRET',
      serviceId: 'reeload-server',
    }),
    CommonModule,
    AuthModule,
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
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
