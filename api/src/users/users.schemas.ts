import { z } from 'zod';

export const ROLES = ['admin', 'sales', 'ops', 'reelmaker', 'accounts'] as const;
const reelmakerKind = z.enum(['full_time', 'freelance']);
const phone = z.string().trim().max(20).optional().nullable();

export const CreateUser = z
  .object({
    email: z.string().trim().toLowerCase().email().max(200),
    password: z.string().min(8, 'Use at least 8 characters').max(200),
    full_name: z.string().trim().min(1).max(120),
    phone,
    role: z.enum(ROLES),
    kind: reelmakerKind.optional(),
    base_city: z.string().trim().min(1).max(80).optional(),
  })
  .refine((u) => u.role !== 'reelmaker' || !!u.base_city, { message: 'Enter the reelmaker\'s base city', path: ['base_city'] });

export const UpdateUser = z
  .object({
    full_name: z.string().trim().min(1).max(120),
    phone,
    active: z.boolean(),
    role: z.enum(ROLES),
    kind: reelmakerKind,
    base_city: z.string().trim().min(1).max(80),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'Nothing to update');

export const ResetPassword = z.object({ password: z.string().min(8, 'Use at least 8 characters').max(200) });

export type CreateUserInput = z.infer<typeof CreateUser>;
export type UpdateUserInput = z.infer<typeof UpdateUser>;
