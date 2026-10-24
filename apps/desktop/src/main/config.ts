import { join } from 'node:path';
import { z } from 'zod';

export const BUILTIN_WAKE_WORDS = [
  'Alexa', 'Americano', 'Blueberry', 'Bumblebee', 'Computer', 'Grapefruit', 'Grasshopper',
  'Hey Google', 'Hey Siri', 'Jarvis', 'Okay Google', 'Picovoice', 'Porcupine', 'Terminator',
] as const;

// Empty lines like `PICOVOICE_ACCESS_KEY=` mean "not set".
const optional = z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().trim().optional());

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

const schema = z.object({
  AURA_API_URL: z
    .url()
    .default('http://127.0.0.1:3000')
    .refine((value) => {
      const url = new URL(value);
      return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
    }, 'must be https, or http on this Mac (127.0.0.1), so your sign-in token is never sent unencrypted'),
  PICOVOICE_ACCESS_KEY: optional,
  WAKE_WORD_PATH: optional,
  WAKE_WORD_BUILTIN: z.enum(BUILTIN_WAKE_WORDS).default('Computer'),
  WAKE_WORD_SENSITIVITY: z.coerce.number().min(0).max(1).default(0.6),
  AURA_HOTKEY: z.string().trim().min(1).default('Alt+Space'),
  WHISPER_MODEL: z.string().trim().min(1).default('Xenova/whisper-base.en'),
  AURA_VOICE: optional,
  AURA_SPEAK: z.enum(['on', 'off']).default('on'),
});

export interface DesktopConfig {
  apiUrl: string;
  picovoiceAccessKey: string | null;
  wakeWordPath: string | null;
  wakeWordBuiltin: (typeof BUILTIN_WAKE_WORDS)[number];
  wakeWordSensitivity: number;
  hotkey: string;
  whisperModel: string;
  voice: string | null;
  speak: boolean;
}

export function parseConfig(env: NodeJS.ProcessEnv): DesktopConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `- ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Aura can't start. Fix these settings in apps/desktop/.env:\n${lines.join('\n')}`);
  }
  const e = result.data;
  return {
    apiUrl: e.AURA_API_URL.replace(/\/+$/, ''),
    picovoiceAccessKey: e.PICOVOICE_ACCESS_KEY ?? null,
    wakeWordPath: e.WAKE_WORD_PATH ?? null,
    wakeWordBuiltin: e.WAKE_WORD_BUILTIN,
    wakeWordSensitivity: e.WAKE_WORD_SENSITIVITY,
    hotkey: e.AURA_HOTKEY,
    whisperModel: e.WHISPER_MODEL,
    voice: e.AURA_VOICE ?? null,
    speak: e.AURA_SPEAK === 'on',
  };
}

/** Reads apps/desktop/.env (if there is one) into the environment, then the settings. */
export function loadConfig(appPath: string): DesktopConfig {
  try {
    process.loadEnvFile(join(appPath, '.env'));
  } catch {
    // No .env file: every setting has a default.
  }
  return parseConfig(process.env);
}
