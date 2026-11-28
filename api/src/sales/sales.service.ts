import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { jobCode } from '../common/job-code.js';
import { NoticesService } from '../common/notices.service.js';
import { istDayRange, istToday } from '../common/time.js';
import type { AuthUser } from '../common/types.js';
import { MoneyService } from '../money/money.service.js';
import { TX_OPTIONS } from '../prisma/db.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ContactQueryInput, LogContactInput, PriceChangeQueryInput, RecordAdvanceInput, RequestPriceChangeInput,
} from './sales.schemas.js';

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly money: MoneyService,
    private readonly audit: AuditService,
    private readonly notices: NoticesService,
  ) {}

  /** Record the advance, then return the job's money summary so the page shows the new balance. */
  async recordAdvance(user: AuthUser, jobId: string, body: RecordAdvanceInput) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.job.findUnique({ where: { id: jobId }, select: { status: true } });
      if (!job) throw new NotFoundException('Job not found');
      if (job.status === 'cancelled') throw new BadRequestException('This job is cancelled');
      const payment = await tx.payment.create({
        data: { jobId, amount: body.amount, method: body.method, reference: body.reference?.trim() || null, isAdvance: true, recordedById: user.id },
      });
      await this.audit.record(tx, user.id, 'insert', 'payments', payment.id, { jobId, amount: body.amount, isAdvance: true });
      await this.money.settleIfPaid(tx, jobId);
      return { payment, summary: await this.money.accountRow(tx, jobId) };
    }, TX_OPTIONS);
  }

  async summary(jobId: string) {
    const s = await this.money.accountRow(this.prisma, jobId);
    if (!s) throw new NotFoundException('Job not found');
    return s;
  }

  /** Any amount change after confirmation: pending until Admin approves. */
  async requestPriceChange(user: AuthUser, jobId: string, body: RequestPriceChangeInput) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.job.findUnique({ where: { id: jobId }, select: { status: true, number: true } });
      if (!job) throw new NotFoundException('Job not found');
      const code = jobCode(job.number);
      if (job.status === 'lead' || job.status === 'draft') throw new BadRequestException(`Job ${code} is not confirmed yet: edit the agreed amount instead`);
      if (job.status === 'closed' || job.status === 'cancelled') throw new BadRequestException(`Job ${code} is ${job.status}`);

      const row = await tx.priceChange.create({ data: { jobId, delta: body.delta, reason: body.reason.trim(), requestedById: user.id } });
      await this.audit.record(tx, user.id, 'insert', 'price_changes', row.id, { jobId, delta: body.delta, reason: body.reason.trim() });
      await this.notices.toRoles(tx, ['admin'], 'Price change to approve', `${code}: ${body.delta.toFixed(2)}. ${body.reason.trim()}`, '/dashboard');
      return row;
    }, TX_OPTIONS);
  }

  async listPriceChanges(q: PriceChangeQueryInput) {
    const rows = await this.prisma.priceChange.findMany({
      where: { ...(q.status ? { status: q.status } : {}), ...(q.job_id ? { jobId: q.job_id } : {}) },
      include: {
        job: { select: { number: true, city: true, client: { select: { name: true } } } },
        requestedBy: { select: { fullName: true } },
        decidedBy: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows
      .map(({ job, requestedBy, decidedBy, ...c }) => ({
        ...c, code: jobCode(job.number), city: job.city, clientName: job.client.name,
        requestedByName: requestedBy?.fullName ?? null, decidedByName: decidedBy?.fullName ?? null,
      }))
      .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'));
  }

  /** Admin approves or rejects. An approved change moves the balance, which may settle a released job. */
  async decidePriceChange(user: AuthUser, id: string, approve: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const done = await tx.priceChange.updateMany({
        where: { id, status: 'pending' },
        data: { status: approve ? 'approved' : 'rejected', decidedById: user.id, decidedAt: new Date() },
      });
      if (!done.count) throw new NotFoundException('Price change not found or already decided');
      const row = await tx.priceChange.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, user.id, 'update', 'price_changes', id, { jobId: row.jobId, status: row.status, delta: row.delta });
      await this.money.settleIfPaid(tx, row.jobId);
      return row;
    }, TX_OPTIONS);
  }

  logContact(user: AuthUser, body: LogContactInput) {
    return this.prisma.contactLog.create({
      data: {
        salespersonId: user.id, clientId: body.client_id ?? null, clientName: body.client_name.trim(),
        phone: body.phone?.trim() || null, outcome: body.outcome, note: body.note?.trim() || null,
      },
    });
  }

  /** The day's calls plus per-salesperson counts. Sales see their own; Admin sees everyone's. */
  async contacts(user: AuthUser, q: ContactQueryInput) {
    const date = q.date ?? istToday();
    const { from, to } = istDayRange(date);
    const where = { createdAt: { gte: new Date(from), lt: new Date(to) }, ...(user.role === 'admin' ? {} : { salespersonId: user.id }) };
    const [items, all] = await Promise.all([
      this.prisma.contactLog.findMany({
        where, orderBy: { createdAt: 'desc' }, take: q.limit, include: { salesperson: { select: { fullName: true } } },
      }),
      this.prisma.contactLog.findMany({ where, select: { salespersonId: true, outcome: true, salesperson: { select: { fullName: true } } } }),
    ]);
    const counts = new Map<string, { salespersonId: string; fullName: string; spoken: number; approved: number; rejected: number; followUps: number }>();
    for (const c of all) {
      const row = counts.get(c.salespersonId) ?? { salespersonId: c.salespersonId, fullName: c.salesperson.fullName, spoken: 0, approved: 0, rejected: 0, followUps: 0 };
      row.spoken++;
      if (c.outcome === 'approved') row.approved++;
      if (c.outcome === 'rejected') row.rejected++;
      if (c.outcome === 'follow_up') row.followUps++;
      counts.set(c.salespersonId, row);
    }
    return {
      date,
      counts: [...counts.values()],
      items: items.map(({ salesperson, ...c }) => ({ ...c, salespersonName: salesperson.fullName })),
    };
  }
}
