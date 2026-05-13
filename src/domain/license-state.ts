export type LicenseStatus = 'active' | 'expired' | 'revoked';

export function canRevoke(status: LicenseStatus): boolean {
  return status === 'active';
}

export function shouldExpire(
  status: LicenseStatus,
  expiresAt: Date,
  now: Date = new Date(),
): boolean {
  return status === 'active' && expiresAt.getTime() <= now.getTime();
}
