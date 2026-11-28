import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuditQuery, DayQuery, MonthQuery, type AuditQueryInput, type DayQueryInput, type MonthQueryInput } from './insights.schemas.js';
import { InsightsService } from './insights.service.js';

@Controller()
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('calendar/month')
  @Roles('admin', 'sales', 'ops')
  month(@CurrentUser() user: AuthUser, @Query(new ZodPipe(MonthQuery)) q: MonthQueryInput) {
    return this.insights.calendarMonth(user, q);
  }

  @Get('calendar/day')
  @Roles('admin', 'sales', 'ops')
  day(@CurrentUser() user: AuthUser, @Query(new ZodPipe(DayQuery)) q: DayQueryInput) {
    return this.insights.calendarDay(user, q);
  }

  @Get('me/calendar')
  @Roles('reelmaker')
  mine(@CurrentUser() user: AuthUser, @Query(new ZodPipe(MonthQuery)) q: MonthQueryInput) {
    return this.insights.myCalendar(user, q);
  }

  @Get('dashboard')
  @Roles('admin')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.insights.dashboard(user);
  }

  @Get('audit')
  @Roles('admin')
  audit(@CurrentUser() user: AuthUser, @Query(new ZodPipe(AuditQuery)) q: AuditQueryInput) {
    return this.insights.audit(user, q);
  }

  @Get('settings')
  settings(@CurrentUser() user: AuthUser) {
    return this.insights.settings(user);
  }

  @Put('settings/:key')
  @Roles('admin')
  update(@CurrentUser() user: AuthUser, @Param('key') key: string, @Body() body: { value?: unknown }) {
    return this.insights.updateSetting(user, key, body?.value);
  }
}
