import type { Page } from '@playwright/test';

/**
 * Installs a fake `window.aura` before the page loads, so the orb and the
 * dashboard can be tested in a plain browser. `script` maps a command to the
 * response the fake should give.
 */
export async function mockBridge(page: Page, options: { signedIn?: boolean; responses?: Record<string, unknown> } = {}) {
  await page.addInitScript(
    ({ signedIn, responses }) => {
      const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
      const on = (name: string) => (cb: (...args: unknown[]) => void) => {
        (listeners[name] ??= []).push(cb);
        return () => undefined;
      };
      const calls: Array<[string, unknown[]]> = [];
      const user = {
        id: 'u1',
        email: 'jahaan@example.com',
        name: 'Jahaan Suthar',
        avatarUrl: null,
        timezone: 'Asia/Kolkata',
        google: { connected: true, missingServices: [] },
      };
      const state = {
        apiUrl: 'http://127.0.0.1:3000',
        apiReachable: true,
        health: { status: 'ok', database: 'up', version: '0.1.0', uptimeSeconds: 5, llm: { provider: 'ollama', model: 'qwen3:8b', status: 'ready' } },
        user: signedIn ? user : null,
        hotkey: 'Alt+Space',
        wake: { mode: 'builtin', label: 'Computer', state: 'listening' },
        voice: true,
      };
      const record = (name: string, value: unknown) => (...args: unknown[]) => {
        calls.push([name, args]);
        const custom = (responses as Record<string, unknown>)[name === 'turn' ? `turn:${args[0]}` : name];
        return Promise.resolve(custom ?? value);
      };
      const w = window as unknown as Record<string, unknown>;
      w.__calls = calls;
      w.__emit = (name: string, ...args: unknown[]) => (listeners[name] ?? []).forEach((cb) => cb(...args));
      w.aura = {
        getState: record('getState', state),
        signIn: record('signIn', { ok: true, value: user }),
        signOut: record('signOut', undefined),
        disconnectGoogle: record('disconnectGoogle', { ok: true, value: null }),
        turn: record('turn', { ok: true, value: { conversationId: 'c1', reply: 'Okay.', actions: [], pendingConfirmation: null, services: [] } }),
        confirm: record('confirm', { ok: true, value: { conversationId: 'c1', reply: 'Sent. Your email to priya@example.com is on its way.', actions: [], pendingConfirmation: null, services: ['gmail'] } }),
        undo: record('undo', { ok: true, value: { reply: 'I removed Buy milk from your tasks.' } }),
        activity: record('activity', { ok: true, value: { items: [] } }),
        transcribe: record('transcribe', { ok: true, value: '' }),
        speak: record('speak', undefined),
        stopSpeaking: record('stopSpeaking', undefined),
        showOrb: record('showOrb', undefined),
        hideOrb: record('hideOrb', undefined),
        openDashboard: record('openDashboard', undefined),
        wakeConfig: record('wakeConfig', { enabled: false, reason: 'test' }),
        reportWake: record('reportWake', undefined),
        onListen: on('listen'),
        onType: on('type'),
        onSpeechDone: on('speechDone'),
        onStateChanged: on('stateChanged'),
      };
    },
    { signedIn: options.signedIn ?? true, responses: options.responses ?? {} },
  );
}

export const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: Array<[string, unknown[]]> }).__calls);
