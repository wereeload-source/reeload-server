import { z } from 'zod';

export const VerifyCode = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });
export const ReleaseCheckin = z.object({ reason: z.string().trim().min(5, 'Write a reason').max(300) });
export const CompleteCheckin = z
  .object({ selfie_upload_id: z.string().uuid(), location_upload_id: z.string().uuid() })
  .refine((o) => o.selfie_upload_id !== o.location_upload_id, 'Take two different photos');

export type VerifyCodeInput = z.infer<typeof VerifyCode>;
export type ReleaseCheckinInput = z.infer<typeof ReleaseCheckin>;
export type CompleteCheckinInput = z.infer<typeof CompleteCheckin>;
