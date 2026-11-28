export const ROLES = ['admin', 'sales', 'ops', 'reelmaker', 'accounts'] as const;
export type Role = (typeof ROLES)[number];

/** The signed-in user, loaded from the database on every request (so a disabled account stops at once). */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  active: boolean;
}

export const JOB_STATUSES = [
  'lead', 'draft', 'confirmed', 'assigned', 'accepted', 'reached',
  'uploaded', 'released', 'paid', 'delivered', 'closed', 'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Operations and Reelmakers must never be sent a price, a payment or a balance. */
export const MONEY_ROLES: readonly Role[] = ['admin', 'sales', 'accounts'];
export const canSeeMoney = (role: Role): boolean => MONEY_ROLES.includes(role);
export const isStaff = (role: Role): boolean => role === 'ops' || role === 'admin';
