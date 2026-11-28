/** The check-in rules from the documentation (section 5), kept as plain functions so they can be tested. */
export const OTP_TTL_MS = 10 * 60_000;
export const MAX_SENDS = 3;
export const RESEND_WAIT_MS = 60_000;
export const MAX_ATTEMPTS = 5;
export const OPS_RELEASE_AFTER_MS = 5 * 60_000;

export type Verdict = { ok: true } | { ok: false; status: number; message: string };
const no = (status: number, message: string): Verdict => ({ ok: false, status, message });
const yes: Verdict = { ok: true };

/** May a code be (re)sent? Max 3 sends, 60 seconds apart. */
export function canSendCode(existing: { otpSends: number; otpLastSentAt: Date | string | null; verifiedAt: Date | string | null } | null, now: number): Verdict {
  if (!existing) return yes;
  if (existing.verifiedAt) return no(409, 'Already verified');
  if (existing.otpSends >= MAX_SENDS) return no(429, 'Code sent 3 times. Call operations.');
  if (existing.otpLastSentAt) {
    const wait = RESEND_WAIT_MS - (now - new Date(existing.otpLastSentAt).getTime());
    if (wait > 0) return no(429, `Wait ${Math.ceil(wait / 1000)} seconds before resending`);
  }
  return yes;
}

/** May a code still be tried? (5 wrong attempts, 10 minutes) */
export function canTryCode(c: { otpHash: string | null; otpAttempts: number; otpExpiresAt: Date | string | null }, now: number): Verdict {
  if (!c.otpHash) return no(400, 'Tap Reached first');
  if (c.otpAttempts >= MAX_ATTEMPTS) return no(429, 'Too many wrong codes. Call operations.');
  if (!c.otpExpiresAt || now > new Date(c.otpExpiresAt).getTime()) return no(410, 'Code expired. Send a new one.');
  return yes;
}

export const triesLeftAfterWrong = (attemptsBefore: number): number => Math.max(MAX_ATTEMPTS - attemptsBefore - 1, 0);

/** Operations may approve without a code only 5 minutes after the reelmaker tapped Reached. */
export function canRelease(c: { requestedAt: Date | string; verifiedAt: Date | string | null }, reason: string, now: number): Verdict {
  if (reason.trim().length < 5) return no(400, 'Write a reason');
  if (c.verifiedAt) return no(409, 'Already verified');
  if (now - new Date(c.requestedAt).getTime() < OPS_RELEASE_AFTER_MS) return no(409, 'Wait 5 minutes after the code was requested');
  return yes;
}

/** Seconds until Operations may release, 0 when already allowed. */
export const releaseInSeconds = (requestedAt: Date | string, now: number): number =>
  Math.max(Math.ceil((OPS_RELEASE_AFTER_MS - (now - new Date(requestedAt).getTime())) / 1000), 0);
