import { describe, expect, it } from 'vitest';
import { CostTracker } from '../../evals/cost-tracker.js';

describe('CostTracker', () => {
  describe('priceOf', () => {
    it('computes Sonnet 4.x pricing: $3/M input, $15/M output', () => {
      const tracker = new CostTracker({ capUsd: 5 });
      // 1M input + 1M output should be $3 + $15 = $18
      expect(tracker.priceOf({ input: 1_000_000, output: 1_000_000 })).toBeCloseTo(18, 6);
    });

    it('handles small token counts without floating point drift', () => {
      const tracker = new CostTracker({ capUsd: 5 });
      // 1000 input + 500 output → 1000 * 3/1M + 500 * 15/1M = 0.003 + 0.0075 = 0.0105
      expect(tracker.priceOf({ input: 1000, output: 500 })).toBeCloseTo(0.0105, 8);
    });

    it('returns zero for zero usage', () => {
      const tracker = new CostTracker({ capUsd: 5 });
      expect(tracker.priceOf({ input: 0, output: 0 })).toBe(0);
    });

    it('honours custom pricing overrides', () => {
      const tracker = new CostTracker({
        capUsd: 5,
        pricePerMillionInput: 1,
        pricePerMillionOutput: 2,
      });
      expect(tracker.priceOf({ input: 1_000_000, output: 1_000_000 })).toBeCloseTo(3, 6);
    });
  });

  describe('record', () => {
    it('accumulates running total across calls', () => {
      const tracker = new CostTracker({ capUsd: 5 });
      const r1 = tracker.record({ input: 1000, output: 500 });
      const r2 = tracker.record({ input: 2000, output: 1000 });
      expect(r1.deltaUsd).toBeCloseTo(0.0105, 8);
      expect(r1.totalUsd).toBeCloseTo(0.0105, 8);
      expect(r2.deltaUsd).toBeCloseTo(0.021, 8);
      expect(r2.totalUsd).toBeCloseTo(0.0315, 8);
    });

    it('reports capExceeded once the running total crosses the cap', () => {
      const tracker = new CostTracker({ capUsd: 1 });
      // 100k input = $0.30, 50k output = $0.75 → $1.05 total
      const r = tracker.record({ input: 100_000, output: 50_000 });
      expect(r.totalUsd).toBeCloseTo(1.05, 6);
      expect(r.capExceeded).toBe(true);
    });

    it('does not report capExceeded when the total exactly equals the cap', () => {
      // 1M output @ $15/M, cap $15 → exactly equal, not exceeded
      const tracker = new CostTracker({ capUsd: 15 });
      const r = tracker.record({ input: 0, output: 1_000_000 });
      expect(r.totalUsd).toBe(15);
      expect(r.capExceeded).toBe(false);
    });

    it('keeps total tokens in step with the recording calls', () => {
      const tracker = new CostTracker({ capUsd: 5 });
      tracker.record({ input: 100, output: 50 });
      tracker.record({ input: 200, output: 75 });
      expect(tracker.totalTokens()).toEqual({ input: 300, output: 125 });
    });
  });

  describe('wouldExceedCap', () => {
    it('returns true when adding usage would push past the cap', () => {
      const tracker = new CostTracker({ capUsd: 1 });
      tracker.record({ input: 100_000, output: 0 }); // $0.30
      // Adding 50k output ($0.75) would push to $1.05
      expect(tracker.wouldExceedCap({ input: 0, output: 50_000 })).toBe(true);
    });

    it('returns false when there is headroom', () => {
      const tracker = new CostTracker({ capUsd: 1 });
      tracker.record({ input: 100_000, output: 0 }); // $0.30
      expect(tracker.wouldExceedCap({ input: 0, output: 10_000 })).toBe(false);
    });

    it('does not mutate the running total', () => {
      const tracker = new CostTracker({ capUsd: 1 });
      tracker.record({ input: 100_000, output: 0 });
      const before = tracker.totalUsd();
      tracker.wouldExceedCap({ input: 1_000_000, output: 1_000_000 });
      expect(tracker.totalUsd()).toBe(before);
    });
  });

  describe('totalUsd / capUsdValue', () => {
    it('reports zero before any recording', () => {
      const tracker = new CostTracker({ capUsd: 5 });
      expect(tracker.totalUsd()).toBe(0);
      expect(tracker.totalTokens()).toEqual({ input: 0, output: 0 });
    });

    it('exposes the configured cap unchanged', () => {
      const tracker = new CostTracker({ capUsd: 7.25 });
      expect(tracker.capUsdValue()).toBe(7.25);
    });
  });
});
