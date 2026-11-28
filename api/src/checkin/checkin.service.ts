import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingService } from '../assign/booking.service.js';
import { AuditService } from '../common/audit.service.js';
import { HashService } from '../common/hash.service.js';
import { jobCode } from '../common/job-code.js';
import type { AuthUser } from '../common/types.js';
import { WorkflowService } from '../common/workflow.service.js';
import { TX_OPTIONS } from '../prisma/db.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  MAX_ATTEMPTS, MAX_SENDS, OTP_TTL_MS, canRelease, canSendCode, canTryCode, releaseInSeconds, triesLeftAfterWrong, type Verdict,
} from './checkin.rules.js';
import type { CompleteCheckinInput, ReleaseCheckinInput, VerifyCodeInput } from './checkin.schemas.js';
import { maskPhone } from './phone.js';
import { WhatsAppService } from './whatsapp.service.js';

const refuse = (v: Verdict): never => {
  if (v.ok) throw new Error('not a refusal');
  throw new HttpException({ statusCode: v.status, message: v.message }, v.status);
};

/**
 * Shoot-day check-in. Codes and attempts live in `checkins`, which no route returns. Each step runs
 * under a lock on the job, so two taps at once cannot beat the send and attempt limits. A wrong code
 * must stay counted, so the transaction commits first and the error is thrown afterwards.
 */
@Injectable()
export class CheckinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly booking: BookingService,
    private readonly hash: HashService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  /** The reelmaker taps Reached: a six-digit code goes to the client's WhatsApp. */
  async start(user: AuthUser, jobId: string) {
    const prepared = await this.prisma.$transaction(async (tx) => {
      await this.booking.lockJob(tx, jobId);
      const job = await tx.job.findFirst({
        where: { id: jobId, assignments: { some: { reelmakerId: user.id, status: 'accepted' } } },
        select: { onsiteContactPhone: true, client: { select: { whatsapp: true, phone: true } } },
      });
      if (!job) throw new ForbiddenException('Accept this shoot first');
      const sendTo = job.onsiteContactPhone || job.client.whatsapp || job.client.phone;
      if (!sendTo) throw new BadRequestException('No WhatsApp number on this job. Call operations.');

      const existing = await tx.checkin.findUnique({ where: { jobId_reelmakerId: { jobId, reelmakerId: user.id } } });
      const verdict = canSendCode(existing, Date.now());
      if (!verdict.ok) return { kind: 'refused', verdict } as const;

      const code = this.hash.otp();
      const data = { otpHash: this.hash.sha256(`${jobId}:${code}`), otpExpiresAt: new Date(Date.now() + OTP_TTL_MS), otpLastSentAt: new Date(), otpAttempts: 0 };
      const saved = existing
        ? await tx.checkin.update({ where: { id: existing.id }, data: { ...data, otpSends: { increment: 1 } } })
        : await tx.checkin.create({ data: { jobId, reelmakerId: user.id, ...data, otpSends: 1 } });
      return { kind: 'sent', code, sendTo, saved } as const;
    }, TX_OPTIONS);

    if (prepared.kind === 'refused') return refuse(prepared.verdict);
    // Sent after the commit; if WhatsApp fails the reelmaker sees the error and the send still counts.
    await this.whatsapp.sendOtp(prepared.sendTo, prepared.code);
    return { sentTo: maskPhone(prepared.sendTo), sendsLeft: MAX_SENDS - prepared.saved.otpSends, expiresAt: prepared.saved.otpExpiresAt };
  }

  /** The reelmaker enters the code the client reads out. */
  async verify(user: AuthUser, jobId: string, body: VerifyCodeInput) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      await this.booking.lockJob(tx, jobId);
      const c = await tx.checkin.findUnique({ where: { jobId_reelmakerId: { jobId, reelmakerId: user.id } } });
      if (!c) return { kind: 'error', status: 400, message: 'Tap Reached first' } as const;
      if (c.verifiedAt) return { kind: 'ok' } as const;
      const verdict = canTryCode(c, Date.now());
      if (!verdict.ok) return { kind: 'error', status: verdict.status, message: verdict.message } as const;

      if (!this.hash.equal(this.hash.sha256(`${jobId}:${body.code}`), c.otpHash ?? '')) {
        await tx.checkin.update({ where: { id: c.id }, data: { otpAttempts: { increment: 1 } } });
        return { kind: 'error', status: 400, message: `Wrong code. ${triesLeftAfterWrong(c.otpAttempts)} tries left.` } as const;
      }
      await tx.checkin.update({ where: { id: c.id }, data: { verifiedAt: new Date(), method: 'otp', otpHash: null } });
      return { kind: 'ok' } as const;
    }, TX_OPTIONS);

    if (outcome.kind === 'error') throw new HttpException({ statusCode: outcome.status, message: outcome.message }, outcome.status);
    return { ok: true };
  }

  /** Operations approves without a code, five minutes after Reached, with a written reason. */
  async release(user: AuthUser, jobId: string, body: ReleaseCheckinInput) {
    const refused = await this.prisma.$transaction(async (tx) => {
      await this.booking.lockJob(tx, jobId);
      const c = await tx.checkin.findFirst({ where: { jobId } });
      if (!c) return { ok: false, status: 400, message: 'The reelmaker has not tapped Reached yet' } as Verdict;
      const verdict = canRelease(c, body.reason, Date.now());
      if (!verdict.ok) return verdict;
      await tx.checkin.update({
        where: { id: c.id },
        data: { verifiedAt: new Date(), method: 'ops_release', releaseReason: body.reason.trim(), releasedById: user.id, otpHash: null },
      });
      await this.audit.record(tx, user.id, 'checkin_release', 'jobs', jobId, { reason: body.reason.trim() });
      return null;
    }, TX_OPTIONS);

    if (refused) return refuse(refused);
    return { ok: true };
  }

  /** After the code: two live photos recorded, the job becomes Reached, with a server time stamp. */
  async complete(user: AuthUser, jobId: string, body: CompleteCheckinInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.booking.lockJob(tx, jobId);
      const c = await tx.checkin.findUnique({ where: { jobId_reelmakerId: { jobId, reelmakerId: user.id } } });
      if (!c?.verifiedAt) throw new BadRequestException('Verify the code first');
      if (c.completedAt) return { ok: true, completedAt: c.completedAt };

      const ids = [body.selfie_upload_id, body.location_upload_id];
      // The two photos must be this reelmaker's finished proof uploads for this job.
      const photos = await tx.upload.count({ where: { id: { in: ids }, jobId, kind: 'proof', status: 'complete', uploadedById: user.id } });
      if (photos !== 2) throw new BadRequestException('Take both live photos first');

      const done = await tx.checkin.update({
        where: { id: c.id },
        data: { selfieUploadId: ids[0], locationUploadId: ids[1], completedAt: new Date() },
      });
      const job = await tx.job.findUniqueOrThrow({ where: { id: jobId }, select: { status: true } });
      if (job.status === 'accepted') await this.workflow.transition(tx, jobId, 'reached', user.id);
      await this.audit.record(tx, user.id, 'checkin', 'jobs', jobId, { method: c.method, completedAt: done.completedAt });
      return { ok: true, completedAt: done.completedAt };
    }, TX_OPTIONS);
  }

  /** For the reelmaker's screen: which step they are on and when they can resend. */
  async myState(user: AuthUser, jobId: string) {
    const c = await this.prisma.checkin.findUnique({ where: { jobId_reelmakerId: { jobId, reelmakerId: user.id } } });
    if (!c) return { step: 'not_started', sendsLeft: MAX_SENDS, resendInSeconds: 0 };
    const resendIn = c.otpLastSentAt ? Math.max(Math.ceil((60_000 - (Date.now() - c.otpLastSentAt.getTime())) / 1000), 0) : 0;
    return {
      step: c.completedAt ? 'done' : c.verifiedAt ? 'photos' : 'code_sent',
      method: c.method,
      sendsLeft: Math.max(MAX_SENDS - c.otpSends, 0),
      resendInSeconds: c.verifiedAt ? 0 : resendIn,
      attemptsLeft: Math.max(MAX_ATTEMPTS - c.otpAttempts, 0),
      expiresAt: c.otpExpiresAt,
      verifiedAt: c.verifiedAt,
      completedAt: c.completedAt,
    };
  }

  /** Ops: who is waiting on a code, and when Release becomes available for each. */
  async pending() {
    const list = await this.prisma.checkin.findMany({
      where: { verifiedAt: null },
      select: {
        id: true, jobId: true, reelmakerId: true, requestedAt: true, otpSends: true, otpAttempts: true, otpLastSentAt: true,
        job: { select: { number: true, city: true, startsAt: true } }, reelmaker: { select: { fullName: true } },
      },
      orderBy: { requestedAt: 'asc' },
    });
    const now = Date.now();
    return list.map(({ id, job, reelmaker, ...c }) => ({
      checkinId: id, ...c, code: jobCode(job.number), city: job.city, startsAt: job.startsAt, reelmaker: reelmaker.fullName,
      releaseInSeconds: releaseInSeconds(c.requestedAt, now),
    }));
  }

  /** Everything about one job's check-in for Ops (never the code or its hash). */
  async forJob(jobId: string) {
    const c = await this.prisma.checkin.findFirst({
      where: { jobId },
      select: {
        id: true, jobId: true, reelmakerId: true, requestedAt: true, otpSends: true, otpAttempts: true, method: true, verifiedAt: true,
        releaseReason: true, releasedById: true, completedAt: true, selfieUploadId: true, locationUploadId: true,
        reelmaker: { select: { fullName: true } }, releasedBy: { select: { fullName: true } },
      },
    });
    if (!c) throw new NotFoundException('No check-in yet');
    const { reelmaker, releasedBy, ...rest } = c;
    return { ...rest, reelmaker: reelmaker.fullName, releasedByName: releasedBy?.fullName ?? null };
  }
}
