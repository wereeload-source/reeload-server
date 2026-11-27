import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService, one, rows } from '../common/db.js';
import { istDayRange, istToday } from '../common/time.js';
import type { AuthUser } from '../common/types.js';
import type {
  ContactQueryInput, LogContactInput, PriceChangeQueryInput, RecordAdvanceInput, RequestPriceChangeInput,
} from './sales.schemas.js';
import {
  CONTACT_COUNTS_SQL, DECIDE_PRICE_CHANGE_SQL, INSERT_ADVANCE_SQL, INSERT_CONTACT_SQL, JOB_SUMMARY_SQL,
  LIST_CONTACTS_SQL, LIST_PRICE_CHANGES_SQL, REQUEST_PRICE_CHANGE_SQL,
} from './sales.sql.js';

@Injectable()
export class SalesService {
  constructor(private readonly db: DbService) {}

  /** Record the advance, then return the job's money summary so the page shows the new balance. */
  recordAdvance(user: AuthUser, jobId: string, body: RecordAdvanceInput) {
    return this.db.asUser(user.id, async (tx) => {
      const payment = await one(tx, INSERT_ADVANCE_SQL, [jobId, body.amount, body.method, body.reference ?? null]);
      const summary = await one(tx, JOB_SUMMARY_SQL, [jobId]);
      return { payment, summary };
    });
  }

  async summary(user: AuthUser, jobId: string) {
    const s = await this.db.asUser(user.id, (tx) => one(tx, JOB_SUMMARY_SQL, [jobId]));
    if (!s) throw new NotFoundException('Job not found');
    return s;
  }

  requestPriceChange(user: AuthUser, jobId: string, body: RequestPriceChangeInput) {
    return this.db.asUser(user.id, (tx) => one(tx, REQUEST_PRICE_CHANGE_SQL, [jobId, body.delta, body.reason]));
  }

  listPriceChanges(user: AuthUser, q: PriceChangeQueryInput) {
    return this.db.asUser(user.id, (tx) => rows(tx, LIST_PRICE_CHANGES_SQL, [q.status ?? null, q.job_id ?? null]));
  }

  decidePriceChange(user: AuthUser, id: string, approve: boolean) {
    return this.db.asUser(user.id, (tx) => one(tx, DECIDE_PRICE_CHANGE_SQL, [id, approve]));
  }

  logContact(user: AuthUser, body: LogContactInput) {
    return this.db.asUser(user.id, (tx) =>
      one(tx, INSERT_CONTACT_SQL, [body.client_id ?? null, body.client_name, body.phone ?? null, body.outcome, body.note ?? null]),
    );
  }

  /** The day's calls plus per-salesperson counts. Sales see their own; Admin sees all. */
  async contacts(user: AuthUser, q: ContactQueryInput) {
    const date = q.date ?? istToday();
    const { from, to } = istDayRange(date);
    return this.db.asUser(user.id, async (tx) => ({
      date,
      counts: await rows(tx, CONTACT_COUNTS_SQL, [from, to]),
      items: await rows(tx, LIST_CONTACTS_SQL, [from, to, q.limit]),
    }));
  }
}
