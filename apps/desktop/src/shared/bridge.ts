import type { ActivityResponse, GoogleService, HealthResponse, PendingConfirmation, TurnResponse, UserProfile } from '@aura/shared';

// The only things the Aura windows can ask the main process to do. Each one
// is a named IPC channel; the main process checks every argument it receives.

export const CHANNELS = {
  getState: 'aura:get-state',
  signIn: 'aura:sign-in',
  signOut: 'aura:sign-out',
  disconnectGoogle: 'aura:disconnect-google',
  turn: 'aura:turn',
  confirm: 'aura:confirm',
  undo: 'aura:undo',
  activity: 'aura:activity',
  transcribe: 'aura:transcribe',
  speak: 'aura:speak',
  stopSpeaking: 'aura:stop-speaking',
  showOrb: 'aura:show-orb',
  hideOrb: 'aura:hide-orb',
  openDashboard: 'aura:open-dashboard',
  wakeConfig: 'aura:wake-config',
  reportWake: 'aura:report-wake',
} as const;

/** Events the main process sends to the windows. */
export const EVENTS = {
  listen: 'aura:event:listen',
  type: 'aura:event:type',
  speechDone: 'aura:event:speech-done',
  stateChanged: 'aura:event:state-changed',
} as const;

export type WakeStatus =
  | { mode: 'custom' | 'builtin'; label: string; state: 'starting' | 'listening' | 'error'; detail?: string }
  | { mode: 'off'; label: null; state: 'off'; detail?: string };

export interface AppState {
  apiUrl: string;
  apiReachable: boolean;
  health: HealthResponse | null;
  user: UserProfile | null;
  hotkey: string;
  wake: WakeStatus;
  voice: boolean;
}

export type WakeConfig =
  | { enabled: false; reason: string }
  | {
      enabled: true;
      accessKey: string;
      sensitivity: number;
      keyword: { builtin: string; label: string } | { base64: string; label: string };
    };

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface AuraBridge {
  getState(): Promise<AppState>;
  signIn(): Promise<Result<UserProfile>>;
  signOut(): Promise<void>;
  disconnectGoogle(): Promise<Result<null>>;
  turn(text: string, conversationId?: string): Promise<Result<TurnResponse>>;
  confirm(actionId: string, approve: boolean): Promise<Result<TurnResponse>>;
  undo(actionId: string): Promise<Result<{ reply: string }>>;
  activity(): Promise<Result<ActivityResponse>>;
  transcribe(audio: Float32Array): Promise<Result<string>>;
  speak(text: string): Promise<void>;
  stopSpeaking(): Promise<void>;
  showOrb(focus: boolean): Promise<void>;
  hideOrb(): Promise<void>;
  openDashboard(): Promise<void>;
  wakeConfig(): Promise<WakeConfig>;
  reportWake(status: WakeStatus): Promise<void>;
  onListen(callback: () => void): () => void;
  onType(callback: () => void): () => void;
  onSpeechDone(callback: () => void): () => void;
  onStateChanged(callback: (state: AppState) => void): () => void;
}

export type { ActivityResponse, GoogleService, PendingConfirmation, TurnResponse, UserProfile };
