import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { jobCode } from '../common/job-code.js';
import { NoticesService } from '../common/notices.service.js';
import { istMonthRange, istToday } from '../common/time.js';
import type { AuthUser } from '../common/types.js';
import { WorkflowService } from '../common/workflow.service.js';
import { TX_OPTIONS } from '../prisma/db.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BookingService } from '../assign/booking.service.js';
import { extraMinutes, minutesBetween } from './hours.js';
import type { DropOutInput, HoursQueryInput, RespondShootInput, ShootsQueryInput } from './shoots.schemas.js';

const JOB_FIELDS = {
  id: true, number: true, status: true, city: true, address: true, mapsUrl: true, startsAt: true, durationMinutes: true,
  onsiteContactName: true, onsiteContactPhone: true, brief: true, client: { select: { name: true } },
} as const;

/** A reelmaker's own bookings. No price, payment or balance is ever part of these responses. */
@Injectable()
export class ShootsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly booking: BookingService,
    private readonly audit: AuditService,
    private readonly notices: NoticesService,
    private readonly workflow: WorkflowService,
  ) {}

  private present(a: { id: string; status: string; reason: string | null; job: { id: string; number: number; client: { name: string } } & Record<string, unknown> }, extra: number) {
    const { client, id: jobId, number, ...job } = a.job;
    return { assignmentId: a.id, assignmentStatus: a.status, reason: a.reason, jobId, code: jobCode(number), ...job, clientName: client.name, extraMinutes: extra };
  }

  async mine(user: AuthUser, q: ShootsQueryInput) {
    const cutoff = new Date(Date.now() - 12 * 3_600_000);
    const when =
      q.when === 'upcoming' ? { status: { in: ['pending', 'accepted'] as ('pending' | 'accepted')[] }, endsAt: { gt: cutoff } }
      : q.when === 'past' ? { status: 'accepted' as const, endsAt: { lte: cutoff } }
      : { status: { in: ['pending', 'accepted'] as ('pending' | 'accepted')[] } };

    const rows = await this.prisma.assignment.findMany({
      where: { reelmakerId: user.id, ...when },
      include: { job: { select: JOB_FIELDS } },
      orderBy: { startsAt: q.when === 'past' ? 'desc' : 'asc' },
    });
    const minutes = await extraMinutes(this.prisma, rows.filter((r) => r.status === 'accepted').map((r) => r.jobId));
    const checkins = await this.prisma.checkin.findMany({
      where: { reelmakerId: user.id, jobId: { in: rows.map((r) => r.jobId) } },
      select: { id: true, jobId: true, verifiedAt: true, completedAt: true, otpSends: true },
    });
    const byJob = new Map(checkins.map((c) => [c.jobId, c]));
    return rows.map((r) => {
      const { jobId: _j, ...c } = byJob.get(r.jobId) ?? ({} as { jobId?: string });
      return {
        ...this.present(r, minutes.get(r.jobId) ?? 0),
        respondedAt: r.respondedAt,
        checkin: byJob.has(r.jobId) ? c : null,
      };
    });
  }

  async one(user: AuthUser, jobId: string) {
    const a = await this.prisma.assignment.findFirst({
      where: { jobId, reelmakerId: user.id, status: { in: ['pending', 'accepted'] } },
      include: { job: { select: JOB_FIELDS } },
    });
    if (!a) throw new NotFoundException('Shoot not found');
    const minutes = a.status === 'accepted' ? await extraMinutes(this.prisma, [jobId]) : new Map<string, number>();
    return this.present(a, minutes.get(jobId) ?? 0);
  }

  /** Accept or decline. A declined job goes back to Operations with the reason. */
  async respond(user: AuthUser, jobId: string, body: RespondShootInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.booking.lockJob(tx, jobId);
      const pending = await tx.assignment.findFirst({ where: { jobId, reelmakerId: user.id, status: 'pending' } });
      if (!pending) throw new NotFoundException('There is no shoot waiting for your answer');

      const row = await tx.assignment.update({
        where: { id: pending.id },
        data: { status: body.accept ? 'accepted' : 'declined', reason: body.reason ?? null, respondedAt: new Date() },
      });
      await this.workflow.transition(tx, jobId, body.accept ? 'accepted' : 'confirmed', user.id);
      await this.audit.record(tx, user.id, 'update', 'assignments', row.id, { jobId, status: row.status, reason: row.reason });
      return row;
    }, TX_OPTIONS);
  }

  /** Give a shoot back after accepting it. Operations and Admin are told. */
  async dropOut(user: AuthUser, jobId: string, body: DropOutInput) {
    const reason = body.reason.trim();
    if (!reason) throw new BadRequestException('Give a reason for dropping out');
    return this.prisma.$transaction(async (tx) => {
      await this.booking.lockJob(tx, jobId);
      const mine = await tx.assignment.findFirst({ where: { jobId, reelmakerId: user.id, status: { in: ['pending', 'accepted'] } } });
      if (!mine) throw new NotFoundException('You have no live booking on this job');
      const job = await tx.job.findUniqueOrThrow({ where: { id: jobId }, select: { status: true, number: true } });
      const code = jobCode(job.number);
      if (!['assigned', 'accepted'].includes(job.status)) throw new BadRequestException(`Too late to drop out of ${code} (it is ${job.status}). Call operations.`);

      const row = await tx.assignment.update({ where: { id: mine.id }, data: { status: 'cancelled', reason: `Dropped out: ${reason}`, respondedAt: new Date() } });
      await this.workflow.transition(tx, jobId, 'confirmed', user.id);
      await this.notices.toRoles(tx, ['ops', 'admin'], 'Reelmaker dropped out', `${code}: ${reason}`, '/assign');
      await this.audit.record(tx, user.id, 'drop_out', 'assignments', row.id, { code, reelmaker: user.id, reason });
      return row;
    }, TX_OPTIONS);
  }

  /** Booked and extra hours for a month. A reelmaker only ever sees their own row. */
  async hours(user: AuthUser, q: HoursQueryInput) {
    const month = q.month ?? istToday().slice(0, 7);
    const { from, to } = istMonthRange(month);
    const who = user.role === 'reelmaker' ? user.id : q.reelmaker_id;
    const rows = await this.prisma.assignment.findMany({
      where: { status: 'accepted', startsAt: { gte: new Date(from), lt: new Date(to) }, ...(who ? { reelmakerId: who } : {}) },
      select: { jobId: true, reelmakerId: true, startsAt: true, endsAt: true, reelmaker: { select: { fullName: true } } },
    });
    const extra = await extraMinutes(this.prisma, rows.map((r) => r.jobId));

    const people = new Map<string, { reelmakerId: string; fullName: string; month: string; shoots: number; bookedHours: number; extraHours: number; totalHours: number }>();
    for (const r of rows) {
      const p = people.get(r.reelmakerId) ?? { reelmakerId: r.reelmakerId, fullName: r.reelmaker.fullName, month, shoots: 0, bookedHours: 0, extraHours: 0, totalHours: 0 };
      p.shoots++;
      p.bookedHours += minutesBetween(r.startsAt, r.endsAt) / 60;
      p.extraHours += (extra.get(r.jobId) ?? 0) / 60;
      p.totalHours = p.bookedHours + p.extraHours;
      people.set(r.reelmakerId, p);
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      month,
      items: [...people.values()]
        .map((p) => ({ ...p, bookedHours: round(p.bookedHours), extraHours: round(p.extraHours), totalHours: round(p.totalHours) }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    };
  }
}
