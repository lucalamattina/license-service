import { describe, expect, it } from 'vitest';
import { buildOriginMatcher, parseAllowlist } from '../../src/lib/cors-allowlist.js';

describe('parseAllowlist', () => {
  it('returns the dev-localhost default when env is undefined', () => {
    expect(parseAllowlist(undefined)).toEqual(['http://localhost:5173']);
  });

  it('returns the default when env is empty string', () => {
    expect(parseAllowlist('')).toEqual(['http://localhost:5173']);
  });

  it('returns the default when env is whitespace only', () => {
    expect(parseAllowlist('   ')).toEqual(['http://localhost:5173']);
  });

  it('splits comma-separated entries and trims surrounding whitespace', () => {
    expect(parseAllowlist('http://a.com, http://b.com ,http://c.com')).toEqual([
      'http://a.com',
      'http://b.com',
      'http://c.com',
    ]);
  });

  it('drops empty entries produced by trailing or doubled commas', () => {
    expect(parseAllowlist('http://a.com,,http://b.com,')).toEqual([
      'http://a.com',
      'http://b.com',
    ]);
  });
});

describe('buildOriginMatcher', () => {
  describe('literal entries', () => {
    it('accepts an exact literal match', () => {
      const isAllowed = buildOriginMatcher(['http://localhost:5173']);
      expect(isAllowed('http://localhost:5173')).toBe(true);
    });

    it('rejects close-but-not-equal literals (different port)', () => {
      const isAllowed = buildOriginMatcher(['http://localhost:5173']);
      expect(isAllowed('http://localhost:5174')).toBe(false);
    });

    it('rejects unrelated origins', () => {
      const isAllowed = buildOriginMatcher(['http://localhost:5173']);
      expect(isAllowed('http://evil.example.com')).toBe(false);
    });
  });

  describe('wildcard entries', () => {
    it('matches a single subdomain label via leading wildcard', () => {
      const isAllowed = buildOriginMatcher(['https://*.vercel.app']);
      expect(isAllowed('https://license-service-dashboard.vercel.app')).toBe(true);
      expect(isAllowed('https://anything.vercel.app')).toBe(true);
    });

    it('does NOT match across dots (preserves single-label semantics)', () => {
      const isAllowed = buildOriginMatcher(['https://*.vercel.app']);
      expect(isAllowed('https://foo.bar.vercel.app')).toBe(false);
    });

    it('does NOT match suffix-impersonation attempts', () => {
      const isAllowed = buildOriginMatcher(['https://*.vercel.app']);
      // Trailing-anchor `$` in the compiled regex prevents this.
      expect(isAllowed('https://foo.vercel.app.evil.com')).toBe(false);
    });

    it('matches mid-subdomain wildcards (Vercel preview pattern)', () => {
      const isAllowed = buildOriginMatcher([
        'https://license-service-dashboard-*.vercel.app',
      ]);
      expect(isAllowed('https://license-service-dashboard-abc123.vercel.app')).toBe(true);
      expect(isAllowed('https://license-service-dashboard-feature-branch.vercel.app')).toBe(
        true,
      );
    });

    it('mid-subdomain wildcard rejects the bare-subdomain variant', () => {
      const isAllowed = buildOriginMatcher([
        'https://license-service-dashboard-*.vercel.app',
      ]);
      expect(isAllowed('https://license-service-dashboard.vercel.app')).toBe(false);
    });

    it('mid-subdomain wildcard rejects unrelated projects', () => {
      const isAllowed = buildOriginMatcher([
        'https://license-service-dashboard-*.vercel.app',
      ]);
      expect(isAllowed('https://other-project-abc123.vercel.app')).toBe(false);
    });
  });

  describe('mixed allowlist', () => {
    it('accepts an origin matched by any pattern', () => {
      const isAllowed = buildOriginMatcher([
        'http://localhost:5173',
        'https://license-service-dashboard.vercel.app',
        'https://license-service-dashboard-*.vercel.app',
      ]);
      expect(isAllowed('http://localhost:5173')).toBe(true);
      expect(isAllowed('https://license-service-dashboard.vercel.app')).toBe(true);
      expect(isAllowed('https://license-service-dashboard-deadbeef.vercel.app')).toBe(true);
    });

    it('rejects when no pattern matches', () => {
      const isAllowed = buildOriginMatcher([
        'http://localhost:5173',
        'https://*.vercel.app',
      ]);
      expect(isAllowed('https://malicious-clone.netlify.app')).toBe(false);
    });
  });
});
