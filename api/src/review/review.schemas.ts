import { z } from 'zod';

export const SendBack = z.object({ note: z.string().trim().min(5, 'Tell the reelmaker what to fix').max(500) });

export const AddExtraTime = z.object({
  minutes: z.number().int().positive().max(24 * 60),
  note: z.string().trim().max(300).optional().nullable(),
});

export const ExtraTimeQuery = z.object({
  decision: z.enum(['pending', 'charge', 'no_charge']).optional(),
  job_id: z.string().uuid().optional(),
});

export const DecideExtraTime = z
  .object({ charge: z.boolean(), amount: z.number().positive().optional() })
  .refine((o) => !o.charge || o.amount !== undefined, { message: 'Enter the extra amount', path: ['amount'] });

export const HoursDetailQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });

export type ReviewQueryInput = z.infer<typeof ReviewQuery>;
export type SendBackInput = z.infer<typeof SendBack>;
export type AddExtraTimeInput = z.infer<typeof AddExtraTime>;
export type ExtraTimeQueryInput = z.infer<typeof ExtraTimeQuery>;
export type DecideExtraTimeInput = z.infer<typeof DecideExtraTime>;
export type HoursDetailQueryInput = z.infer<typeof HoursDetailQuery>;
export const ReviewQuery = z.object({
  /** only jobs with something overdue */
  overdue: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});

