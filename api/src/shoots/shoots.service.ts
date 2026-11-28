import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService, one, rows } from '../common/db.js';
import { istToday } from '../common/time.js';
import type { AuthUser } from '../common/types.js';
import type { DropOutInput, HoursQueryInput, RespondShootInput, ShootsQueryInput } from './shoots.schemas.js';
import { DROP_OUT_SQL, HOURS_SQL, MY_SHOOT_SQL, MY_SHOOTS_SQL, PENDING_ASSIGNMENT_FOR_JOB_SQL, RESPOND_SQL } from './shoots.sql.js';

@Injectable()
export class ShootsService {
  constructor(private readonly db: DbService) {}

  mine(user: AuthUser, q: ShootsQueryInput) {
    return this.db.asUser(user.id, (tx) => rows(tx, MY_SHOOTS_SQL, [q.when]));
  }

  async one(user: AuthUser, jobId: string) {
    const s = await this.db.asUser(user.id, (tx) => one(tx, MY_SHOOT_SQL, [jobId]));
    if (!s) throw new NotFoundException('Shoot not found');
    return s;
  }

  /** Accept or decline. A declined job goes back to Operations with the reason. */
  respond(user: AuthUser, jobId: string, body: RespondShootInput) {
    return this.db.asUser(user.id, async (tx) => {
      const pending = await one<{ id: string }>(tx, PENDING_ASSIGNMENT_FOR_JOB_SQL, [jobId]);
      if (!pending) throw new NotFoundException('There is no shoot waiting for your answer');
      return one(tx, RESPOND_SQL, [pending.id, body.accept, body.reason ?? null]);
    });
  }

  /** Give a shoot back after accepting it. Operations and Admin are told. */
  dropOut(user: AuthUser, jobId: string, body: DropOutInput) {
    return this.db.asUser(user.id, (tx) => one(tx, DROP_OUT_SQL, [jobId, body.reason]));
  }

  hours(user: AuthUser, q: HoursQueryInput) {
    const month = `${q.month ?? istToday().slice(0, 7)}-01`;
    // A reelmaker is always limited to their own hours.
    const who = user.role === 'reelmaker' ? user.id : (q.reelmaker_id ?? null);
    return this.db.asUser(user.id, async (tx) => ({ month: month.slice(0, 7), items: await rows(tx, HOURS_SQL, [month, who]) }));
  }
}
