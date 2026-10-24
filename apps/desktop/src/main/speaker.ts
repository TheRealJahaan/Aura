import { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface SpeakerOptions {
  enabled: boolean;
  voice: string | null;
  platform?: NodeJS.Platform;
  spawnImpl?: typeof spawn;
}

/**
 * Speaks with the Mac's built-in voice (the `say` command). It is free,
 * works offline, and uses whichever voice you picked in System Settings.
 */
export class Speaker extends EventEmitter {
  private current: ChildProcess | null = null;
  private readonly spawnImpl: typeof spawn;
  readonly available: boolean;

  constructor(private readonly options: SpeakerOptions) {
    super();
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.available = options.enabled && (options.platform ?? process.platform) === 'darwin';
  }

  /** Resolves when Aura has finished speaking (or was stopped). */
  speak(text: string): Promise<void> {
    this.stop();
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 1500);
    if (!this.available || !clean) {
      this.emit('done');
      return Promise.resolve();
    }
    const args = this.options.voice ? ['-v', this.options.voice] : [];
    // The text goes in on stdin, never as an argument, so it can't be read as an option.
    const child = this.spawnImpl('say', args, { stdio: ['pipe', 'ignore', 'ignore'] });
    this.current = child;
    return new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        // 'done' means "finished talking on its own", not "stopped" or "replaced".
        if (this.current === child) {
          this.current = null;
          this.emit('done');
        }
        resolve();
      };
      child.once('error', done);
      child.once('exit', done);
      child.stdin?.end(clean);
    });
  }

  stop(): void {
    const child = this.current;
    this.current = null;
    if (child && child.exitCode === null) child.kill();
  }
}
