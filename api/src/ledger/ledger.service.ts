import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService, one, rows } from '../common/db.js';
import type { AuthUser } from '../common/types.js';
import { receiptNumber } from './ledger.js';
import type { LedgerQueryInput, RecordPaymentInput } from './ledger.schemas.js';
import {
  JOB_PAYMENTS_SQL, JOB_SUMMARY_SQL, RECEIPT_SQL, RECORD_PAYMENT_SQL, ledgerSql, ledgerTotalsSql,
} from './ledger.sql.js';

@Injectable()
export class LedgerService {
  constructor(private readonly db: DbService) {}

  async ledger(user: AuthUser, q: LedgerQueryInput) {
    const filters = { status: q.status, q: q.q, outstanding: q.outstanding };
    const list = ledgerSql(filters, q.limit, q.offset);
    const totals = ledgerTotalsSql(filters);
    return this.db.asUser(user.id, async (tx) => {
      const items = await rows(tx, list.sql, list.params);
      const t = await one<{ jobs: number }>(tx, totals.sql, totals.params);
      return { items, total: t?.jobs ?? 0, totals: t };
    });
  }

  async jobPayments(user: AuthUser, jobId: string) {
    return this.db.asUser(user.id, async (tx) => {
      const summary = await one(tx, JOB_SUMMARY_SQL, [jobId]);
      if (!summary) throw new NotFoundException('Job not found');
      return { summary, payments: await rows(tx, JOB_PAYMENTS_SQL, [jobId]) };
    });
  }

  /** Accounts records every payment. The database refuses overpayment, cancelled and unconfirmed jobs. */
  recordPayment(user: AuthUser, jobId: string, body: RecordPaymentInput) {
    return this.db.asUser(user.id, async (tx) => {
      const payment = await one(tx, RECORD_PAYMENT_SQL, [
        jobId, body.amount, body.method, body.reference ?? null, body.is_advance, body.received_at ?? null,
      ]);
      // The database marks a released job Paid when this clears the balance.
      return { payment, summary: await one(tx, JOB_SUMMARY_SQL, [jobId]) };
    });
  }

  /** Everything a printable receipt needs; the page prints it. */
  async receipt(user: AuthUser, paymentId: string) {
    return this.db.asUser(user.id, async (tx) => {
      const p = await one<{ id: string; job_id: string; amount: string; method: string; reference: string | null; is_advance: boolean; received_at: Date; received_by: string | null }>(tx, RECEIPT_SQL, [paymentId]);
      if (!p) throw new NotFoundException('Payment not found');
      const job = await one<{ code: string; city: string; client_name: string; agreed_amount: string; approved_changes: string; received: string; balance: string }>(tx, JOB_SUMMARY_SQL, [p.job_id]);
      if (!job) throw new NotFoundException('Job not found');
      return {
        receipt_no: receiptNumber(job.code, p.id),
        issued_at: new Date().toISOString(),
        client_name: job.client_name,
        job_code: job.code,
        city: job.city,
        payment: { amount: p.amount, method: p.method, reference: p.reference, is_advance: p.is_advance, received_at: p.received_at, received_by: p.received_by },
        job_totals: {
          agreed_amount: job.agreed_amount, approved_changes: job.approved_changes, received: job.received, balance: job.balance,
        },
      };
    });
  }
}
