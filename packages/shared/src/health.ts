import { z } from 'zod';

export const llmProviderSchema = z.enum(['ollama', 'anthropic']);

export const llmStatusSchema = z.object({
  provider: llmProviderSchema,
  model: z.string(),
  // ready: Aura can think. Anything else comes with a `detail` telling the user how to fix it.
  status: z.enum(['ready', 'unreachable', 'model-missing', 'no-tool-support', 'error']),
  detail: z.string().optional(),
});

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['up', 'down']),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  llm: llmStatusSchema.optional(),
});

export type LlmProviderName = z.infer<typeof llmProviderSchema>;
export type LlmStatus = z.infer<typeof llmStatusSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
