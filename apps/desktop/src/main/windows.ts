import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { APP_ORIGIN } from './protocol';

const ORB_SIZE = { width: 380, height: 460 };

function secureWebPreferences(preload: string) {
  return {
    preload,
    contextIsolation: true, // the page can't touch Node or Electron directly
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
  };
}

/** The floating orb. It stays loaded (hidden) so the wake word keeps listening. */
export function createOrbWindow(distDir: string): BrowserWindow {
  const orb = new BrowserWindow({
    ...ORB_SIZE,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      ...secureWebPreferences(join(distDir, 'preload.js')),
      // Keep the microphone and timers running while the orb is hidden.
      backgroundThrottling: false,
    },
  });
  orb.setAlwaysOnTop(true, 'floating');
  orb.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  void orb.loadURL(`${APP_ORIGIN}/orb.html`);
  return orb;
}

/** Puts the orb at the right edge of the screen the mouse is on. */
export function positionOrb(orb: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  orb.setPosition(Math.round(x + width - ORB_SIZE.width - 16), Math.round(y + (height - ORB_SIZE.height) / 2));
}

export function createDashboardWindow(distDir: string): BrowserWindow {
  const dashboard = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: 'Aura',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0b0b12',
    webPreferences: secureWebPreferences(join(distDir, 'preload.js')),
  });
  void dashboard.loadURL(`${APP_ORIGIN}/dashboard.html`);
  dashboard.once('ready-to-show', () => dashboard.show());
  return dashboard;
}
