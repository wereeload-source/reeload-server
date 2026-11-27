import { z } from 'zod';

export const RespondShoot = z
  .object({ accept: z.boolean(), reason: z.string().trim().max(300).optional().nullable() })
  .refine((o) => o.accept || (o.reason && o.reason.length >= 3), { message: 'Tell Operations why you cannot do this shoot', path: ['reason'] });

export const DropOut = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) });

export const ShootsQuery = z.object({
  /** upcoming (default), past, or all */
  when: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
});

export const HoursQuery = z.object({
  /** YYYY-MM, IST month. Defaults to this month. */
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  reelmaker_id: z.string().uuid().optional(),
});

export type RespondShootInput = z.infer<typeof RespondShoot>;
export type DropOutInput = z.infer<typeof DropOut>;
export type ShootsQueryInput = z.infer<typeof ShootsQuery>;
export type HoursQueryInput = z.infer<typeof HoursQuery>;
