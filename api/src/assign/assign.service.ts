import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, one, rows } from '../common/db.js';
import type { AuthUser } from '../common/types.js';
import type { AssignJobInput, LeaveInputT, LeaveQueryInput } from './assign.schemas.js';
import {
  ASSIGN_SQL, AWAITING_SQL, CANDIDATES_SQL, CLASHING_SHOOTS_SQL, DELETE_LEAVE_SQL, INSERT_LEAVE_SQL, LIST_LEAVE_SQL,
  QUEUE_SQL, REELMAKERS_SQL,
} from './assign.sql.js';

@Injectable()
export class AssignService {
  constructor(private readonly db: DbService) {}

  async queue(user: AuthUser) {
    return this.db.asUser(user.id, async (tx) => {
      const unassigned = await rows<{ flagged: boolean }>(tx, QUEUE_SQL);
      return { unassigned, flagged: unassigned.filter((j) => j.flagged).length, awaiting_reply: await rows(tx, AWAITING_SQL) };
    });
  }

  candidates(user: AuthUser, jobId: string) {
    return this.db.asUser(user.id, (tx) => rows(tx, CANDIDATES_SQL, [jobId]));
  }

  /** The database refuses leave clashes, overlapping shoots and wrong job states, with plain messages. */
  assign(user: AuthUser, jobId: string, body: AssignJobInput) {
    return this.db.asUser(user.id, (tx) => one(tx, ASSIGN_SQL, [jobId, body.reelmaker_id, body.reason ?? null]));
  }

  reelmakers(user: AuthUser, includeInactive: boolean) {
    return this.db.asUser(user.id, (tx) => rows(tx, REELMAKERS_SQL, [includeInactive]));
  }

  leave(user: AuthUser, q: LeaveQueryInput) {
    return this.db.asUser(user.id, (tx) => rows(tx, LIST_LEAVE_SQL, [q.reelmaker_id ?? null, q.upcoming]));
  }

  addLeave(user: AuthUser, body: LeaveInputT) {
    return this.db.asUser(user.id, async (tx) => {
      const clash = await rows<{ code: string }>(tx, CLASHING_SHOOTS_SQL, [body.reelmaker_id, body.from, body.to]);
      if (clash.length) {
        throw new ConflictException(`They already have ${clash.map((c) => c.code).join(', ')} in this time. Reassign it first.`);
      }
      return one(tx, INSERT_LEAVE_SQL, [body.reelmaker_id, body.from, body.to, body.note ?? null]);
    });
  }

  async removeLeave(user: AuthUser, id: string) {
    const gone = await this.db.asUser(user.id, (tx) => one(tx, DELETE_LEAVE_SQL, [id]));
    if (!gone) throw new NotFoundException('Leave not found');
    return { ok: true };
  }
}
