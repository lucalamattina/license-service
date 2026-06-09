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
  /**
   * The natural-language task sent as the user message. If the prompt needs to
   * reference an id that is only known after `preState` runs (e.g. a freshly
   * seeded license UUID), pass a thunk that closes over module-level state set
   * by `preState`.
   */
  prompt: string | (() => string);
  /** Seed any backend state the case requires. Called once per sample, before the agent runs. */
  preState: (baseUrl: string) => Promise<void>;
  /** Tear down seeded state. Called once per sample, even if the sample failed. Best-effort. */
  cleanup?: (baseUrl: string) => Promise<void>;
  /** Tool calls the agent is expected to make, in order. Extra trailing calls are allowed. */
  expectedToolCalls: ExpectedToolCall[];
  /**
   * Tool names the agent must NOT call at all. Use for negative-space assertions
   * like "find_user_by_email returned null, the agent must not chain into list_user_licenses".
   */
  forbiddenTools?: string[];
  /**
   * Upper bound on call count per tool name. Anything not listed is uncapped.
   * Use to catch retry-loops on terminal errors (e.g. `revoke_license` after `license_not_active`)
   * or to assert "exactly one" actions (e.g. `revoke_license: 1` in the revoke-selected workflow).
   */
  maxCallsByTool?: Record<string, number>;
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
