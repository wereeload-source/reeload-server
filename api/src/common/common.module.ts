import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { DbService } from './db.js';
import { HttpErrorFilter } from './http-error.filter.js';

@Global()
@Module({
  providers: [
    DbService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: HttpErrorFilter },
  ],
  exports: [DbService],
})
export class CommonModule {}
