import { z } from 'zod';

/** The settings an Admin may change, with the rule each value must follow (from the project documentation). */
export const SETTING_RULES = {
  raw_retention_days: z.number().int().min(1).max(30),
  edited_retention_days: z.number().int().min(15, 'Edited files are kept 15 to 20 days').max(20, 'Edited files are kept 15 to 20 days'),
  share_link_days: z.number().int().min(1).max(30),
  share_include_raw: z.boolean(),
  raw_due_hours: z.number().int().min(1).max(240),
  edited_due_days: z.number().int().min(1).max(30),
  unassigned_flag_hours: z.number().int().min(1).max(720),
} as const;

export type SettingKey = keyof typeof SETTING_RULES;
export const SETTING_KEYS = Object.keys(SETTING_RULES) as SettingKey[];

/** Used until an Admin changes a value. */
export const SETTING_DEFAULTS: Record<SettingKey, number | boolean> = {
  raw_retention_days: 10,
  edited_retention_days: 20,
  share_link_days: 7,
  share_include_raw: false,
  raw_due_hours: 24,
  edited_due_days: 3,
  unassigned_flag_hours: 48,
};
