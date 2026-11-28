import { istDate, istDayRange, istMonthRange, istStamp } from './time.js';

describe('Indian time helpers', () => {
  it('finds the IST day an instant falls on', () => {
    expect(istDate('2026-11-28T18:29:00Z')).toBe('2026-11-28'); // 23:59 IST
    expect(istDate('2026-11-28T18:30:00Z')).toBe('2026-11-29'); // 00:00 IST next day
  });

  it('gives the UTC bounds of an IST day and month', () => {
    expect(istDayRange('2026-11-28')).toEqual({ from: '2026-11-27T18:30:00.000Z', to: '2026-11-28T18:30:00.000Z' });
    expect(istMonthRange('2026-12').to).toBe('2026-12-31T18:30:00.000Z');
    expect(istMonthRange('2026-11').from).toBe('2026-10-31T18:30:00.000Z');
  });

  it('writes a Postgres range and cleans search text', () => {
    expect(istStamp(new Date('2026-11-28T04:00:00Z'))).toBe('28 Nov, 09:30');
  });
});
