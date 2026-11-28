import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { AccessPolicy } from '../access/access.policy.js';
import type { AuthUser } from '../common/types.js';
import { SettingsService } from '../settings/settings.service.js';
import { AuditQuery, DayQuery, MonthQuery, type AuditQueryInput, type DayQueryInput, type MonthQueryInput } from './insights.schemas.js';
import { InsightsService } from './insights.service.js';

@Controller()
export class InsightsController {
  constructor(private readonly insights: InsightsService, private readonly settings: SettingsService) {}

  @Get('calendar/month')
  @Can(AccessPolicy, 'viewCalendar')
  month(@Query({ schema: MonthQuery }) q: MonthQueryInput) {
    return this.insights.calendarMonth(q);
  }

  @Get('calendar/day')
  @Can(AccessPolicy, 'viewCalendar')
  day(@Query({ schema: DayQuery }) q: DayQueryInput) {
    return this.insights.calendarDay(q);
  }

  @Get('me/calendar')
  @Can(AccessPolicy, 'viewMyCalendar')
  mine(@CurrentUser() user: AuthUser, @Query({ schema: MonthQuery }) q: MonthQueryInput) {
    return this.insights.myCalendar(user, q);
  }

  @Get('dashboard')
  @Can(AccessPolicy, 'viewDashboard')
  dashboard() {
    return this.insights.dashboard();
  }

  @Get('audit')
  @Can(AccessPolicy, 'viewAudit')
  audit(@Query({ schema: AuditQuery }) q: AuditQueryInput) {
    return this.insights.audit(q);
  }

  /** Any signed-in user may read the settings; only Admin may change them. */
  @Get('settings')
  @Can.Anyone()
  list() {
    return this.settings.list();
  }

  @Put('settings/:key')
  @Can(AccessPolicy, 'editSettings')
  update(@CurrentUser() user: AuthUser, @Param('key') key: string, @Body() body: { value?: unknown }) {
    return this.settings.update(user.id, key, body?.value);
  }
}
