import { Injectable } from '@nestjs/common';
import type { Db } from '../prisma/db.js';
import { lock } from '../prisma/locks.js';

export interface Window {
  start: Date;
  end: Date;
}

/** A job's booked window, or null while its date or duration is not set. */
export function windowOf(job: { startsAt: Date | null; durationMinutes: number | null }): Window | null {
  if (!job.startsAt || !job.durationMinutes) return null;
  return { start: job.startsAt, end: new Date(job.startsAt.getTime() + job.durationMinutes * 60_000) };
}

/**
 * No double booking. A reelmaker's bookings are checked and written under a lock on that reelmaker,
 * so two assignments at the same moment cannot both pass the overlap check.
 */
@Injectable()
export class BookingService {
  lockReelmaker(tx: Db, reelmakerId: string): Promise<void> {
    return lock(tx, `reelmaker:${reelmakerId}`);
  }

  lockJob(tx: Db, jobId: string): Promise<void> {
    return lock(tx, `job:${jobId}`);
  }

  async onLeave(tx: Db, reelmakerId: string, w: Window): Promise<boolean> {
    const hit = await tx.leave.findFirst({ where: { reelmakerId, startsAt: { lt: w.end }, endsAt: { gt: w.start } }, select: { id: true } });
    return hit !== null;
  }

  /** Another live booking that overlaps the window (the job being moved or assigned is ignored). */
  clash(tx: Db, reelmakerId: string, w: Window, exceptJobId?: string) {
    return tx.assignment.findFirst({
      where: {
        reelmakerId,
        status: { in: ['pending', 'accepted'] },
        startsAt: { lt: w.end },
        endsAt: { gt: w.start },
        ...(exceptJobId ? { jobId: { not: exceptJobId } } : {}),
      },
      select: { id: true, job: { select: { number: true } } },
    });
  }
}
