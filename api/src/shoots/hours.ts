import type { Db } from '../prisma/db.js';

/** Extra minutes per job. Only minutes, never whether they were charged (that is money). */
export async function extraMinutes(db: Db, jobIds: string[]): Promise<Map<string, number>> {
  if (!jobIds.length) return new Map();
  const sums = await db.extraTime.groupBy({ by: ['jobId'], where: { jobId: { in: jobIds } }, _sum: { minutes: true } });
  return new Map(sums.map((s) => [s.jobId, s._sum.minutes ?? 0]));
}

export const minutesBetween = (start: Date, end: Date): number => Math.round((end.getTime() - start.getTime()) / 60_000);
