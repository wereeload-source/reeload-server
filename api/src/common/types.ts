import type { Request } from 'express';

export type Role = 'admin' | 'sales' | 'ops' | 'reelmaker' | 'accounts';

/** The signed-in user, resolved by AuthGuard from the login token and the profiles table. */
export interface AuthUser {
  id: string;
  role: Role;
  fullName: string;
}

export type AuthedRequest = Request & { user: AuthUser };

export const JOB_STATUSES = [
  'lead', 'draft', 'confirmed', 'assigned', 'accepted', 'reached',
  'uploaded', 'released', 'paid', 'delivered', 'closed', 'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
