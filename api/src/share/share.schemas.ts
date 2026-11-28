import { z } from 'zod';

export const CreateShareLink = z.object({ include_raw: z.boolean().optional() });
export type CreateShareLinkInput = z.infer<typeof CreateShareLink>;
