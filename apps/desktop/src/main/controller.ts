import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import type { ActivityResponse, TurnResponse, UserProfile } from '@aura/shared';
import type { AppState, Result, WakeConfig, WakeStatus } from '../shared/bridge';
import { runActions } from './actions';
import { ApiClient, ApiError } from './api-client';
import type { DesktopConfig } from './config';
import { LoopbackLogin, startLoopbackLogin } from './login';
import type { SessionStore } from './session-store';
import type { Speaker } from './speaker';
import type { Transcriber } from './transcriber';

export interface ControllerDeps {
  config: DesktopConfig;
  api: ApiClient;
  sessions: SessionStore;
  speaker: Speaker;
  transcriber: Pick<Transcriber, 'transcribe'>;
  openExternal(url: string): Promise<void>;
  /** Tells every Aura window that something changed. */
  broadcast(state: AppState): void;
  timezone(): string;
  startLogin?: typeof startLoopbackLogin;
}

/** "Hey-Aura_en_wasm_v4_0_0.ppn" → "Hey Aura". */
export function wakeLabelFromFile(path: string): string {
  return basename(path).replace(/\.ppn$/i, '').split('_')[0].replace(/[-.]+/g, ' ').trim() || 'Custom wake word';
}

/**
 * Everything the Aura windows can ask for. It holds the app's state and is
 * the only code that talks to the API, opens links, or speaks.
 */
export class AuraController {
  private login: LoopbackLogin | null = null;
  readonly state: AppState;

  constructor(private readonly deps: ControllerDeps) {
    const { config } = deps;
    this.state = {
      apiUrl: config.apiUrl,
      apiReachable: false,
      health: null,
      user: null,
      hotkey: config.hotkey,
      wake: config.picovoiceAccessKey
        ? { mode: config.wakeWordPath ? 'custom' : 'builtin', label: this.wakeLabel(), state: 'starting' }
        : { mode: 'off', label: null, state: 'off' },
      voice: deps.speaker.available,
    };
  }

  private changed(): AppState {
    this.deps.broadcast(this.state);
    return this.state;
  }

  /** Checks the API and who is signed in. */
  async refresh(): Promise<AppState> {
    try {
      this.state.health = await this.deps.api.health();
      this.state.apiReachable = true;
    } catch {
      this.state.health = null;
      this.state.apiReachable = false;
      return this.changed();
    }
    if (this.deps.sessions.load()) {
      try {
        this.state.user = await this.deps.api.me();
      } catch (err) {
        this.handleAuthError(err);
      }
    } else {
      this.state.user = null;
    }
    return this.changed();
  }

  async signIn(): Promise<Result<UserProfile>> {
    this.login?.cancel();
    try {
      const login = await (this.deps.startLogin ?? startLoopbackLogin)(this.deps.config.apiUrl);
      this.login = login;
      await this.deps.openExternal(login.startUrl);
      const code = await login.code;
      const { token } = await this.deps.api.exchangeCode({ code, verifier: login.verifier });
      this.deps.sessions.save(token);
      // So "3 PM" means 3 PM where this Mac is.
      this.state.user = await this.deps.api.setTimezone(this.deps.timezone());
      this.changed();
      return { ok: true, value: this.state.user };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    } finally {
      this.login = null;
    }
  }

  async signOut(): Promise<void> {
    try {
      await this.deps.api.logout();
    } catch {
      // Signing out locally still works when the server can't be reached.
    }
    this.deps.sessions.clear();
    this.state.user = null;
    this.changed();
  }

  async disconnectGoogle(): Promise<Result<null>> {
    return this.call(async () => {
      await this.deps.api.disconnectGoogle();
      this.deps.sessions.clear();
      this.state.user = null;
      this.changed();
      return null;
    });
  }

  turn(text: string, conversationId?: string): Promise<Result<TurnResponse>> {
    return this.call(async () => this.afterTurn(await this.deps.api.turn({ text, conversationId })));
  }

  confirm(actionId: string, approve: boolean): Promise<Result<TurnResponse>> {
    return this.call(async () => this.afterTurn(await this.deps.api.confirm(actionId, approve)));
  }

  undo(actionId: string): Promise<Result<{ reply: string }>> {
    return this.call(() => this.deps.api.undo(actionId));
  }

  activity(): Promise<Result<ActivityResponse>> {
    return this.call(() => this.deps.api.activity());
  }

  async transcribe(audio: Float32Array): Promise<Result<string>> {
    try {
      return { ok: true, value: await this.deps.transcriber.transcribe(audio) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  speak(text: string): Promise<void> {
    return this.deps.speaker.speak(text);
  }

  stopSpeaking(): void {
    this.deps.speaker.stop();
  }

  reportWake(status: WakeStatus): void {
    this.state.wake = status;
    this.changed();
  }

  wakeConfig(): WakeConfig {
    const { config } = this.deps;
    if (!config.picovoiceAccessKey) {
      return {
        enabled: false,
        reason: `No wake word yet: add a free Picovoice AccessKey to apps/desktop/.env. Until then, press ${config.hotkey}.`,
      };
    }
    const base = { enabled: true as const, accessKey: config.picovoiceAccessKey, sensitivity: config.wakeWordSensitivity };
    if (!config.wakeWordPath) {
      return { ...base, keyword: { builtin: config.wakeWordBuiltin, label: config.wakeWordBuiltin } };
    }
    try {
      if (!/\.ppn$/i.test(config.wakeWordPath) || statSync(config.wakeWordPath).size > 2_000_000) {
        throw new Error('not a .ppn file');
      }
      return { ...base, keyword: { base64: readFileSync(config.wakeWordPath).toString('base64'), label: this.wakeLabel() } };
    } catch (err) {
      return { enabled: false, reason: `Can't read WAKE_WORD_PATH (${(err as Error).message}). Check the path in apps/desktop/.env.` };
    }
  }

  private wakeLabel(): string {
    const { config } = this.deps;
    return config.wakeWordPath ? wakeLabelFromFile(config.wakeWordPath) : config.wakeWordBuiltin;
  }

  private async afterTurn(response: TurnResponse): Promise<TurnResponse> {
    await runActions(response.actions, this.deps.openExternal);
    return response;
  }

  private async call<T>(work: () => Promise<T>): Promise<Result<T>> {
    try {
      return { ok: true, value: await work() };
    } catch (err) {
      this.handleAuthError(err);
      if (err instanceof ApiError && err.unreachable && this.state.apiReachable) {
        this.state.apiReachable = false;
        this.changed();
      }
      return { ok: false, error: (err as Error).message };
    }
  }

  private handleAuthError(err: unknown): void {
    if (err instanceof ApiError && err.status === 401) {
      this.deps.sessions.clear();
      if (this.state.user) {
        this.state.user = null;
        this.changed();
      }
    }
  }
}
