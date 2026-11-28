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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "28 Nov, 09:30" in Indian time, for notices. */
export function istStamp(instant: Date): string {
  const t = new Date(instant.getTime() + IST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(t.getUTCDate())} ${MONTHS[t.getUTCMonth()]}, ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/** Money and counts can arrive as a number, a string or a Decimal: read them as a number. */
export const num = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));
