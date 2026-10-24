import { AppConfig } from './app-config';

const KEY = Buffer.alloc(32, 7).toString('base64');

const valid = {
  DATABASE_URL: 'postgresql://aura:aura@localhost:5433/aura',
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secret',
  TOKEN_ENCRYPTION_KEY: KEY,
};

describe('AppConfig', () => {
  it('fills in sensible defaults', () => {
    const config = AppConfig.fromEnv(valid);
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3000);
    expect(config.google.redirectUri).toBe('http://127.0.0.1:3000/auth/google/callback');
    expect(config.encryptionKey).toHaveLength(32);
    expect(config.llm).toEqual({ provider: 'ollama', url: 'http://127.0.0.1:11434', model: 'qwen3:8b', numCtx: 8192 });
  });

  it('builds the redirect URI from PUBLIC_URL without a double slash', () => {
    const config = AppConfig.fromEnv({ ...valid, PUBLIC_URL: 'https://aura.example.com/' });
    expect(config.google.redirectUri).toBe('https://aura.example.com/auth/google/callback');
  });

  it('lists every missing or invalid setting in one error', () => {
    expect(() => AppConfig.fromEnv({ DATABASE_URL: 'x', TOKEN_ENCRYPTION_KEY: 'too-short' })).toThrow(
      /GOOGLE_CLIENT_ID: is missing[\s\S]*GOOGLE_CLIENT_SECRET: is missing[\s\S]*TOKEN_ENCRYPTION_KEY: must be 32 random bytes/,
    );
  });

  it('needs an API key to use Claude', () => {
    expect(() => AppConfig.fromEnv({ ...valid, LLM_PROVIDER: 'anthropic' })).toThrow(
      /ANTHROPIC_API_KEY: is required when LLM_PROVIDER=anthropic/,
    );
    const config = AppConfig.fromEnv({ ...valid, LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(config.llm).toEqual({ provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-opus-5-5' });
  });
});
