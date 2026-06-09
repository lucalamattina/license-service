/**
 * Eval runner. Invoked via `npm run eval` from the `mcp/` package.
 *
 * For each registered case, runs N samples (default 5), reports a pass rate,
 * and accumulates cost against a global cap. Pass rate, not pass/fail, is the
 * unit of measurement — see MCP_DESIGN.md section 10.
 *
 * Environment:
 *   ANTHROPIC_API_KEY        required
 *   LICENSE_SERVICE_BASE_URL backend to hit (default: the deployed Heroku URL)
 *   COST_CAP_USD             default 5.00
 *   SAMPLES_PER_CASE         default 5
 *
 * Model is pinned to a specific Sonnet version. Upgrading is a deliberate
 * code change, not an env knob, so eval drift is visible in a PR.
 */

import Anthropic from '@anthropic-ai/sdk';
import { runAgentLoop } from './agent-loop.js';
import { ALL_CASES } from './cases/index.js';
import { CostTracker } from './cost-tracker.js';
import type { CaseResult, EvalCase, SampleResult } from './types.js';

const MODEL = 'claude-sonnet-4-6';
const DEFAULT_BACKEND_URL = 'https://llamattina-license-service-5c6fae72379f.herokuapp.com';
const DEFAULT_COST_CAP_USD = 5.0;
const DEFAULT_SAMPLES = 5;
const DEFAULT_PASS_THRESHOLD = 0.8;

const CASES: EvalCase[] = ALL_CASES;

function log(msg: string): void {
  process.stdout.write(msg + '\n');
}

function envNumber(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`env ${name}=${raw} is not a number`);
  }
  return parsed;
}

interface SampleAssertion {
  passed: boolean;
  reason: string;
}

function assertSample(
  caseSpec: EvalCase,
  toolCalls: { name: string; input: unknown }[],
  finalText: string,
): SampleAssertion {
  // Tool calls: the expected sequence must appear AS A SUBSEQUENCE of the
  // actual calls — order preserved, gaps allowed. Allowing gaps means the
  // agent can insert exploratory calls (e.g. list_products mid-workflow to
  // human-name a product) without failing the assertion. Order still matters,
  // so an agent that revokes before discovering still fails.
  let cursor = 0;
  for (const expected of caseSpec.expectedToolCalls) {
    // Advance through actual until we find a name match (and arg match if requested).
    let matched = false;
    while (cursor < toolCalls.length) {
      const actual = toolCalls[cursor];
      cursor++;
      if (actual && actual.name === expected.name) {
        if (expected.argsMatch && !expected.argsMatch(actual.input)) {
          // Name matched but args didn't — keep looking. A later call with the
          // same name might match the predicate. This handles the case where the
          // agent makes a probe call before settling on the right args.
          continue;
        }
        matched = true;
        break;
      }
    }
    if (!matched) {
      const expectedNames = caseSpec.expectedToolCalls.map((c) => c.name).join(' → ');
      const actualNames = toolCalls.map((c) => c.name).join(' → ') || '(none)';
      return {
        passed: false,
        reason: `expected subsequence [${expectedNames}] not found in [${actualNames}]; first miss: ${expected.name}${expected.argsMatch ? ' (with matching args)' : ''}`,
      };
    }
  }

  if (caseSpec.forbiddenTools) {
    for (const name of caseSpec.forbiddenTools) {
      if (toolCalls.some((c) => c.name === name)) {
        return {
          passed: false,
          reason: `forbidden tool ${name} was called`,
        };
      }
    }
  }

  if (caseSpec.maxCallsByTool) {
    const counts = new Map<string, number>();
    for (const c of toolCalls) {
      counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
    }
    for (const [name, cap] of Object.entries(caseSpec.maxCallsByTool)) {
      const got = counts.get(name) ?? 0;
      if (got > cap) {
        return {
          passed: false,
          reason: `tool ${name} called ${got} times, cap is ${cap}`,
        };
      }
    }
  }

  if (caseSpec.finalMessage && !caseSpec.finalMessage.test(finalText)) {
    return {
      passed: false,
      reason: `final message did not match ${caseSpec.finalMessage}`,
    };
  }

  return { passed: true, reason: '' };
}

async function runCase(
  caseSpec: EvalCase,
  anthropic: Anthropic,
  backendUrl: string,
  samples: number,
  costTracker: CostTracker,
): Promise<CaseResult> {
  const threshold = caseSpec.passThreshold ?? DEFAULT_PASS_THRESHOLD;
  const results: SampleResult[] = [];
  let caseCost = 0;

  log(`\n  ${caseSpec.name}`);

  for (let i = 0; i < samples; i++) {
    if (costTracker.totalUsd() >= costTracker.capUsdValue()) {
      log(`    sample ${i + 1}/${samples} ... skipped (cost cap reached)`);
      results.push({
        passed: false,
        toolCallsActual: [],
        finalText: '',
        failureReason: 'cost cap reached before sample started',
        tokens: { input: 0, output: 0 },
        costUsd: 0,
      });
      continue;
    }

    let setupOk = true;
    try {
      await caseSpec.preState(backendUrl);
    } catch (err) {
      setupOk = false;
      results.push({
        passed: false,
        toolCallsActual: [],
        finalText: '',
        failureReason: `preState failed: ${err instanceof Error ? err.message : String(err)}`,
        tokens: { input: 0, output: 0 },
        costUsd: 0,
      });
      log(`    sample ${i + 1}/${samples} ... FAIL (preState)`);
    }

    if (setupOk) {
      try {
        const promptText = typeof caseSpec.prompt === 'function' ? caseSpec.prompt() : caseSpec.prompt;
        const loop = await runAgentLoop({
          anthropic,
          model: MODEL,
          backendBaseUrl: backendUrl,
          prompt: promptText,
          costTracker,
          // Production MCP clients (Claude Code, etc.) inject the current date
          // into the system prompt so the model's expires_at math agrees with
          // the backend's clock. Without this the agent's training-cutoff "now"
          // diverges from the backend's real "now" and every relative-date
          // prompt becomes expires_at_in_past.
          systemPrompt: `Today's date is ${new Date().toISOString().slice(0, 10)}.`,
        });
        const assertion = assertSample(caseSpec, loop.toolCalls, loop.finalText);
        const passed = assertion.passed;
        caseCost += loop.costUsd;
        results.push({
          passed,
          toolCallsActual: loop.toolCalls.map((tc) => tc.name),
          finalText: loop.finalText,
          failureReason: assertion.reason,
          tokens: { input: loop.inputTokens, output: loop.outputTokens },
          costUsd: loop.costUsd,
        });
        const verdict = passed ? 'pass' : `FAIL (${assertion.reason})`;
        log(
          `    sample ${i + 1}/${samples} ... ${verdict}` +
            `  [cost $${loop.costUsd.toFixed(4)}, ${loop.inputTokens + loop.outputTokens} tokens, stop=${loop.stoppedReason}]`,
        );
        // On failure, dump the agent's actual tool call sequence with args.
        // This is the only signal that lets you tell "agent panicked and
        // retried 7 times" apart from "agent did the right thing but my
        // assertion was too strict".
        if (!passed) {
          for (const [j, tc] of loop.toolCalls.entries()) {
            log(`      [${j + 1}] ${tc.name}(${JSON.stringify(tc.input)})`);
          }
          const tail = loop.finalText.length > 240 ? loop.finalText.slice(0, 240) + '…' : loop.finalText;
          log(`      final: ${tail.replace(/\n/g, ' ')}`);
        }
      } catch (err) {
        results.push({
          passed: false,
          toolCallsActual: [],
          finalText: '',
          failureReason: `agent loop threw: ${err instanceof Error ? err.message : String(err)}`,
          tokens: { input: 0, output: 0 },
          costUsd: 0,
        });
        log(`    sample ${i + 1}/${samples} ... FAIL (${err instanceof Error ? err.message : String(err)})`);
      }
    }

    // Cleanup is best-effort; failures during cleanup are logged but don't
    // affect the sample's verdict (the sample already either passed or failed).
    if (caseSpec.cleanup) {
      try {
        await caseSpec.cleanup(backendUrl);
      } catch (err) {
        log(`    sample ${i + 1}/${samples} cleanup warning: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const passRate = results.length > 0 ? passed / results.length : 0;
  const regressed = passRate < threshold;
  log(
    `    pass rate: ${passed}/${results.length} (${(passRate * 100).toFixed(0)}%)` +
      `  threshold: ${(threshold * 100).toFixed(0)}%${regressed ? '  REGRESSED' : ''}`,
  );

  return {
    name: caseSpec.name,
    samples: results,
    passRate,
    passThreshold: threshold,
    regressed,
    costUsd: caseCost,
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    process.stderr.write('fatal: ANTHROPIC_API_KEY is not set\n');
    process.exit(2);
  }

  const backendUrl = process.env.LICENSE_SERVICE_BASE_URL ?? DEFAULT_BACKEND_URL;
  const capUsd = envNumber('COST_CAP_USD', DEFAULT_COST_CAP_USD);
  const samples = envNumber('SAMPLES_PER_CASE', DEFAULT_SAMPLES);
  const caseFilter = process.env.CASE_FILTER?.toLowerCase();
  const filteredCases = caseFilter
    ? CASES.filter((c) => c.name.toLowerCase().includes(caseFilter))
    : CASES;

  log(`backend:        ${backendUrl}`);
  log(`model:          ${MODEL}`);
  log(`samples/case:   ${samples}`);
  log(`cost cap:       $${capUsd.toFixed(2)}`);
  log(`cases:          ${filteredCases.length}${caseFilter ? ` (filtered by "${caseFilter}", ${CASES.length - filteredCases.length} skipped)` : ''}`);

  const anthropic = new Anthropic({ apiKey });
  const costTracker = new CostTracker({ capUsd });

  const caseResults: CaseResult[] = [];
  for (const c of filteredCases) {
    const result = await runCase(c, anthropic, backendUrl, samples, costTracker);
    caseResults.push(result);
  }

  log('\n=== Summary ===');
  const totalCases = caseResults.length;
  const regressed = caseResults.filter((c) => c.regressed).length;
  const passingCases = totalCases - regressed;
  log(`${passingCases}/${totalCases} cases meeting threshold`);
  log(`total cost: $${costTracker.totalUsd().toFixed(4)} of $${capUsd.toFixed(2)} cap`);
  const totals = costTracker.totalTokens();
  log(`total tokens: ${totals.input} input + ${totals.output} output`);

  if (regressed > 0) {
    log('\nregressed cases (investigate, do not re-run for luck):');
    for (const c of caseResults.filter((c) => c.regressed)) {
      log(`  - ${c.name}: ${(c.passRate * 100).toFixed(0)}% (threshold ${(c.passThreshold * 100).toFixed(0)}%)`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
