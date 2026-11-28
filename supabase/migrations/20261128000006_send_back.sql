-- Operations sends uploaded work back to the reelmaker for fixes. The job returns to Reached;
-- the next raw or edited upload moves it to Uploaded again.
create or replace function public.send_back(p_job uuid, p_note text)
returns public.jobs
language plpgsql security definer set search_path = public
as $$
declare
  v_job public.jobs;
  v_rm uuid;
begin
  if not public.has_role('admin', 'ops') then raise exception 'Only Operations or Admin can send work back'; end if;
  if p_note is null or length(btrim(p_note)) < 5 then raise exception 'Tell the reelmaker what to fix'; end if;

  update public.jobs set status = 'reached' where id = p_job and status = 'uploaded' returning * into v_job;
  if v_job.id is null then raise exception 'Only uploaded jobs can be sent back'; end if;

  select reelmaker_id into v_rm from public.assignments where job_id = p_job and status = 'accepted' limit 1;
  if v_rm is not null then
    insert into public.notifications (user_id, title, body, link)
    values (v_rm, 'Changes needed', v_job.code || ': ' || btrim(p_note), '/m/shoots/' || p_job);
  end if;
  perform public.write_audit('send_back', 'jobs', p_job::text, jsonb_build_object('note', btrim(p_note)));
  return v_job;
end $$;

revoke execute on function public.send_back(uuid, text) from public, anon;
grant execute on function public.send_back(uuid, text) to authenticated;
