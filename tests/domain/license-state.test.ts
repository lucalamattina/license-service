import { describe, expect, it } from 'vitest';
import { canRevoke, shouldExpire } from '../../src/domain/license-state.js';

describe('canRevoke', () => {
  it('allows revoking an Active license', () => {
    expect(canRevoke('active')).toBe(true);
  });

  it('refuses to revoke a Revoked license', () => {
    expect(canRevoke('revoked')).toBe(false);
  });

  it('refuses to revoke an Expired license', () => {
    expect(canRevoke('expired')).toBe(false);
  });
});

describe('shouldExpire', () => {
  const now = new Date('2026-05-13T12:00:00Z');
  const past = new Date('2026-05-13T11:59:59Z');
  const future = new Date('2026-05-13T12:00:01Z');

  it('expires an Active license whose expires_at is in the past', () => {
    expect(shouldExpire('active', past, now)).toBe(true);
  });

  it('expires an Active license whose expires_at equals now (boundary)', () => {
    expect(shouldExpire('active', now, now)).toBe(true);
  });

  it('does not expire an Active license whose expires_at is in the future', () => {
    expect(shouldExpire('active', future, now)).toBe(false);
  });

  it('never expires a Revoked license, regardless of expires_at', () => {
    expect(shouldExpire('revoked', past, now)).toBe(false);
    expect(shouldExpire('revoked', future, now)).toBe(false);
  });

  it('never expires an already-Expired license', () => {
    expect(shouldExpire('expired', past, now)).toBe(false);
    expect(shouldExpire('expired', future, now)).toBe(false);
  });
});
