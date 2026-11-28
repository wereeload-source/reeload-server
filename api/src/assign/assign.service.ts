import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { jobCode } from '../common/job-code.js';
import { NoticesService } from '../common/notices.service.js';
import { istStamp } from '../common/time.js';
import type { AuthUser } from '../common/types.js';
import { WorkflowService } from '../common/workflow.service.js';
import { TX_OPTIONS } from '../prisma/db.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { AssignJobInput, LeaveInputT, LeaveQueryInput } from './assign.schemas.js';
import { BookingService, windowOf, type Window } from './booking.service.js';

const LIVE = ['pending', 'accepted'] as const;

@Injectable()
export class AssignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly booking: BookingService,
    private readonly audit: AuditService,
    private readonly notices: NoticesService,
    private readonly workflow: WorkflowService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Confirmed jobs nobody holds, soonest first. `flagged` means the shoot is closer than the
   * "unassigned_flag_hours" setting. A job a reelmaker declined or dropped out of comes back with the reason.
   */
  async queue() {
    const flagHours = await this.settings.number('unassigned_flag_hours');
    const now = Date.now();
    const jobs = await this.prisma.job.findMany({
      where: { status: 'confirmed', assignments: { none: { status: { in: [...LIVE] } } } },
      include: {
        client: { select: { name: true } },
        assignments: {
          where: { status: { in: ['declined', 'cancelled'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true, reason: true, respondedAt: true, createdAt: true, reelmaker: { select: { fullName: true } } },
        },
      },
      orderBy: { startsAt: { sort: 'asc', nulls: 'last' } },
    });
    const unassigned = jobs.map((j) => {
      const last = j.assignments[0];
      const { assignments: _a, client, ...job } = j;
      return {
        ...job,
        code: jobCode(j.number),
        clientName: client.name,
        flagged: j.startsAt !== null && j.startsAt.getTime() < now + flagHours * 3_600_000,
        hoursToStart: j.startsAt ? (j.startsAt.getTime() - now) / 3_600_000 : null,
        lastRelease: last ? { reelmaker: last.reelmaker.fullName, status: last.status, reason: last.reason, at: last.respondedAt ?? last.createdAt } : null,
      };
    });

    const waiting = await this.prisma.assignment.findMany({
      where: { status: 'pending', job: { status: 'assigned' } },
      include: { job: { include: { client: { select: { name: true } } } }, reelmaker: { select: { fullName: true } } },
      orderBy: { startsAt: 'asc' },
    });
    return {
      unassigned,
      flagged: unassigned.filter((j) => j.flagged).length,
      awaitingReply: waiting.map((a) => ({
        id: a.job.id, code: jobCode(a.job.number), city: a.job.city, startsAt: a.job.startsAt, clientName: a.job.client.name,
        assignmentId: a.id, reelmakerId: a.reelmakerId, reelmaker: a.reelmaker.fullName, assignedAt: a.createdAt,
      })),
    };
  }

  /** Every active reelmaker with how they stand for the job's time: free, busy or on leave. Free ones in the job's city first. */
  async candidates(jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    const w = windowOf(job);
    const weekStart = new Date(new Date().setHours(0, 0, 0, 0));
    const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);

    const people = await this.prisma.user.findMany({
      where: { role: 'reelmaker', active: true, reelmaker: { isNot: null } },
      select: {
        id: true, fullName: true, phone: true, reelmaker: { select: { kind: true, baseCity: true } },
        leave: w ? { where: { startsAt: { lt: w.end }, endsAt: { gt: w.start } }, select: { id: true } } : false,
        assignments: { where: { status: { in: [...LIVE] } }, select: { jobId: true, startsAt: true, endsAt: true } },
      },
    });

    const rank = { free: 0, busy: 1, leave: 2 } as const;
    return people
      .map((p) => {
        const onLeave = w ? (p.leave?.length ?? 0) > 0 : false;
        const busy = w ? p.assignments.some((a) => a.jobId !== jobId && a.startsAt < w.end && a.endsAt > w.start) : false;
        return {
          id: p.id, fullName: p.fullName, phone: p.phone, kind: p.reelmaker!.kind, baseCity: p.reelmaker!.baseCity,
          sameCity: p.reelmaker!.baseCity.toLowerCase() === job.city.toLowerCase(),
          availability: (onLeave ? 'leave' : busy ? 'busy' : 'free') as keyof typeof rank,
          shootsNext7Days: p.assignments.filter((a) => a.startsAt >= weekStart && a.startsAt < weekEnd).length,
        };
      })
      .sort((a, b) => rank[a.availability] - rank[b.availability] || Number(b.sameCity) - Number(a.sameCity) || a.fullName.localeCompare(b.fullName));
  }

  /** Operations assigns a free reelmaker. A reassignment releases the old booking first. */
  async assign(user: AuthUser, jobId: string, body: AssignJobInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.booking.lockJob(tx, jobId);
      await this.booking.lockReelmaker(tx, body.reelmaker_id);

      const job = await tx.job.findUnique({ where: { id: jobId } });
      if (!job) throw new NotFoundException('Job not found');
      const code = jobCode(job.number);
      if (!['confirmed', 'assigned', 'accepted'].includes(job.status)) {
        throw new BadRequestException(`Job ${code} cannot be assigned while ${job.status}`);
      }
      const reelmaker = await tx.user.findFirst({ where: { id: body.reelmaker_id, role: 'reelmaker', active: true }, select: { id: true } });
      if (!reelmaker) throw new BadRequestException('Not an active reelmaker');

      const w = windowOf(job);
      if (!w) throw new BadRequestException('Set the shoot date, time and duration first');
      if (await this.booking.onLeave(tx, reelmaker.id, w)) throw new ConflictException('Reelmaker is on leave at this time');

      // Reassignment releases the old booking first.
      await tx.assignment.updateMany({
        where: { jobId, status: { in: [...LIVE] } },
        data: { status: 'cancelled', reason: body.reason ?? 'Reassigned' },
      });
      if (await this.booking.clash(tx, reelmaker.id, w)) throw new ConflictException('Reelmaker already has a shoot that overlaps this time');

      const row = await tx.assignment.create({
        data: { jobId, reelmakerId: reelmaker.id, startsAt: w.start, endsAt: w.end, assignedById: user.id },
      });
      await this.workflow.transition(tx, jobId, 'assigned', user.id);
      await this.audit.record(tx, user.id, 'insert', 'assignments', row.id, { jobId, reelmakerId: reelmaker.id });
      await this.notices.toUser(tx, reelmaker.id, 'New shoot request', `${code} on ${istStamp(w.start)}`, `/m/shoots/${jobId}`);
      return row;
    }, TX_OPTIONS);
  }

  reelmakers(includeInactive: boolean) {
    return this.prisma.user.findMany({
      where: { role: 'reelmaker', reelmaker: { isNot: null }, ...(includeInactive ? {} : { active: true }) },
      select: { id: true, fullName: true, phone: true, active: true, reelmaker: { select: { kind: true, baseCity: true } } },
      orderBy: { fullName: 'asc' },
    }).then((list) => list.map(({ reelmaker, ...u }) => ({ ...u, kind: reelmaker!.kind, baseCity: reelmaker!.baseCity })));
  }

  leave(q: LeaveQueryInput) {
    return this.prisma.leave.findMany({
      where: { ...(q.reelmaker_id ? { reelmakerId: q.reelmaker_id } : {}), ...(q.upcoming ? { endsAt: { gt: new Date() } } : {}) },
      select: { id: true, reelmakerId: true, startsAt: true, endsAt: true, note: true, createdAt: true, reelmaker: { select: { fullName: true } } },
      orderBy: { startsAt: 'asc' },
      take: 300,
    }).then((rows) => rows.map(({ reelmaker, ...l }) => ({ ...l, fullName: reelmaker.fullName })));
  }

  /** Leave over a booked shoot is refused, so Operations resolves the shoot first. */
  async addLeave(user: AuthUser, body: LeaveInputT) {
    const w: Window = { start: new Date(body.from), end: new Date(body.to) };
    return this.prisma.$transaction(async (tx) => {
      await this.booking.lockReelmaker(tx, body.reelmaker_id);
      const clash = await tx.assignment.findMany({
        where: { reelmakerId: body.reelmaker_id, status: { in: [...LIVE] }, startsAt: { lt: w.end }, endsAt: { gt: w.start } },
        select: { job: { select: { number: true } } },
      });
      if (clash.length) throw new ConflictException(`They already have ${clash.map((c) => jobCode(c.job.number)).join(', ')} in this time. Reassign it first.`);
      return tx.leave.create({
        data: { reelmakerId: body.reelmaker_id, startsAt: w.start, endsAt: w.end, note: body.note ?? null, createdById: user.id },
        select: { id: true, reelmakerId: true, startsAt: true, endsAt: true, note: true },
      });
    }, TX_OPTIONS);
  }

  async removeLeave(id: string) {
    const gone = await this.prisma.leave.deleteMany({ where: { id } });
    if (!gone.count) throw new NotFoundException('Leave not found');
    return { ok: true };
  }
}
