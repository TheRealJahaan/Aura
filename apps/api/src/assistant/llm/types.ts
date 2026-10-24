import type { LlmStatus } from '@aura/shared';
import type { ToolDefinition } from '../tools/registry';

// One neutral message format for every AI provider. Conversations are saved
// in this format, so a provider can be swapped without losing history.

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export type LlmMessage =
  | { role: 'user'; text: string }
  | {
      role: 'assistant';
      text: string;
      toolCalls: ToolCall[];
      /** The provider's own reply, replayed as-is when the same provider reads the history. */
      raw?: { provider: string; content: unknown };
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError: boolean };

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools: ToolDefinition[];
}

export interface LlmReply {
  text: string;
  toolCalls: ToolCall[];
  raw?: { provider: string; content: unknown };
}

/** A problem with the AI itself. The message is safe to say to the user. */
export class LlmError extends Error {}

export abstract class LlmProvider {
  abstract readonly name: 'ollama' | 'anthropic';
  abstract readonly model: string;
  abstract chat(request: LlmRequest): Promise<LlmReply>;
  abstract status(): Promise<LlmStatus>;
}
