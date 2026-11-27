import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DbService } from '../common/db.js';
import { Public } from '../common/decorators.js';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  /** For uptime checks. 200 when the database answers, 503 when it does not. */
  @Public()
  @Get()
  async check() {
    try {
      await this.db.asService((tx) => tx.query('select 1'));
    } catch {
      throw new ServiceUnavailableException('Database is not reachable');
    }
    return { status: 'ok', time: new Date().toISOString() };
  }
}
