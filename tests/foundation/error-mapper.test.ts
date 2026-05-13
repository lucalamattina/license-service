import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError } from '../../src/lib/errors.js';
import { mapErrorToResponse } from '../../src/lib/error-mapper.js';

describe('mapErrorToResponse', () => {
  describe('ApiError', () => {
    it('maps an ApiError to its declared status and code', () => {
      const err = ApiError.duplicateActiveLicense('already covered');
      const mapped = mapErrorToResponse(err);
      expect(mapped.status).toBe(409);
      expect(mapped.body).toEqual({
        error: 'duplicate_active_license',
        message: 'already covered',
      });
    });

    it('includes details when present', () => {
      const err = ApiError.validationError('bad input', [{ path: ['email'], message: 'invalid' }]);
      const mapped = mapErrorToResponse(err);
      expect(mapped.body.details).toEqual([{ path: ['email'], message: 'invalid' }]);
    });

    it('omits details when not provided', () => {
      const err = ApiError.notFound('missing');
      const mapped = mapErrorToResponse(err);
      expect(mapped.body).not.toHaveProperty('details');
    });
  });

  describe('ZodError', () => {
    it('maps a ZodError to 400 validation_error with field-level details', () => {
      const schema = z.object({ email: z.email(), age: z.number().min(18) });
      const parsed = schema.safeParse({ email: 'not-an-email', age: 12 });
      expect(parsed.success).toBe(false);
      if (parsed.success) return;

      const mapped = mapErrorToResponse(parsed.error);
      expect(mapped.status).toBe(400);
      expect(mapped.body.error).toBe('validation_error');
      expect(mapped.body.message).toBe('Request validation failed');

      const details = mapped.body.details as Array<{ path: unknown[]; message: string; code: string }>;
      expect(Array.isArray(details)).toBe(true);
      expect(details).toHaveLength(2);

      const emailIssue = details.find((d) => d.path[0] === 'email');
      const ageIssue = details.find((d) => d.path[0] === 'age');
      expect(emailIssue).toBeDefined();
      expect(ageIssue).toBeDefined();
      expect(emailIssue!.code).toBeTruthy();
      expect(ageIssue!.code).toBeTruthy();
    });
  });

  describe('unknown errors', () => {
    it('maps a plain Error to 500 internal_error with a generic message', () => {
      const err = new Error('database connection lost — secret password 12345');
      const mapped = mapErrorToResponse(err);
      expect(mapped.status).toBe(500);
      expect(mapped.body).toEqual({
        error: 'internal_error',
        message: 'An unexpected error occurred',
      });
      expect(mapped.body.message).not.toContain('secret password');
    });

    it('maps a non-Error throw to 500 internal_error', () => {
      const mapped = mapErrorToResponse('a raw string was thrown');
      expect(mapped.status).toBe(500);
      expect(mapped.body.error).toBe('internal_error');
    });

    it('maps undefined/null to 500 internal_error', () => {
      expect(mapErrorToResponse(null).status).toBe(500);
      expect(mapErrorToResponse(undefined).status).toBe(500);
    });
  });
});
