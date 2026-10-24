import { createServer, IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OllamaProvider, readReply, toOllamaMessages } from './ollama.provider';
import { LlmError } from './types';

// A tiny stand-in for the Ollama app, so the real HTTP code is tested.
function fakeOllama(handler: (path: string, body: Record<string, unknown>) => { status: number; body: unknown }) {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const server: Server = createServer(async (req: IncomingMessage, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}') as Record<string, unknown>;
    requests.push({ path: req.url ?? '', body });
    const reply = handler(req.url ?? '', body);
    res.writeHead(reply.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });
  return new Promise<{ url: string; requests: typeof requests; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

const request = {
  system: 'You are Aura.',
  messages: [{ role: 'user' as const, text: 'open mail' }],
  tools: [{ name: 'open_app', description: 'Open an app', inputSchema: { type: 'object', properties: {} } }],
};

describe('OllamaProvider', () => {
  it('sends tools and reads tool calls', async () => {
    const ollama = await fakeOllama((path) =>
      path === '/api/show'
        ? { status: 200, body: { capabilities: ['completion', 'tools', 'thinking'] } }
        : {
            status: 200,
            body: { message: { content: '<think>hmm</think>', tool_calls: [{ function: { name: 'open_app', arguments: { app: 'gmail' } } }] } },
          },
    );
    try {
      const provider = new OllamaProvider({ url: `${ollama.url}/`, model: 'qwen3:8b', numCtx: 8192 });
      const reply = await provider.chat(request);
      expect(reply.text).toBe('');
      expect(reply.toolCalls).toEqual([{ id: expect.any(String), name: 'open_app', input: { app: 'gmail' } }]);

      const chat = ollama.requests.find((r) => r.path === '/api/chat')?.body;
      expect(chat).toMatchObject({
        model: 'qwen3:8b',
        stream: false,
        think: false,
        options: { num_ctx: 8192 },
        tools: [{ type: 'function', function: { name: 'open_app', parameters: { type: 'object', properties: {} } } }],
      });
      expect((chat?.messages as unknown[])[0]).toEqual({ role: 'system', content: 'You are Aura.' });
    } finally {
      await ollama.close();
    }
  });

  it("doesn't send think to models that can't think", async () => {
    const ollama = await fakeOllama((path) =>
      path === '/api/show'
        ? { status: 200, body: { capabilities: ['completion', 'tools'] } }
        : { status: 200, body: { message: { content: 'Hi!' } } },
    );
    try {
      const reply = await new OllamaProvider({ url: ollama.url, model: 'llama3.2', numCtx: 4096 }).chat(request);
      expect(reply).toEqual({ text: 'Hi!', toolCalls: [] });
      expect(ollama.requests.find((r) => r.path === '/api/chat')?.body).not.toHaveProperty('think');
    } finally {
      await ollama.close();
    }
  });

  it('explains a missing model with the command to fix it', async () => {
    const ollama = await fakeOllama(() => ({ status: 404, body: { error: "model 'qwen3:8b' not found" } }));
    try {
      const provider = new OllamaProvider({ url: ollama.url, model: 'qwen3:8b', numCtx: 8192 });
      await expect(provider.chat(request)).rejects.toThrow('ollama pull qwen3:8b');
      await expect(provider.status()).resolves.toMatchObject({ status: 'model-missing' });
    } finally {
      await ollama.close();
    }
  });

  it('reports models without tool support', async () => {
    const ollama = await fakeOllama(() => ({ status: 200, body: { capabilities: ['completion'] } }));
    try {
      const status = await new OllamaProvider({ url: ollama.url, model: 'gemma', numCtx: 8192 }).status();
      expect(status).toMatchObject({ provider: 'ollama', model: 'gemma', status: 'no-tool-support' });
    } finally {
      await ollama.close();
    }
  });

  it('says how to fix it when Ollama is not running', async () => {
    const provider = new OllamaProvider({ url: 'http://127.0.0.1:9', model: 'qwen3:8b', numCtx: 8192 });
    await expect(provider.chat(request)).rejects.toBeInstanceOf(LlmError);
    await expect(provider.status()).resolves.toMatchObject({ status: 'unreachable' });
  });
});

describe('Ollama message format', () => {
  it('converts the neutral history', () => {
    expect(
      toOllamaMessages('sys', [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: '', toolCalls: [{ id: '1', name: 'tasks_list', input: {} }] },
        { role: 'tool', toolCallId: '1', name: 'tasks_list', content: '{"tasks":[]}', isError: false },
      ]),
    ).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'tasks_list', arguments: {} } }] },
      { role: 'tool', content: '{"tasks":[]}', tool_name: 'tasks_list' },
    ]);
  });

  it('recovers tool calls written as text', () => {
    const reply = readReply({
      message: { content: 'Sure.\n<tool_call>{"name": "open_app", "arguments": {"app": "drive"}}</tool_call>' },
    });
    expect(reply.text).toBe('Sure.');
    expect(reply.toolCalls).toEqual([{ id: expect.any(String), name: 'open_app', input: { app: 'drive' } }]);
  });

  it('parses arguments sent as a JSON string', () => {
    const reply = readReply({ message: { tool_calls: [{ function: { name: 'x', arguments: '{"a":1}' } }] } });
    expect(reply.toolCalls[0].input).toEqual({ a: 1 });
  });
});
