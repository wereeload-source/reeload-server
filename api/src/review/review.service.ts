import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { jobCode } from '../common/job-code.js';
import { NoticesService } from '../common/notices.service.js';
import { istMonthRange, istToday } from '../common/time.js';
import type { AuthUser } from '../common/types.js';
import { WorkflowService } from '../common/workflow.service.js';
import { MoneyService } from '../money/money.service.js';
import { TX_OPTIONS } from '../prisma/db.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { extraMinutes, minutesBetween } from '../shoots/hours.js';
import { BookingService } from '../assign/booking.service.js';
import type {
  AddExtraTimeInput, DecideExtraTimeInput, ExtraTimeQueryInput, HoursDetailQueryInput, ReviewQueryInput, SendBackInput,
} from './review.schemas.js';

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notices: NoticesService,
    private readonly workflow: WorkflowService,
    private readonly booking: BookingService,
    private readonly money: MoneyService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Ops review: shoots that have started and still have work to check, with raw and edited deadlines.
   * Raw is due `raw_due_hours` after the shoot ends, edited `edited_due_days` after. Overdue first.
   */
  async queue(q: ReviewQueryInput) {
    const [rawHours, editedDays] = await Promise.all([this.settings.number('raw_due_hours'), this.settings.number('edited_due_days')]);
    const jobs = await this.prisma.job.findMany({
      where: { status: { in: ['accepted', 'reached', 'uploaded'] }, startsAt: { not: null }, durationMinutes: { not: null } },
      select: {
        id: true, number: true, status: true, city: true, startsAt: true, durationMinutes: true, client: { select: { name: true } },
        uploads: { where: { status: 'complete', kind: { in: ['raw', 'edited'] } }, select: { kind: true } },
        assignments: { where: { status: 'accepted' }, take: 1, select: { reelmaker: { select: { fullName: true } } } },
      },
    });
    const now = Date.now();
    const rows = jobs.map((j) => {
      const endsAt = new Date(j.startsAt!.getTime() + j.durationMinutes! * 60_000);
      const rawDue = new Date(endsAt.getTime() + rawHours * 3_600_000);
      const editedDue = new Date(endsAt.getTime() + editedDays * 86_400_000);
      const rawFiles = j.uploads.filter((u) => u.kind === 'raw').length;
      const editedFiles = j.uploads.filter((u) => u.kind === 'edited').length;
      return {
        id: j.id, code: jobCode(j.number), status: j.status, city: j.city, startsAt: j.startsAt, clientName: j.client.name,
        endsAt, rawDue, editedDue, rawFiles, editedFiles, reelmaker: j.assignments[0]?.reelmaker.fullName ?? null,
        rawOverdue: rawFiles === 0 && rawDue.getTime() < now,
        editedOverdue: editedFiles === 0 && editedDue.getTime() < now,
      };
    });
    return rows
      .filter((r) => !q.overdue || r.rawOverdue || r.editedOverdue)
      .sort((a, b) => Number(b.rawOverdue || b.editedOverdue) - Number(a.rawOverdue || a.editedOverdue) || a.startsAt!.getTime() - b.startsAt!.getTime());
  }

  /** Operations sends uploaded work back to the reelmaker. The job returns to Reached until the next upload. */
  async sendBack(user: AuthUser, jobId: string, body: SendBackInput) {
    const note = body.note.trim();
    if (note.length < 5) throw new BadRequestException('Tell the reelmaker what to fix');
    return this.prisma.$transaction(async (tx) => {
      await this.booking.lockJob(tx, jobId);
      const job = await tx.job.findUnique({ where: { id: jobId }, select: { status: true, number: true } });
      if (!job || job.status !== 'uploaded') throw new BadRequestException('Only uploaded jobs can be sent back');
      const updated = await this.workflow.transition(tx, jobId, 'reached', user.id);
      const rm = await tx.assignment.findFirst({ where: { jobId, status: 'accepted' }, select: { reelmakerId: true } });
      if (rm) await this.notices.toUser(tx, rm.reelmakerId, 'Changes needed', `${jobCode(job.number)}: ${note}`, `/m/shoots/${jobId}`);
      await this.audit.record(tx, user.id, 'send_back', 'jobs', jobId, { note });
      return updated;
    }, TX_OPTIONS);
  }

  /** Operations adds the extra minutes; Sales and Admin are told to decide whether to charge. No prices here. */
  async addExtraTime(user: AuthUser, jobId: string, body: AddExtraTimeInput) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.job.findUnique({ where: { id: jobId }, select: { status: true, number: true } });
      if (!job) throw new NotFoundException('Job not found');
      if (!['accepted', 'reached', 'uploaded', 'released'].includes(job.status)) {
        throw new BadRequestException(`Extra time can only be added once the shoot is booked and before it is paid (job is ${job.status})`);
      }
      const row = await tx.extraTime.create({ data: { jobId, minutes: body.minutes, note: body.note?.trim() || null, addedById: user.id } });
      await this.audit.record(tx, user.id, 'insert', 'extra_time', row.id, { jobId, minutes: body.minutes });
      await this.notices.toRoles(tx, ['sales', 'admin'], 'Extra time to decide', `${jobCode(job.number)}: ${body.minutes} min extra. Decide whether to charge.`, '/jobs');
      return row;
    }, TX_OPTIONS);
  }

  /** Extra time with its job and client. Ops sees the minutes only; the charge decision is Sales and Admin's. */
  async listExtraTime(q: ExtraTimeQueryInput) {
    const rows = await this.prisma.extraTime.findMany({
      where: { ...(q.decision ? { decision: q.decision } : {}), ...(q.job_id ? { jobId: q.job_id } : {}) },
      include: {
        job: { select: { number: true, city: true, client: { select: { name: true } } } },
        addedBy: { select: { fullName: true } }, decidedBy: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows
      .map(({ job, addedBy, decidedBy, ...e }) => ({
        id: e.id, jobId: e.jobId, code: jobCode(job.number), city: job.city, clientName: job.client.name, minutes: e.minutes,
        note: e.note, decision: e.decision, createdAt: e.createdAt, addedByName: addedBy?.fullName ?? null, decidedByName: decidedBy?.fullName ?? null,
      }))
      .sort((a, b) => Number(b.decision === 'pending') - Number(a.decision === 'pending'));
  }

  /** Sales decides whether to charge; charging creates a price change that Admin must still approve. */
  async decideExtraTime(user: AuthUser, id: string, body: DecideExtraTimeInput) {
    return this.prisma.$transaction(async (tx) => {
      if (body.charge && (!body.amount || body.amount <= 0)) throw new BadRequestException('Enter the extra amount');
      const done = await tx.extraTime.updateMany({
        where: { id, decision: 'pending' },
        data: { decision: body.charge ? 'charge' : 'no_charge', decidedById: user.id },
      });
      if (!done.count) throw new NotFoundException('Extra time not found or already decided');
      const row = await tx.extraTime.findUniqueOrThrow({ where: { id } });
      if (body.charge) {
        const change = await tx.priceChange.create({
          data: { jobId: row.jobId, delta: body.amount!, reason: `Extra time ${row.minutes} min`, extraTimeId: row.id, requestedById: user.id },
        });
        await this.audit.record(tx, user.id, 'insert', 'price_changes', change.id, { jobId: row.jobId, delta: body.amount });
      }
      await this.audit.record(tx, user.id, 'update', 'extra_time', id, { decision: row.decision });
      return row;
    }, TX_OPTIONS);
  }

  /** One reelmaker's accepted shoots in a month with booked and extra minutes. A reelmaker may only open their own. */
  async hoursDetail(user: AuthUser, reelmakerId: string, q: HoursDetailQueryInput) {
    const month = q.month ?? istToday().slice(0, 7);
    const who = user.role === 'reelmaker' ? user.id : reelmakerId;
    const { from, to } = istMonthRange(month);
    const rows = await this.prisma.assignment.findMany({
      where: { reelmakerId: who, status: 'accepted', startsAt: { gte: new Date(from), lt: new Date(to) } },
      select: { jobId: true, status: true, startsAt: true, endsAt: true, job: { select: { number: true, city: true } } },
      orderBy: { startsAt: 'asc' },
    });
    const extra = await extraMinutes(this.prisma, rows.map((r) => r.jobId));
    const items = rows.map((r) => ({
      jobId: r.jobId, code: jobCode(r.job.number), city: r.job.city, startsAt: r.startsAt, status: r.status,
      bookedMinutes: minutesBetween(r.startsAt, r.endsAt), extraMinutes: extra.get(r.jobId) ?? 0,
    }));
    const booked = items.reduce((s, r) => s + r.bookedMinutes, 0);
    const extraTotal = items.reduce((s, r) => s + r.extraMinutes, 0);
    return { month, reelmakerId: who, shoots: items.length, bookedHours: booked / 60, extraHours: extraTotal / 60, totalHours: (booked + extraTotal) / 60, items };
  }
}
