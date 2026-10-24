// Runs in an Electron utility process: loads Whisper once, then turns audio
// into text. Everything happens on this Mac; audio is never uploaded.
import type { WorkerRequest, WorkerResponse } from './transcriber';
import { cleanTranscript } from './transcriber';

type Recognizer = (audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text: string } | Array<{ text: string }>>;

interface ParentPort {
  on(event: 'message', listener: (event: { data: WorkerRequest }) => void): void;
  postMessage(message: WorkerResponse): void;
}

const port = (process as unknown as { parentPort: ParentPort }).parentPort;
let recognizer: Promise<Recognizer> | null = null;
let lastPercent = -1;

function send(message: WorkerResponse): void {
  port.postMessage(message);
}

async function loadRecognizer(model: string, cacheDir: string): Promise<Recognizer> {
  // transformers.js runs Whisper with ONNX Runtime. Loaded here, not bundled,
  // because it ships native code.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const transformers = require('@huggingface/transformers') as typeof import('@huggingface/transformers');
  transformers.env.cacheDir = cacheDir;
  transformers.env.allowLocalModels = false;
  const progress_callback = (info: { status?: string; progress?: number }) => {
    if (info.status === 'progress' && typeof info.progress === 'number') {
      const percent = Math.floor(info.progress);
      if (percent !== lastPercent) {
        lastPercent = percent;
        send({ type: 'progress', percent });
      }
    }
  };
  try {
    return (await transformers.pipeline('automatic-speech-recognition', model, { dtype: 'fp32', progress_callback })) as unknown as Recognizer;
  } catch (err) {
    // Some Macs (Intel) have no native ONNX Runtime build; WebAssembly works everywhere.
    if (/onnxruntime|\.node|dlopen|binding/i.test((err as Error).message)) {
      return (await transformers.pipeline('automatic-speech-recognition', model, {
        dtype: 'fp32',
        device: 'wasm',
        progress_callback,
      })) as unknown as Recognizer;
    }
    throw err;
  }
}

function describe(err: unknown): string {
  const message = (err as Error)?.message ?? String(err);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(message)) {
    return "I couldn't download the speech model. Check your internet connection; it's only needed the first time.";
  }
  return `Speech recognition failed: ${message.slice(0, 200)}`;
}

let loadParams: { model: string; cacheDir: string } | null = null;

function getRecognizer(): Promise<Recognizer> {
  if (!loadParams) return Promise.reject(new Error('The speech model was never configured.'));
  if (!recognizer) {
    const loading = loadRecognizer(loadParams.model, loadParams.cacheDir);
    recognizer = loading;
    // A failed load is forgotten, so the next command tries again.
    loading.catch(() => {
      if (recognizer === loading) recognizer = null;
    });
  }
  return recognizer;
}

port.on('message', ({ data }) => {
  if (data.type === 'load') {
    loadParams = { model: data.model, cacheDir: data.cacheDir };
    getRecognizer().then(
      () => send({ type: 'ready' }),
      (err) => send({ type: 'error', id: null, message: describe(err) }),
    );
    return;
  }
  if (data.type === 'transcribe') {
    const { id, audio } = data;
    getRecognizer()
      .then((recognize) => recognize(audio))
      .then((output) => {
        const text = Array.isArray(output) ? output.map((part) => part.text).join(' ') : output.text;
        send({ type: 'result', id, text: cleanTranscript(text ?? '') });
      })
      .catch((err) => send({ type: 'error', id, message: describe(err) }));
  }
});
