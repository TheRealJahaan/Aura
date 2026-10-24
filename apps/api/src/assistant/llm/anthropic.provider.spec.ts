import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider, toAnthropicMessages } from './anthropic.provider';
import { LlmError } from './types';

function providerWith(create: jest.Mock, model = 'claude-opus-5-5') {
  const client = { beta: { messages: { create } }, models: { retrieve: jest.fn() } } as unknown as Anthropic;
  return new AnthropicProvider({ apiKey: 'test', model, client });
}

const request = {
  system: 'You are Aura.',
  messages: [{ role: 'user' as const, text: 'open mail' }],
  tools: [{ name: 'open_app', description: 'Open an app', inputSchema: { type: 'object', properties: {} } }],
};

describe('AnthropicProvider', () => {
  it('asks for low effort, caching and server-side fallbacks', async () => {
    const create = jest.fn().mockResolvedValue({
      stop_reason: 'tool_use',
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: 'Opening Gmail.' },
        { type: 'tool_use', id: 'toolu_1', name: 'open_app', input: { app: 'gmail' } },
      ],
    });
    const reply = await providerWith(create).chat(request);

    const params = create.mock.calls[0][0];
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: 'You are Aura.', cache_control: { type: 'ephemeral' } }],
      tools: [{ name: 'open_app', description: 'Open an app', input_schema: { type: 'object', properties: {} } }],
    });
    expect(params).not.toHaveProperty('thinking');
    expect(reply.text).toBe('Opening Gmail.');
    expect(reply.toolCalls).toEqual([{ id: 'toolu_1', name: 'open_app', input: { app: 'gmail' } }]);
    expect(reply.raw?.provider).toBe('anthropic');
  });

  it('leaves out fallbacks and effort for models without them', async () => {
    const create = jest.fn().mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi' }] });
    await providerWith(create, 'claude-haiku-4-5').chat(request);
    const params = create.mock.calls[0][0];
    expect(params).not.toHaveProperty('fallbacks');
    expect(params).not.toHaveProperty('betas');
    expect(params).not.toHaveProperty('output_config');
  });

  it('turns a refusal into a clear message', async () => {
    const create = jest.fn().mockResolvedValue({ stop_reason: 'refusal', content: [] });
    await expect(providerWith(create).chat(request)).rejects.toThrow(LlmError);
  });

  it('explains a bad API key', async () => {
    const create = jest.fn().mockRejectedValue(
      new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'invalid x-api-key', new Headers()),
    );
    await expect(providerWith(create).chat(request)).rejects.toThrow('Claude rejected the API key');
  });
});

describe('Claude message format', () => {
  it('replays Claude replies exactly and groups tool results with the next user message', () => {
    const raw = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: 'toolu_1', name: 'tasks_list', input: {} },
    ];
    expect(
      toAnthropicMessages([
        { role: 'user', text: 'tasks?' },
        { role: 'assistant', text: '', toolCalls: [{ id: 'toolu_1', name: 'tasks_list', input: {} }], raw: { provider: 'anthropic', content: raw } },
        { role: 'tool', toolCallId: 'toolu_1', name: 'tasks_list', content: 'cancelled', isError: true },
        { role: 'user', text: 'never mind, open mail' },
        { role: 'assistant', text: 'Opening Gmail.', toolCalls: [] },
      ]),
    ).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'tasks?' }] },
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'cancelled', is_error: true },
          { type: 'text', text: 'never mind, open mail' },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'Opening Gmail.' }] },
    ]);
  });

  it('builds tool_use blocks for history written by another provider', () => {
    const messages = toAnthropicMessages([
      { role: 'assistant', text: '', toolCalls: [{ id: 'fast_1', name: 'open_app', input: { app: 'gmail' } }] },
    ]);
    expect(messages).toEqual([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'fast_1', name: 'open_app', input: { app: 'gmail' } }] },
    ]);
  });
});
