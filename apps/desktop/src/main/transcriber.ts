import { EventEmitter } from 'node:events';

// Speech to text runs in a separate background process, so a slow
// transcription never freezes the app. This side sends audio and waits.

export type WorkerRequest =
  | { type: 'load'; model: string; cacheDir: string }
  | { type: 'transcribe'; id: number; audio: Float32Array };

export type WorkerResponse =
  | { type: 'progress'; percent: number }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id: number | null; message: string };

/** The parts of Electron's UtilityProcess this class uses (so tests can fake it). */
export interface WorkerHandle {
  postMessage(message: WorkerRequest): void;
  on(event: 'message', listener: (message: WorkerResponse) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  kill(): boolean;
}

const TIMEOUT_MS = 10 * 60_000; // the first run downloads the speech model

export class Transcriber extends EventEmitter {
  private worker: WorkerHandle | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (text: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>();

  constructor(
    private readonly startWorker: () => WorkerHandle,
    private readonly options: { model: string; cacheDir: string },
  ) {
    super();
  }

  /** Starts loading the model in the background, so the first command is fast. */
  warmUp(): void {
    this.ensureWorker();
  }

  transcribe(audio: Float32Array): Promise<string> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Speech recognition took too long. Try again.'));
      }, TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ type: 'transcribe', id, audio });
    });
  }

  dispose(): void {
    this.worker?.kill();
    this.worker = null;
  }

  private ensureWorker(): WorkerHandle {
    if (this.worker) return this.worker;
    const worker = this.startWorker();
    this.worker = worker;
    worker.on('message', (message) => this.onMessage(message));
    worker.on('exit', () => {
      if (this.worker === worker) this.worker = null;
      this.failAll(new Error('Speech recognition stopped unexpectedly. Try again.'));
    });
    worker.postMessage({ type: 'load', model: this.options.model, cacheDir: this.options.cacheDir });
    return worker;
  }

  private onMessage(message: WorkerResponse): void {
    if (message.type === 'progress') {
      this.emit('progress', message.percent);
    } else if (message.type === 'ready') {
      this.emit('ready');
    } else if (message.type === 'result') {
      this.settle(message.id, (entry) => entry.resolve(message.text));
    } else if (message.id === null) {
      this.emit('load-error', message.message);
      this.failAll(new Error(message.message));
    } else {
      this.settle(message.id, (entry) => entry.reject(new Error(message.message)));
    }
  }

  private settle(id: number, action: (entry: { resolve: (text: string) => void; reject: (err: Error) => void }) => void) {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    action(entry);
  }

  private failAll(err: Error): void {
    for (const id of [...this.pending.keys()]) {
      this.settle(id, (entry) => entry.reject(err));
    }
  }
}

/** Whisper sometimes "hears" these in silence or noise. They are never real commands. */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ') // [BLANK_AUDIO], (music), *sigh*
    .replace(/\s+/g, ' ')
    .trim();
}
