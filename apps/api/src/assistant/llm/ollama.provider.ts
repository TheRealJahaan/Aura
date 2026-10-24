import { randomUUID } from 'node:crypto';
import type { LlmStatus } from '@aura/shared';
import { LlmError, LlmMessage, LlmProvider, LlmReply, LlmRequest, ToolCall } from './types';

// Ollama runs open AI models on your own Mac for free. Aura talks to it over
// its local HTTP API: https://github.com/ollama/ollama/blob/main/docs/api.md

interface OllamaToolCall {
  function?: { name?: string; arguments?: unknown };
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

interface OllamaChatResponse {
  message?: { content?: string; tool_calls?: OllamaToolCall[] };
  error?: string;
}

interface OllamaShowResponse {
  capabilities?: string[];
}

export interface OllamaOptions {
  url: string;
  model: string;
  numCtx: number;
  /** How long one answer may take. The first answer is slow while the model loads. */
  timeoutMs?: number;
}

const THINK_BLOCK = /<think>[\s\S]*?(<\/think>|$)/gi;
// Some models write tool calls as text instead of using the tool-call field.
const TEXT_TOOL_CALL = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;

export function toOllamaMessages(system: string, messages: LlmMessage[]): OllamaMessage[] {
  const result: OllamaMessage[] = [{ role: 'system', content: system }];
  for (const message of messages) {
    if (message.role === 'user') {
      result.push({ role: 'user', content: message.text });
    } else if (message.role === 'assistant') {
      result.push({
        role: 'assistant',
        content: message.text,
        ...(message.toolCalls.length > 0
          ? { tool_calls: message.toolCalls.map((call) => ({ function: { name: call.name, arguments: call.input } })) }
          : {}),
      });
    } else {
      result.push({ role: 'tool', content: message.content, tool_name: message.name });
    }
  }
  return result;
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/** Reads tool calls from the reply, including ones the model wrote as `<tool_call>{...}</tool_call>` text. */
export function readReply(response: OllamaChatResponse): LlmReply {
  let text = (response.message?.content ?? '').replace(THINK_BLOCK, '');
  const toolCalls: ToolCall[] = [];
  for (const call of response.message?.tool_calls ?? []) {
    if (call.function?.name) {
      toolCalls.push({ id: randomUUID(), name: call.function.name, input: parseArguments(call.function.arguments) });
    }
  }
  if (toolCalls.length === 0) {
    text = text.replace(TEXT_TOOL_CALL, (whole, json: string) => {
      try {
        const parsed = JSON.parse(json) as { name?: unknown; arguments?: unknown };
        if (typeof parsed.name === 'string') {
          toolCalls.push({ id: randomUUID(), name: parsed.name, input: parseArguments(parsed.arguments) });
          return '';
        }
      } catch {
        // Not a tool call after all; keep the text.
      }
      return whole;
    });
  }
  return { text: text.trim(), toolCalls };
}

export class OllamaProvider extends LlmProvider {
  readonly name = 'ollama' as const;
  readonly model: string;
  private readonly url: string;
  private readonly numCtx: number;
  private readonly timeoutMs: number;
  private capabilities: string[] | null = null;

  constructor(options: OllamaOptions) {
    super();
    this.url = options.url.replace(/\/+$/, '');
    this.model = options.model;
    this.numCtx = options.numCtx;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  private async post<T>(path: string, body: unknown, timeoutMs: number): Promise<{ status: number; data: T }> {
    let res: Response;
    try {
      res = await fetch(`${this.url}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if ((err as Error).name === 'TimeoutError') {
        throw new LlmError('The local AI took too long to answer. Try again, or use a smaller model (see docs/SETUP.md).');
      }
      throw new LlmError("I can't reach Ollama, the free local AI. Open the Ollama app on your Mac and try again.");
    }
    const data = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, data };
  }

  private async loadCapabilities(): Promise<string[]> {
    if (this.capabilities) return this.capabilities;
    const { status, data } = await this.post<OllamaShowResponse & { error?: string }>(
      '/api/show',
      { model: this.model },
      5_000,
    );
    if (status === 404 || /not found/i.test(data.error ?? '')) {
      throw new LlmError(`The AI model ${this.model} isn't downloaded yet. In Terminal, run: ollama pull ${this.model}`);
    }
    if (status !== 200) {
      throw new LlmError(`Ollama returned an error: ${data.error ?? `HTTP ${status}`}`);
    }
    this.capabilities = data.capabilities ?? [];
    return this.capabilities;
  }

  async chat(request: LlmRequest): Promise<LlmReply> {
    const capabilities = await this.loadCapabilities();
    const body: Record<string, unknown> = {
      model: this.model,
      messages: toOllamaMessages(request.system, request.messages),
      tools: request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
      })),
      stream: false,
      keep_alive: '30m',
      options: { num_ctx: this.numCtx, temperature: 0.2 },
    };
    // Thinking makes answers slower without helping short voice commands.
    if (capabilities.includes('thinking')) {
      body.think = false;
    }
    const { status, data } = await this.post<OllamaChatResponse>('/api/chat', body, this.timeoutMs);
    if (status === 404) {
      this.capabilities = null;
      throw new LlmError(`The AI model ${this.model} isn't downloaded yet. In Terminal, run: ollama pull ${this.model}`);
    }
    if (status === 400 && /does not support tools/i.test(data.error ?? '')) {
      throw new LlmError(`The model ${this.model} can't use tools. Set OLLAMA_MODEL to qwen3:8b in apps/api/.env.`);
    }
    if (status !== 200) {
      throw new LlmError(`Ollama returned an error: ${data.error ?? `HTTP ${status}`}`);
    }
    return readReply(data);
  }

  async status(): Promise<LlmStatus> {
    const base = { provider: this.name, model: this.model } as const;
    this.capabilities = null;
    try {
      const capabilities = await this.loadCapabilities();
      if (!capabilities.includes('tools')) {
        return { ...base, status: 'no-tool-support', detail: `${this.model} can't use tools. Try qwen3:8b.` };
      }
      return { ...base, status: 'ready' };
    } catch (err) {
      const message = (err as Error).message;
      if (/isn't downloaded/.test(message)) return { ...base, status: 'model-missing', detail: message };
      if (/can't reach Ollama|too long/.test(message)) return { ...base, status: 'unreachable', detail: message };
      return { ...base, status: 'error', detail: message };
    }
  }
}
