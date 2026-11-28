import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { jobCode } from '../common/job-code.js';
import type { Db } from '../prisma/db.js';

const ZERO = new Prisma.Decimal(0);

export interface MoneySummary {
  jobId: string;
  agreedAmount: Prisma.Decimal | null;
  approvedChanges: Prisma.Decimal;
  advance: Prisma.Decimal;
  received: Prisma.Decimal;
  /** agreed + approved changes - payments. Null until an agreed amount exists. */
  balance: Prisma.Decimal | null;
}

/**
 * Prices, payments and balances. Only Sales, Accounts and Admin are ever sent what this returns:
 * the controllers that expose it are limited by AccessPolicy, and JobsService leaves money out for everyone else.
 */
@Injectable()
export class MoneyService {
  /** Summaries for many jobs at once (three grouped queries, however many jobs). */
  async summaries(db: Db, jobIds: string[]): Promise<Map<string, MoneySummary>> {
    const [money, changes, payments, advances] = await Promise.all([
      db.jobMoney.findMany({ where: { jobId: { in: jobIds } } }),
      db.priceChange.groupBy({ by: ['jobId'], where: { jobId: { in: jobIds }, status: 'approved' }, _sum: { delta: true } }),
      db.payment.groupBy({ by: ['jobId'], where: { jobId: { in: jobIds } }, _sum: { amount: true } }),
      db.payment.groupBy({ by: ['jobId'], where: { jobId: { in: jobIds }, isAdvance: true }, _sum: { amount: true } }),
    ]);
    const agreed = new Map(money.map((m) => [m.jobId, m.agreedAmount]));
    const delta = new Map(changes.map((c) => [c.jobId, c._sum.delta ?? ZERO]));
    const received = new Map(payments.map((p) => [p.jobId, p._sum.amount ?? ZERO]));
    const advance = new Map(advances.map((p) => [p.jobId, p._sum.amount ?? ZERO]));

    return new Map(
      jobIds.map((jobId) => {
        const a = agreed.get(jobId) ?? null;
        const d = delta.get(jobId) ?? ZERO;
        const r = received.get(jobId) ?? ZERO;
        return [jobId, { jobId, agreedAmount: a, approvedChanges: d, advance: advance.get(jobId) ?? ZERO, received: r, balance: a ? a.plus(d).minus(r) : null }];
      }),
    );
  }

  async summary(db: Db, jobId: string): Promise<MoneySummary> {
    return (await this.summaries(db, [jobId])).get(jobId)!;
  }

  /** What is still owed, or null when no agreed amount exists yet. */
  async balance(db: Db, jobId: string): Promise<Prisma.Decimal | null> {
    return (await this.summary(db, jobId)).balance;
  }

  /** When a released job's balance reaches zero it becomes Paid. */
  async settleIfPaid(db: Db, jobId: string): Promise<void> {
    const balance = await this.balance(db, jobId);
    if (balance && balance.lte(0)) await db.job.updateMany({ where: { id: jobId, status: 'released' }, data: { status: 'paid' } });
  }

  /** One row per job with its client and money: the accounts ledger (and the summary shown on a job). */
  async accountRows(db: Db, where: Prisma.JobWhereInput = {}) {
    const jobs = await db.job.findMany({
      where,
      select: { id: true, number: true, status: true, startsAt: true, city: true, client: { select: { name: true } } },
      orderBy: [{ startsAt: { sort: 'desc', nulls: 'last' } }, { number: 'desc' }],
    });
    const sums = await this.summaries(db, jobs.map((j) => j.id));
    return jobs.map((j) => {
      const m = sums.get(j.id)!;
      return {
        id: j.id, code: jobCode(j.number), status: j.status, startsAt: j.startsAt, city: j.city, clientName: j.client.name,
        agreedAmount: m.agreedAmount, approvedChanges: m.approvedChanges, advance: m.advance, received: m.received, balance: m.balance,
      };
    });
  }

  async accountRow(db: Db, jobId: string) {
    return (await this.accountRows(db, { id: jobId }))[0] ?? null;
  }
}
