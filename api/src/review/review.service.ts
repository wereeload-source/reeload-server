import { Injectable } from '@nestjs/common';
import { DbService, one, rows } from '../common/db.js';
import { istToday } from '../common/time.js';
import type { AuthUser } from '../common/types.js';
import type { AddExtraTimeInput, DecideExtraTimeInput, ExtraTimeQueryInput, HoursDetailQueryInput, SendBackInput } from './review.schemas.js';
import { ADD_EXTRA_TIME_SQL, DECIDE_EXTRA_TIME_SQL, HOURS_DETAIL_SQL, LIST_EXTRA_TIME_SQL, SEND_BACK_SQL } from './review.sql.js';

@Injectable()
export class ReviewService {
  constructor(private readonly db: DbService) {}

  sendBack(user: AuthUser, jobId: string, body: SendBackInput) {
    return this.db.asUser(user.id, (tx) => one(tx, SEND_BACK_SQL, [jobId, body.note]));
  }

  /** Ops adds the extra minutes; Sales/Admin are told to decide whether to charge. */
  addExtraTime(user: AuthUser, jobId: string, body: AddExtraTimeInput) {
    return this.db.asUser(user.id, (tx) => one(tx, ADD_EXTRA_TIME_SQL, [jobId, body.minutes, body.note ?? null]));
  }

  listExtraTime(user: AuthUser, q: ExtraTimeQueryInput) {
    return this.db.asUser(user.id, (tx) => rows(tx, LIST_EXTRA_TIME_SQL, [q.decision ?? null, q.job_id ?? null]));
  }

  /** Charging creates a price change that Admin must still approve. */
  decideExtraTime(user: AuthUser, id: string, body: DecideExtraTimeInput) {
    return this.db.asUser(user.id, (tx) => one(tx, DECIDE_EXTRA_TIME_SQL, [id, body.charge, body.amount ?? null]));
  }

  hoursDetail(user: AuthUser, reelmakerId: string, q: HoursDetailQueryInput) {
    const month = q.month ?? istToday().slice(0, 7);
    // A reelmaker may only open their own month.
    const who = user.role === 'reelmaker' ? user.id : reelmakerId;
    return this.db.asUser(user.id, async (tx) => {
      const items = await rows<{ booked_minutes: number; extra_minutes: number }>(tx, HOURS_DETAIL_SQL, [who, `${month}-01`]);
      const booked = items.reduce((s, r) => s + r.booked_minutes, 0);
      const extra = items.reduce((s, r) => s + r.extra_minutes, 0);
      return { month, reelmaker_id: who, shoots: items.length, booked_hours: booked / 60, extra_hours: extra / 60, total_hours: (booked + extra) / 60, items };
    });
  }
}
