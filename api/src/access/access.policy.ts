import { Policy } from '@nestjs/authorization';
import type { AuthUser, Role } from '../common/types.js';

const has = (user: AuthUser | null, ...roles: Role[]): boolean => !!user && user.active && roles.includes(user.role);

/**
 * Who may do what, in one place. Routes name an ability with `@Can(AccessPolicy, 'createJob')`; anything
 * a route does not name is refused. Rules that depend on the row (a reelmaker only sees their own
 * shoots) are applied in the services, which also decide what money a role may see.
 */
@Policy()
export class AccessPolicy {
  // ── System ──
  manageUsers(u: AuthUser | null) { return has(u, 'admin'); }
  viewDashboard(u: AuthUser | null) { return has(u, 'admin'); }
  viewAudit(u: AuthUser | null) { return has(u, 'admin'); }
  editSettings(u: AuthUser | null) { return has(u, 'admin'); }

  // ── Sales ──
  createJob(u: AuthUser | null) { return has(u, 'admin', 'sales'); }
  editJob(u: AuthUser | null) { return has(u, 'admin', 'sales'); }
  confirmJob(u: AuthUser | null) { return has(u, 'admin', 'sales'); }
  lookupClient(u: AuthUser | null) { return has(u, 'admin', 'sales'); }
  recordAdvance(u: AuthUser | null) { return has(u, 'admin', 'sales'); }
  requestPriceChange(u: AuthUser | null) { return has(u, 'admin', 'sales'); }
  viewPriceChanges(u: AuthUser | null) { return has(u, 'admin', 'sales'); }
  decidePriceChange(u: AuthUser | null) { return has(u, 'admin'); }
  logContact(u: AuthUser | null) { return has(u, 'admin', 'sales'); }
  decideExtraTime(u: AuthUser | null) { return has(u, 'admin', 'sales'); }

  // ── Jobs ──
  listJobs(u: AuthUser | null) { return has(u, 'admin', 'sales', 'ops'); }
  viewJob(u: AuthUser | null) { return has(u, 'admin', 'sales', 'ops', 'reelmaker'); }
  rescheduleJob(u: AuthUser | null) { return has(u, 'admin', 'sales', 'ops'); }
  releaseJob(u: AuthUser | null) { return has(u, 'admin', 'ops'); }
  viewCalendar(u: AuthUser | null) { return has(u, 'admin', 'sales', 'ops'); }
  viewMyCalendar(u: AuthUser | null) { return has(u, 'reelmaker'); }

  // ── Operations ──
  assignWork(u: AuthUser | null) { return has(u, 'admin', 'ops'); }
  viewReelmakers(u: AuthUser | null) { return has(u, 'admin', 'ops', 'sales'); }
  reviewWork(u: AuthUser | null) { return has(u, 'admin', 'ops'); }
  addExtraTime(u: AuthUser | null) { return has(u, 'admin', 'ops'); }
  viewExtraTime(u: AuthUser | null) { return has(u, 'admin', 'sales', 'ops'); }
  manageCheckins(u: AuthUser | null) { return has(u, 'admin', 'ops'); }
  manageShareLinks(u: AuthUser | null) { return has(u, 'admin', 'ops'); }

  // ── Reelmakers ──
  workShoots(u: AuthUser | null) { return has(u, 'reelmaker'); }
  viewHours(u: AuthUser | null) { return has(u, 'admin', 'ops', 'reelmaker'); }
  useUploads(u: AuthUser | null) { return has(u, 'admin', 'ops', 'reelmaker'); }

  // ── Accounts ──
  viewLedger(u: AuthUser | null) { return has(u, 'admin', 'accounts', 'sales'); }
  exportLedger(u: AuthUser | null) { return has(u, 'admin', 'accounts'); }
  recordPayment(u: AuthUser | null) { return has(u, 'admin', 'accounts'); }
}
