import { z } from 'zod';

const password = z.string().min(8, 'Use at least 8 characters').max(200);

export const Login = z.strictObject({
  loginType: z.enum(['EMAIL_PASSWORD', 'PHONE_PASSWORD']),
  identifier: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
});

export const ChangePassword = z.strictObject({
  current_password: z.string().min(1).max(200),
  new_password: password,
});

/** Only WhatsApp codes for now; email links come with email sending. */
export const ForgotPassword = z.strictObject({
  channel: z.enum(['WHATSAPP']),
  identifier: z.string().trim().min(6).max(24),
});

export const VerifyResetOtp = z.strictObject({
  identifier: z.string().trim().min(6).max(24),
  otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const ResetPasswordInput = z
  .strictObject({
    newPassword: password,
    token: z.string().trim().regex(/^[0-9a-f]{64}$/).optional(),
    resetTicket: z.string().trim().min(20).max(2000).optional(),
  })
  .refine((o) => (o.token === undefined) !== (o.resetTicket === undefined), 'Send either token or resetTicket');

export const ValidateReset = z.object({
  token: z.string().trim().max(200).optional(),
  resetTicket: z.string().trim().max(2000).optional(),
});

export const SessionId = z.string().uuid();

export type LoginInput = z.infer<typeof Login>;
export type ChangePasswordInput = z.infer<typeof ChangePassword>;
export type ForgotPasswordInput = z.infer<typeof ForgotPassword>;
export type VerifyResetOtpInput = z.infer<typeof VerifyResetOtp>;
export type ResetPasswordBody = z.infer<typeof ResetPasswordInput>;
export type ValidateResetQuery = z.infer<typeof ValidateReset>;

/** Emails are compared lowercased; phones as digits with an optional leading +. */
export function normalizeIdentifier(kind: 'email' | 'phone', value: string): string {
  const v = value.trim();
  return kind === 'email' ? v.toLowerCase() : v.replace(/[\s()-]/g, '');
}
