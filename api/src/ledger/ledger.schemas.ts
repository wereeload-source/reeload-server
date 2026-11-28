import { z } from 'zod';
import { JOB_STATUSES } from '../common/types.js';

export const RecordPayment = z.strictObject({
  amount: z.number().positive('Enter the amount received'),
  method: z.enum(['upi', 'bank_transfer', 'cash']),
  reference: z.string().trim().max(120).optional().nullable(),
  is_advance: z.boolean().default(false),
  received_at: z.string().datetime({ offset: true }).optional(),
});

export const LedgerQuery = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
  /** Only jobs that still owe money. */
  outstanding: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

export type RecordPaymentInput = z.infer<typeof RecordPayment>;
export type LedgerQueryInput = z.infer<typeof LedgerQuery>;
