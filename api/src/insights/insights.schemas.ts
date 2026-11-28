import { z } from 'zod';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

export const MonthQuery = z.object({ month: month.optional() });
export const DayQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional() });

export const AuditQuery = z.object({
  entity: z.string().trim().max(40).optional(),
  action: z.string().trim().max(60).optional(),
  /** Continue after this audit id (newest first). */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type MonthQueryInput = z.infer<typeof MonthQuery>;
export type DayQueryInput = z.infer<typeof DayQuery>;
export type AuditQueryInput = z.infer<typeof AuditQuery>;
