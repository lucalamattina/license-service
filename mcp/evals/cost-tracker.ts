/**
 * Token-and-dollar accounting for an eval run.
 *
 * Pricing is hardcoded to Anthropic's Sonnet 4.x tier ($3 per million input,
 * $15 per million output) as of the model pin in `runner.ts`. If the pin
 * changes to a different tier, update `pricePerMillionInput` /
 * `pricePerMillionOutput` here.
 *
 * Cache pricing is intentionally not modelled: the eval suite doesn't use
 * prompt caching, so cache_read_input_tokens and cache_creation_input_tokens
 * should both be zero. If a future case does enable caching, extend `record`.
 */

export interface CostTrackerOptions {
  /** Hard cap in USD. `record` returns the cap-exceeded flag once the running total crosses this. */
  capUsd: number;
  /** $/M input tokens. Defaults to Sonnet 4.x pricing. */
  pricePerMillionInput?: number;
  /** $/M output tokens. Defaults to Sonnet 4.x pricing. */
  pricePerMillionOutput?: number;
}

export interface TokenUsage {
  input: number;
  output: number;
}

export interface RecordResult {
  /** Dollar cost of *this* recording. */
  deltaUsd: number;
  /** Running total dollar cost so far. */
  totalUsd: number;
  /** True iff the running total has crossed `capUsd`. */
  capExceeded: boolean;
}

const DEFAULT_PRICE_PER_M_INPUT = 3.0;
const DEFAULT_PRICE_PER_M_OUTPUT = 15.0;

export class CostTracker {
  private readonly capUsd: number;
  private readonly pricePerMillionInput: number;
  private readonly pricePerMillionOutput: number;
  private runningTotalUsd = 0;
  private runningInputTokens = 0;
  private runningOutputTokens = 0;

  constructor(opts: CostTrackerOptions) {
    this.capUsd = opts.capUsd;
    this.pricePerMillionInput = opts.pricePerMillionInput ?? DEFAULT_PRICE_PER_M_INPUT;
    this.pricePerMillionOutput = opts.pricePerMillionOutput ?? DEFAULT_PRICE_PER_M_OUTPUT;
  }

  /** Cost of a hypothetical usage record, without recording it. */
  priceOf(usage: TokenUsage): number {
    const inputCost = (usage.input / 1_000_000) * this.pricePerMillionInput;
    const outputCost = (usage.output / 1_000_000) * this.pricePerMillionOutput;
    return inputCost + outputCost;
  }

  /** Record token usage. Returns delta + running total + cap-exceeded flag. */
  record(usage: TokenUsage): RecordResult {
    const deltaUsd = this.priceOf(usage);
    this.runningTotalUsd += deltaUsd;
    this.runningInputTokens += usage.input;
    this.runningOutputTokens += usage.output;
    return {
      deltaUsd,
      totalUsd: this.runningTotalUsd,
      capExceeded: this.runningTotalUsd > this.capUsd,
    };
  }

  /** Read the current running total without modifying it. */
  totalUsd(): number {
    return this.runningTotalUsd;
  }

  totalTokens(): TokenUsage {
    return { input: this.runningInputTokens, output: this.runningOutputTokens };
  }

  /** Would adding `usage` push us past the cap? Useful as a pre-flight gate. */
  wouldExceedCap(usage: TokenUsage): boolean {
    return this.runningTotalUsd + this.priceOf(usage) > this.capUsd;
  }

  capUsdValue(): number {
    return this.capUsd;
  }
}
