/** Sales can record only the advance; Row Level Security refuses any other payment from them. */
export const INSERT_ADVANCE_SQL = `
insert into public.payments (job_id, amount, method, reference, is_advance, recorded_by)
values ($1::uuid, $2::numeric, $3::public.payment_method, $4::text, true, auth.uid())
returning *`;

export const JOB_SUMMARY_SQL = `select * from public.jobs_accounts where id = $1::uuid`;

export const REQUEST_PRICE_CHANGE_SQL = `select * from public.request_price_change($1::uuid, $2::numeric, $3::text)`;
export const DECIDE_PRICE_CHANGE_SQL = `select * from public.decide_price_change($1::uuid, $2::boolean)`;

export const LIST_PRICE_CHANGES_SQL = `
select pc.*, j.code as job_code, c.name as client_name, p.full_name as requested_by_name, m.agreed_amount
from public.price_changes pc
join public.jobs j on j.id = pc.job_id
join public.clients c on c.id = j.client_id
left join public.profiles p on p.id = pc.requested_by
left join public.job_money m on m.job_id = pc.job_id
where ($1::public.approval_status is null or pc.status = $1::public.approval_status)
  and ($2::uuid is null or pc.job_id = $2::uuid)
order by (pc.status = 'pending') desc, pc.created_at desc
limit 200`;

export const INSERT_CONTACT_SQL = `
insert into public.contact_log (client_id, client_name, phone, outcome, note)
values ($1::uuid, $2::text, $3::text, $4::public.contact_outcome, $5::text)
returning *`;

/** The day's calls and the counts for the dashboard strip (IST day). */
export const LIST_CONTACTS_SQL = `
select cl.*, p.full_name as salesperson_name
from public.contact_log cl join public.profiles p on p.id = cl.salesperson_id
where cl.created_at >= $1::timestamptz and cl.created_at < $2::timestamptz
order by cl.created_at desc
limit $3::int`;

export const CONTACT_COUNTS_SQL = `
select cl.salesperson_id, p.full_name,
  count(*)::int as spoken,
  (count(*) filter (where cl.outcome = 'approved'))::int as approved,
  (count(*) filter (where cl.outcome = 'rejected'))::int as rejected,
  (count(*) filter (where cl.outcome = 'follow_up'))::int as follow_ups
from public.contact_log cl join public.profiles p on p.id = cl.salesperson_id
where cl.created_at >= $1::timestamptz and cl.created_at < $2::timestamptz
group by cl.salesperson_id, p.full_name
order by p.full_name`;
