import { z } from 'zod';

export const RecordAdvance = z.object({
  amount: z.number().positive(),
  method: z.enum(['upi', 'bank_transfer', 'cash']).default('upi'),
  reference: z.string().trim().max(120).optional().nullable(),
});

export const RequestPriceChange = z.object({
  /** Positive raises the price, negative lowers it. */
  delta: z.number().refine((n) => n !== 0, 'Enter the change in amount'),
  reason: z.string().trim().min(3).max(300),
});

export const PriceChangeQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  job_id: z.string().uuid().optional(),
});

export const DecidePriceChange = z.object({ approve: z.boolean() });

export const LogContact = z.object({
  client_id: z.string().uuid().optional().nullable(),
  client_name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(24).optional().nullable(),
  outcome: z.enum(['spoken', 'follow_up', 'approved', 'rejected']),
  note: z.string().trim().max(500).optional().nullable(),
});

export const ContactQuery = z.object({
  /** IST calendar day, YYYY-MM-DD. Defaults to today. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type RecordAdvanceInput = z.infer<typeof RecordAdvance>;
export type RequestPriceChangeInput = z.infer<typeof RequestPriceChange>;
export type PriceChangeQueryInput = z.infer<typeof PriceChangeQuery>;
export type LogContactInput = z.infer<typeof LogContact>;
export type ContactQueryInput = z.infer<typeof ContactQuery>;
