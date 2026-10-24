import { app, BrowserWindow, dialog, globalShortcut, net, protocol, safeStorage, session, shell, systemPreferences, utilityProcess } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EVENTS } from '../shared/bridge';
import { ApiClient } from './api-client';
import { DesktopConfig, loadConfig } from './config';
import { AuraController } from './controller';
import { registerIpc } from './ipc';
import { isAppUrl, resolveInside } from './protocol';
import { SessionStore } from './session-store';
import { Speaker } from './speaker';
import { Transcriber, WorkerHandle } from './transcriber';
import { createTray } from './tray';
import { createDashboardWindow, createOrbWindow, positionOrb } from './windows';

// The Aura Mac app. The main process owns everything sensitive: the session
// token, calls to the API, opening links, the microphone permission and the
// voice. The windows only draw the orb and the dashboard.

const distDir = __dirname;
const rendererDir = join(distDir, 'renderer');
const assetsDir = join(app.getAppPath(), 'assets');

// aura://app/ serves the app's own pages, so they get a secure origin of their own.
protocol.registerSchemesAsPrivileged([
  { scheme: 'aura', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let orb: BrowserWindow | null = null;
let dashboard: BrowserWindow | null = null;
let quitting = false;

function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of [orb, dashboard]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  }
}

function showOrb(focus: boolean): void {
  if (!orb || orb.isDestroyed()) return;
  if (!orb.isVisible()) positionOrb(orb);
  if (focus) {
    orb.show();
    orb.focus();
  } else {
    // Show without stealing focus from the app you're working in.
    orb.showInactive();
  }
}

function openDashboard(): void {
  if (!dashboard || dashboard.isDestroyed()) {
    dashboard = createDashboardWindow(distDir);
    dashboard.on('closed', () => (dashboard = null));
  } else {
    dashboard.show();
    dashboard.focus();
  }
}

function serveAppFiles(): void {
  protocol.handle('aura', (request) => {
    const url = new URL(request.url);
    const file = url.host === 'app' ? resolveInside(rendererDir, url.pathname) : null;
    if (!file) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function lockDownWebContents(): void {
  app.on('web-contents-created', (_event, contents) => {
    // Aura pages never open new windows or navigate away.
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!isAppUrl(url)) event.preventDefault();
    });
  });
  // The microphone is the only permission, and only for Aura's own pages.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const audioOnly = permission === 'media' && (details as { mediaTypes?: string[] }).mediaTypes?.every((t) => t === 'audio');
    callback(Boolean(audioOnly) && isAppUrl(details.requestingUrl));
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) => permission === 'media' && isAppUrl(`${origin}/`));
}

function startSttWorker(): WorkerHandle {
  const child = utilityProcess.fork(join(distDir, 'stt-worker.js'), [], { serviceName: 'Aura speech recognition' });
  return child as unknown as WorkerHandle;
}

async function start(): Promise<void> {
  let config: DesktopConfig;
  try {
    config = loadConfig(app.getAppPath());
  } catch (err) {
    dialog.showErrorBox('Aura settings problem', (err as Error).message);
    app.exit(1);
    return;
  }

  serveAppFiles();
  lockDownWebContents();
  if (process.platform === 'darwin') {
    // Asks once; macOS remembers the answer in System Settings > Privacy & Security > Microphone.
    await systemPreferences.askForMediaAccess('microphone').catch(() => false);
  }

  const sessions = new SessionStore(join(app.getPath('userData'), 'session.bin'), safeStorage);
  const api = new ApiClient(config.apiUrl, () => sessions.load());
  const speaker = new Speaker({ enabled: config.speak, voice: config.voice });
  const transcriber = new Transcriber(startSttWorker, {
    model: config.whisperModel,
    cacheDir: join(app.getPath('userData'), 'models'),
  });
  speaker.on('done', () => broadcast(EVENTS.speechDone));

  const controller = new AuraController({
    config,
    api,
    sessions,
    speaker,
    transcriber,
    openExternal: (url) => shell.openExternal(url),
    broadcast: (state) => broadcast(EVENTS.stateChanged, state),
    timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  registerIpc(controller, {
    showOrb,
    hideOrb: () => orb?.hide(),
    openDashboard,
  });

  orb = createOrbWindow(distDir);
  orb.on('close', (event) => {
    // The orb lives as long as the app does.
    if (!quitting) {
      event.preventDefault();
      orb?.hide();
    }
  });

  const listen = () => broadcast(EVENTS.listen);
  if (!globalShortcut.register(config.hotkey, listen)) {
    console.warn(`Aura: the shortcut ${config.hotkey} is used by another app. Set AURA_HOTKEY in apps/desktop/.env.`);
  }
  createTray(assetsDir, config.hotkey, {
    listen,
    type: () => {
      showOrb(true);
      broadcast(EVENTS.type);
    },
    openDashboard,
    quit: () => app.quit(),
  });

  const state = await controller.refresh();
  // First run, or signed out: show the window with the "Sign in with Google" button.
  if (!state.user || process.env.AURA_OPEN_DASHBOARD === '1') openDashboard();
  transcriber.warmUp();
  setInterval(() => void controller.refresh(), 30_000).unref();

  app.on('before-quit', () => {
    quitting = true;
    transcriber.dispose();
    speaker.stop();
  });
}

app.on('second-instance', () => app.isReady() && openDashboard());
app.on('activate', () => app.isReady() && openDashboard());
// Closing the dashboard keeps Aura running in the menu bar.
app.on('window-all-closed', () => undefined);
app.on('will-quit', () => globalShortcut.unregisterAll());

void app.whenReady().then(start);
