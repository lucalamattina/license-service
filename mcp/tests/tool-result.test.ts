import { describe, expect, it } from 'vitest';
import { toolError, toolSuccess } from '../src/tool-result.js';

describe('toolSuccess', () => {
  it('wraps data in a single text content block with isError: false', () => {
    const result = toolSuccess({ user: { id: 'u1', email: 'a@x.com' } });
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    const first = result.content?.[0];
    expect(first?.type).toBe('text');
    expect(JSON.parse((first as { text: string }).text)).toEqual({
      user: { id: 'u1', email: 'a@x.com' },
    });
  });
});

describe('toolError', () => {
  it('emits a two-layer text block: NL sentence, blank line, structured JSON', () => {
    const result = toolError({
      naturalLanguage: 'The license is already terminal. Do not retry.',
      structured: { error: 'license_not_active' },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const text = (result.content?.[0] as { text: string }).text;
    const lines = text.split('\n');
    expect(lines[0]).toBe('The license is already terminal. Do not retry.');
    expect(lines[1]).toBe('');
    expect(JSON.parse(lines[2] ?? '')).toEqual({ error: 'license_not_active' });
  });

  it('preserves details in the structured layer when present', () => {
    const result = toolError({
      naturalLanguage: 'Validation failed.',
      structured: {
        error: 'validation_error',
        details: [{ path: ['email'], message: 'invalid' }],
      },
    });
    const text = (result.content?.[0] as { text: string }).text;
    const structured = JSON.parse(text.split('\n')[2] ?? '');
    expect(structured.details).toEqual([{ path: ['email'], message: 'invalid' }]);
  });
});
