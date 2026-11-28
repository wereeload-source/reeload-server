import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, one, rows } from '../common/db.js';
import { istDayRange, istMonthRange, istToday } from '../common/time.js';
import type { AuthUser } from '../common/types.js';
import { SETTING_KEYS, SETTING_RULES, type AuditQueryInput, type DayQueryInput, type MonthQueryInput, type SettingKey } from './insights.schemas.js';
import {
  AUDIT_SQL, CALENDAR_DAY_SQL, CALENDAR_MONTH_SQL, DASH_APPROVALS_SQL, DASH_CHECKINS_SQL, DASH_CONTACTS_SQL, DASH_MONEY_SQL,
  DASH_OVERDUE_SQL, DASH_STATUS_SQL, DASH_TODAY_SQL, DASH_UNASSIGNED_SQL, LIST_SETTINGS_SQL, MY_CALENDAR_SQL, UPDATE_SETTING_SQL,
} from './insights.sql.js';

@Injectable()
export class InsightsService {
  constructor(private readonly db: DbService) {}

  calendarMonth(user: AuthUser, q: MonthQueryInput) {
    const month = q.month ?? istToday().slice(0, 7);
    const { from, to } = istMonthRange(month);
    return this.db.asUser(user.id, async (tx) => ({ month, days: await rows(tx, CALENDAR_MONTH_SQL, [from, to]) }));
  }

  calendarDay(user: AuthUser, q: DayQueryInput) {
    const date = q.date ?? istToday();
    const { from, to } = istDayRange(date);
    return this.db.asUser(user.id, async (tx) => ({ date, jobs: await rows(tx, CALENDAR_DAY_SQL, [from, to]) }));
  }

  myCalendar(user: AuthUser, q: MonthQueryInput) {
    const month = q.month ?? istToday().slice(0, 7);
    const { from, to } = istMonthRange(month);
    return this.db.asUser(user.id, async (tx) => ({ month, days: await rows(tx, MY_CALENDAR_SQL, [from, to]) }));
  }

  /** The Admin overview: what needs attention today, and the numbers behind it. */
  async dashboard(user: AuthUser) {
    const today = istDayRange(istToday());
    const month = istMonthRange(istToday().slice(0, 7));
    return this.db.asUser(user.id, async (tx) => {
      const status = await rows<{ status: string; n: number }>(tx, DASH_STATUS_SQL);
      return {
        generated_at: new Date().toISOString(),
        jobs_by_status: Object.fromEntries(status.map((s) => [s.status, s.n])),
        today: await one(tx, DASH_TODAY_SQL, [today.from, today.to]),
        needs_attention: {
          unassigned: await one(tx, DASH_UNASSIGNED_SQL),
          checkins_waiting: (await one<{ waiting: number }>(tx, DASH_CHECKINS_SQL))?.waiting ?? 0,
          uploads_overdue: (await one<{ overdue: number }>(tx, DASH_OVERDUE_SQL, [false]))?.overdue ?? 0,
          approvals: await one(tx, DASH_APPROVALS_SQL),
        },
        money: await one(tx, DASH_MONEY_SQL, [month.from, month.to]),
        sales_today: await one(tx, DASH_CONTACTS_SQL, [today.from, today.to]),
        recent_activity: await rows(tx, AUDIT_SQL, [null, null, null, 10]),
      };
    });
  }

  audit(user: AuthUser, q: AuditQueryInput) {
    return this.db.asUser(user.id, async (tx) => {
      const items = await rows<{ id: string }>(tx, AUDIT_SQL, [q.entity ?? null, q.action ?? null, q.before ?? null, q.limit]);
      return { items, next_before: items.length === q.limit ? items.at(-1)?.id ?? null : null };
    });
  }

  settings(user: AuthUser) {
    return this.db.asUser(user.id, (tx) => rows(tx, LIST_SETTINGS_SQL));
  }

  /** Admin changes a setting; the value must fit that setting's rule. */
  async updateSetting(user: AuthUser, key: string, value: unknown) {
    if (!(SETTING_KEYS as string[]).includes(key)) throw new NotFoundException('Unknown setting');
    const parsed = SETTING_RULES[key as SettingKey].safeParse(value);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'That value is not allowed');
    const row = await this.db.asUser(user.id, (tx) => one(tx, UPDATE_SETTING_SQL, [key, JSON.stringify(parsed.data)]));
    if (!row) throw new NotFoundException('Setting not found');
    return row;
  }
}
