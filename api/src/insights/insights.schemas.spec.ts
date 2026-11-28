import { AuditQuery, MonthQuery } from './insights.schemas.js';

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
