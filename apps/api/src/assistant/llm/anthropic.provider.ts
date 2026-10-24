import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlockParam,
  MessageCreateParamsNonStreaming as BetaMessageCreateParamsNonStreaming,
  BetaMessageParam,
  BetaTool,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { LlmStatus } from '@aura/shared';
import { LlmError, LlmMessage, LlmProvider, LlmReply, LlmRequest, ToolCall } from './types';

// Optional: Claude instead of the free local AI. This uses your own Anthropic
// API key and is billed by Anthropic, so it is off unless LLM_PROVIDER=anthropic.

// Models that accept `fallbacks: "default"`: if a safety check declines a
// request, Anthropic re-runs it on a fallback model instead of refusing.
const SERVER_FALLBACK_MODELS = new Set([
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-fable-5-1',
  'claude-fable-5',
  'claude-sonnet-5-5',
]);

function supportsEffort(model: string): boolean {
  return /^claude-(opus|sonnet|fable|haiku)-5/.test(model);
}

export function toAnthropicMessages(messages: LlmMessage[]): BetaMessageParam[] {
  const result: BetaMessageParam[] = [];
  // Tool results go back in a user message, and the API wants each run of
  // user content in one message, so consecutive user parts are joined.
  const pushUser = (block: BetaContentBlockParam) => {
    const last = result[result.length - 1];
    if (last?.role === 'user' && Array.isArray(last.content)) {
      last.content.push(block);
    } else {
      result.push({ role: 'user', content: [block] });
    }
  };
  for (const message of messages) {
    if (message.role === 'user') {
      pushUser({ type: 'text', text: message.text });
    } else if (message.role === 'tool') {
      pushUser({ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content, is_error: message.isError });
    } else {
      // Claude's own replies are replayed exactly, including its thinking blocks.
      const content: BetaContentBlockParam[] =
        message.raw?.provider === 'anthropic'
          ? (message.raw.content as BetaContentBlockParam[])
          : [
              ...(message.text ? [{ type: 'text' as const, text: message.text }] : []),
              ...message.toolCalls.map((call) => ({
                type: 'tool_use' as const,
                id: call.id,
                name: call.name,
                input: call.input as Record<string, unknown>,
              })),
            ];
      if (content.length > 0) {
        result.push({ role: 'assistant', content });
      }
    }
  }
  return result;
}

function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'Claude rejected the API key. Check ANTHROPIC_API_KEY in apps/api/.env.';
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "This Anthropic API key can't use that model. Check ANTHROPIC_MODEL in apps/api/.env.";
  }
  if (err instanceof Anthropic.NotFoundError) {
    return 'Anthropic doesn\'t know that model name. Check ANTHROPIC_MODEL in apps/api/.env.';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Claude is limiting requests on this API key right now. Try again in a minute.';
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "I can't reach Claude. Check your internet connection.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Claude returned an error: ${err.message.slice(0, 200)}`;
  }
  return `Claude failed: ${(err as Error).message?.slice(0, 200) ?? 'unknown error'}`;
}

export class AnthropicProvider extends LlmProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private readonly client: Anthropic;

  constructor(options: { apiKey: string; model: string; client?: Anthropic }) {
    super();
    this.model = options.model;
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 2, timeout: 60_000 });
  }

  async chat(request: LlmRequest): Promise<LlmReply> {
    const params: BetaMessageCreateParamsNonStreaming = {
      model: this.model,
      // Leaves room for Claude's thinking as well as the short spoken reply.
      max_tokens: 16_000,
      // The system prompt and tools never change, so they are cached between turns.
      system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
      messages: toAnthropicMessages(request.messages),
      tools: request.tools.map(
        (tool): BetaTool => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as BetaTool.InputSchema,
        }),
      ),
    };
    if (supportsEffort(this.model)) {
      // Voice commands are short, so low effort keeps answers quick.
      params.output_config = { effort: 'low' };
    }
    if (SERVER_FALLBACK_MODELS.has(this.model)) {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }

    let response: Anthropic.Beta.Messages.BetaMessage;
    try {
      response = await this.client.beta.messages.create(params);
    } catch (err) {
      throw new LlmError(describeApiError(err));
    }
    if (response.stop_reason === 'refusal') {
      throw new LlmError("Claude declined to help with that request. Try asking another way.");
    }
    const text: string[] = [];
    const toolCalls: ToolCall[] = [];
    for (const block of response.content) {
      if (block.type === 'text') text.push(block.text);
      if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, input: block.input });
    }
    return { text: text.join('\n').trim(), toolCalls, raw: { provider: 'anthropic', content: response.content } };
  }

  async status(): Promise<LlmStatus> {
    const base = { provider: this.name, model: this.model } as const;
    try {
      // Looking up the model checks the key and the name without being billed.
      await this.client.models.retrieve(this.model, {}, { timeout: 5_000, maxRetries: 0 });
      return { ...base, status: 'ready' };
    } catch (err) {
      if (err instanceof Anthropic.APIConnectionError) {
        return { ...base, status: 'unreachable', detail: describeApiError(err) };
      }
      if (err instanceof Anthropic.NotFoundError) {
        return { ...base, status: 'model-missing', detail: describeApiError(err) };
      }
      return { ...base, status: 'error', detail: describeApiError(err) };
    }
  }
}
