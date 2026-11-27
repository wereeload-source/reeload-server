import { z } from 'zod';
import { JOB_STATUSES } from '../common/types.js';

const text = (max = 500) => z.string().trim().max(max);
const optText = (max = 500) => text(max).optional().nullable();
const instant = z.string().datetime({ offset: true });

export const ClientInput = z.object({
  name: text(120).min(1),
  phone: text(20).min(6, 'Enter the client phone number'),
  whatsapp: text(20).optional(),
  city: text(80).optional(),
});

export const JobDetails = z.object({
  city: text(80).min(1),
  address: optText(300),
  maps_url: z.string().trim().url().max(500).optional().nullable(),
  starts_at: instant.optional().nullable(),
  duration_minutes: z.number().int().positive().max(24 * 60).optional().nullable(),
  onsite_contact_name: optText(120),
  onsite_contact_phone: optText(20),
  brief: optText(2000),
  consent: z.boolean().optional(),
});

export const AdvanceInput = z.object({
  amount: z.number().positive(),
  method: z.enum(['upi', 'bank_transfer', 'cash']).default('upi'),
  reference: optText(120),
});

export const CreateJob = z.object({
  client: ClientInput,
  job: JobDetails,
  agreed_amount: z.number().positive().optional(),
  advance: AdvanceInput.optional(),
  /** Confirm straight away. Refused, and nothing saved, unless an advance is included. */
  confirm: z.boolean().default(false),
});

export const UpdateJob = JobDetails.partial().refine((o) => Object.keys(o).length > 0, 'Nothing to update');

export const AgreedAmount = z.object({ agreed_amount: z.number().positive() });

export const Reschedule = z.object({
  starts_at: instant,
  duration_minutes: z.number().int().positive().max(24 * 60).optional(),
  reason: optText(300),
});

export const ListJobsQuery = z.object({
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined))
    .refine((l) => !l || l.every((s) => (JOB_STATUSES as readonly string[]).includes(s)), 'Unknown status'),
  q: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  from: instant.optional(),
  to: instant.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const ClientLookup = z.object({ phone: z.string().trim().min(6).max(24) });

export type CreateJobInput = z.infer<typeof CreateJob>;
export type UpdateJobInput = z.infer<typeof UpdateJob>;
export type RescheduleInput = z.infer<typeof Reschedule>;
export type ListJobsInput = z.infer<typeof ListJobsQuery>;
