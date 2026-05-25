/**
 * Pure CORS allowlist helpers: env parsing + glob-pattern origin matcher.
 *
 * The matcher treats `*` as "one or more characters that are NOT a dot", so
 * `https://*.vercel.app` matches `foo.vercel.app` but NOT `foo.bar.vercel.app`.
 * That preserves the natural hostname-glob semantics and prevents an entry like
 * `https://*.vercel.app` from accidentally accepting `https://foo.vercel.app.evil.com`
 * (the trailing-anchor `$` in the regex also guards against that).
 */

const DEFAULT_ORIGINS = ['http://localhost:5173'];

/**
 * Parses a comma-separated env value into a trimmed origin list.
 * Falls back to the dev-localhost default when unset or empty.
 */
export function parseAllowlist(envValue: string | undefined): string[] {
  if (!envValue || envValue.trim().length === 0) {
    return [...DEFAULT_ORIGINS];
  }
  return envValue
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function globToRegex(glob: string): RegExp {
  // Escape every regex metacharacter except `*`, then expand `*` to "one or
  // more non-dot characters". Anchored to the full string with ^...$.
  const escaped = glob
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^.]+');
  return new RegExp(`^${escaped}$`);
}

type Matcher = string | RegExp;

/**
 * Builds an `isAllowed(origin)` predicate from a list of literal or
 * wildcard-glob origin patterns. Patterns without `*` are compared by exact
 * string equality; patterns with `*` are compiled to a regex.
 */
export function buildOriginMatcher(allowlist: string[]): (origin: string) => boolean {
  const matchers: Matcher[] = allowlist.map((pattern) =>
    pattern.includes('*') ? globToRegex(pattern) : pattern,
  );

  return (origin: string) => {
    for (const m of matchers) {
      if (typeof m === 'string') {
        if (m === origin) return true;
      } else if (m.test(origin)) {
        return true;
      }
    }
    return false;
  };
}
