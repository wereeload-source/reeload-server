export const LIST_NOTICES_SQL = `
select id, title, body, link, read_at, created_at from public.notifications
where user_id = auth.uid() and (not $1::boolean or read_at is null)
order by created_at desc limit $2::int`;

export const UNREAD_COUNT_SQL = `select count(*)::int as unread from public.notifications where user_id = auth.uid() and read_at is null`;

export const MARK_READ_SQL = `update public.notifications set read_at = now() where id = $1::uuid and user_id = auth.uid() and read_at is null returning id`;

export const MARK_ALL_READ_SQL = `update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null returning id`;
