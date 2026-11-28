import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { AssignService } from '../assign/assign.service.js';
import { jobCode } from '../common/job-code.js';
import { istDate, istDayRange, istMonthRange, istToday } from '../common/time.js';
import type { AuthUser } from '../common/types.js';
import { MoneyService } from '../money/money.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReviewService } from '../review/review.service.js';
import type { AuditQueryInput, DayQueryInput, MonthQueryInput } from './insights.schemas.js';

const DAY_MS = 86_400_000;

@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly money: MoneyService,
    private readonly assign: AssignService,
    private readonly review: ReviewService,
  ) {}

  /** Jobs per IST day with a count per status. Cancelled jobs are left out. No money. */
  async calendarMonth(q: MonthQueryInput) {
    const month = q.month ?? istToday().slice(0, 7);
    const { from, to } = istMonthRange(month);
    const jobs = await this.prisma.job.findMany({
      where: { startsAt: { gte: new Date(from), lt: new Date(to) }, status: { not: 'cancelled' } },
      select: { startsAt: true, status: true },
    });
    const days = new Map<string, { day: string; jobs: number; byStatus: Record<string, number> }>();
    for (const j of jobs) {
      const day = istDate(j.startsAt!);
      const d = days.get(day) ?? { day, jobs: 0, byStatus: {} };
      d.jobs++;
      d.byStatus[j.status] = (d.byStatus[j.status] ?? 0) + 1;
      days.set(day, d);
    }
    return { month, days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)) };
  }

  /** Everything on one IST day, in time order, with who is doing it. No money. */
  async calendarDay(q: DayQueryInput) {
    const date = q.date ?? istToday();
    const { from, to } = istDayRange(date);
    const jobs = await this.prisma.job.findMany({
      where: { startsAt: { gte: new Date(from), lt: new Date(to) }, status: { not: 'cancelled' } },
      select: {
        id: true, number: true, status: true, city: true, address: true, startsAt: true, durationMinutes: true,
        client: { select: { name: true } },
        assignments: { where: { status: { in: ['pending', 'accepted'] } }, take: 1, select: { status: true, reelmaker: { select: { id: true, fullName: true } } } },
      },
      orderBy: { startsAt: 'asc' },
    });
    return {
      date,
      jobs: jobs.map(({ number, client, assignments, ...j }) => ({
        ...j, code: jobCode(number), clientName: client.name,
        reelmaker: assignments[0] ? { id: assignments[0].reelmaker.id, fullName: assignments[0].reelmaker.fullName, status: assignments[0].status } : null,
      })),
    };
  }

  /** A reelmaker's own month: their shoots per day, and their leave days. */
  async myCalendar(user: AuthUser, q: MonthQueryInput) {
    const month = q.month ?? istToday().slice(0, 7);
    const { from, to } = istMonthRange(month);
    const [start, end] = [new Date(from), new Date(to)];
    const [shoots, leave] = await Promise.all([
      this.prisma.assignment.findMany({ where: { reelmakerId: user.id, status: { in: ['pending', 'accepted'] }, startsAt: { gte: start, lt: end } }, select: { startsAt: true } }),
      this.prisma.leave.findMany({ where: { reelmakerId: user.id, startsAt: { lt: end }, endsAt: { gt: start } }, select: { startsAt: true, endsAt: true, note: true } }),
    ]);

    const days = new Map<string, { kind: string; day: string; n: number; note: string | null }>();
    for (const s of shoots) {
      const day = istDate(s.startsAt);
      const d = days.get(`shoot:${day}`) ?? { kind: 'shoot', day, n: 0, note: null };
      d.n++;
      days.set(`shoot:${day}`, d);
    }
    for (const l of leave) {
      for (let t = Math.max(l.startsAt.getTime(), start.getTime()); t < Math.min(l.endsAt.getTime(), end.getTime()); t += DAY_MS) {
        const day = istDate(new Date(t));
        days.set(`leave:${day}`, { kind: 'leave', day, n: 1, note: l.note });
      }
    }
    return { month, days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day) || a.kind.localeCompare(b.kind)) };
  }

  /** The Admin overview: what needs attention today, and the numbers behind it. */
  async dashboard() {
    const today = istDayRange(istToday());
    const month = istMonthRange(istToday().slice(0, 7));
    const [dayFrom, dayTo, monthFrom, monthTo] = [new Date(today.from), new Date(today.to), new Date(month.from), new Date(month.to)];

    const [byStatus, todayJobs, queue, checkinsWaiting, overdue, priceChanges, extraTime, rows, receivedThisMonth, calls, recent] = await Promise.all([
      this.prisma.job.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.job.findMany({ where: { startsAt: { gte: dayFrom, lt: dayTo }, status: { not: 'cancelled' } }, select: { status: true } }),
      this.assign.queue(),
      this.prisma.checkin.count({ where: { verifiedAt: null } }),
      this.review.queue({ overdue: true }),
      this.prisma.priceChange.count({ where: { status: 'pending' } }),
      this.prisma.extraTime.count({ where: { decision: 'pending' } }),
      this.money.accountRows(this.prisma),
      this.prisma.payment.aggregate({ where: { receivedAt: { gte: monthFrom, lt: monthTo } }, _sum: { amount: true } }),
      this.prisma.contactLog.groupBy({ by: ['outcome'], where: { createdAt: { gte: dayFrom, lt: dayTo } }, _count: { _all: true } }),
      this.audit({ limit: 10 }),
    ]);

    const owing = rows.filter((r) => r.balance !== null && r.balance.gt(0));
    const calls_ = Object.fromEntries(calls.map((c) => [c.outcome, c._count._all]));
    const reachedStates = ['reached', 'uploaded', 'released', 'paid', 'delivered', 'closed'];
    return {
      generatedAt: new Date().toISOString(),
      jobsByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      today: { shoots: todayJobs.length, reached: todayJobs.filter((j) => reachedStates.includes(j.status)).length },
      needsAttention: {
        unassigned: { total: queue.unassigned.length, flagged: queue.flagged },
        checkinsWaiting,
        uploadsOverdue: overdue.length,
        approvals: { priceChanges, extraTime },
      },
      money: {
        outstanding: owing.reduce((s, r) => s.plus(r.balance!), new Prisma.Decimal(0)),
        jobsOwing: owing.length,
        receivedThisMonth: receivedThisMonth._sum.amount ?? new Prisma.Decimal(0),
      },
      salesToday: {
        spoken: calls.reduce((s, c) => s + c._count._all, 0),
        approved: calls_.approved ?? 0, rejected: calls_.rejected ?? 0, followUps: calls_.follow_up ?? 0,
      },
      recentActivity: recent.items,
    };
  }

  async audit(q: Pick<AuditQueryInput, 'limit'> & Partial<AuditQueryInput>) {
    const limit = q.limit ?? 50;
    const rows = await this.prisma.auditLog.findMany({
      where: { ...(q.entity ? { entity: q.entity } : {}), ...(q.action ? { action: q.action } : {}), ...(q.before ? { id: { lt: q.before } } : {}) },
      include: { actor: { select: { fullName: true } } },
      orderBy: { id: 'desc' },
      take: limit,
    });
    const items = rows.map(({ actor, ...a }) => ({ ...a, actorName: actor?.fullName ?? null }));
    return { items, nextBefore: items.length === limit ? (items.at(-1)?.id ?? null) : null };
  }
}
