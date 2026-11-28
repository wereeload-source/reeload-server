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

/** Which settings exist and what values they take. The database also enforces the retention range. */
const days = (min: number, max: number) => z.number().int().min(min).max(max);
export const SETTING_RULES = {
  raw_retention_days: days(1, 60),
  edited_retention_days: days(15, 20),
  share_link_days: days(1, 30),
  share_include_raw: z.boolean(),
  raw_due_hours: days(1, 240),
  edited_due_days: days(1, 30),
  unassigned_flag_hours: days(1, 240),
} as const;
export type SettingKey = keyof typeof SETTING_RULES;
export const SETTING_KEYS = Object.keys(SETTING_RULES) as SettingKey[];

export type MonthQueryInput = z.infer<typeof MonthQuery>;
export type DayQueryInput = z.infer<typeof DayQuery>;
export type AuditQueryInput = z.infer<typeof AuditQuery>;
