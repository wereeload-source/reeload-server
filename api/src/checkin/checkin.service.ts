import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, one, rows } from '../common/db.js';
import { makeOtp, safeEqual, sha256 } from '../common/crypto.js';
import type { AuthUser } from '../common/types.js';
import {
  OTP_TTL_MS, MAX_SENDS, canRelease, canSendCode, canTryCode, releaseInSeconds, triesLeftAfterWrong, type Verdict,
} from './checkin.rules.js';
import type { CompleteCheckinInput, ReleaseCheckinInput, VerifyCodeInput } from './checkin.schemas.js';
import {
  AUDIT_SQL, BUMP_ATTEMPTS_SQL, COMPLETE_CHECKIN_SQL, JOB_CHECKIN_SQL, JOB_REACHED_SQL, LOCK_CHECKIN_SQL, LOCK_JOB_CHECKIN_SQL,
  MARK_RELEASED_SQL, MARK_VERIFIED_OTP_SQL, MY_STATE_SQL, PENDING_CHECKINS_SQL, PROOF_PHOTOS_SQL, START_CONTEXT_SQL, UPSERT_CODE_SQL,
} from './checkin.sql.js';
import { maskPhone } from './phone.js';
import { WhatsAppService } from './whatsapp.service.js';

interface CheckinRow {
  id: string; requested_at: Date; otp_hash: string | null; otp_expires_at: Date | null; otp_sends: number;
  otp_last_sent_at: Date | null; otp_attempts: number; method: string | null; verified_at: Date | null; completed_at: Date | null;
}

const refuse = (v: Verdict): never => {
  if (v.ok) throw new Error('not a refusal');
  throw new HttpException({ statusCode: v.status, message: v.message }, v.status);
};

/**
 * Shoot-day check-in. Codes and attempts live in `checkins`, which no user role can write, so
 * these methods run as the service role after checking the caller. Each one locks the check-in row
 * so two taps at once cannot beat the send and attempt limits. A wrong code must stay counted, so
 * it is committed first and the error is thrown afterwards.
 */
@Injectable()
export class CheckinService {
  constructor(private readonly db: DbService, private readonly whatsapp: WhatsAppService) {}

  /** The reelmaker taps Reached: a six-digit code goes to the client's WhatsApp. */
  async start(user: AuthUser, jobId: string) {
    const prepared = await this.db.asService(async (tx) => {
      const ctx = await one<{ id: string; send_to: string | null }>(tx, START_CONTEXT_SQL, [jobId, user.id]);
      if (!ctx) throw new ForbiddenException('Accept this shoot first');
      if (!ctx.send_to) throw new BadRequestException('No WhatsApp number on this job. Call operations.');
      const existing = await one<CheckinRow>(tx, LOCK_CHECKIN_SQL, [jobId, user.id]);
      const verdict = canSendCode(existing, Date.now());
      if (!verdict.ok) return { kind: 'refused', verdict } as const;

      const code = makeOtp();
      const saved = await one<{ otp_sends: number; otp_expires_at: Date }>(tx, UPSERT_CODE_SQL, [
        jobId, user.id, sha256(`${jobId}:${code}`), new Date(Date.now() + OTP_TTL_MS).toISOString(),
      ]);
      return { kind: 'sent', code, sendTo: ctx.send_to, saved: saved! } as const;
    }, user.id);

    if (prepared.kind === 'refused') return refuse(prepared.verdict);
    // Sent after the commit; if WhatsApp fails the reelmaker sees the error and the send still counts.
    await this.whatsapp.sendOtp(prepared.sendTo, prepared.code);
    return {
      sent_to: maskPhone(prepared.sendTo),
      sends_left: MAX_SENDS - prepared.saved.otp_sends,
      expires_at: prepared.saved.otp_expires_at,
    };
  }

  /** The reelmaker enters the code the client reads out. */
  async verify(user: AuthUser, jobId: string, body: VerifyCodeInput) {
    const outcome = await this.db.asService(async (tx) => {
      const c = await one<CheckinRow>(tx, LOCK_CHECKIN_SQL, [jobId, user.id]);
      if (!c) return { kind: 'error', status: 400, message: 'Tap Reached first' } as const;
      if (c.verified_at) return { kind: 'ok' } as const;
      const verdict = canTryCode(c, Date.now());
      if (!verdict.ok) return { kind: 'error', status: verdict.status, message: verdict.message } as const;

      const good = safeEqual(sha256(`${jobId}:${body.code}`), c.otp_hash ?? '');
      if (!good) {
        await tx.query(BUMP_ATTEMPTS_SQL, [c.id]);
        return { kind: 'error', status: 400, message: `Wrong code. ${triesLeftAfterWrong(c.otp_attempts)} tries left.` } as const;
      }
      await tx.query(MARK_VERIFIED_OTP_SQL, [c.id]);
      return { kind: 'ok' } as const;
    }, user.id);

    if (outcome.kind === 'error') throw new HttpException({ statusCode: outcome.status, message: outcome.message }, outcome.status);
    return { ok: true };
  }

  /** Operations approves without a code, five minutes after Reached, with a written reason. */
  async release(user: AuthUser, jobId: string, body: ReleaseCheckinInput) {
    const outcome = await this.db.asService(async (tx) => {
      const c = await one<CheckinRow>(tx, LOCK_JOB_CHECKIN_SQL, [jobId]);
      if (!c) return { status: 400, message: 'The reelmaker has not tapped Reached yet' };
      const verdict = canRelease(c, body.reason, Date.now());
      if (!verdict.ok) return verdict;
      await tx.query(MARK_RELEASED_SQL, [c.id, body.reason.trim(), user.id]);
      await tx.query(AUDIT_SQL, ['checkin_release', 'jobs', jobId, JSON.stringify({ reason: body.reason.trim() })]);
      return null;
    }, user.id);

    if (outcome) throw new HttpException({ statusCode: outcome.status, message: outcome.message }, outcome.status);
    return { ok: true };
  }

  /** After the code: two live photos recorded, the job becomes Reached, with a server time stamp. */
  async complete(user: AuthUser, jobId: string, body: CompleteCheckinInput) {
    return this.db.asService(async (tx) => {
      const c = await one<CheckinRow>(tx, LOCK_CHECKIN_SQL, [jobId, user.id]);
      if (!c?.verified_at) throw new BadRequestException('Verify the code first');
      if (c.completed_at) return { ok: true, completed_at: c.completed_at };
      const ids = [body.selfie_upload_id, body.location_upload_id];
      const photos = await rows(tx, PROOF_PHOTOS_SQL, [ids, jobId, user.id]);
      if (photos.length !== 2) throw new BadRequestException('Take both live photos first');
      const done = await one<{ completed_at: Date }>(tx, COMPLETE_CHECKIN_SQL, [c.id, ids[0], ids[1]]);
      await tx.query(JOB_REACHED_SQL, [jobId]);
      await tx.query(AUDIT_SQL, ['checkin', 'jobs', jobId, JSON.stringify({ method: c.method, completed_at: done!.completed_at })]);
      return { ok: true, completed_at: done!.completed_at };
    }, user.id);
  }

  /** For the reelmaker's screen: which step they are on and when they can resend. */
  async myState(user: AuthUser, jobId: string) {
    const c = await this.db.asService((tx) => one<CheckinRow>(tx, MY_STATE_SQL, [jobId, user.id]));
    const now = Date.now();
    if (!c) return { step: 'not_started', sends_left: MAX_SENDS, resend_in_seconds: 0 };
    const resendIn = c.otp_last_sent_at ? Math.max(Math.ceil((60_000 - (now - new Date(c.otp_last_sent_at).getTime())) / 1000), 0) : 0;
    return {
      step: c.completed_at ? 'done' : c.verified_at ? 'photos' : 'code_sent',
      method: c.method,
      sends_left: Math.max(MAX_SENDS - c.otp_sends, 0),
      resend_in_seconds: c.verified_at ? 0 : resendIn,
      attempts_left: Math.max(5 - c.otp_attempts, 0),
      expires_at: c.otp_expires_at,
      verified_at: c.verified_at,
      completed_at: c.completed_at,
    };
  }

  /** Ops: who is waiting on a code, and when Release becomes available for each. */
  async pending(user: AuthUser) {
    const list = await this.db.asUser(user.id, (tx) => rows<{ requested_at: Date }>(tx, PENDING_CHECKINS_SQL));
    const now = Date.now();
    return list.map((c) => ({ ...c, release_in_seconds: releaseInSeconds(c.requested_at, now) }));
  }

  async forJob(user: AuthUser, jobId: string) {
    const c = await this.db.asUser(user.id, (tx) => one(tx, JOB_CHECKIN_SQL, [jobId]));
    if (!c) throw new NotFoundException('No check-in yet');
    return c;
  }
}
