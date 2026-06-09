/**
 * Eval case shape and shared types.
 *
 * The principles enforced here come from MCP_DESIGN.md section 10:
 *   - Strict on tool calls (expected sequence asserted in order, args via predicate).
 *   - Soft on prose (`finalMessage` is a substring/regex, not full text).
 *   - Pass rate per case (N samples), not pass/fail with retries.
 *
 * A case declares its own `passThreshold` (default 0.8). The runner records
 * pass rate against that threshold; below-threshold cases are regressions
 * to investigate, not to re-run for luck.
 */

export interface ExpectedToolCall {
  /** Tool name the agent is expected to call at this position. */
  name: string;
  /** Optional structural assertion on the arguments. Use when arg values matter. */
  argsMatch?: (args: unknown) => boolean;
}

export interface EvalCase {
  /** Short human-readable name shown in the runner output. */
  name: string;
  /** The natural-language task sent as the user message. */
  prompt: string;
  /** Seed any backend state the case requires. Called once per sample, before the agent runs. */
  preState: (baseUrl: string) => Promise<void>;
  /** Tear down seeded state. Called once per sample, even if the sample failed. Best-effort. */
  cleanup?: (baseUrl: string) => Promise<void>;
  /** Tool calls the agent is expected to make, in order. Extra trailing calls are allowed. */
  expectedToolCalls: ExpectedToolCall[];
  /** Optional substring/regex check on the agent's final text response. */
  finalMessage?: RegExp;
  /** Pass-rate threshold below which the case is considered regressed. Defaults to 0.8. */
  passThreshold?: number;
}

/** What one sample produces. The runner aggregates these across N samples per case. */
export interface SampleResult {
  passed: boolean;
  /** Names of tool calls the agent actually made, in order. */
  toolCallsActual: string[];
  /** The agent's final text response. */
  finalText: string;
  /** Why the sample failed, if it did. Empty string on pass. */
  failureReason: string;
  /** Token usage for this sample, summed across all messages.create calls. */
  tokens: {
    input: number;
    output: number;
  };
  /** Dollar cost of this sample. */
  costUsd: number;
}

export interface CaseResult {
  name: string;
  samples: SampleResult[];
  passRate: number;
  passThreshold: number;
  regressed: boolean;
  costUsd: number;
}
