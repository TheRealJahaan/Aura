import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError } from '../../src/main/api-client';
import { parseConfig } from '../../src/main/config';
import { AuraController, ControllerDeps, wakeLabelFromFile } from '../../src/main/controller';

const user = { id: 'u', email: 'j@example.com', name: 'J', avatarUrl: null, timezone: 'Asia/Kolkata', google: { connected: true, missingServices: [] } };
const turnResponse = {
  conversationId: 'c',
  reply: 'Opening Gmail.',
  actions: [
    { type: 'open_url' as const, url: 'https://mail.google.com/mail/u/', label: 'Gmail' },
    { type: 'open_url' as const, url: 'https://evil.example.com/', label: 'Evil' },
  ],
  pendingConfirmation: null,
  services: ['gmail' as const],
};

function setup(env: Record<string, string> = {}) {
  let token: string | null = 'aura_t';
  const api = {
    health: jest.fn().mockResolvedValue({ status: 'ok', database: 'up', version: '0.1.0', uptimeSeconds: 1 }),
    me: jest.fn().mockResolvedValue(user),
    exchangeCode: jest.fn().mockResolvedValue({ token: 'aura_new', user }),
    setTimezone: jest.fn().mockResolvedValue(user),
    logout: jest.fn().mockResolvedValue(undefined),
    disconnectGoogle: jest.fn().mockResolvedValue(undefined),
    turn: jest.fn().mockResolvedValue(turnResponse),
    confirm: jest.fn().mockResolvedValue(turnResponse),
    undo: jest.fn(),
    activity: jest.fn(),
  };
  const sessions = { load: jest.fn(() => token), save: jest.fn((t: string) => (token = t)), clear: jest.fn(() => (token = null)) };
  const deps = {
    config: parseConfig(env),
    api,
    sessions,
    speaker: { available: true, speak: jest.fn(), stop: jest.fn() },
    transcriber: { transcribe: jest.fn().mockResolvedValue('open mail') },
    openExternal: jest.fn().mockResolvedValue(undefined),
    broadcast: jest.fn(),
    timezone: () => 'Europe/London',
    startLogin: jest.fn().mockResolvedValue({
      code: Promise.resolve('c'.repeat(43)),
      verifier: 'v'.repeat(43),
      startUrl: 'http://127.0.0.1:3000/auth/google/start?challenge=x&port=1',
      cancel: jest.fn(),
    }),
  };
  const controller = new AuraController(deps as unknown as ControllerDeps);
  return { controller, deps, api, sessions };
}

describe('AuraController', () => {
  it('refreshes health and the signed-in user', async () => {
    const { controller, deps } = setup();
    const state = await controller.refresh();
    expect(state).toMatchObject({ apiReachable: true, user: { email: 'j@example.com' }, wake: { mode: 'off' } });
    expect(deps.broadcast).toHaveBeenCalled();
  });

  it('marks the server offline', async () => {
    const { controller, api } = setup();
    api.health.mockRejectedValue(new Error('down'));
    expect((await controller.refresh()).apiReachable).toBe(false);
  });

  it('signs in through the browser and sets the time zone', async () => {
    const { controller, deps, api, sessions } = setup();
    const result = await controller.signIn();
    expect(result.ok).toBe(true);
    expect(deps.openExternal).toHaveBeenCalledWith(expect.stringContaining('/auth/google/start'));
    expect(api.exchangeCode).toHaveBeenCalledWith({ code: 'c'.repeat(43), verifier: 'v'.repeat(43) });
    expect(sessions.save).toHaveBeenCalledWith('aura_new');
    expect(api.setTimezone).toHaveBeenCalledWith('Europe/London');
  });

  it('runs only allowed actions after a turn', async () => {
    const { controller, deps } = setup();
    const result = await controller.turn('open mail');
    expect(result).toMatchObject({ ok: true, value: { reply: 'Opening Gmail.' } });
    expect(deps.openExternal).toHaveBeenCalledTimes(1);
    expect(deps.openExternal).toHaveBeenCalledWith('https://mail.google.com/mail/u/');
  });

  it('signs out locally when the session has expired', async () => {
    const { controller, api, sessions } = setup();
    await controller.refresh();
    api.turn.mockRejectedValue(new ApiError('Your Aura sign-in has ended.', 401));
    const result = await controller.turn('hi');
    expect(result).toEqual({ ok: false, error: 'Your Aura sign-in has ended.' });
    expect(sessions.clear).toHaveBeenCalled();
    expect(controller.state.user).toBeNull();
  });

  it('builds the wake word config', () => {
    expect(setup().controller.wakeConfig()).toMatchObject({ enabled: false });
    expect(setup({ PICOVOICE_ACCESS_KEY: 'key', WAKE_WORD_BUILTIN: 'Jarvis' }).controller.wakeConfig()).toEqual({
      enabled: true,
      accessKey: 'key',
      sensitivity: 0.6,
      keyword: { builtin: 'Jarvis', label: 'Jarvis' },
    });
    const ppn = join(mkdtempSync(join(tmpdir(), 'aura-')), 'Hey-Aura_en_wasm_v4_0_0.ppn');
    writeFileSync(ppn, Buffer.from([1, 2, 3]));
    expect(setup({ PICOVOICE_ACCESS_KEY: 'key', WAKE_WORD_PATH: ppn }).controller.wakeConfig()).toMatchObject({
      keyword: { base64: 'AQID', label: 'Hey Aura' },
    });
    expect(setup({ PICOVOICE_ACCESS_KEY: 'key', WAKE_WORD_PATH: '/nope.ppn' }).controller.wakeConfig()).toMatchObject({ enabled: false });
  });

  it('names custom wake words from the file', () => {
    expect(wakeLabelFromFile('/x/Hey-Aura_en_mac_v4_0_0.ppn')).toBe('Hey Aura');
  });
});
