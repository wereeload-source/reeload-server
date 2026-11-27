import { z } from 'zod';

const instant = z.string().datetime({ offset: true });

export const AssignJob = z.object({
  reelmaker_id: z.string().uuid(),
  /** Why the shoot is being reassigned (kept on the cancelled booking). */
  reason: z.string().trim().max(300).optional().nullable(),
});

export const LeaveInput = z
  .object({
    reelmaker_id: z.string().uuid(),
    from: instant,
    to: instant,
    note: z.string().trim().max(200).optional().nullable(),
  })
  .refine((o) => new Date(o.to) > new Date(o.from), { message: 'The end must be after the start', path: ['to'] });

export const LeaveQuery = z.object({
  reelmaker_id: z.string().uuid().optional(),
  /** Only leave that has not ended yet. */
  upcoming: z.enum(['true', 'false']).optional().transform((v) => v !== 'false'),
});

export type AssignJobInput = z.infer<typeof AssignJob>;
export type LeaveInputT = z.infer<typeof LeaveInput>;
export type LeaveQueryInput = z.infer<typeof LeaveQuery>;
