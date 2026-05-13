import { describe, expect, it } from 'vitest';
import { wrapList } from '../../src/lib/response.js';

describe('wrapList', () => {
  it('wraps an empty array as { data: [] }', () => {
    expect(wrapList([])).toEqual({ data: [] });
  });

  it('wraps a populated array preserving order and identity', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const wrapped = wrapList(items);
    expect(wrapped).toEqual({ data: items });
    expect(wrapped.data[0]).toBe(items[0]);
  });

  it('is generic over item type', () => {
    const numbers = wrapList([1, 2, 3]);
    const strings = wrapList(['a', 'b']);
    expect(numbers).toEqual({ data: [1, 2, 3] });
    expect(strings).toEqual({ data: ['a', 'b'] });
  });
});
