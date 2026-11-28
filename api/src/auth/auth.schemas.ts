import { z } from 'zod';

export const Login = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

export const ChangePassword = z.object({
  current: z.string().min(1).max(200),
  next: z.string().min(8, 'Use at least 8 characters').max(200),
});

export type LoginInput = z.infer<typeof Login>;
export type ChangePasswordInput = z.infer<typeof ChangePassword>;
