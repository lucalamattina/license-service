import { describe, expect, it } from 'vitest';
import { createUserBody } from '../../src/schemas/users.js';

describe('createUserBody schema', () => {
  it('accepts a lowercase email unchanged', () => {
    const result = createUserBody.parse({ email: 'alice@example.com' });
    expect(result.email).toBe('alice@example.com');
  });

  it('lowercases mixed-case input', () => {
    const result = createUserBody.parse({ email: 'Alice@Example.COM' });
    expect(result.email).toBe('alice@example.com');
  });

  it('trims surrounding whitespace', () => {
    const result = createUserBody.parse({ email: '  alice@example.com  ' });
    expect(result.email).toBe('alice@example.com');
  });

  it('trims and lowercases in one pass', () => {
    const result = createUserBody.parse({ email: '  Alice@Example.COM  ' });
    expect(result.email).toBe('alice@example.com');
  });

  it('rejects a malformed email', () => {
    expect(() => createUserBody.parse({ email: 'not-an-email' })).toThrow();
  });

  it('rejects a missing email', () => {
    expect(() => createUserBody.parse({})).toThrow();
  });

  it('rejects a non-string email', () => {
    expect(() => createUserBody.parse({ email: 42 })).toThrow();
  });
});
