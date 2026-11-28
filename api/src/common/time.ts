/** The business runs on Indian time. Dates and "today" are worked out in IST. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** "2026-11-28" for the IST calendar day an instant falls on. */
export function istDate(instant: string | Date): string {
  const ms = (typeof instant === 'string' ? new Date(instant) : instant).getTime();
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Start (inclusive) and end (exclusive) of an IST day, as UTC ISO strings. */
export function istDayRange(day: string): { from: string; to: string } {
  const start = new Date(`${day}T00:00:00.000+05:30`);
  return { from: start.toISOString(), to: new Date(start.getTime() + 86_400_000).toISOString() };
}

/** First day of an IST month ("2026-11") to the first day of the next, as UTC ISO strings. */
export function istMonthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { from: istDayRange(`${month}-01`).from, to: istDayRange(`${next}-01`).from };
}

/** Today's IST date. */
export const istToday = (now: Date = new Date()): string => istDate(now);

/** A Postgres range literal for a time window: [from,to) */
export const rangeLiteral = (from: string | Date, to: string | Date): string =>
  `[${new Date(from).toISOString()},${new Date(to).toISOString()})`;

/** Strips characters that would break a PostgREST or() filter. */
export const safeSearch = (s: string): string => s.replace(/[,()%*\\]/g, ' ').trim();

/** Postgres numeric comes back as a number or a string depending on the driver. */
export const num = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));
