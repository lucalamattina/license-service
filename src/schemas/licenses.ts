import { z } from 'zod';

export const createLicenseBody = z.object({
  expires_at: z.iso.datetime(),
  user_id: z.uuid(),
  product_id: z.uuid(),
});

export const licenseIdParams = z.object({
  id: z.uuid(),
});

export type CreateLicenseBody = z.infer<typeof createLicenseBody>;
export type LicenseIdParams = z.infer<typeof licenseIdParams>;
