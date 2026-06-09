/**
 * Runs one agent loop sample for an eval case.
 *
 * Bridges Anthropic's tools API to the MCP server: lists MCP tools, hands them
 * to the model as `tools`, dispatches every `tool_use` from the model back
 * through `client.callTool()`, sends results as `tool_result` content blocks,
 * loops until the model returns no further tool calls.
 *
 * The MCP server runs in-process and is connected via the SDK's
 * `InMemoryTransport`. The transport choice is invisible to the agent — what's
 * being tested is the MCP tool surface, not the stdio plumbing.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BackendClient } from '../src/backend-client.js';
import { createServer } from '../src/server.js';
import type { CostTracker } from './cost-tracker.js';

const MAX_TURNS = 10;
const MAX_TOKENS_PER_TURN = 4096;

export interface AgentLoopOptions {
  anthropic: Anthropic;
  model: string;
  backendBaseUrl: string;
  prompt: string;
  costTracker: CostTracker;
  systemPrompt?: string;
}

export interface AgentLoopResult {
  toolCalls: { name: string; input: unknown }[];
  finalText: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  stoppedReason: 'end_turn' | 'max_turns' | 'cost_cap' | 'other';
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const backend = new BackendClient({ baseUrl: opts.backendBaseUrl });
  const server = createServer({ backend });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client(
    { name: 'eval-runner', version: '0.1.0' },
    { capabilities: {} },
  );
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);

  // Mirror MCP tools into Anthropic's tool descriptor shape.
  const { tools: mcpTools } = await mcpClient.listTools();
  const anthropicTools = mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    input_schema: t.inputSchema as { type: 'object'; properties?: Record<string, unknown> },
  }));

  const messages: MessageParam[] = [{ role: 'user', content: opts.prompt }];
  const toolCalls: { name: string; input: unknown }[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let stoppedReason: AgentLoopResult['stoppedReason'] = 'other';

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await opts.anthropic.messages.create({
        model: opts.model,
        max_tokens: MAX_TOKENS_PER_TURN,
        temperature: 0,
        ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
        tools: anthropicTools,
        messages,
      });

      const usage = {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      };
      const recorded = opts.costTracker.record(usage);
      inputTokens += usage.input;
      outputTokens += usage.output;
      costUsd += recorded.deltaUsd;

      // Append the assistant turn to the conversation.
      messages.push({ role: 'assistant', content: response.content });

      const toolUseBlocks = response.content.filter(
        (b): b is ToolUseBlock => b.type === 'tool_use',
      );

      if (toolUseBlocks.length === 0 || response.stop_reason !== 'tool_use') {
        stoppedReason = response.stop_reason === 'end_turn' ? 'end_turn' : 'other';
        break;
      }

      if (recorded.capExceeded) {
        stoppedReason = 'cost_cap';
        break;
      }

      // Dispatch tools through the MCP client and stitch results back.
      const toolResults: ToolResultBlockParam[] = [];
      for (const tu of toolUseBlocks) {
        toolCalls.push({ name: tu.name, input: tu.input });
        const result = await mcpClient.callTool({
          name: tu.name,
          arguments: tu.input as Record<string, unknown>,
        });
        const firstContent = (result.content as { type: string; text?: string }[] | undefined)?.[0];
        const text = firstContent?.text ?? '';
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: text,
          is_error: Boolean(result.isError),
        });
      }
      messages.push({ role: 'user', content: toolResults });

      if (turn === MAX_TURNS - 1) {
        stoppedReason = 'max_turns';
      }
    }
  } finally {
    await mcpClient.close();
    await server.close();
  }

  const finalAssistant = messages
    .slice()
    .reverse()
    .find((m) => m.role === 'assistant');
  const finalText = finalAssistant
    ? extractText(finalAssistant.content)
    : '';

  return {
    toolCalls,
    finalText,
    inputTokens,
    outputTokens,
    costUsd,
    stoppedReason,
  };
}

function extractText(content: MessageParam['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is { type: 'text'; text: string } => (b as { type: string }).type === 'text')
    .map((b) => b.text)
    .join('\n');
}
