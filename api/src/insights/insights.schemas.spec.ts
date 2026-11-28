import { AuditQuery, MonthQuery, SETTING_RULES } from './insights.schemas.js';

describe('calendar and audit input', () => {
  it('accepts a month and rejects nonsense', () => {
    expect(MonthQuery.safeParse({ month: '2026-12' }).success).toBe(true);
    expect(MonthQuery.safeParse({ month: '2026-13' }).success).toBe(false);
    expect(MonthQuery.safeParse({ month: 'December' }).success).toBe(false);
  });
  it('limits the audit page size', () => {
    expect(AuditQuery.parse({}).limit).toBe(50);
    expect(AuditQuery.safeParse({ limit: '500' }).success).toBe(false);
  });
});

describe('setting rules', () => {
  it('keeps edited reels 15 to 20 days', () => {
    expect(SETTING_RULES.edited_retention_days.safeParse(14).success).toBe(false);
    expect(SETTING_RULES.edited_retention_days.safeParse(15).success).toBe(true);
    expect(SETTING_RULES.edited_retention_days.safeParse(21).success).toBe(false);
  });
  it('takes a yes or no for raw sharing', () => {
    expect(SETTING_RULES.share_include_raw.safeParse(true).success).toBe(true);
    expect(SETTING_RULES.share_include_raw.safeParse('true').success).toBe(false);
  });
  it('rejects fractions', () => expect(SETTING_RULES.share_link_days.safeParse(7.5).success).toBe(false));
});
