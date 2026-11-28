import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators.js';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly prisma: PrismaService,
  ) {}

  /** For uptime checks. 200 when the database answers, 503 when it does not. */
  @Public()
  @SkipThrottle()
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      async () => {
        const indicator = this.indicators.check('database');
        try {
          await this.prisma.$queryRaw`select 1`;
          return indicator.up();
        } catch {
          return indicator.down({ message: 'Database is not reachable' });
        }
      },
    ]);
  }
}
