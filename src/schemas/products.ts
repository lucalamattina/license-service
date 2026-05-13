import { z } from 'zod';

export const createProductBody = z.object({
  name: z.string().min(1),
});

export const productIdParams = z.object({
  id: z.uuid(),
});

export type CreateProductBody = z.infer<typeof createProductBody>;
export type ProductIdParams = z.infer<typeof productIdParams>;
