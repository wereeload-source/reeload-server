import { num } from '../common/time.js';

export interface LedgerRow {
  agreed_amount?: unknown;
  approved_changes?: unknown;
  advance?: unknown;
  received?: unknown;
  balance?: unknown;
}

/** Column totals for the payments ledger. */
export function ledgerTotals(rows: LedgerRow[]) {
  const t = { total: 0, advance: 0, received: 0, balance: 0, outstanding: 0 };
  for (const r of rows) {
    t.total += num(r.agreed_amount) + num(r.approved_changes);
    t.advance += num(r.advance);
    t.received += num(r.received);
    t.balance += num(r.balance);
    if (num(r.balance) > 0) t.outstanding += num(r.balance);
  }
  return t;
}

/** Receipt number: job code plus the first six characters of the payment id. */
export const receiptNumber = (jobCode: string, paymentId: string): string =>
  `RCPT-${jobCode}-${paymentId.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
