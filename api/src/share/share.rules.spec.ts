import { linkState, linkVerdict } from './share.rules.js';

describe('who may make a download link', () => {
  it('lets Ops make one once the job is paid', () => expect(linkVerdict('ops', 'paid')).toEqual({ ok: true, early: false }));
  it('keeps working after delivery and closing', () => {
    expect(linkVerdict('ops', 'delivered')).toEqual({ ok: true, early: false });
    expect(linkVerdict('ops', 'closed')).toEqual({ ok: true, early: false });
  });
  it('refuses Ops before payment', () => expect(linkVerdict('ops', 'released')).toMatchObject({ ok: false, status: 409 }));
  it('lets Admin go early once released, and says it was early', () => expect(linkVerdict('admin', 'released')).toEqual({ ok: true, early: true }));
  it('does not let even Admin share unreleased work', () => expect(linkVerdict('admin', 'uploaded')).toMatchObject({ ok: false, message: 'Release the work first' }));
});

describe('link state', () => {
  const now = Date.parse('2026-12-10T00:00:00Z');
  it('is active before the expiry', () => expect(linkState({ revoked_at: null, expires_at: '2026-12-17T00:00:00Z' }, now)).toBe('active'));
  it('expires after 7 days', () => expect(linkState({ revoked_at: null, expires_at: '2026-12-09T00:00:00Z' }, now)).toBe('expired'));
  it('revoked wins over everything', () => expect(linkState({ revoked_at: '2026-12-01T00:00:00Z', expires_at: '2026-12-17T00:00:00Z' }, now)).toBe('revoked'));
});
