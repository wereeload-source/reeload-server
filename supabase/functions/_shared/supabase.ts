import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http.ts";

export type Role = "admin" | "sales" | "ops" | "reelmaker" | "accounts";
export interface Caller {
  id: string;
  role: Role;
  full_name: string;
}

/** Service-role client. Bypasses RLS: only use after checking the caller's role. */
export const admin: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

/** Resolves the signed-in user from the Authorization header and checks their role. */
export async function requireCaller(req: Request, ...roles: Role[]): Promise<Caller> {
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) throw new HttpError(401, "Sign in first");
  const { data: { user }, error } = await admin.auth.getUser(jwt);
  if (error || !user) throw new HttpError(401, "Sign in first");
  const { data: profile } = await admin
    .from("profiles").select("id, role, full_name, active").eq("id", user.id).single();
  if (!profile?.active) throw new HttpError(403, "Your account is disabled");
  if (roles.length && !roles.includes(profile.role)) throw new HttpError(403, "Not allowed for your role");
  return profile as Caller;
}

export async function audit(actor: string | null, action: string, entity: string, entityId: string, details: unknown = {}) {
  await admin.from("audit_log").insert({ actor_id: actor, action, entity, entity_id: entityId, details });
}

export async function isAssigned(jobId: string, reelmakerId: string, statuses = ["pending", "accepted"]) {
  const { count } = await admin.from("assignments").select("id", { count: "exact", head: true })
    .eq("job_id", jobId).eq("reelmaker_id", reelmakerId).in("status", statuses);
  return (count ?? 0) > 0;
}

export async function setting(key: string): Promise<unknown> {
  const { data } = await admin.from("settings").select("value").eq("key", key).single();
  return data?.value;
}
