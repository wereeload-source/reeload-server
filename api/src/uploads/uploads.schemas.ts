import { z } from 'zod';

const uuid = z.string().uuid();

export const CreateUpload = z.object({
  job_id: uuid,
  kind: z.enum(['raw', 'edited']),
  file_name: z.string().trim().min(1).max(255),
  size_bytes: z.number().int().positive().max(50 * 1024 ** 3),
  content_type: z.string().trim().max(120).default('application/octet-stream'),
  /** Operations uploading for a reelmaker who could not. */
  on_behalf_of: uuid.optional().nullable(),
});

export const SignPart = z.object({ part_number: z.number().int().min(1).max(10_000) });

export const CompleteUpload = z.object({
  parts: z.array(z.object({ PartNumber: z.number().int().min(1).max(10_000), ETag: z.string().min(1).max(200) })).max(10_000).default([]),
});

export const ProofPhoto = z.object({
  job_id: uuid,
  which: z.enum(['selfie', 'location']),
  size_bytes: z.number().int().min(0).max(25 * 1024 ** 2).optional(),
});

export type CreateUploadInput = z.infer<typeof CreateUpload>;
export type SignPartInput = z.infer<typeof SignPart>;
export type CompleteUploadInput = z.infer<typeof CompleteUpload>;
export type ProofPhotoInput = z.infer<typeof ProofPhoto>;
