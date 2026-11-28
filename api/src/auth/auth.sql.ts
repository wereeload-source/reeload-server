/** Checks the password with pgcrypto's bcrypt, the same hash format Supabase uses. */
export const LOGIN_SQL = `
select u.id
from auth.users u
join public.profiles p on p.id = u.id
where lower(u.email) = lower($1::text)
  and u.encrypted_password = crypt($2::text, u.encrypted_password)
  and p.active`;

export const PASSWORD_OK_SQL = `
select 1 as ok from auth.users
where id = $1::uuid and encrypted_password = crypt($2::text, encrypted_password)`;

export const SET_PASSWORD_SQL = `
update auth.users
set encrypted_password = crypt($2::text, gen_salt('bf')), updated_at = now()
where id = $1::uuid
returning id`;

export const ME_SQL = `
select id, full_name, phone, email, role, active from public.profiles where id = $1::uuid`;
