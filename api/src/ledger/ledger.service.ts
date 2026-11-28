import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { jobCode, parseJobCode } from '../common/job-code.js';
import type { AuthUser } from '../common/types.js';
import { toWire } from '../common/snake-case.interceptor.js';
import { BookingService } from '../assign/booking.service.js';
import { MoneyService } from '../money/money.service.js';
import { TX_OPTIONS } from '../prisma/db.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ledgerTotals, receiptNumber, type LedgerRow } from './ledger.js';
import type { LedgerQueryInput, RecordPaymentInput } from './ledger.schemas.js';
import type { Prisma } from '../generated/prisma/client.js';

@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly money: MoneyService,
    private readonly audit: AuditService,
    private readonly booking: BookingService,
  ) {}

  /** One row per job with its money. Totals cover every matching job, not just the page shown. */
  async ledger(q: LedgerQueryInput) {
    const code = q.q ? parseJobCode(q.q) : null;
    const where: Prisma.JobWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.q
        ? {
            OR: [
              { city: { contains: q.q, mode: 'insensitive' } },
              { client: { name: { contains: q.q, mode: 'insensitive' } } },
              ...(code !== null ? [{ number: code }] : []),
            ],
          }
        : {}),
    };
    const all = (await this.money.accountRows(this.prisma, where)).filter((r) => !q.outstanding || (r.balance !== null && r.balance.gt(0)));
    const totals = { jobs: all.length, ...ledgerTotals(toWire(all) as LedgerRow[]) };
    return { items: all.slice(q.offset, q.offset + q.limit), total: all.length, totals };
  }

  async jobPayments(jobId: string) {
    const summary = await this.money.accountRow(this.prisma, jobId);
    if (!summary) throw new NotFoundException('Job not found');
    const payments = await this.prisma.payment.findMany({
      where: { jobId },
      select: { id: true, amount: true, method: true, reference: true, isAdvance: true, receivedAt: true, recordedById: true, recordedBy: { select: { fullName: true } } },
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
    });
    return { summary, payments: payments.map(({ recordedBy, ...p }) => ({ ...p, recordedByName: recordedBy?.fullName ?? null })) };
  }

  /** Accounts records every payment: only on confirmed jobs that are not cancelled, and never more than is owed. */
  async recordPayment(user: AuthUser, jobId: string, body: RecordPaymentInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.booking.lockJob(tx, jobId);
      const job = await tx.job.findUnique({ where: { id: jobId }, select: { status: true, number: true } });
      if (!job) throw new NotFoundException('Job not found');
      const code = jobCode(job.number);
      if (job.status === 'lead' || job.status === 'draft') throw new BadRequestException(`Job ${code} is not confirmed yet`);
      if (job.status === 'cancelled') throw new BadRequestException(`Job ${code} is cancelled`);

      const balance = await this.money.balance(tx, jobId);
      if (balance === null) throw new BadRequestException(`Job ${code} has no agreed amount yet`);
      if (balance.lt(body.amount)) throw new BadRequestException(`That is more than the balance. ${code} still owes ${balance.toFixed(2)}`);

      const payment = await tx.payment.create({
        data: {
          jobId, amount: body.amount, method: body.method, reference: body.reference?.trim() || null, isAdvance: body.is_advance,
          receivedAt: body.received_at ? new Date(body.received_at) : new Date(), recordedById: user.id,
        },
      });
      await this.audit.record(tx, user.id, 'insert', 'payments', payment.id, { jobId, amount: body.amount, method: body.method, isAdvance: body.is_advance });
      // A released job whose balance reaches zero becomes Paid.
      await this.money.settleIfPaid(tx, jobId);
      return { payment, summary: await this.money.accountRow(tx, jobId) };
    }, TX_OPTIONS);
  }

  /** Everything a printable receipt needs; the page prints it. */
  async receipt(paymentId: string) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { recordedBy: { select: { fullName: true } } } });
    if (!p) throw new NotFoundException('Payment not found');
    const job = await this.money.accountRow(this.prisma, p.jobId);
    if (!job) throw new NotFoundException('Job not found');
    return {
      receiptNo: receiptNumber(job.code, p.id),
      issuedAt: new Date().toISOString(),
      clientName: job.clientName,
      jobCode: job.code,
      city: job.city,
      payment: { amount: p.amount, method: p.method, reference: p.reference, isAdvance: p.isAdvance, receivedAt: p.receivedAt, receivedBy: p.recordedBy?.fullName ?? null },
      jobTotals: { agreedAmount: job.agreedAmount, approvedChanges: job.approvedChanges, received: job.received, balance: job.balance },
    };
  }
}
