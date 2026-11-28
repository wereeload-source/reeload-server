import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { BookingService, windowOf } from '../assign/booking.service.js';
import { AuditService } from '../common/audit.service.js';
import { jobCode, parseJobCode } from '../common/job-code.js';
import { NoticesService } from '../common/notices.service.js';
import { canSeeMoney, type AuthUser } from '../common/types.js';
import { WorkflowService } from '../common/workflow.service.js';
import { istStamp as stamp } from '../common/time.js';
import { MoneyService } from '../money/money.service.js';
import { TX_OPTIONS, type Db } from '../prisma/db.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateJobInput, ListJobsInput, RescheduleInput, UpdateJobInput } from './jobs.schemas.js';

const digits = (s: string | null | undefined): string => (s ?? '').replace(/\D/g, '');
const clean = (s: string | null | undefined): string | null => (s && s.trim() ? s.trim() : null);

const JOB_INCLUDE = (money: boolean) => ({
  client: { select: { name: true, phone: true } },
  ...(money ? { money: { select: { agreedAmount: true } } } : {}),
  assignments: {
    where: { status: { in: ['pending', 'accepted'] as ('pending' | 'accepted')[] } },
    select: { id: true, reelmakerId: true, status: true, reelmaker: { select: { fullName: true } } },
  },
}) satisfies Prisma.JobInclude;

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notices: NoticesService,
    private readonly workflow: WorkflowService,
    private readonly booking: BookingService,
    private readonly money: MoneyService,
  ) {}

  /** What a job looks like on the wire. Prices only for Admin, Sales and Accounts. */
  private present(job: {
    number: number; client: { name: string; phone: string }; money?: { agreedAmount: Prisma.Decimal } | null;
    assignments: { id: string; reelmakerId: string; status: string; reelmaker: { fullName: string } }[];
  } & Record<string, unknown>, user: AuthUser) {
    const { client, money, assignments, ...rest } = job;
    return {
      ...rest,
      code: jobCode(job.number),
      clientName: client.name,
      clientPhone: client.phone,
      ...(canSeeMoney(user.role) ? { agreedAmount: money?.agreedAmount ?? null } : {}),
      assignments: assignments.map((a) => ({ id: a.id, reelmakerId: a.reelmakerId, status: a.status, fullName: a.reelmaker.fullName })),
    };
  }

  async list(user: AuthUser, q: ListJobsInput) {
    const code = q.q ? parseJobCode(q.q) : null;
    const where: Prisma.JobWhereInput = {
      ...(q.status ? { status: { in: q.status as never[] } } : {}),
      ...(q.city ? { city: { contains: q.city, mode: 'insensitive' } } : {}),
      ...(q.from || q.to ? { startsAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) } } : {}),
      ...(q.q
        ? {
            OR: [
              { city: { contains: q.q, mode: 'insensitive' } },
              { address: { contains: q.q, mode: 'insensitive' } },
              { client: { name: { contains: q.q, mode: 'insensitive' } } },
              ...(code !== null ? [{ number: code }] : []),
            ],
          }
        : {}),
    };
    const [jobs, total] = await this.prisma.$transaction([
      this.prisma.job.findMany({
        where, include: JOB_INCLUDE(canSeeMoney(user.role)),
        orderBy: [{ startsAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: q.limit, skip: q.offset,
      }),
      this.prisma.job.count({ where }),
    ]);
    return { items: jobs.map((j) => this.present(j, user)), total };
  }

  async get(user: AuthUser, id: string) {
    if (user.role === 'reelmaker') {
      const mine = await this.prisma.assignment.findFirst({ where: { jobId: id, reelmakerId: user.id, status: { in: ['pending', 'accepted'] } } });
      if (!mine) throw new NotFoundException('Job not found');
    }
    const job = await this.prisma.job.findUnique({ where: { id }, include: JOB_INCLUDE(canSeeMoney(user.role)) });
    if (!job) throw new NotFoundException('Job not found');
    return this.present(job, user);
  }

  /** Client, job, amount, advance and optional confirmation in one all-or-nothing step. */
  async create(user: AuthUser, body: CreateJobInput) {
    const phone = digits(body.client.phone);
    if (!phone) throw new BadRequestException("Enter the client's phone number");

    const id = await this.prisma.$transaction(async (tx) => {
      // Repeat clients are matched by phone number.
      const client =
        (await tx.client.findUnique({ where: { phone } })) ??
        (await tx.client.create({
          data: {
            name: body.client.name.trim(), phone, whatsapp: digits(body.client.whatsapp) || phone,
            city: clean(body.client.city), createdById: user.id,
          },
        }));

      const j = body.job;
      const job = await tx.job.create({
        data: {
          clientId: client.id, status: 'draft', city: j.city.trim(), address: clean(j.address), mapsUrl: clean(j.maps_url),
          startsAt: j.starts_at ? new Date(j.starts_at) : null, durationMinutes: j.duration_minutes ?? null,
          onsiteContactName: clean(j.onsite_contact_name), onsiteContactPhone: digits(j.onsite_contact_phone) || null,
          brief: clean(j.brief), consent: j.consent ?? false, createdById: user.id,
        },
      });

      if (body.agreed_amount) {
        await tx.jobMoney.create({ data: { jobId: job.id, agreedAmount: body.agreed_amount } });
        await this.audit.record(tx, user.id, 'insert', 'job_money', job.id, { agreedAmount: body.agreed_amount });
      }
      if (body.advance) {
        const p = await tx.payment.create({
          data: { jobId: job.id, amount: body.advance.amount, method: body.advance.method, reference: clean(body.advance.reference), isAdvance: true, recordedById: user.id },
        });
        await this.audit.record(tx, user.id, 'insert', 'payments', p.id, { jobId: job.id, amount: body.advance.amount, isAdvance: true });
      }
      if (body.confirm) await this.confirmIn(tx, user, job.id);
      return job.id;
    }, TX_OPTIONS);
    return this.get(user, id);
  }

  async update(user: AuthUser, id: string, body: UpdateJobInput) {
    const current = await this.prisma.job.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw new NotFoundException('Job not found');
    if (!['lead', 'draft'].includes(current.status) && (body.starts_at !== undefined || body.duration_minutes !== undefined)) {
      throw new BadRequestException('This job is confirmed. Use reschedule to change the date, time or duration.');
    }
    await this.prisma.job.update({
      where: { id },
      data: {
        city: body.city?.trim(), address: body.address === undefined ? undefined : clean(body.address),
        mapsUrl: body.maps_url === undefined ? undefined : clean(body.maps_url),
        startsAt: body.starts_at === undefined ? undefined : body.starts_at ? new Date(body.starts_at) : null,
        durationMinutes: body.duration_minutes, brief: body.brief === undefined ? undefined : clean(body.brief),
        onsiteContactName: body.onsite_contact_name === undefined ? undefined : clean(body.onsite_contact_name),
        onsiteContactPhone: body.onsite_contact_phone === undefined ? undefined : digits(body.onsite_contact_phone) || null,
        consent: body.consent,
      },
    });
    return this.get(user, id);
  }

  /** Set or change the agreed amount while the job is a lead or draft (it is locked after confirmation). */
  async setAgreedAmount(user: AuthUser, id: string, amount: number) {
    const job = await this.prisma.job.findUnique({ where: { id }, select: { status: true } });
    if (!job) throw new NotFoundException('Job not found');
    if (!['lead', 'draft'].includes(job.status)) {
      throw new BadRequestException('Agreed amount is locked after confirmation. Request a price change instead.');
    }
    await this.prisma.jobMoney.upsert({ where: { jobId: id }, create: { jobId: id, agreedAmount: amount }, update: { agreedAmount: amount } });
    await this.audit.record(this.prisma, user.id, 'update', 'job_money', id, { agreedAmount: amount });
    return this.get(user, id);
  }

  /** A job can only be confirmed with consent, a date, an agreed amount and an advance payment. */
  async confirm(user: AuthUser, id: string) {
    await this.prisma.$transaction((tx) => this.confirmIn(tx, user, id), TX_OPTIONS);
    return this.get(user, id);
  }

  private async confirmIn(tx: Db, user: AuthUser, id: string) {
    await this.booking.lockJob(tx, id);
    const job = await tx.job.findUnique({ where: { id }, include: { money: true } });
    if (!job) throw new NotFoundException('Job not found');
    const code = jobCode(job.number);
    if (!['lead', 'draft'].includes(job.status)) throw new BadRequestException(`Job ${code} is already ${job.status}`);
    if (!job.consent) throw new BadRequestException("Record the client's consent before confirming");
    if (!job.startsAt || !job.durationMinutes) throw new BadRequestException('Set the shoot date, time and duration first');
    if (!job.money) throw new BadRequestException('Enter the agreed amount first');
    if (!(await tx.payment.count({ where: { jobId: id, isAdvance: true } }))) {
      throw new BadRequestException('An advance payment is required to confirm a job');
    }
    return this.workflow.transition(tx, id, 'confirmed', user.id, { confirmedAt: new Date() });
  }

  /**
   * Move a confirmed job to a new time. If the booked reelmaker is free then, the booking moves with
   * the job; otherwise it is released, the job goes back to Confirmed and Operations is told to reassign.
   */
  async reschedule(user: AuthUser, id: string, body: RescheduleInput) {
    await this.prisma.$transaction(async (tx) => {
      await this.booking.lockJob(tx, id);
      const job = await tx.job.findUnique({ where: { id } });
      if (!job) throw new NotFoundException('Job not found');
      const code = jobCode(job.number);
      if (!['confirmed', 'assigned', 'accepted'].includes(job.status)) {
        throw new BadRequestException(`Job ${code} cannot be rescheduled while ${job.status}`);
      }

      const from = job.startsAt;
      const moved = await tx.job.update({
        where: { id },
        data: { startsAt: new Date(body.starts_at), durationMinutes: body.duration_minutes ?? job.durationMinutes },
      });
      const w = windowOf(moved)!;
      const when = stamp(moved.startsAt!);
      const booking = await tx.assignment.findFirst({ where: { jobId: id, status: { in: ['pending', 'accepted'] } } });

      let bookingMoved = false;
      if (booking) {
        await this.booking.lockReelmaker(tx, booking.reelmakerId);
        if (!(await this.booking.onLeave(tx, booking.reelmakerId, w)) && !(await this.booking.clash(tx, booking.reelmakerId, w, id))) {
          await tx.assignment.update({ where: { id: booking.id }, data: { startsAt: w.start, endsAt: w.end } });
          bookingMoved = true;
        }
        if (bookingMoved) {
          await this.notices.toUser(tx, booking.reelmakerId, 'Shoot rescheduled', `${code} is now ${when}`, `/m/shoot?id=${id}`);
        } else {
          await tx.assignment.update({ where: { id: booking.id }, data: { status: 'cancelled', reason: 'Rescheduled: reelmaker not free at the new time' } });
          await this.workflow.transition(tx, id, 'confirmed', user.id);
          await this.notices.toUser(tx, booking.reelmakerId, 'Shoot moved, booking released', `${code} moved to ${when}`);
          await this.notices.toRoles(tx, ['ops', 'admin'], 'Reassign needed', `${code} moved to ${when}. The booked reelmaker is not free.`, '/assign');
        }
      }
      await this.audit.record(tx, user.id, 'reschedule', 'jobs', id, {
        code, from, to: moved.startsAt, reason: body.reason ?? null, bookingMoved, hadBooking: booking !== null,
      });
    }, TX_OPTIONS);
    return this.get(user, id);
  }

  /** Operations releases reviewed work. Paid straight away when nothing is owed. */
  async release(user: AuthUser, id: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.booking.lockJob(tx, id);
      const job = await tx.job.findUnique({ where: { id }, select: { status: true } });
      if (!job) throw new NotFoundException('Job not found');
      if (job.status !== 'uploaded') throw new BadRequestException('Only uploaded jobs can be released');
      const balance = await this.money.balance(tx, id);
      await this.workflow.transition(tx, id, balance && balance.lte(0) ? 'paid' : 'released', user.id, { releasedAt: new Date() });
    }, TX_OPTIONS);
    return this.get(user, id);
  }

  /** Repeat clients are matched by phone, so the new-job form can fill itself in. */
  async clientByPhone(phone: string) {
    const d = digits(phone);
    if (d.length < 6) throw new BadRequestException('Enter the phone number');
    return this.prisma.client.findUnique({ where: { phone: d }, select: { id: true, name: true, phone: true, whatsapp: true, city: true } });
  }
}
