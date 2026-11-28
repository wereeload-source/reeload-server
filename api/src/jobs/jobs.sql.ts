import type { JobStatus } from '../common/types.js';

/** Escapes % _ and \ so user text is matched literally by ILIKE. */
export const likeEscape = (s: string): string => s.replace(/[\\%_]/g, '\\$&');

export interface JobFilters {
  status?: string[];
  q?: string;
  city?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

/**
 * Job list: client name, agreed amount (the database hides it from Operations) and the live
 * reelmaker. `total` is the full match count for paging.
 */
export function listJobsSql(f: JobFilters): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (cond: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(cond(params.length));
  };
  if (f.status?.length) add((n) => `j.status = any($${n}::public.job_status[])`, f.status);
  if (f.city) add((n) => `j.city ilike $${n}::text`, likeEscape(f.city));
  if (f.from) add((n) => `j.starts_at >= $${n}::timestamptz`, f.from);
  if (f.to) add((n) => `j.starts_at < $${n}::timestamptz`, f.to);
  if (f.q) {
    add(
      (n) => `(j.code ilike $${n}::text or j.city ilike $${n}::text or j.address ilike $${n}::text or c.name ilike $${n}::text)`,
      `%${likeEscape(f.q)}%`,
    );
  }
  params.push(f.limit, f.offset);
  const sql = `
select j.*, c.name as client_name, c.phone as client_phone, m.agreed_amount,
  (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'reelmaker_id', a.reelmaker_id, 'status', a.status, 'full_name', p.full_name)), '[]'::jsonb)
     from public.assignments a join public.profiles p on p.id = a.reelmaker_id
    where a.job_id = j.id and a.status in ('pending', 'accepted')) as assignments,
  count(*) over () as total
from public.jobs j
join public.clients c on c.id = j.client_id
left join public.job_money m on m.job_id = j.id
${where.length ? 'where ' + where.join(' and ') : ''}
order by j.starts_at desc nulls last, j.created_at desc
limit $${params.length - 1}::int offset $${params.length}::int`;
  return { sql, params };
}

/** One job with everything the detail page shows. Never includes OTP hashes. */
export const GET_JOB_SQL = `
select j.*, to_jsonb(c) as client, to_jsonb(m) as money,
  coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object('full_name', p.full_name, 'phone', p.phone) order by a.created_at)
              from public.assignments a join public.profiles p on p.id = a.reelmaker_id
             where a.job_id = j.id), '[]'::jsonb) as assignments,
  coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.extra_time e where e.job_id = j.id), '[]'::jsonb) as extra_time,
  coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'reelmaker_id', k.reelmaker_id, 'requested_at', k.requested_at,
              'method', k.method, 'verified_at', k.verified_at, 'release_reason', k.release_reason,
              'released_by', k.released_by, 'completed_at', k.completed_at, 'otp_sends', k.otp_sends, 'otp_attempts', k.otp_attempts))
              from public.checkins k where k.job_id = j.id), '[]'::jsonb) as checkins
from public.jobs j
join public.clients c on c.id = j.client_id
left join public.job_money m on m.job_id = j.id
where j.id = $1::uuid`;

/** All-or-nothing: client (by phone), job, amount, advance, optional confirm. */
export const CREATE_JOB_SQL = `
select * from public.create_job($1::jsonb, $2::jsonb, $3::numeric, $4::jsonb, $5::boolean)`;

export const JOB_STATUS_SQL = `select status from public.jobs where id = $1::uuid`;

export const SET_AMOUNT_SQL = `
insert into public.job_money (job_id, agreed_amount) values ($1::uuid, $2::numeric)
on conflict (job_id) do update set agreed_amount = excluded.agreed_amount
returning *`;

export const CONFIRM_JOB_SQL = `select * from public.confirm_job($1::uuid)`;
export const RESCHEDULE_JOB_SQL = `select * from public.reschedule_job($1::uuid, $2::timestamptz, $3::int, $4::text)`;
export const RELEASE_JOB_SQL = `select * from public.release_job($1::uuid)`;

/** Repeat clients are matched by phone number. */
export const CLIENT_BY_PHONE_SQL = `
select c.id, c.name, c.phone, c.whatsapp, c.city,
  (select count(*) from public.jobs j where j.client_id = c.id) as jobs,
  (select max(j.starts_at) from public.jobs j where j.client_id = c.id) as last_shoot
from public.clients c where c.phone = $1::text`;

/** Only these columns can be edited on a job (the database grants the same list). */
export const EDITABLE_JOB_COLUMNS = [
  'city', 'address', 'maps_url', 'starts_at', 'duration_minutes',
  'onsite_contact_name', 'onsite_contact_phone', 'brief', 'consent',
] as const;
export type EditableJobColumn = (typeof EDITABLE_JOB_COLUMNS)[number];

const CASTS: Record<EditableJobColumn, string> = {
  city: '::text', address: '::text', maps_url: '::text', starts_at: '::timestamptz', duration_minutes: '::int',
  onsite_contact_name: '::text', onsite_contact_phone: '::text', brief: '::text', consent: '::boolean',
};

export function updateJobSql(columns: EditableJobColumn[]): string {
  const safe = columns.filter((c) => (EDITABLE_JOB_COLUMNS as readonly string[]).includes(c));
  const set = safe.map((c, i) => `${c} = $${i + 2}${CASTS[c]}`).join(', ');
  return `update public.jobs set ${set} where id = $1::uuid returning *`;
}

export const LOCKED_STATUSES: JobStatus[] = ['confirmed', 'assigned', 'accepted', 'reached', 'uploaded', 'released', 'paid', 'delivered', 'closed', 'cancelled'];

export const checkQueries = {
  listJobsSql: listJobsSql({ status: ['draft'], q: 'x', city: 'x', from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z', limit: 10, offset: 0 }).sql,
  listJobsSqlNoFilters: listJobsSql({ limit: 10, offset: 0 }).sql,
  updateJobSql: updateJobSql([...EDITABLE_JOB_COLUMNS]),
};
