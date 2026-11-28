import { z } from 'zod';

export const CreateShareLink = z.strictObject({ include_raw: z.boolean().optional() });
export type CreateShareLinkInput = z.infer<typeof CreateShareLink>;
