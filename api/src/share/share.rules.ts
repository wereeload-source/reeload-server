import type { Role } from '../common/types.js';

/** Job states in which the client has paid in full. */
export const PAID_STATES = ['paid', 'delivered', 'closed'] as const;

export type LinkVerdict = { ok: true; early: boolean } | { ok: false; status: number; message: string };

/**
 * Who may make a download link, and when. Operations only after the job is Paid. Admin may make
 * one earlier (once the work is released); that is recorded in the audit log as an early link.
 */
export function linkVerdict(role: Role, status: string): LinkVerdict {
  const paid = (PAID_STATES as readonly string[]).includes(status);
  if (paid) return { ok: true, early: false };
  if (role !== 'admin') return { ok: false, status: 409, message: 'The link unlocks when Accounts marks this job Paid' };
  if (status !== 'released') return { ok: false, status: 409, message: 'Release the work first' };
  return { ok: true, early: true };
}

/** State of a link for the list on the job page. */
export function linkState(l: { revoked_at: Date | string | null; expires_at: Date | string }, now: number): 'revoked' | 'expired' | 'active' {
  if (l.revoked_at) return 'revoked';
  return new Date(l.expires_at).getTime() < now ? 'expired' : 'active';
}
