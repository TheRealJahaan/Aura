// Audio helpers for the orb. Microphone frames arrive as 16-bit samples at
// 16 kHz (512 samples, 32 ms each). Whisper wants 32-bit floats from -1 to 1.

export const SAMPLE_RATE = 16_000;

export function int16ToFloat32(frame: Int16Array): Float32Array {
  const out = new Float32Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    out[i] = frame[i] / 32768;
  }
  return out;
}

/** Loudness of one frame, from 0 (silent) to 1. */
export function rms(frame: Int16Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i] / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / frame.length);
}

export interface EndpointOptions {
  sampleRate: number;
  /** Quiet time after speech that means the user has finished. */
  silenceMs: number;
  /** The longest command we record. */
  maxMs: number;
  /** Stop waiting if nobody starts speaking within this time. */
  noSpeechMs: number;
  /** Speech shorter than this (a cough, a click) doesn't count. */
  minSpeechMs: number;
}

export const DEFAULT_ENDPOINT: EndpointOptions = {
  sampleRate: SAMPLE_RATE,
  silenceMs: 900,
  maxMs: 12_000,
  noSpeechMs: 6_000,
  minSpeechMs: 200,
};

export type EndpointState = 'listening' | 'done' | 'no-speech';

/**
 * Decides when the user has finished speaking, by comparing each frame's
 * loudness with the room's background noise. Simple, fast, and private:
 * nothing leaves the Mac to make this decision.
 */
export class EndpointDetector {
  private readonly options: EndpointOptions;
  private readonly frames: Int16Array[] = [];
  private elapsedMs = 0;
  private speechMs = 0;
  private silenceMs = 0;
  private started = false;
  private noiseFloor: number | null = null;
  private state: EndpointState = 'listening';
  /** Loudness of the last frame relative to the noise, 0 to 1, for the orb animation. */
  level = 0;

  constructor(options: Partial<EndpointOptions> = {}) {
    this.options = { ...DEFAULT_ENDPOINT, ...options };
  }

  get speechStarted(): boolean {
    return this.started;
  }

  feed(frame: Int16Array): EndpointState {
    if (this.state !== 'listening') return this.state;
    this.frames.push(frame.slice());
    const frameMs = (frame.length / this.options.sampleRate) * 1000;
    this.elapsedMs += frameMs;

    const loudness = rms(frame);
    if (this.noiseFloor === null) this.noiseFloor = Math.min(loudness, 0.02);
    const threshold = Math.max(this.noiseFloor * 3, 0.012);
    const voiced = loudness > threshold;
    this.level = Math.min(1, loudness / (threshold * 4));

    if (voiced) {
      this.speechMs += frameMs;
      this.silenceMs = 0;
      if (this.speechMs >= this.options.minSpeechMs) this.started = true;
    } else {
      // Background noise drifts (a fan turns on), so keep learning it while it's quiet.
      this.noiseFloor = this.noiseFloor * 0.95 + loudness * 0.05;
      this.silenceMs += frameMs;
      if (!this.started) this.speechMs = Math.max(0, this.speechMs - frameMs);
    }

    if (this.started && this.silenceMs >= this.options.silenceMs) {
      this.state = 'done';
    } else if (this.elapsedMs >= this.options.maxMs) {
      this.state = this.started ? 'done' : 'no-speech';
    } else if (!this.started && this.elapsedMs >= this.options.noSpeechMs) {
      this.state = 'no-speech';
    }
    return this.state;
  }

  /** Everything recorded so far, ready for Whisper. */
  audio(): Float32Array {
    const total = this.frames.reduce((sum, frame) => sum + frame.length, 0);
    const out = new Float32Array(total);
    let offset = 0;
    for (const frame of this.frames) {
      out.set(int16ToFloat32(frame), offset);
      offset += frame.length;
    }
    return out;
  }
}
