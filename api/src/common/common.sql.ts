/** Loaded on every request by AuthGuard, so a disabled account stops working at once. */
export const PROFILE_SQL = 'select id, full_name, role, active from public.profiles where id = $1::uuid';
