-- Accounts (and Admin) record payments through this function so the rules hold everywhere:
-- only on jobs that are confirmed or later and not cancelled, and never more than is owed.
-- Sales still records the advance directly (their Row Level Security policy allows only that).
create or replace function public.record_payment(
  p_job uuid, p_amount numeric, p_method public.payment_method,
  p_reference text default null, p_is_advance boolean default false, p_received_at timestamptz default null
)
returns public.payments
language plpgsql security definer set search_path = public
as $$
declare
  v_job public.jobs;
  v_balance numeric;
  v_row public.payments;
begin
  if not public.has_role('admin', 'accounts') then raise exception 'Only Accounts or Admin record payments'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount received'; end if;

  select * into v_job from public.jobs where id = p_job for update;
  if v_job.id is null then raise exception 'Job not found'; end if;
  if v_job.status in ('lead', 'draft') then raise exception 'Job % is not confirmed yet', v_job.code; end if;
  if v_job.status = 'cancelled' then raise exception 'Job % is cancelled', v_job.code; end if;

  v_balance := public.job_balance(p_job);
  if v_balance is null then raise exception 'Job % has no agreed amount yet', v_job.code; end if;
  if p_amount > v_balance then
    raise exception 'That is more than the balance. % still owes %', v_job.code, to_char(v_balance, 'FM999999990.00');
  end if;

  insert into public.payments (job_id, amount, method, reference, is_advance, received_at, recorded_by)
  values (p_job, p_amount, p_method, nullif(btrim(coalesce(p_reference, '')), ''), coalesce(p_is_advance, false),
          coalesce(p_received_at, now()), auth.uid())
  returning * into v_row;
  return v_row;
end $$;

revoke execute on function public.record_payment(uuid, numeric, public.payment_method, text, boolean, timestamptz) from public, anon;
grant execute on function public.record_payment(uuid, numeric, public.payment_method, text, boolean, timestamptz) to authenticated;
