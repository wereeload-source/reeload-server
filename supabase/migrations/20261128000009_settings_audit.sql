-- Settings are edited by Admin (column grant: value only). Stamp the time and keep a record of
-- who changed what. audit_row() keys by `id`/`job_id`, which settings lack, so use a small trigger.
create or replace function public.audit_setting()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.write_audit('update', 'settings', new.key, jsonb_build_object('old', old.value, 'new', new.value));
  return new;
end $$;

create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();
create trigger audit_settings after update on public.settings for each row when (old.value is distinct from new.value) execute function public.audit_setting();
