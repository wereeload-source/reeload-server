import {
  MAX_ATTEMPTS, OPS_RELEASE_AFTER_MS, OTP_TTL_MS, canRelease, canSendCode, canTryCode, releaseInSeconds, triesLeftAfterWrong,
} from './checkin.rules.js';

const T0 = Date.parse('2026-12-01T10:00:00Z');
const at = (ms: number) => new Date(T0 + ms);

describe('sending the code', () => {
  it('allows the first send', () => expect(canSendCode(null, T0).ok).toBe(true));
  it('makes the reelmaker wait 60 seconds between sends', () => {
    const v = canSendCode({ otpSends: 1, otpLastSentAt: at(0), verifiedAt: null }, T0 + 20_000);
    expect(v).toMatchObject({ ok: false, status: 429 });
    expect((v as { message: string }).message).toContain('40 seconds');
  });
  it('allows a resend after 60 seconds', () => {
    expect(canSendCode({ otpSends: 1, otpLastSentAt: at(0), verifiedAt: null }, T0 + 60_000).ok).toBe(true);
  });
  it('stops after 3 sends', () => {
    expect(canSendCode({ otpSends: 3, otpLastSentAt: at(0), verifiedAt: null }, T0 + 3_600_000)).toMatchObject({ ok: false, status: 429 });
  });
  it('refuses once verified', () => {
    expect(canSendCode({ otpSends: 1, otpLastSentAt: at(0), verifiedAt: at(1) }, T0 + 120_000)).toMatchObject({ ok: false, status: 409 });
  });
});

describe('trying the code', () => {
  const live = { otpHash: 'h', otpAttempts: 0, otpExpiresAt: at(OTP_TTL_MS) };
  it('accepts a live code', () => expect(canTryCode(live, T0 + 1000).ok).toBe(true));
  it('expires after 10 minutes', () => expect(canTryCode(live, T0 + OTP_TTL_MS + 1)).toMatchObject({ ok: false, status: 410 }));
  it('locks after 5 wrong attempts', () => {
    expect(canTryCode({ ...live, otpAttempts: MAX_ATTEMPTS }, T0)).toMatchObject({ ok: false, status: 429 });
    expect(canTryCode({ ...live, otpAttempts: MAX_ATTEMPTS - 1 }, T0).ok).toBe(true);
  });
  it('needs Reached first', () => expect(canTryCode({ ...live, otpHash: null }, T0)).toMatchObject({ ok: false, status: 400 }));
  it('counts tries left', () => {
    expect(triesLeftAfterWrong(0)).toBe(4);
    expect(triesLeftAfterWrong(4)).toBe(0);
  });
});

describe('Operations release', () => {
  const waiting = { requestedAt: at(0), verifiedAt: null };
  it('is refused inside 5 minutes', () => expect(canRelease(waiting, 'Client unreachable', T0 + OPS_RELEASE_AFTER_MS - 1)).toMatchObject({ ok: false, status: 409 }));
  it('is allowed at 5 minutes with a reason', () => expect(canRelease(waiting, 'Client unreachable', T0 + OPS_RELEASE_AFTER_MS).ok).toBe(true));
  it('needs a real reason', () => expect(canRelease(waiting, 'no', T0 + OPS_RELEASE_AFTER_MS)).toMatchObject({ ok: false, status: 400 }));
  it('is refused when already verified', () => expect(canRelease({ ...waiting, verifiedAt: at(1) }, 'Client unreachable', T0 + OPS_RELEASE_AFTER_MS)).toMatchObject({ ok: false, status: 409 }));
  it('tells the screen how long to wait', () => {
    expect(releaseInSeconds(at(0), T0 + 60_000)).toBe(240);
    expect(releaseInSeconds(at(0), T0 + 10 * 60_000)).toBe(0);
  });
});
