import { z } from 'zod';

const encryptionKey = z.string().refine((value) => Buffer.from(value, 'base64').length === 32, {
  message: 'must be 32 random bytes encoded as base64 (create one with: openssl rand -base64 32)',
});

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    PUBLIC_URL: z.url().default('http://127.0.0.1:3000'),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    TOKEN_ENCRYPTION_KEY: encryptionKey,
    LLM_PROVIDER: z.enum(['ollama', 'anthropic']).default('ollama'),
    OLLAMA_URL: z.url().default('http://127.0.0.1:11434'),
    OLLAMA_MODEL: z.string().min(1).default('qwen3:8b'),
    OLLAMA_NUM_CTX: z.coerce.number().int().min(2048).default(8192),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().min(1).default('claude-opus-5-5'),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['ANTHROPIC_API_KEY'],
        message: 'is required when LLM_PROVIDER=anthropic',
      });
    }
  });

export type LlmConfig =
  | { provider: 'ollama'; url: string; model: string; numCtx: number }
  | { provider: 'anthropic'; apiKey: string; model: string };

// Every setting the API needs, read once from the environment (apps/api/.env)
// and checked up front, so a missing value fails at startup with a clear message
// instead of halfway through someone's sign-in.
export class AppConfig {
  readonly databaseUrl: string;
  readonly host: string;
  readonly port: number;
  readonly publicUrl: string;
  readonly google: { clientId: string; clientSecret: string; redirectUri: string };
  readonly encryptionKey: Buffer;
  readonly llm: LlmConfig;

  private constructor(env: z.infer<typeof envSchema>) {
    this.databaseUrl = env.DATABASE_URL;
    this.host = env.HOST;
    this.port = env.PORT;
    this.publicUrl = env.PUBLIC_URL.replace(/\/+$/, '');
    this.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${this.publicUrl}/auth/google/callback`,
    };
    this.encryptionKey = Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64');
    this.llm =
      env.LLM_PROVIDER === 'anthropic'
        ? { provider: 'anthropic', apiKey: env.ANTHROPIC_API_KEY ?? '', model: env.ANTHROPIC_MODEL }
        : {
            provider: 'ollama',
            url: env.OLLAMA_URL.replace(/\/+$/, ''),
            model: env.OLLAMA_MODEL,
            numCtx: env.OLLAMA_NUM_CTX,
          };
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
    const result = envSchema.safeParse(env);
    if (!result.success) {
      const problems = result.error.issues.map((issue) => {
        const key = issue.path.join('.');
        const missing = issue.code === 'invalid_type' && env[key] === undefined;
        return `  - ${key}: ${missing ? 'is missing' : issue.message}`;
      });
      throw new Error(
        [
          'Aura API cannot start. Fix these settings in apps/api/.env:',
          ...problems,
          'See docs/SETUP.md for where each value comes from.',
        ].join('\n'),
      );
    }
    return new AppConfig(result.data);
  }
}
