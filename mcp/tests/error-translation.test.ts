import { describe, expect, it } from 'vitest';
import type { BackendError } from '../src/backend-client.js';
import { translateBackendError } from '../src/error-translation.js';

function backendErr(error: string, status = 400, details?: unknown): BackendError {
  return {
    kind: 'backend_error',
    status,
    body: { error, message: 'backend message ignored by the translator', details },
  };
}

describe('translateBackendError', () => {
  describe('validation_error (400)', () => {
    it('preserves the details payload from Zod and writes the agent a recovery hint', () => {
      const result = translateBackendError(
        backendErr('validation_error', 400, [{ path: ['email'], message: 'invalid' }]),
      );
      expect(result.naturalLanguage).toMatch(/didn't pass.*validation/i);
      expect(result.naturalLanguage).toMatch(/correct them and retry/i);
      expect(result.structured.error).toBe('validation_error');
      expect(result.structured.details).toEqual([{ path: ['email'], message: 'invalid' }]);
    });
  });

  describe('expires_at_in_past (400)', () => {
    it('tells the agent to diagnose then act, not blindly retry', () => {
      const result = translateBackendError(backendErr('expires_at_in_past', 400));
      expect(result.naturalLanguage).toMatch(/re-read the human's request/i);
      expect(result.naturalLanguage).toMatch(/ask them to clarify/i);
      expect(result.structured.error).toBe('expires_at_in_past');
    });
  });

  describe('not_found (404) — three variants', () => {
    it('rewrites for a missing license (default variant)', () => {
      const result = translateBackendError(backendErr('not_found', 404));
      expect(result.naturalLanguage).toMatch(/no license exists/i);
      expect(result.naturalLanguage).toMatch(/list_user_licenses/);
      expect(result.structured.error).toBe('not_found');
    });

    it('rewrites for a missing user', () => {
      const result = translateBackendError(backendErr('not_found', 404), {
        notFoundVariant: 'user',
      });
      expect(result.naturalLanguage).toMatch(/no user exists/i);
      expect(result.naturalLanguage).toMatch(/find_user_by_email/);
    });

    it('rewrites for a missing user-or-product (issue_license FK violation)', () => {
      const result = translateBackendError(backendErr('not_found', 404), {
        notFoundVariant: 'user-or-product',
      });
      expect(result.naturalLanguage).toMatch(/either the user_id or product_id/i);
      expect(result.naturalLanguage).toMatch(/list_products/);
    });
  });

  describe('duplicate_active_license (409)', () => {
    it('preserves the existing_expires_at in details and tells the agent how to recover', () => {
      const result = translateBackendError(
        backendErr('duplicate_active_license', 409, {
          existing_expires_at: '2026-12-31T23:59:59Z',
        }),
      );
      expect(result.naturalLanguage).toMatch(/already has an Active license/i);
      expect(result.naturalLanguage).toMatch(/compute a later expires_at/i);
      expect(result.structured.error).toBe('duplicate_active_license');
      expect(result.structured.details).toEqual({ existing_expires_at: '2026-12-31T23:59:59Z' });
    });
  });

  describe('license_not_active (409)', () => {
    it('tells the agent not to retry and surfaces "goal state already reached"', () => {
      const result = translateBackendError(backendErr('license_not_active', 409));
      expect(result.naturalLanguage).toMatch(/already Revoked or Expired/i);
      expect(result.naturalLanguage).toMatch(/do not retry/i);
      expect(result.structured.error).toBe('license_not_active');
    });
  });

  describe('internal_error (500)', () => {
    it('clearly says no retry happened and points to the details for any reference id', () => {
      const result = translateBackendError(
        backendErr('internal_error', 500, { reference_id: 'r-123' }),
      );
      expect(result.naturalLanguage).toMatch(/no retry happened/i);
      expect(result.naturalLanguage).toMatch(/reference id from the details/i);
      expect(result.structured.error).toBe('internal_error');
      expect(result.structured.details).toEqual({ reference_id: 'r-123' });
    });
  });

  describe('backend_unreachable (network)', () => {
    it('produces the MCP-layer-only code with the network reason in the payload', () => {
      const result = translateBackendError({
        kind: 'network_error',
        reason: 'ECONNREFUSED',
      });
      expect(result.naturalLanguage).toMatch(/could not reach the license-service backend/i);
      expect(result.naturalLanguage).toMatch(/heroku eco dynos/i);
      expect(result.structured.error).toBe('backend_unreachable');
      expect(result.structured.details).toEqual({ reason: 'ECONNREFUSED' });
    });
  });

  describe('unmapped error code', () => {
    it('surfaces unknown backend codes as internal_error and preserves the original code', () => {
      const result = translateBackendError(
        backendErr('some_future_code_we_havent_seen', 418),
      );
      expect(result.naturalLanguage).toMatch(/error code .* does not have a translation/i);
      expect(result.structured.error).toBe('internal_error');
      expect(result.structured.details).toMatchObject({
        unmappedBackendCode: 'some_future_code_we_havent_seen',
      });
    });
  });
});
