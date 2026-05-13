import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/lib/errors.js';

describe('ApiError', () => {
  it('captures code, status, message, and details on direct construction', () => {
    const err = new ApiError('validation_error', 400, 'bad input', { field: 'email' });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiError');
    expect(err.code).toBe('validation_error');
    expect(err.status).toBe(400);
    expect(err.message).toBe('bad input');
    expect(err.details).toEqual({ field: 'email' });
  });

  it('omits details when not provided', () => {
    const err = new ApiError('not_found', 404, 'missing');
    expect(err.details).toBeUndefined();
  });

  describe('static factories', () => {
    it('validationError → 400', () => {
      const err = ApiError.validationError('bad', { x: 1 });
      expect(err.code).toBe('validation_error');
      expect(err.status).toBe(400);
      expect(err.details).toEqual({ x: 1 });
    });

    it('expiresAtInPast → 400', () => {
      const err = ApiError.expiresAtInPast('expires_at in past');
      expect(err.code).toBe('expires_at_in_past');
      expect(err.status).toBe(400);
    });

    it('notFound → 404', () => {
      const err = ApiError.notFound('no such thing');
      expect(err.code).toBe('not_found');
      expect(err.status).toBe(404);
    });

    it('duplicateEmail → 409', () => {
      const err = ApiError.duplicateEmail('email taken');
      expect(err.code).toBe('duplicate_email');
      expect(err.status).toBe(409);
    });

    it('duplicateActiveLicense → 409', () => {
      const err = ApiError.duplicateActiveLicense('already covered');
      expect(err.code).toBe('duplicate_active_license');
      expect(err.status).toBe(409);
    });

    it('licenseNotActive → 409', () => {
      const err = ApiError.licenseNotActive('already revoked');
      expect(err.code).toBe('license_not_active');
      expect(err.status).toBe(409);
    });

    it('internalError → 500', () => {
      const err = ApiError.internalError('boom');
      expect(err.code).toBe('internal_error');
      expect(err.status).toBe(500);
    });
  });
});
