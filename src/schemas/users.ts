import { z } from 'zod';

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

export const createUserBody = z.object({
  email: emailSchema,
});

export const userIdParams = z.object({
  id: z.uuid(),
});

export const userByEmailQuery = z.object({
  email: emailSchema,
});

export type CreateUserBody = z.infer<typeof createUserBody>;
export type UserIdParams = z.infer<typeof userIdParams>;
export type UserByEmailQuery = z.infer<typeof userByEmailQuery>;
