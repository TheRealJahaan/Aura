import type { WakeConfig, WakeStatus } from '../shared/bridge';

// The microphone and the wake word. Picovoice's libraries are loaded only
// when they're needed, so the orb opens instantly.

type Engine = { onmessage: (event: MessageEvent<{ command: string; inputFrame: Int16Array }>) => void };

async function voiceProcessor() {
  const { WebVoiceProcessor } = await import('@picovoice/web-voice-processor');
  return WebVoiceProcessor;
}

/** Calls `onFrame` with each 32 ms microphone frame until the returned function is called. */
export async function captureFrames(onFrame: (frame: Int16Array) => void): Promise<() => Promise<void>> {
  const wvp = await voiceProcessor();
  const engine: Engine = {
    onmessage: (event) => {
      if (event.data.command === 'process') onFrame(event.data.inputFrame);
    },
  };
  await wvp.subscribe(engine);
  return () => wvp.unsubscribe(engine);
}

/**
 * Starts listening for the wake word in the background. Audio is checked
 * on this Mac by Porcupine; nothing is recorded or sent anywhere.
 */
export async function startWakeWord(config: WakeConfig, onWake: () => void): Promise<WakeStatus> {
  if (!config.enabled) {
    return { mode: 'off', label: null, state: 'off', detail: config.reason };
  }
  const mode = 'builtin' in config.keyword ? 'builtin' : 'custom';
  const label = config.keyword.label;
  try {
    const { PorcupineWorker } = await import('@picovoice/porcupine-web');
    const keyword =
      'builtin' in config.keyword
        ? { builtin: config.keyword.builtin as never, sensitivity: config.sensitivity }
        : { base64: config.keyword.base64, label, sensitivity: config.sensitivity };
    const porcupine = await PorcupineWorker.create(config.accessKey, [keyword], () => onWake(), {
      publicPath: 'porcupine/porcupine_params.pv',
      customWritePath: 'aura_porcupine_v4',
    });
    const wvp = await voiceProcessor();
    await wvp.subscribe(porcupine);
    return { mode, label, state: 'listening' };
  } catch (err) {
    return { mode, label, state: 'error', detail: describeWakeError(err) };
  }
}

function describeWakeError(err: unknown): string {
  const message = (err as Error)?.message ?? String(err);
  if (/AccessKey|activation|ACTIVATION|invalid key/i.test(message)) {
    return 'Picovoice rejected the AccessKey. Copy it again from console.picovoice.ai into apps/desktop/.env.';
  }
  if (/Permission|NotAllowed|denied/i.test(message)) {
    return 'Aura has no microphone access. Allow it in System Settings > Privacy & Security > Microphone.';
  }
  return `The wake word couldn't start: ${message.slice(0, 160)}`;
}
