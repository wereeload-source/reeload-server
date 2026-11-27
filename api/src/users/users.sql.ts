export const LIST_USERS_SQL = `
select p.id, p.full_name, p.phone, p.email, p.role, p.active, p.created_at, r.kind, r.base_city
from public.profiles p
left join public.reelmakers r on r.profile_id = p.id
order by p.active desc, p.role, p.full_name`;

export const GET_USER_SQL = `
select p.id, p.full_name, p.phone, p.email, p.role, p.active, p.created_at, r.kind, r.base_city
from public.profiles p
left join public.reelmakers r on r.profile_id = p.id
where p.id = $1::uuid`;

export const INSERT_AUTH_USER_SQL = `
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                        created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        lower($1::text), crypt($2::text, gen_salt('bf')), now(), now(), now(),
        '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', $3::text))
returning id`;

export const INSERT_PROFILE_SQL = `
insert into public.profiles (id, full_name, phone, email, role)
values ($1::uuid, $2::text, $3::text, lower($4::text), $5::public.app_role)`;

export const UPSERT_REELMAKER_SQL = `
insert into public.reelmakers (profile_id, kind, base_city)
values ($1::uuid, coalesce($2::public.reelmaker_kind, 'full_time'), $3::text)
on conflict (profile_id) do update
  set kind = coalesce($2::public.reelmaker_kind, public.reelmakers.kind),
      base_city = coalesce($3::text, public.reelmakers.base_city)`;

export const HAS_REELMAKER_SQL = `select 1 as ok from public.reelmakers where profile_id = $1::uuid`;

/** Only these columns can be changed here (the database grants the same four). */
const UPDATABLE = ['full_name', 'phone', 'active', 'role'] as const;
export type UpdatableColumn = (typeof UPDATABLE)[number];

export function updateProfileSql(columns: UpdatableColumn[]): string {
  const safe = columns.filter((c) => (UPDATABLE as readonly string[]).includes(c));
  const casts: Record<UpdatableColumn, string> = {
    full_name: '::text', phone: '::text', active: '::boolean', role: '::public.app_role',
  };
  const set = safe.map((c, i) => `${c} = $${i + 2}${casts[c]}`).join(', ');
  return `update public.profiles set ${set} where id = $1::uuid returning id`;
}

export const AUDIT_SQL = `select public.write_audit($1::text, 'profiles', $2::text, $3::jsonb)`;

export const SET_PASSWORD_ADMIN_SQL = `
update auth.users set encrypted_password = crypt($2::text, gen_salt('bf')), updated_at = now()
where id = $1::uuid returning id`;

export const checkQueries = { updateProfileSql: updateProfileSql(['full_name', 'phone', 'active', 'role']) };
