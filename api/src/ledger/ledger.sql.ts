import { likeEscape } from '../jobs/jobs.sql.js';

export interface LedgerFilters {
  status?: string;
  q?: string;
  outstanding: boolean;
}

function where(f: LedgerFilters): { clause: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (f.status) { params.push(f.status); conds.push(`status = $${params.length}::public.job_status`); }
  if (f.outstanding) conds.push('coalesce(balance, 0) > 0');
  if (f.q) {
    params.push(`%${likeEscape(f.q)}%`);
    const n = params.length;
    conds.push(`(code ilike $${n}::text or client_name ilike $${n}::text or city ilike $${n}::text)`);
  }
  return { clause: conds.length ? `where ${conds.join(' and ')}` : '', params };
}

/** The Accounts ledger: one row per job from the jobs_accounts view (client name and money only). */
export function ledgerSql(f: LedgerFilters, limit: number, offset: number): { sql: string; params: unknown[] } {
  const { clause, params } = where(f);
  params.push(limit, offset);
  return {
    sql: `select * from public.jobs_accounts ${clause} order by starts_at desc nulls last, code desc limit $${params.length - 1}::int offset $${params.length}::int`,
    params,
  };
}

/** Totals over every matching job, not just the page shown. */
export function ledgerTotalsSql(f: LedgerFilters): { sql: string; params: unknown[] } {
  const { clause, params } = where(f);
  return {
    sql: `
select count(*)::int as jobs,
  coalesce(sum(coalesce(agreed_amount, 0) + coalesce(approved_changes, 0)), 0) as total,
  coalesce(sum(advance), 0) as advance,
  coalesce(sum(received), 0) as received,
  coalesce(sum(balance), 0) as balance,
  coalesce(sum(balance) filter (where balance > 0), 0) as outstanding
from public.jobs_accounts ${clause}`,
    params,
  };
}

export const JOB_PAYMENTS_SQL = `
select p.id, p.amount, p.method, p.reference, p.is_advance, p.received_at, p.recorded_by, r.full_name as recorded_by_name
from public.payments p left join public.profiles r on r.id = p.recorded_by
where p.job_id = $1::uuid order by p.received_at, p.created_at`;

export const JOB_SUMMARY_SQL = `select * from public.jobs_accounts where id = $1::uuid`;

export const RECORD_PAYMENT_SQL = `select * from public.record_payment($1::uuid, $2::numeric, $3::public.payment_method, $4::text, $5::boolean, $6::timestamptz)`;

export const RECEIPT_SQL = `
select p.id, p.amount, p.method, p.reference, p.is_advance, p.received_at, p.job_id, r.full_name as received_by
from public.payments p left join public.profiles r on r.id = p.recorded_by
where p.id = $1::uuid`;

export const checkQueries = {
  ledgerSql: ledgerSql({ status: 'paid', q: 'x', outstanding: true }, 10, 0).sql,
  ledgerSqlPlain: ledgerSql({ outstanding: false }, 10, 0).sql,
  ledgerTotalsSql: ledgerTotalsSql({ status: 'paid', q: 'x', outstanding: true }).sql,
};
